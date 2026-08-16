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
  StartGauntletInput
} from '../../shared/gauntlet';
import { DEFAULT_ROLE_PROVIDERS } from '../../shared/gauntlet';
import type { AgentProvider } from '../../shared/agentProvider';
import { createGauntletRun, freezeContract, GauntletInvariantError } from './core';
import { GauntletStore } from './store';
import { ArtifactWorkspace, runFrozenChecks } from './worktree';
import { PrimitiveRegistry } from './primitiveRegistry';
import { SkillDepot } from './skillDepot';
import { buildCriticPrompt, buildWorkerPrompt } from './prompts';

export interface PreparedLaunch {
  launch: AgentLaunch;
  token: string;
  prompt: string;
}

export class LocalGauntletBackend {
  readonly store: GauntletStore;
  readonly workspaces: ArtifactWorkspace;
  readonly primitives: PrimitiveRegistry;
  readonly skills: SkillDepot;

  constructor(input: {
    stateRoot: string;
    primitiveRoot: string;
    primitiveExpectedCommit?: string | null;
  }) {
    this.store = new GauntletStore(join(input.stateRoot, 'gauntlet.db'));
    this.workspaces = new ArtifactWorkspace(join(input.stateRoot, 'worktrees', 'gauntlet'));
    this.primitives = input.primitiveExpectedCommit === undefined
      ? new PrimitiveRegistry(input.primitiveRoot)
      : new PrimitiveRegistry(input.primitiveRoot, input.primitiveExpectedCommit);
    this.skills = new SkillDepot(join(input.stateRoot, 'skill-depot'));
  }

  open(): void {
    this.store.open();
    this.skills.initialize();
  }

  close(): void {
    this.store.close();
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
    return this.store.listRuns();
  }

  reconcileAfterRestart(): GauntletRunSnapshot[] {
    return this.store.listRecoverableRuns().map((run) => {
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
    const contract = freezeContract(input, conductorLaunchId);
    const next = this.store.transition(runId, snapshot.run.version, {
      type: 'BAR_FROZEN', at: Date.now(), contract
    }, { contract });
    return next;
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
    const workspace = this.workspaces.createCritic({ repository: snapshot.run.repository, runId, launchId: safeLaunchId(id), artifactSha });
    const token = issueToken();
    const capability = capabilityFor('critic', provider);
    const launch: AgentLaunch = {
      id, runId, role: 'critic', provider, model: snapshot.run.providers.critic.model,
      sessionId: randomUUID(), worktreePath: workspace.path,
      expectedSha: artifactSha, tokenHash: hashToken(token), capability, status: 'running', createdAt: Date.now()
    };
    const primitive = this.primitives.resolveGeneralEngineeringCritic(provider === 'claude' ? 'claude' : 'codex');
    const prompt = buildCriticPrompt({
      runId, launchId: id, artifactSha, baseSha: snapshot.run.baseSha,
      requestedObjective: snapshot.run.requestedObjective,
      contract: snapshot.run.contract, primitivePrompt: primitive.prompt
    });
    this.store.transition(runId, snapshot.run.version, {
      type: 'CRITIC_LAUNCHED', at: Date.now(), launchId: id, artifactSha
    }, { launch });
    return { launch, token, prompt };
  }

  async completeArtifact(input: { runId: string; launchId: string; token: string; sha: string }): Promise<GauntletRunSnapshot> {
    const snapshot = this.store.snapshot(input.runId);
    requireContract(snapshot);
    const launch = authorize(snapshot, input.launchId, input.token, ['implementer', 'repairer']);
    if (input.sha !== this.workspaces.resolveSha(launch.worktreePath)) throw new GauntletInvariantError('completion SHA does not match worktree HEAD');
    const expectedParent = launch.expectedSha;
    const workspace = {
      repository: snapshot.run.repository,
      path: launch.worktreePath,
      branch: snapshot.run.branch,
      expectedSha: expectedParent,
      mode: 'candidate' as const
    };
    const validated = this.workspaces.validateArtifact(workspace, expectedParent);
    if (validated.sha !== input.sha) throw new GauntletInvariantError('completion SHA changed during validation');
    const checks = await runFrozenChecks(launch.worktreePath, snapshot.run.contract.checks);
    const afterChecks = this.workspaces.validateArtifact(workspace, expectedParent);
    if (afterChecks.sha !== validated.sha) {
      throw new GauntletInvariantError('frozen checks changed the artifact HEAD');
    }
    const artifact: Artifact = {
      id: randomUUID(), runId: input.runId, sha: validated.sha, parentSha: expectedParent,
      branch: snapshot.run.branch, producedByLaunchId: launch.id, diffSummary: validated.diffSummary,
      checkReceipts: checks, createdAt: Date.now()
    };
    const next = this.store.transition(input.runId, snapshot.run.version, {
      type: 'ARTIFACT_RECORDED', at: Date.now(), launchId: launch.id,
      role: launch.role as 'implementer' | 'repairer', artifactSha: artifact.sha, parentSha: artifact.parentSha
    }, { artifact });
    this.releaseCompletedWorkspace(workspace, 'artifact recorded; cleanup could not remove the completed worktree');
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
    this.releaseCompletedWorkspace({
      repository: snapshot.run.repository, path: launch.worktreePath, branch: null,
      expectedSha: launch.expectedSha, mode: 'critic'
    }, 'critic report recorded; cleanup could not remove the review worktree');
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

  cancel(runId: string, reason: string): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(runId);
    const preserveError = this.preserveCurrentLaunch(snapshot, reason);
    if (preserveError) reason = `${reason}; ${preserveError}`;
    return this.store.transition(runId, snapshot.run.version, {
      type: 'CANCELLED', at: Date.now(), reason: bounded(reason, 10_000)
    });
  }

  escalate(runId: string, reason: string): GauntletRunSnapshot {
    const snapshot = this.store.snapshot(runId);
    const preserveError = this.preserveCurrentLaunch(snapshot, reason);
    if (preserveError) reason = `${reason}; ${preserveError}`;
    return this.store.transition(runId, snapshot.run.version, {
      type: 'HUMAN_ESCALATED', at: Date.now(), reason: bounded(reason, 10_000)
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

  private preserveCurrentLaunch(snapshot: GauntletRunSnapshot, reason: string): string | null {
    const launch = snapshot.launches.find((candidate) => candidate.id === snapshot.run.currentLaunchId);
    if (!launch) return null;
    try {
      this.workspaces.preserveFailure({
        repository: snapshot.run.repository,
        path: launch.worktreePath,
        branch: launch.role === 'critic' ? null : snapshot.run.branch,
        expectedSha: launch.expectedSha,
        mode: launch.role === 'critic' ? 'critic' : 'candidate'
      }, reason);
      return null;
    } catch (error) {
      return `active launch worktree could not be detached/locked: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private releaseCompletedWorkspace(
    workspace: Parameters<ArtifactWorkspace['release']>[0],
    reason: string
  ): void {
    try {
      this.workspaces.release(workspace);
    } catch (error) {
      // The protocol transition already committed. Preserve the checkout and,
      // for candidate branches, detach it so a later bounded repair can proceed.
      try { this.workspaces.preserveFailure(workspace, reason); } catch { /* retained for manual diagnosis */ }
      console.error(`[gauntlet] ${reason}:`, error);
    }
  }

  private prepareWorker(snapshot: GauntletRunSnapshot, role: 'implementer' | 'repairer', expectedSha: string, packet?: RepairPacket): PreparedLaunch {
    const provider = roleProvider(snapshot.run, role);
    const id = randomUUID();
    const workspace = this.workspaces.createCandidate({
      repository: snapshot.run.repository, runId: snapshot.run.id, launchId: safeLaunchId(id),
      branch: snapshot.run.branch, expectedSha
    });
    const token = issueToken();
    const launch: AgentLaunch = {
      id, runId: snapshot.run.id, role, provider, model: snapshot.run.providers[role].model,
      sessionId: randomUUID(), worktreePath: workspace.path,
      expectedSha, tokenHash: hashToken(token), capability: capabilityFor(role, provider),
      status: 'running', createdAt: Date.now()
    };
    const prompt = buildWorkerPrompt({
      role, runId: snapshot.run.id, launchId: id, expectedSha,
      requestedObjective: snapshot.run.requestedObjective,
      contract: snapshot.run.contract!, repairPacket: packet
    });
    this.store.transition(snapshot.run.id, snapshot.run.version, role === 'implementer'
      ? { type: 'IMPLEMENTER_LAUNCHED', at: Date.now(), launchId: id, expectedSha }
      : { type: 'REPAIR_LAUNCHED', at: Date.now(), launchId: id, expectedSha }, { launch });
    return { launch, token, prompt };
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
