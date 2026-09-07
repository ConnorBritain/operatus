import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

type CleanupAuthority = {
  findLaunch(id: string): unknown;
  hasLaunchAtWorktree(path: string): boolean;
};

function canonical(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try { return join(realpathSync(current), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** An additional veto for the old desktop cleanup routes, never a grant to
 * delete Gauntlet work. No renderer hints or in-memory worker classification
 * can override persisted launch ownership. Unknown authority keeps work.
 */
export function legacyCleanupError(input: { id: string; path: string; managedRoot: string }, authority: CleanupAuthority | null): string | null {
  try {
    if (!authority) return 'Cleanup held: run ownership is unavailable.';
    if (!isAbsolute(input.path) || !isAbsolute(input.managedRoot)) return 'Cleanup held: absolute paths required.';
    const id = input.id.startsWith('pty-') ? input.id.slice(4) : input.id;
    if (authority.findLaunch(input.id) || authority.findLaunch(id)) return 'Cleanup held: this launch belongs to Gauntlet.';
    const path = canonical(input.path), root = canonical(input.managedRoot);
    const rawPath = resolve(input.path), rawRoot = resolve(input.managedRoot);
    if (within(root, path) || within(path, root) || within(rawRoot, rawPath) || within(rawPath, rawRoot)) {
      return 'Cleanup held: this location overlaps Gauntlet workspaces.';
    }
    if (authority.hasLaunchAtWorktree(path) || authority.hasLaunchAtWorktree(rawPath)) {
      return 'Cleanup held: this worktree is recorded by Gauntlet.';
    }
    return null;
  } catch { return 'Cleanup held: run ownership could not be verified.'; }
}
