# Native runtime evidence in Runs

Date: 2026-09-06. Global subscription launch hold unchanged. No real inference, account-setting change, deployment, release, merge or push.

## Implemented

Protocol schema v4 adds an append-only runtime observation API/table with exact run, launch and session identity. Process starts retain actual PID, model and profile/boundary digests; exits retain observed process exit, exit code, termination reason and gateway revocation. Conductor deliveries retain message identity, purpose, report association and prompt/result digests, not raw prompts, output or credentials. Duplicate observations are idempotent only when identical. Unknown fields, identity mismatches and unsupported values are rejected.

Observations do not advance protocol state or change a frozen bar, artifact or verdict. A completed conversation turn is not a Conductor acknowledgment. Missing exit observations after restart remain explicitly unknown; saved PIDs are not permission to resume or kill a process. Descendant quiescence remains unverified. Abnormal exits can be recorded after a terminal decision without silently rewriting it.

The isolated runner records these observations and awaits native teardown before releasing lifecycle ownership. Runs now separates protocol status from native observations and exposes the Conductor's orientation and acknowledgment deliveries. Account admission receipts and native streaming output are not included yet.

## Executed checks

- 21 focused journal, isolated-runner and preservation tests passed with zero skips. Journal tests cover reopen persistence, immutability/idempotency, identity mismatch, raw-output rejection, queued-delivery causation, unknown restart exits and post-terminal failure evidence. The runner covers two concurrent scripted loops.
- Node/main and web typechecks and Electron build passed. Existing Vite mixed static/dynamic import warnings remain.
- The assembled native fixture passed in 11.1 seconds with zero skips: real pinned Claude processes, private profiles, Seatbelt boundaries, local gateways/socket/helper, Git and SQLite; account metadata and provider responses were synthetic. This is not real-model judgment acceptance.
- Run `3f518c21-353f-40ec-9797-30d964be5846`, retained root `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-zGTdCO`, evidence `receipt.json`: five starts, five exits, three queued deliveries and three results. One persistent Conductor and four fresh workers produced implementation, critique, repair, fresh critique and explicit acknowledgments. The disposable native executable copy was removed; evidence remains.
- CI now includes the journal regression suite; this is configuration, not a claim of a remote CI run.

## Actual GUI inspection

Opened the compiled Electron application with a disposable backup of the completed native database, using the actual harness picker and Runs navigation. At the captured 1272×768 window size, the run list and selected-run context stayed visible while scrolling the evidence pane. Native exit rows were readable; expanding Conductor deliveries showed orientation plus two acknowledgment turns with exact message/report/digest identities. This demonstrates persisted evidence inspection after reopening, not live process visualization or a fresh 1920×1080 acceptance pass.

Retained visual fixture: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-eGSFIP`, including `native-role-sessions.jpeg` and `conductor-deliveries.jpeg`. Screenshots contain scripted fixture data only.

The evidence section is still dense. The Conductor's historical protocol `created` label alongside an observed clean exit is technically distinct but not yet ideal operator language. Native output/sprite projection, progressive disclosure of session details, global attention for abnormal runtime exits and live multi-run operator acceptance remain open. Do not equate this pass with routine local readiness or lift the billing hold.
