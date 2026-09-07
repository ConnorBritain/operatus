/** Drain optional telemetry without wedging Electron's native quit lifecycle.
 * Keep duplicate requests behind the same barrier. Even an immediate flush
 * must resume quit from a timer, not a Promise microtask inside will-quit.
 */
export function createFinalQuitBarrier(
  flush: () => Promise<void>,
  quit: () => void,
  timeoutMs = 1200
): (event: { preventDefault(): void }) => void {
  let state: 'idle' | 'waiting' | 'ready' = 'idle';
  return (event) => {
    if (state === 'ready') return;
    event.preventDefault();
    if (state === 'waiting') return;
    state = 'waiting';
    let queued = false;
    const finish = (): void => {
      if (queued) return;
      queued = true;
      clearTimeout(deadline);
      setTimeout(() => {
        state = 'ready';
        quit();
      }, 0);
    };
    const deadline = setTimeout(finish, timeoutMs);
    // Also contain a synchronous exception from an optional flush provider.
    void Promise.resolve().then(flush).then(finish, finish);
  };
}
