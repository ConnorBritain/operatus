import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { assertFullSha, GauntletInvariantError } from './core';
import { resolveGitMetadata } from './gitEvidence';
import type { GauntletWorkspace } from './worktree';

/** Main-only fixed Git verbs. Provider processes never receive this sandbox or
 * write capability. Custom filters/hooks/helpers cannot execute here, and no
 * network or working-file writes are permitted. Unsupported repositories fail.
 */
async function candidateGit(workspace: GauntletWorkspace, writable: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const executable = '/Library/Developer/CommandLineTools/usr/bin/git';
  if (process.platform !== 'darwin' || !existsSync(executable)) throw new GauntletInvariantError('offline candidate commit adapter unavailable');
  assertFullSha(workspace.expectedSha, 'expected parent');
  if (workspace.mode !== 'candidate' || !workspace.branch ||
    !/^operatus\/gauntlet\/[a-zA-Z0-9._/-]+$/.test(workspace.branch) || workspace.branch.includes('..') || workspace.branch.endsWith('/')) {
    throw new GauntletInvariantError('invalid assigned candidate branch');
  }
  const path = realpathSync(workspace.path);
  if (path !== workspace.path) throw new GauntletInvariantError('candidate path redirected');
  const { metadata, common } = resolveGitMetadata(path);
  if (common !== resolveGitMetadata(workspace.repository).common || metadata === common) {
    throw new GauntletInvariantError('candidate must be a linked worktree of its assigned repository');
  }
  const q = (path: string): string => {
    if (/[\u0000-\u001f\u007f]/.test(path)) throw new GauntletInvariantError('invalid candidate path');
    return JSON.stringify(path);
  };
  const ref = join(common, 'refs', 'heads', workspace.branch);
  const log = join(common, 'logs', 'refs', 'heads', workspace.branch);
  const index = join(metadata, 'index');
  const sandbox = `(version 1)
(deny default)
(allow process-exec (literal ${q(executable)}))
(allow process-fork sysctl-read file-read-metadata)
(allow file-read* (literal "/") (subpath "/System/Library") (subpath "/System/Cryptexes")
 (subpath "/usr/lib") (subpath "/private/var/db/dyld") (subpath "/Library/Developer/CommandLineTools")
 (literal "/dev/null") (literal "/dev/urandom")
 (subpath ${q(path)}) (subpath ${q(common)}) (subpath ${q(metadata)}))
(allow file-write* (literal "/dev/null"))
${writable ? `(allow file-write* (subpath ${q(join(common, 'objects'))})
 (literal ${q(index)}) (literal ${q(`${index}.lock`)})
 (literal ${q(join(metadata,'HEAD.lock'))}) (literal ${q(join(metadata,'logs','HEAD'))})
 (literal ${q(ref)}) (literal ${q(`${ref}.lock`)}) (literal ${q(log)}))` : ''}
`;
  const run = async (args: string[]): Promise<string> => {
    signal?.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', sandbox, executable, '--no-pager', '--no-replace-objects',
        `--git-dir=${metadata}`, `--work-tree=${path}`, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
        '-c', 'core.attributesFile=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'core.untrackedCache=false', ...args], {
        cwd:path, detached:true, stdio:['ignore','pipe','pipe'],
        env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
          GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',
          GIT_AUTHOR_NAME:'Operatus',GIT_AUTHOR_EMAIL:'agent@operatus.invalid',
          GIT_COMMITTER_NAME:'Operatus',GIT_COMMITTER_EMAIL:'agent@operatus.invalid'}
      });
      const output: Buffer[] = [];
      let bytes = 0, failure: Error | undefined;
      const stop = (error: Error) => {
        failure ??= error;
        if (child.pid && child.pid > 1) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
        }
      };
      const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error('candidate Git operation aborted'));
      const timer = setTimeout(() => stop(new GauntletInvariantError('offline candidate Git operation timed out; work is retained')), 15000);
      signal?.addEventListener('abort', abort, {once:true});
      if (signal?.aborted) abort();
      const collect = (chunk: Buffer, keep: boolean) => {
        bytes += chunk.length;
        if (bytes > 1024*1024) { stop(new GauntletInvariantError('offline candidate Git output exceeded limit; work is retained')); return; }
        if (keep) output.push(chunk);
      };
      child.stdout.on('data', chunk => collect(chunk, true));
      child.stderr.on('data', chunk => collect(chunk, false));
      const failed = () => stop(new GauntletInvariantError('offline candidate Git operation failed; work is retained'));
      child.on('error', failed);child.stdout.on('error', failed);child.stderr.on('error', failed);
      // Wait for actual process AND stdio close, even on cancellation. Returning
      // on AbortError alone could let preservation detach a still-writing Git.
      child.once('close', code => {
        clearTimeout(timer);signal?.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code !== 0) reject(new GauntletInvariantError('offline candidate Git operation failed; work is retained'));
        else resolve(Buffer.concat(output).toString('utf8').trim());
      });
    });
  };
  if (await run(['symbolic-ref','--quiet','--short','HEAD']) !== workspace.branch) throw new GauntletInvariantError('candidate is not on its assigned branch');
  return run;
}

export async function inspectCommittedCandidate(workspace: GauntletWorkspace, signal?: AbortSignal): Promise<{sha:string;diffSummary:string}> {
  const run = await candidateGit(workspace, false, signal);
  const sha = await run(['rev-parse','--verify','HEAD^{commit}']);assertFullSha(sha,'candidate');
  if (sha === workspace.expectedSha) throw new GauntletInvariantError('candidate has no new commit');
  await run(['merge-base','--is-ancestor',workspace.expectedSha,sha]);
  if (await run(['status','--porcelain=v1','--untracked-files=all'])) throw new GauntletInvariantError('candidate worktree is not clean');
  return {sha,diffSummary:await run(['diff','--no-ext-diff','--no-textconv','--stat',workspace.expectedSha,sha,'--'])};
}

export async function commitCandidate(workspace: GauntletWorkspace, message: string, signal?: AbortSignal): Promise<string> {
  if (typeof message !== 'string' || !message.trim() || message.length > 2000 || /[\u0000-\u001f\u007f]/.test(message)) {
    throw new GauntletInvariantError('commit message must be a bounded single line');
  }
  const run = await candidateGit(workspace, true, signal);
  if (await run(['rev-parse','--verify','HEAD^{commit}']) !== workspace.expectedSha) throw new GauntletInvariantError('candidate HEAD changed before commit');
  await run(['add','--all','--','.']);
  const tree = await run(['write-tree']);assertFullSha(tree,'candidate tree');
  if (tree === await run(['rev-parse',`${workspace.expectedSha}^{tree}`])) throw new GauntletInvariantError('candidate contains no changes');
  const sha = await run(['commit-tree',tree,'-p',workspace.expectedSha,'-m',message]);assertFullSha(sha,'new candidate');
  // Compare-and-swap only the assigned attempt ref. No HEAD rewrite, merge,
  // reset, push, signing, reference hook or arbitrary Git command surface.
  await run(['update-ref',`refs/heads/${workspace.branch}`,sha,workspace.expectedSha]);
  if ((await inspectCommittedCandidate(workspace, signal)).sha !== sha) throw new GauntletInvariantError('candidate changed after commit');
  return sha;
}
