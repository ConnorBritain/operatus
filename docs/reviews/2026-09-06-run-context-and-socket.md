# Persistent run context and a native startup defect

## Operator flow

Story: select a run from the main-process SQLite projection, inspect deep
evidence, filter the list, and switch projects without losing or confusing
the selected objective and repository.

Earlier screenshots showed the objective and project scrolling out of view.
The evidence column now has a persistent context header with run identity,
objective, repository, protocol phase and next responsibility. Its Overview
button returns to the complete summary. Long objectives truncate in this
compact header with their full text available by title and in the overview.
Repository paths can wrap to two lines, with the full path also in the title
and overview. No new authority or process-health assertion is introduced.

Filtering does not silently select another run. If the selected run is outside
the filters, the header says so. Selecting a different run resets the evidence
scroll area, rather than showing the new project's evidence halfway down the
previous project's scroll position. The Skill Depot does not inherit a run header.
Existing selection-epoch and version guards still bind the header and evidence
to the same main-process snapshot.

## First broken boundary: native control startup

The first compiled-desktop verification stopped before run selection: the UI
reported `Gauntlet backend is not ready`. The profile still contained seven
runs, and directly opening its backend succeeded. Inspection found a socket
named `gau` where the requested filename was `gauntlet.sock`; the full requested
path was 114 bytes. This is consistent with Unix socket path truncation, leaving
a socket that cleanup addressed by the original full path did not remove.
The repeated desktop attempt confirmed the same unavailable-backend state.

Unix endpoints now use a newly allocated private temporary directory per server
lifetime and a short socket name. Path selection stays within a conservative
100-byte bound, using `/tmp` when the configured temporary root is too long.
The directory is mode 0700 and the socket is mode 0600. Failure to apply socket
permissions fails startup instead of being ignored. There is no shared-name
unlink before listening. On close, only the server's own empty directory is
removed non-recursively; unexpected contents are retained. Windows retains
its existing named-pipe transport and is not verified by this Mac test.

The main process also closes its opened backend if control startup fails.
Tokens stay in the profile, while launched workers receive the current runtime
endpoint through the existing launch packet. A runtime endpoint is not a durable
Branch identity. Pre-existing truncated sockets were left untouched.

## Evidence

The added regression test opens listeners under a deliberately long profile
path, checks endpoint lengths and permissions, closes one listener while another
remains reachable, and starts a fresh listener against the same profile.
All six control-drain tests pass. All 287 root tests pass with zero skips,
including explicit digest-pinned offline native provider probes. Main/preload
and renderer typechecks, Electron production build and `git diff --check` pass.

After the fix, `tools/smoke-run-context-ui.cjs` successfully exercises the actual
compiled Electron application using the same previously failing disposable
profile. Its SQLite/Git data are real, but the run reports are synthetic and
no Claude or Codex session runs. The test checks:

- Snapshot-bound objective, full repository and Conductor responsibility.
- Unchanged header bounds while the evidence scroll position moves over 100px.
- Filter mismatch labeling without changing the selected run.
- Overview returning the evidence scroll position to zero.
- Cross-project switching replacing both header and detail and resetting scroll.
- Skill Depot hiding the run header and restoring it on return.
- No page errors, no document-level horizontal overflow, and no PTYs.

The context header was approximately 118px high at both viewports, leaving
626px and 856px respectively for evidence. Both screenshots were visually
inspected: the selected objective, project, phase and responsibility remain
visible above the scrolled retained-work evidence.

- [1440×870](assets/2026-09-05/27-run-context-mac.png)
- [1920×1080](assets/2026-09-05/28-run-context-1080p.png)

## Limits

This is a demonstrated local navigation improvement and startup fix, not
acceptance of live provider execution, arbitrary-volume operating clarity,
keyboard/zoom accessibility, mobile layout, or active-provider shutdown.
The Runs surface remains metadata-dense and needs broader task-based hierarchy
testing. The subscription-only launch hold remains enabled. No paid inference,
deployment, push, merge or release occurred.
