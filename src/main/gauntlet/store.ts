import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type {
  AgentLaunch,
  Artifact,
  CriticReport,
  FrozenRunContract,
  GauntletEvent,
  GauntletRun,
  GauntletRunSnapshot,
  LeadAcknowledgment,
  RepairPacket,
  SkillLockReceipt
} from '../../shared/gauntlet';
import { applyGauntletEvent, GauntletInvariantError } from './core';

export interface TransitionRecords {
  contract?: FrozenRunContract;
  launch?: AgentLaunch;
  artifact?: Artifact;
  report?: CriticReport;
  acknowledgment?: LeadAcknowledgment;
  repairPacket?: RepairPacket;
  skillLock?: SkillLockReceipt;
}

/**
 * Durable authority for local Gauntlet runs.
 *
 * It deliberately owns a separate database from Munder's legacy PersistStore.
 * This prevents its migration version and eventually-consistent UI state from
 * becoming coupled to protocol authority. One instance lives in Electron main
 * and is the only writer; readers receive immutable snapshots over IPC.
 */
export class GauntletStore {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  open(): void {
    if (this.db) return;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    db.prepare('INSERT OR IGNORE INTO gauntlet_schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(1, Date.now());
    db.pragma('user_version = 1');
    this.db = db;
  }

  close(): void {
    try { this.db?.close(); } finally { this.db = null; }
  }

  createRun(run: GauntletRun): GauntletRunSnapshot {
    const db = this.requireDb();
    db.prepare(`
      INSERT INTO gauntlet_runs (
        id, repository, branch, base_sha, status, version, created_at, updated_at, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id, run.repository, run.branch, run.baseSha, run.status,
      run.version, run.createdAt, run.updatedAt, JSON.stringify(run)
    );
    return this.snapshot(run.id);
  }

  transition(runId: string, expectedVersion: number, event: GauntletEvent, records: TransitionRecords = {}): GauntletRunSnapshot {
    const db = this.requireDb();
    const execute = db.transaction(() => {
      const current = this.getRunInternal(runId);
      if (current.version !== expectedVersion) {
        throw new GauntletInvariantError(`stale run version: expected ${expectedVersion}, got ${current.version}`);
      }
      validateRecords(runId, event, records);
      const next = applyGauntletEvent(current, event);

      const changed = db.prepare(`
        UPDATE gauntlet_runs
           SET status = ?, version = ?, updated_at = ?, snapshot_json = ?
         WHERE id = ? AND version = ?
      `).run(next.status, next.version, next.updatedAt, JSON.stringify(next), runId, expectedVersion);
      if (changed.changes !== 1) throw new GauntletInvariantError('concurrent run update rejected');

      this.insertRecords(db, runId, records);
      updateLaunchLifecycle(db, current, event);
      db.prepare(`
        INSERT INTO gauntlet_events (run_id, sequence, event_type, event_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(runId, next.version, event.type, JSON.stringify(event), event.at);
      return next;
    });
    execute();
    return this.snapshot(runId);
  }

  snapshot(runId: string): GauntletRunSnapshot {
    const db = this.requireDb();
    const run = this.getRunInternal(runId);
    return {
      run,
      artifacts: jsonRows<Artifact>(db, 'SELECT body_json FROM gauntlet_artifacts WHERE run_id = ? ORDER BY created_at, id', runId),
      launches: jsonRows<AgentLaunch>(db, 'SELECT body_json FROM gauntlet_launches WHERE run_id = ? ORDER BY created_at, id', runId),
      reports: jsonRows<CriticReport>(db, 'SELECT body_json FROM gauntlet_critic_reports WHERE run_id = ? ORDER BY created_at, id', runId),
      acknowledgments: jsonRows<LeadAcknowledgment>(db, 'SELECT body_json FROM gauntlet_lead_acks WHERE run_id = ? ORDER BY created_at, id', runId),
      repairPackets: jsonRows<RepairPacket>(db, 'SELECT body_json FROM gauntlet_repair_packets WHERE run_id = ? ORDER BY created_at, id', runId),
      events: (db.prepare(
        'SELECT sequence, event_json AS eventJson FROM gauntlet_events WHERE run_id = ? ORDER BY sequence'
      ).all(runId) as Array<{ sequence: number; eventJson: string }>).map((row) => ({
        sequence: row.sequence,
        event: JSON.parse(row.eventJson) as GauntletEvent
      })),
      skillLock: jsonRows<SkillLockReceipt>(db, 'SELECT body_json FROM gauntlet_skill_locks WHERE run_id = ?', runId)[0]
    };
  }

  listRuns(limit = 100): GauntletRun[] {
    const db = this.requireDb();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return (db.prepare(
      'SELECT snapshot_json AS snapshotJson FROM gauntlet_runs ORDER BY updated_at DESC LIMIT ?'
    ).all(safeLimit) as Array<{ snapshotJson: string }>).map((row) => JSON.parse(row.snapshotJson) as GauntletRun);
  }

  listRecoverableRuns(): GauntletRun[] {
    const terminal = ['passed', 'human_required', 'infrastructure_failure', 'cancelled'];
    return this.listRuns(500).filter((run) => !terminal.includes(run.status));
  }

  saveSkillLock(lock: SkillLockReceipt): void {
    const db = this.requireDb();
    this.getRunInternal(lock.runId);
    db.prepare('INSERT INTO gauntlet_skill_locks (run_id, body_json, created_at) VALUES (?, ?, ?)')
      .run(lock.runId, JSON.stringify(lock), lock.createdAt);
  }

  private getRunInternal(runId: string): GauntletRun {
    const db = this.requireDb();
    const row = db.prepare('SELECT snapshot_json AS snapshotJson FROM gauntlet_runs WHERE id = ?')
      .get(runId) as { snapshotJson: string } | undefined;
    if (!row) throw new GauntletInvariantError(`unknown run: ${runId}`);
    return JSON.parse(row.snapshotJson) as GauntletRun;
  }

  private insertRecords(db: Database.Database, runId: string, records: TransitionRecords): void {
    if (records.contract) {
      db.prepare('INSERT INTO gauntlet_contracts (run_id, digest, body_json, created_at) VALUES (?, ?, ?, ?)')
        .run(runId, records.contract.digest, JSON.stringify(records.contract), records.contract.frozenAt);
    }
    if (records.launch) {
      db.prepare(`
        INSERT INTO gauntlet_launches (id, run_id, role, expected_sha, status, body_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        records.launch.id, runId, records.launch.role, records.launch.expectedSha,
        records.launch.status, JSON.stringify(records.launch), records.launch.createdAt
      );
    }
    if (records.artifact) {
      db.prepare(`
        INSERT INTO gauntlet_artifacts (id, run_id, sha, parent_sha, launch_id, body_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        records.artifact.id, runId, records.artifact.sha, records.artifact.parentSha,
        records.artifact.producedByLaunchId, JSON.stringify(records.artifact), records.artifact.createdAt
      );
    }
    if (records.report) {
      db.prepare(`
        INSERT INTO gauntlet_critic_reports (id, run_id, artifact_sha, launch_id, verdict, body_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        records.report.id, runId, records.report.artifactSha, records.report.launchId,
        records.report.verdict, JSON.stringify(records.report), records.report.createdAt
      );
    }
    if (records.acknowledgment) {
      db.prepare(`
        INSERT INTO gauntlet_lead_acks (id, run_id, report_id, artifact_sha, decision, body_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        records.acknowledgment.id, runId, records.acknowledgment.reportId,
        records.acknowledgment.artifactSha, records.acknowledgment.decision,
        JSON.stringify(records.acknowledgment), records.acknowledgment.createdAt
      );
    }
    if (records.repairPacket) {
      db.prepare(`
        INSERT INTO gauntlet_repair_packets (id, run_id, acknowledgment_id, expected_sha, body_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        records.repairPacket.id, runId, records.repairPacket.acknowledgmentId,
        records.repairPacket.expectedSha, JSON.stringify(records.repairPacket), records.repairPacket.createdAt
      );
    }
    if (records.skillLock) {
      db.prepare('INSERT INTO gauntlet_skill_locks (run_id, body_json, created_at) VALUES (?, ?, ?)')
        .run(runId, JSON.stringify(records.skillLock), records.skillLock.createdAt);
    }
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('GauntletStore is not open');
    return this.db;
  }
}

function validateRecords(runId: string, event: GauntletEvent, records: TransitionRecords): void {
  const owned = [records.launch, records.artifact, records.report, records.acknowledgment, records.repairPacket]
    .filter(Boolean) as Array<{ runId: string }>;
  if (owned.some((record) => record.runId !== runId)) throw new GauntletInvariantError('attached record belongs to another run');
  if (event.type === 'BAR_FROZEN' && records.contract?.digest !== event.contract.digest) {
    throw new GauntletInvariantError('BAR_FROZEN must persist the same contract');
  }
  if ((event.type === 'IMPLEMENTER_LAUNCHED' || event.type === 'CRITIC_LAUNCHED' || event.type === 'REPAIR_LAUNCHED')
      && records.launch?.id !== event.launchId) {
    throw new GauntletInvariantError(`${event.type} must persist the same launch`);
  }
  if (event.type === 'ARTIFACT_RECORDED' && records.artifact?.sha !== event.artifactSha) {
    throw new GauntletInvariantError('ARTIFACT_RECORDED must persist the same artifact');
  }
  if (event.type === 'CRITIC_REPORTED' && event.verdict !== 'INVALID_OR_STALE' && records.report?.id !== event.reportId) {
    throw new GauntletInvariantError('CRITIC_REPORTED must persist the same report');
  }
  if (event.type === 'LEAD_ACKNOWLEDGED' && records.acknowledgment?.id !== event.acknowledgmentId) {
    throw new GauntletInvariantError('LEAD_ACKNOWLEDGED must persist the same acknowledgment');
  }
}

/** Keep launch receipts in step with the authoritative transition. This is in
 * the same SQLite transaction as the run snapshot and append-only event. */
function updateLaunchLifecycle(db: Database.Database, current: GauntletRun, event: GauntletEvent): void {
  let launchId: string | null = null;
  let status: AgentLaunch['status'] | null = null;
  if (event.type === 'ARTIFACT_RECORDED' || event.type === 'CRITIC_REPORTED') {
    launchId = event.launchId;
    status = 'completed';
  } else if (event.type === 'INFRASTRUCTURE_FAILED' && current.currentLaunchId) {
    launchId = current.currentLaunchId;
    status = /timed out/i.test(event.reason) ? 'timed_out' : 'failed';
  } else if ((event.type === 'CANCELLED' || event.type === 'HUMAN_ESCALATED') && current.currentLaunchId) {
    launchId = current.currentLaunchId;
    status = 'cancelled';
  }
  if (!launchId || !status) return;
  const row = db.prepare('SELECT body_json AS bodyJson FROM gauntlet_launches WHERE id = ? AND run_id = ?')
    .get(launchId, current.id) as { bodyJson: string } | undefined;
  if (!row) throw new GauntletInvariantError(`launch lifecycle record is missing: ${launchId}`);
  const launch = JSON.parse(row.bodyJson) as AgentLaunch;
  const updated: AgentLaunch = { ...launch, status, finishedAt: event.at };
  db.prepare('UPDATE gauntlet_launches SET status = ?, body_json = ? WHERE id = ? AND run_id = ?')
    .run(status, JSON.stringify(updated), launchId, current.id);
}

function jsonRows<T>(db: Database.Database, sql: string, value: string): T[] {
  return (db.prepare(sql).all(value) as Array<{ body_json?: string; bodyJson?: string }>).map((row) =>
    JSON.parse(row.body_json ?? row.bodyJson ?? 'null') as T
  );
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS gauntlet_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gauntlet_runs (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_sha TEXT NOT NULL CHECK(length(base_sha) = 40),
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gauntlet_runs_updated ON gauntlet_runs(updated_at DESC);

  CREATE TABLE IF NOT EXISTS gauntlet_contracts (
    run_id TEXT PRIMARY KEY REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    digest TEXT NOT NULL CHECK(length(digest) = 64),
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gauntlet_launches (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    expected_sha TEXT NOT NULL CHECK(length(expected_sha) = 40),
    status TEXT NOT NULL,
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gauntlet_launches_run ON gauntlet_launches(run_id, created_at);

  CREATE TABLE IF NOT EXISTS gauntlet_artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    sha TEXT NOT NULL CHECK(length(sha) = 40),
    parent_sha TEXT NOT NULL CHECK(length(parent_sha) = 40),
    launch_id TEXT NOT NULL REFERENCES gauntlet_launches(id),
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, sha)
  );
  CREATE TABLE IF NOT EXISTS gauntlet_critic_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    artifact_sha TEXT NOT NULL CHECK(length(artifact_sha) = 40),
    launch_id TEXT NOT NULL REFERENCES gauntlet_launches(id),
    verdict TEXT NOT NULL,
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, launch_id)
  );
  CREATE TABLE IF NOT EXISTS gauntlet_lead_acks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    report_id TEXT NOT NULL REFERENCES gauntlet_critic_reports(id),
    artifact_sha TEXT NOT NULL CHECK(length(artifact_sha) = 40),
    decision TEXT NOT NULL,
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, report_id)
  );
  CREATE TABLE IF NOT EXISTS gauntlet_repair_packets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    acknowledgment_id TEXT NOT NULL REFERENCES gauntlet_lead_acks(id),
    expected_sha TEXT NOT NULL CHECK(length(expected_sha) = 40),
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, acknowledgment_id)
  );
  CREATE TABLE IF NOT EXISTS gauntlet_events (
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(run_id, sequence)
  );
  CREATE TABLE IF NOT EXISTS gauntlet_skill_locks (
    run_id TEXT PRIMARY KEY REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;
