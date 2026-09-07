# Mac native quit regression

## Result

Fixed a reproducible empty-app quit hang. The compiled Electron application
now exits with status 0 through both `app.quit()` and the actual
`window.cth.confirmClose()` IPC path, with no inspector, CDP, or Playwright.
Four disposable-profile checks passed: onboarding and configured-empty
profiles, each through both quit paths. This is not active-worker shutdown
acceptance or a live Gauntlet smoke.

## Cause and evidence

The inherited `will-quit` handler prevented the native quit, then resumed it
from a Promise callback after flushing analytics. Disabled analytics resolves
immediately. On this Mac, that callback re-entered `app.quit()` before the
cancelled native event had unwound. Electron ignored that reentrant request.

The unmodified build was reproduced twice without a debugger. Instrumentation
recorded zero PTYs, a first quit call, `before-quit`, a prevented `will-quit`,
and a second quit call in the same millisecond as `will-quit`. No subsequent
native quit events or process exit occurred. A six-second timer still ran
with zero windows. The two confirmed-hung fixture processes (56646 and 84078)
were terminated explicitly; their disposable profiles were retained. No user
application process was targeted.

A timer-deferred continuation produced the second native `before-quit` and
unprevented `will-quit`, followed by exit status 0. This matches Electron's
documented cancellable quit sequence, but the specific microtask reentrancy
failure is a local observation, not a general guarantee about all Electron
versions. [Electron app lifecycle documentation](https://www.electronjs.org/docs/latest/api/app).

## Change

`src/main/finalQuit.ts` isolates a bounded, single-flight final-flush barrier:

- Immediate, rejected, and synchronously throwing flushes defer continuation
  to a new timer turn.
- Stalled telemetry cannot delay the continuation beyond the 1.2-second
  deadline plus event-loop scheduling.
- Duplicate quit requests remain prevented while the barrier is waiting.
- Late flush completion cannot trigger another quit; timers are cleared.
- The final native quit passes through without preventing its event.

Main-process wiring uses the helper only for the optional analytics flush.
It does not enable analytics, bypass active-agent confirmation, alter run
authority, or lift the subscription launch hold.

## Reproduction

After `npm run build`, run:

```sh
node tools/smoke-desktop-quit.cjs
```

The runner requires the production launch hold, creates private temporary
profiles, and retains JSON event receipts and stdout/stderr per fixture.
The fixture disables protocol registration so it cannot replace the user's
`operatus://` application association. Its only renderer interactions are
reading the PTY list and, for confirmed quit, invoking the real quit IPC.
The runner fails if quit takes 20 seconds and terminates only its own child.

Successful receipts from this verification are under the Mac temporary root
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

| Fixture directory | Profile | Quit route | Result |
| --- | --- | --- | --- |
| `operatus-quit-smoke-tFXqfO` | Onboarding | Native app quit | Exit 0 |
| `operatus-quit-smoke-LytklV` | Onboarding | Confirm-close IPC | Exit 0 |
| `operatus-quit-smoke-H5cDyI` | Configured, empty | Native app quit | Exit 0 |
| `operatus-quit-smoke-zjtAle` | Configured, empty | Confirm-close IPC | Exit 0 |

All reported zero PTYs, no stderr, no timeout, and no still-alive marker.
The four process IDs were absent after completion. No subscription inference,
credential copying, packaging, signing, publishing, or deployment occurred.

Five helper tests cover immediate resolution, duplicate requests, rejected
flush, synchronous throw, and timeout with late completion. These are in CI.
The native desktop fixture remains explicitly invoked, not a unit-test claim
about a graphical CI environment.

Final verification: all 258 root tests passed with zero skips, including the
explicit digest-pinned offline provider CLI probes. Main/preload and web
typechecks, the Electron production build, and `git diff --check` passed.
These test/build results do not replace the native fixture or live-run gates.

## Still open

Follow-up: [control drain verification](2026-09-06-control-drain.md) closes the
normal-quit teardown and control-socket ordering gaps listed below. It also
raises the final barrier to five seconds for runtime drain plus telemetry.
The earlier 1.2-second measurement above describes the analytics-only fix.

- Confirm orderly shutdown of active provider process trees and their receipts,
  not just the empty Electron process. No live worker was started here.
- Normal zero-PTY quit currently bypasses `teardownAndQuit`'s service teardown;
  unify lifecycle ownership carefully instead of declaring every service drained.
- The current explicit teardown starts control-socket shutdown without awaiting
  it before closing the Gauntlet database. An unfinished socket can also hold
  `server.close()` open. Bound and order that drain before active-run acceptance.
- Test cancellation, crash recovery, sleep/wake, and restart during every run
  phase. A clean quit is not proof of those outcomes.
- Preserve the subscription hold until provider admission and worker
  containment are enforceable together. Full concurrent live Gauntlets remain
  unaccepted.
