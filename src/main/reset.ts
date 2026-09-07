import { RESET_UNAVAILABLE_REASON } from '../shared/resetPolicy';

/** Deliberately has no filesystem, runtime or configuration dependencies. Old
 * renderer versions calling the retained IPC channel get the same refusal. */
export function refuseUnsafeReset(): never {
  throw new Error(RESET_UNAVAILABLE_REASON);
}
