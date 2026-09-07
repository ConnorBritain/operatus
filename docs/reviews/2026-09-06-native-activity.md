# Native activity and readable session evidence

Date: 2026-09-06. Subscription launch hold unchanged. This is native transport and reopened desktop evidence, not real-provider acceptance.

## Implemented

Fresh Claude workers now use bounded NDJSON output, as the persistent Conductor already does. Both project exact-session tool requests/results into a closed vocabulary: reading, searching, editing, executing, or other tool activity. Main generates ordinals, deduplicates provider tool IDs internally, and records launch/session-bound observations in SQLite. Commands, arguments, paths, model prose, raw tool names/IDs and tool output are excluded from this feed.

A tool request is labeled `requested`, not proof that execution began. A correlated result is labeled `result` with its reported outcome. Neither advances the bar, artifact, verdict or acknowledgment. Ordinary tool errors are not automatically operator escalations. Native transport failures retain their separate attention path. Observer state and the journal remain bounded; persistence failure is not silently discarded.

The latest observation appears under each role session. Activity history and session identities/safeguards are expandable. Runtime warnings stay outside collapsed details. The role overview now shows recorded process observations rather than presenting the Conductor's persistent protocol `created` status as process state. Its detailed protocol label is `Authority registered`.

## Executed verification

- 58 focused checks passed, zero skips: activity privacy/correlation/bounds; fresh/persistent streams and teardown; isolated concurrent runner ownership; runtime journal/attention; and view reconciliation. Added real Node pipe tests for NDJSON split across chunks, final-result compatibility, duplicate results and post-result events.
- Two assembled native scripted repair loops passed, zero skips, in 21.1 seconds. Each used five actual pinned Claude CLI processes and 24 local scripted provider responses, producing two exact artifacts and two explicit acknowledgments. All five launches published activity before their process-exit observation. Each journal contains 34 activity observations plus 16 lifecycle/delivery observations.
- Clean run `57558c41-6ab9-4782-81be-066fba78e402`: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-S4p6tE/receipt.json`.
- Injected final gateway-close reporting failure run `2694c0bf-1e28-4c4e-a0e2-ce40fc250c38`: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-LrDmDH/receipt.json`. The fixture actually closes the gateway before simulating lost confirmation. Its warning remains separate from the scripted artifact verdict.
- Main/preload and renderer typechecks, Electron build and `git diff --check` passed. Existing Vite import/chunk warnings remain. CI includes activity tests; remote CI was not run.

## Desktop inspection

Using the computer-use skill, opened the compiled app with a disposable copy of the clean native journal, navigated to Runs, inspected recent activity, expanded session identity and Conductor activity, and quit normally. At the observed 1272×768 screenshot size, collapsed session rows expose several roles without their full UUIDs/branches overwhelming the viewport. Expanded details retain exact identity, safeguard qualifications and denied peer-read results. The selected run/repository and operator next step stay pinned while scrolling.

Evidence root: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-xu5kkx` with `activity-before.jpeg`, `activity-summary.jpeg`, and `activity-details.jpeg`. This was reopened evidence; live activity delivery was demonstrated in the native integration test, not a live-model GUI run. No new 1920×1080 acceptance is claimed.

Restarting this disposable profile emitted a Hive `hooks.sock` EADDRINUSE error, although Runs loaded and the process later quit normally. Cause remains unconfirmed. Treat hook socket restart/ownership as an open local-startup defect; do not delete socket paths blindly or call restart fully accepted.

Follow-up: the socket path truncation cause and bounded fix are now verified in [hook socket restart](2026-09-06-hook-socket-restart.md). The statement above records the original observation, not the current status of that specific defect.

## Still required for the pilot

Real subscription-safe Claude/Codex judgment, durable admission receipts, full useful native output inspection, floor role/activity integration, locked skill materialization, capacity/storage handling, and live concurrent operator acceptance remain open. Fresh worker verbose output currently shares the existing 1 MiB aggregate stdout/stderr ceiling; substantial-project output volume needs explicit acceptance, not an unbounded buffer. This activity feed is an observability layer, not a substitute for evidence, safe execution, or the full requested product.
