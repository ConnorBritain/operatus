import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, writeSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SKILL_MATERIALIZATION_LIMITS = Object.freeze({
  treeBytes: 16 * 1024 * 1024, treeEntries: 2000,
  profileBytes: 64 * 1024 * 1024, profileEntries: 8000, depth: 64
});
export interface SkillTreeBudget { bytes: number; entries: number }
export const newSkillTreeBudget = (): SkillTreeBudget => ({ bytes: 0, entries: 0 });

/** Instruction loading is bounded independently of prior tree inspection, so
 * growth between discovery and parsing cannot become an unbounded readFile. */
export function readSkillInstructions(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > SKILL_MATERIALIZATION_LIMITS.treeBytes) throw Error('skill instructions exceed materialization limit or are not a regular file');
    const chunks: Buffer[] = []; let bytes = 0;
    for (;;) {
      const chunk = Buffer.alloc(64 * 1024), size = readSync(fd, chunk, 0, chunk.length, null); if (!size) break;
      if ((bytes += size) > SKILL_MATERIALIZATION_LIMITS.treeBytes) throw Error('skill instructions grew beyond materialization limit');
      chunks.push(chunk.subarray(0, size));
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally { closeSync(fd); }
}

/** Same canonical digest as the depot's original tree walker. Reads and optional
 * exclusive copies use bounded chunks from regular, no-follow file descriptors.
 * A shared budget covers ALL selected skills, not just one recursive copy. */
export function inspectSkillTree(root: string, budget = newSkillTreeBudget(), copyTo?: string): string {
  const limits = SKILL_MATERIALIZATION_LIMITS, hash = createHash('sha256');
  let treeBytes = 0, treeEntries = 0;
  const buffer = Buffer.alloc(64 * 1024);
  const visit = (dir: string, target: string | undefined, depth: number): void => {
    const parent = lstatSync(dir);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error('symlink or non-directory skill rejected');
    if (depth > limits.depth) throw Error('skill tree nesting exceeds materialization limit');
    if (target) mkdirSync(target, { mode: 0o700 }); // existing directories are never merged
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name), rel = relative(root, path).split(sep).join('/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw Error(`symlink rejected in skill: ${rel}`);
      if (!stat.isDirectory() && !stat.isFile()) throw Error('special file rejected in skill');
      if (++treeEntries > limits.treeEntries) throw Error('skill tree exceeds materialization limit');
      if (++budget.entries > limits.profileEntries) throw Error('assigned skills exceed aggregate profile entry limit');
      hash.update(stat.isDirectory() ? `d:${rel}\0` : `f:${rel}\0`);
      if (stat.isDirectory()) { visit(path, target ? join(target, entry.name) : undefined, depth + 1); continue; }
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let output: number | undefined;
      try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw Error('skill file identity changed during inspection');
        if (opened.size + treeBytes > limits.treeBytes) throw Error('skill tree exceeds materialization limit');
        if (opened.size + budget.bytes > limits.profileBytes) throw Error('assigned skills exceed aggregate profile byte limit');
        if (target) output = openSync(join(target, entry.name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        for (;;) {
          const size = readSync(fd, buffer, 0, buffer.length, null); if (!size) break;
          if ((treeBytes += size) > limits.treeBytes) throw Error('skill grew beyond tree materialization limit');
          if ((budget.bytes += size) > limits.profileBytes) throw Error('skills grew beyond aggregate profile byte limit');
          hash.update(buffer.subarray(0, size));
          if (output !== undefined) {
            let written = 0;
            while (written < size) {
              const n = writeSync(output, buffer, written, size - written);
              if (!n) throw Error('skill copy made no progress');
              written += n;
            }
          }
        }
      } finally { try { if (output !== undefined) closeSync(output); } finally { closeSync(fd); } }
    }
  };
  visit(root, copyTo, 0);
  return hash.digest('hex');
}
