import { createHash, randomUUID } from 'node:crypto';
import type {
  FrozenRunContract,
  FrozenRunContractInput,
  GauntletEvent,
  GauntletLimits,
  GauntletRole,
  GauntletRun
} from '../../shared/gauntlet';
import { DEFAULT_GAUNTLET_LIMITS, DEFAULT_ROLE_PROVIDERS } from '../../shared/gauntlet';
import type { AgentProvider } from '../../shared/agentProvider';

const FULL_SHA = /^[0-9a-f]{40}$/;
const TERMINAL = new Set(['passed', 'human_required', 'infrastructure_failure', 'cancelled']);
const GAUNTLET_PROVIDERS = new Set<AgentProvider>(['claude', 'codex']);

export class GauntletInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GauntletInvariantError';
  }
}

export function assertFullSha(value: string, label = 'sha'): void {
  if (!FULL_SHA.test(value)) throw new GauntletInvariantError(`${label} must be a full lowercase 40-character Git SHA`);
}

export function createGauntletRun(input: {
  id?: string;
  repository: string;
  objective: string;
  branch: string;
  baseSha: string;
  now?: number;
  limits?: Partial<GauntletLimits>;
  providers?: Partial<Record<GauntletRole, { provider: AgentProvider; model?: string }>>;
}): GauntletRun {
  assertFullSha(input.baseSha, 'baseSha');
  const now = input.now ?? Date.now();
  const objective = bounded(input.objective, 20_000, 'objective');
  if (!objective) throw new GauntletInvariantError('objective is required');
  const limits = normalizeLimits(input.limits);
  const providers = normalizeProviders(input.providers);
  return {
    id: input.id ?? randomUUID(),
    backend: 'local',
    repository: input.repository,
    requestedObjective: objective,
    branch: input.branch,
    baseSha: input.baseSha,
    currentArtifactSha: null,
    currentLaunchId: null,
    currentCriticReportId: null,
    contract: null,
    status: 'orienting',
    repairRound: 0,
    pendingRepairRetry: null,
    infrastructureRetries: 0,
    providers,
    limits,
    stopReason: null,
    version: 0,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeLimits(input?: Partial<GauntletLimits>): GauntletLimits {
  const limits = { ...DEFAULT_GAUNTLET_LIMITS, ...input };
  return {
    maxRepairRounds: clampInteger(limits.maxRepairRounds, 0, 20),
    maxInfrastructureRetries: clampInteger(limits.maxInfrastructureRetries, 0, 5),
    workerTimeoutMs: clampInteger(limits.workerTimeoutMs, 1, 24 * 60 * 60_000),
    criticTimeoutMs: clampInteger(limits.criticTimeoutMs, 1, 24 * 60 * 60_000),
    runTimeoutMs: clampInteger(limits.runTimeoutMs, 1, 7 * 24 * 60 * 60_000)
  };
}

function normalizeProviders(
  input?: Partial<Record<GauntletRole, { provider: AgentProvider; model?: string }>>
): GauntletRun['providers'] {
  return Object.fromEntries(
    (Object.keys(DEFAULT_ROLE_PROVIDERS) as GauntletRole[]).map((role) => {
      const configured = input?.[role];
      const provider = configured?.provider ?? DEFAULT_ROLE_PROVIDERS[role];
      if (!GAUNTLET_PROVIDERS.has(provider)) {
        throw new GauntletInvariantError(`${role} provider must be claude or codex`);
      }
      const model = configured?.model === undefined ? undefined : bounded(configured.model, 256, `${role} model`);
      return [role, model ? { provider, model } : { provider }];
    })
  ) as GauntletRun['providers'];
}

export function freezeContract(
  input: FrozenRunContractInput,
  frozenByLaunchId: string,
  frozenAt = Date.now()
): FrozenRunContract {
  const normalized: FrozenRunContractInput = {
    objective: bounded(input.objective, 20_000, 'objective'),
    criteria: normalizeStrings(input.criteria, 100, 4_000, 'criteria'),
    checks: normalizeChecks(input.checks),
    constraints: normalizeStrings(input.constraints, 100, 4_000, 'constraints'),
    exclusions: normalizeStrings(input.exclusions, 100, 4_000, 'exclusions')
  };
  if (!normalized.objective || normalized.criteria.length === 0) {
    throw new GauntletInvariantError('a frozen contract requires an objective and at least one observable criterion');
  }
  return {
    ...normalized,
    digest: createHash('sha256').update(stableStringify(normalized)).digest('hex'),
    frozenAt,
    frozenByLaunchId: bounded(frozenByLaunchId, 256, 'frozenByLaunchId')
  };
}

function normalizeChecks(checks: FrozenRunContractInput['checks']): FrozenRunContractInput['checks'] {
  if (!Array.isArray(checks) || checks.length > 100) throw new GauntletInvariantError('checks exceeds 100 items');
  const ids = new Set<string>();
  return checks.map((check) => {
    const id = bounded(check?.id, 128, 'check id');
    const name = bounded(check?.name, 256, 'check name');
    const command = bounded(check?.command, 4_000, 'check command');
    if (!id || !name || !command) throw new GauntletInvariantError('checks require an id, name, and command');
    if (ids.has(id)) throw new GauntletInvariantError(`duplicate check id: ${id}`);
    ids.add(id);
    return { id, name, command, timeoutMs: clampInteger(check.timeoutMs, 1_000, 60 * 60_000) };
  });
}

export function applyGauntletEvent(run: GauntletRun, event: GauntletEvent): GauntletRun {
  if (event.type === 'CANDIDATE_HANDOFF_RECORDED') {
    if (run.status !== 'passed') throw new GauntletInvariantError('only passed candidates have a handoff disposition');
    assertFullSha(event.artifactSha);
    if (event.artifactSha !== run.currentArtifactSha) throw new GauntletInvariantError('candidate changed; reload exact artifact before recording disposition');
    if (typeof event.reviewed !== 'boolean' || !Number.isSafeInteger(event.at) || event.at < run.updatedAt) throw new GauntletInvariantError('invalid candidate disposition');
    const note = bounded(event.note, 4000, 'candidate disposition note').trim();
    if (!note || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) throw new GauntletInvariantError('candidate disposition note is required and must be plain text');
    return { ...run, candidateHandoff: {artifactSha:event.artifactSha,reviewed:event.reviewed,note,at:event.at},
      version:run.version+1,updatedAt:event.at };
  }
  if (event.type === 'OPERATOR_REVIEW_RECORDED') {
    if (!TERMINAL.has(run.status) || (!['human_required','infrastructure_failure'].includes(run.status) && !run.runtimeAttention)) throw new GauntletInvariantError('only stopped attention runs can be reviewed');
    if ((event.runtimeSequence ?? 0) !== (run.runtimeAttention?.sequence ?? 0)) throw new GauntletInvariantError('runtime evidence changed; reload before reviewing');
    if (typeof event.reviewed !== 'boolean' || !Number.isSafeInteger(event.at) || event.at < run.updatedAt) throw new GauntletInvariantError('invalid operator review');
    const note = bounded(event.note, 4000, 'review note').trim();
    if (!note) throw new GauntletInvariantError('review note is required');
    return { ...run, operatorReview: {reviewed:event.reviewed,note,at:event.at,
      ...(event.runtimeSequence ? {runtimeSequence:event.runtimeSequence} : {})}, version:run.version+1,updatedAt:event.at };
  }
  if (TERMINAL.has(run.status)) throw new GauntletInvariantError(`run is terminal: ${run.status}`);
  if (event.at < run.createdAt) throw new GauntletInvariantError('event predates run creation');

  // A retry entitlement is one-use. Only a retryable Repairer failure creates
  // one; every subsequent legal transition consumes or clears it.
  const next: GauntletRun = { ...run, pendingRepairRetry: null, version: run.version + 1, updatedAt: event.at };
  switch (event.type) {
    case 'CONDUCTOR_PREPARED':
      requireStatus(run, 'orienting');
      if (run.conductorLaunchId) throw new GauntletInvariantError('run already has a Conductor launch');
      if (!event.launchId) throw new GauntletInvariantError('Conductor launch identity is required');
      next.conductorLaunchId = event.launchId;
      return next;

    case 'BAR_FROZEN':
      requireStatus(run, 'orienting');
      if (run.contract) throw new GauntletInvariantError('the run contract is already frozen');
      next.contract = structuredClone(event.contract);
      next.status = 'awaiting_implementation';
      return next;

    case 'IMPLEMENTER_LAUNCHED':
      requireStatus(run, 'awaiting_implementation');
      requireExpected(run, event.expectedSha, run.baseSha);
      next.currentLaunchId = event.launchId;
      next.status = 'implementer_in_flight';
      return next;

    case 'ARTIFACT_RECORDED': {
      const expectedStatus = event.role === 'implementer' ? 'implementer_in_flight' : 'repair_in_flight';
      requireStatus(run, expectedStatus);
      requireLaunch(run, event.launchId);
      assertFullSha(event.artifactSha, 'artifactSha');
      assertFullSha(event.parentSha, 'parentSha');
      const expectedParent = event.role === 'implementer' ? run.baseSha : run.currentArtifactSha;
      requireExpected(run, event.parentSha, expectedParent);
      if (event.artifactSha === event.parentSha) throw new GauntletInvariantError('worker produced no new artifact');
      next.currentArtifactSha = event.artifactSha;
      next.currentLaunchId = null;
      next.currentCriticReportId = null;
      next.status = 'awaiting_critic';
      return next;
    }

    case 'CRITIC_LAUNCHED':
      requireStatus(run, 'awaiting_critic');
      requireExpected(run, event.artifactSha, run.currentArtifactSha);
      next.currentLaunchId = event.launchId;
      next.status = 'critic_in_flight';
      return next;

    case 'CRITIC_REPORTED':
      requireStatus(run, 'critic_in_flight');
      requireLaunch(run, event.launchId);
      if (event.verdict === 'INVALID_OR_STALE' || event.artifactSha !== run.currentArtifactSha || event.contractDigest !== run.contract?.digest) {
        next.currentLaunchId = null;
        next.currentCriticReportId = null;
        next.status = 'awaiting_critic';
        return next;
      }
      next.currentLaunchId = null;
      next.currentCriticReportId = event.reportId;
      next.status = 'awaiting_lead_ack';
      return next;

    case 'LEAD_ACKNOWLEDGED':
      requireStatus(run, 'awaiting_lead_ack');
      requireExpected(run, event.reportId, run.currentCriticReportId);
      requireExpected(run, event.artifactSha, run.currentArtifactSha);
      requireExpected(run, event.contractDigest, run.contract?.digest);
      next.currentCriticReportId = null;
      if (event.decision === 'pass') next.status = 'passed';
      if (event.decision === 'human_required') {
        next.status = 'human_required';
        next.stopReason = 'Conductor requested human judgment';
      }
      if (event.decision === 'repair') {
        if (run.repairRound >= run.limits.maxRepairRounds) {
          next.status = 'human_required';
          next.stopReason = `repair limit reached (${run.limits.maxRepairRounds})`;
        } else {
          next.status = 'needs_repair';
        }
      }
      return next;

    case 'REPAIR_LAUNCHED':
      requireStatus(run, 'needs_repair');
      requireExpected(run, event.expectedSha, run.currentArtifactSha);
      if (run.pendingRepairRetry) {
        const retry = run.pendingRepairRetry;
        requireExpected(run, retry.artifactSha, run.currentArtifactSha);
        if (retry.round !== run.repairRound || retry.round < 1 || retry.round > run.limits.maxRepairRounds || run.infrastructureRetries < 1) {
          throw new GauntletInvariantError('invalid repair retry accounting');
        }
        if (event.launchId === retry.launchId) throw new GauntletInvariantError('repair retry requires a fresh launch');
      } else {
        if (run.repairRound >= run.limits.maxRepairRounds) throw new GauntletInvariantError('repair limit reached');
        next.repairRound = run.repairRound + 1;
      }
      next.currentLaunchId = event.launchId;
      next.status = 'repair_in_flight';
      return next;

    case 'HUMAN_ESCALATED':
      next.status = 'human_required';
      next.stopReason = bounded(event.reason, 10_000, 'escalation reason');
      next.currentLaunchId = null;
      return next;

    case 'INFRASTRUCTURE_FAILED':
      if (event.retryable && run.infrastructureRetries < run.limits.maxInfrastructureRetries) {
        next.infrastructureRetries = run.infrastructureRetries + 1;
        next.currentLaunchId = null;
        next.status = retryStatus(run.status);
        if (run.status === 'repair_in_flight') {
          if (!run.currentLaunchId || !run.currentArtifactSha) throw new GauntletInvariantError('repair retry is missing its launch or artifact');
          next.pendingRepairRetry = { launchId: run.currentLaunchId, artifactSha: run.currentArtifactSha, round: run.repairRound };
        }
      } else {
        next.status = 'infrastructure_failure';
        next.stopReason = bounded(event.reason, 10_000, 'failure reason');
        next.currentLaunchId = null;
      }
      return next;

    case 'CANCELLED':
      next.status = 'cancelled';
      next.stopReason = bounded(event.reason, 10_000, 'cancellation reason');
      next.currentLaunchId = null;
      return next;
  }
}

function retryStatus(status: GauntletRun['status']): GauntletRun['status'] {
  if (status === 'implementer_in_flight') return 'awaiting_implementation';
  if (status === 'critic_in_flight') return 'awaiting_critic';
  if (status === 'repair_in_flight') return 'needs_repair';
  throw new GauntletInvariantError(`state does not support an infrastructure retry: ${status}`);
}

function requireStatus(run: GauntletRun, expected: GauntletRun['status']): void {
  if (run.status !== expected) throw new GauntletInvariantError(`expected ${expected}, got ${run.status}`);
}

function requireLaunch(run: GauntletRun, launchId: string): void {
  requireExpected(run, launchId, run.currentLaunchId);
}

function requireExpected(_run: GauntletRun, actual: string, expected: string | null | undefined): void {
  if (!expected || actual !== expected) throw new GauntletInvariantError(`identity mismatch: expected ${expected ?? '<none>'}, got ${actual}`);
}

function bounded(value: string, max: number, label: string): string {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max) throw new GauntletInvariantError(`${label} exceeds ${max} characters`);
  return normalized;
}

function normalizeStrings(values: string[], maxItems: number, maxLength: number, label: string): string[] {
  if (!Array.isArray(values) || values.length > maxItems) throw new GauntletInvariantError(`${label} exceeds ${maxItems} items`);
  return values.map((value) => bounded(value, maxLength, label)).filter(Boolean);
}

function clampInteger(value: number, min: number, max: number): number {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new GauntletInvariantError(`number must be within ${min}..${max}`);
  }
  return number;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
