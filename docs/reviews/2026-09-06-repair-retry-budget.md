# Repair rounds versus infrastructure retries

## Result

A retryable Repairer failure now permits a fresh launch of the same repair
round, including the last permitted round. It does not increment or reset
`repairRound`. The independent, run-level `infrastructureRetries` counter is
still charged when the retry is granted and remains bounded by its configured
limit. Another substantive repair requested after fresh critique still
consumes a new round or escalates when the repair limit is reached.

Previously every `REPAIR_LAUNCHED` incremented the repair round. That prevented
relaunch at the last round and charged transport failures as additional
substantive repairs.

## State and compatibility

The state machine records `pendingRepairRetry` only when it grants a retryable
failure from `repair_in_flight`. It binds the failed launch ID, exact artifact
SHA, and already-counted round. The next launch must use a fresh identity and
the same artifact/round, then consumes the marker. Every other legal transition
clears it. No renderer command can supply this state to grant an attempt.

SQLite persists the marker in its transactional run snapshot. For an older
snapshot without the field that is already waiting for a repair retry, the
reader derives it only from matching adjacent `REPAIR_LAUNCHED` and retryable
`INFRASTRUCTURE_FAILED` events at the current version, plus the matching failed
or timed-out Repairer launch record. Missing or mismatched evidence grants no
retry. The next transition persists the normalized state. Historical event
rows and previously consumed counters are not rewritten.

Known-invalid worker transitions are now checked before creating a Git branch
or worktree. SQLite repeats the validation transactionally when recording the
launch. This prevents a rejected budget request from creating an orphan ref;
it does not eliminate the separate crash window between Git creation and
SQLite recording.

## Verification

Seven tests in `test/gauntlet-repair-budget.test.cjs` cover:

- Relaunch on repair round 1 of 1, without increasing the round.
- A later genuine repair consuming round 2 when allowed, and escalation at
  the substantive repair limit.
- Infrastructure retry exhaustion and the zero-retries configuration.
- Fresh launch identity, exact SHA, matching round, and clearing the retry
  on cancellation or escalation.
- Real Git/SQLite recovery across reopen with both current and legacy
  snapshots, followed by a fresh Repairer, new artifact, fresh Critic report,
  and explicit Conductor acknowledgment before `passed`.
- Legacy history without matching evidence failing closed, without creating
  another candidate ref.

The integration cases use disposable repositories and manually supplied
protocol reports, not live Claude/Codex reasoning. They prove budget and
authority transitions, fresh session/branch identity, and persisted recovery.
They do not prove provider-session execution, critique quality, or the full
owner-operator experience.

Final verification: all 280 root tests pass with zero skips, including explicit
digest-pinned offline provider probes. Main/preload and renderer typechecks,
Electron production build, and `git diff --check` pass. No live AI session,
paid inference, deployment, merge, push, signing or release was performed.

## Still outstanding

The global subscription launch hold remains enabled. Live provider admission
and containment, full concurrent live Gauntlets, durable preservation receipts,
Git/SQLite orphan recovery, and broader operator UX acceptance remain open.
Older runs that already over-counted earlier retries are not silently repaired;
this compatibility path handles only a provable pending retry.

Follow-up: [durable preservation observations](2026-09-06-preservation-receipts.md)
are now implemented and inspected in the desktop. Pre-recording Git/SQLite orphan
recovery and the other acceptance limitations above remain open.
