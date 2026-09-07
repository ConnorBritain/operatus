# Responsive, cancellable candidate Git

Date: 2026-09-06. Real disposable Git repositories, SQLite and Mac process confinement. No provider inference.

## Readiness gap addressed

The main-owned candidate commit adapter called Git synchronously for branch inspection, staging, commit creation, compare-and-swap and validation. Each command could block Electron's main event loop for up to 15 seconds, preventing cancellation and other runs' control work from being processed during that interval.

`commitCandidate.ts` now spawns each fixed, confined Git command asynchronously. It retains the existing executable, sandbox, environment/configuration restrictions, exact attempt ref, expected parent and clean-worktree validation. The 15-second command deadline and combined 1 MiB stdout/stderr bound remain. Output is decoded after byte capture so a chunk boundary cannot corrupt UTF-8.

The backend's per-run completion ownership now covers asynchronous commit creation as well as frozen checks. Its cancellation signal reaches the actual Git process group. Error or cancellation does not release completion ownership until the process and its stdio close; only then may preservation inspect/detach/lock that attempt. Aborted completion is checked again after asynchronous validation and before artifact acceptance. Source branches are never reset, merged or pushed.

## Executed checks

The new real-process test deliberately SIGSTOPs one exact spawned Git child at a selected command boundary. It does not substitute command output, weaken the sandbox, or require filling the disk with a large benchmark repository.

1. With one candidate paused at staging, main-loop timers continue and a second project commits and records its candidate. Cancelling only the paused run retains its dirty work and does not alter its peer or either source checkout.
2. Cancellation after the attempt ref has advanced, but before candidate validation finishes, preserves that exact new commit and records no accepted artifact. The candidate branch and content remain inspectable.
3. Closing the backend during paused Git kills the child and prevents a late SQLite artifact write; reopening is refused until the operation drains.
4. The actual 15-second deadline kills a paused child. Its pending files remain available; infrastructure-failure handling preserves the attempt and a fresh retry gets a different branch and launch identity.

The initial **49-test focused regression run passed with zero skips** across candidate commits, check cancellation, control draining, scoped helper transport, backend state, attempt branches, preservation and repair budgets. After adding the deadline case, the **four-case candidate lifecycle suite passed with zero skips**; three of those cases overlap the preceding regression run. Node/preload and renderer typechecks, Electron build and `git diff --check` passed. CI includes the new lifecycle suite; remote CI was not run in this turn.

Logs: `/tmp/operatus-async-candidate-focused.log`, `/tmp/operatus-async-candidate-deadline.log`, `/tmp/operatus-async-candidate-types.log`, `/tmp/operatus-async-candidate-build.log`.

## Limits and next steps

This establishes backend/event-loop responsiveness under a controlled slow Git process, not a full desktop interaction benchmark or large-repository performance acceptance. Metadata-path resolution, other legacy Git operations, review-packet capture and preservation still contain synchronous work. Those require separate conversion/measurement. A timed-out command can leave Git lock files or an unaccepted commit; work remains retained and is not silently reset or garbage-collected.

Native Claude transport verification remains disk-blocked below the existing copied-executable reserve. The production subscription hold was not changed. Long-lived Conductor composition, actual model judgment, Codex credit safety, full repair/re-critique, concurrent live Gauntlets, visual acceptance and the wider Munder comparison remain open.
