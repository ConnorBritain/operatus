import type { AgentLaunch, GauntletRun } from '../../shared/gauntlet';

export interface NativeSessionBudget { timeoutMs: number; turnTimeoutMs: number }

/** Recomputed immediately before spawn, after asynchronous preparation.
 * Admission/configuration time consumes the existing run/launch budget. */
export function nativeSessionBudget(run: GauntletRun, launch: AgentLaunch, now = Date.now()): NativeSessionBudget {
  if (launch.runId !== run.id || !Number.isSafeInteger(now) || now < run.createdAt || now < launch.createdAt) {
    throw Error('Native session budget identity or clock is invalid');
  }
  const limits = run.limits;
  for (const value of [run.createdAt, launch.createdAt, limits.runTimeoutMs, limits.workerTimeoutMs, limits.criticTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid native session budget');
  }
  if (limits.runTimeoutMs > 7 * 86400000 || limits.workerTimeoutMs > 86400000 || limits.criticTimeoutMs > 86400000) throw Error('Native session budget exceeds supported limits');
  const remainingRun = limits.runTimeoutMs - (now - run.createdAt);
  const roleLimit = launch.role === 'critic' ? limits.criticTimeoutMs : limits.workerTimeoutMs;
  const timeoutMs = launch.role === 'conductor' ? remainingRun : Math.min(remainingRun, roleLimit - (now - launch.createdAt));
  const turnTimeoutMs = Math.min(timeoutMs, roleLimit);
  // Do not round up tiny/expired budgets and accidentally grant extra time.
  if (timeoutMs < 10 || turnTimeoutMs < 10) throw Error('Native session budget exhausted before spawn');
  return { timeoutMs, turnTimeoutMs };
}
