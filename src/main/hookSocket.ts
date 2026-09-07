import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** POSIX socket paths are byte-limited (macOS truncates long paths). Scope them
 * to this Hive instance so a crash never requires deleting a prior endpoint. */
export function hookSocketPath(root: string, scope: string, platform = process.platform): string {
  if (platform === 'win32') return `\\\\.\\pipe\\operatus-${createHash('sha1').update(root).digest('hex').slice(0, 12)}`;
  const id = createHash('sha256').update(JSON.stringify([root, scope])).digest('hex').slice(0, 32);
  return `/tmp/operatus-hooks-${process.getuid!()}/${id}.sock`;
}

export function prepareHookSocketDirectory(socket: string): void {
  if (process.platform === 'win32') return;
  const directory = dirname(socket), expected = `/tmp/operatus-hooks-${process.getuid!()}`;
  if (directory !== expected || Buffer.byteLength(socket) > 100) throw Error('Invalid hook socket directory');
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o700) {
    throw Error('Hook socket directory must be private and owned by this user');
  }
}
