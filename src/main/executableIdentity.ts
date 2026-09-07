import { createHash } from 'node:crypto';
import { closeSync, constants, createReadStream, createWriteStream, fstatSync, openSync, readSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';

export class ExecutableIdentityError extends Error {
  constructor(readonly status: 'unsupported-entrypoint' | 'identity-changed' | 'unavailable') { super(status); }
}

/** Copy from one open native-Mac file descriptor into an exclusively created
 * private destination. Callers own the destination directory and its cleanup.
 */
export async function copyPinnedNativeExecutable(source: string, destination: string, expectedSha256: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new ExecutableIdentityError('unavailable');
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let input: ReturnType<typeof createReadStream> | undefined;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new ExecutableIdentityError('unavailable');
    const magic = Buffer.alloc(4);
    if (readSync(fd, magic, 0, 4, 0) !== 4 ||
      !['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic.toString('hex'))) {
      throw new ExecutableIdentityError('unsupported-entrypoint');
    }
    let copiedBytes = 0;
    input = createReadStream(source, { fd, start: 0, autoClose: true });
    await pipeline(input, new Transform({
      transform(chunk, _encoding, callback) {
        copiedBytes += chunk.length;
        callback(copiedBytes > 512 * 1024 * 1024 ? new Error('executable grew during copy') : null, chunk);
      }
    }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    if (await hashExecutable(destination) !== expectedSha256) throw new ExecutableIdentityError('identity-changed');
    await chmod(destination, 0o500);
  } finally {
    // Once transferred, the stream owns the descriptor even on pipeline error.
    // Closing it again can mask ENOSPC/EEXIST or close a reused descriptor.
    if (input) { input.destroy(); await finished(input, { cleanup: true }).catch(() => {}); }
    else closeSync(fd);
  }
}

/** Identity of bounded regular-file bytes, not publisher trust or launch authority. */
export async function hashExecutable(path: string): Promise<string> {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let input: ReturnType<typeof createReadStream> | undefined;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('unsupported executable');
    const hash = createHash('sha256');
    let size = 0;
    input = createReadStream(path, { fd, autoClose: true, highWaterMark: 1024 * 1024 });
    for await (const chunk of input) {
      size += chunk.length;
      if (size > 512 * 1024 * 1024) throw new Error('executable changed during inspection');
      hash.update(chunk);
    }
    return hash.digest('hex');
  } finally {
    if (input) { input.destroy(); await finished(input, { cleanup: true }).catch(() => {}); }
    else closeSync(fd);
  }
}
