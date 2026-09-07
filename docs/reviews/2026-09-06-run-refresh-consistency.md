# Run refresh and selected-evidence consistency

## Story and boundary

The operator switches between projects or refreshes Runs, and the desktop must show evidence belonging to the selected run at its current known version. The path is the compiled Runs component → typed preload calls → `gauntlet:list` / `gauntlet:get` IPC → local Gauntlet SQLite snapshots → the renderer projection. No new state authority or provider launch is introduced.

The current baseline already protected detail requests with selection epochs, preserved pushed snapshots against stale reads, and distinguished initial loading from an empty list. This pass extends those protections rather than replacing them.

## Issues corrected

- List requests now carry monotonically increasing request identities. Older responses and older failures cannot finish a newer refresh or replace its result.
- A list response that establishes a newer selected-run version clears the older detailed evidence and requests a new snapshot. It also invalidates any earlier in-flight detail read.
- The selected run's objective, repository, status and next responsibility remain visible while evidence loads. They are explicitly a summary; stale artifact/report details are not kept beneath a newer heading.
- An explicit refresh reloads the selected snapshot even if the phase version is unchanged. Launch/check receipts can change independently of that version.
- A mismatched run identity now produces an actionable evidence-load error, rather than leaving the interface in an indefinite loading state. Late responses from an old selection are still silently discarded.

## Verification approach

The verification skill's boundary checklist was applied to Electron IPC using the existing compiled-desktop harness, rather than a separate browser/dev-server page that would omit the native preload boundary. `tools/smoke-run-refresh-ui.cjs` launches a private, disposable profile with real Git/SQLite run snapshots. Its process-local test instrumentation delays `gauntlet:get` responses and suppresses selected push events to reproduce missed/delayed delivery. That instrumentation does not ship in the app.

The cancellation itself uses the actual main-process handler and persists in the fixture database. The Critic findings already present in that fixture are synthetic; no model or worker process executes. Tests check that the PTY list is empty and close the owned application in `finally`.

The first compiled-desktop pass verified both viewport layouts, newer-version refresh, cross-project late response rejection and retry after injected transport failure. The final compiled-desktop pass also passed mismatched-response rejection/retry and explicit refresh at unchanged version. No renderer page errors occurred, and the PTY list was empty.

| Boundary | Observed evidence |
|---|---|
| UI → preload/IPC | Actual run-card selection and refresh controls invoked the installed handlers; delayed requests were observed in the owned main process. |
| IPC → data | Main-process cancellation persisted version 1 → 2 for the Mac fixture and 0 → 1 for the 1080p fixture; the selected repositories differed. |
| Data → response | Real list/get handlers returned those SQLite snapshots; the harness controlled timing and injected failures, not a replacement renderer. |
| Response → UI | Newer summaries cleared old detail; delayed cross-project responses did not replace selection; wrong-run and rejected responses offered a working reload action. |
| Visual/context | Screenshots inspected at 1440×870 native-window and 1920×1080 emulated-layout/native-scale; selected objective, repository, status and responsibility remained visible without document horizontal overflow. |

**16 focused tests passed**, including run projection, renderer recovery and selection policy. Both typechecks and the final Electron production build passed. The existing large-renderer-bundle warning remains; it is not a new performance acceptance claim. `git diff --check` passed.

Retained evidence: [loading on Mac](assets/2026-09-06/run-refresh/run-refresh-loading-mac.png), [current evidence at 1080p](assets/2026-09-06/run-refresh/run-refresh-current-1080p.png), and [machine-readable viewport receipt](assets/2026-09-06/run-refresh/run-refresh-ui-receipt.json). Temporary fixture: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-GUbYml`. Logs: `/tmp/operatus-run-refresh-final-{unit,types,build,ui}.log`.

## Remaining acceptance

This is a consistency and legibility check of the Runs view, not proof of live Claude/Codex concurrency, provider lifecycle, autonomous repair, or project-level strategy management. Operator priorities, capacity, dependencies, the decision inbox and meaningful floor station allocation remain separate roadmap work. The 1920×1080 layout is emulated at the Mac's native 2× scale, not a physical 1× external display. No portal/mobile or active terminal-density acceptance is claimed.

Storage fluctuated from roughly 0.35 to 0.66 GiB during this pass. Small UI fixtures were possible, but the earlier large native executable-copy rerun remains pending. No user work was deleted, and the subscription launch hold remains active.
