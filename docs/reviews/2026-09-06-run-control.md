# Run control: operator attention and selection integrity

## Story and scope

Open Runs in the compiled Mac app, distinguish operator decisions from delegated
work across repositories, select exact evidence, and cancel only the intended
run. The verification skill's boundary-by-boundary method was used for navigation
→ preload IPC → main-process SQLite → rendered evidence.

This is **real application/IPC/SQLite/Git verification with explicitly synthetic
run evidence**, not a live-provider smoke. No model ran, no paid service was
used, and the launch safety hold was not bypassed. The goal's live pass, repair,
re-critique and concurrent-provider acceptance requirements remain open.

## Implemented fixes

- Operator queries retain every open run, escalation and infrastructure failure.
  Only passed/cancelled history is capped at 100. Live renderer updates retain
  the same bound. A regression places attention work behind 501 newer closed
  records so completion volume cannot silently hide it.
- The list ranks attention-needed runs before active work and closed history.
  Repository, status and objective/ID search filters compose; counts explicitly
  follow the repository filter. An off-filter selection is labeled, not silently
  replaced with another run.
- A visible next-responsibility line distinguishes **You** from **Conductor**,
  **Implementer**, **Critic** and **Repairer**. In particular, awaiting a Critic
  acknowledgment is the Conductor's responsibility, not a human approval prompt.
  These labels describe protocol responsibility, not process liveness.
- Creation is a collapsible retained draft, allowing existing work to occupy the
  list. Critic evidence has a direct jump from the current responsibility block.
- Selection epochs and run versions reject late cross-run responses, old list
  results, and reads superseded by pushed snapshots. Selecting another run clears
  old evidence immediately. Loading, empty, failed and ready states are distinct.
  Optional creation settings no longer gate loading the operating view.
- Cancellation has pending/error handling and applies the returned snapshot
  without stealing a newer selection. Terminal unlaunched roles no longer say
  “awaiting launch”; an unreceipted Conductor is labeled configured, not live.
- The startup safety hold now stops `advanceGauntlet` before worker preparation,
  mailbox delivery or retry consumption. A hold is not a failed worker attempt.

## Actual app evidence

The fixture was created with:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tools/smoke-run-control-fixture.cjs
```

It creates disposable repositories, private profile/Hive, real Git commits and
SQLite transitions. Its Critic report explicitly says that no independent model
ran. It refuses to seed unless the production launch hold is present. No user
profile or repository is copied into it.

Fixture root for this run:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-PXG84d`.
`receipt.json` retains repository and run IDs. The four-line `launch.cjs` sets
Electron's userData and app path and loads the real `out/main/index.js`.

| Boundary / action | Observed result |
| --- | --- |
| Startup → SQLite | Six fixture runs loaded; queued implementation stayed at version 1 under the hold rather than consuming retries |
| Process execution | `window.cth.listPtys()` returned `[]` at startup, after selection/recovery, and before shutdown |
| Initial operator scan | Two attention-needed runs, three active, one closed; failure/escalation appeared before delegated work |
| Repository filter | Ledger showed one attention-needed and one active run; website/side-project records were excluded |
| Selection race | Main-process timing shim delayed run A's actual SQLite response by 600 ms; run B's selected ID and detail remained B after A returned |
| Read failure | A deliberate read error displayed an alert with reload; no stale detail or stale cancel button remained; reload restored the selected record |
| Scoped cancellation | Ledger run `0cc2c2af-c16d-4d02-8ab8-458662c33346` became cancelled version 2; the website acknowledgment remained version 5 and the side project remained orienting |
| Search | `keyboard` matched one run |
| Evidence jump | One click brought the synthetic report, finding and bound artifact/bar identities into the visible detail viewport |
| Navigation | A typed objective survived Office → Runs; the start button remained disabled and the draft toggle exposed its expanded state |
| Page errors | No captured renderer `pageerror` during the tested interactions |

The timing shim existed only in the disposable main process and called the
original SQLite handler. It was never added to application source or a production
IPC channel. A driver reload timeout occurred because reopening the workspace
picker was required; the existing PID was inspected and reattached, not replaced
with a second instance. A later assertion used an overly strict nested-text
locator; direct inspection confirmed cancellation had succeeded before continuing.

## Visual checks

The first actual 1440×870 screenshot exposed a grid intrinsic-height problem:
the sidebar/detail grew to about 972 px inside the available 744 px, hiding the
footer. The fix uses a zero-minimum grid row and bounded independent scroll areas.
Afterward the sidebar was 744 px, the list 391 px, and the footer bottom 853 px
inside the 870 px viewport. Document dimensions matched the viewport.

- [Before: clipped Mac sidebar](assets/2026-09-05/19-run-control-mac.png)
- [After: expanded Mac, 1440×870](assets/2026-09-05/20-run-control-mac-fixed.png)
- [Conductor responsibility, 1920×1080](assets/2026-09-05/21-run-control-1920x1080.png)
- [Exact artifact and Critic evidence](assets/2026-09-05/22-run-control-critic-evidence.png)

All four were visually inspected. This retains the warm pixel headings and
office palette while improving density and hierarchy. It is not a crowded-floor,
mobile, accessibility-compliance or live concurrency acceptance claim. The final
subsequent reducer-only change caps live closed-history updates; the six-record
visual fixture is unchanged by that bound.

## Verification and remaining gates

253 root tests passed with zero skips, including real offline native CLI probes
and nine run-view regressions (including the live closed-history bound).
Main/preload and renderer typechecks and the final Electron build pass.

The app resisted SIGTERM with zero PTYs. Only owned smoke PID 72878 was then
force-terminated; fixture data was retained. This does **not** establish normal
quit behavior. Uninstrumented quit, provider isolation/admission, actual pass and
repair loops, truthful live process health, scheduler capacity and shared quota,
and owner-prioritized cross-project strategy still require acceptance.

“Needs you” currently reflects terminal escalation/failure states. An explicit
durable human resolution/archive workflow is still needed so handled incidents
can leave the attention list without erasing evidence. Do not invent a dismiss
control without an authoritative event model. Likewise, existing capability
labels originate in launch declarations; enforceable provider receipts remain
part of the outstanding execution gate.
