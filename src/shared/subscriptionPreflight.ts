export type SubscriptionProvider = 'claude' | 'codex';
export type ProviderVersionObservation =
  | { status: 'reported'; version: string }
  | { status: 'unsupported-platform' | 'unsupported-entrypoint' | 'identity-changed' | 'unavailable' };
/** Diagnostic only, never a launch authorization. No credential values. */
export interface SubscriptionPreflight {
  provider: SubscriptionProvider;
  launchAllowed: false;
  reason: string;
  executables: Array<{ path: string; sha256: string; versionObservation: ProviderVersionObservation }>;
  executableAmbiguous: boolean;
  storedAuthHint: 'subscription' | 'api' | 'conflicting' | 'unknown';
  configState: 'missing' | 'present' | 'unreadable';
  configRiskDetected: boolean;
  ambientCredentialOrRoutingDetected: boolean;
  authenticationVerified: false;
  noPaidOverageVerified: false;
  observedAt: number;
}
