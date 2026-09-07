# Run-scoped Conductor identity

Date: 2026-09-06. Subscription launch hold remains enabled. No real inference or credentials used.

## Implemented

The main backend prepares a Conductor once, before bar freeze. Its UUID launch/session identities, role, provider configuration and token hash are persisted through a `CONDUCTOR_PREPARED` event and the existing launch table. `conductorLaunchId` is distinct from the current fresh worker. The preparation receipt explicitly does not claim a running native process or enforced capabilities.

The local control server no longer creates, exposes or accepts a global Conductor token. Freeze, acknowledgment, cancellation and escalation require the assigned run/launch/token. Identity validation and the synchronous command execute inside one SQLite transaction. Frozen contracts and acknowledgments retain that launch identity; Conductor stop events retain their actor. General Hive leads no longer receive a cross-run credential. Orientation and acknowledgment prompts include the required launch ID, and legacy delivery does not fall back to the general lead.

Process-local admission is required in addition to the persisted hash. Closing the backend revokes it. Reopening rejects old credentials before reconciliation; reconciliation escalates interrupted Conductor runs to `human_required` and retains active worker work. The owning launcher can explicitly release the Conductor on exit or failed admission. Duplicate preparation, cross-run use, worker impersonation and terminal commands fail closed. No restart/resume or replacement identity is silently invented.

Database protocol version is now 3, so an older binary that accepts the former global token cannot reopen the upgraded database. Existing runs/receipts are retained. Legacy unscoped runs remain inspectable and cancellable through human main-process APIs but no longer receive global agent control authority. Leftover legacy token files are not read or deleted.

## Executed evidence

- 48 focused tests passed with no failures or skips: Conductor authority (6), existing protocol (12), isolated control helper (4), preservation/migration (6), main-owned commits (4), fresh transport (11), persistent transport (5).
- A subsequent backend/prompt/authority check passed 16 tests, adding 10 distinct regressions for 58 unique focused tests overall. Final main/preload and renderer typechecks, Electron build and whitespace checks passed. Existing Vite mixed static/dynamic import warnings remain. No visual smoke was repeated in this pass.
- The pinned native Claude 2.1.263 fixture passed with one test, zero skips, in 12.1 seconds. Synthetic local provider responses drive real Claude tools, the socket, SQLite and Git. This is not live model judgment.
- Native fixture root: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-tools-2UlmXo`; receipt: `native-tool-receipt.json`.
- Run: `05d986fd-4b39-43fe-8410-2e4f4ec30d67`.
- Artifacts: `21075c96b02f6697352c5606e9900a845d4f2c49` then `64385e9b58db9b026f82318c0e300f8bb9a08990`.
- Actual Conductor session: `57506b0b-26b1-4770-b360-0ada6e49aa85`, PID during test `85899`. Three turns, six scripted requests, graceful exit, confirmed gateway closure.
- The native session matches the persisted Conductor launch. Bar freeze and both acknowledgments reference that launch. Four fresh worker sessions remain distinct. Both Critics are denied mutation/impersonation; the source checkout remains unchanged.

## Remaining gate

This closes scoped identity binding in the native fixture, not production launch composition. The isolated Conductor and worker transports still need application lifecycle integration, persisted actual-launch/admission and delivery receipts, lifecycle-owned evidence access and output, cancellation/exit coordination, and explicit recovery. Preparation is not a PID receipt. The fixture's native PID/exit evidence remains in its test receipt, not the production database.

The general Hive lead cannot substitute for the missing isolated launcher. The launch hold remains enabled. Real subscription-backed independent decisions, Codex credit-safety acceptance, simultaneous live Gauntlets, and owner-operator visual acceptance are still unfinished. No release, deployment, merge, account-setting change or launch-hold change occurred.
