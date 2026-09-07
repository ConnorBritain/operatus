import type { AgentLaunch, GauntletRole, GauntletRun, GauntletRunSnapshot, GauntletStatus } from '@shared/gauntlet';
import { needsRuntimeReview } from '@shared/gauntletRuntime';
import { needsCandidateHandoff } from '@shared/candidateHandoff';
import { olderRunProjection as olderThan } from './projectionRevision';

export type RunFilter = 'all' | 'attention' | 'active' | 'closed';
const attentionStatus = (run: GauntletRun): boolean => ['human_required', 'infrastructure_failure'].includes(run.status);
export const isClosedRun = (run: GauntletRun): boolean => !run.preparationPending && !needsRuntimeReview(run) && !needsCandidateHandoff(run) && (['passed', 'cancelled'].includes(run.status) || attentionStatus(run) && run.operatorReview?.reviewed === true);
export const needsOperator = (run: GauntletRun): boolean => !!run.preparationPending || needsRuntimeReview(run) || needsCandidateHandoff(run) || attentionStatus(run) && !run.operatorReview?.reviewed;
export const isTerminalRun = (run: GauntletRun): boolean => ['passed','cancelled','human_required','infrastructure_failure'].includes(run.status);
const rank = (run: GauntletRun): number => (!!run.preparationPending || needsRuntimeReview(run) || attentionStatus(run) && !run.operatorReview?.reviewed)
  ? 0 : needsCandidateHandoff(run) ? 1 : isClosedRun(run) ? 3 : 2;
const priorityRank = (run: GauntletRun): number => ({high:0,normal:1,low:2})[run.operatorPriority?.level ?? 'normal'];
export const orderRuns = (runs: GauntletRun[]): GauntletRun[] => [...runs].sort((a, b) =>
  rank(a) - rank(b) || (isClosedRun(a) ? 0 : priorityRank(a) - priorityRank(b)) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));

/** Responsibility inferred from protocol state, not a claim about PTY health. */
export function nextRunStep(run: GauntletRun): { owner: string; action: string } {
  if (run.preparationPending) return {owner:'You',action:'Inspect incomplete workspace preparation; no launch was recorded'};
  if (needsRuntimeReview(run)) return {owner:'You',action:'Inspect the runtime warning; artifact verdict is unchanged'};
  if (run.status === 'passed' && !needsCandidateHandoff(run)) return {owner:'None',action:'Candidate disposition recorded; integration is not tracked'};
  if (attentionStatus(run) && run.operatorReview?.reviewed) return {owner:'None',action:'Reviewed; stopped outcome and evidence retained'};
  const steps: Record<GauntletStatus, { owner: string; action: string }> = {
    orienting: { owner: 'Conductor', action: 'Freeze the observable bar' },
    awaiting_implementation: { owner: 'Conductor', action: 'Launch an Implementer' },
    implementer_in_flight: { owner: 'Implementer', action: 'Build the candidate commit' },
    awaiting_critic: { owner: 'Conductor', action: 'Launch a fresh Critic' },
    critic_in_flight: { owner: 'Critic', action: 'Inspect the exact candidate' },
    awaiting_lead_ack: { owner: 'Conductor', action: 'Acknowledge the Critic report' },
    needs_repair: { owner: 'Conductor', action: 'Launch the bounded repair' },
    repair_in_flight: { owner: 'Repairer', action: 'Create a repaired candidate' },
    human_required: { owner: 'You', action: 'Resolve the escalation' },
    infrastructure_failure: { owner: 'You', action: 'Inspect the execution failure' },
    passed: { owner: 'You', action: 'Review the unmerged candidate' },
    cancelled: { owner: 'None', action: 'Stopped; evidence retained' }
  };
  return steps[run.status];
}

export function filterRuns(runs: GauntletRun[], filter: RunFilter, repository: string, query: string): GauntletRun[] {
  const text = query.trim().toLocaleLowerCase();
  return orderRuns(runs).filter(run => (!repository || run.repository === repository) &&
    (filter === 'all' || (filter === 'attention' && needsOperator(run)) ||
      (filter === 'active' && !isTerminalRun(run)) || (filter === 'closed' && isClosedRun(run))) &&
    (!text || `${run.id} ${run.requestedObjective} ${run.repository}`.toLocaleLowerCase().includes(text)));
}

export function roleLaunchLabel(run: GauntletRun, role: GauntletRole, launch?: AgentLaunch): string {
  if (launch) return `${launch.status.replaceAll('_', ' ')} · session ${launch.sessionId.slice(0, 8)}`;
  if (role === 'conductor') return 'Configured authority; no launch receipt';
  return isTerminalRun(run) ? 'Not launched in this run' : 'Not launched yet';
}

export interface RunViewState {
  runs: GauntletRun[]; selectedId: string | null; snapshot: GauntletRunSnapshot | null;
  listPending: boolean; detailPending: boolean; listError: string | null; detailError: string | null;
  selectionEpoch: number; listEpoch: number;
}
export const initialRunView: RunViewState = {
  runs: [], selectedId: null, snapshot: null, listPending: true, detailPending: false,
  listError: null, detailError: null, selectionEpoch: 0, listEpoch: 0
};
type Action = { type: 'listed'; epoch: number; runs: GauntletRun[] } | { type: 'list-failed'; epoch: number; error: string }
  | { type: 'list-requested'; epoch: number } | { type: 'select'; id: string }
  | { type: 'detail'; epoch: number; snapshot: GauntletRunSnapshot }
  | { type: 'detail-failed'; epoch: number; error: string }
  | { type: 'changed'; snapshot: GauntletRunSnapshot; select?: boolean };

function mergeRuns(current: GauntletRun[], incoming: GauntletRun[]): GauntletRun[] {
  const map = new Map(current.map(run => [run.id, run]));
  for (const run of incoming) if (!map.has(run.id) || !olderThan(run, map.get(run.id)!)) map.set(run.id, run);
  let closed = 0;
  return orderRuns([...map.values()]).filter(run => !isClosedRun(run) || ++closed <= 100);
}

/** A renderer projection only. Selection epochs reject cross-run responses;
 * pushed snapshots invalidate in-flight reads even at the same run version.
 * Run versions prevent a late initial listing from undoing a newer event.
 */
export function runViewReducer(state: RunViewState, action: Action): RunViewState {
  switch (action.type) {
    case 'list-requested': return action.epoch <= state.listEpoch ? state :
      { ...state, listPending: true, listError: null, listEpoch: action.epoch };
    case 'list-failed': return action.epoch !== state.listEpoch ? state :
      { ...state, listPending: false, listError: action.error };
    case 'listed': {
      if (action.epoch !== state.listEpoch) return state;
      const runs = mergeRuns(state.runs, action.runs);
      const selectedId = state.selectedId ?? runs[0]?.id ?? null;
      const changed = selectedId !== state.selectedId;
      const latest = runs.find(run => run.id === selectedId);
      const previous = state.snapshot?.run ?? state.runs.find(run => run.id === selectedId);
      const evidenceChanged = !!latest && !!previous && olderThan(previous, latest);
      const reloadDetail = changed || evidenceChanged;
      return { ...state, runs, selectedId, listPending: false, listError: null,
        ...(reloadDetail ? { snapshot: null, detailPending: true, detailError: null,
          selectionEpoch: state.selectionEpoch + 1 } : {}) };
    }
    case 'select': return { ...state, selectedId: action.id, snapshot: null, detailPending: true,
      detailError: null, selectionEpoch: state.selectionEpoch + 1 };
    case 'detail-failed': return action.epoch !== state.selectionEpoch ? state :
      { ...state, detailPending: false, detailError: action.error };
    case 'detail': {
      if (action.epoch !== state.selectionEpoch) return state;
      if (action.snapshot.run.id !== state.selectedId) return { ...state, snapshot: null, detailPending: false,
        detailError: 'Received evidence for a different run. Reload the selected run.' };
      const latest = state.runs.find(run => run.id === state.selectedId);
      if (latest && olderThan(action.snapshot.run, latest)) return { ...state, detailPending: false,
        detailError: 'Run changed while loading. Reload its current evidence.' };
      return { ...state, runs: mergeRuns(state.runs, [action.snapshot.run]), snapshot: action.snapshot,
        detailPending: false, detailError: null };
    }
    case 'changed': {
      const next = action.snapshot, previous = state.runs.find(run => run.id === next.run.id);
      if (previous && olderThan(next.run, previous)) return state;
      const selectedId = action.select || !state.selectedId ? next.run.id : state.selectedId;
      const selected = selectedId === next.run.id;
      return { ...state, runs: mergeRuns(state.runs, [next.run]), selectedId,
        ...(selected ? { snapshot: next, detailPending: false, detailError: null, selectionEpoch: state.selectionEpoch + 1 } : {}) };
    }
  }
}
