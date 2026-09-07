# Unsafe reset withdrawn

## Result

The legacy full-reset implementation has been removed from the IPC handler.
The retained `app:resetAll` channel now rejects with a shared explanation and
has no runtime, filesystem or configuration dependencies. It does not toggle
quit state, stop services, close databases, kill sessions, delete directories,
archive the roster, reset configuration, relaunch or exit.

Settings no longer offers the erase confirmation or clears browser state before
a reset request. Instead, General shows a Data Retention explanation and disabled
Reset unavailable control. The compatibility preload method documents rejection
rather than claiming the process will exit. This is deliberately unavailable
functionality, not an implementation of recoverable reset.

## Verified story

The verification skill guided the test from the desktop/preload invocation to
the main-process refusal and back to observable retained state. The compiled
Electron app was launched against a disposable profile containing seven real
Git/SQLite fixture runs. No AI provider ran. Before invoking reset, the harness
verified that the compiled bundle contains the refusal-only IPC registration.

`tools/smoke-reset-refusal.cjs` invoked the real preload method, observed the
expected rejection, then verified:

- Configuration and all seven run-list entries were unchanged.
- The retained run's complete snapshot was unchanged.
- Browser local storage was unchanged.
- Untracked notes in the retained worktree were byte-identical.
- Main-process run APIs remained available and no PTYs existed.
- Settings displayed the shared explanation and a disabled reset control.
- No renderer page errors occurred.

The screenshots were visually inspected at both requested sizes. The reset
explanation is readable, stays within the modal and leaves the Close control
available.

- [1440×870](assets/2026-09-05/29-reset-refusal-mac.png)
- [1920×1080](assets/2026-09-05/30-reset-refusal-1080p.png)

Two regression tests cover unconditional refusal including forged confirmation
payloads, the retained main handler wiring, absence of destructive dependencies,
and removal of the renderer reset/erase flow. All 295 root tests pass with zero
skips, including digest-pinned offline provider probes. Main/preload and renderer
typechecks, Electron build and `git diff --check` pass.

## Outstanding

A future reset needs an explicit preservation scope, recoverable retention,
verified shutdown of every writer, and successful and failed reset acceptance
tests with live processes. Home-folder migration still has its own lifecycle
and early renderer-state-clearing concerns; it was not used as a workaround or
accepted by this test. No application user data was deleted in this pass.

The global subscription launch hold remains enabled. This test proves refusal
without state loss, not concurrent live Gauntlet readiness, account admission,
provider containment or the complete owner-operator experience. No deployment,
push, merge, release or model inference occurred.
