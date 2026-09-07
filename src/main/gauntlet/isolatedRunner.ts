import { createHash, randomUUID } from 'node:crypto';
import type { GauntletRunSnapshot, RuntimeEvent, ToolActivity, SubscriptionAdmissionEvidence, NativeSessionIdentity } from '../../shared/gauntlet';
import type { CodexFreshSessionRuntime } from '../codexFreshSession';
import type { ClaudeConductorSessionRuntime } from '../claudeConductorSession';
import type { ClaudeFreshSessionRuntime } from '../claudeFreshSession';
import type { LocalGauntletBackend, PreparedLaunch } from './localBackend';
import { buildConductorAcknowledgmentPrompt } from './prompts';
import { validateGitReviewEvidence } from './gitEvidence';
import { nativeSessionBudget, type NativeSessionBudget } from './sessionBudget';
import type { GauntletCapacity } from '../../shared/gauntletSchedule';

export type LeadHandle = (ReturnType<ClaudeConductorSessionRuntime['start']> | ReturnType<CodexFreshSessionRuntime['startConductor']>) & { orientationPrompt?: string };
export type WorkerHandle = ReturnType<ClaudeFreshSessionRuntime['start']> | ReturnType<CodexFreshSessionRuntime['start']>;
export interface IsolatedSessionFactory {
  readonly supportsLockedSkills?: boolean;
  readonly supportsCodexCritic?: boolean;
  readonly supportsCodexConductor?: boolean;
  conductor(prepared: PreparedLaunch, signal: AbortSignal, beforeSpawn: () => void, budget: () => NativeSessionBudget, activity: (event: ToolActivity) => void, admission: (event: SubscriptionAdmissionEvidence) => void, identity: (event: NativeSessionIdentity) => void): Promise<LeadHandle>;
  worker(prepared: PreparedLaunch, signal: AbortSignal, beforeSpawn: () => void, budget: () => NativeSessionBudget, activity: (event: ToolActivity) => void, admission: (event: SubscriptionAdmissionEvidence) => void, identity: (event: NativeSessionIdentity) => void): Promise<WorkerHandle>;
}
const terminal = (s: GauntletRunSnapshot) => ['passed', 'human_required', 'cancelled', 'infrastructure_failure'].includes(s.run.status);
const shutdownReason = 'Run interrupted by Operatus shutdown. Inspect retained work before starting a new run; automatic resume is unavailable.';
type Owned = {
  abort: AbortController; lead?: LeadHandle; worker?: WorkerHandle;
  leadLaunchId?: string; workerLaunchId?: string; done: Promise<void>;
  leadFinishing?: boolean;
  leadObserved?: Promise<void>;
  started: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
  preparationUncertain?: boolean;
  shutdownUncertain?: boolean;
};

/** One main-process lifecycle owner per run; separate runs can await their
 * native processes concurrently. Socket receipts remain the run authority.
 * A worker result, mailbox, or conversation result cannot pass a run. */
export class IsolatedGauntletRunner {
  private readonly runs = new Map<string, Owned>();
  private closing = false;
  private pumping = false;
  private readonly owner = randomUUID();
  constructor(private readonly backend: LocalGauntletBackend, private readonly sessions: IsolatedSessionFactory,
    private readonly hold: () => string | null, private readonly publish: (s: GauntletRunSnapshot) => void,
    private readonly capacityChanged: (s: GauntletCapacity) => void = () => {}) {
    backend.store.scheduler.recover();
  }

  capacity(): GauntletCapacity { return this.backend.store.scheduler.snapshot(); }
  configureCapacity(revision: number, limit: number): GauntletCapacity {
    if (this.closing) throw Error('Runtime is closing');
    this.backend.store.scheduler.configure(revision, limit); this.pump(); this.notifyCapacity(); return this.capacity();
  }
  releaseCapacity(runId: string, revision: number, reason: string): GauntletCapacity {
    if (this.closing) throw Error('Runtime is closing');
    if (this.backend.isCompleting(runId)) throw Error('Artifact operations are still draining; capacity cannot be released yet');
    this.backend.store.scheduler.releaseQuarantine(runId, revision, reason); this.pump(); this.notifyCapacity(); return this.capacity();
  }

  owns(runId: string): boolean { return this.runs.has(runId); }

  advance(runId: string): Promise<void> {
    const existing = this.runs.get(runId);
    if (existing) { this.pump(); return existing.done; }
    if (this.closing || this.hold()) return Promise.resolve();
    const snapshot = this.backend.status(runId);
    if (terminal(snapshot)) return Promise.resolve();
    this.backend.store.scheduler.enqueue(runId);
    // A quarantined/settled identity must not be adopted by a new callback.
    if (!this.capacity().dispatches.some(d => d.runId === runId && d.state === 'queued')) return Promise.resolve();
    const owned = this.waiter(runId);
    this.pump(); this.notifyCapacity();
    return owned.done;
  }

  private waiter(runId: string): Owned {
    const existing = this.runs.get(runId); if (existing) return existing;
    let resolve!: () => void, reject!: (error: unknown) => void;
    const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const owned: Owned = { abort: new AbortController(), done, started: false, resolve, reject };
    this.runs.set(runId, owned);
    // Restored FIFO entries may have no renderer/IPC waiter in this process.
    void done.catch(() => console.error('[gauntlet] Scheduled lifecycle failed; inspect run and capacity evidence'));
    return owned;
  }

  private notifyCapacity(): void { this.capacityChanged(this.capacity()); }

  private pump(): void {
    if (this.pumping || this.closing || this.hold()) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.closing || this.hold()) break;
        const id = this.backend.store.scheduler.claimNext(this.owner); if (!id) break;
        const owned = this.waiter(id); owned.started = true;
        void Promise.resolve().then(() => this.run(id, owned)).then(
          () => this.finished(id, owned), error => this.finished(id, owned, error));
      }
    } finally { this.pumping = false; }
  }

  private finished(id: string, owned: Owned, error?: unknown): void {
    try {
      this.backend.store.scheduler.finishOwned(id, this.owner,
        !!error || !!owned.preparationUncertain || !!owned.shutdownUncertain || this.backend.isCompleting(id));
      this.runs.delete(id);
      if (error) owned.reject(error); else owned.resolve();
      this.pump(); this.notifyCapacity();
    } catch (failure) {
      // Persisted running ownership remains occupied if settlement fails.
      this.runs.delete(id); owned.reject(failure);
    }
  }

  /** Receives authoritative snapshots, including human/remote cancellation.
   * Nonterminal receipts do not kill a process before its tool reply flushes. */
  observe(snapshot: GauntletRunSnapshot): void {
    const owned = this.runs.get(snapshot.run.id);
    if (terminal(snapshot)) {
      this.backend.store.scheduler.settleCancelled();
      if (owned && !owned.started) { this.runs.delete(snapshot.run.id); owned.resolve(); }
      this.notifyCapacity();
    }
    if (owned && terminal(snapshot) && snapshot.run.status !== 'passed') this.stop(owned);
    else if (owned?.workerLaunchId && snapshot.run.currentLaunchId !== owned.workerLaunchId &&
      snapshot.launches.some(launch => launch.id === owned.workerLaunchId && ['failed', 'timed_out', 'cancelled'].includes(launch.status))) {
      owned.worker?.stop();
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    const owned = [...this.runs.values()];
    for (const [id, run] of this.runs) {
      if (run.started) this.stop(run);
      else { this.runs.delete(id); run.resolve(); } // queued rows survive shutdown
    }
    await Promise.all(owned.map(run => run.done));
  }

  private stop(owned: Owned): void {
    owned.abort.abort(); owned.worker?.stop(); owned.lead?.stop();
  }

  private current(runId: string, owned: Owned): GauntletRunSnapshot {
    if (this.closing || owned.abort.signal.aborted || this.hold()) throw Error('Isolated run startup is held or cancelled');
    const snapshot = this.backend.status(runId);
    if (terminal(snapshot)) throw Error('Run is terminal');
    if (Date.now() - snapshot.run.createdAt >= snapshot.run.limits.runTimeoutMs) {
      this.publish(this.backend.infrastructureFailure(runId, 'Overall run budget exhausted before native advancement', false));
      throw Error('Overall run budget exhausted');
    }
    return snapshot;
  }

  private beforeSpawn(runId: string, owned: Owned, prepared: PreparedLaunch): void {
    const snapshot = this.current(runId, owned), launch = prepared.launch;
    const saved = snapshot.launches.find(item => item.id === launch.id);
    const currentId = launch.role === 'conductor' ? snapshot.run.conductorLaunchId : snapshot.run.currentLaunchId;
    if (launch.runId !== runId || currentId !== launch.id || saved?.sessionId !== launch.sessionId || saved.tokenHash !== launch.tokenHash ||
      saved.tokenHash !== createHash('sha256').update(prepared.token).digest('hex') ||
      saved.role !== launch.role || saved.provider !== launch.provider || saved.model !== launch.model ||
      saved.candidateBranch !== launch.candidateBranch || !['created', 'running'].includes(saved.status) ||
      saved.worktreePath !== launch.worktreePath || saved.expectedSha !== launch.expectedSha) throw Error('Isolated launch ownership changed');
  }

  private record(prepared: PreparedLaunch, event: RuntimeEvent): void {
    this.backend.store.recordRuntimeObservation({ runId: prepared.launch.runId, launchId: prepared.launch.id,
      sessionId: prepared.launch.sessionId, at: Date.now(), event });
    this.publish(this.backend.status(prepared.launch.runId));
  }

  private async deliver(owned: Owned, prepared: PreparedLaunch, text: string, reportId: string | null): Promise<boolean> {
    const messageId = randomUUID();
    this.record(prepared, { type: 'delivery_queued', messageId, purpose: reportId ? 'acknowledgment' : 'orientation',
      promptSha256: createHash('sha256').update(text).digest('hex'), reportId });
    let ok = false, result = '';
    try {
      const receipt = await owned.lead!.send(messageId, text); ok = receipt.ok; result = receipt.text;
      return ok;
    } finally {
      this.record(prepared, { type: 'delivery_completed', messageId, ok,
        resultSha256: createHash('sha256').update(result).digest('hex') });
    }
  }

  private async run(runId: string, owned: Owned): Promise<void> {
    try {
      const initial = this.current(runId, owned);
      if (initial.run.status !== 'orienting' || initial.run.conductorLaunchId) {
        throw Error('An isolated Conductor cannot resume an unowned run; explicit recovery is required');
      }
      // Never silently substitute Claude for the configured Codex Critic.
      if (Object.entries(initial.run.providers).some(([role,config]) => config.provider !== 'claude' &&
        !(config.provider === 'codex' && ((role === 'critic' && this.sessions.supportsCodexCritic) ||
          (role === 'conductor' && this.sessions.supportsCodexConductor))))) {
        throw Error('Isolated Codex subscription admission is not ready; configured providers were not substituted');
      }
      if (initial.skillLock?.entries.length && !this.sessions.supportsLockedSkills) throw Error('Locked skills require isolated profile materialization before this run can launch');
      const preparedLead = this.backend.prepareConductor(runId);
      owned.leadLaunchId = preparedLead.launch.id; this.publish(this.backend.status(runId));
      owned.preparationUncertain = true;
      owned.lead = await this.sessions.conductor(preparedLead, owned.abort.signal, () => this.beforeSpawn(runId, owned, preparedLead),
        () => nativeSessionBudget(this.current(runId, owned).run, preparedLead.launch),
        event => { if (!owned.abort.signal.aborted) this.record(preparedLead,event); },
        event => { this.beforeSpawn(runId, owned, preparedLead); this.record(preparedLead,event); },
        event => { this.beforeSpawn(runId, owned, preparedLead); this.record(preparedLead,event); });
      owned.preparationUncertain = false;
      // Loss of the lead during a worker round must stop that worker as well.
      owned.leadObserved = owned.lead.completion.then(exit => {
        if (!exit.processExited || exit.gatewayRevocation !== 'confirmed') owned.shutdownUncertain = true;
        this.record(preparedLead, { type: 'process_exited', reason: exit.reason, exitCode: exit.exitCode,
          processExited: exit.processExited, gatewayRevocation: exit.gatewayRevocation, descendantsQuiescent: false,
          ...(exit.output ? { output: exit.output } : {}) });
        const snapshot = this.backend.status(runId);
        if (!terminal(snapshot)) {
          this.publish(this.backend.releaseConductor(runId, preparedLead.launch.id, this.closing ? shutdownReason : 'Conductor process exited before the run ended'));
          this.stop(owned);
        }
      }).catch(() => { owned.shutdownUncertain = true; this.stop(owned); console.error('[gauntlet] Conductor exit evidence could not be persisted'); });
      if (owned.lead.pid) this.record(preparedLead, { type: 'process_started', pid: owned.lead.pid,
        model: owned.lead.receipt.model, profileSha256: owned.lead.receipt.profileSha256, boundarySha256: owned.lead.receipt.boundarySha256 });
      if (owned.abort.signal.aborted) { owned.lead.stop(); return; }
      if (!await this.deliver(owned, preparedLead, owned.lead.orientationPrompt ?? preparedLead.prompt, null)) throw Error('Conductor orientation failed');
      if (this.backend.status(runId).run.status === 'orienting') throw Error('Conductor finished orientation without freezing a bar or escalating');

      while (!terminal(this.backend.status(runId))) {
        const snapshot = this.current(runId, owned);
        if (snapshot.run.status === 'awaiting_lead_ack') {
          const report = snapshot.reports.find(r => r.id === snapshot.run.currentCriticReportId);
          if (!report) throw Error('Current Critic report is missing');
          const artifact = snapshot.artifacts.find(a => a.sha === report.artifactSha);
          const review = snapshot.launches.find(l => l.id === report.launchId)?.reviewEvidence;
          if (!artifact || !review || review.artifactSha !== report.artifactSha ||
            review.contractDigest !== report.contractDigest || review.baseSha !== snapshot.run.baseSha) {
            throw Error('Conductor exact artifact evidence is missing or mismatched');
          }
          validateGitReviewEvidence(review);
          if (!await this.deliver(owned, preparedLead, buildConductorAcknowledgmentPrompt(report, preparedLead.launch.id, { artifact, review }), report.id)) throw Error('Conductor acknowledgment turn failed');
          if (this.backend.status(runId).run.status === 'awaiting_lead_ack') throw Error('Conductor ended its turn without an explicit decision');
          continue;
        }
        let prepared: PreparedLaunch;
        if (snapshot.run.status === 'awaiting_implementation') prepared = this.backend.prepareImplementer(runId);
        else if (snapshot.run.status === 'awaiting_critic') prepared = this.backend.prepareCritic(runId);
        else if (snapshot.run.status === 'needs_repair') {
          const packet = snapshot.repairPackets.at(-1);
          if (!packet) throw Error('Acknowledged repair packet is missing');
          prepared = this.backend.prepareRepairer(runId, packet);
        } else throw Error(`No owned process for phase ${snapshot.run.status}`);
        owned.workerLaunchId = prepared.launch.id; this.publish(this.backend.status(runId));
        try {
          owned.preparationUncertain = true;
          owned.worker = await this.sessions.worker(prepared, owned.abort.signal, () => this.beforeSpawn(runId, owned, prepared),
            () => nativeSessionBudget(this.current(runId, owned).run, prepared.launch),
            event => { if (!owned.abort.signal.aborted && owned.workerLaunchId === prepared.launch.id) this.record(prepared,event); },
            event => { this.beforeSpawn(runId, owned, prepared); this.record(prepared,event); },
            event => { this.beforeSpawn(runId, owned, prepared); this.record(prepared,event); });
          owned.preparationUncertain = false;
          const worker = owned.worker;
          const observed = worker.completion.then(exit => {
            if (!exit.processExited || exit.gatewayRevocation !== 'confirmed') owned.shutdownUncertain = true;
            this.record(prepared, { type: 'process_exited', reason: exit.reason, exitCode: exit.exitCode,
              processExited: exit.processExited, gatewayRevocation: exit.gatewayRevocation, descendantsQuiescent: false,
              ...(exit.output ? { output: exit.output } : {}) });
            return exit;
          });
          // Attach a handler immediately even if start-receipt persistence fails.
          void observed.catch(() => { owned.shutdownUncertain = true; worker.stop(); });
          if (worker.receipt.pid) this.record(prepared, { type: 'process_started', pid: worker.receipt.pid,
            model: worker.receipt.model, profileSha256: worker.receipt.profileSha256, boundarySha256: worker.receipt.boundarySha256 });
          if (owned.abort.signal.aborted) owned.worker.stop();
          const exit = await observed;
          const current = this.backend.status(runId);
          if (terminal(current)) break;
          if (!exit.processExited || exit.gatewayRevocation !== 'confirmed') throw Error('Worker shutdown or gateway revocation was not confirmed');
          if (current.run.currentLaunchId === prepared.launch.id) {
            this.publish(this.backend.infrastructureFailure(runId, 'Worker exited without a valid scoped completion receipt', true));
          } else if (exit.status !== 'completed' && !current.launches.some(launch =>
            launch.id === prepared.launch.id && ['failed', 'timed_out'].includes(launch.status))) {
            // A valid artifact/report does not erase an unclean provider exit.
            throw Error('Worker failed after submitting its receipt');
          }
        } catch (error) {
          const current = this.backend.status(runId);
          if (terminal(current)) break;
          if (owned.preparationUncertain || owned.shutdownUncertain) {
            // A rejected factory supplied no drain handle. Do not overlap a fresh
            // retry with a native process whose existence/shutdown is unknown.
            this.publish(this.backend.infrastructureFailure(runId, 'Native preparation or shutdown is unconfirmed; inspect capacity before retrying', false));
            break;
          }
          if (current.run.currentLaunchId !== prepared.launch.id) throw error;
          this.publish(this.backend.infrastructureFailure(runId, 'Isolated worker launch or transport failed', true));
        } finally {
          if (owned.worker) { owned.worker.stop(); await owned.worker.completion; }
          owned.worker = undefined; owned.workerLaunchId = undefined;
        }
      }
      if (this.backend.status(runId).run.status === 'passed') { owned.lead.finish(); owned.leadFinishing = true; }
    } catch (error) {
      const snapshot = this.backend.status(runId);
      if (!terminal(snapshot)) this.publish(this.backend.escalate(runId, this.closing ? shutdownReason : error instanceof Error ? error.message : 'Isolated run failed'));
    } finally {
      const snapshot = this.backend.status(runId);
      if (snapshot.run.status !== 'passed' || !owned.leadFinishing) this.stop(owned);
      if (owned.worker) { owned.worker.stop(); await owned.worker.completion; }
      if (owned.lead) await owned.lead.completion;
      await owned.leadObserved;
      if (owned.leadLaunchId) this.backend.releaseConductor(runId, owned.leadLaunchId, 'Isolated Conductor ownership released');
    }
  }
}
