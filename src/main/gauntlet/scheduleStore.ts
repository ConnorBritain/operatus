import type Database from 'better-sqlite3';
import type { GauntletCapacity, GauntletDispatch } from '../../shared/gauntletSchedule';

const ACTIVE = "('orienting','awaiting_implementation','implementer_in_flight','awaiting_critic','critic_in_flight','awaiting_lead_ack','needs_repair','repair_in_flight')";
const columns = 'run_id AS runId, sequence, state, enqueued_at AS enqueuedAt, updated_at AS updatedAt, reason';

/** Main-process scheduling authority, using the SAME connection/transactions as
 * the protocol. A reservation is not an assertion that all OS descendants ended. */
export class GauntletScheduleStore {
  constructor(private readonly database: () => Database.Database) {}

  snapshot(): GauntletCapacity {
    const db = this.database();
    return db.transaction(() => ({
      revision: this.revision(),
      maxConcurrentRuns: (db.prepare('SELECT max_runs AS value FROM gauntlet_capacity WHERE id=1').get() as { value: number }).value,
      dispatches: db.prepare(`SELECT ${columns} FROM gauntlet_dispatches WHERE state!='settled' ORDER BY sequence`).all() as GauntletDispatch[]
    }))();
  }

  enqueue(runId: string): void {
    const db = this.database();
    db.transaction(() => {
      const run = db.prepare(`SELECT 1 FROM gauntlet_runs WHERE id=? AND status IN ${ACTIVE}`).get(runId);
      if (!run) return;
      const now = Date.now();
      if (db.prepare("INSERT OR IGNORE INTO gauntlet_dispatches(run_id,state,enqueued_at,updated_at,reason) VALUES(?,'queued',?,?,'Waiting for run capacity')")
        .run(runId, now, now).changes) this.event(runId, 'queued', 'Waiting for run capacity');
    })();
  }

  /** Claim only the first eligible run. Duplicate callbacks never reclaim a
   * running, settled, or quarantined identity. Hold/budget are rechecked by owner. */
  claimNext(owner: string): string | null {
    if (!owner) throw Error('Missing scheduler owner');
    const db = this.database();
    return db.transaction(() => {
      this.settleCancelled();
      const used = (db.prepare("SELECT count(*) AS count FROM gauntlet_dispatches WHERE state IN ('running','quarantined')").get() as { count: number }).count;
      const max = (db.prepare('SELECT max_runs AS value FROM gauntlet_capacity WHERE id=1').get() as { value: number }).value;
      if (used >= max) return null;
      const row = db.prepare("SELECT run_id FROM gauntlet_dispatches WHERE state='queued' ORDER BY sequence LIMIT 1").get() as { run_id: string } | undefined;
      if (!row) return null;
      db.prepare("UPDATE gauntlet_dispatches SET state='running',owner=?,updated_at=?,reason='Native lifecycle reserved' WHERE run_id=? AND state='queued'")
        .run(owner, Date.now(), row.run_id);
      this.event(row.run_id, 'running', 'Native lifecycle reserved');
      return row.run_id;
    })();
  }

  settleCancelled(): void {
    const db = this.database();
    db.transaction(() => {
      const rows = db.prepare(`SELECT run_id FROM gauntlet_dispatches WHERE state='queued' AND run_id IN
        (SELECT id FROM gauntlet_runs WHERE status NOT IN ${ACTIVE})`).all() as { run_id: string }[];
      for (const row of rows) this.finish(row.run_id, 'settled', 'Run ended before admission');
    })();
  }

  finishOwned(runId: string, owner: string, uncertain: boolean): void {
    const db = this.database();
    db.transaction(() => {
      if (!db.prepare("SELECT 1 FROM gauntlet_dispatches WHERE run_id=? AND state='running' AND owner=?").get(runId, owner)) throw Error('Stale scheduler owner');
      // Persisted exit/revocation evidence must agree with the live drain.
      const missing = db.prepare(`SELECT 1 FROM gauntlet_runtime_observations s WHERE s.run_id=? AND
        (s.kind='process_started' AND NOT EXISTS (SELECT 1 FROM gauntlet_runtime_observations e
          WHERE e.launch_id=s.launch_id AND e.kind='process_exited' AND json_extract(e.body_json,'$.event.processExited')=1
          AND json_extract(e.body_json,'$.event.gatewayRevocation')='confirmed')
        OR s.kind='process_exited' AND (json_extract(s.body_json,'$.event.processExited')!=1
          OR json_extract(s.body_json,'$.event.gatewayRevocation')!='confirmed')) LIMIT 1`).get(runId);
      const active = db.prepare(`SELECT 1 FROM gauntlet_runs WHERE id=? AND status IN ${ACTIVE}`).get(runId);
      if (uncertain || missing || active) this.finish(runId, 'quarantined', 'Native shutdown or persisted exit evidence requires inspection');
      else this.finish(runId, 'settled', 'Owned lifecycle drained; no claim about all OS descendants');
    })();
  }

  /** A new main-process owner cannot infer that a predecessor's processes died. */
  recover(): void {
    const db = this.database();
    db.transaction(() => {
      const rows = db.prepare("SELECT run_id FROM gauntlet_dispatches WHERE state='running'").all() as { run_id: string }[];
      for (const row of rows) this.finish(row.run_id, 'quarantined', 'Interrupted scheduler ownership; inspect prior native processes before releasing capacity');
      this.settleCancelled();
    })();
  }

  configure(expectedRevision: number, maxConcurrentRuns: number): GauntletCapacity {
    if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 8) throw Error('Run capacity must be an integer from 1 to 8');
    return this.database().transaction(() => {
      this.expect(expectedRevision);
      this.database().prepare('UPDATE gauntlet_capacity SET max_runs=? WHERE id=1').run(maxConcurrentRuns);
      this.event(null, 'capacity_changed', `Concurrent run limit set to ${maxConcurrentRuns}; existing reservations retained`);
      return this.snapshot();
    })();
  }

  releaseQuarantine(runId: string, expectedRevision: number, reason: string): GauntletCapacity {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw Error('A bounded inspection reason is required');
    return this.database().transaction(() => {
      this.expect(expectedRevision);
      if (!this.database().prepare("SELECT 1 FROM gauntlet_dispatches WHERE run_id=? AND state='quarantined'").get(runId)) throw Error('Reservation is not quarantined');
      if (this.database().prepare(`SELECT 1 FROM gauntlet_runs WHERE id=? AND status IN ${ACTIVE}`).get(runId)) throw Error('End or escalate the interrupted run before releasing capacity');
      this.finish(runId, 'settled', `Human scheduling release: ${reason.trim()}`);
      return this.snapshot();
    })();
  }

  private revision(): number {
    return (this.database().prepare('SELECT coalesce(max(sequence),0) AS revision FROM gauntlet_schedule_events').get() as { revision: number }).revision;
  }
  private expect(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision !== this.revision()) throw Error('Capacity changed; refresh before retrying');
  }
  private event(runId: string | null, kind: string, reason: string): void {
    this.database().prepare('INSERT INTO gauntlet_schedule_events(run_id,kind,reason,at) VALUES(?,?,?,?)').run(runId, kind, reason, Date.now());
  }
  private finish(runId: string, state: 'settled' | 'quarantined', reason: string): void {
    this.database().prepare('UPDATE gauntlet_dispatches SET state=?,owner=NULL,updated_at=?,reason=? WHERE run_id=?').run(state, Date.now(), reason, runId);
    this.event(runId, state, reason);
  }
}

export const SCHEDULE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS gauntlet_capacity(id INTEGER PRIMARY KEY CHECK(id=1), max_runs INTEGER NOT NULL CHECK(max_runs BETWEEN 1 AND 8));
  INSERT OR IGNORE INTO gauntlet_capacity(id,max_runs) VALUES(1,2);
  CREATE TABLE IF NOT EXISTS gauntlet_dispatches(
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL UNIQUE REFERENCES gauntlet_runs(id),
    state TEXT NOT NULL CHECK(state IN ('queued','running','quarantined','settled')), owner TEXT,
    enqueued_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, reason TEXT NOT NULL,
    CHECK((state='running' AND owner IS NOT NULL) OR (state!='running' AND owner IS NULL))
  );
  CREATE INDEX IF NOT EXISTS gauntlet_dispatch_state ON gauntlet_dispatches(state,sequence);
  CREATE TABLE IF NOT EXISTS gauntlet_schedule_events(
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT REFERENCES gauntlet_runs(id), kind TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS gauntlet_schedule_no_update BEFORE UPDATE ON gauntlet_schedule_events BEGIN SELECT RAISE(ABORT,'Schedule events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS gauntlet_schedule_no_delete BEFORE DELETE ON gauntlet_schedule_events BEGIN SELECT RAISE(ABORT,'Schedule events are append-only'); END;
`;
