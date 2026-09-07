# Recovery ownership and independent run access

Date: 2026-09-06. Scope: local Mac development, not a release or live-provider acceptance.

## Story and result

Reopen Operatus, read saved roster and SQLite run state, preserve retired worker
history without resuming its session, and inspect the run even when no Conductor
is running. This boundary now passes in a disposable profile of the compiled
Electron app. Subscription admission remains held; no model inference occurred.

The verification skill's boundary-by-boundary method exposed a separate UX break:
Runs was nested inside the live Conductor's panel. Verification stopped at that
navigation break, it was fixed, and the new path was exercised again. The React
review checklist guided accessible view buttons and retention of draft/view state.

## Implemented

- Main-process lifecycle admission looks up historical worker IDs in SQLite,
  including `pty-` aliases. Ordinary spawn cannot resume a run-owned worker or
  enter its managed workspace using a new identity or symlink alias.
- Prepared run launches travel as a separate main-only argument, not an IPC
  payload field. Token, current run phase, identity, provider, workspace and
  non-resume requirements are checked. A process-local claim rejects duplicates;
  restart reconciliation retires interrupted launch identities before replacement.
- Gauntlet spawns no longer attempt automatic provider installation.
- Renderer lifecycle hints are projections, never authority. Legacy saved records
  are marked from SQLite, retired restore recipes move to archived history, and
  notes remain intact. Live workers survive renderer reconciliation.
- Recovery and watchdog queries no longer depend on the newest 100/500 UI rows.
  Process exits resolve the exact launch rather than searching a paginated list.
- Office/Runs navigation makes the existing evidence surface available without a
  live agent. Drafts survive switching views. Starting a new run is visibly held.

## Evidence

| Boundary | Observation |
| --- | --- |
| SQLite → roster projection | Cancelled legacy worker without a lifecycle label was identified by launch ID |
| Projection → persisted renderer state | Restore list empty; archived worker retains `Preserve this note` |
| Renderer → spawn IPC | Returned `ok: false` with “Gauntlet workers cannot be restored or restarted as ordinary agents. Use the run lifecycle.” |
| Process creation | `listPtys()` returned `[]` before and after the restore attempt and navigation |
| Navigation → run query → display | Cancelled run, frozen contract digest, exact expected SHA, launch/session IDs and timeline rendered without a Conductor |
| View retention | Typed objective survived Office → Runs |
| Viewports | Actual renderer viewport 1920×1080 and 1440×870; document dimensions matched, without document-level horizontal overflow |
| Renderer errors | No captured `pageerror` during the tested navigation |

Disposable fixture: `/private/tmp/operatus-recovery-smoke-dpRISq`.
Run: `5d79c972-3565-4272-9764-946791b3b11a`.
Launch: `bbbc09a6-21a9-4cab-9b44-57798b849da4`.
The fixture prepared then cancelled a launch record; it did **not** start a CLI.
Retained setup and launcher scripts document how it was created. No user profile
or project was used for this fixture.

Screenshots:

- [Before: no independent Runs navigation](assets/2026-09-05/14-recovery-floor-1920.png) (1920×870 logical viewport; native window height was clamped by the Mac display)
- [Runs, 1920×1080](assets/2026-09-05/15-recovery-runs-1920x1080.png)
- [Runs, expanded Mac 1440×870](assets/2026-09-05/16-recovery-runs-mac.png)

The latter two use explicit renderer viewport sizing in the compiled Electron
app, not an HTML mock or production portal. The screenshot series directory
retains its original September 5 name across midnight.

## Remaining findings

This proves recovery ownership and navigation, not unattended execution or CEO-
scale situational awareness. Real-provider pass/repair/acknowledgment, subscription
admission, generic cleanup, cross-Hive fallback, scheduling/capacity and crowded
multi-run UX are still unaccepted. Lifecycle checking is not an OS sandbox or a
complete arbitrary-code execution defense.

The Runs view still spends considerable space on creation, has weak priority and
decision hierarchy, can briefly show an empty state before loading, and lacks
stale-response protection for fast selection changes. Terminal runs misleadingly
show unlaunched roles as “awaiting launch.” Configured Conductor role is not proof
of a live authenticated Conductor. These are next UX/data-projection fixes.

Instrumented normal close again left the disposable process alive. Only our own
zero-PTY smoke process was terminated; ordinary uninstrumented quit still needs
its separate reproduction. No existing user process was stopped.

Tests cover old/terminal/resumed/forged/duplicate launch denial, new identity on
restart, managed path aliases, unavailable authority, renderer-store partition,
and recovery past 501 newer completed runs. A separate two-project test exercises
concurrent artifact completion and cancellation isolation in one backend; it does
not simulate provider concurrency or human supervision of a busy floor.

The complete root test suite passes **214 tests**. Node/web typechecks pass.
The compiled build used for the two navigation captures passed; a final rebuild
also includes the missing-child symlink-path guard regression.

Latest verification logs: `/tmp/operatus-recovery-full-tests.log`,
`/tmp/operatus-recovery-typecheck.log`, `/tmp/operatus-recovery-build.log`.
