import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AgentProvider } from '@shared/agentProvider';
import { DEFAULT_ROLE_PROVIDERS } from '@shared/gauntlet';
import type { DepotSkill, GauntletRole, GauntletRun, GauntletRunSnapshot, RoleSkillAssignment, SkillDepotSource } from '@shared/gauntlet';
import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';

const fieldStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--cth-ink-300)',
  background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', padding: '7px 8px',
  fontFamily: 'var(--cth-font-ui)', fontSize: 13, outline: 'none'
};

export function GauntletRunsTab() {
  const [runs, setRuns] = useState<GauntletRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GauntletRunSnapshot | null>(null);
  const [repo, setRepo] = useState('');
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depotOpen, setDepotOpen] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<DepotSkill[]>([]);
  const [showOptInSkills, setShowOptInSkills] = useState(false);
  const [assignments, setAssignments] = useState<RoleSkillAssignment[]>([]);
  const [assignmentRole, setAssignmentRole] = useState<GauntletRole>('implementer');
  const [assignmentSkill, setAssignmentSkill] = useState('');
  const [providers, setProviders] = useState<Record<GauntletRole, { provider: AgentProvider; model?: string }>>(() =>
    Object.fromEntries((Object.keys(DEFAULT_ROLE_PROVIDERS) as GauntletRole[]).map((role) => [role, { provider: DEFAULT_ROLE_PROVIDERS[role] }])) as Record<GauntletRole, { provider: AgentProvider; model?: string }>
  );
  const assignableSkills = useMemo(
    () => availableSkills.filter((skill) => showOptInSkills || !skill.optIn),
    [availableSkills, showOptInSkills]
  );

  const refresh = async (preferred?: string) => {
    const next = await window.cth.gauntletList();
    setRuns(next);
    const id = preferred ?? selectedId ?? next[0]?.id ?? null;
    setSelectedId(id);
    setSnapshot(id ? await window.cth.gauntletGet(id) : null);
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([window.cth.gauntletList(), window.cth.getConfig(), window.cth.skillCatalog()]).then(async ([initial, config, skills]) => {
      if (!alive) return;
      setRuns(initial);
      setRepo(config.registeredRepos?.[0] ?? '');
      setAvailableSkills(skills);
      const firstSkill = skills.find((skill) => !skill.optIn);
      setAssignmentSkill(firstSkill ? skillKey(firstSkill) : '');
      const id = initial[0]?.id ?? null;
      setSelectedId(id);
      if (id) setSnapshot(await window.cth.gauntletGet(id));
    }).catch((cause) => setError(message(cause)));
    const off = window.cth.onGauntletChanged((next) => {
      if (!alive) return;
      setRuns((current) => [next.run, ...current.filter((run) => run.id !== next.run.id)]);
      setSelectedId((current) => {
        if (!current || current === next.run.id) setSnapshot(next);
        return current ?? next.run.id;
      });
    });
    return () => { alive = false; off(); };
  }, []);

  const selectRun = async (id: string) => {
    setSelectedId(id);
    try { setSnapshot(await window.cth.gauntletGet(id)); } catch (cause) { setError(message(cause)); }
  };

  const start = async () => {
    if (!repo.trim() || !objective.trim()) return;
    setBusy(true); setError(null);
    try {
      const created = await window.cth.gauntletStart({ repository: repo.trim(), objective: objective.trim(), providers, assignments });
      setObjective('');
      setAssignments([]);
      await refresh(created.run.id);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(220px, 30%) 1fr', background: 'var(--cth-cream-200)' }}>
      <aside style={{ minWidth: 0, borderRight: '1px solid var(--cth-ink-300)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--cth-ink-300)' }}>
          <SectionLabel>NEW GAUNTLET RUN</SectionLabel>
          <input aria-label="Repository path" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="/path/to/git/repository" style={fieldStyle} />
          <textarea aria-label="Bounded objective" value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Describe a bounded coding objective…" rows={4} style={{ ...fieldStyle, resize: 'vertical', marginTop: 6 }} />
          <details style={{ marginTop: 6, fontSize: 11 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--cth-ink-700)' }}>role engines</summary>
            <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
              {(Object.keys(DEFAULT_ROLE_PROVIDERS) as GauntletRole[]).map((role) => <div key={role} style={{ display: 'grid', gridTemplateColumns: '82px 90px 1fr', gap: 4, alignItems: 'center' }}>
                <span>{role}</span>
                <select value={providers[role].provider} onChange={(event) => setProviders((current) => ({ ...current, [role]: { ...current[role], provider: event.target.value as AgentProvider } }))} style={fieldStyle}>
                  <option value="claude">Claude</option><option value="codex">Codex</option>
                </select>
                <input aria-label={`${role} model`} value={providers[role].model ?? ''} onChange={(event) => setProviders((current) => ({ ...current, [role]: { ...current[role], model: event.target.value || undefined } }))} placeholder="default model" style={fieldStyle} />
              </div>)}
            </div>
          </details>
          {assignableSkills.length > 0 && <details style={{ marginTop: 6, fontSize: 11 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--cth-ink-700)' }}>role skills · {assignments.length} locked</summary>
            {availableSkills.some((skill) => skill.optIn) && <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, color: 'var(--cth-ink-500)' }}>
              <input type="checkbox" checked={showOptInSkills} onChange={(event) => setShowOptInSkills(event.target.checked)} />
              include experimental / miscellaneous skills
            </label>}
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: 4, marginTop: 6 }}>
              <select value={assignmentRole} onChange={(event) => setAssignmentRole(event.target.value as GauntletRole)} style={fieldStyle}>
                {(['conductor', 'implementer', 'critic', 'repairer'] as const).map((role) => <option key={role}>{role}</option>)}
              </select>
              <select value={assignmentSkill} onChange={(event) => setAssignmentSkill(event.target.value)} style={fieldStyle}>
                {assignableSkills.map((skill) => <option key={skillKey(skill)} value={skillKey(skill)}>{skill.sourceId} · {skill.name}{skill.optIn ? ' · opt-in' : ''}</option>)}
              </select>
              <PixelButton size="sm" variant="secondary" disabled={!assignmentSkill} onClick={() => {
                const skill = assignableSkills.find((candidate) => skillKey(candidate) === assignmentSkill);
                if (!skill) return;
                setAssignments((current) => [
                  ...current.filter((entry) => !(entry.role === assignmentRole && entry.skillName === skill.name)),
                  { role: assignmentRole, sourceId: skill.sourceId, skillName: skill.name }
                ]);
              }}>add</PixelButton>
            </div>
            {assignments.map((entry) => <button key={`${entry.role}:${entry.skillName}`} onClick={() => setAssignments((current) => current.filter((candidate) => candidate !== entry))} style={{ border: 0, margin: '4px 4px 0 0', padding: '3px 5px', cursor: 'pointer', background: 'var(--cth-lilac-light)', color: 'var(--cth-ink-900)', fontSize: 10 }} title="Remove assignment">{entry.role} · {entry.skillName} ×</button>)}
          </details>}
          <PixelButton fullWidth size="sm" disabled={busy || !repo.trim() || !objective.trim()} onClick={() => void start()} style={{ marginTop: 6 }}>
            {busy ? 'orienting…' : 'start run'}
          </PixelButton>
          {error && <div style={{ color: 'var(--cth-coral)', fontSize: 12, marginTop: 6 }}>{error}</div>}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
          {runs.length === 0 && <Empty>No runs yet. Start with a repository and one observable objective.</Empty>}
          {runs.map((run) => (
            <button key={run.id} onClick={() => void selectRun(run.id)} style={{
              width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', marginBottom: 5, padding: 8,
              background: selectedId === run.id ? 'var(--cth-lilac-light)' : 'var(--cth-cream-100)',
              boxShadow: `inset 0 0 0 1px ${selectedId === run.id ? 'var(--cth-lilac)' : 'var(--cth-ink-100)'}`,
              color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                <code style={{ fontSize: 11 }}>{run.id.slice(0, 8)}</code><Status value={run.status} />
              </div>
              <div style={{ fontSize: 12, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.requestedObjective}</div>
              <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 3 }}>{shortPath(run.repository)}</div>
            </button>
          ))}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid var(--cth-ink-300)' }}>
          <PixelButton variant="secondary" size="sm" fullWidth onClick={() => setDepotOpen((value) => !value)}>
            {depotOpen ? 'close skill depot' : 'skill depot'}
          </PixelButton>
        </div>
      </aside>
      <main style={{ minWidth: 0, overflow: 'auto', padding: 10 }}>
        {depotOpen ? <SkillDepotPanel /> : snapshot ? <RunDetail snapshot={snapshot} onCancel={async () => {
          await window.cth.gauntletCancel(snapshot.run.id, 'Cancelled from the Atelier Runs surface');
          await refresh(snapshot.run.id);
        }} /> : <Empty>Select a run to inspect its contract, agents, evidence, and immutable artifacts.</Empty>}
      </main>
    </div>
  );
}

function RunDetail({ snapshot, onCancel }: { snapshot: GauntletRunSnapshot; onCancel: () => Promise<void> }) {
  const { run } = snapshot;
  const terminal = ['passed', 'human_required', 'cancelled', 'infrastructure_failure'].includes(run.status);
  const artifact = snapshot.artifacts.at(-1);
  return <div style={{ display: 'grid', gap: 10 }}>
    <PixelPanel>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <SectionLabel>GAUNTLET RUN · {run.id.slice(0, 8)}</SectionLabel>
          <div style={{ fontSize: 16, lineHeight: 1.35 }}>{run.requestedObjective}</div>
          <div style={{ color: 'var(--cth-ink-500)', marginTop: 4, fontSize: 11, overflowWrap: 'anywhere' }}>{run.repository}</div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}><Status value={run.status} />
          {!terminal && <PixelButton variant="destructive" size="sm" onClick={() => void onCancel()}>cancel</PixelButton>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(90px, 1fr))', gap: 6, marginTop: 10 }}>
        <Metric label="phase" value={run.status.replaceAll('_', ' ')} />
        <Metric label="repair round" value={`${run.repairRound} / ${run.limits.maxRepairRounds}`} />
        <Metric label="base" value={run.baseSha.slice(0, 10)} mono />
        <Metric label="candidate" value={run.currentArtifactSha?.slice(0, 10) ?? '—'} mono />
      </div>
      {run.stopReason && <div style={{ marginTop: 8, padding: 7, background: 'var(--cth-coral-light)', fontSize: 12 }}>{run.stopReason}</div>}
    </PixelPanel>

    {run.contract && <PixelPanel title="FROZEN BAR">
      <p style={{ margin: '0 0 8px', fontSize: 13 }}>{run.contract.objective}</p>
      <ContractList label="observable criteria" values={run.contract.criteria} />
      <ContractList label="checks" values={run.contract.checks.map((check) => `${check.name}: ${check.command}`)} mono />
      {run.contract.constraints.length > 0 && <ContractList label="constraints" values={run.contract.constraints} />}
      {run.contract.exclusions.length > 0 && <ContractList label="exclusions" values={run.contract.exclusions} />}
      <div style={{ color: 'var(--cth-ink-500)', fontSize: 10, marginTop: 8 }}>SHA-256 · <code>{run.contract.digest}</code></div>
    </PixelPanel>}

    <PixelPanel title="CONDUCTED LOOP">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 }}>
        {(['conductor', 'implementer', 'critic', 'repairer'] as const).map((role) => {
          const active = snapshot.launches.filter((launch) => launch.role === role).at(-1);
          return <div key={role} style={{ padding: 8, background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
            <SectionLabel>{role.toUpperCase()}</SectionLabel>
            <div style={{ fontSize: 12 }}>{run.providers[role].provider}{run.providers[role].model ? ` · ${run.providers[role].model}` : ''}</div>
            <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 4 }}>{active ? `fresh session ${active.sessionId.slice(0, 8)}` : role === 'conductor' ? 'long-lived authority' : 'awaiting launch'}</div>
          </div>;
        })}
      </div>
    </PixelPanel>

    {snapshot.launches.length > 0 && <PixelPanel title={`FRESH ROLE LAUNCHES · ${snapshot.launches.length}`}>
      {snapshot.launches.slice().reverse().map((launch) => <div key={launch.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--cth-ink-100)', fontSize: 11 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}><strong>{launch.role}</strong><Status value={launch.status} /><span>{launch.provider}{launch.model ? ` · ${launch.model}` : ''}</span></div>
        <div style={{ color: 'var(--cth-ink-500)', marginTop: 3, overflowWrap: 'anywhere' }}>
          launch <code>{launch.id}</code> · session <code>{launch.sessionId}</code><br />expected <code>{launch.expectedSha}</code>
        </div>
        <div style={{ marginTop: 3 }}>filesystem {launch.capability.filesystem} · fresh context {launch.capability.cleanContext} · tools {launch.capability.toolRestrictions}</div>
      </div>)}
    </PixelPanel>}

    {snapshot.skillLock && <PixelPanel title={`LOCKED SKILLS · ${snapshot.skillLock.entries.length}`}>
      {snapshot.skillLock.entries.map((entry) => <div key={`${entry.role}:${entry.sourceId}:${entry.relativePath}`} style={{ padding: '5px 0', borderBottom: '1px solid var(--cth-ink-100)', fontSize: 11 }}>
        <strong>{entry.role} · {entry.skillName}</strong>
        <div style={{ color: 'var(--cth-ink-500)', marginTop: 2, overflowWrap: 'anywhere' }}>{entry.sourceId}@<code>{entry.sourceCommit}</code><br />digest <code>{entry.digest}</code></div>
      </div>)}
    </PixelPanel>}

    {artifact && <PixelPanel title={`EXACT ARTIFACT HISTORY · ${snapshot.artifacts.length}`}>
      {snapshot.artifacts.slice().reverse().map((item) => <div key={item.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--cth-ink-100)' }}>
        <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{item.sha}</code>
        <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 2 }}>parent <code>{item.parentSha}</code></div>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '8px 0', maxHeight: 160, overflow: 'auto' }}>{item.diffSummary}</pre>
        {item.checkReceipts.map((check) => <details key={check.checkId} style={{ padding: '5px 0', borderTop: '1px solid var(--cth-ink-100)', fontSize: 11 }}>
          <summary style={{ display: 'flex', gap: 8, cursor: 'pointer' }}><Status value={check.exitCode === 0 && !check.timedOut ? 'passed' : 'failed'} /><code style={{ flex: 1 }}>{check.command}</code><span>{(check.durationMs / 1000).toFixed(1)}s</span></summary>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', background: 'var(--cth-ink-900)', color: 'var(--cth-cream-100)', padding: 7 }}>{check.output || '(no output)'}</pre>
        </details>)}
      </div>)}
    </PixelPanel>}

    {snapshot.reports.slice().reverse().map((report) => <PixelPanel key={report.id} title={`CRITIC · ${report.verdict}`}>
      <div style={{ fontSize: 12 }}>{report.summary}</div>
      {report.findings.map((finding) => <div key={finding.id} style={{ padding: '7px 0', borderTop: '1px solid var(--cth-ink-100)', marginTop: 6 }}>
        <div style={{ fontSize: 12 }}><strong>[{finding.severity}] {finding.title}</strong></div>
        <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', marginTop: 2 }}>{finding.evidence}</div>
      </div>)}
      <div style={{ marginTop: 7, fontSize: 10, color: 'var(--cth-ink-500)' }}>artifact <code>{report.artifactSha}</code> · bar <code>{report.contractDigest}</code></div>
      {report.primitiveReceipts.map((receipt) => <div key={`${report.id}:${receipt.primitiveId}`} style={{ marginTop: 5, padding: 6, background: 'var(--cth-cream-200)', fontSize: 10, overflowWrap: 'anywhere' }}>
        <strong>{receipt.primitiveId}</strong> · {receipt.enforcement}<br />source <code>{receipt.sourceCommit}</code><br />digest <code>{receipt.digest}</code>
      </div>)}
    </PixelPanel>)}

    {snapshot.acknowledgments.slice().reverse().map((ack) => {
      const packet = snapshot.repairPackets.find((candidate) => candidate.acknowledgmentId === ack.id);
      return <PixelPanel key={ack.id} title={`CONDUCTOR ACKNOWLEDGMENT · ${ack.decision.toUpperCase()}`}>
        <div style={{ fontSize: 12 }}>{ack.rationale}</div>
        <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 5 }}>report <code>{ack.reportId}</code> · artifact <code>{ack.artifactSha}</code></div>
        <ContractList label="accepted findings" values={ack.acceptedFindingIds.length ? ack.acceptedFindingIds : ['none']} mono />
        {ack.rejectedFindings.length > 0 && <ContractList label="rejected with reasons" values={ack.rejectedFindings.map((finding) => `${finding.findingId}: ${finding.reason}`)} />}
        {packet && <div style={{ marginTop: 8, padding: 7, background: 'var(--cth-lemon-light)', fontSize: 11 }}>
          <SectionLabel>BOUNDED REPAIR PACKET</SectionLabel>
          <div>expected <code>{packet.expectedSha}</code></div>
          {packet.instructions.map((instruction, index) => <div key={index} style={{ marginTop: 3 }}>• {instruction}</div>)}
        </div>}
      </PixelPanel>;
    })}

    <PixelPanel title="TIMELINE">
      {snapshot.events.slice().reverse().map(({ sequence, event }) => <div key={sequence} style={{ display: 'grid', gridTemplateColumns: '45px 145px 1fr', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--cth-ink-100)', fontSize: 11 }}>
        <code>#{sequence}</code><strong>{event.type.replaceAll('_', ' ')}</strong><span style={{ color: 'var(--cth-ink-500)' }}>{new Date(event.at).toLocaleString()}</span>
      </div>)}
    </PixelPanel>
  </div>;
}

function SkillDepotPanel() {
  const [sources, setSources] = useState<SkillDepotSource[]>([]);
  const [catalog, setCatalog] = useState<DepotSkill[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: '', url: '', pinnedCommit: '' });
  const load = async () => { setSources(await window.cth.skillSources()); setCatalog(await window.cth.skillCatalog()); };
  useEffect(() => { void load().catch((cause) => setError(message(cause))); }, []);
  const save = async (next: SkillDepotSource[]) => { setSources(await window.cth.skillSaveSources(next)); };
  const sync = async (source: SkillDepotSource) => {
    setSyncing(source.id); setError(null);
    try { await window.cth.skillSync(source.id); await load(); } catch (cause) { setError(message(cause)); }
    finally { setSyncing(null); }
  };
  const add = async () => {
    const source: SkillDepotSource = { ...draft, enabled: true, include: ['skills'], optIn: [] };
    try { await save([...sources, source]); setDraft({ id: '', url: '', pinnedCommit: '' }); } catch (cause) { setError(message(cause)); }
  };
  const bySource = useMemo(() => new Map(sources.map((source) => [source.id, catalog.filter((skill) => skill.sourceId === source.id)])), [sources, catalog]);
  return <div style={{ display: 'grid', gap: 10 }}>
    <PixelPanel title="SKILL DEPOT">
      <p style={{ margin: '0 0 8px', fontSize: 12 }}>Pinned, manually synchronized sources. Repository install scripts are never run, and skills enter a Gauntlet only through explicit role assignment.</p>
      {error && <div style={{ color: 'var(--cth-coral)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {sources.map((source) => <div key={source.id} style={{ padding: 8, marginTop: 6, background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={source.enabled} onChange={(event) => void save(sources.map((item) => item.id === source.id ? { ...item, enabled: event.target.checked } : item))} />
          <strong style={{ fontSize: 12, flex: 1 }}>{source.id}</strong>
          <span style={{ fontSize: 10 }}>{bySource.get(source.id)?.length ?? 0} skills</span>
          <PixelButton size="sm" variant="secondary" disabled={!source.enabled || syncing != null} onClick={() => void sync(source)}>{syncing === source.id ? 'syncing…' : 'sync pin'}</PixelButton>
          <PixelButton size="sm" variant="destructive" disabled={syncing != null} onClick={() => void save(sources.filter((item) => item.id !== source.id))}>remove</PixelButton>
        </div>
        <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 4, overflowWrap: 'anywhere' }}>{source.url}<br /><code>{source.pinnedCommit}</code></div>
      </div>)}
    </PixelPanel>
    <PixelPanel title="ADD PINNED SOURCE">
      <div style={{ display: 'grid', gap: 6 }}>
        <input style={fieldStyle} placeholder="source-id" value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} />
        <input style={fieldStyle} placeholder="https://github.com/owner/repo.git" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
        <input style={fieldStyle} placeholder="full 40-character commit" value={draft.pinnedCommit} onChange={(event) => setDraft({ ...draft, pinnedCommit: event.target.value })} />
        <PixelButton size="sm" disabled={!draft.id || !draft.url || draft.pinnedCommit.length !== 40} onClick={() => void add()}>add source</PixelButton>
      </div>
    </PixelPanel>
    {catalog.length > 0 && <PixelPanel title={`CATALOG · ${catalog.length}`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
        {catalog.map((skill) => <div key={`${skill.sourceId}:${skill.relativePath}`} style={{ padding: 7, background: 'var(--cth-cream-200)', fontSize: 11 }}>
          <strong>{skill.name}</strong>{skill.optIn && <span style={{ color: 'var(--cth-coral)' }}> · opt-in</span>}
          <div style={{ color: 'var(--cth-ink-500)', marginTop: 3 }}>{skill.description || skill.relativePath}</div>
        </div>)}
      </div>
    </PixelPanel>}
  </div>;
}

function SectionLabel({ children }: { children: ReactNode }) { return <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, letterSpacing: 0.4, marginBottom: 5 }}>{children}</div>; }
function Empty({ children }: { children: ReactNode }) { return <div style={{ padding: 18, textAlign: 'center', color: 'var(--cth-ink-500)', fontSize: 12 }}>{children}</div>; }
function Status({ value }: { value: string }) {
  const good = ['passed', 'completed'].includes(value); const bad = ['cancelled', 'failed', 'infrastructure_failure', 'human_required'].includes(value);
  return <span style={{ padding: '2px 5px', fontSize: 9, whiteSpace: 'nowrap', background: good ? 'var(--cth-mint-light)' : bad ? 'var(--cth-coral-light)' : 'var(--cth-lemon-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>{value.replaceAll('_', ' ')}</span>;
}
function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div style={{ padding: 7, background: 'var(--cth-cream-200)' }}><SectionLabel>{label.toUpperCase()}</SectionLabel><div style={{ fontSize: 11, fontFamily: mono ? 'monospace' : undefined }}>{value}</div></div>; }
function ContractList({ label, values, mono = false }: { label: string; values: string[]; mono?: boolean }) { return <div style={{ marginTop: 7 }}><SectionLabel>{label.toUpperCase()}</SectionLabel>{values.map((value, index) => <div key={`${value}-${index}`} style={{ fontSize: 11, padding: '2px 0', fontFamily: mono ? 'monospace' : undefined }}>• {value}</div>)}</div>; }
function shortPath(path: string): string { const parts = path.split(/[\\/]/).filter(Boolean); return parts.slice(-2).join('/'); }
function skillKey(skill: DepotSkill): string { return `${skill.sourceId}:${skill.relativePath}`; }
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
