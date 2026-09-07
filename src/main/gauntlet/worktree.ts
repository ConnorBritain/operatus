import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { CheckReceipt, FrozenCheck } from '../../shared/gauntlet';
import { assertFullSha, GauntletInvariantError } from './core';
import { prepareCheckSandbox } from './checkSandbox';

export interface GauntletWorkspace {
  repository: string;
  path: string;
  branch: string | null;
  expectedSha: string;
  mode: 'candidate' | 'critic';
}

/** Resolve existing ancestors without creating the planned location. */
export function canonicalPlannedPath(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    suffix.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return resolve(realpathSync(ancestor), ...suffix);
}

export class ArtifactWorkspace {
  constructor(private readonly worktreeRoot: string) {
    if (!isAbsolute(worktreeRoot)) throw new Error('worktreeRoot must be absolute');
  }

  resolveRepository(path: string): string {
    const root = git(path, ['rev-parse', '--show-toplevel']).trim();
    if (!root) throw new GauntletInvariantError(`not a Git repository: ${path}`);
    return realpathSync(root);
  }

  resolveSha(repository: string, ref = 'HEAD'): string {
    const sha = git(repository, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
    assertFullSha(sha, 'resolved ref');
    return sha;
  }

  createCandidate(input: { repository: string; runId: string; launchId: string; branch: string; expectedSha: string; requireNewBranch?: boolean }): GauntletWorkspace {
    assertSafeId(input.runId, 'runId');
    assertSafeId(input.launchId, 'launchId');
    assertSafeBranch(input.branch);
    assertFullSha(input.expectedSha, 'expectedSha');
    const repository = this.resolveRepository(input.repository);
    const path = this.target(input.runId, input.launchId);
    requireAbsent(path);
    mkdirSync(dirname(path), { recursive: true });

    const branchExists = gitStatus(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${input.branch}`]) === 0;
    if (branchExists) {
      if (input.requireNewBranch) throw new GauntletInvariantError('candidate attempt branch already exists');
      const branchSha = this.resolveSha(repository, input.branch);
      if (branchSha !== input.expectedSha) {
        throw new GauntletInvariantError(`candidate branch moved: expected ${input.expectedSha}, got ${branchSha}`);
      }
      git(repository, ['worktree', 'add', path, input.branch]);
    } else {
      git(repository, ['worktree', 'add', '-b', input.branch, path, input.expectedSha]);
    }
    this.assertWorkspace(path, input.expectedSha, false);
    return { repository, path: realpathSync(path), branch: input.branch, expectedSha: input.expectedSha, mode: 'candidate' };
  }

  createCritic(input: { repository: string; runId: string; launchId: string; artifactSha: string }): GauntletWorkspace {
    assertSafeId(input.runId, 'runId');
    assertSafeId(input.launchId, 'launchId');
    assertFullSha(input.artifactSha, 'artifactSha');
    const repository = this.resolveRepository(input.repository);
    const path = this.target(input.runId, input.launchId);
    requireAbsent(path);
    mkdirSync(dirname(path), { recursive: true });
    git(repository, ['worktree', 'add', '--detach', path, input.artifactSha]);
    this.assertWorkspace(path, input.artifactSha, true);
    return { repository, path: realpathSync(path), branch: null, expectedSha: input.artifactSha, mode: 'critic' };
  }

  validateArtifact(workspace: GauntletWorkspace, expectedParentSha: string): { sha: string; diffSummary: string } {
    assertFullSha(expectedParentSha, 'expectedParentSha');
    if (!workspace.branch || git(workspace.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim() !== workspace.branch) {
      throw new GauntletInvariantError('worker completion rejected: not on the assigned candidate branch');
    }
    const status = git(workspace.path, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (status.trim()) throw new GauntletInvariantError('worker completion rejected: worktree is not clean');
    const sha = this.resolveSha(workspace.path);
    if (sha === expectedParentSha) throw new GauntletInvariantError('worker completion rejected: no new commit');
    if (gitStatus(workspace.path, ['merge-base', '--is-ancestor', expectedParentSha, sha]) !== 0) {
      throw new GauntletInvariantError(`artifact ${sha} is not descended from expected ${expectedParentSha}`);
    }
    const diffSummary = git(workspace.path, ['diff', '--stat', `${expectedParentSha}..${sha}`]).trim();
    return { sha, diffSummary };
  }

  validateCriticUnchanged(workspace: GauntletWorkspace): void {
    this.assertWorkspace(workspace.path, workspace.expectedSha, true);
  }

  /** Remove only a clean worktree still pointing at the expected commit. */
  release(workspace: GauntletWorkspace): void {
    if (!existsSync(workspace.path)) return;
    this.assertWorkspace(workspace.path, workspace.mode === 'critic' ? workspace.expectedSha : this.resolveSha(workspace.path), true);
    git(workspace.repository, ['worktree', 'remove', workspace.path]);
  }

  /** Preserve a failed launch for diagnosis without allowing it to keep the
   * candidate branch checked out. Dirty and untracked work remain in place;
   * the worktree becomes detached and locked while a fresh launch can safely
   * attach the authoritative candidate branch at its expected SHA. */
  preserveFailure(workspace: GauntletWorkspace, reason: string): void {
    if (!existsSync(workspace.path)) return;
    if (workspace.mode === 'candidate' && workspace.branch) {
      // A repeated preservation is allowed after this worktree was detached,
      // but never detach an unrelated branch selected outside this launch.
      const branch = git(workspace.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      if (branch !== 'HEAD' && branch !== workspace.branch) throw new GauntletInvariantError('candidate worktree switched to another branch');
      git(workspace.path, ['switch', '--detach']);
    }
    const boundedReason = reason.replace(/[\r\n]+/g, ' ').slice(0, 240) || 'failed Gauntlet launch';
    const lockPath = resolve(workspace.path, git(workspace.path, ['rev-parse', '--git-path', 'locked']).trim());
    if (!existsSync(lockPath)) git(workspace.repository, ['worktree', 'lock', '--reason', `Operatus: ${boundedReason}`, workspace.path]);
  }

  observePreservation(workspace: GauntletWorkspace): { observedSha: string | null; dirty: boolean | null } {
    try { lstatSync(workspace.path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { observedSha: null, dirty: null };
      throw error;
    }
    if (realpathSync(workspace.path) !== workspace.path) throw new GauntletInvariantError('preservation worktree path was redirected');
    const common = (cwd: string): string => realpathSync(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim()));
    if (common(workspace.path) !== common(workspace.repository)) throw new GauntletInvariantError('preservation worktree belongs to another repository');
    return { observedSha: this.resolveSha(workspace.path), dirty: Boolean(git(workspace.path, ['status', '--porcelain=v1', '--untracked-files=all']).trim()) };
  }

  private assertWorkspace(path: string, expectedSha: string, requireClean: boolean): void {
    const actual = this.resolveSha(path);
    if (actual !== expectedSha) throw new GauntletInvariantError(`worktree identity mismatch: expected ${expectedSha}, got ${actual}`);
    if (requireClean && git(path, ['status', '--porcelain=v1', '--untracked-files=all']).trim()) {
      throw new GauntletInvariantError('read-only worktree was modified');
    }
  }

  target(runId: string, launchId: string): string {
    assertSafeId(runId, 'runId'); assertSafeId(launchId, 'launchId');
    const target = resolve(this.worktreeRoot, runId, launchId);
    const rel = relative(resolve(this.worktreeRoot), target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new GauntletInvariantError('worktree target escaped configured root');
    return target;
  }
}

export async function runFrozenChecks(worktree: string, checks: FrozenCheck[], maxOutput = 100_000, signal?: AbortSignal): Promise<CheckReceipt[]> {
  const receipts: CheckReceipt[] = [];
  signal?.throwIfAborted();
  for (const check of checks) {
    signal?.throwIfAborted();
    receipts.push(await runCheck(worktree, check, maxOutput, signal));
    signal?.throwIfAborted();
  }
  return receipts;
}

function runCheck(cwd: string, check: FrozenCheck, maxOutput: number, signal?: AbortSignal): Promise<CheckReceipt> {
  const sandbox = prepareCheckSandbox(cwd);
  return new Promise((resolveReceipt) => {
    const started = Date.now();
    const child = spawn(sandbox.command, sandbox.args(check.command), {
      cwd: sandbox.cwd,
      env: sandbox.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // A separate POSIX process group lets a timeout terminate descendants of
      // the shell as well as the shell itself. Windows uses taskkill /T below.
      detached: process.platform !== 'win32'
    });
    let output = '';
    let timedOut = false;
    let forceTimer: NodeJS.Timeout | null = null;
    // Shutdown is not a failed check receipt: kill the owned check group and
    // let the caller reject after close, before any artifact can be recorded.
    const abort = (): void => terminateProcessTree(child.pid, 'SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunk: Buffer): void => {
      if (output.length < maxOutput) output += chunk.toString('utf8').slice(0, maxOutput - output.length);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid, 'SIGTERM');
      forceTimer = setTimeout(() => terminateProcessTree(child.pid, 'SIGKILL'), 2_000);
      forceTimer.unref();
    }, check.timeoutMs);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      resolveReceipt({
        checkId: check.id,
        command: check.command,
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        output,
        execution: sandbox.receipt
      });
    });
    child.once('error', (error) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      resolveReceipt({
        checkId: check.id,
        command: check.command,
        exitCode: null,
        timedOut,
        durationMs: Date.now() - started,
        output: `${output}\n${error.message}`.trim(),
        execution: sandbox.receipt
      });
    });
  });
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore', windowsHide: true
      });
      killer.on('error', () => { /* process already exited or taskkill unavailable */ });
      return;
    }
    process.kill(-pid, signal);
  } catch { /* the process group already exited */ }
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; message?: string };
    throw new GauntletInvariantError(`git ${args[0]} failed: ${String(detail.stderr ?? detail.message ?? error).trim()}`);
  }
}

function gitStatus(cwd: string, args: string[]): number {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return 0;
  } catch (error) {
    return typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 1;
  }
}

function requireAbsent(path: string): void {
  if (existsSync(path)) throw new GauntletInvariantError(`worktree path already exists: ${path}`);
}

function assertSafeId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new GauntletInvariantError(`unsafe ${label}`);
}

function assertSafeBranch(value: string): void {
  if (!/^operatus\/gauntlet\/[a-zA-Z0-9._/-]+$/.test(value) || value.includes('..') || value.endsWith('/')) {
    throw new GauntletInvariantError('unsafe candidate branch');
  }
}
