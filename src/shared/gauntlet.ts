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
  /** Naming stem; legacy launches used this as their shared candidate ref. */
  branch: string;
  baseSha: string;
  currentArtifactSha: string | null;
  currentLaunchId: string | null;
  /** Run-scoped lead identity, independent of the current fresh worker. */
  conductorLaunchId?: string;
  currentCriticReportId: string | null;
  contract: FrozenRunContract | null;
  status: GauntletStatus;
  repairRound: number;
  /** Main-owned continuation of an already counted repair round. Optional for legacy snapshots. */
  pendingRepairRetry?: { launchId: string; artifactSha: string; round: number } | null;
  infrastructureRetries: number;
  providers: Record<GauntletRole, { provider: AgentProvider; model?: string }>;
  limits: GauntletLimits;
  stopReason: string | null;
  /** Human queue disposition only. Never changes the terminal verdict or bar. */
  operatorReview?: { reviewed: boolean; note: string; at: number; runtimeSequence?: number };
  /** Mutable human attention annotation, never scheduling or protocol authority. */
  operatorPriority?: OperatorPriority;
  /** Human disposition of an exact passed candidate; never an integration receipt. */
  candidateHandoff?: { artifactSha: string; reviewed: boolean; note: string; at: number };
  /** Read projection of the append-only runtime journal, not protocol version. */
  runtimeRevision?: number;
  runtimeAttention?: { sequence: number; count: number };
  /** Incomplete pre-filesystem preparations, projected from SQLite, not launches. */
  preparationRevision?: number;
  preparationPending?: number;
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
  /** Assigned candidate ref. Absent on detached Critics and legacy launches. */
  candidateBranch?: string;
  /** Main-produced exact-commit review packet; absent on older launches. */
  reviewEvidence?: {
    directory: string; baseSha: string; artifactSha: string; contractDigest: string; patchSha256: string;
  };
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

/** Observation of retained work, never an accepted artifact or a verdict. */
export interface WorkspacePreservationReceipt {
  id: string;
  requestId: string;
  runId: string;
  launchId: string;
  worktreePath: string;
  candidateBranch: string | null;
  expectedSha: string;
  observedSha: string | null;
  dirty: boolean | null;
  outcome: 'pending' | 'preserved' | 'missing' | 'failed';
  reason: string;
  error: string | null;
  createdAt: number;
}

export interface CheckReceipt {
  checkId: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
  execution?: {
    boundary: 'macos-seatbelt-offline-v1';
    cwd: string;
    scratch: string;
    profileSha256: string;
    network: 'denied';
  };
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
  | { type: 'CONDUCTOR_PREPARED'; at: number; launchId: string }
  | { type: 'OPERATOR_REVIEW_RECORDED'; at: number; reviewed: boolean; note: string; runtimeSequence?: number }
  | { type: 'CANDIDATE_HANDOFF_RECORDED'; at: number; artifactSha: string; reviewed: boolean; note: string }
  | { type: 'BAR_FROZEN'; at: number; contract: FrozenRunContract }
  | { type: 'IMPLEMENTER_LAUNCHED'; at: number; launchId: string; expectedSha: string }
  | { type: 'ARTIFACT_RECORDED'; at: number; launchId: string; role: 'implementer' | 'repairer'; artifactSha: string; parentSha: string }
  | { type: 'CRITIC_LAUNCHED'; at: number; launchId: string; artifactSha: string }
  | { type: 'CRITIC_REPORTED'; at: number; reportId: string; launchId: string; artifactSha: string; contractDigest: string; verdict: GauntletVerdict }
  | { type: 'LEAD_ACKNOWLEDGED'; at: number; acknowledgmentId: string; reportId: string; artifactSha: string; contractDigest: string; decision: LeadDecision }
  | { type: 'REPAIR_LAUNCHED'; at: number; launchId: string; expectedSha: string }
  | { type: 'HUMAN_ESCALATED'; at: number; reason: string; conductorLaunchId?: string }
  | { type: 'INFRASTRUCTURE_FAILED'; at: number; reason: string; retryable: boolean }
  | { type: 'CANCELLED'; at: number; reason: string; conductorLaunchId?: string };

export interface GauntletRunSnapshot {
  run: GauntletRun;
  pendingPreparations?: WorkspacePreparation[];
  operatorPriorityHistory?: OperatorPriority[];
  preservations?: WorkspacePreservationReceipt[];
  artifacts: Artifact[];
  launches: AgentLaunch[];
  reports: CriticReport[];
  acknowledgments: LeadAcknowledgment[];
  repairPackets: RepairPacket[];
  events: Array<{ sequence: number; event: GauntletEvent }>;
  skillLock?: SkillLockReceipt;
  runtimeObservations?: RuntimeObservation[];
}

export interface WorkspacePreparation {
  launchId: string; runId: string; role: 'implementer' | 'repairer' | 'critic';
  repository: string; expectedSha: string; contractDigest: string;
  worktreePath: string; candidateBranch: string | null; reviewEvidencePath: string | null;
  createdAt: number;
}

export interface OperatorPriority {
  revision: number; level: 'low' | 'normal' | 'high'; note: string; at: number;
}

/** Point-in-time read-only diagnostic, not a recovery or artifact receipt. */
export interface PreparationInspection {
  runId: string; launchId: string; observedAt: number;
  state: 'missing' | 'redirected' | 'matching' | 'changed' | 'foreign_repository' | 'unavailable';
  observedSha: string | null; observedBranch: string | null; dirty: boolean | null;
  evidenceDirectory: 'not_applicable' | 'missing' | 'redirected' | 'present' | 'unavailable';
}

/** Main-observed lifecycle evidence, separate from protocol verdicts. Never
 * accepts terminal output as a completion or a PID as a restart capability. */
export interface ToolActivity {
  type: 'tool_activity'; ordinal: number;
  activity: 'reading' | 'searching' | 'editing' | 'executing' | 'tool';
  stage: 'requested' | 'result'; outcome?: 'ok' | 'error';
}
interface SubscriptionEvidenceBase {
  type: 'subscription_admission';
  source: 'provider-metadata' | 'injected-dependencies';
  executableVersion: string;
  executableSha256: string;
  model: string;
  accountHash: string;
  checkedAt: number;
  validUntil: number;
  /** Historical component evidence, never a reusable admission capability. */
  launchAllowed: false;
}
export type SubscriptionAdmissionEvidence = SubscriptionEvidenceBase & (
  {component:'claude-max-account-v1';provider:'claude';organizationHash:string;plan:'max';extraUsage:'disabled';metadataObservedAt?:number} |
  {component:'codex-subscription-account-v1';provider:'codex';plan:'plus'|'pro';credits:'none-observed'|'available'|'unknown';
    topUps:'not-programmatically-verified';companionSha256:string}
);
/** Transport counts only. No model output, commands, paths or credentials. */
export interface NativeOutputObservation {
  receivedBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutPreviewTruncated: boolean;
  stderrPreviewTruncated: boolean;
}

/** Actual provider identities, not Operatus session IDs or resume authority. */
export interface NativeSessionIdentity {
  type: 'native_identity'; provider: 'codex'; threadId: string; turnId: string | null;
}

export type RuntimeEvent = ToolActivity | SubscriptionAdmissionEvidence | NativeSessionIdentity
  | { type: 'process_started'; pid: number; model: string; profileSha256: string; boundarySha256: string }
  | { type: 'process_exited'; reason: string; exitCode: number | null; processExited: boolean;
      gatewayRevocation: 'confirmed' | 'unconfirmed'; descendantsQuiescent: false; output?: NativeOutputObservation }
  | { type: 'delivery_queued'; messageId: string; purpose: 'orientation' | 'acknowledgment'; promptSha256: string; reportId: string | null }
  | { type: 'delivery_completed'; messageId: string; ok: boolean; resultSha256: string }
  | { type: 'recovery_interrupted' };

export interface RuntimeObservation {
  sequence: number;
  runId: string;
  launchId: string;
  sessionId: string;
  at: number;
  event: RuntimeEvent;
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
