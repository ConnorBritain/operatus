# Dedicated fresh Claude session transport

Date: 2026-09-06. Local process verification only. Global subscription launch hold unchanged.

## What changed

`src/main/claudeFreshSession.ts` adds a dedicated one-shot transport for Implementer, Critic and Repairer. It constructs the outer sandbox, exact `--session-id`, role tool set, private configuration path, exact Critic evidence grant and minimal environment without invoking the legacy PTY launcher. Task text travels through stdin, not process arguments. The caller must already own a verified executable copy, prepared profile, scoped control client, account-checked gateway and current persisted launch.

The runtime retains launch/session/profile claims after failure, rejects reuse and returns a bounded structured process result. Cancellation and timeout signal the detached process group, escalate to SIGKILL, and bound pipe draining. Combined stdout/stderr capture is limited to 1 MiB. Malformed JSON, mismatched session IDs, provider errors and nonzero exits cannot become successful transport completion.

The result explicitly distinguishes observed direct-process exit from descendant quiescence. It never asserts the latter and never deletes a worktree. A successful provider result is not an artifact, a Critic verdict, a Conductor acknowledgment or permission to pass a run.

The transport now takes ownership of a dedicated gateway after launch validation and claiming. Cancel, timeout, output overflow and spawn errors begin gateway revocation immediately; normal exit also revokes before completion is returned. Closure is invoked once, has a two-second confirmation bound, and produces an explicit `gateway_revocation_failed` outcome if it throws, rejects or remains unconfirmed. No otherwise successful process result masks that failure. Active gateway addresses cannot be shared between concurrent launches, including through a copied descriptor. A confirmed close releases the address for later OS port reuse; an unconfirmed close retains the claim.

## Executed evidence

- **43 focused tests passed, zero failures/skips:** the new transport, subscription profiles, outer sandbox, gateway, isolated helper, main-owned commits and exact Git evidence.
- Eleven transport tests use actual local Node fixture processes, an intentionally unclosed fake transport, and the real local gateway with synthetic account/provider transport. They cover exact launch arguments/environment, separate concurrent Critic/Repairer identities, failed/malformed/mismatched output, cancellation, timeout, output bounds, synchronous/asynchronous spawn failure, retained claims, invalid inputs, once-only gateway revocation, failed/stuck closure and cross-launch gateway exclusion.
- The real local gateway test starts an in-flight scripted request, cancels the worker while its deliberately unclosed child transport has not drained, observes immediate request abortion, and confirms subsequent requests cannot connect. No actual provider endpoint or account credential is used. Gateway closure prevents further forwarding; it is not a claim that already accepted remote work can be undone.
- Node/preload and renderer typechecks passed. Electron build and `git diff --check` passed.
- CI now includes the offline transport tests. No credential, account setting, repository branch, deployment or production launch admission was changed.

Latest logs: `/tmp/operatus-session-revocation-all.log`, `/tmp/operatus-session-revocation-types.log`, `/tmp/operatus-session-revocation-build.log`. The earlier 39-test transport-only record remains in `/tmp/operatus-fresh-session-focused.log`.

## Native rerun and scripted repair cycle passed after disk cleanup

The initial native rerun returned **zero passes and one skip** because free disk was below the pinned native copy size plus the existing 256 MiB reserve. Following user-authorized cleanup of unrelated generated build outputs and package caches, the same pinned executable and reserve were used successfully. The Implementer/Critic retest passed with zero skips, then the fixture was extended through native Repairer and fresh re-critique.

The extended native fixture passed in 9.4 seconds: one test, zero failures/skips. It executes the pinned Claude 2.1.263 binary through this transport with scripted local SSE responses and synthetic OAuth, not a live provider. Actual Read/Write/Bash tools commit the first artifact, submit a REVISE report, repair from its exact SHA, commit a new child artifact, and submit a fresh PASS report. Both reports wait for explicit acknowledgment. The harness supplies the two Conductor decisions over the authenticated control socket; no long-lived native Conductor is claimed.

Four distinct persisted worker session IDs match the actual CLI result IDs, with four separate private profiles. Both Critics can read exact review packets and are denied artifact/evidence writes and Conductor impersonation. The frozen digest is unchanged, both artifacts and acknowledgments are persisted, and the source checkout and main branch remain unchanged. The fixture reaches `passed` only after the second scripted acknowledgment.

Evidence: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-tools-SDdh0s/native-tool-receipt.json`. Run `b3d63c12-fc88-4dd6-8af8-88b52188a1a9`; first artifact `0a4a34df9dfe6c8095fb24fcbcf15ca6eaa3d5f2`, repaired child `99bf351b629afc3ff98366c7d27795434c246da8`. The disposable executable copy is removed by fixture teardown; SQLite, worktrees and receipts remain for inspection. Nineteen focused transport/main-commit/control tests also passed with zero skips. `git diff --check` passed. No application source changed in this rerun, and typechecks/build/visual smoke were not repeated.

The [earlier native Critic result](2026-09-06-native-critic-lifecycle.md) remains historical evidence for the prior direct launcher. The new fixture establishes fresh-worker transport compatibility, not production app wiring, real account admission, independent judgment, or a live autonomous loop.

## Open integration gates

This module is not imported by the production main entrypoint. It is not an admission bypass and does not source or refresh account credentials. The caller still owns control-capability revocation, startup verification, escalation of unconfirmed gateway closure and persisted restart reconciliation. Before successful validation/claim, the caller retains gateway ownership and must clean up a rejected preparation. After claiming, the runtime owns closure. In-memory duplicate claims supplement, but cannot replace, database launch authority across restarts.

This fresh-worker adapter deliberately rejects Conductor launches. A subsequent [persistent Conductor transport](2026-09-06-persistent-conductor-transport.md) now verifies three native conversation turns through bar freeze and both repair-cycle acknowledgments with scripted local responses. Production identity binding, app lifecycle composition and restart/resume remain open. Also open: real account/broker composition, live output presentation, actual independent judgment, Codex subscription-credit safety, descendant-aware cleanup, live-model repair/re-critique and concurrent live Gauntlets. Visual/upstream/portal acceptance was not repeated in this transport slice.

A subsequent [main-path ownership pass](2026-09-06-late-launch-ownership.md) added final post-await launch validation and stale-error isolation, and excluded Gauntlet from optional Codex Remote startup. Those production-path fixes do not wire this transport into the main entrypoint or lift the hold.
