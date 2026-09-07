import { createHash, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { LocalGauntletBackend, PreparedLaunch } from './localBackend';
import { isGauntletWorker } from '../../shared/agentLifecycle';
import { expandTilde } from '../fs';

export interface SpawnIdentity {
  id: string;
  cwd: string;
  provider?: string;
  resume?: boolean;
  requireResume?: boolean;
  resumeSessionId?: string;
  hive?: { id: string; role?: string; lifecycleOwner?: 'gauntlet'; cwd: string };
}

function canonical(path: string): string {
  let parent = resolve(expandTilde(path));
  const missing: string[] = [];
  for (;;) {
    try { return join(realpathSync(parent), ...missing.reverse()); } catch {
      const next = dirname(parent);
      if (next === parent) return resolve(expandTilde(path));
      missing.push(basename(parent));
      parent = next;
    }
  }
}

/** Lifecycle admission only, NOT billing or OS isolation. `prepared` must be
 * supplied as a separate main-process argument, never read from IPC payloads.
 * Claims survive a failed spawn: only the protocol may prepare a fresh retry.
 */
export class GauntletSpawnOwnership {
  private readonly claimed = new Map<string, 'preparing' | 'spawned'>();

  constructor(private readonly getBackend: () => LocalGauntletBackend | null, private readonly worktreeRoot: string) {}

  check(opts: SpawnIdentity, prepared?: PreparedLaunch): string | null {
    return this.validate(opts, prepared, false);
  }

  /** Call immediately before synchronous process creation, after every await.
   * A preparation claim is not authority to launch after cancellation/recovery.
   * Failed process creation consumes the claim too; retries require a new launch.
   * This validates protocol identity, not provider flags or billing admission.
   */
  beforeSpawn(opts: SpawnIdentity, prepared?: PreparedLaunch): string | null {
    return this.validate(opts, prepared, true);
  }

  private validate(opts: SpawnIdentity, prepared: PreparedLaunch | undefined, final: boolean): string | null {
    try {
      const backend = this.getBackend();
      if (!backend) return 'Run authority is unavailable; agent startup cannot establish lifecycle ownership.';
      if (prepared) {
        const saved = backend.store.findLaunch(prepared.launch.id);
        if (!saved) return 'Unknown Gauntlet launch.';
        const run = backend.status(saved.runId).run;
        const expectedPhase = saved.role === 'implementer' ? 'implementer_in_flight'
          : saved.role === 'critic' ? 'critic_in_flight' : 'repair_in_flight';
        const tokenHash = createHash('sha256').update(prepared.token).digest();
        const storedHash = Buffer.from(saved.tokenHash, 'hex');
        const packet = prepared.launch;
        const claim = this.claimed.get(saved.id);
        if (storedHash.length !== tokenHash.length || !timingSafeEqual(storedHash, tokenHash) ||
          packet.runId !== saved.runId || packet.sessionId !== saved.sessionId || packet.role !== saved.role ||
          packet.provider !== saved.provider || packet.model !== saved.model || packet.expectedSha !== saved.expectedSha ||
          packet.candidateBranch !== saved.candidateBranch || canonical(packet.worktreePath) !== canonical(saved.worktreePath) ||
          run.currentLaunchId !== saved.id || run.status !== expectedPhase || saved.status !== 'running' ||
          opts.id !== saved.id || opts.hive?.id !== saved.id || opts.provider !== saved.provider ||
          canonical(opts.cwd) !== canonical(saved.worktreePath) || canonical(opts.hive.cwd) !== canonical(saved.worktreePath) ||
          opts.resume || opts.requireResume || opts.resumeSessionId || (final ? claim !== 'preparing' : claim !== undefined)) {
          return 'Gauntlet launch is stale, mismatched, resumed, or already claimed.';
        }
        this.claimed.set(saved.id, final ? 'spawned' : 'preparing');
        return null;
      }
      // Cover both the renderer's pty-<agentId> convention and main's bare id,
      // including old/terminal launches outside the latest UI page of runs.
      const ids = [opts.id, opts.hive?.id].filter((id): id is string => typeof id === 'string');
      if (ids.some(id => backend.store.findLaunch(id) ||
        (id.startsWith('pty-') && backend.store.findLaunch(id.slice(4))))) {
        return 'Gauntlet workers cannot be restored or restarted as ordinary agents. Use the run lifecycle.';
      }
      const root = canonical(this.worktreeRoot);
      const paths = [opts.cwd, opts.hive?.cwd].filter((path): path is string => typeof path === 'string');
      const managedPath = paths.some(path => {
        const rel = relative(root, canonical(path));
        return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
      });
      if (managedPath || isGauntletWorker(opts.hive ?? {})) {
        return 'Gauntlet workspaces require a fresh run-owned launch; ordinary agent startup is denied.';
      }
      return null;
    } catch {
      return 'Run authority could not validate agent lifecycle ownership; startup denied.';
    }
  }
}
