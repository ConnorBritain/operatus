# Interrupted-work preservation observations

## Result

An interrupted worker's retained work now has durable, inspectable evidence
without becoming an accepted artifact. The backend records a pending request
before preservation, then appends its outcome: preserved, missing, or failed.
Receipts include the launch, expected SHA, observed SHA and dirty state where
available, candidate branch, worktree location, reason, and request identity.

The SQLite v2 migration preserves existing runs and launches. Replaying the same
receipt is idempotent; conflicting contents are rejected. Finished observations
must match an existing request and its recorded launch. Neither recording a
receipt nor recovering it changes a run's verdict, artifact list, or event history.

Cancellation during a frozen check records the request immediately, waits for
that check to close, and then observes and preserves the captured launch's work.
The desktop receives a fresh snapshot when the outcome arrives. On restart,
unfinished requests are reconciled even if their runs are already terminal.
Missing work is not called preserved. A changed repository path or unexpected
branch fails preservation rather than silently detaching unrelated work.

## Verification

Six new integration tests cover committed and untracked work on cancellation,
missing worktrees, switched branches, terminal-run pending-request recovery,
receipt immutability and launch binding, and v1 migration/future-schema rejection.
The check-cancellation test also verifies pending then finished preservation.

All 286 root tests pass with zero skips, including digest-pinned offline native
provider probes. Main/preload and renderer typechecks, Electron production build,
and `git diff --check` pass.

The compiled Electron app was exercised with disposable real Git/SQLite data
using `tools/smoke-run-control-fixture.cjs` and
`tools/smoke-attempt-branch-ui.cjs`. The fixture manually creates and cancels an
experiment, with an untracked note remaining in the worktree. No AI provider ran.
The actual main-process snapshot contains no accepted artifacts for that run.
The desktop shows its preserved commit, dirty state, branch, path and receipt.
There were no renderer page errors and no PTYs.

- [1440×870 retained-work view](assets/2026-09-05/25-preservation-mac.png)
- [1920×1080 retained-work view](assets/2026-09-05/26-preservation-1080p.png)

Both screenshots were visually inspected. The exact SHA remains readable, long
paths wrap, and expanded receipt details stay within the content column. These
are scrolled detail views, not proof of the complete navigation experience. The
overall Runs surface remains metadata-dense; broader operator hierarchy and
high-volume decision management still need task-based acceptance.

## Limits

- This covers preservation requested for recorded launches. Git worktrees or
  refs created before SQLite records their launch require separate recovery.
- A receipt describes a point-in-time observation. It does not prove later
  filesystem health, prevent owner edits, accept an artifact, or pass a run.
- Pending work is recovered on restart; there is no claim of a transactional
  commit spanning both Git and SQLite.
- Accepted-workspace release fallback and every generic cleanup/reset path
  have not been converted or verified by this slice.
- Active provider process-tree containment, real subscription admission, and
  concurrent live Gauntlet acceptance remain open. The global launch hold stays
  enabled. No live inference, deployment, push, merge or release occurred.
