# Native Gauntlet capacity and durable waiting

## Result and boundary

The native runner previously dispatched every requested run immediately. It now
reserves at most two concurrent native Gauntlets by default, with a persisted
one-to-eight setting and FIFO waiting. The compiled Runs view exposes active,
waiting and quarantined reservations, inspection navigation, capacity adjustment
and explicit human scheduling release. This is implemented, not yet visually
accepted: the Mac was locked when computer-use attempted inspection.

This is a local native-run limit, not a CPU/RAM guarantee, an ordinary-agent cap,
a Branch/Project allocation model, or a cross-machine subscription quota. Live
provider admission and real multi-project acceptance remain open. The production
subscription hold was not changed; no account credentials or real inference were
used for this work.

## Authority and recovery

- Schema v5, same main-process connection as protocol records. Older v4 binaries
  reject the upgraded database. Scheduling has its own append-only event journal,
  so changing capacity cannot impersonate a bar, acknowledgment or verdict.
- One durable run reservation and one in-process owner promise. Waiting prepares
  no provider identity/profile/worktree. FIFO survives shutdown and cancellation.
- A reduced limit does not preempt existing work. Queue time counts against the
  original overall run budget; admission and hold are checked again before spawn.
- Settling requires owned lifecycle drain plus persisted root-exit and gateway
  confirmation. It does not claim all OS descendants have stopped.
- Restart quarantines old running reservations. Upgrade conservatively quarantines
  legacy launches without confirmed exit/revocation, including terminal artifacts.
- Unknown native preparation or shutdown cannot start a fresh overlapping retry.
- Human release requires the exact scheduling revision, terminal run and a bounded
  inspection note. It records a scheduling decision without erasing native warnings
  or changing artifacts. Local-window/main-frame checks protect all capacity IPC.
- Capacity changes and queue snapshots contain no scheduler owner token.

## Verification

49 focused tests passed, zero skipped:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-schedule.test.cjs test/gauntlet-isolated-runner.test.cjs \
  test/gauntlet-preservation.test.cjs test/gauntlet-desktop-start.test.cjs \
  test/gauntlet-recovery-ownership.test.cjs
```

Coverage includes three full scripted repair loops with only two admitted at once,
duplicate ownership, waiting cancellation, lost exit writes, outstanding artifact
operations retaining capacity, close/new-owner continuation of an
unprepared run, held/expired queue, quarantine, exact-revision release, v4 migration,
future-schema rejection, protocol preservation and foreign/subframe IPC rejection.
Node/web typechecks, Electron build and whitespace validation passed. Existing
bundle-size/dynamic-import warnings remain, not new runtime failures.

The pinned actual Claude executable also completed two five-session loops using
synthetic account/provider responses (39 replies each, no real inference), with
large-output stress enabled. Direct read-only SQLite inspection confirmed:

| Fixture | Run | Reservation |
| --- | --- | --- |
| `op-native-runner-VlKLIt` | `ef0379e0-2225-44a2-9dd6-d08b40036e4d` | settled |
| `op-native-runner-mcJnxw` | `893f5692-248d-4574-9189-54d28425c6b9` | quarantined after injected final gateway-close reporting failure |

These roots are retained under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.
The native test now also asserts and records capacity in its receipt. A subsequent
two-test run passed with those assertions at `op-native-runner-Gg147o` (normal)
and `op-native-runner-QY5Tij` (injected failure).

## UI evidence and next acceptance

The subsequent [native concurrency smoke](2026-09-06-native-concurrency.md) now
verifies three queued runs with two actual native lifecycles at once, cancellation
before work and after a real worker edit, and independent repair loops across
distinct and shared repositories. It uses synthetic provider responses and does
not close the live-provider or visual acceptance gates below.

`tools/smoke-run-control-fixture.cjs --capacity` generated disposable Git/SQLite
state at `operatus-run-control-ljLgA6` under the same temporary root. The compiled
app booted that profile and opened its local broker. Computer-use reported:
“The Mac is locked and automatic unlock could not unlock it.” No screenshot,
rendered layout, interaction success, or normal Cmd-Q acceptance is claimed.
Only the explicitly identified fixture Electron process was stopped via SIGTERM.
Its profile/evidence remains; no user profile was modified.

Use an unlocked Mac to inspect the Capacity disclosure, change its setting,
inspect/cancel a waiting fixture, navigate a quarantined run and test explicit
release without rewriting its warning. Check expanded Mac and 1920×1080 layouts.
Then, only after subscription admission is proven, exercise actual provider-led
concurrent projects and measure responsiveness/resource pressure.

React review used one scoped subscription, cleanup on unmount, functional revision
guards against stale async snapshots, bounded inspection notes and visible errors.
Those design checks are not a substitute for the outstanding visual acceptance.
