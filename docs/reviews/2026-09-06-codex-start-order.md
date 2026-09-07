# Codex start ordering and mixed-provider concurrency

Date: 2026-09-06. Native macOS tools, real Git/SQLite/control sockets,
**synthetic accounts and model responses**. No real inference or paid usage.

## Observed defect and fix

The mixed-provider concurrency test intermittently needed a fifth Critic where
four were expected. A fresh retry eventually completed, but that did not satisfy
the test. The original failed run remains at `op-native-concurrent-QrKqDh`.
One instrumented rerun passed; the next reproduced the failure and captured the
actual native stdout in `op-native-concurrent-J1bVdq/failed-native-diagnostics.json`.

That trace establishes the order: thread/start response, thread/started,
thread/status/changed, **turn/started notification, then turn/start response**.
The notification and response carry the same turn ID. Operatus had required the
response first, so it stopped with `invalid_result`, revoked the gateway and
recorded no turn identity. The resulting extra fresh retry was not a model error.

The [official app-server event contract](https://learn.chatgpt.com/docs/app-server)
describes these notifications and response identities, but the reviewed section
does not guarantee response-before-notification delivery. Compatibility here is
established by the captured pinned-binary trace, not an inferred ordering promise.

The runtime now buffers at most 64 early turn-scoped notifications / 256 KiB
while its turn/start request is outstanding. Foreign known thread IDs and model
rerouting still fail immediately. The response remains the source of turn
identity; synchronous durable recording must succeed before buffered messages
re-enter the existing strict validator. No provisional activity, final answer,
report or acknowledgment is accepted. Missing responses retain the launch timeout;
overflow, mismatched identities and journal failures remain failures.

A deterministic early-event regression failed before the production change and
passed afterward. It sends the entire turn before a delayed start response and
checks that activity occurs only after durable identity recording. Adversarial
cases cover a foreign turn, count/byte overflow, absent response and failed journal
write, with no accepted activity and confirmed gateway revocation.

## Verification

- 19 fresh-session, durable-identity and mixed-factory tests passed.
- 64 billing, account, gateway/transport, response, runtime-journal and scheduling
  checks passed. No skips in either focused command.
- Node and renderer typechecks, Electron build and whitespace checks passed.
  The existing mixed static/dynamic renderer-store import warning remains.
- Both mixed native concurrency scenarios passed after the fix: three projects,
  two reservations, cancellation of the first run, two surviving complete
  implementation/critique/acknowledgment/repair/re-critique loops.

| Cancellation point | Receipt directory | Native launches | Synthetic requests |
| --- | --- | --- | --- |
| Held Conductor | `op-native-concurrent-Q7wKag` | 11 | 45 |
| Dirty Implementer | `op-native-concurrent-8ZKOQT` | 12 | 48 |

Both finished `cancelled, passed, passed`, without an extra retry. Each scenario
recorded four distinct actual Codex threads and turns, eight durable identity
observations and four successful scoped reports. Original checkouts remained
unchanged; fresh worker worktrees were distinct; the cancelled dirty work survived.
Capacity drained and gateways closed. A post-test process listing found no
matching native fixture process; this is not arbitrary descendant containment.

Receipt parent:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.
The fixture retains private failure diagnostics plus Git/SQLite receipts and
discards only its own native executable copies to avoid storage accumulation.

Reproduce from the repository root:

```sh
OPERATUS_NATIVE_MIXED=1 \
OPERATUS_CLAUDE_PROBE_PATH=/Users/dahlia/.local/share/claude/versions/2.1.263 \
OPERATUS_CLAUDE_PROBE_SHA256=ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9 \
OPERATUS_CODEX_PROBE_PATH=/Applications/ChatGPT.app/Contents/Resources/codex \
OPERATUS_CODEX_PROBE_SHA256=a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629 \
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-native-concurrency.test.cjs
```

## Acceptance boundaries

The Mac was freshly checked through Computer Use and remained locked. No new GUI
acceptance or screenshot is claimed. Live independent engineering judgments,
the user's Codex no-credit-spend admission path, and owner-operator visual testing
remain required. The production launch hold is unchanged. No account settings,
release, merge, push or deployment changed. This closes the observed transport
ordering defect, not the complete local-pilot acceptance goal.
