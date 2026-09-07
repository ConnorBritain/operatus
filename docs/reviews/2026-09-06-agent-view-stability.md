# Agent selection and current-session focus

6 September 2026. Implemented and tested in the compiled Mac application using synthetic roster events. No provider inference.

## User story and scope

An operator inspecting one agent should not be redirected when another agent arrives. Selecting a roster row should still navigate deliberately. When the focused agent is removed, the view should follow an eligible surviving terminal or close if there is none. These are view transitions, not permission to spawn, resume or grade a worker.

The flow exercised is main-process roster event → preload subscription → actual Zustand store → persisted selection and React terminal/roster rendering. The test uses the production compiled main/preload/renderer in a disposable profile. Its injected roster descriptors and terminal text are synthetic; main's PTY inventory remains empty.

## Changes

- Added the pure `agentViewPolicy.ts` policy. Background arrivals preserve a valid selection; an explicit hire completion opts into selecting its agent. An empty floor can select its first arrival.
- Preserved first-writer/idempotent agent records while handling the main-broadcast-before-hire-response race. A duplicate explicit response can select its existing record; duplicate background events cannot steal selection.
- Adapted Munder v0.4.6's focus re-homing principle for removal, archive, main-driven reconciliation and loss of an agent's PTY reference. A survivor must have a terminal reference and not be archived. Prefer the existing focused agent, then selected terminal, then Conductor, then another terminal.
- Explicitly exiting focus stays off through subsequent arrivals/removals. No restart preference or process restoration was added.
- Removed a store write during `FullscreenTerminal` rendering. Store transitions own re-homing. Added a visible-view identity attribute for reproducible verification.
- Kept per-output-chunk updates from unnecessarily rescanning focus candidates; only PTY/archive changes need that check in `updateAgent`.

The React skill review checked both changed components for render-time mutations and unnecessary effects. The hiring component's new explicit selection flag changes view intent only; it does not bypass launch admission. Existing Gauntlet restore exclusion remains tested.

## Verification

| Boundary | Evidence |
| --- | --- |
| Pure view policy | Selection/focus eligibility, missing identity, explicit exit and empty roster cases pass. |
| Actual store and persistence | Background selection, duplicate explicit-hire race, unchanged first record, archive/removal, cleared PTY, managed-launch exclusion, localStorage and roster mirror assertions pass. |
| Compiled UI at 1440×870 and 1920×1080 | Background arrivals do not steal selection/focus; explicit roster click changes both; unrelated removal preserves focus; removing the focused card selects a survivor; last-card removal closes focus; later arrivals do not undo explicit exit. No horizontal page overflow or renderer errors observed. |
| Execution boundary | PTY list empty before and after. No provider process or live Gauntlet was started. |
| Regression | All 298 root tests pass with `--test-concurrency=1`, zero skipped. Typechecks and Electron production build pass. `git diff --check` passes. |

The first UI attempt stopped on a test selector matching both the roster button and its note button. The corrected exact-label selector passed on a fresh fixture. The first parallel regression run had 297 passes and one failure: Codex's offline initialization returned **No space left on device**. Available disk space was around 377 MiB at inspection and later rose to around 829 MiB without deleting user files. The sequential full-suite rerun passed. This is evidence of local disk pressure, not an admission or billing failure; keep more headroom before real work.

## Visual findings still open

Follow-up: [display-scale diagnosis](2026-09-06-terminal-viewport-scale.md) reproduced the tiny text with mismatched test emulation and verified readable output with native/matched scale. The paragraph below records the original observation, not a remaining confirmed application font defect. Other visual and liveness limits still apply.

The screenshots are **not a visual acceptance pass**. Terminal glyphs appear substantially smaller than the displayed 12px setting, with text appearing near the middle of the otherwise mostly empty terminal. Determine whether this is transient attach/font/WebGL sizing, Retina scaling or a persistent layout defect by collecting settled canvas/font metrics and testing real offline terminal output. Do not simply increase the default font to hide the discrepancy.

The existing terminal header also calls a roster descriptor “live” even though this synthetic fixture has no PTY in main. Real lifecycle/status reconciliation still needs its own acceptance; a UI label is not liveness evidence. Roster names remain truncated. Neither this small roster nor these synthetic events prove 6/12-worker visual density, output throughput, live-provider completion or cross-project strategy management.

## Reproduction and retained evidence

Run `tools/smoke-run-control-fixture.cjs` with Electron in Node mode to create a fresh disposable Git/SQLite profile, then `tools/smoke-agent-view-ui.cjs <fixture-root> <installed-playwright-path>`. The latter requires the production subscription hold and closes its owned application in `finally`.

Successful fixture: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-k470u9`, with `agent-view-ui-receipt.json`. Failed-selector fixture: sibling `operatus-run-control-GJ7NOs`, retained separately. These temporary paths may be reclaimed by the OS.

- [Expanded Mac capture](assets/2026-09-05/31-agent-view-mac.png)
- [1920×1080 capture](assets/2026-09-05/32-agent-view-1080p.png)
- Local logs: `/tmp/operatus-agent-view-typecheck.log`, `/tmp/operatus-agent-view-build.log`, `/tmp/operatus-agent-view-ui-retry.log`, `/tmp/operatus-agent-view-tests.log` and `/tmp/operatus-agent-view-tests-serial.log`.

No merge, commit, deployment, installer, signing action or real-user data deletion was performed. The overall readiness goal remains open and subscription launch admission remains held.
