import { useEffect, useState, type CSSProperties } from 'react';
import type { RemoteNodeStatus } from '@shared/remoteNode';
import { PixelButton } from './PixelButton';

const fieldStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', border: 'none', outline: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
  background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 13
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase'
};

export function RemoteAccessSettings() {
  const [status, setStatus] = useState<RemoteNodeStatus | null>(null);
  const [portalUrl, setPortalUrl] = useState('https://atelier-pidgeon.vercel.app');
  const [nodeName, setNodeName] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void window.cth.remoteNodeStatus().then((next) => {
      setStatus(next); setPortalUrl(next.portalUrl); setNodeName(next.nodeName);
    });
    return window.cth.onRemoteNodeChanged((next) => {
      setStatus(next); setPortalUrl(next.portalUrl); setNodeName(next.nodeName);
    });
  }, []);

  const run = async (action: () => Promise<RemoteNodeStatus>, success: string) => {
    setBusy(true); setNote(null);
    try { setStatus(await action()); setNote(success); }
    catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const save = () => run(
    () => window.cth.remoteNodeConfigure({ portalUrl, nodeName, enabled: status?.enabled ?? false }),
    'Connection settings saved.'
  );
  const pair = () => run(
    () => window.cth.remoteNodePair({ code: pairingCode, nodeName }),
    'This machine is paired and reporting securely.'
  ).then(() => setPairingCode(''));

  const stateLabel = status?.state === 'online' ? 'Online'
    : status?.state === 'degraded' ? 'Needs attention'
      : status?.state === 'connecting' ? 'Connecting…'
        : status?.state === 'unpaired' ? 'Ready to pair' : 'Off';

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={labelStyle}>Remote studio</div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--cth-ink-900)' }}>Connect this office to your private Atelier portal</div>
          <div style={{ marginTop: 3, fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-500)' }}>
            This machine only makes outbound encrypted requests. Repository paths, prompts, code, credentials, and full check output stay local.
          </div>
        </div>
        <span style={{ padding: '5px 8px', fontSize: 11, color: status?.state === 'online' ? 'var(--cth-mint)' : 'var(--cth-ink-700)', background: 'var(--cth-cream-200)' }}>
          {stateLabel}
        </span>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={labelStyle}>Portal address</span>
        <input aria-label="Portal address" value={portalUrl} onChange={(event) => setPortalUrl(event.target.value)} style={fieldStyle} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={labelStyle}>Machine name</span>
        <input aria-label="Machine name" value={nodeName} onChange={(event) => setNodeName(event.target.value)} style={fieldStyle} />
      </label>

      {status?.paired ? (
        <>
          <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--cth-ink-700)' }}>
            Paired machine <code>{status.nodeId?.slice(0, 8)}</code>
            {status.lastSyncAt ? ` · last checked in ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PixelButton variant="secondary" size="sm" disabled={busy} onClick={() => void save()}>save</PixelButton>
            <PixelButton variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => window.cth.remoteNodeSync(), 'Portal state refreshed.')}>sync now</PixelButton>
            <PixelButton variant="destructive" size="sm" disabled={busy} onClick={() => void run(() => window.cth.remoteNodeDisconnect(), 'This machine is disconnected.')}>disconnect</PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => void window.cth.openExternal(portalUrl)}>open portal</PixelButton>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-500)' }}>
            Sign in to the portal, choose “Pair a machine,” then enter its one-time code here.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label="One-time pairing code" value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX" style={{ ...fieldStyle, flex: 1, letterSpacing: 1.5, fontFamily: 'var(--cth-font-mono, monospace)' }}
            />
            <PixelButton variant="primary" size="sm" disabled={busy || pairingCode.replace(/[^A-Z0-9]/g, '').length < 8} onClick={() => void pair()}>
              {busy ? 'pairing…' : 'pair'}
            </PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => void window.cth.openExternal(portalUrl)}>open portal</PixelButton>
          </div>
        </div>
      )}

      {(note || status?.error) && (
        <div role="status" style={{ fontSize: 12, lineHeight: '17px', color: status?.error ? 'var(--cth-coral)' : 'var(--cth-ink-700)' }}>
          {note ?? status?.error}
        </div>
      )}
    </section>
  );
}
