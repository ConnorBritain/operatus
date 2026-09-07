# Native multi-project queue and cancellation smoke

Follow-up: [mixed Claude/Codex concurrency and startup-order regression](2026-09-06-codex-start-order.md)
now verifies both scenarios with native Codex Critics. The original Claude-only
evidence below remains historical; neither result establishes live judgment.

## Demonstrated result

Two opt-in scenarios passed on the Mac using the actual pinned Claude executable,
private profiles, sandboxed tools, local gateway/control sockets, main-owned Git
commits and transactional Gauntlet scheduling. All account metadata and model
responses were synthetic. No real inference, credentials, billing change, desktop
interaction or production launch-hold change was involved.

| Scenario | Repositories | Native sessions | Outcomes |
| --- | --- | --- | --- |
| Cancel a held Conductor request | Three distinct repositories | 11 | cancelled, passed, passed |
| Cancel after an Implementer's actual file edit | Two runs share one repository; queued run uses another | 12 | cancelled, passed, passed |

Each scenario verifies two occupied reservations and a third FIFO waiter with no
launch preparation. Native requests are held at explicit barriers, and the actual
Conductor PIDs are checked for existence. Cancelling only the first run drains its
owned lifecycle, revokes its gateway, and starts the queued Conductor while the
second Conductor remains alive and held. Releasing the two surviving requests
allows both projects to complete implementation, fresh critique, explicit lead
acknowledgment, repair, fresh re-critique and a second acknowledgment.

The worker-cancellation scenario checks the actual modified file before cancelling,
after cancellation and after both peers finish. Its dirty worktree and main-process
preservation receipt survive; it records no accepted artifact. Shared primary
checkouts remain clean at their original commits. Each surviving candidate contains
its own run ID, not its peer's, and remains unmerged/unpushed.

All session IDs and fresh worker/Critic worktrees are unique. Every native launch
has a persisted process start, confirmed root exit and gateway revocation. Historical
admission evidence explicitly says `injected-dependencies`. Capacity never exceeds
two occupied reservations and is empty after completion. These are run slots, not
a claim that only two processes exist: each run can have a Conductor plus worker.

## Reproduction and retained evidence

```sh
OPERATUS_CLAUDE_PROBE_PATH=/Users/dahlia/.local/share/claude/versions/2.1.263 \
OPERATUS_CLAUDE_PROBE_SHA256=ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9 \
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-native-concurrency.test.cjs
```

Final executed result: **2 passed, 0 failed, 0 skipped**, approximately 18 seconds;
37 and 40 synthetic provider requests respectively. The model configured in the
native protocol was `claude-fable-5-1`; no model generated these responses.

Evidence roots under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

- `op-native-concurrent-KQFLeH`: Conductor cancellation.
- `op-native-concurrent-EWPNIi`: dirty worker cancellation and shared repository.

Each contains `receipt.json` with snapshots, runtime observations, capacity at the
barriers, request identities and transition timeline, plus Git/SQLite state.
Only the test-created native executable copies were discarded to avoid repeated
190 MB cache accumulation. Worktrees, private profile evidence and receipts remain.
A post-test process listing found no remaining matching fixture native processes.
This observation does not establish quiescence of every possible OS descendant.

An earlier worker-case assertion failed because it required distinct context paths
for Conductors sharing a repository. Inspection confirmed `prepareConductor` uses
the assigned repository as its read-only context. The assertion was corrected to
require distinct *fresh worker/Critic* worktrees and distinct session IDs for all
roles, without changing production behavior. The failed evidence is retained at
`op-native-concurrent-0SWHqp`.

## Still required

This is native transport/concurrency evidence, not a GUI smoke or autonomous
engineering acceptance. The Mac was still locked when computer-use checked it;
no app instance was launched during this turn. Expanded-Mac and 1920×1080 capacity,
floor/activity and operator-decision inspection remain open. Safe live Claude/Codex
admission, provider-led substantial work, long-running resource pressure, sleep/
wake and full process-tree recovery remain separate unfinished gates. Keep the
production subscription hold enabled.
