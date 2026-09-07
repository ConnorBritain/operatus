import type { GauntletRun } from '@shared/gauntlet';

export interface ProjectionRevision {
  protocol: number; runtime: number; preparation: number; priority: number;
}

/** Independent journals may advance without a protocol transition. Keep only
 * their counters in closed-run watermarks, never whole snapshots or note text. */
export function projectionRevision(run: GauntletRun): ProjectionRevision {
  return {protocol:run.version,runtime:run.runtimeRevision ?? 0,
    preparation:run.preparationRevision ?? 0,priority:run.operatorPriority?.revision ?? 0};
}

export function olderProjection(incoming: ProjectionRevision, current: ProjectionRevision): boolean {
  return incoming.protocol < current.protocol || incoming.runtime < current.runtime ||
    incoming.preparation < current.preparation || incoming.priority < current.priority;
}

export function olderRunProjection(incoming: GauntletRun, current: GauntletRun): boolean {
  return olderProjection(projectionRevision(incoming),projectionRevision(current));
}
