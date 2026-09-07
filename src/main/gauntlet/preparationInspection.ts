import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { PreparationInspection, WorkspacePreparation } from '../../shared/gauntlet';

const execute = promisify(execFile);
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

// Inspect each ancestor, including a dangling symlink, without traversing it.
async function directory(path: string): Promise<'present'|'missing'|'redirected'|'unavailable'> {
  if (!isAbsolute(path) || resolve(path) !== path || /[\u0000-\u001f\u007f]/.test(path)) return 'unavailable';
  let current: string = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    current = join(current,part);
    let stat;
    try { stat = await lstat(current); } catch(error) { return missing(error) ? 'missing' : 'unavailable'; }
    if (stat.isSymbolicLink()) return 'redirected';
    if (!stat.isDirectory()) return 'unavailable';
  }
  return 'present';
}

async function pointer(path: string): Promise<string> {
  if (await directory(dirname(path)) !== 'present') throw Error('unsafe pointer parent');
  const file = await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 4096) throw Error('invalid pointer');
    const bytes = Buffer.alloc(4097), {bytesRead} = await file.read(bytes,0,bytes.length,0);
    const after = await file.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.ctimeMs !== before.ctimeMs || after.mtimeMs !== before.mtimeMs) throw Error('changed pointer');
    return bytes.subarray(0,bytesRead).toString('utf8').trim();
  } finally { await file.close(); }
}

async function metadata(repository: string): Promise<{metadata:string;common:string}> {
  if (await directory(repository) !== 'present') throw Error('unsafe repository');
  let path = join(repository,'.git');
  if (!(await lstat(path)).isDirectory()) {
    const value = await pointer(path);
    if (!value.startsWith('gitdir: ')) throw Error('invalid Git pointer');
    path = resolve(repository,value.slice(8));
  }
  if (await directory(path) !== 'present') throw Error('unsafe Git directory');
  let common = path;
  try { common = resolve(path,await pointer(join(path,'commondir'))); }
  catch(error) { if (!missing(error)) throw error; }
  if (await directory(common) !== 'present') throw Error('unsafe common directory');
  return {metadata:path,common};
}

/** No mutation, adoption, branch detachment, provider launch or artifact judgment.
 * Git executes offline with no write capability or external helper execution.
 * Results can become stale immediately; they never authorize cleanup or retry.
 */
export async function inspectPreparation(preparation: WorkspacePreparation): Promise<PreparationInspection> {
  const result: PreparationInspection = {runId:preparation.runId,launchId:preparation.launchId,
    observedAt:Date.now(),state:'unavailable',observedSha:null,observedBranch:null,dirty:null,
    evidenceDirectory:preparation.reviewEvidencePath ? await directory(preparation.reviewEvidencePath) : 'not_applicable'};
  const status = await directory(preparation.worktreePath);
  if (status !== 'present') return {...result,state:status};
  if (process.platform !== 'darwin') return result;
  try {
    const primary = await metadata(preparation.repository);
    // Validate the worktree pointer's target before reading any target metadata.
    const value = await pointer(join(preparation.worktreePath,'.git'));
    if (!value.startsWith('gitdir: ')) return result;
    const worktreeMetadata = resolve(preparation.worktreePath,value.slice(8));
    const entry = relative(join(primary.common,'worktrees'),worktreeMetadata);
    if (!entry || entry.startsWith('..') || isAbsolute(entry) || entry.includes(sep)) return {...result,state:'foreign_repository'};
    if (await directory(worktreeMetadata) !== 'present') return {...result,state:'redirected'};
    const common = resolve(worktreeMetadata,await pointer(join(worktreeMetadata,'commondir')));
    const backlink = resolve(worktreeMetadata,await pointer(join(worktreeMetadata,'gitdir')));
    if (common !== primary.common || backlink !== join(preparation.worktreePath,'.git')) return {...result,state:'foreign_repository'};
    const executable = '/Library/Developer/CommandLineTools/usr/bin/git';
    const q = (path: string): string => {
      if (/[\u0000-\u001f\u007f]/.test(path)) throw Error('unsafe path');
      return JSON.stringify(path);
    };
    const sandbox = `(version 1)(deny default)
      (allow process-exec (literal ${q(executable)}))
      (allow sysctl-read file-read-metadata)
      (allow file-read* (literal "/") (subpath "/System/Library") (subpath "/System/Cryptexes")
        (subpath "/usr/lib") (subpath "/private/var/db/dyld") (subpath "/Library/Developer/CommandLineTools")
        (literal "/dev/null") (literal "/dev/urandom")
        (subpath ${q(primary.common)}) (subpath ${q(preparation.worktreePath)}))
      (allow file-write* (literal "/dev/null"))`;
    const git = async (args: string[]): Promise<string> => (await execute('/usr/bin/sandbox-exec',[
      '-p',sandbox,executable,'--no-pager','--no-replace-objects',`--git-dir=${worktreeMetadata}`,
      `--work-tree=${preparation.worktreePath}`,'-c','core.bare=false','-c','core.fsmonitor=false',
      '-c','core.hooksPath=/dev/null','-c','core.attributesFile=/dev/null',...args
    ],{cwd:'/',timeout:5000,maxBuffer:512*1024,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C',LC_ALL:'C',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();
    const sha = await git(['rev-parse','--verify','HEAD^{commit}']);
    if (!/^[a-f0-9]{40}$/.test(sha)) return result;
    const branch = await git(['rev-parse','--abbrev-ref','HEAD']);
    const dirty = !!await git(['status','--porcelain=v1','--untracked-files=all','--ignore-submodules=all']);
    // Repeat the path/pointer checks after Git before showing the diagnostic.
    if (await directory(preparation.worktreePath) !== 'present' ||
      await pointer(join(preparation.worktreePath,'.git')) !== value ||
      await git(['rev-parse','--verify','HEAD^{commit}']) !== sha) return result;
    return {...result,observedAt:Date.now(),observedSha:sha,observedBranch:branch === 'HEAD' ? null : branch,dirty,
      state:sha === preparation.expectedSha && (branch === 'HEAD' ? null : branch) === preparation.candidateBranch && !dirty ? 'matching' : 'changed'};
  } catch { return result; }
}

export function preparationInspector(services: {
  localWindow(): { mainFrame: unknown } | null;
  pending(runId: string): WorkspacePreparation[];
}) {
  const active = new Set<string>();
  return async (event: {sender:unknown;senderFrame:unknown},runId:unknown,launchId:unknown): Promise<PreparationInspection> => {
    const local = services.localWindow();
    if (!local || event.sender !== local || event.senderFrame !== local.mainFrame) throw Error('Preparation inspection requires the local desktop');
    if (typeof runId !== 'string' || typeof launchId !== 'string' || runId.length > 100 || launchId.length > 100) throw Error('Invalid preparation identity');
    const preparation = services.pending(runId).find(item=>item.launchId === launchId && item.runId === runId);
    if (!preparation) throw Error('No pending preparation with that identity');
    if (active.size >= 2 || active.has(launchId)) throw Error('Preparation inspection is already busy');
    active.add(launchId);
    try { return await inspectPreparation(preparation); } finally { active.delete(launchId); }
  };
}
