/** Projection hints only. Main checks SQLite identity independently; a renderer
 * cannot acquire or remove launch authority by changing these fields. */
export interface AgentLifecycleHint {
  lifecycleOwner?: 'gauntlet';
  gauntletRunId?: string;
  description?: string;
  role?: string;
}

export function isGauntletWorker(agent: AgentLifecycleHint): boolean {
  return agent.lifecycleOwner === 'gauntlet' ||
    /^Gauntlet (implementer|critic|repairer)$/i.test(agent.description ?? agent.role ?? '');
}

/** Preserve retired workers as history, not executable restore recipes. */
export function partitionRestorable<T extends AgentLifecycleHint>(agents: T[]): { ordinary: T[]; managed: T[] } {
  return { ordinary: agents.filter(a => !isGauntletWorker(a)), managed: agents.filter(isGauntletWorker) };
}
