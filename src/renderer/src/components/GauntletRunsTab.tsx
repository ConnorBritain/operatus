import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AgentProvider } from '@shared/agentProvider';
import { DEFAULT_ROLE_PROVIDERS } from '@shared/gauntlet';
import type { DepotSkill, GauntletRole, GauntletRunSnapshot, OperatorPriority, PreparationInspection, RoleSkillAssignment, SkillDepotSource } from '@shared/gauntlet';
import { filterRuns, initialRunView, isClosedRun, isTerminalRun, needsOperator, nextRunStep, roleLaunchLabel, runViewReducer } from '../gauntlet/runViewState';
import type { RunFilter } from '../gauntlet/runViewState';
import { protocolLaunchLabel, runtimeView } from '../gauntlet/runtimeView';
import { needsRuntimeReview } from '@shared/gauntletRuntime';
import { needsCandidateHandoff } from '@shared/candidateHandoff';
import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { GauntletCapacityPanel } from './GauntletCapacityPanel';
import { RunDrafts } from '../gauntlet/runDrafts';
import { defaultRunProviders } from '../gauntlet/providerDefaults';

const fieldStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--cth-ink-300)',
  background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', padding: '7px 8px',
  fontFamily: 'var(--cth-font-ui)', fontSize: 13
};

export function GauntletRunsTab({ inspectRun }: { inspectRun?: { id: string; sequence: number } | null }) {
  const [view, dispatch] = useReducer(runViewReducer, initialRunView);
  const [drafts] = useState(()=>new RunDrafts());
  const { runs, selectedId, snapshot } = view;
  const [filter, setFilter] = useState<RunFilter>('all');
  const [repositoryFilter, setRepositoryFilter] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!inspectRun) return;
    setDepotOpen(false); setFilter('all'); setRepositoryFilter(''); setQuery('');
    dispatch({ type: 'select', id: inspectRun.id });
  }, [inspectRun]);
  const [createOpen, setCreateOpen] = useState(false);
  const [repo, setRepo] = useState('');
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depotOpen, setDepotOpen] = useState(false);
  const evidenceScrollRef = useRef<HTMLDivElement>(null);
  const listRequestEpoch = useRef(0);
  const [availableSkills, setAvailableSkills] = useState<DepotSkill[]>([]);
  const [showOptInSkills, setShowOptInSkills] = useState(false);
  const [assignments, setAssignments] = useState<RoleSkillAssignment[]>([]);
  const [assignmentRole, setAssignmentRole] = useState<GauntletRole>('implementer');
  const [assignmentSkill, setAssignmentSkill] = useState('');
  const [providers, setProviders] = useState(() => defaultRunProviders());
  const providersEdited = useRef(false);
  const assignableSkills = useMemo(
    () => availableSkills.filter((skill) => showOptInSkills || !skill.optIn),
    [availableSkills, showOptInSkills]
  );

  const visibleRuns = useMemo(() => filterRuns(runs, filter, repositoryFilter, query), [runs, filter, repositoryFilter, query]);
  const selectedRun = runs.find(run => run.id === selectedId) ?? snapshot?.run;
  const repositories = useMemo(() => [...new Set(runs.map(run => run.repository))].sort(), [runs]);
  const scopedRuns = runs.filter(run => !repositoryFilter || run.repository === repositoryFilter);
  const counts = { all: scopedRuns.length, attention: scopedRuns.filter(needsOperator).length,
    active: scopedRuns.filter(run => !isTerminalRun(run)).length, closed: scopedRuns.filter(isClosedRun).length };

  const reloadList = async (isAlive: () => boolean = () => true, refreshEvidence = true) => {
    const epoch = ++listRequestEpoch.current;
    dispatch({ type: 'list-requested', epoch });
    // Launch/check receipts may change without a phase-version increment.
    // Explicit refresh must reload the selected snapshot as well as summaries.
    if (refreshEvidence && selectedId) dispatch({ type: 'select', id: selectedId });
    try {
      const next = await window.cth.gauntletList();
      if (isAlive()) dispatch({ type: 'listed', epoch, runs: next });
    } catch (cause) { if (isAlive()) dispatch({ type: 'list-failed', epoch, error: message(cause) }); }
  };

  useEffect(() => {
    let alive = true;
    // Optional creation settings must not prevent the operating view from loading.
    void reloadList(() => alive, false);
    void Promise.all([window.cth.getConfig(), window.cth.skillCatalog()]).then(([config, skills]) => {
      if (!alive) return;
      setRepo(config.registeredRepos?.[0] ?? '');
      if (!providersEdited.current) setProviders(defaultRunProviders(config));
      setAvailableSkills(skills);
      const firstSkill = skills.find((skill) => !skill.optIn);
      setAssignmentSkill(firstSkill ? skillKey(firstSkill) : '');
    }).catch((cause) => { if (alive) setError(message(cause)); });
    const off = window.cth.onGauntletChanged((next) => {
      if (!alive) return;
      dispatch({ type: 'changed', snapshot: next });
    });
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    if (!view.selectedId || !view.detailPending) return;
    let alive = true;
    const epoch = view.selectionEpoch;
    void window.cth.gauntletGet(view.selectedId).then(next => {
      if (alive) dispatch({ type: 'detail', epoch, snapshot: next });
    }).catch(cause => { if (alive) dispatch({ type: 'detail-failed', epoch, error: message(cause) }); });
    return () => { alive = false; };
  }, [view.selectedId, view.selectionEpoch, view.detailPending]);

  const selectRun = (id: string) => { setDepotOpen(false); dispatch({ type: 'select', id }); };

  const start = async () => {
    if (!repo.trim() || !objective.trim()) return;
    setBusy(true); setError(null);
    try {
      const created = await window.cth.gauntletStart({ repository: repo.trim(), objective: objective.trim(), providers, assignments });
      setObjective('');
      setAssignments([]);
      dispatch({ type: 'changed', snapshot: created, select: true });
      setCreateOpen(false);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', gridTemplateColumns: 'minmax(300px, 29%) minmax(0, 1fr)', background: 'var(--cth-cream-200)' }}>
      <aside style={{ minWidth: 0, minHeight: 0, borderRight: '1px solid var(--cth-ink-300)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--cth-ink-300)' }}>
          <SectionLabel>RUN CONTROL</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
            <button type="button" aria-expanded={createOpen} aria-controls="gauntlet-create-draft" onClick={() => setCreateOpen(value => !value)} style={{ ...fieldStyle, padding: '3px 8px', cursor: 'pointer' }}>{createOpen ? 'close draft' : '+ new run'}</button>
            <PixelButton variant="secondary" size="sm" disabled={view.listPending} onClick={() => void reloadList()}>refresh</PixelButton>
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.5, marginTop: 8, color: 'var(--cth-ink-700)' }}>macOS subscription pilot. Each agent is admitted by the local runtime before launch.</div>
          <GauntletCapacityPanel runs={runs} selectRun={selectRun} />
        </div>
        <div id="gauntlet-create-draft" hidden={!createOpen} style={{ padding: 10, maxHeight: '48%', overflow: 'auto', borderBottom: '1px solid var(--cth-ink-300)' }}>
          <SectionLabel>NEW GAUNTLET RUN</SectionLabel>
          <input aria-label="Repository path" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="/path/to/git/repository" style={fieldStyle} />
          <textarea aria-label="Bounded objective" value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Describe a bounded coding objective…" rows={4} style={{ ...fieldStyle, resize: 'vertical', marginTop: 6 }} />
          <details style={{ marginTop: 6, fontSize: 11 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--cth-ink-700)' }}>role engines</summary>
            <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
              {(Object.keys(DEFAULT_ROLE_PROVIDERS) as GauntletRole[]).map((role) => <div key={role} style={{ display: 'grid', gridTemplateColumns: '82px 90px 1fr', gap: 4, alignItems: 'center' }}>
                <span>{role}</span>
                <select aria-label={`${role} provider`} value={providers[role].provider} onChange={(event) => {
                  providersEdited.current = true;
                  const provider = event.target.value as AgentProvider;
                  setProviders((current) => ({ ...current, [role]: { provider,
                    model: role === 'conductor' && provider === 'codex' ? 'gpt-6-astra' : undefined } }));
                }} style={fieldStyle}>
                  <option value="claude">Claude</option><option value="codex">Codex</option>
                </select>
                <input aria-label={`${role} model`} value={providers[role].model ?? ''} onChange={(event) => {
                  providersEdited.current = true;
                  setProviders((current) => ({ ...current, [role]: { ...current[role], model: event.target.value || undefined } }));
                }} placeholder="default model" style={fieldStyle} />
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
        <div style={{ padding: 10, borderBottom: '1px solid var(--cth-ink-300)', display: 'grid', gap: 7 }}>
          <select aria-label="Filter runs by repository" value={repositoryFilter} onChange={event => setRepositoryFilter(event.target.value)} style={fieldStyle}>
            <option value="">All repositories</option>
            {repositories.map(path => <option key={path} value={path}>{shortPath(path)}</option>)}
          </select>
          <input aria-label="Search runs" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find objective, repository or run ID" style={fieldStyle} />
          <div aria-label="Run status filters" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {(['attention', 'active', 'all', 'closed'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} style={{
              padding: '7px 6px', border: `1px solid ${filter === value ? 'var(--cth-ink-900)' : 'var(--cth-ink-300)'}`,
              background: filter === value ? 'var(--cth-lilac-light)' : 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', cursor: 'pointer', fontFamily: 'var(--cth-font-ui)', fontSize: 12
            }}>{value === 'attention' ? 'Needs you' : value === 'closed' ? 'Recent closed' : value === 'active' ? 'Active' : 'All'} · {view.listPending ? '…' : counts[value]}</button>)}
          </div>
        </div>
        <div aria-label="Gauntlet run list" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 6 }}>
          {view.listPending && <Empty>Loading runs…</Empty>}
          {view.listError && <div role="alert" style={{ padding: 8, fontSize: 12 }}>Could not load the run list. {view.listError}</div>}
          {!view.listPending && !view.listError && visibleRuns.length === 0 && <Empty>{runs.length === 0 ? 'No runs yet. Prepare a bounded objective with + new run.' : 'No runs match these filters.'}</Empty>}
          {visibleRuns.map((run) => (
            <button key={run.id} aria-current={selectedId === run.id ? 'true' : undefined} data-run-id={run.id} onClick={() => selectRun(run.id)} style={{
              width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', marginBottom: 5, padding: 8,
              background: selectedId === run.id ? 'var(--cth-lilac-light)' : 'var(--cth-cream-100)',
              boxShadow: `inset 0 0 0 1px ${selectedId === run.id ? 'var(--cth-lilac)' : 'var(--cth-ink-100)'}`,
              color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                <code style={{ fontSize: 11 }}>{run.id.slice(0, 8)}</code><Status value={run.status} />
              </div>
              <div title={run.requestedObjective} style={{ fontSize: 13, lineHeight: 1.4, marginTop: 7, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{run.requestedObjective}</div>
              <div title={run.repository} style={{ fontSize: 11, color: 'var(--cth-ink-700)', marginTop: 5, overflowWrap: 'anywhere' }}>{shortPath(run.repository)}</div>
              <div style={{ fontSize: 11, marginTop: 7, lineHeight: 1.4 }}><strong>{nextRunStep(run).owner}</strong> · {nextRunStep(run).action}</div>
              {run.operatorPriority && <div title={run.operatorPriority.note} style={{fontSize:11,marginTop:6}}>Attention priority: <strong>{run.operatorPriority.level}</strong></div>}
              {needsOperator(run) && run.stopReason && <div title={run.stopReason} style={{fontSize:11,lineHeight:1.4,marginTop:6,overflowWrap:'anywhere',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{run.stopReason}</div>}
            </button>
          ))}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid var(--cth-ink-300)' }}>
          <div style={{ fontSize: 10, lineHeight: 1.4, color: 'var(--cth-ink-700)', marginBottom: 7 }}>All open and attention-needed runs, plus 100 recent closed runs. Counts follow the repository filter.</div>
          <PixelButton variant="secondary" size="sm" fullWidth onClick={() => setDepotOpen((value) => !value)}>
            {depotOpen ? 'close skill depot' : 'skill depot'}
          </PixelButton>
        </div>
      </aside>
      <main aria-label="Selected run evidence" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!depotOpen && selectedRun && <header aria-label="Selected run context" data-run-context={selectedRun.id} style={{ flexShrink: 0, padding: '10px 14px', background: 'var(--cth-paper-100)', borderBottom: '2px solid var(--cth-ink-300)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                <code title={selectedRun.id} style={{ fontSize: 11 }}>{selectedRun.id.slice(0, 8)}</code>
                <Status value={selectedRun.status} />
              </div>
              <div title={selectedRun.requestedObjective} style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedRun.requestedObjective}</div>
            </div>
            <PixelButton variant="secondary" size="sm" onClick={() => evidenceScrollRef.current?.scrollTo({ top: 0 })}>overview</PixelButton>
          </div>
          <div title={selectedRun.repository} style={{ marginTop: 5, fontSize: 11, color: 'var(--cth-ink-700)', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{selectedRun.repository}</div>
          <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.4 }}><strong>{nextRunStep(selectedRun).owner}</strong> · {nextRunStep(selectedRun).action}</div>
          {view.detailPending && <div role="status" style={{ marginTop: 6, fontSize: 12 }}>Loading current evidence…</div>}
          {!visibleRuns.some(run => run.id === selectedId) && <div role="status" style={{ marginTop: 6, padding: 5, fontSize: 11, background: 'var(--cth-lemon-light)' }}>Viewing a run outside the current list filters.</div>}
        </header>}
        <div key={`${selectedId ?? 'empty'}:${depotOpen ? 'depot' : 'run'}`} ref={evidenceScrollRef} aria-label="Run evidence scroll area" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
        {!depotOpen && view.detailError && <div role="alert" style={{ padding: 10, marginBottom: 10, background: 'var(--cth-coral-light)', fontSize: 12 }}>
          {view.detailError} {selectedId && <PixelButton size="sm" variant="secondary" onClick={() => selectRun(selectedId)}>reload evidence</PixelButton>}
        </div>}
        {depotOpen ? <SkillDepotPanel /> : view.detailPending ? <Empty>Loading selected run evidence…</Empty> : snapshot ? <RunDetail key={snapshot.run.id} snapshot={snapshot} drafts={drafts} onPriority={async (revision,level,note)=>{
          const next = await window.cth.gauntletSetPriority(snapshot.run.id,revision,level,note);
          dispatch({type:'changed',snapshot:next});
        }} onReview={async (reviewed,note,version,runtimeSequence) => {
          const next = await window.cth.gauntletReviewAttention(snapshot.run.id,version,reviewed,note,runtimeSequence);
          dispatch({type:'changed',snapshot:next});
        }} onHandoff={async (version,sha,reviewed,note)=>{
          const next = await window.cth.gauntletCandidateHandoff(snapshot.run.id,version,sha,reviewed,note);
          dispatch({type:'changed',snapshot:next});
        }} onCancel={async () => {
          const cancelled = await window.cth.gauntletCancel(snapshot.run.id, 'Cancelled from the Operatus Runs surface');
          dispatch({ type: 'changed', snapshot: cancelled });
        }} /> : <Empty>{view.listPending ? 'Loading the operating view…' : 'Select a run to inspect its contract, agents, evidence, and immutable artifacts.'}</Empty>}
        </div>
      </main>
    </div>
  );
}

function RunDetail({ snapshot, drafts, onCancel, onReview, onPriority, onHandoff }: { snapshot: GauntletRunSnapshot; drafts:RunDrafts; onCancel: () => Promise<void>; onReview: (reviewed:boolean,note:string,version:number,runtimeSequence:number)=>Promise<void>; onPriority:(revision:number,level:OperatorPriority['level'],note:string)=>Promise<void>; onHandoff:(version:number,sha:string,reviewed:boolean,note:string)=>Promise<void> }) {
  const { run } = snapshot;
  const terminal = isTerminalRun(run);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const draft = useSyncExternalStore(notify=>drafts.subscribe(run,notify),()=>drafts.read(run));
  const {note:reviewNote,basis:reviewBasis} = draft.review;
  const [handoffBusy,setHandoffBusy] = useState(false);
  const [handoffError,setHandoffError] = useState<string|null>(null);
  const handoffPending = needsCandidateHandoff(run);
  const handoff = async () => {
    setHandoffBusy(true);setHandoffError(null);
    const saved = draft.handoff;
    try {
      if (!saved.basis?.sha || saved.basis.version !== run.version || saved.basis.sha !== run.currentArtifactSha) throw Error('Candidate evidence changed. Inspect current evidence and edit the note before saving.');
      await onHandoff(saved.basis.version,saved.basis.sha,handoffPending,saved.note.trim());
      drafts.clearHandoff(run,saved.edit);
    } catch(cause) {setHandoffError(message(cause));}
    finally {setHandoffBusy(false);}
  };
  const [reviewBusy,setReviewBusy] = useState(false);
  const [reviewError,setReviewError] = useState<string|null>(null);
  const priorityDraft = draft.priority;
  const [priorityBusy,setPriorityBusy] = useState(false);
  const [priorityError,setPriorityError] = useState<string|null>(null);
  const savePriority = async () => {
    setPriorityBusy(true);setPriorityError(null);
    try {
      if (priorityDraft.revision !== (run.operatorPriority?.revision ?? 0)) throw Error('Priority changed while you edited. Inspect the current reason and edit your draft before saving.');
      await onPriority(priorityDraft.revision,priorityDraft.level,priorityDraft.note);
      drafts.clearPriority(run,priorityDraft.edit);
    } catch(cause) {setPriorityError(message(cause));}
    finally {setPriorityBusy(false);}
  };
  const [inspection,setInspection] = useState<PreparationInspection|null>(null);
  const [inspectionBusy,setInspectionBusy] = useState(false);
  const [inspectionError,setInspectionError] = useState<string|null>(null);
  const inspectPreparation = async (launchId: string) => {
    setInspectionBusy(true);setInspectionError(null);setInspection(null);
    try {
      const result = await window.cth.gauntletInspectPreparation(run.id,launchId);
      if (result.runId !== run.id || result.launchId !== launchId) throw Error('Inspection returned a different preparation');
      setInspection(result);
    } catch(cause) {setInspectionError(message(cause));}
    finally {setInspectionBusy(false);}
  };
  const reviewCurrent = !!run.operatorReview?.reviewed && !needsRuntimeReview(run);
  const sessionsRef = useRef<HTMLDivElement>(null);
  const review = async () => {
    setReviewBusy(true);setReviewError(null);
    try {
      if (!reviewBasis || reviewBasis.version !== run.version || reviewBasis.sequence !== (run.runtimeAttention?.sequence ?? 0)) throw Error('Evidence changed while you wrote this note. Inspect the new evidence and edit the note before saving.');
      await onReview(!reviewCurrent,reviewNote.trim(),reviewBasis.version,reviewBasis.sequence);
      drafts.clearReview(run,draft.review.edit);
    }
    catch(cause){setReviewError(message(cause));}
    finally{setReviewBusy(false);}
  };
  const reportsRef = useRef<HTMLDivElement>(null);
  const step = nextRunStep(run);
  const cancel = async () => {
    setCancelling(true); setCancelError(null);
    try { await onCancel(); } catch (cause) { setCancelError(message(cause)); }
    finally { setCancelling(false); }
  };
  const artifact = snapshot.artifacts.at(-1);
  const preservations = [...new Map((snapshot.preservations ?? []).map(receipt => [receipt.requestId, receipt])).values()];
  return <div data-run-detail={run.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0, overflowWrap: 'anywhere', gap: 10 }}>
    <PixelPanel>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <SectionLabel>GAUNTLET RUN · {run.id.slice(0, 8)}</SectionLabel>
          <div style={{ fontSize: 16, lineHeight: 1.35 }}>{run.requestedObjective}</div>
          <div style={{ color: 'var(--cth-ink-500)', marginTop: 4, fontSize: 11, overflowWrap: 'anywhere' }}>{run.repository}</div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}><Status value={run.status} />
          {!terminal && <PixelButton variant="destructive" size="sm" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? 'cancelling…' : 'cancel'}</PixelButton>}
        </div>
      </div>
      <div style={{ padding: 10, marginTop: 12, background: needsOperator(run) ? 'var(--cth-coral-light)' : 'var(--cth-lemon-light)', fontSize: 14, lineHeight: 1.45 }}>
        <SectionLabel>NEXT RESPONSIBILITY · {step.owner.toUpperCase()}</SectionLabel>
        {step.action}
        {run.runtimeAttention && <PixelButton size="sm" variant="secondary" style={{ marginLeft: 10 }} onClick={() => sessionsRef.current?.scrollIntoView({ block: 'start' })}>inspect runtime evidence</PixelButton>}
        {snapshot.reports.length > 0 && <PixelButton size="sm" variant="secondary" style={{ marginLeft: 10 }} onClick={() => reportsRef.current?.scrollIntoView({ block: 'start' })}>inspect Critic evidence</PixelButton>}
      </div>
      {cancelError && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--cth-coral)' }}>Cancellation failed: {cancelError}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(90px, 1fr))', gap: 6, marginTop: 10 }}>
        <Metric label="phase" value={run.status.replaceAll('_', ' ')} />
        <Metric label="repair round" value={`${run.repairRound} / ${run.limits.maxRepairRounds}`} />
        <Metric label="base" value={run.baseSha.slice(0, 10)} mono />
        <Metric label="candidate" value={run.currentArtifactSha?.slice(0, 10) ?? '—'} mono />
      </div>
      {run.stopReason && <div style={{ marginTop: 8, padding: 7, background: 'var(--cth-coral-light)', fontSize: 12 }}>{run.stopReason}</div>}
      {run.status === 'passed' && <section aria-label="Candidate handoff" style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--cth-ink-300)'}}>
        <SectionLabel>{handoffPending ? 'VERIFIED CANDIDATE · YOUR NEXT STEP' : 'CANDIDATE DISPOSITION RECORDED'}</SectionLabel>
        <p style={{fontSize:12,lineHeight:1.5}}>A passed run is not a delivered project. Record who takes this candidate forward, or why you are setting it aside. This closes only the candidate inbox item, not runtime warnings. Nothing is merged, pushed, restarted, or deleted.</p>
        <code style={{display:'block',overflowWrap:'anywhere',fontSize:12}}>{run.currentArtifactSha ?? 'Candidate identity missing. Inspect evidence before proceeding.'}</code>
        {run.candidateHandoff && <p style={{fontSize:12,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{run.candidateHandoff.note}</p>}
        <textarea aria-label="Candidate disposition note" maxLength={4000} rows={2} value={draft.handoff.note} onChange={event=>drafts.handoff(run,event.target.value)} placeholder={handoffPending ? 'Next owner and action, or reason to set aside' : 'Why does this candidate need your attention again?'} style={{...fieldStyle,resize:'vertical',marginTop:8}} />
        {!!draft.handoff.note && <p style={{fontSize:11}}>Unsaved draft. Kept across run switches and refreshes while Runs stays open.</p>}
        <PixelButton size="sm" variant="secondary" disabled={handoffBusy||!draft.handoff.note.trim()||!run.currentArtifactSha} onClick={()=>void handoff()} style={{marginTop:6}}>{handoffBusy ? 'saving disposition…' : handoffPending ? 'record disposition' : 'return candidate to Needs you'}</PixelButton>
        {handoffError && <p role="alert" style={{fontSize:12}}>Disposition was not saved: {handoffError}</p>}
      </section>}
      <details style={{marginTop:12,fontSize:12}}>
        <summary style={{cursor:'pointer'}}>Attention priority: {run.operatorPriority?.level ?? 'normal'} · set your focus</summary>
        <p>Orders open runs within their attention group. Unresolved warnings always come first; closed history stays recent-first. Execution remains FIFO; this does not change the bar, owner, or verdict.</p>
        {run.operatorPriority && <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>Current reason: {run.operatorPriority.note}</p>}
        <select aria-label="Attention priority" value={priorityDraft.edited ? priorityDraft.level : run.operatorPriority?.level ?? 'normal'} disabled={priorityBusy} onChange={event=>drafts.priority(run,{level:event.target.value as OperatorPriority['level']})} style={fieldStyle}>
          <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
        </select>
        <textarea aria-label="Attention priority reason" rows={2} maxLength={2000} disabled={priorityBusy} value={priorityDraft.note} onChange={event=>drafts.priority(run,{note:event.target.value})} placeholder="Why does this deserve more or less of your attention?" style={{...fieldStyle,marginTop:6,resize:'vertical'}} />
        {!!priorityDraft.note && <p style={{fontSize:11}}>Unsaved draft. Kept across run switches and refreshes while Runs stays open.</p>}
        <PixelButton size="sm" variant="secondary" disabled={priorityBusy||!priorityDraft.note.trim()} onClick={()=>void savePriority()} style={{marginTop:6}}>{priorityBusy ? 'saving…' : 'save attention priority'}</PixelButton>
        {priorityError && <p role="alert">{priorityError}</p>}
        {!!snapshot.operatorPriorityHistory?.length && <details style={{marginTop:8}}><summary>Priority history · {snapshot.operatorPriorityHistory.length}</summary>
          {[...snapshot.operatorPriorityHistory].reverse().map(item=><p key={item.revision} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><strong>{item.level}</strong> · {new Date(item.at).toLocaleString()}<br />{item.note}</p>)}
        </details>}
      </details>
      {terminal && (['human_required','infrastructure_failure'].includes(run.status) || run.runtimeAttention) && <section aria-label="Operator review" style={{marginTop:12,borderTop:'1px solid var(--cth-ink-300)',paddingTop:10}}>
        <SectionLabel>{reviewCurrent ? 'REVIEWED BY YOU' : 'RECORD YOUR DECISION'}</SectionLabel>
        {run.runtimeAttention && <p style={{fontSize:12,lineHeight:1.5}}>Runtime warnings recorded: {run.runtimeAttention.count}. This review covers evidence through #{run.runtimeAttention.sequence}. New warnings will return to Needs you.</p>}
        {run.operatorReview && <p style={{fontSize:12,lineHeight:1.5,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{run.operatorReview.note}</p>}
        <p style={{fontSize:12,lineHeight:1.5,margin:'0 0 8px'}}>{run.preparationPending ? 'Incomplete workspace preparation needs inspection and cannot be dismissed. Automatic recovery is not available.' : 'Marking reviewed clears the stopped-run/runtime warning, not a pending candidate handoff. The run stays stopped. Nothing is passed, merged, restarted, or deleted.'}</p>
        <textarea aria-label="Operator review note" maxLength={4000} rows={2} value={reviewNote} onChange={event=>drafts.review(run,event.target.value)}
          placeholder={reviewCurrent ? 'Why does this need attention again?' : 'What did you decide, and what happens next?'} style={{...fieldStyle,resize:'vertical'}} />
        {!!reviewNote && <p style={{fontSize:11}}>Unsaved draft. Kept across run switches and refreshes while Runs stays open.</p>}
        <PixelButton size="sm" variant="secondary" disabled={reviewBusy||!reviewNote.trim()||!!run.preparationPending} onClick={()=>void review()} style={{marginTop:6}}>
          {reviewBusy ? 'saving review…' : reviewCurrent ? 'return to Needs you' : 'mark reviewed'}
        </PixelButton>
        {reviewError && <p role="alert" style={{fontSize:12,color:'var(--cth-coral)'}}>Review was not saved: {reviewError}. Reload current evidence before retrying.</p>}
      </section>}
    </PixelPanel>

    {!!snapshot.pendingPreparations?.length && <PixelPanel title="INCOMPLETE WORKSPACE PREPARATION">
      <p style={{fontSize:12}}>These are intended locations, not verified filesystem observations. No launch was recorded for these attempts. Inspect retained work before starting another run; nothing is adopted or removed automatically.</p>
      {snapshot.pendingPreparations.map(preparation => <div key={preparation.launchId} style={{fontSize:12,overflowWrap:'anywhere',padding:'8px 0'}}>
        <strong>{preparation.role}</strong> · preparation {preparation.launchId}
        <div>Expected commit: {preparation.expectedSha}</div>
        <div>Frozen bar: {preparation.contractDigest}</div>
        <div>Intended worktree: {preparation.worktreePath}</div>
        {preparation.candidateBranch && <div>Intended branch: {preparation.candidateBranch}</div>}
        {preparation.reviewEvidencePath && <div>Intended evidence parent: {preparation.reviewEvidencePath}</div>}
        <PixelButton size="sm" variant="secondary" disabled={inspectionBusy} onClick={()=>void inspectPreparation(preparation.launchId)} style={{marginTop:8}}>
          {inspectionBusy ? 'inspecting…' : 'inspect retained workspace'}
        </PixelButton>
        {inspection?.launchId === preparation.launchId && <div role="status" style={{marginTop:8}}>
          <strong>Observed: {inspection.state.replaceAll('_',' ')}</strong> · {new Date(inspection.observedAt).toLocaleTimeString()}
          {inspection.observedSha && <div>Observed commit: {inspection.observedSha}</div>}
          {inspection.observedSha && <div>Observed branch: {inspection.observedBranch ?? 'detached'} · {inspection.dirty ? 'uncommitted changes present' : 'no changes observed (submodules not inspected)'}</div>}
          {inspection.evidenceDirectory !== 'not_applicable' && <div>Evidence parent: {inspection.evidenceDirectory.replaceAll('_',' ')} (contents not validated)</div>}
          <p>This read-only diagnostic can become stale and is not saved as an artifact or recovery decision. It does not clear attention, permit retry, or authorize deletion.</p>
        </div>}
      </div>)}
      {inspectionError && <p role="alert" style={{fontSize:12}}>Inspection unavailable: {inspectionError}</p>}
    </PixelPanel>}

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
            <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--cth-ink-700)', marginTop: 4 }}>{active ? runtimeView(active.id, snapshot.runtimeObservations).label : roleLaunchLabel(run, role, active)}</div>
          </div>;
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--cth-ink-700)' }}>Latest session per role. Recorded process observations, not a live health check.</div>
    </PixelPanel>

    {snapshot.launches.length > 0 && <div ref={sessionsRef}><PixelPanel title={`ROLE SESSIONS · ${snapshot.launches.length}`}>
      {snapshot.launches.slice().reverse().map((launch) => {
        const runtime = runtimeView(launch.id, snapshot.runtimeObservations);
        return <div key={launch.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--cth-ink-100)', fontSize: 11 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}><strong>{launch.role}</strong><span>{launch.provider}{launch.model ? ` · ${launch.model}` : ''}</span></div>
        <div data-runtime-launch={launch.id} style={{ marginTop: 6, fontSize: 12, color: runtime.warning ? 'var(--cth-coral)' : 'var(--cth-ink-900)' }}>
          <strong>Native process: {runtime.label}</strong>
          {runtime.warning && <div style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{runtime.detail}</div>}
          {runtime.guidance && <p style={{fontSize:12,lineHeight:1.5,color:'var(--cth-ink-900)'}}><strong>Next inspection: </strong>{runtime.guidance}</p>}
          {runtime.activities.length > 0 && <div style={{marginTop:5,fontSize:12}}>
            Last observed activity: {runtime.activities.at(-1)!.activity} · {runtime.activities.at(-1)!.stage}
            {runtime.activities.at(-1)!.outcome && ` (${runtime.activities.at(-1)!.outcome})`} · {new Date(runtime.activities.at(-1)!.at).toLocaleTimeString()}
          </div>}
        </div>
        {runtime.activities.length > 0 && <details style={{marginTop:6}}><summary>Observed tool activity · {runtime.activities.length}</summary>
          <p>Activity is not task success. Commands, paths and tool output are not included here.</p>
          {runtime.activities.slice(-20).map(activity=><div key={activity.ordinal} style={{padding:'3px 0'}}>
            {new Date(activity.at).toLocaleTimeString()} · {activity.activity} · {activity.stage}{activity.outcome && ` (${activity.outcome})`}
          </div>)}
          {runtime.activities.length > 20 && <p>Showing the most recent 20 observations. Earlier observations remain in the run journal.</p>}
        </details>}
        {runtime.nativeIdentity && <details style={{marginTop:6,overflowWrap:'anywhere'}}><summary>Native session identity</summary>
          <div>Codex thread <code>{runtime.nativeIdentity.threadId}</code></div>
          <div>Turn <code>{runtime.nativeIdentity.turnId ?? 'Not observed'}</code></div>
          <p>Recorded provider identities, separate from the allocated run session. They do not authorize resuming a Critic.</p>
        </details>}
        <details style={{marginTop:6}}><summary>Output diagnostics</summary>
          {runtime.output ? <div style={{marginTop:5,lineHeight:1.5}}>
            <div>Received {runtime.output.receivedBytes.toLocaleString()} bytes</div>
            <div>Standard output {runtime.output.stdoutBytes.toLocaleString()} bytes · standard error {runtime.output.stderrBytes.toLocaleString()} bytes</div>
            <div>In-memory diagnostic previews truncated: {runtime.output.stdoutPreviewTruncated || runtime.output.stderrPreviewTruncated
              ? [runtime.output.stdoutPreviewTruncated && 'standard output',runtime.output.stderrPreviewTruncated && 'standard error'].filter(Boolean).join(', ') : 'neither'}</div>
            <p>Historical transport counters at exit, not a measure of task progress. Raw provider output and preview text are not retained in this journal. Preview truncation alone does not mean the session failed.</p>
          </div> : <p>No persisted output counters for this launch. A running session, older record or interrupted process may have no exit measurements; this does not mean zero output.</p>}
        </details>
        <details style={{marginTop:6}}><summary>Session identity and safeguards</summary>
        <div style={{marginTop:5}}>Protocol: {protocolLaunchLabel(launch)}. This does not describe process health.</div>
        {!runtime.warning && <p>{runtime.detail}</p>}
        <div style={{ color: 'var(--cth-ink-700)', marginTop: 3, overflowWrap: 'anywhere' }}>
          launch <code>{launch.id}</code> · session <code>{launch.sessionId}</code><br />expected <code>{launch.expectedSha}</code>
          {(launch.role === 'implementer' || launch.role === 'repairer') && <><br />candidate branch <code>{launch.candidateBranch ?? run.branch}</code></>}
        </div>
        <div style={{ marginTop: 3 }}>filesystem {launch.capability.filesystem} · fresh context {launch.capability.cleanContext} · tools {launch.capability.toolRestrictions}</div>
        {runtime.admission ? <div style={{marginTop:8,overflowWrap:'anywhere',lineHeight:1.5}}>
          <strong>Historical subscription check</strong>
          <div>{runtime.admission.source === 'provider-metadata' ? 'Source: provider metadata' : runtime.admission.source === 'injected-dependencies'
            ? 'Source: injected dependencies. This is not proof of live provider admission.' : 'Source not recorded. Live provider admission is unproven.'}</div>
          <div>{runtime.admission.provider === 'claude' ? 'Claude Max · extra usage observed disabled' :
            `ChatGPT ${runtime.admission.plan} · no credits observed · top-ups not programmatically verified`}</div>
          <div>Model <code>{runtime.admission.model}</code> · executable {runtime.admission.executableVersion}</div>
          <div>Checked {new Date(runtime.admission.checkedAt).toLocaleString()} · component receipt valid until {new Date(runtime.admission.validUntil).toLocaleTimeString()}</div>
          <p>This is a short-lived pre-launch account check, not current account health or permission to launch. The gateway rechecks account settings for requests; this saved record cannot bypass the subscription hold.</p>
          <div>Executable SHA-256 <code>{runtime.admission.executableSha256}</code></div>
          <div>Account fingerprint <code>{runtime.admission.accountHash}</code></div>
          {runtime.admission.provider === 'claude' ? <div>Organization fingerprint <code>{runtime.admission.organizationHash}</code></div> :
            <div>Code Mode companion SHA-256 <code>{runtime.admission.companionSha256}</code></div>}
          <div>No credential or credential hash is retained in this record.</div>
        </div> : <p>No persisted subscription check for this launch. A model name or authentication status alone does not prove subscription-only admission.</p>}
        </details>
        {runtime.deliveries.length > 0 && <details style={{ marginTop: 6 }}><summary>Conductor deliveries · {runtime.deliveries.length}</summary>
          <p>A completed conversation turn is not a protocol acknowledgment.</p>
          {runtime.deliveries.map(delivery => <div key={delivery.messageId} style={{ borderTop: '1px solid var(--cth-ink-100)', padding: '5px 0', overflowWrap: 'anywhere' }}>
            <strong>{delivery.purpose} · {delivery.status}</strong> · {new Date(delivery.at).toLocaleString()}
            <div>message <code>{delivery.messageId}</code>{delivery.reportId && <> · report <code>{delivery.reportId}</code></>}</div>
            <div>prompt SHA-256 <code>{delivery.promptSha256}</code></div>
          </div>)}
        </details>}
      </div>; })}
    </PixelPanel></div>}

    {snapshot.skillLock && <PixelPanel title={`LOCKED SKILLS · ${snapshot.skillLock.entries.length}`}>
      {snapshot.skillLock.entries.map((entry) => <div key={`${entry.role}:${entry.sourceId}:${entry.relativePath}`} style={{ padding: '5px 0', borderBottom: '1px solid var(--cth-ink-100)', fontSize: 11 }}>
        <strong>{entry.role} · {entry.skillName}</strong>
        <div style={{ color: 'var(--cth-ink-500)', marginTop: 2, overflowWrap: 'anywhere' }}>{entry.sourceId}@<code>{entry.sourceCommit}</code><br />digest <code>{entry.digest}</code></div>
      </div>)}
    </PixelPanel>}

    {preservations.length > 0 && <PixelPanel title="RETAINED WORK · OBSERVATIONS">
      <div style={{ fontSize: 12, marginBottom: 8 }}>Preservation does not accept an artifact or pass a run.</div>
      {preservations.map(receipt => <div key={receipt.id} data-preservation-receipt={receipt.id} style={{ padding: '8px 0', borderTop: '1px solid var(--cth-ink-100)', fontSize: 12, overflowWrap: 'anywhere' }}>
        <strong>{({ pending: 'Cleanup pending', preserved: 'Worktree preserved', missing: 'Missing: nothing verified preserved', failed: 'Preservation failed' })[receipt.outcome]}</strong>
        <div style={{ marginTop: 5 }}>Observed commit <code>{receipt.observedSha ?? 'Not observed'}</code></div>
        <div style={{ fontSize: 11, marginTop: 3, color: 'var(--cth-ink-500)' }}>Expected <code>{receipt.expectedSha}</code> · {receipt.dirty === null ? 'cleanliness unknown' : receipt.dirty ? 'dirty or untracked work present' : 'clean at observation'}</div>
        <div style={{ marginTop: 5 }}>{receipt.reason}</div>
        {receipt.error && <div style={{ color: 'var(--cth-coral)', marginTop: 5 }}>{receipt.error}</div>}
        <details style={{ fontSize: 11, marginTop: 6 }}><summary>Location and receipt</summary>
          <div style={{ marginTop: 5 }}><code>{receipt.worktreePath}</code><br />branch <code>{receipt.candidateBranch ?? 'detached Critic'}</code><br />launch <code>{receipt.launchId}</code><br />request <code>{receipt.requestId}</code><br />receipt <code>{receipt.id}</code></div>
        </details>
      </div>)}
    </PixelPanel>}

    {artifact && <PixelPanel title={`EXACT ARTIFACT HISTORY · ${snapshot.artifacts.length}`}>
      {snapshot.artifacts.slice().reverse().map((item) => <div key={item.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--cth-ink-100)' }}>
        <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{item.sha}</code>
        <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 2 }}>parent <code>{item.parentSha}</code></div>
        <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 2, overflowWrap: 'anywhere' }}>candidate branch <code>{item.branch}</code> · no automatic merge or push</div>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '8px 0', maxHeight: 160, overflow: 'auto' }}>{item.diffSummary}</pre>
        {item.checkReceipts.map((check) => <details key={check.checkId} style={{ padding: '5px 0', borderTop: '1px solid var(--cth-ink-100)', fontSize: 11 }}>
          <summary style={{ display: 'flex', gap: 8, cursor: 'pointer' }}><Status value={check.exitCode === 0 && !check.timedOut ? 'passed' : 'failed'} /><code style={{ flex: 1 }}>{check.command}</code><span>{(check.durationMs / 1000).toFixed(1)}s</span></summary>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', background: 'var(--cth-ink-900)', color: 'var(--cth-cream-100)', padding: 7 }}>{check.output || '(no output)'}</pre>
        </details>)}
      </div>)}
    </PixelPanel>}

    {snapshot.reports.length > 0 && <div ref={reportsRef} aria-label="Critic reports" style={{ display: 'grid', gap: 10 }}>
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
    </div>}

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
        {event.type === 'OPERATOR_REVIEW_RECORDED' && <div style={{gridColumn:'2 / -1',whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12,lineHeight:1.5}}>
          <strong>{event.reviewed ? 'Marked reviewed' : 'Returned to Needs you'}:</strong> {event.note}
        </div>}
        {event.type === 'CANDIDATE_HANDOFF_RECORDED' && <div style={{gridColumn:'2 / -1',whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12,lineHeight:1.5}}>
          <strong>{event.reviewed ? 'Candidate disposition recorded' : 'Candidate returned to Needs you'}:</strong> {event.note}<br /><code>{event.artifactSha}</code>
        </div>}
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
