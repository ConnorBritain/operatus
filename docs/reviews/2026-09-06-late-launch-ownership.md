# Launch ownership after asynchronous preparation

Date: 2026-09-06. Main-process lifecycle hardening. No provider/account execution and no change to the subscription launch hold.

## Finding

The production `spawnPreparedGauntlet` still delegates to legacy `spawnAgentCore`, not `ClaudeFreshSessionRuntime`. Its ownership check ran before asynchronous Hive provisioning and optional remote-service setup. Cancellation, recovery or shutdown could occur during that wait. The later synchronous `ptyManager.spawn` did not revalidate current SQLite authority.

The awaiting `advanceGauntlet` error handler also applied infrastructure failure to the run without checking whether the error belonged to its current attempt. A late error from a retired attempt could therefore fail a replacement or consume its retry budget. The global billing hold currently prevents real launches through this path; these defects must nevertheless be fixed before admitting execution.

## Changes

- Split the in-memory ownership claim into preparation and consumed-at-spawn states. `beforeSpawn` rechecks current run phase, running launch, token, options and persisted packet identity immediately before synchronous process creation. It requires an existing preparation claim and is single-use, including when process creation fails.
- Validate packet run/session/role/provider/model/expected SHA/candidate branch/worktree identity against the persisted launch. This validates the packet, not the actual provider's session or model selection.
- Recheck shutdown and billing at the final process boundary, with no intervening await. Delay PTY-to-agent mapping until these checks pass. Existing provisioning files are retained if a launch is rejected; this is not a rollback of earlier preparation side effects.
- Skip optional Codex Remote startup for Gauntlet roles. Local Gauntlet execution must not depend on an unrelated remote daemon. Ordinary-agent behavior remains unchanged.
- Ignore a late preparation/spawn failure if its launch is no longer the run's current running attempt. Do not alter the new attempt, terminal state or retry counter.

## Executed verification

**48 focused tests passed, zero failures/skips.** Suites: recovery ownership, control drain, attempt branches, repair budget, fresh Claude transport and billing policy. Node/web typechecks, Electron development build and `git diff --check` passed.

New tests extract and transpile the actual `spawnAgentCore` and `advanceGauntlet` function bodies from the main entrypoint. They use real disposable Git/SQLite authority and replace provider/provisioning/system effects with inert test boundaries. The test dependency that admits synthetic startup is not a runtime option and never reaches a real provider or credential store.

Observed:

1. During delayed provisioning, cancel, retry/replacement, closed authority, shutdown and billing hold each prevent process creation and PTY mapping.
2. A current claimed launch reaches the synthetic process boundary once; a second attempt is refused. A final claim without preparation is refused. Changed packet identities are refused.
3. Gauntlet launches do not call the optional remote setup; ordinary Codex startup still does in the synthetic function test.
4. Late spawn rejection after cancellation or replacement leaves the entire authoritative run snapshot unchanged and releases the main advancement lock.
5. Existing cross-project, restart, transport cancellation, helper draining, retry-budget and subscription-hold tests remain green.

Logs: `/tmp/operatus-late-spawn-focused.log`, `/tmp/operatus-late-spawn-types.log`, `/tmp/operatus-late-spawn-build.log`.

## Remaining integration work

This is a production-path race fix, **not production integration of the dedicated Claude transport**, independent model judgment, native cancellation acceptance or descendant quiescence. The isolated transport still needs native compatibility verification and main-owned account/profile/gateway composition. It cannot substitute for a long-lived Conductor adapter. Accepted helper receipts, direct process exit, gateway revocation and downstream advancement still need a coordinated lifecycle with durable receipts. The current delayed legacy PTY reap is not that proof.

The real native Claude-copy fixture remains resource-blocked: approximately 354 MiB was available after this pass, below the executable-size-plus-256-MiB reserve. No reserve was lowered, credential inspected, user file removed, release published, commit made or deployment changed. The goal remains active; live R1 acceptance is unproven.
