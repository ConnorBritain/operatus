/** View selection only. These rules never launch or restore an agent. */
export interface AgentViewCandidate {
  id: string;
  ptyId?: string;
  archived?: boolean;
  isGod?: boolean;
}

export function selectionAfterArrival(
  selectedId: string | null,
  agents: readonly AgentViewCandidate[],
  arrivedId: string,
  explicitlySelect = false
): string | null {
  if (explicitlySelect && agents.some(a => a.id === arrivedId)) return arrivedId;
  if (agents.some(a => a.id === selectedId)) return selectedId;
  return agents.find(a => a.id === arrivedId)?.id ?? agents[0]?.id ?? null;
}

/** Adapted from Munder v0.4.6's focus re-homing principle. Unlike its removal
 * fallback, require a terminal-bearing survivor; synthetic cards cannot render
 * a terminal. PTY liveness still comes from main-process reconciliation. */
export function focusAfterRosterChange(
  focusedId: string | null,
  agents: readonly AgentViewCandidate[],
  selectedId: string | null
): string | null {
  if (focusedId === null) return null; // Explicit exit stays sticky.
  const eligible = (a: AgentViewCandidate): boolean => !!a.ptyId && !a.archived;
  if (agents.some(a => a.id === focusedId && eligible(a))) return focusedId;
  return agents.find(a => a.id === selectedId && eligible(a))?.id
    ?? agents.find(a => a.isGod && eligible(a))?.id
    ?? agents.find(eligible)?.id
    ?? null;
}
