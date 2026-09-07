import type { GauntletRole, GauntletRun, GauntletRunSnapshot } from '@shared/gauntlet';
import { isTerminalRun, needsOperator, orderRuns } from './runViewState';
import { olderProjection, projectionRevision, type ProjectionRevision } from './projectionRevision';

export interface OfficeActor {
  id: string; runId: string; role: GauntletRole; provider: string;
  label: string; observedAt: number; mode: 'observed' | 'waiting' | 'unknown' | 'draining';
}
export interface OfficeRun { run: GauntletRun; actors: OfficeActor[] }

/** A view of recorded evidence only. Never register these actors in the PTY roster. */
export function projectOfficeRun(snapshot: GauntletRunSnapshot): OfficeRun {
  const { run } = snapshot;
  const actors = snapshot.launches.flatMap(launch => {
    if (launch.runId !== run.id) return [];
    const own = (snapshot.runtimeObservations ?? []).filter(row => row.runId === run.id &&
      row.launchId === launch.id && row.sessionId === launch.sessionId).sort((a, b) => a.sequence - b.sequence);
    if (!own.some(row => row.event.type === 'process_started')) return [];
    const exit = own.find(row => row.event.type === 'process_exited');
    if (exit?.event.type === 'process_exited' && exit.event.processExited) return [];
    const unknown = !!exit || own.some(row => row.event.type === 'recovery_interrupted');
    const queued = own.filter(row => row.event.type === 'delivery_queued').at(-1);
    const messageId = queued?.event.type === 'delivery_queued' ? queued.event.messageId : null;
    const turnDone = messageId && own.some(row =>
      row.event.type === 'delivery_completed' && row.event.messageId === messageId);
    const waiting = launch.role === 'conductor' && (!queued || turnDone);
    const mode: OfficeActor['mode'] = unknown ? 'unknown' : isTerminalRun(run) ||
      ['completed', 'failed', 'cancelled', 'timed_out'].includes(launch.status) ? 'draining' : waiting ? 'waiting' : 'observed';
    const activity = own.filter(row => row.event.type === 'tool_activity').at(-1)?.event;
    const label = mode === 'unknown' ? 'Exit unknown' : mode === 'draining' ? 'Awaiting exit receipt' :
      mode === 'waiting' ? 'Awaiting lead turn' : activity?.type === 'tool_activity' ?
        `${activity.activity} ${activity.stage}${activity.outcome === 'error' ? ' · error' : ''}` : 'Start recorded';
    return [{ id: launch.id, runId: run.id, role: launch.role, provider: launch.provider, mode, label,
      observedAt: own.at(-1)!.at }];
  });
  return { run, actors };
}

export function officeRuns(snapshots: Map<string, GauntletRunSnapshot>): OfficeRun[] {
  return orderRuns([...snapshots.values()].map(s => s.run)).map(run => projectOfficeRun(snapshots.get(run.id)!))
    .filter(row => !isTerminalRun(row.run) || needsOperator(row.run) || row.actors.some(actor => actor.mode !== 'unknown'));
}

/** Subscribe before reading, and reject any read overtaken by a push, including
 * equal-version receipt changes. A single feed serves floor and accessible list. */
export function connectOfficeRuns(api: {
  gauntletList(): Promise<GauntletRun[]>;
  gauntletGet(id: string): Promise<GauntletRunSnapshot>;
  onGauntletChanged(callback: (snapshot: GauntletRunSnapshot) => void): () => void;
}, emit: (state: { rows: OfficeRun[]; loading: boolean; error: string | null }) => void): () => void {
  const snapshots = new Map<string, GauntletRunSnapshot>();
  const watermarks = new Map<string, ProjectionRevision>();
  const revisions = new Map<string, number>();
  let alive = true, loading = true, error: string | null = null;
  const publish = () => { if (alive) emit({ rows: officeRuns(snapshots), loading, error }); };
  const accept = (snapshot: GauntletRunSnapshot) => {
    const previous = watermarks.get(snapshot.run.id);
    const revision = projectionRevision(snapshot.run);
    if (previous && olderProjection(revision,previous)) return;
    watermarks.set(snapshot.run.id, revision);
    snapshots.set(snapshot.run.id, snapshot);
    // Keep open/attention runs without a cap, but don't accumulate closed history.
    for (const [id, item] of snapshots) {
      if (isTerminalRun(item.run) && !needsOperator(item.run) && !projectOfficeRun(item).actors.some(actor => actor.mode !== 'unknown')) snapshots.delete(id);
    }
  };
  const off = api.onGauntletChanged(snapshot => {
    if (!alive) return;
    revisions.set(snapshot.run.id, (revisions.get(snapshot.run.id) ?? 0) + 1);
    accept(snapshot); publish();
  });
  void (async () => {
    try {
      const runs = await api.gauntletList();
      if (!alive) return;
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, runs.length) }, async () => {
        while (alive && cursor < runs.length) {
          const run = runs[cursor++];
          // A push already has a full snapshot; don't overwrite it with an older list/read.
          if (revisions.has(run.id)) continue;
          const revision = revisions.get(run.id) ?? 0;
          try {
            const snapshot = await api.gauntletGet(run.id);
            if (alive && (revisions.get(run.id) ?? 0) === revision) {
              if (snapshot.run.id !== run.id) throw Error('Run identity mismatch');
              accept(snapshot); publish();
            }
          } catch { if (alive) error = 'Some run activity could not be loaded. Open Runs to inspect or refresh.'; }
        }
      }));
    } catch { if (alive) error = 'Run activity unavailable. Open Runs to inspect or refresh.'; }
    finally { loading = false; publish(); }
  })();
  return () => { alive = false; off(); };
}
