type FloorTicker = { start(): void; stop(): void };
type VisibilityDocument = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

/** Only controls scene rendering. Subscriptions, agent execution and run authority
 * remain alive while hidden. Attach after async scene initialization completes. */
export function floorVisibility(document: VisibilityDocument, covered: () => boolean) {
  let ticker: FloorTicker | null = null;
  let disposed = false;
  const refresh = () => {
    if (disposed || !ticker) return;
    if (document.hidden || covered()) ticker.stop();
    else ticker.start();
  };
  document.addEventListener('visibilitychange', refresh);
  return {
    refresh,
    attach(next: FloorTicker) {
      // A late init must never revive a disposed/replaced scene.
      if (disposed) { next.stop(); return; }
      if (ticker !== next) ticker?.stop();
      ticker = next;
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', refresh);
      ticker?.stop();
      ticker = null;
    }
  };
}
