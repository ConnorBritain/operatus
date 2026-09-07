import type { GauntletRunSnapshot, RoleSkillAssignment, StartGauntletInput } from '../../shared/gauntlet';
import type { LocalGauntletBackend } from './localBackend';
import type { IsolatedGauntletRunner } from './isolatedRunner';

type Backend = Pick<LocalGauntletBackend, 'start' | 'status' | 'infrastructureFailure'>;
type Runner = Pick<IsolatedGauntletRunner, 'advance'>;
const terminal = (snapshot: GauntletRunSnapshot) =>
  ['passed', 'human_required', 'cancelled', 'infrastructure_failure'].includes(snapshot.run.status);

/** Desktop creation dispatches directly to the isolated, run-scoped lifecycle.
 * No ordinary Conductor PTY, shared mailbox, renderer roster or CLI installation
 * is a prerequisite. All admission gates remain main-owned and fail closed. */
export function desktopRunStarter(services: {
  localWindow(): { mainFrame: unknown } | null;
  hold(): string | null;
  backend(): Backend;
  runner(): Runner | null;
  publish(snapshot: GauntletRunSnapshot): GauntletRunSnapshot;
  onDispatchError(error: unknown): void;
}) {
  return (event: { sender: unknown; senderFrame: unknown }, payload: unknown): GauntletRunSnapshot => {
    const window = services.localWindow();
    if (!window || event.sender !== window || event.senderFrame !== window.mainFrame) throw Error('run creation requires the local desktop');
    const held = services.hold();
    if (held) throw Error(held);
    const runner = services.runner();
    if (!runner) throw Error('Isolated Gauntlet runtime is not ready');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('invalid run request');
    const input = payload as Partial<StartGauntletInput> & { assignments?: RoleSkillAssignment[] };
    if (typeof input.repository !== 'string' || typeof input.objective !== 'string') throw Error('repository and objective are required');
    if (input.baseRef !== undefined && typeof input.baseRef !== 'string') throw Error('invalid base reference');
    if (input.assignments !== undefined && !Array.isArray(input.assignments)) throw Error('invalid skill assignments');
    const backend = services.backend();
    const snapshot = backend.start({ repository: input.repository, objective: input.objective,
      baseRef: input.baseRef, providers: input.providers, limits: input.limits }, input.assignments ?? []);
    const failed = (error: unknown) => {
      // Dispatch errors are not worker retry evidence. Never mutate a cancelled
      // or otherwise terminal run because an asynchronous dispatch rejected late.
      try {
        if (!terminal(backend.status(snapshot.run.id))) services.publish(backend.infrastructureFailure(
          snapshot.run.id, 'Native Gauntlet dispatch failed; inspect local runtime readiness before retrying', false));
      } catch { /* main teardown may already have closed the database */ }
      services.onDispatchError(error);
    };
    try {
      services.publish(snapshot);
      const changedHold = services.hold();
      if (changedHold) throw Error(changedHold);
      // Return the durable run immediately. Its lifetime is main-owned, not tied
      // to an IPC promise, renderer visibility or the New run form's busy state.
      void runner.advance(snapshot.run.id).catch(failed);
    } catch (error) { failed(error); }
    return backend.status(snapshot.run.id);
  };
}
