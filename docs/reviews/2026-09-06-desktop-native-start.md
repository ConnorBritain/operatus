# Desktop run creation reaches the isolated runner

## Finding

`gauntlet:start` still required the ordinary Hive Conductor PTY, then attempted
to deliver orientation through `deliverConductorOrientation`. A newly created
run had no run-scoped Conductor launch identity at that point, so the delivery
path could not complete. This wiring also made native startup depend on an
unrelated terminal agent. The global billing hold prevented production use of
this path, but lifting the hold would not have yielded the intended workflow.

## Changes

- The actual main IPC registration now uses `desktopRunStarter`.
- Sender web contents and main-frame identity are checked before mutation.
- The real global subscription/quit gate and native-runner readiness are checked
  before creating Git/database work. Payload shape and explicit assignments are
  validated; the backend retains domain/skill validation.
- The backend creates the run and locked skill set; main publishes it and
  immediately dispatches its exact ID to the isolated runner. The IPC response
  does not wait for the lifetime of the run.
- No ordinary Conductor, Hive mailbox, normal roster, installer or legacy PTY
  launch is invoked by desktop run creation. Removed unused legacy orientation,
  role-spawn and environment-delivery helpers. Existing ordinary-spawn ownership
  and managed-worktree protections remain intact.
- Dispatch failures are explicit infrastructure failures, not new worker retry
  authority. A late rejection cannot overwrite a terminal/cancelled run.
- Documentation now describes the private capability sidecar, correct lead
  identity arguments, held native admission and top-level Runs navigation rather
  than claiming unverified Codex/native parity.

## Evidence

36 focused tests passed across desktop creation, isolated runner concurrency,
Conductor authority, recovery/restore ownership and actual-main spawn guards.
Seven new tests check creation/lifetime separation, held/no-runtime behavior,
foreign-window/subframe rejection, invalid payloads, asynchronous failure,
terminal preservation and a hold changing before dispatch. They also evaluate
the actual extracted main IPC registration with its real hold/quit bindings.
That registration test is not a real renderer IPC invocation.

The opted-in native fixture now starts through the same handler function, using
a synthetic trusted-window event and explicitly injected no-inference services.
Both actual-Claude scripted loops passed (zero skips), with enlarged verbose
output still enabled:

- `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-KJEcBV/receipt.json`
  Run `902f5b23-bf47-436f-a302-0c08ac012b52`.
- `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-iwuqwa/receipt.json`
  Run `653038ba-9ad1-4f6d-85b4-38a63a2fe89d`, with injected final Conductor
  gateway-close reporting failure and retained operator warning.

Each used five separate CLI sessions, 39 synthetic local replies, two exact
artifacts, two lead acknowledgments and unchanged source checkout content. No
real account credential or paid inference was used. Native executable and
reproduction settings match the [output-volume fixture](2026-09-06-native-output-volume.md).

## Open acceptance gates

This fixes the creation entry point, not the whole user flow. The locked-Mac
visual inspection, real desktop click/IPC smoke, real subscription-only
Claude/Codex admission and model judgment remain unaccepted.

The capacity inspection also confirmed that `IsolatedGauntletRunner` currently
has one lifecycle owner per run but no configurable simultaneous-run ceiling or
waiting queue. Role/run timeouts and provider request/output limits do not bound
the number of concurrent native processes. Add visible capacity/queue control,
prove cancellation and slot release, and test restart behavior before lifting
the routine-use hold. No claim of safe arbitrary fanout follows from the existing
two-run isolation test.
