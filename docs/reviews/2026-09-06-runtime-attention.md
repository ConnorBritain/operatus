# Runtime warnings in the operator queue

Date: 2026-09-06. Release hold remains enabled; no real provider credentials or inference used.

## Behavior

Execution diagnostics and artifact verdicts are separate. A passed run with a failed/unconfirmed process shutdown must still reach the owner. Runtime warnings now include failed Conductor deliveries, unknown exits after restart, unconfirmed process exits/gateway revocation and abnormal exit outcomes. Ordinary confirmed cancellation is not a warning by itself.

SQLite produces a journal revision and warning sequence/count on reads, independently of the protocol version. The operator query retains every unresolved warning, even beyond its 100-run closed-history limit. It uses an indexed run/sequence journal lookup. Renderer ordering, filtering, responsibility and evidence reloads account for runtime revisions; late same-protocol-version responses cannot erase newer diagnostics.

Stopped runs with runtime warnings can be reviewed without changing the verdict, bar, artifacts or acknowledgments. Review notes record the exact warning sequence. The transaction rejects stale protocol versions and warning sequences. A newer warning reopens attention even when a previous review was saved. Active runs cannot be dismissed as stopped. Draft review notes bind to the evidence present when edited, so a push during typing requires inspection and an updated note before submission.

## Executed evidence

- 36 focused tests passed with zero skips, including isolated concurrency/lifecycle, operator review, run view, journal and five new runtime-attention checks. After the indexed aggregate projection change, all 26 queue/view/journal tests passed again.
- SQL queue classification is checked against the shared classifier for successful exit, finish, expected cancellation, unknown/nonzero exit, lost revocation, timeout, failed/successful delivery and interrupted recovery beyond the history cutoff.
- Two native assembled scripted loops passed with zero skips in 22.4 seconds. Both used the pinned Claude CLI, real private profiles/sandbox, gateways, helper/socket, SQLite and Git. Account metadata and model responses were synthetic. Each produced five distinct session identities, two artifacts and explicit repair/pass acknowledgments.
- Clean native run: `a0e4be5a-016a-4272-890f-3e52768e4964`, retained root `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-73I3T1`.
- Failure-injection run: `ddd6e324-8def-452c-95db-33c08cbf8dbd`, retained root `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-sPzhDL`. The gateway actually closed; the test then threw to simulate lost shutdown confirmation. The native runtime recorded revocation failure, the run stayed passed and appeared in operator attention. Review cleared attention without changing artifacts/acknowledgments; a second human event reopened it for visual inspection. `receipt.json` retains the pre-review snapshot; SQLite retains both review events.
- Test-only native executable copies were removed by fixture cleanup. Git, SQLite, packets and receipts remain.
- Main/preload and renderer typechecks and the Electron build passed; existing Vite mixed static/dynamic import warnings remain. `git diff --check` passed. CI includes the new regression suite, but no remote CI execution is claimed.

## Native desktop verification

Used the computer-use skill to open the compiled app with a disposable backup of the failure-injection database, navigate through its harness picker to Runs, filter Needs you and save a diagnostic review. Before review, Needs you was 1 and the run's phase remained passed. After review, Needs you was 0, Recent closed was 1 and the selected evidence stayed visible with an explicit outside-filter notice. Responsibility returned to reviewing the unmerged candidate, not an automatic merge or restart.

After normal app quit, a read-only SQLite check confirmed phase passed, version 15, reviewed warning sequence 16, and byte-identical artifact/acknowledgment records versus the source fixture. This tests the actual renderer, preload IPC, main review command and persistence path. It is not a real-model or live multi-run visual smoke.

Captured window size: 1272×768. Retained fixture root `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-y7z6FT`; screenshots `runtime-needs-you.jpeg` and `runtime-reviewed.jpeg`. No new 1920×1080 or expanded-Mac acceptance is claimed by this pass. The dense session evidence and lack of live output/sprite integration still need work.

This does not prove real independent judgments, live non-PTY output/sprite visualization, subscription-credit safety or routine multi-project operation. Those acceptance gates stay open.
