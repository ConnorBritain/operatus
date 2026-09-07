import type { IsolatedGauntletRunner } from './isolatedRunner';

export function desktopCapacity(services: {
  localWindow(): { mainFrame: unknown } | null;
  runner(): Pick<IsolatedGauntletRunner, 'capacity' | 'configureCapacity' | 'releaseCapacity'> | null;
}) {
  const runner = (event: { sender: unknown; senderFrame: unknown }) => {
    const local = services.localWindow();
    if (!local || event.sender !== local || event.senderFrame !== local.mainFrame) throw Error('Capacity management requires the local desktop');
    const owner = services.runner(); if (!owner) throw Error('Native runtime is not ready'); return owner;
  };
  return {
    get: (event: { sender: unknown; senderFrame: unknown }) => runner(event).capacity(),
    configure: (event: { sender: unknown; senderFrame: unknown }, revision: unknown, limit: unknown) => {
      const owner = runner(event);
      if (typeof revision !== 'number' || typeof limit !== 'number') throw Error('Invalid capacity settings');
      return owner.configureCapacity(revision, limit);
    },
    release: (event: { sender: unknown; senderFrame: unknown }, runId: unknown, revision: unknown, reason: unknown) => {
      const owner = runner(event);
      if (typeof runId !== 'string' || runId.length > 100 || typeof revision !== 'number' || typeof reason !== 'string') throw Error('Invalid capacity release');
      return owner.releaseCapacity(runId, revision, reason);
    }
  };
}
