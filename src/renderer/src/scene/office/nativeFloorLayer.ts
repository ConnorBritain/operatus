import type { OfficeActor } from '../../gauntlet/officeProjection';
import type { Character } from './Character';

type FloorCharacter = Pick<Character, 'sitAtDesk' | 'showThought' | 'setStatusGlyph' | 'setBubbleZoom' |
  'update' | 'destroy' | 'getThoughtLayout' | 'setThoughtLift'>;
export interface NativeFloorCount { seated: number; pending: number; unseated: number }

/** Independent, non-persisted scene layer. Shares seat leases, not Agent/PTY
 * identities or mailbox/ambient automation. Late texture loads cannot revive exits. */
export function nativeFloorLayer(options: {
  claimSeat(): number | null; releaseSeat(seat: number): void;
  create(actor: OfficeActor, seat: number): Promise<FloorCharacter>;
  count(value: NativeFloorCount): void;
}) {
  type Entry = { actor: OfficeActor; seat: number; character?: FloorCharacter; release(): void; mode?: string; label?: string };
  const entries = new Map<string, Entry>();
  let desired: OfficeActor[] = [], disposed = false;
  const publish = () => { if (!disposed) options.count({
    seated: [...entries.values()].filter(entry => !!entry.character).length,
    pending: [...entries.values()].filter(entry => !entry.character).length,
    unseated: desired.filter(actor => !entries.has(actor.id)).length
  }); };
  const apply = (entry: Entry) => {
    const c = entry.character;
    if (!c) return;
    // Never loop an old activity as proof of ongoing work. No wandering, typing,
    // errands, success celebrations, or simulated cross-agent handoffs.
    if (entry.mode !== entry.actor.mode) {
      c.sitAtDesk(false);
      c.setStatusGlyph(entry.actor.mode === 'unknown' ? 'blocked' : 'none');
      entry.mode = entry.actor.mode;
    }
    const label = `${entry.actor.role} · ${entry.actor.runId.slice(0, 6)}\n${entry.actor.label}`;
    if (entry.label !== label) { c.showThought(label); entry.label = label; }
  };
  const remove = (id: string, entry: Entry) => {
    entries.delete(id); entry.character?.destroy(); entry.release();
  };
  const sync = (actors: OfficeActor[]) => {
    if (disposed) return;
    desired = actors;
    const ids = new Set(actors.map(actor => actor.id));
    for (const [id, entry] of entries) if (!ids.has(id)) remove(id, entry);
    for (const actor of actors) {
      const existing = entries.get(actor.id);
      if (existing) { existing.actor = actor; apply(existing); continue; }
      const seat = options.claimSeat();
      if (seat === null) continue; // Overflow remains accessible in the run panel.
      let released = false;
      const entry: Entry = { actor, seat, release() {
        if (!released) { released = true; options.releaseSeat(seat); }
      } };
      entries.set(actor.id, entry);
      void options.create(actor, seat).then(character => {
        if (disposed || entries.get(actor.id) !== entry) { character.destroy(); entry.release(); return; }
        entry.character = character; apply(entry); publish();
      }).catch(() => {
        if (entries.get(actor.id) === entry) entries.delete(actor.id);
        entry.character?.destroy();
        entry.release(); publish();
      });
    }
    publish();
  };
  return {
    sync,
    characters: () => [...entries.values()].flatMap(entry => entry.character ? [entry.character] : []),
    update(dt: number, zoom: number) { for (const entry of entries.values()) {
      entry.character?.setBubbleZoom(zoom); entry.character?.update(dt);
    } },
    dispose() { disposed = true; for (const [id, entry] of entries) remove(id, entry); }
  };
}
