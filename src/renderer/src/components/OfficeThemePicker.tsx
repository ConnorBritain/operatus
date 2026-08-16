import { useEffect, useState } from 'react';
import type { HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import {
  BRANCH_THEMES,
  normalizeBranchProfile,
  type BranchProfile,
  type BranchThemeId
} from '@shared/branchIdentity';

/** Configure the presentation-only identity of the current daemon/workspace.
 * The profile is keyed by harness home so switching workspaces restores the
 * correct visual branch without touching agents or Gauntlet authority. */
export function OfficeThemePicker({ config }: { config: HarnessConfig }) {
  const home = config.harnessHome;
  const initial = normalizeBranchProfile(home ? config.branchProfiles?.[home] : undefined);
  const [profile, setProfile] = useState<BranchProfile>(initial);
  const [note, setNote] = useState('');

  useEffect(() => {
    const next = normalizeBranchProfile(home ? config.branchProfiles?.[home] : undefined);
    setProfile(next);
    useStore.getState().setBranchProfile(next);
    document.title = `${next.name} · Ventura`;
  }, [home, config.branchProfiles]);

  const save = async (next: BranchProfile) => {
    setProfile(next);
    useStore.getState().setBranchProfile(next);
    document.title = `${next.name} · Ventura`;
    if (!home) return;
    try {
      await window.cth.updateConfig({
        branchProfiles: { ...(config.branchProfiles ?? {}), [home]: next }
      });
      setNote('saved for this workspace');
      window.setTimeout(() => setNote(''), 1800);
    } catch {
      setProfile(initial);
      useStore.getState().setBranchProfile(initial);
      setNote('could not save');
    }
  };

  const choose = (themeId: BranchThemeId) => void save({ ...profile, themeId });

  return (
    <div>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
        color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 6
      }}>
        Branch identity
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-500)' }}>
        Give this daemon/workspace its own visual identity. It will carry into the future machine switcher, web portal, and mobile office.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: 10, alignItems: 'start' }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 10, color: 'var(--cth-ink-500)' }}>
          BRANCH NAME
          <input
            aria-label="Branch name"
            value={profile.name}
            maxLength={80}
            onChange={(event) => setProfile({ ...profile, name: event.target.value })}
            onBlur={() => void save(normalizeBranchProfile(profile))}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            style={{
              width: '100%', boxSizing: 'border-box', border: '1px solid var(--cth-ink-300)',
              background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', padding: '8px',
              fontFamily: 'var(--cth-font-ui)', fontSize: 13, outline: 'none'
            }}
          />
          <span>{note || 'Name the machine or location, such as Mac Studio or Workshop West.'}</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(72px, 1fr))', gap: 6 }}>
          {BRANCH_THEMES.map((theme) => {
            const selected = profile.themeId === theme.id;
            return <button
              key={theme.id}
              type="button"
              aria-pressed={selected}
              onClick={() => choose(theme.id)}
              style={{
                border: 0, cursor: 'pointer', padding: 6, textAlign: 'left',
                background: theme.wash, color: theme.ink,
                boxShadow: `inset 0 0 0 ${selected ? 3 : 1}px ${selected ? theme.accent : `${theme.accent}88`}`,
                fontFamily: 'var(--cth-font-ui)', fontSize: 11
              }}
            >
              <span style={{ display: 'block', height: 16, marginBottom: 5, background: `linear-gradient(135deg, ${theme.wash} 0 52%, ${theme.accent} 52%)` }} />
              {theme.label}
            </button>;
          })}
        </div>
      </div>
    </div>
  );
}
