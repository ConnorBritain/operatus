# Native root exit and inherited-pipe drain

## Reproduced defect

Both dedicated Claude transports waited for the child-process `close` event to
terminate the remaining process group and revoke the local gateway. A tool child
can retain stdout/stderr after the CLI root has exited, delaying that event.

Two regression cases used the real macOS Seatbelt policy and OS processes, with
a small synthetic protocol-speaking root instead of Claude. Its child inherited
the root's process group and output descriptors, ignored SIGTERM, and appended
to an allowed test file every 25 ms. A five-second self-exit bounded the fixture
even if cleanup failed. No model, credential or external service was involved.

Before the fix:

- A fresh worker's valid result waited approximately **5.18 seconds**, until the
  child exited itself. The prompt-drain regression failed.
- A Conductor that completed its turn and exited cleanly was reported as
  **timeout**, after approximately **4.25 seconds**, because the retained pipe
  outlived its finish deadline. The correct-finish regression failed.

## Change

On the observed root `exit`, each transport now immediately revokes its owned
gateway and sends SIGKILL to its detached POSIX process group. It clears the old
role/turn deadline and bounds remaining output drain separately to 1.75 seconds.
Buffered result parsing remains intact; exit is not itself a valid result or
Gauntlet completion receipt. Late exit events after settlement do not restart
timers or issue new group signals.

Cancellation still revokes immediately, sends SIGTERM, escalates if necessary and
returns a bounded, truthful result. The new cancellation fixtures wait until an
actual SIGTERM-ignoring tool child is running before stopping the session.

## Verification

Four new real-process regressions cover worker/Conductor normal finish and
cancellation. The final normal-drain cases completed in approximately 0.33–0.37
seconds, including a 150 ms check that child writes did not continue after
completion. Their gateway revocation and root-exit observations are confirmed.

**49 focused tests passed, zero skipped:**

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/claude-fresh-session.test.cjs test/claude-conductor-session.test.cjs \
  test/gauntlet-isolated-runner.test.cjs test/final-quit.test.cjs
```

Node/web typechecks and the Electron build passed. Existing bundle warnings
remain. The regression helper is `test/fixtures/native-process-tree.cjs`; both
transport test files are already included in the existing focused CI lanes.

The pinned actual Claude 2.1.263 executable also passed **5 scripted scenarios,
zero skipped** after the fix: both cross-project concurrency/cancellation cases,
the normal skill/repair loop, injected gateway-close reporting failure, and an
admission-journal rejection with zero model requests. The latter two retain their
expected quarantine/escalation, not an artificial all-green artifact outcome.
All account and provider responses were synthetic. Large-output stress remained
enabled for the assembled single-run cases.

Retained roots under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

- `op-native-concurrent-5vr9xM`: Conductor cancellation, two peer repair loops.
- `op-native-concurrent-4YjJ3E`: dirty worker cancellation with shared repository.
- `op-native-runner-IB8hmR`: normal scripted loop.
- `op-native-runner-XbLmSL`: injected gateway-close reporting failure.
- `op-native-runner-rCl6KA`: admission-journal rejection before native startup.

Each native fixture retains its receipt and Git/SQLite evidence. Only its own
copied executable cache was removed by the test's bounded cleanup.

## Limits

This closes the reproduced **same-process-group** pipe-holder defect. It is not
proof that every possible descendant, reparented process or process-group escape
has been contained. `descendantsQuiescent` remains explicitly false. It does not
authorize worktree deletion, establish all-process resource limits, clear safe
live Claude/Codex admission, or substitute for actual GUI/operator acceptance.
The production subscription launch hold remains unchanged.
