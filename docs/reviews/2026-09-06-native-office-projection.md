# Native Gauntlet office projection

## Finding

The Pixi floor previously read only ordinary Zustand/PTy roster agents. Isolated
Gauntlet processes use a separate main-owned runtime journal, so they could be
represented in Runs while the office displayed EMPTY FLOOR. Adding fake roster
agents would incorrectly join their persistence, terminal selection, mailbox,
task-board, and ambient automation lifecycles.

## Implemented boundary

- One read-only office feed subscribes before loading SQLite snapshots through
  existing preload APIs. Four concurrent reads bound initial loading; late reads
  overtaken by pushes and older protocol/runtime revisions are rejected. Closed
  snapshots are discarded while revision watermarks prevent resurrection.
- Exact run/launch/session identities project recorded starts and activity.
  Preparation alone creates no sprite. Successful tool results never imply a
  successful artifact or run. Conductor turn completion means waiting, not exit.
- Native sprites have separate ephemeral identities and share only exclusive
  seat leases with ordinary agents. They link to their run's evidence, not an
  invented terminal. No fake typing, wandering, errands, celebrations or mail.
  Restored observations appear at desks without replaying a fictional arrival.
- Confirmed exits remove sprites. Unknown restart exits remain reviewable in the
  run panel but do not occupy desks. Reviewing a closed unknown-exit run can
  remove it from this operating view without changing its artifact verdict.
- Pending/unseated counts expose texture loading or floor overflow. All runs
  remain accessible in the panel and Runs. This is visual capacity only, not a
  configured execution concurrency limit.
- The office sidebar shows project, objective, responsible role, last observed
  activity and time. Top-level Runs retains open/unsettled and needs-you counts
  even when an ordinary terminal agent is selected. Sprite/card links select the
  exact run and clear prior list filters without issuing protocol commands.
- No main-process authority, provider launch policy, billing hold, Git contents,
  artifact evidence or persisted normal roster semantics changed.

## Verification and limits

Nine focused tests cover identity filtering, preparation vs start, result vs
verdict, Conductor waiting, separate projects, reviewed unknown exits, late read
and stale push rejection, visible partial failure, seat overflow, late texture
loads, replacement/disposal ownership and partial-paint cleanup. Existing
run-view, operator-review and arrival checks passed with the new checks under
Electron's Node runtime (32 tests total). The four station-route checks passed
under Node 22.23.1. An attempted all-in-Electron command failed at the station
test's direct CommonJS import of Pixi's ESM `earcut` dependency under Node 20.18.1;
the renderer is Vite-bundled, and that failure is not a native window smoke.
No dependency or test assertion was weakened. Node/web typechecks and the final
Electron build passed. Existing bundle-size/dynamic-import warnings remain.

The React review focused on stable scene subscriptions, latest callback refs,
memoized actor projection, cleanup, visible loading/errors, and keyboard-native
run links. The scene is not recreated for each activity event.

The compiled macOS application was launched against the disposable profile:

`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-25UET7`

Reproduction:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tools/smoke-run-control-fixture.cjs --office
OPERATUS_RUN_INSPECT_ROOT=<returned-root> node_modules/.bin/electron test/fixtures/desktop-run-inspect.cjs
```

The `--office` fixture explicitly seeds synthetic start observations for six
lead/worker identities across three repositories. It runs no provider. On
opening/reconciling this profile, these must become unknown exits, not live
workers. This fixture is for restart/decision visibility, not active-motion or
real-model acceptance. An initial fixture attempt failed its Conductor identity
check; the fixture was corrected to freeze with its prepared lead identity.

**Visual acceptance did not run:** the computer-use tool reported that the Mac
was locked and could not be automatically unlocked. No screenshot or inspected
viewport is claimed from this attempt. The user was asked to unlock it.
The owned disposable Electron process was stopped with SIGTERM after verifying
its PID and fixture command. This does not count as a normal menu-quit test. The
disposable Git/SQLite profile and receipt remain available for the next attempt.

Still required: actual compiled floor and card/sprite navigation inspection,
expanded Mac and 1920x1080 layouts, active native event-to-frame behavior, mixed
ordinary/native agents, large concurrency density, painted-chair alignment,
role/phase-specific stations and meaningful movement, and real subscription-only
Claude/Codex multi-run acceptance. The global launch hold remains enabled.
