# Fresh Codex Critic lifecycle and durable identity

Date: 2026-09-06. **Native scripted verification, not live-model acceptance.**

Follow-up: [mixed-provider composition and full scoped-report loop](2026-09-06-mixed-provider-loop.md)
now exercises the production factory behind the unchanged hold. The account and
visual acceptance limitations below still apply.

## Implemented

`CodexFreshSessionRuntime` owns one new native app-server process, thread and
turn per Critic launch. It validates the effective model, provider, working
directory, read-only thread sandbox, approval policy and service tier before
sending task input. The outer macOS sandbox remains mandatory for native tools.
There is no resume, fork, alternate provider, permission approval or API fallback.

The synchronous identity callback records the actual provider thread before
task input, then the actual turn before accepting turn evidence. Protocol errors,
foreign identities, incomplete/duplicate final output, model rerouting and
permission requests fail closed. Activity is redacted and output is bounded.
Transport completion does not submit a Critic report or acknowledge it.

SQLite schema 8 adds immutable thread/turn observations and database uniqueness
constraints across launches/runs. Reopening does not forget claimed native IDs.
New identities require an active, observed Codex Critic launch; the turn must
reference its already-recorded thread. Exact historical retries remain idempotent.
The allocated Operatus session ID remains unchanged. The runner now supplies a
durable identity callback, and session details can display the recorded provider
IDs without offering resume authority. The production mixed-provider factory is
**not yet connected**; the existing non-Claude guard and global hold remain.

The handshake, independent thread/turn identities and interrupt lifecycle follow
the [official app-server contract](https://learn.chatgpt.com/docs/app-server).
The exact pinned native binary was exercised because documentation alone cannot
establish compatibility or sandbox behavior.

## Cancellation regression found and fixed

The initial implementation sent `turn/interrupt` and immediately terminated the
root process. An actual native shell tool in a separate process group survived.
Failed receipt: `op-codex-tools-LvhDAk/receipt.json` under the parent below. The
fixture cleaned up only its own recorded sleep PID; no unrelated process scan or
termination was used.

Cancellation now revokes the gateway immediately, then gives the owned native
turn a 500 ms interruption window before forced root termination. Matching native
terminal output can close stdin but cannot turn cancellation into success.
Forced termination and gateway confirmation remain bounded. The passing fixture
verified a running native sleep tool was absent after interruption and the root
exited with code zero. This proves that tested cleanup path, not arbitrary
descendant containment; `descendantsQuiescent` remains false.

## Reproduced evidence

- 67 focused Electron tests passed, zero failures/skips: fresh sessions, fixed
  transport, gateway/response validation, account admission, private profiles,
  native output and actual sandbox denial.
- 55 journal, lifecycle, preservation/migration, attention, admission-evidence
  and scheduler checks passed after the new identity tests were added. An initial
  fixture incorrectly read an absent `run.objective` field; it was corrected to
  supply the explicit fixture objective without changing production validation.
- Three assembled native session cases passed: WebSocket, HTTP fallback and
  cancellation. Six other native scenarios were intentionally excluded by the
  `gateway-session` name filter, not claimed as rerun acceptance.
- Each native case persisted actual IDs through `GauntletStore`, reopened its
  database and verified exact identity correspondence. The synthetic preceding
  protocol remains `critic_in_flight` with no report or acknowledgment after
  transport completion. Read-only cases read both artifact and review-bar files;
  artifact writes and unrelated secret reads were OS-denied.
- Node and renderer typechecks, Electron build and `git diff --check` passed.
  The build retains its mixed static/dynamic import warning; a successful build
  is not a launched-app smoke. The new no-inference checks are included
  in CI configuration; a hosted CI execution is not claimed.

Receipt parent: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.

| Case | Directory | Actual native thread |
| --- | --- | --- |
| WebSocket + journal | `op-codex-tools-9kJzyv` | `01a07885-8635-77c1-b910-d691d26250fa` |
| HTTP + journal | `op-codex-tools-AdPhUC` | `01a07885-97d0-7ec0-bf82-81a93469843a` |
| Cancellation + journal | `op-codex-tools-GmtTMG` | `01a07885-a913-7221-b0ed-fdc1e34b02f8` |

Each contains `receipt.json`, `native-identity.jsonl` and `native-journal.db`.
Cancellation also has `cancellation-verification.json`. Fixture-owned executable
copies are removed during test cleanup; diagnostic evidence is retained.

Pinned Codex 0.153.4 SHA-256:
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.
Companion SHA-256:
`fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b`.

## Remaining acceptance gates

Compose the pinned binary/companion, Codex account evidence, immutable skills,
scoped report helper, gateway and fresh runtime in the held production factory.
Exercise a complete mixed Claude/Codex loop with report submission and explicit
lead acknowledgment. Resolve subscription-only admission independently of these
scripted tests, then obtain live-model and actual visual/operator acceptance.
No real credential or inference was used here. Fixed TLS options were asserted
before redirecting the test's lowest-level network request to a local synthetic
provider; this is not public TLS/service or billing acceptance. No app GUI was
inspected in this slice, and the new identity disclosure is not visually accepted.
