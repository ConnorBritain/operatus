import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { CheckReceipt, FrozenCheck } from '../../shared/gauntlet';
import { assertFullSha, GauntletInvariantError } from './core';

export interface GauntletWorkspace {
  repository: string;
  path: string;
  branch: string | null;
  expectedSha: string;
  mode: 'candidate' | 'critic';
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

  createCandidate(input: { repository: string; runId: string; launchId: string; branch: string; expectedSha: string }): GauntletWorkspace {
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
      const branchSha = this.resolveSha(repository, input.branch);
      if (branchSha !== input.expectedSha) {
        throw new GauntletInvariantError(`candidate branch moved: expected ${input.expectedSha}, got ${branchSha}`);
      }
      git(repository, ['worktree', 'add', path, input.branch]);
    } else {
      git(repository, ['worktree', 'add', '-b', input.branch, path, input.expectedSha]);
    }
    this.assertWorkspace(path, input.expectedSha, false);
    return { repository, path, branch: input.branch, expectedSha: input.expectedSha, mode: 'candidate' };
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
    return { repository, path, branch: null, expectedSha: input.artifactSha, mode: 'critic' };
  }

  validateArtifact(workspace: GauntletWorkspace, expectedParentSha: string): { sha: string; diffSummary: string } {
    assertFullSha(expectedParentSha, 'expectedParentSha');
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
      git(workspace.path, ['switch', '--detach']);
    }
    const boundedReason = reason.replace(/[\r\n]+/g, ' ').slice(0, 240) || 'failed Gauntlet launch';
    git(workspace.repository, ['worktree', 'lock', '--reason', `Atelier: ${boundedReason}`, workspace.path]);
  }

  private assertWorkspace(path: string, expectedSha: string, requireClean: boolean): void {
    const actual = this.resolveSha(path);
    if (actual !== expectedSha) throw new GauntletInvariantError(`worktree identity mismatch: expected ${expectedSha}, got ${actual}`);
    if (requireClean && git(path, ['status', '--porcelain=v1', '--untracked-files=all']).trim()) {
      throw new GauntletInvariantError('read-only worktree was modified');
    }
  }

  private target(runId: string, launchId: string): string {
    const target = resolve(this.worktreeRoot, runId, launchId);
    const rel = relative(resolve(this.worktreeRoot), target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new GauntletInvariantError('worktree target escaped configured root');
    return target;
  }
}

export async function runFrozenChecks(worktree: string, checks: FrozenCheck[], maxOutput = 100_000): Promise<CheckReceipt[]> {
  const receipts: CheckReceipt[] = [];
  for (const check of checks) {
    receipts.push(await runCheck(worktree, check, maxOutput));
  }
  return receipts;
}

function runCheck(cwd: string, check: FrozenCheck, maxOutput: number): Promise<CheckReceipt> {
  return new Promise((resolveReceipt) => {
    const started = Date.now();
    const shell = process.platform === 'win32'
      ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', check.command] }
      : { command: '/bin/bash', args: ['-lc', check.command] };
    const child = spawn(shell.command, shell.args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // A separate POSIX process group lets a timeout terminate descendants of
      // the shell as well as the shell itself. Windows uses taskkill /T below.
      detached: process.platform !== 'win32'
    });
    let output = '';
    let timedOut = false;
    let forceTimer: NodeJS.Timeout | null = null;
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
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      resolveReceipt({
        checkId: check.id,
        command: check.command,
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        output
      });
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      resolveReceipt({
        checkId: check.id,
        command: check.command,
        exitCode: null,
        timedOut,
        durationMs: Date.now() - started,
        output: `${output}\n${error.message}`.trim()
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
  if (!/^atelier\/gauntlet\/[a-zA-Z0-9._/-]+$/.test(value) || value.includes('..') || value.endsWith('/')) {
    throw new GauntletInvariantError('unsafe candidate branch');
  }
}
