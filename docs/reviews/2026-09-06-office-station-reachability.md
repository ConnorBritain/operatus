# Office station reachability before role-based movement

6 September 2026. Production map/path fix with bounded renderer smoke. The
role/phase-to-station projection remains incomplete.

## Failure reproduced

The shipped `operatus-operations.tmj` collision objects sealed the evidence
room's south wall and the adjoining repair-room divider. The original background
art visibly provides a central door. The actual `TiledMapRenderer` and BFS
`findPath` returned no entrance route to `desk-chief-architect`,
`desk-product-manager`, `desk-team-lead` or `warroom-seat`.

This was not a hypothetical role-mapping issue: ordinary seventh through ninth
workers claim those three named desks under the current seat allocator.

`Character.moveTo` also left an old path intact when a new target was
unreachable. A new walk-and-arrive request could therefore keep walking toward
the previous destination and invoke its new callback at the wrong station.

## Fix and deterministic evidence

- Split the two collision rectangles around the painted central doorway,
  leaving a two-tile passage at x=38–39. Preserve the adjacent wall tiles and
  perimeter. No background image, external art or pathfinding algorithm changed.
- An unreachable new movement target now cancels the previous path, pending
  arrival/sitting/work state and working glow. The avatar remains idle at its
  real current position. No teleport or false arrival is introduced.
- Added `test/office-station-paths.test.cjs` and a CI step. Four tests reproduce
  the old sealed room, verify all 17 shipped desk/evidence points in both
  directions, preserve wall/perimeter collision, execute actual Character
  movement methods through an evidence-room arrival exactly once, and reject
  stale-route arrival on an unreachable replacement target.

The focused run including office GL recovery and billing policy passed
**18 tests, zero failures, zero skips**. Node/web typechecks, Electron build and
`git diff --check` passed. Movement tests use real map parsing/BFS and extracted
actual Character methods with inert sprite drawing, not a second movement model.

## Compiled desktop verification

Using the verification skill's complete-path check, ran
`tools/smoke-office-stations.cjs` against a disposable compiled Electron profile.
It emits nine synthetic arrival events, spaced 250ms apart, and observes the
real floor while the production launch hold remains active. No actual PTY or
provider runs. Waited 16 seconds after arrivals for the longest tested route.

Inspected both settled captures. Six agents occupy the central work area and
three reach the evidence room. There is no horizontal page overflow and no
renderer page/console error. The bottom agent strip intentionally scrolls at
1440×870; all nine cards fit at the 1920×1080 layout. This is visual arrival
evidence, not concurrency/admission, real role assignment or successful work.

Evidence root:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-TZNU9s`.
Contains `station-ui-receipt.json`, `stations-arriving-mac.png`,
`stations-settled-mac.png` and `stations-settled-1080p.png`. Mac is a native
1440×870 window at DPR 2; 1920×1080 uses emulated layout at the native DPR, not a
physical 1× monitor. The fixture closes its own Electron process.

Logs: `/tmp/operatus-station-paths-tests.log`,
`/tmp/operatus-station-focused.log`, `/tmp/operatus-station-paths-types.log`,
`/tmp/operatus-station-paths-build.log`, `/tmp/operatus-station-ui.log`.

## Remaining visual/protocol gaps

The screenshots are not evidence that the intended motion contract is complete:

- Some sprite seats are visibly misregistered with the painted chair/worktop
  positions. Align spawn points and collision furniture against the artwork,
  then repeat both viewport captures before designing more stations.
- Synthetic arrivals retain their `starting up` action while cards say `idle`.
  The floor displays the generic action, not a fresh, exact-launch protocol
  projection. This exposes the need for lifecycle/freshness labels; it does not
  establish that any provider is starting or idle.
- Current station allocation is by arrival order, not Gauntlet role. Connect a
  typed, version/freshness-checked SQLite snapshot projection to role stations;
  show exact launch/artifact context without granting the floor authority.
- An unreachable route is now stopped safely but still needs a discoverable
  visual-layout diagnostic distinct from an agent/run failure.
- Test repeated snapshots, removed agents during asynchronous sprite loading,
  truly simultaneous arrivals, visual capacity/overflow, reduced motion,
  cancellations and stale/disconnected snapshots. This spaced-arrival fixture
  does not close those cases.

Do not equate seated sprites, route completion or generic success badges with
Critic acceptance, Conductor acknowledgment, integration or live-model readiness.
