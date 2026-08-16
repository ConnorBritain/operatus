import { basename } from 'node:path';
import type { GauntletEvent, GauntletRunSnapshot } from '../../shared/gauntlet';

export interface RemoteSharePolicy {
  objective?: boolean;
  contractText?: boolean;
  diffSummary?: boolean;
  checkOutput?: boolean;
  findingEvidence?: boolean;
  reportSummary?: boolean;
  acknowledgmentRationale?: boolean;
  repairInstructions?: boolean;
}

/**
 * Build the transport-neutral, least-information snapshot a future paired web
 * or mobile client may receive. This is intentionally not wired to a listener:
 * adding a transport later cannot accidentally serialize the authoritative
 * store object, local repository paths, agent homes, or credential hashes.
 */
export function projectRemoteSnapshot(snapshot: GauntletRunSnapshot, policy: RemoteSharePolicy = {}) {
  const { run } = snapshot;
  return {
    run: {
      id: run.id,
      backend: run.backend,
      repositoryLabel: basename(run.repository),
      objective: policy.objective ? run.requestedObjective : '[not shared]',
      baseSha: run.baseSha,
      currentArtifactSha: run.currentArtifactSha,
      status: run.status,
      repairRound: run.repairRound,
      limits: run.limits,
      stopReason: run.stopReason,
      version: run.version,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      contract: run.contract ? {
        digest: run.contract.digest,
        frozenAt: run.contract.frozenAt,
        objective: policy.contractText ? run.contract.objective : '[not shared]',
        criteria: policy.contractText ? run.contract.criteria : [],
        checks: run.contract.checks.map((check) => ({ id: check.id, name: check.name, timeoutMs: check.timeoutMs })),
        constraints: policy.contractText ? run.contract.constraints : [],
        exclusions: policy.contractText ? run.contract.exclusions : []
      } : null
    },
    launches: snapshot.launches.map((launch) => ({
      id: launch.id,
      role: launch.role,
      provider: launch.provider,
      model: launch.model,
      sessionId: launch.sessionId,
      expectedSha: launch.expectedSha,
      capability: {
        filesystem: launch.capability.filesystem,
        cleanContext: launch.capability.cleanContext,
        toolRestrictions: launch.capability.toolRestrictions,
        notes: []
      },
      status: launch.status,
      createdAt: launch.createdAt,
      finishedAt: launch.finishedAt
    })),
    artifacts: snapshot.artifacts.map((artifact) => ({
      id: artifact.id,
      sha: artifact.sha,
      parentSha: artifact.parentSha,
      producedByLaunchId: artifact.producedByLaunchId,
      diffSummary: policy.diffSummary ? artifact.diffSummary : '[not shared]',
      checks: artifact.checkReceipts.map((check) => ({
        checkId: check.checkId,
        exitCode: check.exitCode,
        timedOut: check.timedOut,
        durationMs: check.durationMs,
        output: policy.checkOutput ? check.output : '[not shared]'
      })),
      createdAt: artifact.createdAt
    })),
    reports: snapshot.reports.map((report) => ({
      id: report.id,
      runId: report.runId,
      launchId: report.launchId,
      artifactSha: report.artifactSha,
      contractDigest: report.contractDigest,
      verdict: report.verdict,
      summary: policy.reportSummary ? report.summary : '[not shared]',
      findings: report.findings.map((finding) => ({
        ...finding,
        evidence: policy.findingEvidence ? finding.evidence : '[not shared]'
      })),
      primitiveReceipts: report.primitiveReceipts,
      createdAt: report.createdAt
    })),
    acknowledgments: snapshot.acknowledgments.map((acknowledgment) => ({
      ...acknowledgment,
      rationale: policy.acknowledgmentRationale ? acknowledgment.rationale : '[not shared]',
      rejectedFindings: acknowledgment.rejectedFindings.map((finding) => ({
        findingId: finding.findingId,
        reason: policy.acknowledgmentRationale ? finding.reason : '[not shared]'
      }))
    })),
    repairPackets: snapshot.repairPackets.map((packet) => ({
      ...packet,
      instructions: policy.repairInstructions ? packet.instructions : []
    })),
    events: snapshot.events.map(({ sequence, event }) => ({ sequence, event: projectEvent(event) })),
    skillLock: snapshot.skillLock
  };
}

/** Event payloads can repeat the full frozen contract or human-entered failure
 * reasons. Remote clients only need transition identity and ordering; detailed
 * content is already projected through independently controlled fields above. */
function projectEvent(event: GauntletEvent): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = { type: event.type, at: event.at };
  for (const key of [
    'launchId', 'expectedSha', 'artifactSha', 'parentSha', 'role', 'reportId',
    'contractDigest', 'verdict', 'acknowledgmentId', 'decision', 'retryable'
  ] as const) {
    if (key in event) {
      const value = event[key as keyof typeof event];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    }
  }
  return safe;
}
