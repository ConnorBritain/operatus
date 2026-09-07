import { useEffect, useState } from 'react';
import type { GauntletCapacity } from '@shared/gauntletSchedule';
import type { GauntletRun } from '@shared/gauntlet';
import { capacityView } from '../gauntlet/capacityView';
import { isTerminalRun } from '../gauntlet/runViewState';

export function GauntletCapacityPanel({ runs, selectRun }: { runs: GauntletRun[]; selectRun: (id: string) => void }) {
  const [capacity, setCapacity] = useState<GauntletCapacity | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const accept = (next: GauntletCapacity) => setCapacity(current => !current || next.revision >= current.revision ? next : current);
  const refresh = () => window.cth.gauntletCapacity().then(accept);
  useEffect(() => {
    let alive = true;
    const off = window.cth.onGauntletCapacityChanged(next => { if (alive) accept(next); });
    void window.cth.gauntletCapacity().then(next => { if (alive) accept(next); })
      .catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; off(); };
  }, []);
  const change = async (operation: () => Promise<GauntletCapacity>) => {
    setBusy(true); setError('');
    try { accept(await operation()); }
    catch (cause) { setError(String(cause)); try { await refresh(); } catch { /* keep original failure visible */ } }
    finally { setBusy(false); }
  };
  const view = capacity && capacityView(capacity);
  return <details style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
    <summary style={{ cursor: 'pointer', fontWeight: view?.quarantined ? 600 : undefined }}>Capacity: {view ? view.summary : error ? 'unavailable' : 'loading'}</summary>
    {error && <p role="alert">{error} <button type="button" onClick={() => void refresh().then(() => setError('')).catch(cause => setError(String(cause)))}>retry</button></p>}
    {capacity && <div style={{ maxHeight: 240, overflow: 'auto', paddingTop: 6 }}>
      <label>Concurrent Gauntlets{' '}<select aria-label="Concurrent Gauntlets" disabled={busy} value={capacity.maxConcurrentRuns}
        onChange={e => { const limit = Number(e.target.value); void change(() => window.cth.gauntletConfigureCapacity(capacity.revision, limit)); }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <p>Each run may use a lead plus one worker. This is not a CPU, memory, or whole-machine process limit. Quarantined runs still occupy slots; lowering the limit does not stop active work.</p>
      <p>Waiting uses the original run time budget. Subscription holds still apply.</p>
      {capacity.dispatches.map(entry => {
        const run = runs.find(r => r.id === entry.runId);
        return <div key={entry.runId} style={{ borderTop: '1px solid var(--cth-ink-300)', padding: '6px 0', overflowWrap: 'anywhere' }}>
          <button type="button" onClick={() => selectRun(entry.runId)} style={{ textAlign: 'left', color: 'inherit', background: 'none', border: 0, textDecoration: 'underline', cursor: 'pointer' }}>
            {run?.requestedObjective ?? entry.runId} · {entry.state}
          </button>
          <div>{run?.repository} · {entry.runId.slice(0, 8)}</div>
          <div>{entry.reason}</div>
          {entry.state === 'quarantined' && <div>
            <p>Inspect the prior native processes and gateway first. This slot stays occupied until you release it. Marking a run reviewed does not free capacity; releasing capacity does not clear its runtime warnings.</p>
            {!run ? <p>Run details are unavailable. Open the run and reload its evidence before releasing this reservation.</p> :
              !isTerminalRun(run) && <p>This run is still active. End it and inspect its evidence before releasing the reservation.</p>}
            <label>Inspection note<textarea maxLength={1000} rows={2} value={notes[entry.runId] ?? ''}
              onChange={e => { const note = e.target.value; setNotes(current => ({ ...current, [entry.runId]: note })); }} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
            <button type="button" disabled={busy || !run || !isTerminalRun(run) || !notes[entry.runId]?.trim()}
              onClick={() => void change(() => window.cth.gauntletReleaseCapacity(entry.runId, capacity.revision, notes[entry.runId]))}>Release inspected reservation</button>
          </div>}
        </div>;
      })}
    </div>}
  </details>;
}
