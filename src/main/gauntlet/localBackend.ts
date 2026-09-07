import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type {
  AgentLaunch,
  Artifact,
  CapabilityReceipt,
  CriticFinding,
  CriticReport,
  FrozenRunContractInput,
  GauntletRole,
  GauntletRun,
  GauntletRunSnapshot,
  GauntletVerdict,
  LeadAcknowledgment,
  LeadDecision,
  RepairPacket,
  RoleSkillAssignment,
  SkillLockReceipt,
  StartGauntletInput,
  WorkspacePreservationReceipt
} from '../../shared/gauntlet';
import { DEFAULT_ROLE_PROVIDERS } from '../../shared/gauntlet';
import type { AgentProvider } from '../../shared/agentProvider';
import { applyGauntletEvent, createGauntletRun, freezeContract, GauntletInvariantError } from './core';
import { GauntletStore } from './store';
import { ArtifactWorkspace, canonicalPlannedPath, runFrozenChecks } from './worktree';
import { PrimitiveRegistry } from './primitiveRegistry';
import { SkillDepot } from './skillDepot';
import { buildConductorOrientationPrompt, buildCriticPrompt, buildWorkerPrompt } from './prompts';
import { captureGitReviewEvidence, validateGitReviewEvidence } from './gitEvidence';
import { commitCandidate, inspectCommittedCandidate } from './commitCandidate';

export interface PreparedLaunch {
  launch: AgentLaunch;
  token: string;
  prompt: string;
  skillLock?: SkillLockReceipt;
}

export class LocalGauntletBackend {
  // A persisted token hash alone never grants authority after process restart.
  // Reattachment/resume is deliberately unavailable until its lifecycle is proven.
  private readonly liveConductors = new Set<string>();
  private readonly completing = new Map<string, {
    controller: AbortController;
    preserve?: { snapshot: GauntletRunSnapshot; reason: string; request: WorkspacePreservationReceipt };
  }>();
  private readonly onEvidence?: (snapshot: GauntletRunSnapshot) => void;
  private readonly reviewEvidenceRoot: string;
  readonly store: GauntletStore;
  readonly workspaces: ArtifactWorkspace;
  readonly primitives: PrimitiveRegistry;
  readonly skills: SkillDepot;

  constructor(input: {
    stateRoot: string;
    primitiveRoot: string;
    primitiveExpectedCommit?: string | null;
    onEvidence?: (snapshot: GauntletRunSnapshot) => void;
  }) {
    this.onEvidence = input.onEvidence;
    const stateRoot = canonicalPlannedPath(input.stateRoot);
    this.reviewEvidenceRoot = join(stateRoot, 'review-evidence');
    this.store = new GauntletStore(join(stateRoot, 'gauntlet.db'));
    this.workspaces = new ArtifactWorkspace(join(stateRoot, 'worktrees', 'gauntlet'));
    this.primitives = input.primitiveExpectedCommit === undefined
      ? new PrimitiveRegistry(input.primitiveRoot)
      : new PrimitiveRegistry(input.primitiveRoot, input.primitiveExpectedCommit);
    this.skills = new SkillDepot(join(input.stateRoot, 'skill-depot'));
  }

  open(): void {
    if (this.completing.size) throw new GauntletInvariantError('cannot reopen while artifact operations are draining');
    this.store.open();
    this.skills.initialize();
  }

  close(): void {
    this.liveConductors.clear();
    for (const completion of this.completing.values()) completion.controller.abort(new Error('Gauntlet backend is closing'));
    this.store.close();
  }

  isCompleting(runId: string): boolean {
    return this.completing.has(runId);
  }

  start(input: StartGauntletInput, assignments: RoleSkillAssignment[] = []): GauntletRunSnapshot {
    const repository = this.workspaces.resolveRepository(input.repository);
    const baseSha = this.workspaces.resolveSha(repository, input.baseRef ?? 'HEAD');
    const id = randomUUID();
    const run = createGauntletRun({
      id,
      repository,
      objective: input.objective,
      branch: `operatus/gauntlet/${id}`,
      baseSha,
      limits: input.limits,
      providers: input.providers
    });
    // Resolve the complete immutable skill set before a run becomes visible.
    // An invalid assignment must not strand an unstartable `orienting` row.
    const skillLock = assignments.length ? this.skills.lock(run.id, assignments) : undefined;
    this.store.createRun(run);
    if (skillLock) this.store.saveSkillLock(skillLock);
    return this.store.snapshot(id);
  }

  status(runId: string): GauntletRunSnapshot {
    return this.store.snapshot(runId);
  }

  list(): GauntletRun[] {
    return this.store.listOperatorRuns();
  }

  activeRuns(): GauntletRun[] {
    return this.store.listRecoverableRuns();
  }

  reconcileAfterRestart(): GauntletRunSnapshot[] {
    for (const observed of this.store.unclosedProcessObservations()) {
      const run = this.status(observed.runId).run;
      if (run.conductorLaunchId && this.liveConductors.has(run.conductorLaunchId)) continue;
      this.store.recordRuntimeObservation({ runId: observed.runId, launchId: observed.launchId,
        sessionId: observed.sessionId, at: Date.now(), event: { type: 'recovery_interrupted' } });
    }
    // This includes cancelled/terminal runs: a crash may have interrupted
    // their cleanup after the terminal transition was already durable.
    for (const request of this.store.unfinishedPreservations()) {
      const error = this.preserveCurrentLaunch(this.status(request.runId), request.reason, request);
      if (error) console.error('[gauntlet] preservation recovery:', error);
    }
    return this.store.listRecoverableRuns().map((run) => {
      if (this.store.pendingPreparations(run.id).length) {
        return this.escalate(run.id, 'Workspace preparation was interrupted before a launch was recorded. Inspect the intended locations; automatic retry and cleanup are unavailable');
      }
      if (run.conductorLaunchId && !this.liveConductors.has(run.conductorLaunchId)) {
        return this.escalate(run.id, 'Conductor session was interrupted by restart; explicit recovery is required');
      }
      if (['implementer_in_flight', 'critic_in_flight', 'repair_in_flight'].includes(run.status)) {
        return this.infrastructureFailure(run.id, `Operatus restarted while ${run.status.replaceAll('_', ' ')}`, true);
      }
      return this.status(run.id);
    });
  }

  sweepTimeouts(now = Date.now()): GauntletRunSnapshot[] {
    const changed: GauntletRunSnapshot[] = [];
    for (const run of this.store.listRecoverableRuns()) {
      if (now - run.createdAt >= run.limits.runTimeoutMs) {
        changed.push(this.infrastructureFailure(run.id, `overall run budget exceeded (${run.limits.runTimeoutMs} ms)`, false));
        continue;
      }
      if (!run.currentLaunchId) continue;
      const snapshot = this.status(run.id);
      const launch = snapshot.launches.find((candidate) => candidate.id === run.currentLaunchId);
      if (!launch) {
        changed.push(this.infrastructureFailure(run.id, 'current launch record is missing', false));
        continue;
      }
      const limit = launch.role === 'critic' ? run.limits.criticTimeoutMs : run.limits.workerTimeoutMs;
      if (now - launch.createdAt >= limit) {
        changed.push(this.infrastructureFailure(run.id, `${launch.role} timed out after ${limit} ms`, true));
      }
    }
    return changed;
  }

  freeze(runId: string, input: FrozenRunContractInput, conductorLaunchId = 'conductor'): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(runId);
    if (snapshot.run.conductorLaunchId && snapshot.run.conductorLaunchId !== conductorLaunchId) throw new GauntletInvariantError('wrong Conductor launch');
    const contract = freezeContract(input, conductorLaunchId);
    const next = this.store.transition(runId, snapshot.run.version, {
      type: 'BAR_FROZEN', at: Date.now(), contract
    }, { contract });
    return next;
  }

  /** Main-only preparation. Records intended identity, not proof of a live PID. */
  prepareConductor(runId: string): PreparedLaunch {
    const { run } = this.status(runId);
    if (run.status !== 'orienting' || run.conductorLaunchId) throw new GauntletInvariantError('Conductor must be prepared once before bar freeze');
    const token = issueToken();
    const launch: AgentLaunch = {
      id: randomUUID(), runId, role: 'conductor', ...run.providers.conductor,
      sessionId: randomUUID(), worktreePath: run.repository, expectedSha: run.baseSha,
      tokenHash: hashToken(token), status: 'created', createdAt: Date.now(),
      capability: { filesystem: 'advisory', cleanContext: 'advisory', toolRestrictions: 'advisory',
        notes: ['Prepared identity only. Native process and sandbox admission must be recorded separately.'] }
    };
    this.store.transition(runId, run.version, { type: 'CONDUCTOR_PREPARED', at: launch.createdAt, launchId: launch.id }, { launch });
    this.liveConductors.add(launch.id);
    return { launch, token, skillLock: this.status(runId).skillLock, prompt: buildConductorOrientationPrompt({ runId, launchId: launch.id,
      repository: run.repository, baseSha: run.baseSha, objective: run.requestedObjective }) };
  }

  withConductorAuthority(runId: string, launchId: string, token: string, command: () => GauntletRunSnapshot): GauntletRunSnapshot {
    if (!this.liveConductors.has(launchId)) throw new GauntletInvariantError('invalid Conductor authority');
    return this.store.withConductorAuthority(runId, launchId, token, command);
  }

  /** Called by the owning launcher on exit or failed admission. Idempotent;
   * losing the lead cannot silently permit more autonomous rounds. */
  releaseConductor(runId: string, launchId: string, reason: string): GauntletRunSnapshot {
    const snapshot = this.status(runId);
    if (snapshot.run.conductorLaunchId !== launchId) throw new GauntletInvariantError('wrong Conductor launch');
    const owned = this.liveConductors.delete(launchId);
    if (!owned || ['passed', 'human_required', 'infrastructure_failure', 'cancelled'].includes(snapshot.run.status)) return snapshot;
    return this.escalate(runId, reason);
  }

  prepareImplementer(runId: string): PreparedLaunch {
    const snapshot = this.store.snapshot(runId);
    requireContract(snapshot);
    requireRunStatus(snapshot, 'awaiting_implementation');
    const expectedSha = snapshot.run.baseSha;
    return this.prepareWorker(snapshot, 'implementer', expectedSha);
  }

  prepareRepairer(runId: string, packet: RepairPacket): PreparedLaunch {
    const snapshot = this.store.snapshot(runId);
    requireContract(snapshot);
    requireRunStatus(snapshot, 'needs_repair');
    if (packet.runId !== runId || packet.expectedSha !== snapshot.run.currentArtifactSha || packet.contractDigest !== snapshot.run.contract.digest) {
      throw new GauntletInvariantError('repair packet is stale or belongs to another run');
    }
    return this.prepareWorker(snapshot, 'repairer', packet.expectedSha, packet);
  }

  prepareCritic(runId: string): PreparedLaunch {
    const snapshot = this.store.snapshot(runId);
    requireContract(snapshot);
    requireRunStatus(snapshot, 'awaiting_critic');
    const artifactSha = snapshot.run.currentArtifactSha;
    if (!artifactSha) throw new GauntletInvariantError('run has no artifact to critique');
    const provider = roleProvider(snapshot.run, 'critic');
    const id = randomUUID();
    this.store.recordPreparation({ launchId:id, runId, role:'critic', repository:snapshot.run.repository,
      expectedSha:artifactSha, contractDigest:snapshot.run.contract.digest,
      worktreePath:this.workspaces.target(runId,safeLaunchId(id)), candidateBranch:null,
      reviewEvidencePath:join(this.reviewEvidenceRoot,runId,id), createdAt:Date.now() }, snapshot.run.version);
    const reviewEvidence = captureGitReviewEvidence({
      repository:snapshot.run.repository, destinationRoot:join(this.reviewEvidenceRoot, runId, id),
      baseSha:snapshot.run.baseSha, artifactSha, contractDigest:snapshot.run.contract.digest
    });
    const workspace = this.workspaces.createCritic({ repository: snapshot.run.repository, runId, launchId: safeLaunchId(id), artifactSha });
    const token = issueToken();
    const capability = capabilityFor('critic', provider);
    const launch: AgentLaunch = {
      id, runId, role: 'critic', provider, model: snapshot.run.providers.critic.model,
      sessionId: randomUUID(), worktreePath: workspace.path,
      expectedSha: artifactSha, reviewEvidence, tokenHash: hashToken(token), capability, status: 'running', createdAt: Date.now()
    };
    const primitive = this.primitives.resolveGeneralEngineeringCritic(provider === 'claude' ? 'claude' : 'codex');
    const prompt = buildCriticPrompt({
      runId, launchId: id, artifactSha, baseSha: snapshot.run.baseSha,
      requestedObjective: snapshot.run.requestedObjective,
      contract: snapshot.run.contract, primitivePrompt: primitive.prompt, reviewEvidence
    });
    this.store.transition(runId, snapshot.run.version, {
      type: 'CRITIC_LAUNCHED', at: Date.now(), launchId: id, artifactSha
    }, { launch });
    return { launch, token, prompt, skillLock: snapshot.skillLock };
  }

  async completeArtifact(input: { runId: string; launchId: string; token: string; sha: string }, signal?: AbortSignal): Promise<GauntletRunSnapshot> {
    return this.completeArtifactOperation(input, signal);
  }

  async commitWorkingArtifact(input: { runId: string; launchId: string; token: string; expectedSha: string; contractDigest: string; message: string }, signal?: AbortSignal): Promise<GauntletRunSnapshot> {
    signal?.throwIfAborted();
    const snapshot = this.status(input.runId);
    requireContract(snapshot);
    const launch = authorize(snapshot, input.launchId, input.token, ['implementer', 'repairer']);
    if (input.expectedSha !== launch.expectedSha || input.contractDigest !== snapshot.run.contract.digest) {
      throw new GauntletInvariantError('commit request has stale artifact or frozen bar identity');
    }
    const workspace = { repository:snapshot.run.repository, path:launch.worktreePath,
      branch:launch.candidateBranch ?? snapshot.run.branch, expectedSha:launch.expectedSha, mode:'candidate' as const };
    return this.completeArtifactOperation({...input,sha:input.expectedSha}, signal, completionSignal => commitCandidate(workspace,input.message,completionSignal));
  }

  private async completeArtifactOperation(input: { runId: string; launchId: string; token: string; sha: string }, signal?: AbortSignal, prepareSha?: (signal: AbortSignal) => Promise<string>): Promise<GauntletRunSnapshot> {
    signal?.throwIfAborted();
    // One commit/check operation per run, even across separate connections.
    // Authenticate before claiming; a forged receipt cannot abort real work.
    authorize(this.store.snapshot(input.runId), input.launchId, input.token, ['implementer', 'repairer']);
    if (this.completing.has(input.runId)) throw new GauntletInvariantError('artifact completion is already in progress');
    const completion: { controller: AbortController; preserve?: { snapshot: GauntletRunSnapshot; reason: string; request: WorkspacePreservationReceipt } } = { controller: new AbortController() };
    const abort = (): void => completion.controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    this.completing.set(input.runId, completion);
    try {
      const completionInput = prepareSha ? {...input,sha:await prepareSha(completion.controller.signal)} : input;
      return await this.completeArtifactChecked(completionInput, completion.controller.signal, !!prepareSha);
    } finally {
      signal?.removeEventListener('abort', abort);
      this.completing.delete(input.runId);
      // Wait for the Git/check process to close before detaching/locking its
      // worktree. Never inspect a newer launch when preserving this one.
      if (completion.preserve) {
        const error = this.preserveCurrentLaunch(completion.preserve.snapshot, completion.preserve.reason, completion.preserve.request);
        if (error) console.error('[gauntlet] interrupted check preservation:', error);
      }
    }
  }

  private async completeArtifactChecked(input: { runId: string; launchId: string; token: string; sha: string }, signal: AbortSignal, guardedGit = false): Promise<GauntletRunSnapshot> {
    signal.throwIfAborted();
    const snapshot = this.store.snapshot(input.runId);
    requireContract(snapshot);
    const launch = authorize(snapshot, input.launchId, input.token, ['implementer', 'repairer']);
    if (!guardedGit && input.sha !== this.workspaces.resolveSha(launch.worktreePath)) throw new GauntletInvariantError('completion SHA does not match worktree HEAD');
    const expectedParent = launch.expectedSha;
    const workspace = {
      repository: snapshot.run.repository,
      path: launch.worktreePath,
      branch: launch.candidateBranch ?? snapshot.run.branch,
      expectedSha: expectedParent,
      mode: 'candidate' as const
    };
    const validate = () => guardedGit ? inspectCommittedCandidate(workspace, signal) : this.workspaces.validateArtifact(workspace, expectedParent);
    const validated = await validate();
    signal.throwIfAborted();
    if (validated.sha !== input.sha) throw new GauntletInvariantError('completion SHA changed during validation');
    const checks = await runFrozenChecks(launch.worktreePath, snapshot.run.contract.checks, 100_000, signal);
    signal?.throwIfAborted();
    const afterChecks = await validate();
    signal.throwIfAborted();
    if (afterChecks.sha !== validated.sha) {
      throw new GauntletInvariantError('frozen checks changed the artifact HEAD');
    }
    const artifact: Artifact = {
      id: randomUUID(), runId: input.runId, sha: validated.sha, parentSha: expectedParent,
      branch: workspace.branch, producedByLaunchId: launch.id, diffSummary: validated.diffSummary,
      checkReceipts: checks, createdAt: Date.now()
    };
    const next = this.store.transition(input.runId, snapshot.run.version, {
      type: 'ARTIFACT_RECORDED', at: Date.now(), launchId: launch.id,
      role: launch.role as 'implementer' | 'repairer', artifactSha: artifact.sha, parentSha: artifact.parentSha
    }, { artifact });
    // A receipt is not process termination. The provider may still be using its
    // cwd, and candidate work is not integrated. Keep every completion path
    // intact until a separate lifecycle-owned cleanup can prove quiescence.
    return next;
  }

  submitCritic(input: {
    runId: string;
    launchId: string;
    token: string;
    artifactSha: string;
    contractDigest: string;
    verdict: GauntletVerdict;
    summary: string;
    findings: CriticFinding[];
  }): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(input.runId);
    requireContract(snapshot);
    if (!['PASS', 'REVISE', 'HUMAN_REQUIRED', 'INVALID_OR_STALE'].includes(input.verdict)) throw new GauntletInvariantError('invalid critic verdict');
    const launch = authorize(snapshot, input.launchId, input.token, ['critic']);
    if (launch.reviewEvidence) {
      try {
        if (launch.reviewEvidence.baseSha !== snapshot.run.baseSha || launch.reviewEvidence.artifactSha !== launch.expectedSha ||
          launch.reviewEvidence.contractDigest !== snapshot.run.contract.digest) throw new Error('review binding mismatch');
        validateGitReviewEvidence(launch.reviewEvidence);
      } catch {
        return this.infrastructureFailure(input.runId, 'Git review evidence changed or became unavailable; report rejected', true);
      }
    }
    try {
      this.workspaces.validateCriticUnchanged({
        repository: snapshot.run.repository,
        path: launch.worktreePath,
        branch: null,
        expectedSha: launch.expectedSha,
        mode: 'critic'
      });
    } catch (error) {
      return this.infrastructureFailure(
        input.runId,
        `critic worktree mutation invalidated the report: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    }
    const primitive = this.primitives.resolveGeneralEngineeringCritic(launch.provider === 'claude' ? 'claude' : 'codex');
    const report: CriticReport = {
      id: randomUUID(), runId: input.runId, launchId: launch.id,
      artifactSha: input.artifactSha, contractDigest: input.contractDigest,
      verdict: input.verdict, summary: bounded(input.summary, 20_000),
      findings: validateFindings(input.findings), primitiveReceipts: primitive.receipts, createdAt: Date.now()
    };
    const stale = input.artifactSha !== snapshot.run.currentArtifactSha || input.contractDigest !== snapshot.run.contract.digest;
    const next = this.store.transition(input.runId, snapshot.run.version, {
      type: 'CRITIC_REPORTED', at: Date.now(), reportId: report.id, launchId: launch.id,
      artifactSha: input.artifactSha, contractDigest: input.contractDigest,
      verdict: stale ? 'INVALID_OR_STALE' : input.verdict
    }, stale ? {} : { report });
    // Do not remove a live Critic's cwd when its report helper returns. The
    // launch receipt retains the exact worktree identity for later cleanup.
    return next;
  }

  acknowledge(input: {
    runId: string;
    reportId: string;
    conductorLaunchId: string;
    decision: LeadDecision;
    acceptedFindingIds: string[];
    rejectedFindings: Array<{ findingId: string; reason: string }>;
    rationale: string;
    repairInstructions?: string[];
  }): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(input.runId);
    requireContract(snapshot);
    const report = snapshot.reports.find((candidate) => candidate.id === input.reportId);
    if (snapshot.run.conductorLaunchId && snapshot.run.conductorLaunchId !== input.conductorLaunchId) throw new GauntletInvariantError('wrong Conductor launch');
    if (!report) throw new GauntletInvariantError('critic report not found');
    if (!['pass', 'repair', 'human_required'].includes(input.decision)) throw new GauntletInvariantError('invalid Conductor decision');
    const knownFindings = new Set(report.findings.map((finding) => finding.id));
    if (!Array.isArray(input.acceptedFindingIds) || input.acceptedFindingIds.length > 200) {
      throw new GauntletInvariantError('accepted findings must be an array of at most 200 items');
    }
    const accepted = new Set(input.acceptedFindingIds);
    if (accepted.size !== input.acceptedFindingIds.length) throw new GauntletInvariantError('accepted findings contain duplicates');
    for (const id of accepted) if (!knownFindings.has(id)) throw new GauntletInvariantError(`unknown accepted finding: ${id}`);
    if (!Array.isArray(input.rejectedFindings) || input.rejectedFindings.length > 200) {
      throw new GauntletInvariantError('rejected findings must be an array of at most 200 items');
    }
    const rejectedFindings = input.rejectedFindings.map((rejected) => ({
      findingId: String(rejected?.findingId ?? ''),
      reason: bounded(rejected?.reason, 10_000)
    }));
    const rejectedIds = new Set<string>();
    for (const rejected of rejectedFindings) if (!knownFindings.has(rejected.findingId)) {
      throw new GauntletInvariantError('rejected findings require a known id and reason');
    } else {
      if (accepted.has(rejected.findingId) || rejectedIds.has(rejected.findingId)) throw new GauntletInvariantError('findings must be acknowledged exactly once');
      rejectedIds.add(rejected.findingId);
    }
    if ([...knownFindings].some((id) => !accepted.has(id) && !rejectedIds.has(id))) throw new GauntletInvariantError('every critic finding requires explicit acknowledgment');
    if (input.decision === 'pass' && accepted.size > 0) {
      throw new GauntletInvariantError('a pass cannot retain accepted critic findings');
    }
    const acknowledgment: LeadAcknowledgment = {
      id: randomUUID(), runId: input.runId, reportId: report.id, launchId: input.conductorLaunchId,
      artifactSha: report.artifactSha, contractDigest: report.contractDigest,
      acceptedFindingIds: [...new Set(input.acceptedFindingIds)], rejectedFindings,
      decision: input.decision, rationale: bounded(input.rationale, 20_000), createdAt: Date.now()
    };
    let repairPacket: RepairPacket | undefined;
    if (input.decision === 'repair') {
      if (!Array.isArray(input.repairInstructions) || input.repairInstructions.length > 200) {
        throw new GauntletInvariantError('repair requires at most 200 bounded instructions');
      }
      const instructions = input.repairInstructions.map((value) => bounded(value, 4_000));
      if (!instructions.length || !acknowledgment.acceptedFindingIds.length) {
        throw new GauntletInvariantError('repair requires accepted findings and bounded instructions');
      }
      repairPacket = {
        id: randomUUID(), runId: input.runId, acknowledgmentId: acknowledgment.id,
        expectedSha: report.artifactSha, contractDigest: report.contractDigest,
        findingIds: acknowledgment.acceptedFindingIds, instructions,
        exclusions: snapshot.run.contract.exclusions, createdAt: Date.now()
      };
    }
    return this.store.transition(input.runId, snapshot.run.version, {
      type: 'LEAD_ACKNOWLEDGED', at: Date.now(), acknowledgmentId: acknowledgment.id,
      reportId: report.id, artifactSha: report.artifactSha, contractDigest: report.contractDigest,
      decision: input.decision
    }, { acknowledgment, repairPacket });
  }

  /** Human desktop IPC only; intentionally absent from worker control commands. */
  recordCandidateHandoff(runId: string, expectedVersion: number, artifactSha: string, reviewed: boolean, note: string): GauntletRunSnapshot {
    return this.store.transition(runId,expectedVersion,{
      type:'CANDIDATE_HANDOFF_RECORDED',at:Date.now(),artifactSha,reviewed,note
    });
  }

  /** Human desktop IPC only; intentionally absent from worker control commands. */
  reviewAttention(runId: string, expectedVersion: number, reviewed: boolean, note: string, runtimeSequence = 0): GauntletRunSnapshot {
    if (!Number.isSafeInteger(runtimeSequence) || runtimeSequence < 0) throw Error('invalid runtime review sequence');
    return this.store.transition(runId, expectedVersion, {
      type:'OPERATOR_REVIEW_RECORDED',at:Date.now(),reviewed,note,runtimeSequence
    });
  }

  cancel(runId: string, reason: string, conductorLaunchId?: string): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(runId);
    const preserveError = this.preserveCurrentLaunch(snapshot, reason);
    if (preserveError) reason = `${reason}; ${preserveError}`;
    return this.store.transition(runId, snapshot.run.version, {
      type: 'CANCELLED', at: Date.now(), reason: bounded(reason, 10_000), ...(conductorLaunchId ? { conductorLaunchId } : {})
    });
  }

  escalate(runId: string, reason: string, conductorLaunchId?: string): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(runId);
    const preserveError = this.preserveCurrentLaunch(snapshot, reason);
    if (preserveError) reason = `${reason}; ${preserveError}`;
    return this.store.transition(runId, snapshot.run.version, {
      type: 'HUMAN_ESCALATED', at: Date.now(), reason: bounded(reason, 10_000), ...(conductorLaunchId ? { conductorLaunchId } : {})
    });
  }

  infrastructureFailure(runId: string, reason: string, retryable = true): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(runId);
    const preserveError = this.preserveCurrentLaunch(snapshot, reason);
    if (preserveError) { reason = `${reason}; ${preserveError}`; retryable = false; }
    return this.store.transition(runId, snapshot.run.version, {
      type: 'INFRASTRUCTURE_FAILED', at: Date.now(), reason: bounded(reason, 10_000), retryable
    });
  }

  private preserveCurrentLaunch(snapshot: GauntletRunSnapshot, reason: string, priorRequest?: WorkspacePreservationReceipt): string | null {
    const launch = snapshot.launches.find((candidate) => candidate.id === (priorRequest?.launchId ?? snapshot.run.currentLaunchId));
    if (!launch) return null;
    const completion = this.completing.get(snapshot.run.id);
    if (completion?.preserve) return null;
    const id = randomUUID();
    const request: WorkspacePreservationReceipt = priorRequest ?? {
      id, requestId: id, runId: snapshot.run.id, launchId: launch.id, worktreePath: launch.worktreePath,
      candidateBranch: launch.role === 'critic' ? null : (launch.candidateBranch ?? snapshot.run.branch), expectedSha: launch.expectedSha,
      observedSha: null, dirty: null, outcome: 'pending', reason: reason.slice(0, 10000), error: null, createdAt: Date.now()
    };
    if (!priorRequest) this.store.recordPreservation(request);
    if (completion) {
      completion.preserve = { snapshot, reason, request };
      completion.controller.abort(new Error(`Artifact completion interrupted: ${reason}`));
      return null;
    }
    const workspace = {
      repository: snapshot.run.repository, path: launch.worktreePath, branch: request.candidateBranch,
      expectedSha: launch.expectedSha, mode: launch.role === 'critic' ? 'critic' as const : 'candidate' as const
    };
    let observation: { observedSha: string | null; dirty: boolean | null } = { observedSha: null, dirty: null };
    let error: string | null = null;
    let outcome: WorkspacePreservationReceipt['outcome'] = 'preserved';
    try {
      observation = this.workspaces.observePreservation(workspace);
      if (observation.observedSha === null) outcome = 'missing';
      else this.workspaces.preserveFailure(workspace, reason);
    } catch (failure) {
      outcome = 'failed';
      error = `active launch worktree could not be detached/locked: ${failure instanceof Error ? failure.message : String(failure)}`.slice(0, 10000);
    }
    try {
      this.store.recordPreservation({ ...request, id: randomUUID(), ...observation, outcome, error, createdAt: Date.now() });
      queueMicrotask(() => {
        try { this.onEvidence?.(this.store.snapshot(snapshot.run.id)); } catch { /* app may already have closed; pending/result remain durable */ }
      });
    } catch (failure) {
      return `preservation outcome could not be recorded: ${failure instanceof Error ? failure.message : String(failure)}`;
    }
    return error ?? (outcome === 'missing' ? 'active launch worktree is missing; no work was verified preserved' : null);
  }

  private prepareWorker(snapshot: GauntletRunSnapshot, role: 'implementer' | 'repairer', expectedSha: string, packet?: RepairPacket): PreparedLaunch {
    if (this.isCompleting(snapshot.run.id)) throw new GauntletInvariantError('previous frozen checks are still draining');
    const provider = roleProvider(snapshot.run, role);
    const id = randomUUID();
    const event = role === 'implementer'
      ? { type: 'IMPLEMENTER_LAUNCHED' as const, at: Date.now(), launchId: id, expectedSha }
      : { type: 'REPAIR_LAUNCHED' as const, at: Date.now(), launchId: id, expectedSha };
    // Reject known-illegal budget/identity transitions before creating Git
    // refs. SQLite repeats validation transactionally when the launch records.
    applyGauntletEvent(snapshot.run, event);
    requireContract(snapshot);
    this.store.recordPreparation({ launchId:id, runId:snapshot.run.id, role, repository:snapshot.run.repository,
      expectedSha, contractDigest:snapshot.run.contract.digest,
      worktreePath:this.workspaces.target(snapshot.run.id,safeLaunchId(id)),
      candidateBranch:`${snapshot.run.branch}-attempt-${id}`, reviewEvidencePath:null,
      createdAt:Date.now() }, snapshot.run.version);
    const workspace = this.workspaces.createCandidate({
      repository: snapshot.run.repository, runId: snapshot.run.id, launchId: safeLaunchId(id),
      branch: `${snapshot.run.branch}-attempt-${id}`, expectedSha, requireNewBranch: true
    });
    const token = issueToken();
    const launch: AgentLaunch = {
      id, runId: snapshot.run.id, role, provider, model: snapshot.run.providers[role].model,
      sessionId: randomUUID(), worktreePath: workspace.path,
      candidateBranch: workspace.branch!,
      expectedSha, tokenHash: hashToken(token), capability: capabilityFor(role, provider),
      status: 'running', createdAt: Date.now()
    };
    const prompt = buildWorkerPrompt({
      role, runId: snapshot.run.id, launchId: id, expectedSha,
      requestedObjective: snapshot.run.requestedObjective,
      contract: snapshot.run.contract!, repairPacket: packet
    });
    this.store.transition(snapshot.run.id, snapshot.run.version, event, { launch });
    return { launch, token, prompt, skillLock: snapshot.skillLock };
  }
}

function requireContract(snapshot: GauntletRunSnapshot): asserts snapshot is GauntletRunSnapshot & { run: GauntletRun & { contract: NonNullable<GauntletRun['contract']> } } {
  if (!snapshot.run.contract) throw new GauntletInvariantError('run contract is not frozen');
}

function requireRunStatus(snapshot: GauntletRunSnapshot, expected: GauntletRun['status']): void {
  if (snapshot.run.status !== expected) throw new GauntletInvariantError(`expected ${expected}, got ${snapshot.run.status}`);
}

function authorize(snapshot: GauntletRunSnapshot, launchId: string, token: string, roles: GauntletRole[]): AgentLaunch {
  const launch = snapshot.launches.find((candidate) => candidate.id === launchId);
  if (!launch || !roles.includes(launch.role)) throw new GauntletInvariantError('launch is not authorized for this operation');
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(launch.tokenHash, 'hex');
  if (actual.length !== expected.length || !cryptoTimingEqual(actual, expected)) throw new GauntletInvariantError('invalid launch token');
  if (snapshot.run.currentLaunchId !== launch.id) throw new GauntletInvariantError('launch is no longer current');
  return launch;
}

function cryptoTimingEqual(a: Buffer, b: Buffer): boolean {
  // Importing timingSafeEqual directly makes this helper easy to unit-stub while
  // retaining constant-time comparison in production.
  return timingSafeEqual(a, b);
}

function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeLaunchId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function roleProvider(run: GauntletRun, role: GauntletRole): AgentProvider {
  return run.providers[role]?.provider ?? DEFAULT_ROLE_PROVIDERS[role];
}

function capabilityFor(role: GauntletRole, provider: AgentProvider): CapabilityReceipt {
  if (role === 'critic' && provider === 'codex') {
    return {
      filesystem: 'enforced', cleanContext: 'enforced', toolRestrictions: 'partial',
      notes: ['fresh Codex process', 'read-only sandbox', 'worktree mutation is deterministically rejected']
    };
  }
  if (role === 'critic' && provider === 'claude') {
    return {
      filesystem: 'partial', cleanContext: 'enforced', toolRestrictions: 'partial',
      notes: ['fresh Claude session', 'plan-mode provider policy', 'worktree mutation is deterministically rejected']
    };
  }
  return {
    filesystem: 'advisory', cleanContext: 'enforced', toolRestrictions: 'advisory',
    notes: ['fresh role session', 'Git artifact scope is validated after completion', 'provider may have broader host filesystem access']
  };
}

function validateFindings(findings: CriticFinding[]): CriticFinding[] {
  if (!Array.isArray(findings) || findings.length > 200) throw new GauntletInvariantError('critic findings must be an array of at most 200 items');
  const ids = new Set<string>();
  return findings.map((finding) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(finding.id) || ids.has(finding.id)) {
      throw new GauntletInvariantError(`invalid or duplicate finding id: ${finding.id}`);
    }
    ids.add(finding.id);
    if (!['critical', 'major', 'minor', 'note'].includes(finding.severity)) throw new GauntletInvariantError('invalid finding severity');
    return {
      ...finding,
      title: bounded(finding.title, 1_000),
      evidence: bounded(finding.evidence, 10_000),
      criterionIds: validateCriterionIds(finding.criterionIds)
    };
  });
}

function validateCriterionIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new GauntletInvariantError('criterionIds must be an array of at most 100 items');
  return values.map((value) => bounded(String(value ?? ''), 256));
}

function bounded(value: string, max: number): string {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new GauntletInvariantError(`text must be within 1..${max} characters`);
  return result;
}
