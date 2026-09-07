export type DispatchState = 'queued' | 'running' | 'quarantined' | 'settled';
export interface GauntletDispatch {
  runId: string;
  sequence: number;
  state: DispatchState;
  enqueuedAt: number;
  updatedAt: number;
  reason: string;
}
export interface GauntletCapacity {
  revision: number;
  maxConcurrentRuns: number;
  /** Active reservations only, in FIFO order. No process credentials or owner tokens. */
  dispatches: GauntletDispatch[];
}
