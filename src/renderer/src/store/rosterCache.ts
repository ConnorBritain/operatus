/** A cache is scoped to the home that produced ALL of its slices. Legacy
 * unscoped keys are left untouched: a cache is not evidence of ownership. */
export interface CachedRoster {
  version: 1;
  savedAt: string;
  agents: unknown[];
  archived: unknown[];
  restorable: unknown[];
  queues: Record<string, unknown[]>;
  selectedId: string | null;
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export const rosterCacheKey = (home: string) => `operatus.roster.v1:${encodeURIComponent(home)}`;

export function readRosterCache(storage: Storage, home: string | null): CachedRoster | null {
  if (!home) return null;
  try {
    const raw = storage.getItem(rosterCacheKey(home));
    if (!raw || raw.length > 8 * 1024 * 1024) return null;
    const value = JSON.parse(raw), roster = value?.roster;
    if (value?.version !== 1 || value.home !== home || roster?.version !== 1 ||
      !Array.isArray(roster.agents) || !Array.isArray(roster.archived) || !Array.isArray(roster.restorable) ||
      !roster.queues || typeof roster.queues !== 'object' || Array.isArray(roster.queues)) return null;
    return roster;
  } catch { return null; }
}

export function writeRosterCache(storage: Storage, home: string | null, roster: CachedRoster): boolean {
  if (!home) return false;
  try {
    const existing = storage.getItem(rosterCacheKey(home));
    if (existing !== null && !readRosterCache(storage, home)) return false; // retain malformed/mismatched evidence
    const body = JSON.stringify({ version: 1, home, roster });
    if (body.length > 8 * 1024 * 1024) return false;
    storage.setItem(rosterCacheKey(home), body);
    return true;
  } catch { return false; }
}

export function hasUnassignedRoster(storage: Storage): boolean | 'unreadable' {
  try {
    for (const key of ['cth.agents', 'cth.archivedAgents', 'cth.restorableAgents']) {
      const value = JSON.parse(storage.getItem(key) ?? 'null');
      if (Array.isArray(value) && value.length) return true;
    }
    const queues = JSON.parse(storage.getItem('cth.messageQueues') ?? 'null');
    return !!queues && typeof queues === 'object' && Object.values(queues).some(q => Array.isArray(q) && q.length > 0);
  } catch { return 'unreadable'; } // Unknown is neither empty nor permission to erase.
}
