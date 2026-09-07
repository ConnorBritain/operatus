import type { ClaudeAccountReceipt } from '../claudeAccountAdmission';
import type { CodexAccountReceipt } from '../codexAccountAdmission';
import type { SubscriptionAdmissionEvidence } from '../../shared/gauntlet';

/** Explicit allowlist: the credential hash and any future secret-bearing fields
 * on the live account lease must never escape into persistence or snapshots. */
export function subscriptionEvidence(receipt: ClaudeAccountReceipt, executable: {
  version: string; sha256: string; model: string; source: SubscriptionAdmissionEvidence['source'];
}): SubscriptionAdmissionEvidence {
  return {
    type: 'subscription_admission', component: receipt.component, provider: 'claude', source: executable.source,
    executableVersion: executable.version, executableSha256: executable.sha256, model: executable.model,
    accountHash: receipt.accountHash, organizationHash: receipt.organizationHash,
    plan: receipt.plan, extraUsage: receipt.extraUsage,
    checkedAt: receipt.observedAt, validUntil: receipt.validUntil, launchAllowed: false,
    metadataObservedAt: receipt.metadataObservedAt ?? receipt.observedAt
  };
}

export function codexSubscriptionEvidence(receipt: CodexAccountReceipt, executable: {
  version:string;sha256:string;companionSha256:string;model:string;source:SubscriptionAdmissionEvidence['source'];
}): SubscriptionAdmissionEvidence {
  return {type:'subscription_admission',component:receipt.component,provider:'codex',source:executable.source,
    executableVersion:executable.version,executableSha256:executable.sha256,companionSha256:executable.companionSha256,
    model:executable.model,accountHash:receipt.accountHash,plan:receipt.plan,credits:receipt.credits,topUps:receipt.topUps,
    checkedAt:receipt.observedAt,validUntil:receipt.validUntil,launchAllowed:false};
}
