# Hook socket restart on long macOS paths

Date: 2026-09-06. No provider inference, account changes or release-hold changes.

## Cause and fix

The reopened native-evidence profile produced a 108-byte `.../harness/hive/hooks.sock` path. Inspection found the actual socket named `hooks.` instead. The old startup/shutdown code removed the full, nonexistent name, leaving the truncated endpoint for the next bind. The same code also unconditionally removed any existing intended socket path without checking ownership.

POSIX hook endpoints now live under a verified user-owned mode-0700 `/tmp/operatus-hooks-<uid>` directory. A digest of the home and a random per-Hive-instance scope gives a short path stable during that instance's lifetime, but different after restart. A long or multibyte home no longer lengthens the endpoint. Provider hook shims receive that exact path through the existing `HIVE_SOCK` wiring. Windows keeps its previous per-root named-pipe mapping; Windows hardware operation is not demonstrated here.

Hook start/stop is serialized. Startup refuses existing endpoints, including dangling symlinks and regular files; it does not remove or follow them. Shutdown closes the server it actually opened, destroys its partial clients, awaits close, and clears home-bound cached context. It does not look up a newly selected home and delete that home's socket. Main shutdown and home-change teardown await hook shutdown.

The random endpoint avoids reclaiming crash leftovers. It does not authorize scanning/removing other endpoints, sharing a Hive between multiple writers, resuming orphaned workers, or automatic cleanup of old socket files. Existing external clients must receive the current endpoint on relaunch. This is lifecycle isolation, not new authentication for the legacy hook protocol; Gauntlet authority still belongs to its separate scoped control service.

## Verification

- 19 focused checks passed, zero skips: repeated serialized lifecycle, deep/multibyte paths, live peer preservation, foreign file/symlink preservation, partial-client drain, changed-home safety, existing roster behavior, final-quit barrier, and the actual hook shim with no Node on PATH.
- Node/preload and web typechecks, Electron build and `git diff --check` passed. CI now includes the hook lifecycle suite; no remote CI run is claimed.
- Using the computer-use skill, launched the rebuilt actual Mac app twice against the same disposable profile that had failed, opened its harness, navigated to Runs and quit normally each time. The old truncated socket was deliberately retained.
- First process PID 98744 owned `/tmp/operatus-hooks-503/e63d0c9f741074c9525827999b4e7c27.sock`; second PID 2205 owned `/tmp/operatus-hooks-503/d4befa3d384b9c4176f68951b5c98ea5.sock`. `lsof` verified each ownership, an actual `{}` newline hook request returned `{}` on each, and each endpoint was absent after its owner's normal exit. Both exit codes were 0; neither launch emitted a hook startup/bind error.
- Evidence profile: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-xu5kkx`. Retained screenshots: `hooks-restart-first.jpeg`, `hooks-restart-second.jpeg`. Runs continued to show the original scripted candidate evidence and the subscription safety hold.

This closes the observed hook endpoint restart defect, not full provider/process recovery or live multi-Gauntlet acceptance. No new viewport or real-model acceptance is claimed.
