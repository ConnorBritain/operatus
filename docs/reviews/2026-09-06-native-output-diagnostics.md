# Persisted output diagnostics and next inspection

## Gap and implemented behavior

Native transports already bounded output and returned measured byte counts plus
preview-truncation flags. The assembled runner discarded those measurements when
writing its exit observation. After restart, the operator could see only a generic
exit reason, with no distinction between missing and measured output information.

The main runner now attaches those five measurements to its immutable, exact-session
exit record. SQLite accepts only non-negative safe-integer counters, consistent
totals, boolean truncation flags and the explicit field allowlist. Nested raw output
or credential fields are rejected. This does not add unbounded logs or new agent/
renderer write authority. Existing records without measurements remain unchanged.
Schema version 7 records the new journal shape; older binaries fail closed, and the
future-schema test now rejects version 8 without downgrading it.

The Runs role-session view adds **Output diagnostics**, with missing measurements
explicitly unavailable rather than zero. It explains that truncated in-memory
previews are not themselves a session failure and that raw preview text is not
retained. Known failures expose a **Next inspection** suggestion. Unknown shutdown
is prioritized; provider errors do not invent an authentication or quota diagnosis.
These are suggestions, not automatic retry, PID reuse, capacity release or altered
artifact judgments.

## Verification

**47 focused tests passed, zero skipped**, covering the runtime journal, operator
attention, preservation/migration, isolated runner and scheduler:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-runtime-journal.test.cjs test/gauntlet-runtime-attention.test.cjs \
  test/gauntlet-preservation.test.cjs test/gauntlet-isolated-runner.test.cjs \
  test/gauntlet-schedule.test.cjs
```

New coverage verifies exact counters after reopen, immutable duplicate handling,
invalid/nested-secret payload rejection before any write, unchanged protocol
events/artifacts, missing older observations, successful truncated previews not
becoming attention failures, and non-speculative guidance. Node/web typechecks,
Electron build and whitespace validation passed; existing bundle warnings remain.

The actual-native assembled fixture now compares every recorded measurement to
the corresponding transport completion's measurements for all five sessions.
It also verifies the persisted object has exactly the five permitted keys.

**Three actual-native scripted scenarios passed, zero skipped**, with large-output
stress enabled: normal repair/re-critique, injected gateway-close reporting failure,
and admission-write rejection before startup. The normal and failed-revocation
cases each recorded five sessions and 39 synthetic provider requests. Each fresh
worker exceeded the former 1 MiB aggregate output cap; the new persisted counters
matched measured transport output exactly. All account/provider responses remained
synthetic; no real inference or credentials were used.

Retained roots under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

- `op-native-runner-OjOkmr`: normal loop, run `a02b0779-26c6-4f8b-a4e2-ede1574568c3`.
- `op-native-runner-Ad7Ee9`: injected failed revocation, run `3e4c5a4f-6709-4b37-9566-d60412bdc64e`.
- `op-native-runner-5CHiP7`: admission-write failure, run `f90927a7-0fea-49d6-be12-67a7371cd287`.

## Acceptance limits

Computer-use again reported the Mac locked. No GUI was launched or screenshots
captured, so the rendered placement/readability remains unaccepted at both target
viewports. Detailed raw-provider diagnostic inspection, real-provider judgment,
safe Claude/Codex admission and complete operator task acceptance remain open.
Neither these counters nor the explanatory text lifts the production launch hold.
