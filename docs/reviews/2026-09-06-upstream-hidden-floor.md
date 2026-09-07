# Stable Munder adaptation: stop rendering a hidden floor

## Decision and source

Adapt `20d1207b24189fcbccbc1aa73ce0894e3f3ea206` (Munder Difflin,
“perf(office): stop rendering the floor nobody is looking at”). Local Git ancestry
checks confirm it is contained in the audited v0.4.6 stable commit
`64bd64df0e8d315a6e895283f776b81f84eef2cc`.
This is an adoption from that verified stable baseline, not a new latest-release
discovery. No upstream art, provider permissions, analytics or updater changes
were imported.

Upstream stops Pixi's ticker for fullscreen terminal/file views and document
visibility changes, retaining the scene rather than unmounting it. Operatus also
keeps the floor mounted behind its Runs surface using `display: none`; before this
change, that view continued ticking. The adaptation includes this extra coverage
condition.

## Implementation

- App passes whether Office is the selected workspace view. OfficeFloor combines
  that with its fullscreen coverage state.
- A scene-scoped visibility controller listens for `visibilitychange` and stops
  the ticker whenever the document is hidden or the floor is covered.
- Pixi initializes with `autoStart: false`. The controller attaches after scene
  setup, applying the current conditions, including navigation during async init.
- Cleanup removes the listener and stops the ticker. Late attachment cannot
  restart a disposed controller. Theme/context rebuilds receive a new controller.
- Navigation does not destroy/recreate the scene. Native actor subscriptions and
  ordinary store subscriptions remain attached; only rendering/animation pauses.
  Existing task-board polling is unchanged. This is not a claim that all hidden
  view CPU work has been eliminated.
- The controller has no provider, IPC, SQLite, Git or scheduler authority.
  Gauntlet execution, timeouts and evidence capture do not depend on its ticker.

React review: coverage is a derived boolean; the visibility update effect depends
only on that boolean. The scene initialization effect still depends only on theme
and context generation. Listener cleanup is owned by that scene's lifetime.

## Verification

`node --test test/office-visibility.test.cjs test/office-gl-recovery.test.cjs test/gauntlet-office-projection.test.cjs`
passed **21 tests, zero skipped** on September 6.

The six new visibility tests cover coverage toggles, document/coverage overlap,
changes during async initialization, late disposal, scene replacement, and the
installed Pixi Ticker. The real ticker test uses a deterministic animation-frame
clock: hiding cancels its pending request, no hidden update runs, and resuming
produces a normal delta rather than replaying elapsed hidden time. It does not
instantiate a GPU canvas or the Electron app.

Web and main-process typechecks pass. The production Electron build passes.
`git diff --check` passes. The visibility/context tests are included in CI.

## Acceptance still open

Computer Use returned “The Mac is locked” on this turn. No bypass or app GUI
launch was attempted. These tests do **not** close rendered acceptance.

With the Mac unlocked, inspect Office → Runs/evidence → Office and fullscreen
terminal/file → Office at expanded Mac and 1920×1080 sizes. Check canvas framing,
latest actor identities/status after changes while hidden, theme rebuilds, and
minimize/restore. Confirm actual frame/CPU behavior and normal resume in the
desktop app; do not infer a measured GPU/CPU saving from the unit test.
Document visibility does not promise detection of every case where another
window covers the app. Existing visual-only task-board choreography also needs
the rendered return-from-background check.

Global subscription launch hold remains enabled. No inference, account changes,
deployment, release or candidate integration was performed for this adaptation.
