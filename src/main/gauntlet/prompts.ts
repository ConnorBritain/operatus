import type {
  CriticReport,
  FrozenRunContract,
  GauntletRole,
  RepairPacket
} from '../../shared/gauntlet';

export function buildConductorOrientationPrompt(input: {
  runId: string;
  repository: string;
  baseSha: string;
  objective: string;
}): string {
  return [
    `You are the long-lived Ventura Conductor for Gauntlet Run ${input.runId}.`,
    `Repository: ${input.repository}`,
    `Base artifact: ${input.baseSha}`,
    '',
    'Orient to the repository and translate the bounded objective into an externally observable quality bar.',
    'The bar must name concrete criteria, reproducible check commands where available, constraints, and exclusions.',
    'Do not implement. Once the bar is sufficient, freeze it through the Ventura Gauntlet control command.',
    'After freezing, you own critic acknowledgment, repair synthesis, stop/continue judgment, and human escalation.',
    '',
    `Objective: ${input.objective}`,
    '',
    'Write the contract JSON to a temporary file with keys objective, criteria, checks, constraints, and exclusions.',
    `Freeze it with: "$HIVE_NODE" "$VENTURA_GAUNTLET_HELPER" freeze --run ${input.runId} --file <contract.json>`
  ].join('\n');
}

export function buildWorkerPrompt(input: {
  role: 'implementer' | 'repairer';
  runId: string;
  launchId: string;
  expectedSha: string;
  requestedObjective: string;
  contract: FrozenRunContract;
  repairPacket?: RepairPacket;
}): string {
  const lines = [
    `You are a fresh Ventura ${capitalize(input.role)} for Gauntlet Run ${input.runId}.`,
    `Expected starting artifact: ${input.expectedSha}`,
    `Frozen bar digest: ${input.contract.digest}`,
    '',
    'Work only in the current isolated worktree. Do not merge, push, change the quality bar, or grade your own work.',
    'Produce one or more focused commits, finish with a clean worktree, and report the full HEAD SHA through the Ventura control command.',
    '',
    '# Original requested objective',
    input.requestedObjective,
    '',
    contractText(input.contract)
  ];
  if (input.role === 'repairer' && input.repairPacket) {
    lines.push(
      '',
      '# Bounded repair packet',
      `Accepted finding IDs: ${input.repairPacket.findingIds.join(', ')}`,
      ...input.repairPacket.instructions.map((instruction) => `- ${instruction}`),
      '# Explicit exclusions',
      ...input.repairPacket.exclusions.map((exclusion) => `- ${exclusion}`)
    );
  }
  lines.push('', `When complete: "$HIVE_NODE" "$VENTURA_GAUNTLET_HELPER" complete --run ${input.runId} --launch ${input.launchId} --sha "$(git rev-parse HEAD)"`);
  return lines.join('\n');
}

export function buildCriticPrompt(input: {
  runId: string;
  launchId: string;
  artifactSha: string;
  baseSha: string;
  requestedObjective: string;
  contract: FrozenRunContract;
  primitivePrompt: string;
}): string {
  return [
    `You are the fresh independent Critic for Ventura Gauntlet Run ${input.runId}.`,
    `Review exact artifact: ${input.artifactSha}`,
    `Comparison base: ${input.baseSha}`,
    `Frozen bar digest: ${input.contract.digest}`,
    '',
    'First verify `git rev-parse HEAD` exactly equals the review artifact. If not, submit INVALID_OR_STALE.',
    'Remain read-only. Inspect the real diff, tests, logs, and application behavior. Do not repair.',
    '',
    '# Original requested objective',
    input.requestedObjective,
    '',
    contractText(input.contract),
    '',
    input.primitivePrompt,
    '',
    'Submit a structured report with the Ventura control command. The report must bind this exact artifact and bar digest.',
    'Write JSON with artifactSha, contractDigest, verdict, summary, and findings to a temporary report file.',
    `Submit it with: "$HIVE_NODE" "$VENTURA_GAUNTLET_HELPER" critic --run ${input.runId} --launch ${input.launchId} --file <report.json>`,
    `Launch identity: ${input.launchId}`
  ].join('\n');
}

export function buildConductorAcknowledgmentPrompt(report: CriticReport): string {
  return [
    `Critic report ${report.id} is ready for explicit Conductor acknowledgment.`,
    `Artifact: ${report.artifactSha}`,
    `Verdict: ${report.verdict}`,
    '',
    report.summary,
    '',
    ...report.findings.map((finding) => `- [${finding.id}] ${finding.severity}: ${finding.title}\n  Evidence: ${finding.evidence}`),
    '',
    'Inspect the evidence yourself. Accept or reject each material finding with a reason, then choose pass, bounded repair, or HUMAN_REQUIRED.',
    'The critic is advisory; you remain accountable for the decision. Do not silently change the frozen bar.'
    ,
    'Write JSON with reportId, decision, acceptedFindingIds, rejectedFindings, rationale, and optional repairInstructions.',
    `Acknowledge with: "$HIVE_NODE" "$VENTURA_GAUNTLET_HELPER" acknowledge --run ${report.runId} --file <acknowledgment.json>`
  ].join('\n');
}

function contractText(contract: FrozenRunContract): string {
  return [
    '# Frozen objective',
    contract.objective,
    '# Observable criteria',
    ...contract.criteria.map((criterion) => `- ${criterion}`),
    '# Checks',
    ...(contract.checks.length ? contract.checks.map((check) => `- ${check.name}: ${check.command}`) : ['- No deterministic checks declared']),
    '# Constraints',
    ...contract.constraints.map((constraint) => `- ${constraint}`),
    '# Exclusions',
    ...(contract.exclusions.length ? contract.exclusions.map((exclusion) => `- ${exclusion}`) : ['- None'])
  ].join('\n');
}

function capitalize(role: GauntletRole): string {
  return `${role.slice(0, 1).toUpperCase()}${role.slice(1)}`;
}
