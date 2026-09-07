# Per-run frozen-check cancellation

## Result

Cancellation, escalation, and infrastructure failure now interrupt that run's
active frozen checks. The backend owns one completion execution per run,
rejects simultaneous duplicate receipts even on separate connections, and
waits for check closure before preserving the interrupted worktree.

Other projects' checks are not cancelled. A real two-project integration test
demonstrates that the peer can finish and record its exact Git artifact while
the cancelled run records none.

## Changes and authority

`LocalGauntletBackend` tracks in-flight completion controllers in memory. This
is execution ownership, not run authority: SQLite transitions and exact Git
identities remain authoritative. Completion authenticates before claiming
execution; an invalid token cannot claim or abort another worker's checks.

The existing control-server shutdown signal is forwarded to the owned
controller. Ordinary run interruption also aborts that controller. Closing
the backend aborts direct completions, too, and prevents reopening the same
backend instance before they drain.

Preservation uses the captured old launch snapshot, never a later launch's
worktree. It occurs after the check process closes, before execution ownership
is available to a retry. The main-process advance loop waits while completion
is draining, and worker preparation independently rejects premature retries.
Interrupted completion rejects before artifact validation or a SQLite write.

The cancellation transition is immediate; process closure and worktree
preservation follow asynchronously. It does not mean a provider session has
checkpointed. Preservation failures are logged and the worktree is retained;
there is not yet a separate durable preservation-completion receipt.

## Executed evidence

`test/gauntlet-check-cancellation.test.cjs` uses real temporary Git repositories,
candidate commits/worktrees, SQLite, and offline sandboxed Node processes:

1. Start ledger and website checks together and wait for both PID markers.
   Reject a duplicate completion and an invalid token. Cancel ledger, verify
   its PID disappears, and confirm its detached/locked worktree remains with
   zero artifacts. Verify the website PID is still running; release it and
   confirm an exit-0 check receipt and the exact candidate SHA in its artifact.
2. Escalate during a running check: terminate it, retain the worktree, and
   preserve `human_required` without recording an artifact.
3. Apply a retryable infrastructure failure during a check: refuse retry
   preparation while it drains, terminate it, and retain the old worktree.
4. Close the backend during direct completion: reject reopening while it
   drains, then reopen and confirm no artifact was written after closure.

Fixtures are retained. No AI worker or paid inference is used in these tests.
They prove check-process and protocol behavior, not subscription-provider
concurrency or a complete Gauntlet pass/repair cycle.

Final verification: all 267 root tests pass with zero skips, including the
explicitly pinned offline provider probes. Main/preload and renderer
typechecks, the Electron build, and `git diff --check` pass. The four-case
native desktop quit smoke also passes again against the rebuilt app, including
unfinished control connections in both configured-profile quit routes.

## Newly verified recovery gap

Follow-up: [attempt-branch recovery](2026-09-06-attempt-branches.md) resolves
the branch mismatch below with new per-launch branches. It also identifies
separate repair-budget and durable preservation-receipt work still required.

The interruption tests expose a distinct failure after a worker has committed
but before its artifact is recorded. The run still expects its original base
(or prior accepted artifact), while the candidate branch points to the new,
unrecorded commit. After draining, retry preparation correctly fails with
`candidate branch moved`. The test explicitly verifies this refusal.

Automatic recovery of that case remains incomplete. Do not bypass the
expected-SHA check or discard the preserved commit to make a retry appear to
work. A subsequent change must give abandoned candidate commits durable
provenance and define safe retry-branch ownership, including external ref
movement. This is a release-readiness gap, not a passing recovery claim.

Other outstanding gates include real provider process-tree containment,
graceful checkpointing, a durable cleanup receipt, and enforceable
subscription-only launch admission. The global launch hold remains active.
