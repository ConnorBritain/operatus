# Isolated loop composition

Date: 2026-09-06. Production release hold remains enabled. No real inference or account credentials used in this pass.

## Implemented in the application

`IsolatedGauntletRunner` now owns Gauntlet advancement from Electron main. Each run has one claimed lifecycle, persistent Conductor and at most one fresh worker. Separate runs await their processes concurrently. Duplicate callbacks join the same owner. The driver waits for a worker's process completion and gateway closure before advancing to the next phase, while SQLite socket receipts remain the authority for artifacts and decisions. A turn without a freeze/acknowledgment is not success. Worker transport failures use the existing bounded retry accounting; losing the Conductor escalates and stops its worker.

Human/remote cancellation, watchdog retirement and application close reach this owner. Admission checks are repeated after asynchronous preparation and immediately before native spawn. Main no longer calls the legacy Gauntlet PTY advancement loop. The generic PTY reaper excludes owned isolated runs and persistent Conductors. Shutdown drains the isolated runner before closing its database. Generic PTY restore fencing remains in place for historical launches.

The Claude factory composes private role profiles, a digest-verified native copy, a scoped helper, main-owned account admission, per-launch gateways and the existing fresh/persistent native transports. It grants the Conductor read-only access to its own run's future review packets, not the parent containing other runs. Agent profiles contain only the revocable local gateway token, never the real OAuth secret, API keys or refresh tokens. Every gateway request still requires an active Max account with extra usage disabled. The factory is lazy and the application checks the unchanged global hold before preparing anything.

The pilot accepts only the inspected macOS Claude 2.1.263 binary hash and Fable 5.1 model. It does not substitute Claude for the default Codex Critic. Until isolated skill materialization is integrated, runs with locked skill assignments stop explicitly rather than silently dropping their guidance. These restrictions are unfinished gates, not the final supported product scope.

## Executed verification

- 31 lifecycle/recovery/control-drain/quit checks passed, zero skips, including two concurrently conducted scripted repair loops, cancellation during admission, lost lead ownership, bounded missing-receipt retries, watchdog retirement, non-convergence and app shutdown.
- Eight subscription-only billing regressions passed, zero skips. Main/preload and renderer typechecks and the Electron build passed. Existing Vite mixed static/dynamic import warnings remain.
- The old advancement test initially failed because it injected the removed PTY loop. It now verifies the actual entrypoint delegates lifecycle ownership without interpreting a late failure as another retry or calling the legacy launcher. Cancellation, retry and loss-of-owner behavior is tested directly against the new runner.
- `test/gauntlet-native-runner.test.cjs` ran the assembled factory and runner using real native Claude processes, real private profiles/Seatbelt boundaries, real local gateways/helper/socket, SQLite and Git. Only account metadata and provider responses were synthetic. One test passed with zero skips in 11.8 seconds.
- Native run: `846f5c6c-4e59-420b-b1f9-74d924e4b43e`; retained root `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-xMtK0s`, receipt `receipt.json`.
- One Conductor, Implementer, Critic, Repairer, fresh Critic; 24 scripted provider requests; two exact artifacts and explicit acknowledgments. Both own-run review manifests were readable by the persistent Conductor; peer-run reads were denied. The source checkout and main branch were unchanged. Native session identity is checked by the transport's result parser. Test executable copies are disposable; Git/SQLite/packet/receipt evidence is retained.

CI includes the offline lifecycle tests. The native fixture remains opt-in with a pinned executable and synthetic provider/account dependencies; it cannot silently consume a subscription.

## Still not accepted

This is basic application lifecycle wiring and assembled-native transport evidence, not a successful live-model run in the visual app. Actual PID/admission/exit and delivery receipts still need durable storage and inspection; streaming output and lifecycle-owned sprite/agent presentation are not connected to the non-PTY sessions yet. Completion of a protocol run is not a claim of descendant quiescence, and post-decision process failures need durable diagnostics.

The factory currently has conservative native duration caps; all configurable run limits, capacity admission/storage-pressure handling, isolated skill assignments and recovery/resume need composed-path acceptance. Codex subscription-credit safety remains unaccepted and its default role is preserved. Real independent judgments, full live multi-run behavior, visual owner-operator acceptance and routine startup remain held. No deployment, release, merge, launch-hold change or account-setting change occurred.
