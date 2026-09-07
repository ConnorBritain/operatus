# Abrupt native owner-process crash recovery

Date: 2026-09-06. **Actual SIGKILL and native Claude/Codex processes; synthetic
accounts and model responses. Not live judgment or a desktop GUI smoke.**

## Method

`test/gauntlet-native-crash.test.cjs` starts the existing mixed-provider fixture in
a separate Electron-as-Node process. That child owns real SQLite, the scheduler,
private profiles, gateways, control socket and native provider processes. It sends
an authenticated-by-test-nonce IPC barrier only after recording a snapshot with
two running reservations and one queued run. The parent observes three live native
PIDs with no exit receipt, then sends SIGKILL to the exact child it spawned.

Two barriers are exercised: after an Implementer edits a dirty file, and after a
fresh Codex Critic records its native thread/turn for an exact implementation
artifact. The peer Conductor is also in flight. No test code writes a fake missing
exit observation or executes the child owner's graceful shutdown path.

The parent awaits the actual SIGKILL exit and opens the database in a new backend.
Before reconciliation, its serialized snapshot equals the child's pre-crash
snapshot: no exit, report, acknowledgment or transition was invented by shutdown.

## Result

Both cases pass. Reconstructed scheduling is `quarantined, quarantined, queued`.
Reconciliation makes both interrupted runs `human_required`; the untouched queued
run stays `orienting`. Each unclosed native launch gets exactly one
`recovery_interrupted` observation, not a fabricated `process_exited` receipt.
Both interrupted runs classify as needing operator attention.

To distinguish quarantine from the separate subscription hold, the reconstruction
fixture permits scheduling but supplies factories that fail and count any attempt.
Advancing all runs makes zero preparation attempts; quarantine alone prevents the
queued run from launching. The actual product subscription hold is never changed.

The dirty work/preservation receipt survive. The Critic case retains its accepted
implementation commit and exact native thread/turn history but no Critic report.
Original checkouts remain clean at their original commits. A second reconciliation
is idempotent. Nothing is merged, pushed or automatically resumed.

## Evidence and reproduction

Final result: **2 native scenarios passed, zero failed/skipped**, about 15 seconds.
Another 31 identity, ownership/recovery, preservation, operator-attention and
scheduling checks passed. JavaScript syntax and whitespace checks passed. No
production source changed during this crash-test addition; no new build or GUI
acceptance is inferred from these tests.

Receipt parent:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.

| Crash barrier | Directory |
| --- | --- |
| Dirty Implementer | `op-native-concurrent-KfDOxg` |
| Active Codex Critic | `op-native-concurrent-zxRwB2` |

Each retains `before-crash.json`, `crash-recovery.json` and private
`crash-cleanup.json`, plus Git/SQLite/profile evidence. Cleanup inspects only native
PIDs recorded by that owned fixture, revalidates its unique private root in argv
or cwd before signalling, and records already-exited versus test-terminated groups.
It does not write its cleanup result back as product runtime authority. A failed
ownership check preserves the binaries and fails the fixture rather than guessing.
Only copied native executables are removed; diagnostic work remains.

Use the pinned executable variables from the
[mixed concurrency reproduction](2026-09-06-codex-start-order.md), then run:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-native-crash.test.cjs
```

The first attempt (`kom0od`, `pUE1fU`) failed a comparison because JSON omits optional
undefined fields. The assertion now compares equivalent serialized snapshots,
without dropping any persisted field or lifecycle event. Those failure roots and
cleanup receipts remain. Two PIDs whose titles could not initially confirm their
private root had already exited on the subsequent targeted check; no unrelated
process was signalled. Later coverage adds cwd verification for rewritten titles.

## Remaining boundaries

This is a killed process owning the production runtime modules, not the full
compiled Electron main entrypoint with renderer, Hive and other services. Power
loss, sleep/wake, every protocol phase, and active shell-tool descendant escapes
are not covered. The deliberate crash occurs at held provider-request boundaries,
not during a native shell command or an SQLite/Git commit. Product-wide containment,
orphan recovery before launch recording, and the user-facing recovery workflow
remain separate work. Current visual and real-account no-spend acceptance gates
remain open; no release or readiness claim follows from this result alone.
