# Attempt-branch recovery and operator inspection

## Result

New worker attempts now use separate, recorded candidate branches. A retry
can start from its authoritative SHA even when an interrupted worker already
committed. The abandoned branch and worktree remain intact; no ref reset,
merge, push, or automatic deletion is involved.

The [attempt-branch ADR](../architecture/adr-gauntlet-attempt-branches.md)
defines the compatibility and ownership rules. The latest recorded artifact's
branch, not an inferred run-level ref, is the candidate to inspect or integrate.

## Verification story

An operator selects a run in Runs, inspects its launch and exact artifact,
and sees the branch actually persisted with those records. That branch must
correspond to the independently isolated worker attempt.

| Boundary | Evidence |
| --- | --- |
| Git attempt creation | New branch at exact expected SHA; collisions rejected even at matching SHA |
| Completion validation | Assigned branch, clean content and expected ancestry required; switched ref/detached HEAD rejected |
| SQLite launch/artifact | `candidateBranch` survives restart; resulting artifact records its actual branch |
| Retry execution | Restarted implementation uses original base; retried repair uses acknowledged prior artifact, not abandoned repair commit |
| Legacy data | Old JSON launches without the new field complete or retry without resetting their legacy ref |
| Main/preload/UI | Real compiled Electron run selection renders the branch returned through `gauntletGet` |
| Viewports | Captured and inspected at 1440×870 and 1920×1080; branch value within viewport; no page errors |

Six new tests in `test/gauntlet-attempt-branches.test.cjs` cover these Git and
storage boundaries. The prior check-cancellation test now verifies that retry
preparation succeeds on a new branch after draining, while the abandoned ref
still points at its unrecorded commit. The full existing implementation,
repair, critique and acknowledgment protocol test still passes.

All 273 root tests pass with zero skips, including explicit pinned offline
provider probes. Main/preload and renderer typechecks, Electron production
build, and `git diff --check` pass.

## Desktop evidence

The verification skill guided the full local data path, not just a screenshot.
This was compiled Electron, not a web dev server: Playwright drove the actual
desktop window, its preload API and main-process SQLite backend.

Fixture root:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-3U9Soz`.
The fixture contains actual disposable Git/SQLite state and explicitly
synthetic Critic reports. No provider ran. PTY list remained empty; the app
closed successfully after inspection. The helper disables protocol registration
and does not reuse the user's profile or copy credentials.

Screenshots, both visually inspected:

- [Mac branch inspection](assets/2026-09-05/23-attempt-branch-mac.png)
- [1920×1080 branch inspection](assets/2026-09-05/24-attempt-branch-1080p.png)

The inspector remains metadata-dense; these captures verify branch
inspectability and bounded layout, not the entire owner-operator information
hierarchy or a live multi-Gauntlet operating experience.

Reproduce after build by generating data with
`ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tools/smoke-run-control-fixture.cjs`,
then running `node tools/smoke-attempt-branch-ui.cjs <fixture-root> <installed-playwright-path>`.

## Remaining gates and newly identified issue

Follow-up: [repair retry-budget verification](2026-09-06-repair-retry-budget.md)
resolves the transport-versus-repair accounting issue described below. Other
preservation, orphan-recovery and live-provider gates remain open.

- `REPAIR_LAUNCHED` currently increments `repairRound` even when relaunching
  after a retryable infrastructure failure. The branch recovery test proves
  correct starting SHA, not correct repair-budget accounting. Transport retry
  must remain separately bounded without consuming another repair round.
- Retained refs and launch metadata preserve discoverability. A separate
  durable preservation receipt containing the observed abandoned SHA and
  cleanup outcome is still needed; branch refs can later be moved by a human.
- Git creation and SQLite launch recording are not a cross-store transaction.
  Crash recovery must account for orphan attempt refs/worktrees created before
  the launch row commits. The current policy retains rather than deletes them.
- Live provider execution, subscription-only containment, and full concurrent
  Gauntlet acceptance remain open. No launch safeguard was relaxed.
