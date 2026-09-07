import { execFile } from 'node:child_process';
import { mkdtemp, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderVersionObservation, SubscriptionProvider } from '../shared/subscriptionPreflight';
import { copyPinnedNativeExecutable, ExecutableIdentityError } from './executableIdentity';
import { prepareCheckSandbox } from './gauntlet/checkSandbox';

export function parseProviderVersion(provider: SubscriptionProvider, output: string): string | undefined {
  const pattern = provider === 'claude'
    ? /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/
    : /^codex-cli (\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/;
  return output.match(pattern)?.[1];
}

/** A fixed --version probe, never an agent launch or auth check. Only native
 * macOS binaries: scripts need a separately pinned interpreter/dependency tree.
 * Execute a private copy matching the inspected digest, not a mutable PATH or
 * symlink target. Deny network and personal-profile reads with the existing
 * offline boundary. Never loosen that boundary on failure or return raw output.
 */
export async function inspectNativeProviderVersion(provider: SubscriptionProvider, path: string, sha256: string,
  platform = process.platform): Promise<ProviderVersionObservation> {
  if (platform !== 'darwin') return { status: 'unsupported-platform' };
  if (!/^[a-f0-9]{64}$/.test(sha256)) return { status: 'unavailable' };
  let copy: string | undefined;
  try {
    const cwd = await mkdtemp(join(tmpdir(), 'operatus-version-'));
    const boundary = prepareCheckSandbox(cwd);
    copy = join(boundary.scratch, 'provider');
    await copyPinnedNativeExecutable(path, copy, sha256);
    const output = await new Promise<string>((resolve, reject) => {
      execFile(boundary.command, ['-p', boundary.args('')[1], copy!, '--version'], {
        cwd, env: boundary.env, timeout: 5000, maxBuffer: 8192, encoding: 'utf8', killSignal: 'SIGKILL'
      }, (error, stdout) => error ? reject(new Error('version probe failed')) : resolve(stdout));
    });
    const version = parseProviderVersion(provider, output);
    return version ? { status: 'reported', version } : { status: 'unavailable' };
  } catch (error) { return { status: error instanceof ExecutableIdentityError ? error.status : 'unavailable' }; }
  finally {
    // Only the exact private copy created here. Keep the small scratch boundary
    // for diagnosis, but do not accumulate hundreds of MB per Settings refresh.
    if (copy) await unlink(copy).catch(() => {});
  }
}
