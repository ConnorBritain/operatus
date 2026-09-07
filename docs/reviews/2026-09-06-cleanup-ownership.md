# Legacy cleanup cannot own Gauntlet work

## Findings and changes

The generic desktop teardown used forced Git worktree removal for ordinary
agents. Its separate ephemeral-worker gate retained unintegrated work, but
generic removal had no independent persisted Gauntlet ownership check. Scratch
garbage collection relied on in-memory worker tracking and a path-shape check.
Restore exclusion alone did not establish cleanup safety.

The main process now routes all three ordinary worktree-removal callers through
one ownership veto: direct teardown, ephemeral finalization, and preserved-work
GC. Scratch removal has the same veto before its existing directory-shape check.
It rejects recorded launch IDs, including legacy `pty-` IDs; locations overlapping
the managed Gauntlet root, including ancestors and symlink aliases; and worktree
locations recorded in SQLite outside the current managed root. Terminal launches
remain protected. Missing/unreadable authority or indeterminate paths retain work.

The generic Git helper no longer passes `--force`. A dirty or locked ordinary
worktree therefore fails removal instead of losing modified or untracked files.
A clean ordinary worktree can still be removed; its branch is not deleted.
Gauntlet's separate strict workspace service remains unchanged and is the only
appropriate release path for its accepted artifacts.

## Verification

Four tests in `test/gauntlet-cleanup-ownership.test.cjs` cover:

- Root/ancestor overlap, aliases, missing descendants, symlink-loop failure,
  unrelated ordinary paths, and unavailable/throwing ownership lookups.
- A real cancelled Git/SQLite run with untracked notes. Its launch identity and
  historical worktree location remain protected even when a different managed
  root is configured and the caller claims to be ordinary.
- Actual Git removal of a clean disposable worktree, retention of dirty and
  locked worktrees, and retention of the removed worktree's branch.
- Source-wiring assertions that the three main removal callers and scratch GC
  use the veto. These supplement behavioral tests, not a live-process teardown.

All 293 root tests pass with zero skips, including the opt-in digest-pinned
offline CLI probes. Main/preload and renderer typechecks, Electron build and
`git diff --check` pass. CI now includes the ownership tests and the preceding
ambient environment tests. No application user data was deleted. Only a clean
disposable test worktree was removed; its branch remains recoverable.

## Limits and next boundary

This verifies ownership decisions and real Git behavior, not every native
process shutdown interaction. Database ownership checks deliberately fail
closed after database closure, potentially leaving ordinary work for later
inspection. Generic cleanup failures are currently logged, not a complete
operator-facing recovery workflow. These path checks are not an OS confinement
boundary against a concurrent hostile same-user filesystem mutation.

Full reset remains unsafe to accept: `app:resetAll` starts control draining
without awaiting it, closes the backend, kills PTYs, deletes Hive/palace data,
and exits immediately. Its renderer clears local state before main confirms
success. Ordered draining, callback completion, recoverable retention, honest
failure behavior and native disposable-profile tests are still required. The
reset operation was inspected but not executed in this pass.

The global subscription launch hold remains enabled. No model inference,
deployment, push, merge or release occurred. Full concurrent provider runs and
owner-operator workload acceptance remain open.
