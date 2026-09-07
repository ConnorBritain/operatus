# Control-command draining and native shutdown

## Demonstrated change

Normal Mac quit and confirmed quit now share main-process runtime teardown.
The local Gauntlet control server stops accepting commands, aborts in-flight
frozen checks, closes partial/idle clients, and drains outstanding callbacks
before the main process closes its Gauntlet database.

This fixes two concrete defects found in the source:

1. A second data chunk could dispatch the same command again while its first
   asynchronous completion was still pending. Each socket now claims its one
   command before dispatch, independently of response completion.
2. Explicit teardown started socket shutdown without awaiting it, then closed
   SQLite. Normal zero-PTY quit did not run that service teardown at all.
   Both approved routes now converge on the native final-quit barrier.

The control-server abort signal is passed as a main-process argument, never
accepted from command JSON. Frozen checks terminate their owned process group
on abort and reject before artifact validation/recording resumes. Shutdown
does not manufacture a failed check receipt, pass, or artifact. Interrupted
launch state remains available for existing restart reconciliation.

Idle or half-written requests have a ten-second inactivity timeout. A claimed
command uses its frozen check timeout instead. Server stop is single-flight
and has a three-second drain deadline; a non-cooperative operation produces
`drained: false`, not a success receipt. In that case, quit leaves the Gauntlet
database open until process exit instead of closing underneath callbacks.
Final runtime teardown plus optional analytics is bounded by five seconds
plus event-loop scheduling. These bounds cannot preempt synchronous JS or
native calls that block the event loop.

No new launch may enter `spawnAgentCore` or `advanceGauntlet` once quit has
been accepted. This supplements, and does not replace or relax, the existing
subscription launch hold.

## Verification

Five new tests in `test/gauntlet-control-drain.test.cjs` exercise actual local
sockets for single-command dispatch, idle/partial-client closure, duplicate
stop calls, rejected restart/new connections, abort propagation, and an
explicit undrained deadline with late completion.

The fifth test uses a real temporary Git repository, candidate worktree,
SQLite backend, control socket, and running offline sandboxed Node check.
It waits for the check's PID marker before stopping the server. It verifies:

- The check process no longer exists after drain.
- No artifact is recorded, and the interrupted launch remains in flight.
- The worktree is retained.
- Reopening SQLite and reconciling restart marks the old launch failed and
  returns the run to `awaiting_implementation`, without an artifact.

This is a real check-process integration test, not a Claude/Codex worker run.
The temporary fixture is retained for diagnosis.

`node tools/smoke-desktop-quit.cjs`, run against the compiled Electron build
without an inspector, passed four native desktop cases. Both configured
cases connect a client and send an unfinished JSON request before quit;
the client closes before the final native quit and process exit 0.

Receipts under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

| Directory | Profile | Route | Exit |
| --- | --- | --- | --- |
| `operatus-quit-smoke-kUmsDi` | Onboarding | Native quit | 0 |
| `operatus-quit-smoke-vLeQXu` | Onboarding | Confirm-close IPC | 0 |
| `operatus-quit-smoke-cMiFsS` | Configured with partial client | Native quit | 0 |
| `operatus-quit-smoke-8swHBl` | Configured with partial client | Confirm-close IPC | 0 |

All 263 root tests passed with zero skips, including explicitly pinned offline
CLI probes. Main/preload and renderer typechecks, the Electron build, and
`git diff --check` passed. No live model, paid inference, signing, installer,
deployment, merge, or push was invoked.

## Remaining acceptance

Follow-up: [per-run check cancellation](2026-09-06-check-cancellation.md)
adds ordinary run interruption and backend-owned cancellation for direct
callers. It also records a newly verified committed-before-recorded retry gap.

This does not prove shutdown of active provider PTYs or descendants that
escape their process group, graceful provider checkpointing, or cancellation
of checks by ordinary run cancellation. Abort wiring here is specifically
control-server shutdown. Direct backend callers must supply an abort signal
if they need this cancellation behavior.

The separate destructive reset path still needs an ordered-drain review.
Other services' in-flight asynchronous callbacks and overall process-tree
cleanup need explicit tests. Full live Gauntlet and concurrent-project
acceptance remain gated on enforceable subscription-only admission and
provider-session containment.
