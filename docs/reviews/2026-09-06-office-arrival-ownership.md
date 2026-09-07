# One visual occupant per asynchronous arrival

6 September 2026. Renderer concurrency hardening; no provider admission or live
Gauntlet execution is established by this pass.

## Reproduced failures

`OfficeFloor.syncAgents` requested `addCharacter` whenever an agent was absent
from the completed runtime map. Loading frames is asynchronous, so subsequent
roster updates could claim another desk and start another sprite for the same
agent before that map was populated.

Tests execute the actual `addCharacter` and `syncAgents` functions extracted
from `OfficeFloor.tsx`, with deferred frame loading and inert sprite drawing.
The initial five regressions all failed on the pre-fix code:

- Three overlapping requests started three loads instead of one.
- Nine arrivals with repeated roster reconciliation started **45 loads**, not
  nine. Duplicate completions could overwrite the runtime record while leaving
  other sprites/desks behind.
- A status changed to blocked during loading was painted as the previously
  captured working status.
- Abandoned scene loading retained a desk claim.
- Frame-loading rejection escaped the asynchronous call and retained ownership.

Before-fix log: `/tmp/operatus-arrival-before.log`.

## Implemented

A scene-local pending claim is established before asynchronous frame loading.
Already mounted or pending identities cannot start another load. On completion,
the claim must still belong to this scene/agent before anything is attached.
Removed pending identities are invalidated during reconciliation; re-adding the
same identity receives a new claim which an old completion cannot clear.

The newly mounted sprite paints the latest agent status/action and accent, not
the pre-await snapshot. Failed, removed and abandoned loads release their seat
claims. A partially constructed sprite is torn down if initial state painting
fails. These are visual ownership records only, not run authority or capacity
admission. Arrival itself never calls selection.

Seven focused regressions cover these cases plus remove/re-add and partial
creation failure. The combined arrival, station-path, GL recovery and billing
suite passed **25 tests, zero failures, zero skips**. Node/web typechecks,
Electron build and `git diff --check` passed. CI includes the new suite alongside
station-path verification.

## Compiled smoke scope

The verification skill's story is synthetic arrival events → real roster
reconciliation → asynchronous sprite frames → the compiled Pixi floor. The
`--burst` mode of `tools/smoke-office-stations.cjs` removes the previous 250ms
spacing between nine fixture events. It does not intercept provider admission
or launch real processes; the subscription startup hold stays enabled.

Inspected the settled Mac and 1080p captures: six central occupants and three in
the evidence room, matching the nine fixture arrivals. No page overflow or
renderer page/console error was recorded. The lower strip scrolls at the Mac
size and shows all nine cards at 1080p. The existing chair alignment and generic
`starting up`/`idle` mismatch remain visible; this pass did not disguise them.
Visual counts supplement the deterministic ownership tests; screenshots alone
cannot rule out perfectly overlapping hidden duplicates.

Evidence root:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-pdAbjd`.
It contains `station-ui-receipt.json`, `stations-arriving-mac.png`,
`stations-settled-mac.png` and `stations-settled-1080p.png`. The 1440×870 capture
uses a native Mac window at DPR 2; 1920×1080 is an emulated layout at native DPR,
not physical 1× hardware. The fixture closed its own Electron process.

Logs: `/tmp/operatus-arrival-focused.log`, `/tmp/operatus-arrival-types.log`,
`/tmp/operatus-arrival-build-final.log` and `/tmp/operatus-arrival-ui.log`.
No inference, credentials, account settings, release or deployment was involved.

## Remaining work

- Role/phase/freshness projection and chair alignment from the previous station
  audit remain open. A correct count of sprites does not make generic status
  labels trustworthy or make assigned desks correspond to Gauntlet roles.
- Provide a visible asset-load failure/retry state; failures are currently
  logged and can retry on a later roster change. A never-resolving frame request
  retains its pending claim until removal/scene teardown; timeout/recovery needs
  separate, identity-safe handling.
- Character appearance changes during loading or after mounting need an
  explicit replacement policy. This fix refreshes status/action/accent at
  initial attachment, not an avatar editor implementation.
- Verify capacity overflow, reduced motion, real provider lifecycle and
  simultaneous multi-Gauntlet activity. Native captures with synthetic arrivals
  do not substitute for those acceptance gates.
