# Inspecting interrupted preparation

Date: 2026-09-06. A read-only recovery diagnostic, not automatic recovery.

The pending-preparation detail panel now has an explicit inspection action. Main
accepts only the local desktop main frame and resolves the run/launch IDs to its
own pending record; the renderer cannot supply a filesystem path. Duplicate
inspections and more than two simultaneous inspections are rejected.

The inspector checks ancestors without following static symlinks, including
dangling links. It validates the linked-worktree metadata location, common Git
directory and backlink before running the macOS Git executable. Git has no
network/write capability, a clean environment, disabled hooks/filesystem monitor,
no optional locks, bounded output and per-command timeouts. It returns only
diagnostic status, exact observed SHA/branch, dirty state and evidence-parent
presence. Provider credentials, stderr and file contents are not returned.

The UI distinguishes missing, redirected, matching, changed, foreign-repository
and unavailable results. A matching result means the observed commit/branch and
non-submodule status matched this preparation; it is not a check/test result,
artifact acceptance, cleanup permit or proof that files cannot subsequently
change. Evidence-parent presence does not validate the packet contents.

## Demonstrated

Six tests in `test/gauntlet-preparation-inspection.test.cjs` passed on macOS:

- Absent directories and dangling/ancestor symlinks.
- Real matching worktree, dirty changes, new commit and detached branch.
- Foreign Git pointer refused before inspection.
- Repository filesystem-monitor command does not execute; index unchanged.
- Detached Critic and evidence-parent presence inspected separately.
- Foreign renderer/frame and unknown preparation rejected.

Final focused batch: 27 tests passed, zero failures/skips, covering inspection,
preparation durability, both forced-crash cases and renderer run-state projection.
Node/web typechecks, Electron production build and `git diff --check` passed.
The build's existing mixed-import warning and large renderer bundle remain.

The inspector also read the actual pending records from the preceding forced
SIGKILL fixtures, using readonly SQLite connections. Both workspaces still matched:

| Retained fixture | Launch | Observed SHA | Branch/dirty |
| --- | --- | --- | --- |
| `op-prelaunch-orphan-95flhe` | `c12b7008-a652-4319-ad09-472b92036ba6` | `0319d74eae28ab6f8c46a69c949fc49ea782744b` | Assigned attempt branch, clean |
| `op-prelaunch-orphan-Rp8Bol` | `cdbeead2-e106-4f77-804b-cf4ada15e7b1` | `a2be2f528495f33d8fa549f325c92da46537306e` | Detached, clean; evidence parent present |

Parent: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.
Observations at Unix milliseconds 1788731906777 and 1788731906852 respectively.

## Still not accepted

The result is transient and timestamped, not a new persisted authority receipt.
It does not clear pending preparation, restart a run, delete files or modify Git.
Explicit durable resolution, legacy orphan discovery and a ref-only crash remain
open. Static path checks and post-read validation do not constitute race-proof
filesystem capability ownership; no destructive action may rely on this result.
Submodule changes and evidence contents are not inspected. Windows/Linux return
unavailable for Git inspection rather than weakening the macOS boundary.

Computer Use reported the Mac locked in this pass. No actual visual acceptance
is claimed for the new button or panel. The subscription hold remains enabled.
