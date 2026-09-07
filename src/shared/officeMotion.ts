/** Idle movement is not evidence of work. Until the floor is driven by typed
 * run/role transitions, disable random errands, wandering and idle celebrations.
 * Directed work/blocked transitions and real message envelopes remain visible.
 */
export function ambientOfficeMotionEnabled(): boolean {
  return false;
}
