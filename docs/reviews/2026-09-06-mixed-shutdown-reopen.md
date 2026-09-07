# Mixed-provider shutdown and authority reconstruction

Follow-up: [abrupt owner-process crash recovery](2026-09-06-native-owner-crash.md)
adds SIGKILL evidence for the runtime modules, without claiming full compiled-app
crash or power-loss coverage.

Date: 2026-09-06. Real pinned native CLI processes and tools; synthetic provider
responses and account metadata. No live inference, billing or GUI acceptance.

## Demonstrated

The native concurrency fixture now supports `OPERATUS_NATIVE_RESTART=1` together
with `OPERATUS_NATIVE_MIXED=1`. It starts three runs with two occupied reservations
and one FIFO waiter, then shuts down the owning runner at an actual request barrier:

- After the first Claude Implementer has written a dirty file, before committing.
- After implementation has produced an exact commit and a fresh Codex Critic has
  recorded its native thread and turn, before returning a report.

The other active Conductor is held at a real native request in both cases. The
third run has no launch. Shutdown awaits native completion and stops the control
socket before closing SQLite. A **new backend object and runner** open the same
database and reconcile the durable records, with subscription launches held.

Both active runs become `human_required`, not passed, and the third remains
`orienting` with its queued reservation. No report or acknowledgment is fabricated.
Each observed process records exit and confirmed gateway revocation. Only the
queued reservation remains after the demonstrated orderly drain. The new runner
cannot start any process through the hold, even when all three runs are advanced.

Exact launch, artifact and runtime-observation records survive reconstruction.
The dirty worker's file and preservation receipt survive; in the Critic case the
accepted implementation commit and both native identity observations survive.
Primary checkouts remain clean at their original commits. Nothing is merged,
pushed, implicitly resumed or deleted to make the test pass.

## Operator-facing fix

The first execution revealed a misleading stop reason: an orderly shutdown could
be recorded as a generic startup hold or unexpected Conductor exit. The runner now
records that Operatus shutdown interrupted the run and tells the operator to inspect
retained work before starting a new run, explicitly stating automatic resume is
unavailable. A genuine unexpected Conductor exit retains its distinct failure
message. This changes the explanation, not transition authority or recovery policy.

The native rerun requires the shutdown-specific reason on both interrupted runs.
The focused runner test also checks the inspection/restart guidance.

## Evidence

Final two-scenario result: **2 passed, 0 failed, 0 skipped**. Receipt parent:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.

| Barrier | Receipt directory | Native processes |
| --- | --- | --- |
| Dirty Claude Implementer | `op-native-concurrent-ast7un` | 3 |
| Active Codex Critic | `op-native-concurrent-meGkYS` | 4 |

`receipt.json` retains `restartEvidence.before`, `drained`, `recovered`, capacity,
the zero-launch-attempt count, snapshots and timeline. Native executable copies
alone are discarded by the test to avoid repeated cache accumulation.

The first reopen used the original backend object (`hD9Qrq`, `G6EQZD`). The fixture
was strengthened to instantiate a new authority object (`kz7KLC`, `ltcb8j`) before
the final shutdown-message rerun above. These are successive coverage improvements,
not claims of separate full-app crash acceptance.

An additional 33 recovery, attention, scheduling, socket-drain and preservation
checks passed, followed by 20 runner tests and the node typecheck. The renderer was
not changed in this work. Use the pinned executable environment from
[the concurrency reproduction](2026-09-06-codex-start-order.md), adding
`OPERATUS_NATIVE_RESTART=1`, to reproduce.

The original mixed-provider cancellation/repair loops were rerun after the shared
fixture change: two passed with 11/12 launches and 45/48 synthetic requests.
Receipts: `op-native-concurrent-21w9cJ` and `op-native-concurrent-z85Qfl` under the
same parent. A post-test process listing found no matching fixture native process;
that observation is not proof about every possible descendant.
The Electron build and whitespace check also passed; the existing renderer-store
mixed static/dynamic import warning remains. No desktop was launched for this check.

## Still open

This is orderly native-runtime shutdown and authority reconstruction inside a test
process. It does **not** simulate killing the Electron main process, power loss,
sleep/wake, missing final exit receipts or arbitrary escaped descendants. It also
does not demonstrate resuming an interrupted Conductor or automatically continuing
its old run. Those remain explicit recovery/acceptance work, not inferred from
fresh-object database reopening. Actual Mac visual acceptance and real subscription
judgments remain outstanding; the production launch hold is unchanged.
