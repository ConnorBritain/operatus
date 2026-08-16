import type { AgentProvider } from './agentProvider';

export type GauntletRole = 'conductor' | 'implementer' | 'critic' | 'repairer';

export type GauntletStatus =
  | 'orienting'
  | 'awaiting_implementation'
  | 'implementer_in_flight'
  | 'awaiting_critic'
  | 'critic_in_flight'
  | 'awaiting_lead_ack'
  | 'needs_repair'
  | 'repair_in_flight'
  | 'passed'
  | 'human_required'
  | 'infrastructure_failure'
  | 'cancelled';

export type GauntletVerdict = 'PASS' | 'REVISE' | 'HUMAN_REQUIRED' | 'INVALID_OR_STALE';
export type EnforcementLevel = 'enforced' | 'partial' | 'advisory';

export interface FrozenCheck {
  id: string;
  name: string;
  command: string;
  timeoutMs: number;
}

export interface FrozenRunContractInput {
  objective: string;
  criteria: string[];
  checks: FrozenCheck[];
  constraints: string[];
  exclusions: string[];
}

export interface FrozenRunContract extends FrozenRunContractInput {
  digest: string;
  frozenAt: number;
  frozenByLaunchId: string;
}

export interface GauntletLimits {
  maxRepairRounds: number;
  maxInfrastructureRetries: number;
  workerTimeoutMs: number;
  criticTimeoutMs: number;
  runTimeoutMs: number;
}

export interface GauntletRun {
  id: string;
  backend: 'local' | 'roadmap';
  repository: string;
  requestedObjective: string;
  branch: string;
  baseSha: string;
  currentArtifactSha: string | null;
  currentLaunchId: string | null;
  currentCriticReportId: string | null;
  contract: FrozenRunContract | null;
  status: GauntletStatus;
  repairRound: number;
  infrastructureRetries: number;
  providers: Record<GauntletRole, { provider: AgentProvider; model?: string }>;
  limits: GauntletLimits;
  stopReason: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface CapabilityReceipt {
  filesystem: EnforcementLevel;
  cleanContext: EnforcementLevel;
  toolRestrictions: EnforcementLevel;
  notes: string[];
}

export interface AgentLaunch {
  id: string;
  runId: string;
  role: GauntletRole;
  provider: AgentProvider;
  model?: string;
  sessionId: string;
  worktreePath: string;
  expectedSha: string;
  tokenHash: string;
  capability: CapabilityReceipt;
  status: 'created' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  createdAt: number;
  finishedAt?: number;
}

export interface Artifact {
  id: string;
  runId: string;
  sha: string;
  parentSha: string;
  branch: string;
  producedByLaunchId: string;
  diffSummary: string;
  checkReceipts: CheckReceipt[];
  createdAt: number;
}

export interface CheckReceipt {
  checkId: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
}

export interface CriticFinding {
  id: string;
  severity: 'critical' | 'major' | 'minor' | 'note';
  title: string;
  evidence: string;
  criterionIds: string[];
  file?: string;
  line?: number;
}

export interface PrimitiveReceipt {
  primitiveId: string;
  sourceCommit: string;
  digest: string;
  enforcement: EnforcementLevel;
}

export interface CriticReport {
  id: string;
  runId: string;
  launchId: string;
  artifactSha: string;
  contractDigest: string;
  verdict: GauntletVerdict;
  summary: string;
  findings: CriticFinding[];
  primitiveReceipts: PrimitiveReceipt[];
  createdAt: number;
}

export type LeadDecision = 'pass' | 'repair' | 'human_required';

export interface LeadAcknowledgment {
  id: string;
  runId: string;
  reportId: string;
  launchId: string;
  artifactSha: string;
  contractDigest: string;
  acceptedFindingIds: string[];
  rejectedFindings: Array<{ findingId: string; reason: string }>;
  decision: LeadDecision;
  rationale: string;
  createdAt: number;
}

export interface RepairPacket {
  id: string;
  runId: string;
  acknowledgmentId: string;
  expectedSha: string;
  contractDigest: string;
  findingIds: string[];
  instructions: string[];
  exclusions: string[];
  createdAt: number;
}

export interface SkillLockEntry {
  sourceId: string;
  sourceCommit: string;
  skillName: string;
  relativePath: string;
  digest: string;
  role: GauntletRole;
}

export interface SkillLockReceipt {
  runId: string;
  entries: SkillLockEntry[];
  createdAt: number;
}

export interface SkillDepotSource {
  id: string;
  url: string;
  pinnedCommit: string;
  enabled: boolean;
  include: string[];
  optIn: string[];
}

export interface DepotSkill {
  sourceId: string;
  sourceCommit: string;
  name: string;
  description: string;
  relativePath: string;
  digest: string;
  optIn: boolean;
}

export interface RoleSkillAssignment {
  role: GauntletRole;
  sourceId: string;
  skillName: string;
}

export type GauntletEvent =
  | { type: 'BAR_FROZEN'; at: number; contract: FrozenRunContract }
  | { type: 'IMPLEMENTER_LAUNCHED'; at: number; launchId: string; expectedSha: string }
  | { type: 'ARTIFACT_RECORDED'; at: number; launchId: string; role: 'implementer' | 'repairer'; artifactSha: string; parentSha: string }
  | { type: 'CRITIC_LAUNCHED'; at: number; launchId: string; artifactSha: string }
  | { type: 'CRITIC_REPORTED'; at: number; reportId: string; launchId: string; artifactSha: string; contractDigest: string; verdict: GauntletVerdict }
  | { type: 'LEAD_ACKNOWLEDGED'; at: number; acknowledgmentId: string; reportId: string; artifactSha: string; contractDigest: string; decision: LeadDecision }
  | { type: 'REPAIR_LAUNCHED'; at: number; launchId: string; expectedSha: string }
  | { type: 'HUMAN_ESCALATED'; at: number; reason: string }
  | { type: 'INFRASTRUCTURE_FAILED'; at: number; reason: string; retryable: boolean }
  | { type: 'CANCELLED'; at: number; reason: string };

export interface GauntletRunSnapshot {
  run: GauntletRun;
  artifacts: Artifact[];
  launches: AgentLaunch[];
  reports: CriticReport[];
  acknowledgments: LeadAcknowledgment[];
  repairPackets: RepairPacket[];
  events: Array<{ sequence: number; event: GauntletEvent }>;
  skillLock?: SkillLockReceipt;
}

export interface StartGauntletInput {
  repository: string;
  objective: string;
  baseRef?: string;
  providers?: Partial<Record<GauntletRole, { provider: AgentProvider; model?: string }>>;
  limits?: Partial<GauntletLimits>;
}

export interface GauntletBackend {
  start(input: StartGauntletInput): Promise<GauntletRunSnapshot>;
  status(runId: string): Promise<GauntletRunSnapshot>;
  cancel(runId: string, reason: string): Promise<GauntletRunSnapshot>;
}

export const DEFAULT_GAUNTLET_LIMITS: GauntletLimits = {
  maxRepairRounds: 3,
  maxInfrastructureRetries: 1,
  workerTimeoutMs: 30 * 60_000,
  criticTimeoutMs: 20 * 60_000,
  runTimeoutMs: 2 * 60 * 60_000
};

export const DEFAULT_ROLE_PROVIDERS: Record<GauntletRole, AgentProvider> = {
  conductor: 'claude',
  implementer: 'claude',
  critic: 'codex',
  repairer: 'claude'
};
