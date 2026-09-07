import { useState } from 'react';
import type { HarnessConfig } from '@/store/config';
import type { SubscriptionPreflight } from '@shared/subscriptionPreflight';
import { PixelButton } from './PixelButton';
import { ProviderLogo } from './ProviderLogo';

/** No BYOK inputs or custom inference routes. Diagnostics never admit a launch. */
export function AiEnginesSettings(_props: { config: HarnessConfig }) {
  const [reports, setReports] = useState<SubscriptionPreflight[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inspect = async () => {
    setBusy(true); setError(''); setReports([]);
    try {
      setReports(await Promise.all([
        window.cth.subscriptionPreflight('claude'), window.cth.subscriptionPreflight('codex')
      ]));
    } catch { setError('Local setup inspection failed. Gauntlet launches still require independent account verification.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Subscription providers" style={{ display: 'grid', gap: 12, fontSize: 13, lineHeight: 1.5 }}>
    <h3 style={{ margin: 0 }}>Subscription providers</h3>
    <p style={{ margin: 0 }}>Claude Code and Codex subscription sessions only. API keys, custom inference endpoints and paid fallback are not supported.</p>
    <p style={{ margin: 0 }}>Start isolated macOS Gauntlets from Runs. This inspection only reads local setup and checks CLI versions offline; the runner verifies subscription authentication separately before each launch. Personal settings and API keys are not imported. Keep account-side paid extras and automatic top-ups disabled.</p>
    <PixelButton disabled={busy} variant="secondary" onClick={() => { void inspect(); }}>
      {busy ? 'Inspecting local setup…' : 'Inspect local setup'}
    </PixelButton>
    <div role="status">{error}</div>
    {reports.map(report => <article key={report.provider} style={{ padding: 12, border: '1px solid var(--cth-ink-300)', overflowWrap: 'anywhere' }}>
      <h4 style={{ margin: '0 0 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <ProviderLogo provider={report.provider} size={16} />
        {report.provider === 'claude' ? 'Claude Code' : 'Codex'} · local setup diagnostic
      </h4>
      <p>Stored login hint: {report.storedAuthHint}. This is not a validated session. Keychain-only or unsupported formats may show unknown.</p>
      <ul>
        <li>Installations found: {report.executables.length}{report.executableAmbiguous ? '. Multiple installations need explicit resolution.' : ''}</li>
        <li>Local configuration: {report.configState}{report.configRiskDetected ? '; customization or routing needs review' : '; no listed risk detected (not proof of safety)'}</li>
        <li>Inherited credential/routing signals: {report.ambientCredentialOrRoutingDetected ? 'detected; must not enter a launch' : 'none detected by this diagnostic'}</li>
        <li>Account-side paid extras: not verified by this diagnostic.</li>
      </ul>
      <details><summary>Executable identities</summary>
        {report.executables.map(executable => <p key={executable.path}>
          <strong>{executable.versionObservation.status === 'reported'
            ? `Version ${executable.versionObservation.version}`
            : `Version not checked: ${executable.versionObservation.status.replaceAll('-', ' ')}`}</strong>
          <br /><code>{executable.path}</code><br /><code>SHA-256 {executable.sha256}</code>
        </p>)}
      </details>
      <p>Observed {new Date(report.observedAt).toLocaleString()}. Your installations and settings were not changed. A reported version does not verify authentication or model access.</p>
    </article>)}
  </section>;
}
