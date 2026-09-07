# Stable upstream: operator-flow comparison

6 September 2026. Source comparison, not an interactive upstream acceptance.

GitHub's latest-release endpoint still resolves to [Munder Difflin v0.4.6](https://github.com/chaitanyagiri/munder-difflin/releases/tag/v0.4.6), commit `64bd64df0e8d315a6e895283f776b81f84eef2cc`. The comparisons below use that exact local Git tree and the current, uncommitted Operatus checkout. No upstream merge, asset import, provider launch or production-profile change was made for this review.

## Findings and disposition

| Operator task | Stable Munder implementation | Current Operatus implementation | Decision |
| --- | --- | --- | --- |
| Continue reading when a worker arrives | `store/store.ts` sets selection to the new agent in `addAgent` | Same unconditional selection; called by explicit hiring, background Hive announcements and team restoration | Improve beyond upstream: distinguish an explicit request to inspect a hire from a background arrival. Background activity must preserve a valid selection. |
| Keep terminal focus when a worker closes | `store/focusMode.ts` separates removal, initial preference and delayed restoration rules; store removal paths re-home focused identity | Removal/archive/reconciliation update selection but not `fullscreenAgentId`; no corresponding focus policy module | Adapt the pure policy, with an explicit choice of a surviving terminal. Do not copy any process-restoration behavior. |
| Return after restart | Stable persists a Boolean focus preference and resolves it against the current roster, rather than persisting a terminal identity as authority | Fullscreen starts as null | Useful later, after current-session focus behavior is verified. Never restore a Gauntlet launch because a UI preference requests focus. |
| Resize office and detail | `SidebarSplitter.tsx` provides a mouse drag and double-click reset | The inspected splitter is identical | Keep the layout, but this is not an upstream improvement to import. Both lack a keyboard-operable separator. Improve keyboard access and test narrow windows/zoom locally. |
| Keep projects separate when changing Hive | Stable `rosterSource.ts` and `config:homeSync` bind localStorage fallback to the home that wrote it (`b01770e4`) | File/localStorage fallback remains unscoped; Gauntlet restore exclusion is a separate implemented safeguard | High-priority adaptation. Do not confuse exclusion of managed launches with isolation of ordinary agents, notes and queues. Explicitly decide how to handle legacy unstamped data rather than silently assigning it to a new home. |
| Continue mailbox delivery while the window is occluded | Main-process worker watchdog (`68cbc25c`) adds boot, quiescence, permission, control and cooldown guards | `useHive.ts` still contains renderer-timed inbox/queue delivery; the Gauntlet watchdog serves a different purpose | Adapt scheduling ownership, not raw terminal typing. Coordinate with existing delivery so main and renderer cannot both submit the same nudge. |
| Inspect a specific run while other work progresses | Ordinary agent/terminal selection is the principal upstream structure reviewed | Top-level Runs plus persistent selected-run context, repository filters and SQLite evidence already exist | Preserve the Operatus distinction. A wholesale stable-baseline replacement would require re-proving these additions and their authority boundaries. |

## Recommended next implementation order

1. **Selection stability and current-session focus.** Introduce a small, testable view policy. Explicit hiring may select the requested hire; background arrivals and restored teams do not interrupt an existing selection. Closing the focused worker moves only the view to an eligible survivor, or closes focus if none exists. Test selected worker removal, unrelated removal, no surviving terminal, delayed arrivals and explicit exit. No spawning belongs in this policy.
2. **Home-scoped ordinary roster persistence.** Adapt upstream with canonical home identity and an explicit legacy-data policy. Test two homes with identical localStorage origin, empty/new home, queues and notes, dev/compiled origin bridging and Gauntlet exclusions. Do not exercise the currently unsafe home-migration command on real data as a shortcut.
3. **Main-owned delivery.** Inspect and adapt the watchdog together with submission serialization, permission holds and shutdown. An idle-looking sprite is not sufficient authorization to type into a provider. Prove duplicate prevention and hidden-window behavior before treating this as background reliability.

Roster follow-up: [executed ownership audit](2026-09-06-roster-ownership-audit.md) reproduces current cross-home fallback and rejected-home-change cache loss. Upstream's shared stamp also needs stricter adaptation to prevent relabeling retained payloads. Per-home cache migration and actual native switch/relaunch acceptance remain open.
4. **Evidence workspace ergonomics.** Keyboard resizing and a focused evidence view should preserve the selected run and its scroll/context. Test finding-to-artifact-to-overview navigation, not just an attractive empty floor.

These improve the existing foundation; the inspected differences do not yet justify rebuilding Operatus on the stable tree. A transplant remains an isolated experiment with an acceptance gate, not the default recommendation.

## Evidence limits and outstanding acceptance

The stable app has not been run interactively in this comparison. Existing Operatus captures and compiled-desktop fixtures establish only their recorded tasks; synthetic reports and absent PTYs do not demonstrate a busy real-provider firm. The task-matched stable/Operatus comparison at 1440×870 and 1920×1080, 6/12-worker density, keyboard/zoom checks and live concurrent Gauntlets remain open.

Claude Max is the operator-confirmed subscription. The catalog already includes `claude-fable-5-1`; that catalog entry does not admit execution. The subscription launch hold remains enabled, and this review did not refresh account receipts, change billing settings or initiate inference.
