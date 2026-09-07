import Database from 'better-sqlite3';
import { dirname, isAbsolute, normalize } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
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
  RuntimeObservation,
  SkillLockReceipt,
  WorkspacePreservationReceipt,
  WorkspacePreparation
} from '../../shared/gauntlet';
import { applyGauntletEvent, assertFullSha, GauntletInvariantError } from './core';
import { GauntletScheduleStore, SCHEDULE_SCHEMA } from './scheduleStore';
import { OperatorPriorityStore, OPERATOR_PRIORITY_SCHEMA } from './operatorPriority';

// SQL equivalent of runtimeEventNeedsAttention, kept under parity tests.
const RUNTIME_WARNING_SQL = `(observation.kind='recovery_interrupted'
  OR (observation.kind='delivery_completed' AND json_extract(observation.body_json,'$.event.ok')=0)
  OR (observation.kind='process_exited' AND (
    json_extract(observation.body_json,'$.event.processExited')=0
    OR json_extract(observation.body_json,'$.event.gatewayRevocation')!='confirmed'
    OR json_extract(observation.body_json,'$.event.reason') NOT IN ('result','finished','cancelled')
    OR (json_extract(observation.body_json,'$.event.reason')!='cancelled'
      AND coalesce(json_extract(observation.body_json,'$.event.exitCode'),-1)!=0))))`;

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
  readonly scheduler = new GauntletScheduleStore(() => this.requireDb());
  readonly priorities = new OperatorPriorityStore(() => this.requireDb());

  constructor(private readonly dbPath: string) {}

  open(): void {
    if (this.db) return;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new Database(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    try {
      const version = Number(db.pragma('user_version', { simple: true }));
      if (version > 10) throw new GauntletInvariantError('Gauntlet database requires a newer application');
      db.transaction(() => {
        db.exec(SCHEMA);
        db.exec(SCHEDULE_SCHEMA);
        db.exec(PREPARATION_SCHEMA);
        db.exec(OPERATOR_PRIORITY_SCHEMA);
        db.exec(`CREATE TABLE IF NOT EXISTS gauntlet_operator_requests (
          request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, run_id TEXT NOT NULL,
          actor TEXT NOT NULL, created_at INTEGER NOT NULL,
          FOREIGN KEY(run_id) REFERENCES gauntlet_runs(id))`);
        if (version < 5) {
          // An old native launch without a confirmed exit may still own capacity.
          // Include terminal runs: an artifact verdict does not prove shutdown.
          db.prepare(`INSERT OR IGNORE INTO gauntlet_dispatches(run_id,state,enqueued_at,updated_at,reason)
            SELECT r.id,'quarantined',r.created_at,?,'Pre-scheduler launch lacks confirmed shutdown; inspect before release'
            FROM gauntlet_runs r WHERE EXISTS (SELECT 1 FROM gauntlet_launches l WHERE l.run_id=r.id
              AND NOT EXISTS (SELECT 1 FROM gauntlet_runtime_observations e WHERE e.launch_id=l.id AND e.kind='process_exited'
                AND json_extract(e.body_json,'$.event.processExited')=1 AND json_extract(e.body_json,'$.event.gatewayRevocation')='confirmed'))`).run(Date.now());
          db.prepare(`INSERT INTO gauntlet_schedule_events(run_id,kind,reason,at)
            SELECT run_id,'quarantined',reason,updated_at FROM gauntlet_dispatches`).run();
        }
        const migrate = db.prepare('INSERT OR IGNORE INTO gauntlet_schema_migrations (version, applied_at) VALUES (?, ?)');
        migrate.run(1, Date.now());
        migrate.run(2, Date.now());
        // Protocol version: old binaries must not reopen run-scoped lead records
        // while still accepting their former cross-run control token.
        migrate.run(3, Date.now());
        migrate.run(4, Date.now());
        migrate.run(5, Date.now());
        migrate.run(6, Date.now());
        migrate.run(7, Date.now());
        migrate.run(8, Date.now());
        migrate.run(9, Date.now());
        migrate.run(10, Date.now());
        db.pragma('user_version = 10');
      })();
    } catch (error) { db.close(); throw error; }
    this.db = db;
  }

  close(): void {
    try { this.db?.close(); } finally { this.db = null; }
  }

  /** Atomic operator start receipt, separate from role capabilities. A retry
   * returns its original run even after restart; changed intent is rejected. */
  operatorStart(requestId: string, digest: string, create: () => string): { runId: string; replayed: boolean } {
    const db = this.requireDb();
    return db.transaction(() => {
      const row = db.prepare('SELECT digest, run_id AS runId FROM gauntlet_operator_requests WHERE request_id=?')
        .get(requestId) as { digest: string; runId: string } | undefined;
      if (row) {
        if (row.digest !== digest) throw new GauntletInvariantError('requestId already belongs to different start parameters');
        return { runId: row.runId, replayed: true };
      }
      const runId = create();
      db.prepare('INSERT INTO gauntlet_operator_requests VALUES (?,?,?,?,?)')
        .run(requestId, digest, runId, 'local-mcp-operator', Date.now());
      return { runId, replayed: false };
    })();
  }

  /** The control command and its run/launch/token validation share one SQLite
   * transaction. The callback must remain synchronous and main-process owned. */
  withConductorAuthority(runId: string, launchId: string, token: string, command: () => GauntletRunSnapshot): GauntletRunSnapshot {
    return this.requireDb().transaction(() => {
      const run = this.getRunInternal(runId);
      const launch = this.findLaunch(launchId);
      if (!launch || launch.runId !== runId || launch.role !== 'conductor' ||
          run.conductorLaunchId !== launchId || !['created', 'running'].includes(launch.status) ||
          ['passed', 'human_required', 'infrastructure_failure', 'cancelled'].includes(run.status)) {
        throw new GauntletInvariantError('invalid Conductor authority');
      }
      const actual = createHash('sha256').update(token).digest();
      const expected = Buffer.from(launch.tokenHash, 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new GauntletInvariantError('invalid Conductor authority');
      }
      return command();
    })();
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
      if (event.type === 'CANDIDATE_HANDOFF_RECORDED' &&
          !db.prepare('SELECT 1 FROM gauntlet_artifacts WHERE run_id=? AND sha=?').get(runId,event.artifactSha)) {
        throw new GauntletInvariantError('candidate artifact receipt is missing');
      }
      if (event.type === 'OPERATOR_REVIEW_RECORDED' && event.reviewed && this.pendingPreparations(runId).length) {
        throw new GauntletInvariantError('Incomplete workspace preparation requires recovery inspection; it cannot be dismissed as reviewed');
      }
      if (records.launch) {
        const intent = this.pendingPreparations(runId).find(item => item.launchId === records.launch!.id);
        if (intent && (intent.role !== records.launch.role || intent.worktreePath !== records.launch.worktreePath ||
          intent.expectedSha !== records.launch.expectedSha || intent.candidateBranch !== (records.launch.candidateBranch ?? null) ||
          intent.reviewEvidencePath !== (records.launch.reviewEvidence ? dirname(records.launch.reviewEvidence.directory) : null))) {
          throw new GauntletInvariantError('launch does not match its durable workspace preparation');
        }
      }
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
      pendingPreparations: this.pendingPreparations(runId),
      operatorPriorityHistory: this.priorities.history(runId),
      runtimeObservations: (db.prepare('SELECT sequence, body_json FROM gauntlet_runtime_observations WHERE run_id = ? ORDER BY sequence')
        .all(runId) as Array<{sequence: number; body_json: string}>).map(row => ({ ...JSON.parse(row.body_json), sequence: row.sequence })),
      preservations: jsonRows<WorkspacePreservationReceipt>(db, 'SELECT body_json FROM gauntlet_preservations WHERE run_id = ? ORDER BY sequence', runId),
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

  recordRuntimeObservation(input: Omit<RuntimeObservation, 'sequence'>): void {
    const db = this.requireDb();
    db.transaction(() => {
      const launch = this.findLaunch(input.launchId);
      if (!launch || launch.runId !== input.runId || launch.sessionId !== input.sessionId) throw new GauntletInvariantError('runtime observation identity mismatch');
      if (!Number.isSafeInteger(input.at) || input.at < 0) throw new GauntletInvariantError('invalid observation time');
      const event = input.event;
      const digest = (v: unknown): boolean => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
      const uuid = (v: unknown): boolean => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
      let allowed: string[];
      switch (event.type) {
        case 'native_identity': {
          allowed = ['type','provider','threadId','turnId'];
          const nativeId = (value: unknown): boolean => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
          if (event.provider !== 'codex' || launch.provider !== 'codex' || !['critic','conductor'].includes(launch.role) ||
            !nativeId(event.threadId) || (event.turnId !== null && !nativeId(event.turnId))) {
            throw new GauntletInvariantError('invalid native session identity');
          }
          const stage = event.turnId === null ? 'thread' : launch.role === 'conductor' ? `turn:${event.turnId}` : 'turn';
          const recorded = db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind='native_identity' AND message_id=?").get(launch.id, stage);
          if (!recorded) {
            const run = this.getRunInternal(input.runId);
            if ((launch.role === 'conductor' ? run.conductorLaunchId !== launch.id : run.currentLaunchId !== launch.id) || !['created','running'].includes(launch.status) ||
              ['passed','human_required','cancelled','infrastructure_failure'].includes(run.status) || input.at < launch.createdAt ||
              !db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind='process_started'").get(launch.id) ||
              db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind IN ('process_exited','recovery_interrupted')").get(launch.id)) {
              throw new GauntletInvariantError('native identity requires an active observed launch');
            }
          }
          if (event.turnId !== null && !db.prepare(`SELECT 1 FROM gauntlet_runtime_observations
            WHERE launch_id=? AND kind='native_identity' AND message_id='thread'
              AND json_extract(body_json,'$.event.threadId')=? AND json_extract(body_json,'$.at')<=?`)
            .get(launch.id, event.threadId, input.at)) {
            throw new GauntletInvariantError('native turn requires its recorded thread');
          }
          break;
        }
        case 'subscription_admission': {
          const recorded = db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind='subscription_admission'").get(launch.id);
          const run = this.getRunInternal(input.runId);
          allowed = ['type','component','provider','source','executableVersion','executableSha256','model','accountHash',
            'plan','checkedAt','validUntil','launchAllowed',
            ...(event.provider === 'claude' ? ['organizationHash','extraUsage','metadataObservedAt'] : ['credits','topUps','companionSha256'])];
          const providerValid = event.provider === 'claude' ? event.component === 'claude-max-account-v1' &&
            /^claude-[a-z0-9-]{1,100}$/.test(event.model) && digest(event.organizationHash) && event.plan === 'max' && event.extraUsage === 'disabled' &&
            (event.metadataObservedAt === undefined || (Number.isSafeInteger(event.metadataObservedAt) &&
              event.metadataObservedAt <= event.checkedAt && event.validUntil <= event.metadataObservedAt + 300000)) :
            event.provider === 'codex' && ['critic','conductor'].includes(launch.role) && event.component === 'codex-subscription-account-v1' &&
              /^gpt-[a-z0-9.-]{1,100}$/.test(event.model) && ['plus','pro'].includes(event.plan) && ['none-observed','available','unknown'].includes(event.credits) &&
              event.topUps === 'not-programmatically-verified' && digest(event.companionSha256);
          if (launch.provider !== event.provider || !providerValid ||
            !['provider-metadata','injected-dependencies'].includes(event.source) ||
            !/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(event.executableVersion) || !digest(event.executableSha256) ||
            (launch.model && launch.model !== event.model) || !digest(event.accountHash) ||
            event.launchAllowed !== false || !Number.isSafeInteger(event.checkedAt) || !Number.isSafeInteger(event.validUntil) ||
            event.checkedAt < launch.createdAt || input.at < event.checkedAt || input.at >= event.validUntil ||
            event.validUntil - event.checkedAt > 30000 || (!recorded && (!['created','running'].includes(launch.status) ||
              ['passed','human_required','cancelled','infrastructure_failure'].includes(run.status) ||
              (launch.role === 'conductor' ? run.conductorLaunchId : run.currentLaunchId) !== launch.id))) {
            throw new GauntletInvariantError('invalid subscription admission evidence');
          }
          if (!recorded && db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind IN ('process_started','process_exited')").get(launch.id)) {
            throw new GauntletInvariantError('subscription evidence must be recorded before native startup');
          }
          break;
        }
        case 'tool_activity':
          allowed = ['type','ordinal','activity','stage','outcome'];
          if (!Number.isSafeInteger(event.ordinal) || event.ordinal < 1 || event.ordinal > 2048 ||
            !['reading','searching','editing','executing','tool'].includes(event.activity) ||
            !['requested','result'].includes(event.stage) ||
            (event.stage === 'requested' ? event.outcome !== undefined : !['ok','error'].includes(event.outcome ?? ''))) {
            throw new GauntletInvariantError('invalid tool activity observation');
          }
          break;
        case 'process_started':
          allowed = ['type', 'pid', 'model', 'profileSha256', 'boundarySha256'];
          if (!Number.isSafeInteger(event.pid) || event.pid <= 1 || !digest(event.profileSha256) || !digest(event.boundarySha256) ||
            !(launch.provider === 'claude' ? /^claude-[a-z0-9-]{1,100}$/.test(event.model) :
              launch.provider === 'codex' && ['critic','conductor'].includes(launch.role) && /^gpt-[a-z0-9.-]{1,100}$/.test(event.model)) ||
            (launch.model && event.model !== launch.model)) throw new GauntletInvariantError('invalid process start evidence');
          break;
        case 'process_exited':
          allowed = ['type', 'reason', 'exitCode', 'processExited', 'gatewayRevocation', 'descendantsQuiescent', 'output'];
          if (!['result','provider_error','invalid_result','spawn_error','output_limit','cancelled','timeout','gateway_revocation_failed',
            'finished','invalid_stream','unexpected_exit'].includes(event.reason) ||
            (event.exitCode !== null && (!Number.isSafeInteger(event.exitCode) || event.exitCode < 0 || event.exitCode > 255)) ||
            typeof event.processExited !== 'boolean' || !['confirmed','unconfirmed'].includes(event.gatewayRevocation) || event.descendantsQuiescent !== false) {
            throw new GauntletInvariantError('invalid process exit evidence');
          }
          if (event.output !== undefined) {
            const output = event.output;
            if (!output || typeof output !== 'object' || Array.isArray(output) ||
              Object.keys(output).some(key => !['receivedBytes','stdoutBytes','stderrBytes','stdoutPreviewTruncated','stderrPreviewTruncated'].includes(key)) ||
              ![output.receivedBytes,output.stdoutBytes,output.stderrBytes].every(n => Number.isSafeInteger(n) && n >= 0) ||
              output.receivedBytes !== output.stdoutBytes + output.stderrBytes ||
              typeof output.stdoutPreviewTruncated !== 'boolean' || typeof output.stderrPreviewTruncated !== 'boolean') {
              throw new GauntletInvariantError('invalid native output counters');
            }
          }
          break;
        case 'delivery_queued':
          allowed = ['type', 'messageId', 'purpose', 'promptSha256', 'reportId'];
          if (launch.role !== 'conductor' || !uuid(event.messageId) || !digest(event.promptSha256) ||
            !['orientation','acknowledgment'].includes(event.purpose) ||
            (event.purpose === 'orientation' ? event.reportId !== null : !this.snapshot(input.runId).reports.some(r => r.id === event.reportId))) {
            throw new GauntletInvariantError('invalid Conductor delivery evidence');
          }
          break;
        case 'delivery_completed':
          allowed = ['type', 'messageId', 'ok', 'resultSha256'];
          if (!uuid(event.messageId) || typeof event.ok !== 'boolean' || !digest(event.resultSha256) ||
            !db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind='delivery_queued' AND message_id=?")
              .get(launch.id, event.messageId)) throw new GauntletInvariantError('delivery has no matching queued message');
          break;
        case 'recovery_interrupted':
          allowed = ['type'];
          if (!db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind='process_started'").get(launch.id) ||
            db.prepare("SELECT 1 FROM gauntlet_runtime_observations WHERE launch_id=? AND kind='process_exited'").get(launch.id)) {
            throw new GauntletInvariantError('no interrupted process observation to recover');
          }
          break;
        default: throw new GauntletInvariantError('unsupported runtime observation');
      }
      if (Object.keys(event).some(key => !allowed.includes(key)) ||
        Object.keys(input).some(key => !['runId','launchId','sessionId','at','event'].includes(key))) throw new GauntletInvariantError('unexpected runtime observation fields');
      const messageId = event.type === 'native_identity' ? event.turnId === null ? 'thread' : launch.role === 'conductor' ? `turn:${event.turnId}` : 'turn' :
        event.type === 'tool_activity' ? String(event.ordinal) : 'messageId' in event ? event.messageId : '';
      const body = JSON.stringify(input);
      const prior = db.prepare('SELECT body_json FROM gauntlet_runtime_observations WHERE launch_id=? AND kind=? AND message_id=?')
        .get(launch.id, event.type, messageId) as {body_json:string} | undefined;
      if (prior) {
        if (prior.body_json !== body) throw new GauntletInvariantError('runtime observation is immutable');
        return;
      }
      if ((db.prepare('SELECT count(*) AS count FROM gauntlet_runtime_observations WHERE run_id=?').get(input.runId) as {count:number}).count >= 4096) {
        throw new GauntletInvariantError('runtime observation limit reached');
      }
      db.prepare('INSERT INTO gauntlet_runtime_observations(run_id,launch_id,kind,message_id,body_json) VALUES(?,?,?,?,?)')
        .run(input.runId, launch.id, event.type, messageId, body);
    })();
  }

  unclosedProcessObservations(): RuntimeObservation[] {
    return (this.requireDb().prepare(`SELECT started.sequence, started.body_json FROM gauntlet_runtime_observations started
      WHERE started.kind='process_started' AND NOT EXISTS (
        SELECT 1 FROM gauntlet_runtime_observations finished WHERE finished.launch_id=started.launch_id
          AND finished.kind IN ('process_exited','recovery_interrupted'))`).all() as Array<{sequence:number;body_json:string}>)
      .map(row => ({ ...JSON.parse(row.body_json), sequence: row.sequence }));
  }

  recordPreservation(receipt: WorkspacePreservationReceipt): void {
    const db = this.requireDb();
    db.transaction(() => {
      const run = this.getRunInternal(receipt.runId);
      const launch = this.findLaunch(receipt.launchId);
      if (!launch || launch.runId !== run.id || launch.worktreePath !== receipt.worktreePath || launch.expectedSha !== receipt.expectedSha ||
          receipt.candidateBranch !== (launch.role === 'critic' ? null : (launch.candidateBranch ?? run.branch))) {
        throw new GauntletInvariantError('preservation receipt does not match its launch');
      }
      assertFullSha(receipt.expectedSha);
      if (receipt.observedSha !== null) assertFullSha(receipt.observedSha);
      if (!['pending', 'preserved', 'missing', 'failed'].includes(receipt.outcome) ||
          !receipt.id || !receipt.requestId || receipt.reason.length > 10000 || (receipt.error?.length ?? 0) > 10000) {
        throw new GauntletInvariantError('invalid preservation receipt');
      }
      if (!Number.isFinite(receipt.createdAt) || receipt.createdAt < launch.createdAt ||
          (receipt.outcome === 'preserved' && (receipt.observedSha === null || typeof receipt.dirty !== 'boolean' || receipt.error !== null)) ||
          (receipt.outcome === 'missing' && (receipt.observedSha !== null || receipt.dirty !== null)) ||
          (receipt.outcome === 'failed' && !receipt.error)) {
        throw new GauntletInvariantError('preservation outcome is not supported by its observation');
      }
      const stage = receipt.outcome === 'pending' ? 'requested' : 'finished';
      if (stage === 'requested' && (receipt.id !== receipt.requestId || receipt.observedSha !== null || receipt.dirty !== null)) {
        throw new GauntletInvariantError('pending preservation cannot claim observed work');
      }
      if (stage === 'finished') {
        const requested = db.prepare('SELECT body_json FROM gauntlet_preservations WHERE id = ? AND stage = ?').get(receipt.requestId, 'requested') as { body_json: string } | undefined;
        const prior = requested ? JSON.parse(requested.body_json) as WorkspacePreservationReceipt : null;
        if (!prior || prior.launchId !== receipt.launchId || prior.runId !== receipt.runId || prior.reason !== receipt.reason || receipt.createdAt < prior.createdAt) {
          throw new GauntletInvariantError('preservation outcome requires its matching request');
        }
      }
      const body = JSON.stringify(receipt);
      const previous = db.prepare('SELECT body_json FROM gauntlet_preservations WHERE request_id = ? AND stage = ?').get(receipt.requestId, stage) as { body_json: string } | undefined;
      if (previous) {
        if (previous.body_json !== body) throw new GauntletInvariantError('preservation receipt is immutable');
        return;
      }
      db.prepare('INSERT INTO gauntlet_preservations (id, run_id, launch_id, request_id, stage, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(receipt.id, receipt.runId, receipt.launchId, receipt.requestId, stage, body, receipt.createdAt);
    })();
  }

  unfinishedPreservations(): WorkspacePreservationReceipt[] {
    return (this.requireDb().prepare(`SELECT request.body_json FROM gauntlet_preservations request
      LEFT JOIN gauntlet_preservations outcome ON outcome.request_id = request.request_id AND outcome.stage = 'finished'
      WHERE request.stage = 'requested' AND outcome.id IS NULL ORDER BY request.sequence`).all() as Array<{ body_json: string }>)
      .map(row => JSON.parse(row.body_json) as WorkspacePreservationReceipt);
  }

  listRuns(limit = 100): GauntletRun[] {
    const db = this.requireDb();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return (db.prepare(
      'SELECT snapshot_json AS snapshotJson FROM gauntlet_runs ORDER BY updated_at DESC LIMIT ?'
    ).all(safeLimit) as Array<{ snapshotJson: string }>).map((row) => this.withRuntimeProjection(JSON.parse(row.snapshotJson) as GauntletRun));
  }

  listRecoverableRuns(): GauntletRun[] {
    // Recovery is not a paginated UI listing. Recent terminal runs must not hide
    // an older active run from restart reconciliation.
    return (this.requireDb().prepare(`SELECT snapshot_json AS snapshotJson
      FROM gauntlet_runs WHERE status NOT IN ('passed', 'human_required', 'infrastructure_failure', 'cancelled')
      ORDER BY updated_at, id`).all() as Array<{ snapshotJson: string }>)
      .map(row => JSON.parse(row.snapshotJson) as GauntletRun);
  }

  listOperatorRuns(): GauntletRun[] {
    // A burst of completed work must not hide an older active run, escalation,
    // or execution failure. Only the closed history is capped in this surface.
    const closed = `((status='cancelled' OR
      (status='passed' AND coalesce(json_extract(snapshot_json,'$.candidateHandoff.reviewed'),0)=1
        AND coalesce(length(json_extract(snapshot_json,'$.currentArtifactSha')),0)=40
        AND json_extract(snapshot_json,'$.currentArtifactSha') NOT GLOB '*[^a-f0-9]*'
        AND json_extract(snapshot_json,'$.candidateHandoff.artifactSha')=json_extract(snapshot_json,'$.currentArtifactSha')) OR
      (status IN ('human_required','infrastructure_failure') AND coalesce(json_extract(snapshot_json,'$.operatorReview.reviewed'),0)=1))
      AND NOT EXISTS (SELECT 1 FROM gauntlet_preparations p WHERE p.run_id=gauntlet_runs.id
        AND NOT EXISTS (SELECT 1 FROM gauntlet_launches l WHERE l.id=p.launch_id))
      AND NOT EXISTS (SELECT 1 FROM gauntlet_runtime_observations observation
        WHERE observation.run_id=gauntlet_runs.id AND ${RUNTIME_WARNING_SQL}
        AND (coalesce(json_extract(snapshot_json,'$.operatorReview.reviewed'),0)=0
          OR observation.sequence > coalesce(json_extract(snapshot_json,'$.operatorReview.runtimeSequence'),0))))`;
    return (this.requireDb().prepare(`SELECT snapshot_json AS snapshotJson FROM gauntlet_runs
      WHERE NOT ${closed} OR id IN (
        SELECT id FROM gauntlet_runs WHERE ${closed}
        ORDER BY updated_at DESC, id LIMIT 100
      ) ORDER BY updated_at DESC, id`).all() as Array<{ snapshotJson: string }>)
      .map(row => this.withRuntimeProjection(JSON.parse(row.snapshotJson) as GauntletRun));
  }

  private withRuntimeProjection(run: GauntletRun): GauntletRun {
    // Ignore any previously serialized projection. Only journal rows supply it.
    const { runtimeRevision: _revision, runtimeAttention: _attention, preparationRevision: _preparationRevision,
      preparationPending: _preparationPending, operatorPriority: _priority, ...saved } = run;
    const operatorPriority = this.priorities.current(run.id);
    const prep = this.requireDb().prepare(`SELECT max(p.sequence) AS revision,
      sum(CASE WHEN l.id IS NULL THEN 1 ELSE 0 END) AS pending FROM gauntlet_preparations p
      LEFT JOIN gauntlet_launches l ON l.id=p.launch_id WHERE p.run_id=?`).get(run.id) as {revision:number|null;pending:number};
    const base = { ...saved, ...(operatorPriority ? {operatorPriority} : {}),
      ...(prep.revision ? { preparationRevision: prep.revision, preparationPending: prep.pending } : {}) };
    const row = this.requireDb().prepare(`SELECT max(sequence) AS revision,
      max(CASE WHEN ${RUNTIME_WARNING_SQL} THEN sequence ELSE 0 END) AS warningSequence,
      sum(CASE WHEN ${RUNTIME_WARNING_SQL} THEN 1 ELSE 0 END) AS warningCount
      FROM gauntlet_runtime_observations observation WHERE run_id=?`).get(run.id) as
      {revision:number|null;warningSequence:number;warningCount:number};
    if (!row.revision) return base;
    return { ...base, runtimeRevision: row.revision,
      ...(row.warningCount ? { runtimeAttention: {sequence:row.warningSequence,count:row.warningCount} } : {}) };
  }

  findLaunch(id: string): AgentLaunch | null {
    const row = this.requireDb().prepare('SELECT body_json AS bodyJson FROM gauntlet_launches WHERE id = ?')
      .get(id) as { bodyJson: string } | undefined;
    return row ? JSON.parse(row.bodyJson) as AgentLaunch : null;
  }

  pendingPreparations(runId?: string): WorkspacePreparation[] {
    const rows = this.requireDb().prepare(`SELECT p.body_json FROM gauntlet_preparations p
      LEFT JOIN gauntlet_launches l ON l.id=p.launch_id WHERE l.id IS NULL ${runId ? 'AND p.run_id=?' : ''}
      ORDER BY p.sequence`).all(...(runId ? [runId] : [])) as {body_json:string}[];
    return rows.map(row => JSON.parse(row.body_json) as WorkspacePreparation);
  }

  recordPreparation(input: WorkspacePreparation, expectedVersion: number): void {
    const db = this.requireDb();
    if (db.inTransaction) throw new GauntletInvariantError('Preparation must commit outside any enclosing transaction before filesystem effects');
    db.transaction(() => {
      const run = this.getRunInternal(input.runId);
      const keys = ['launchId','runId','role','repository','expectedSha','contractDigest','worktreePath','candidateBranch','reviewEvidencePath','createdAt'];
      const roleStatus = { implementer: 'awaiting_implementation', repairer: 'needs_repair', critic: 'awaiting_critic' };
      const paths = [input.worktreePath, ...(input.reviewEvidencePath === null ? [] : [input.reviewEvidencePath])];
      if (Object.keys(input).some(key => !keys.includes(key)) || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.launchId) ||
        !Object.hasOwn(roleStatus,input.role) || run.status !== roleStatus[input.role] || run.version !== expectedVersion ||
        input.repository !== run.repository || input.contractDigest !== run.contract?.digest ||
        input.expectedSha !== (input.role === 'implementer' ? run.baseSha : run.currentArtifactSha) ||
        paths.some(path => typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path || path.includes('\0')) ||
        !Number.isSafeInteger(input.createdAt) || input.createdAt < run.createdAt ||
        (input.role === 'critic' ? input.candidateBranch !== null || input.reviewEvidencePath === null :
          input.candidateBranch !== `${run.branch}-attempt-${input.launchId}` || input.reviewEvidencePath !== null)) {
        throw new GauntletInvariantError('invalid workspace preparation identity');
      }
      assertFullSha(input.expectedSha);
      const previous = db.prepare('SELECT body_json FROM gauntlet_preparations WHERE launch_id=?').get(input.launchId) as {body_json:string}|undefined;
      if (previous) { if(previous.body_json !== JSON.stringify(input)) throw new GauntletInvariantError('workspace preparation is immutable'); return; }
      if (this.pendingPreparations(input.runId).length || this.findLaunch(input.launchId)) throw new GauntletInvariantError('Incomplete workspace preparation requires inspection before another attempt');
      db.prepare('INSERT INTO gauntlet_preparations(launch_id,run_id,body_json) VALUES(?,?,?)').run(input.launchId,input.runId,JSON.stringify(input));
    })();
  }

  hasLaunchAtWorktree(path: string): boolean {
    return !!this.requireDb().prepare("SELECT 1 FROM gauntlet_launches WHERE json_extract(body_json, '$.worktreePath') = ? LIMIT 1").get(path);
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
    const run = JSON.parse(row.snapshotJson) as GauntletRun;
    // Compatibility for a pre-field snapshot already waiting to retry a
    // Repairer. Require matching transactional history AND launch metadata;
    // absence of the field alone never grants an extra attempt.
    if (run.pendingRepairRetry === undefined && run.status === 'needs_repair' &&
        run.currentLaunchId === null && run.currentArtifactSha && run.infrastructureRetries > 0 &&
        run.repairRound > 0 && run.repairRound <= run.limits.maxRepairRounds) {
      const rows = db.prepare('SELECT sequence, event_json FROM gauntlet_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 2')
        .all(runId) as Array<{ sequence: number; event_json: string }>;
      if (rows.length === 2 && rows[0].sequence === run.version && rows[1].sequence === run.version - 1) {
        const failed = JSON.parse(rows[0].event_json) as GauntletEvent;
        const started = JSON.parse(rows[1].event_json) as GauntletEvent;
        if (failed.type === 'INFRASTRUCTURE_FAILED' && failed.retryable && started.type === 'REPAIR_LAUNCHED' &&
            started.expectedSha === run.currentArtifactSha) {
          const launch = this.findLaunch(started.launchId);
          if (launch?.runId === runId && launch.role === 'repairer' && ['failed', 'timed_out'].includes(launch.status) &&
              launch.expectedSha === run.currentArtifactSha) {
            run.pendingRepairRetry = { launchId: launch.id, artifactSha: run.currentArtifactSha, round: run.repairRound };
          }
        }
      }
    }
    return this.withRuntimeProjection(run);
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
  if (event.type === 'CONDUCTOR_PREPARED' &&
      (records.launch?.id !== event.launchId || records.launch.role !== 'conductor')) {
    throw new GauntletInvariantError('CONDUCTOR_PREPARED must persist the same Conductor launch');
  }
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

const PREPARATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS gauntlet_preparations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    launch_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id),
    body_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS gauntlet_preparations_run ON gauntlet_preparations(run_id, sequence);
  CREATE TRIGGER IF NOT EXISTS gauntlet_preparations_no_update BEFORE UPDATE ON gauntlet_preparations
    BEGIN SELECT RAISE(ABORT, 'workspace preparation is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS gauntlet_preparations_no_delete BEFORE DELETE ON gauntlet_preparations
    BEGIN SELECT RAISE(ABORT, 'workspace preparation is immutable'); END;
`;

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

  CREATE TABLE IF NOT EXISTS gauntlet_runtime_observations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id),
    launch_id TEXT NOT NULL REFERENCES gauntlet_launches(id),
    kind TEXT NOT NULL,
    message_id TEXT NOT NULL,
    body_json TEXT NOT NULL,
    UNIQUE(launch_id, kind, message_id)
  );
  CREATE INDEX IF NOT EXISTS gauntlet_runtime_by_run ON gauntlet_runtime_observations(run_id, sequence);
  CREATE UNIQUE INDEX IF NOT EXISTS gauntlet_native_thread_unique
    ON gauntlet_runtime_observations(json_extract(body_json,'$.event.threadId'))
    WHERE kind='native_identity' AND message_id='thread';
  CREATE UNIQUE INDEX IF NOT EXISTS gauntlet_native_turn_unique
    ON gauntlet_runtime_observations(json_extract(body_json,'$.event.turnId'))
    WHERE kind='native_identity' AND message_id='turn';
  CREATE UNIQUE INDEX IF NOT EXISTS gauntlet_all_native_turns_unique
    ON gauntlet_runtime_observations(json_extract(body_json,'$.event.turnId'))
    WHERE kind='native_identity' AND json_extract(body_json,'$.event.turnId') IS NOT NULL;

  CREATE TABLE IF NOT EXISTS gauntlet_preservations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES gauntlet_runs(id) ON DELETE CASCADE,
    launch_id TEXT NOT NULL REFERENCES gauntlet_launches(id),
    request_id TEXT NOT NULL,
    stage TEXT NOT NULL CHECK(stage IN ('requested', 'finished')),
    body_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(request_id, stage)
  );
  CREATE INDEX IF NOT EXISTS idx_gauntlet_preservations_run ON gauntlet_preservations(run_id, sequence);

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
