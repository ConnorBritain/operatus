import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GauntletInvariantError } from './core';
import { createHash } from 'node:crypto';

/** Offline check execution, not provider-session isolation. No unrestricted
 * fallback: a platform without this boundary must not run frozen shell checks.
 * Scratch is retained for diagnosis; never delete a caller-supplied directory.
 */
export function prepareCheckSandbox(worktree: string, platform = process.platform) {
  if (platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
    throw new GauntletInvariantError('enforced frozen-check sandbox is unavailable on this platform');
  }
  const cwd = realpathSync(worktree);
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'operatus-check-')));
  const home = join(scratch, 'home');
  mkdirSync(home, { mode: 0o700 });
  const bin = join(scratch, 'bin');
  mkdirSync(bin, { mode: 0o700 });
  // Reuse the host's known Node/Electron runtime, never discover `node` through
  // the user's shell or mutable PATH. Electron's bundled frameworks are needed
  // when ELECTRON_RUN_AS_NODE is used in the desktop app.
  const runtime = realpathSync(process.execPath);
  const bundleEnd = runtime.indexOf('.app/Contents/');
  const runtimeBundle = bundleEnd >= 0 ? runtime.slice(0, bundleEnd + 4) : null;
  symlinkSync(runtime, join(bin, 'node'));
  const quote = (value: string): string => {
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new GauntletInvariantError('unsupported control character in check path');
    return JSON.stringify(value);
  };
  const profile = `(version 1)
(deny default)
(allow process-exec process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System/Library") (subpath "/System/Cryptexes")
  (subpath "/usr/lib") (subpath "/usr/bin") (subpath "/usr/share/locale") (subpath "/usr/share/icu") (subpath "/bin") (subpath "/sbin")
  (subpath "/private/var/db/dyld")
  (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")
  (${runtimeBundle ? 'subpath' : 'literal'} ${quote(runtimeBundle ?? runtime)})
  (subpath ${quote(cwd)}) (subpath ${quote(scratch)}))
(allow file-write* (subpath ${quote(cwd)}) (subpath ${quote(scratch)}) (literal "/dev/null"))
`;
  return {
    cwd, scratch,
    receipt: { boundary: 'macos-seatbelt-offline-v1' as const, cwd, scratch,
      profileSha256: createHash('sha256').update(profile).digest('hex'), network: 'denied' as const },
    command: '/usr/bin/sandbox-exec',
    args: (command: string) => ['-p', profile, '/bin/bash', '--noprofile', '--norc', '-c', command],
    // Deliberate allowlist. No user shell setup, proxy, keys, inherited CLI home,
    // node injection, git config overrides, or model-provider variables.
    env: {
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: `${scratch}/`,
      LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
      ELECTRON_RUN_AS_NODE: '1',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0'
    }
  };
}
