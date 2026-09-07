# Operator attention review and portfolio-scale navigation

Date: 2026-09-06. Local desktop implementation and compiled-app verification. No provider processes or inference.

## Story and finding

The owner needs to find human decisions across repositories, inspect the right run, and record that an escalation or execution failure has been handled without changing the Gauntlet outcome. The flow is Runs → local preload IPC → transactional SQLite snapshot/event → updated queue and retained detail.

The initial compiled-app check used 43 persisted synthetic runs across three real disposable Git repositories. Fourteen runs required human attention. Repository/status/search filters correctly excluded routine Conductor acknowledgment and preserved the selected run across filters. However, the detail said “Resolve the escalation” without offering any way to record a decision or clear a handled attention item. Repeated failures would accumulate indefinitely.

## Implemented distinction

Operator review is **queue disposition, not protocol success**. Only `human_required` and `infrastructure_failure` runs can receive it. A required note and an explicit reviewed/unreviewed choice are recorded as `OPERATOR_REVIEW_RECORDED` in the existing append-only event transaction. The snapshot stores the latest review for display. Original notes remain visible in the timeline.

- Mark reviewed removes the item from Needs you and includes it in recent closed history.
- Return to Needs you requires another note and restores attention. It does not resume the run.
- The original status, stop reason, frozen bar, candidate, role launches, acknowledgment and repair counters remain unchanged.
- Active work, passed candidates and cancelled runs cannot be marked reviewed through this action.
- A stale expected run version rejects the write. There is no optimistic clearing before the backend accepts it.
- The IPC requires the actual local desktop's main frame. No worker control-socket operation or hosted command was added.
- No repository content, worktree, branch or evidence is deleted, merged, accepted or restarted.

This uses an optional snapshot field and the existing event table rather than a parallel JSON ledger. Legacy snapshots without review metadata remain unresolved attention items. Older app versions do not understand this queue disposition; it is not a new terminal verdict.

## Evidence

| Boundary | Verified result |
| --- | --- |
| Pure state and validation | Only stopped attention states accepted; invalid/empty/oversized notes and invalid timestamps rejected; terminal protocol transitions remain forbidden |
| SQLite | Review and event committed together; stale version rejects without another event; notes survive close/reopen |
| List retention | 105 reviewed fixtures cap recent closed history at 100 while older unresolved and active runs remain discoverable; restoring an older known ID returns it to attention |
| Actual desktop IPC | Real buttons accepted; stale renderer request and a fabricated sender rejected |
| Renderer | 43 runs across three repositories; 14 attention items; repository filter selects seven; search isolates one without switching the selected context |
| Review/restore | Needs you changes 14 → 13 → 14; selected run retained; exact status remains `human_required`; both review events preserved |
| Visuals | 1440×870 native Mac window and 1920×1080 emulated layout, both at native 2× scale; no horizontal overflow; controls, notes and timeline inspected visually |
| Processes | No PTYs; no renderer page errors; the fixture app closed normally |

The Mac list retained 391 px of vertical scrolling space; the 1080p layout retained 651 px. Long lists scroll independently from the selected evidence. The review form introduces more detail scrolling on the smaller window, but its action and explanation remain visible together. This is not a verification of a physical 1× monitor, mobile layout or dozens of live terminals.

**44 focused protocol/backend/recovery/view tests passed**, zero skips. Node/preload and renderer typechecks and the Electron build passed. CI now includes the operator-review tests. The verification skill shaped the boundary-by-boundary check; its visual checklist was applied with the existing Electron harness because this surface uses desktop IPC rather than a web server.

Retained evidence:

- [Mac reviewed state](assets/2026-09-06/operator-review/reviewed-mac.png)
- [1080p reviewed state](assets/2026-09-06/operator-review/reviewed-1080p.png)
- [Compiled desktop receipt](assets/2026-09-06/operator-review/desktop.json)
- [Focused tests](assets/2026-09-06/operator-review/focused.tap)

Reproduce with `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tools/smoke-run-control-fixture.cjs --volume`, then run `node tools/smoke-run-portfolio-ui.cjs <returned-fixture-root> <installed-playwright-module-path>` against the compiled app. The fixture requires the production launch hold.

## Not finished

- This is not a human resolution that changes requirements or resumes a stopped Gauntlet. Follow-up work still needs an explicitly scoped new run; the frozen contract cannot be silently revised.
- Recent closed history remains limited to 100 entries in this UI. Older records remain stored/addressable by run ID, but a paginated/searchable full-history screen is not implemented.
- Notes are local to this run. They are not automatically routed to agents, pooled into firm memory or sent to the hosted portal. Remote review controls/projection remain future work.
- Priority setting, dependencies, capacity and reliable multi-project live execution still require implementation and acceptance. The 43-run fixture proves navigation and disposition, not autonomous concurrent work or operator effectiveness in a real working day.
- The native Claude Critic/session-binding test again skipped for low disk space earlier in this pass. The subscription launch hold remains unchanged; no Codex admission or live-provider success is implied.
