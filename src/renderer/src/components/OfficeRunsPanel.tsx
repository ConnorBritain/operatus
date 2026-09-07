import type { OfficeRun } from '../gauntlet/officeProjection';
import { needsOperator, nextRunStep } from '../gauntlet/runViewState';

export function OfficeRunsPanel({ rows, loading, error, onInspect }: {
  rows: OfficeRun[]; loading: boolean; error: string | null; onInspect: (id?: string) => void;
}) {
  return <section aria-label="Office Gauntlet activity" style={{ height: '100%', overflow: 'auto', padding: 14,
    boxSizing: 'border-box', background: 'var(--cth-paper-100)', border: '1px solid var(--cth-ink-300)', fontFamily: 'var(--cth-font-ui)' }}>
    <h2 style={{ margin: '0 0 10px', fontFamily: 'var(--cth-font-display)', fontSize: 12 }}>WORK IN MOTION</h2>
    <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
      {rows.length} open or unsettled runs · {rows.filter(row => needsOperator(row.run)).length} need you
      <br />Recorded activity, not a live health check. Select a run or sprite for evidence.
      {rows.some(row => row.actors.some(actor => actor.mode === 'unknown')) && <><br />Unknown exits stay here for review, not at occupied desks.</>}
    </div>
    {loading && <p role="status">Loading run activity…</p>}
    {error && <p role="alert">{error}</p>}
    {rows.map(({ run, actors }) => <button key={run.id} onClick={() => onInspect(run.id)} style={{
      display: 'block', width: '100%', padding: 10, marginBottom: 10, textAlign: 'left', cursor: 'pointer',
      color: 'var(--cth-ink-900)', font: 'inherit', background: needsOperator(run) ? '#fff0cf' : 'var(--cth-cream-50)',
      border: '1px solid var(--cth-ink-300)', borderLeft: `4px solid ${needsOperator(run) ? '#bd653e' : '#528b7a'}`
    }}>
      <div title={run.repository} style={{ fontSize: 11, overflowWrap: 'anywhere' }}>
        {run.repository.split(/[\\/]/).filter(Boolean).slice(-2).join('/')} · {run.id.slice(0, 8)}
      </div>
      <div title={run.requestedObjective} style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.4,
        margin: '7px 0', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{run.requestedObjective}</div>
      <div style={{ fontSize: 12 }}><strong>{nextRunStep(run).owner}</strong> · {nextRunStep(run).action}</div>
      {actors.length === 0 ? <div style={{ marginTop: 8, fontSize: 12 }}>No process awaiting an exit receipt</div> :
        actors.map(actor => <div key={actor.id} style={{ marginTop: 8, fontSize: 12 }}>
          <strong>{actor.role}</strong> · {actor.provider}<br />{actor.label}
          <span style={{ color: 'var(--cth-ink-700)' }}> · {new Date(actor.observedAt).toLocaleTimeString()}</span>
        </div>)}
    </button>)}
    <button onClick={() => onInspect()} style={{ padding: '8px 12px', font: 'inherit', cursor: 'pointer' }}>Open Runs</button>
  </section>;
}
