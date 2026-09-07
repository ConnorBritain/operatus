# Munder layout audit and Operatus adaptation brief

Date: 2026-09-05. Status: initial source/screenshot review complete; interactive stable-build comparison planned.

Follow-up: the [6 September operator-flow comparison](../reviews/2026-09-06-upstream-operator-flow.md) distinguishes actual stable improvements from inherited behavior that both products should improve, and ranks the next adaptations. Interactive stable-build acceptance remains open.

## Reference and evidence limits

Reference upstream [v0.4.6](https://github.com/chaitanyagiri/munder-difflin/releases/tag/v0.4.6), commit `64bd64df0e8d315a6e895283f776b81f84eef2cc`. Inspected its `App.tsx`, `store/focusMode.ts`, and the `docs/screenshots/autonomy.png` image shipped in that tag. A bundled documentation screenshot may predate the release; it is not proof of every current runtime behavior. The stable binary has not been interactively smoke-tested in this audit yet.

Compare with the actual Operatus viewport captures in the [Mac readiness review](../reviews/2026-09-05-local-mac-readiness.md). Preserve upstream assets only as private review references, not imported distributable art.

## What is worth retaining

| Observed pattern | Why it helps | Operatus adaptation |
| --- | --- | --- |
| Flexible floor plus resizable detail panel in upstream App | The scene and actual work stay adjacent | Preserve the splitter; improve discoverability and saved layout. Add evidence focus instead of permanently forcing a cramped Runs panel. |
| Dedicated full-window terminal and explicit focus restoration rules | Deep work does not require the floor to be visible; closing an agent need not eject the operator from focus mode | Restore a valid UI destination without reviving a terminal Gauntlet launch. Add equivalent evidence focus. |
| Persistent agent strip and agent-specific detail | Spatial roster provides continuity while the selected detail changes | Keep identity stable, group by work order at scale, show full meaningful names, and never auto-select a fresh worker while the operator is reading. |
| Clear settings navigation, active-section highlight, pixel labels with ordinary explanatory text in the reference screenshot | Personality without making all prose pixel-font text | Apply the same hierarchy to role policies and budgets. Recheck spacing and wrapping in the live release rather than copying screenshot dimensions. |
| Bundled fonts in the stable release | Offline appearance is reproducible | Bundle Operatus's selected faces, harmonize desktop/web scale and avoid network-dependent startup typography. |
| Pause the floor ticker while fullscreen/hidden, retaining the scene | Evidence and terminal reading need not keep the hidden office animating | Adapted to include Operatus's Office/Runs switch. [Lifecycle tests and remaining rendered acceptance](../reviews/2026-09-06-upstream-hidden-floor.md). No measured performance claim yet. |

## Do not copy indiscriminately

The floor is an effective metaphor, but moving characters are not evidence of successful work. Keep the original Operatus art and clarify role/state through labels and stations. Retain warmth and charm without Office parody names or licensed asset reuse. Do not inherit upstream autonomy permissions, telemetry or update configuration merely because their visual controls look useful.

Avoid expanding the existing tab strip into an encyclopedia. The primary questions are: what is happening, what needs me, and what proves it? Advanced terminals, traces, graphs, memory and settings remain available through progressive disclosure.

## Interactive comparison protocol

Run upstream stable and Operatus in separate profiles against disposable repositories. Record exact revision, provider versions, theme and viewport. Do not launch upstream automation against the operator's live repositories as part of a visual inspection.

1. Open and resize the default office/detail split at 1440×870 and 1920×1080.
2. Find the lead, inspect a worker, return to the lead and restore focus after a worker closes.
3. Read a long task, multiline finding, diff and test failure without horizontal page scrolling or losing selection.
4. Exercise 1, 6 and 12 workers, plus an aggregated larger-team design. Distinguish empty capacity, queued work, active execution and disconnected/stale state.
5. Surface an authentication hold, permission request and process failure. Test whether an ordinary user can distinguish them from idle work.
6. Hide/minimize, sleep/wake, restart, and verify the view returns coherently without fabricated activity or unauthorized process restoration.
7. Check keyboard focus, zoom/increased text size, contrast, reduced motion and reading order. For the portal, additionally test phone portrait with sign-in/control ahead of decorative art.

Deliver a keep/adapt/reject comparison with screenshots, task results and specific Operatus changes. A visually appealing screenshot alone does not close this audit.

## Proposed Operatus-specific direction

The office is the glanceable view; the Conductor is the working relationship; the evidence workbench is the reason to trust the result. All three show the same run identity and last verified state. One calm decision inbox gathers genuine interruptions. A return-to-work summary answers what changed since the operator last looked, sourced from persisted events with freshness indicators and links to evidence.

Prototype this with actual failure and repair data before adding more decorative scenes. Test whether the operator can leave the product unattended and return without reconstructing the story from terminals. That is the visual product advantage to pursue.
