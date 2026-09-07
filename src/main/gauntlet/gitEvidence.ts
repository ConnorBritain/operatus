import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertFullSha, GauntletInvariantError } from './core';

export interface GitReviewEvidence {
  directory: string;
  baseSha: string;
  artifactSha: string;
  contractDigest: string;
  patchSha256: string;
}

export function resolveGitMetadata(repositoryPath: string): { metadata: string; common: string } {
  const repository = realpathSync(repositoryPath);
  let metadata = join(repository, '.git');
  const pointer = (path: string): string => {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > 4096) throw new GauntletInvariantError('invalid Git metadata pointer');
    return readFileSync(path, 'utf8').trim();
  };
  if (!lstatSync(metadata).isDirectory()) {
    const value = pointer(metadata);
    if (!value.startsWith('gitdir: ')) throw new GauntletInvariantError('invalid Git directory pointer');
    metadata = resolve(repository, value.slice(8));
  }
  metadata = realpathSync(metadata);
  const common = existsSync(join(metadata, 'commondir'))
    ? realpathSync(resolve(metadata, pointer(join(metadata, 'commondir')))) : metadata;
  return { metadata, common };
}

/** A worker's claim of having read evidence is not an integrity check. */
export function validateGitReviewEvidence(receipt: GitReviewEvidence): void {
  const read = (name: string, limit: number): Buffer => {
    const fd = openSync(join(receipt.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > limit) throw new Error('invalid evidence file');
      const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
      let size = 0;
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, null);
        if (!count) break;
        size += count;
      }
      if (size !== stat.size) throw new Error('evidence changed during read');
      return bytes.subarray(0, size);
    } finally { closeSync(fd); }
  };
  try {
    if (realpathSync(receipt.directory) !== receipt.directory) throw new Error('redirected evidence');
    const patch = read('changes.patch', 8 * 1024 * 1024);
    if (createHash('sha256').update(patch).digest('hex') !== receipt.patchSha256) throw new Error('changed diff');
    const manifest = JSON.parse(read('manifest.json', 8192).toString());
    if (manifest.schema !== 1 || manifest.truncated !== false || manifest.patchBytes !== patch.length ||
      manifest.boundary !== 'macos-git-review-offline-v1' || manifest.network !== 'denied' || manifest.externalHelpers !== 'denied' ||
      Object.entries(receipt).some(([key, value]) => manifest[key] !== value)) throw new Error('changed manifest');
  } catch { throw new GauntletInvariantError('Git review evidence is missing, redirected or changed'); }
}

/** Only the trusted main process calls this. Never expose repository metadata
 * to a provider just to let it run Git. No shell, inherited config/environment,
 * external diff/textconv, network, writable repository or external executables.
 * This initial adapter requires Apple's installed Mac command-line tools.
 */
export function captureGitReviewEvidence(input: {
  repository: string; destinationRoot: string; baseSha: string; artifactSha: string; contractDigest: string;
  maxPatchBytes?: number;
}): GitReviewEvidence {
  assertFullSha(input.baseSha, 'review base');
  assertFullSha(input.artifactSha, 'review artifact');
  if (!/^[a-f0-9]{64}$/.test(input.contractDigest)) throw new GauntletInvariantError('invalid review contract digest');
  const maxPatchBytes = input.maxPatchBytes ?? 8 * 1024 * 1024;
  if (!Number.isInteger(maxPatchBytes) || maxPatchBytes < 64 || maxPatchBytes > 8 * 1024 * 1024) throw new GauntletInvariantError('invalid Git review size limit');
  const executable = '/Library/Developer/CommandLineTools/usr/bin/git';
  if (process.platform !== 'darwin' || !existsSync(executable)) throw new GauntletInvariantError('offline Git review adapter unavailable');
  const { metadata, common } = resolveGitMetadata(input.repository);
  const q = (path: string): string => {
    if (/[\u0000-\u001f\u007f]/.test(path)) throw new GauntletInvariantError('invalid Git review path');
    return JSON.stringify(path);
  };
  const sandbox = `(version 1)
(deny default)
(allow process-exec (literal ${q(executable)}))
(allow process-fork)
(allow sysctl-read file-read-metadata)
(allow file-read* (literal "/") (subpath "/System/Library") (subpath "/System/Cryptexes")
  (subpath "/usr/lib") (subpath "/private/var/db/dyld")
  (subpath "/Library/Developer/CommandLineTools")
  (literal "/dev/null") (literal "/dev/urandom")
  (subpath ${q(metadata)}) (subpath ${q(common)}))
(allow file-write* (literal "/dev/null"))
`;
  const run = (args: string[]): Buffer => {
    try {
      return execFileSync('/usr/bin/sandbox-exec', ['-p', sandbox, executable,
        '--no-pager', '--no-replace-objects', `--git-dir=${metadata}`,
        '-c', 'core.bare=true', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
        '-c', 'core.attributesFile=/dev/null', '-c', 'diff.submodule=short', ...args], {
        cwd: '/', timeout: 15000, maxBuffer: maxPatchBytes, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH:'/usr/bin:/bin', HOME:'/nonexistent', LANG:'C', LC_ALL:'C',
          GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null', GIT_OPTIONAL_LOCKS:'0',
          GIT_TERMINAL_PROMPT:'0', GIT_NO_LAZY_FETCH:'1' }
      });
    } catch { throw new GauntletInvariantError('offline Git review failed or exceeded its evidence limit'); }
  };
  for (const sha of [input.baseSha, input.artifactSha]) {
    if (run(['cat-file', '-t', sha]).toString().trim() !== 'commit') throw new GauntletInvariantError('review identity is not a commit');
  }
  const patch = run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames',
    '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/', input.baseSha, input.artifactSha, '--']);
  mkdirSync(input.destinationRoot, { recursive:true, mode:0o700 });
  const directory = realpathSync(mkdtempSync(join(realpathSync(input.destinationRoot), 'review-')));
  const receipt: GitReviewEvidence = {
    directory, baseSha:input.baseSha, artifactSha:input.artifactSha, contractDigest:input.contractDigest,
    patchSha256:createHash('sha256').update(patch).digest('hex')
  };
  writeFileSync(join(directory, 'changes.patch'), patch, { flag:'wx', mode:0o400 });
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    schema:1, ...receipt, patchBytes:patch.length, boundary:'macos-git-review-offline-v1',
    truncated:false, network:'denied', externalHelpers:'denied'
  }, null, 2), { flag:'wx', mode:0o400 });
  return receipt;
}
