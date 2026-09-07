import type { GauntletRun, RuntimeEvent } from './gauntlet';

/** Diagnostics are orthogonal to the artifact verdict. Cancellation alone is
 * expected; an unconfirmed exit/revocation still needs operator inspection. */
export function runtimeEventNeedsAttention(event: RuntimeEvent): boolean {
  if (event.type === 'recovery_interrupted') return true;
  if (event.type === 'delivery_completed') return !event.ok;
  if (event.type !== 'process_exited') return false;
  return !event.processExited || event.gatewayRevocation !== 'confirmed' ||
    !['result', 'finished', 'cancelled'].includes(event.reason) ||
    (event.reason !== 'cancelled' && event.exitCode !== 0);
}

export function needsRuntimeReview(run: GauntletRun): boolean {
  return !!run.runtimeAttention && (!run.operatorReview?.reviewed ||
    (run.operatorReview.runtimeSequence ?? 0) < run.runtimeAttention.sequence);
}
