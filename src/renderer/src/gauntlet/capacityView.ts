import type { GauntletCapacity } from '@shared/gauntletSchedule';

/** Display the same occupied reservations the scheduler counts. This is not a
 * process-health assessment and does not grant release or launch authority. */
export function capacityView(capacity: GauntletCapacity) {
  const running = capacity.dispatches.filter(entry => entry.state === 'running').length;
  const waiting = capacity.dispatches.filter(entry => entry.state === 'queued').length;
  const quarantined = capacity.dispatches.filter(entry => entry.state === 'quarantined').length;
  const occupied = running + quarantined;
  return {
    running, waiting, quarantined, occupied,
    available: Math.max(0, capacity.maxConcurrentRuns - occupied),
    summary: `${occupied}/${capacity.maxConcurrentRuns} slots occupied · ${running} running · ${waiting} queued` +
      (quarantined ? ` · ${quarantined} need inspection` : '')
  };
}
