# Refreshing your local Mac app

The development checkout and the installed app are separate. Refreshing rebuilds
the current checkout and replaces `/Applications/Operatus.app`, without installers,
release uploads, Developer ID signing, notarization, or resetting your profile.
This tool currently supports Apple Silicon Macs only.

## Everyday use

Double-click `~/Applications/Refresh Operatus.command`, or run `npm run app:refresh`
from the Operatus checkout. Install that launcher once with
`npm run app:refresh -- --install-launcher`.

The tool typechecks, builds, packages, and checks native SQLite and terminal support.
If Operatus is open, it leaves the update staged. Finish your work and quit through
the app's normal controls. Run the launcher again to install the verified build
without rebuilding, then reopen Operatus from your existing Dock icon.

An update needs a restart, **not a reset**. There is no hot replacement of running
agent code, no forced quit, and no automatic restart or new agent launch. Avoid
opening the app while the installer is swapping the bundles. A process check runs
immediately before replacement, but this is not an OS-level launch interlock.

Your configuration, logins, worktrees, and run history under
`~/Library/Application Support/operatus` are not moved or deleted. The launcher
never reads credentials. Keep normal backups of this data independently.

## Deliberate source updates

This builds your current local code, including uncommitted changes. It does not
pull, merge, reset, install dependencies, or select a release on your behalf.
Update the checkout deliberately first. Do not edit it or run another build while
preparing an update. If dependencies change, install them and rebuild native modules
using the repository's normal setup before refreshing. Native ABI mismatches stop
the update before replacement.

A prepared build is a snapshot. If more code changes arrive while it is waiting,
install that prepared build first and then refresh again for the newer changes.

## Controls and recovery

| Command | Purpose |
| --- | --- |
| `npm run app:refresh -- --prepare` | Build and verify without installing. |
| `npm run app:refresh -- --apply` | Install the staged build once Operatus is closed. |
| `npm run app:refresh -- --rollback` | Swap back to the recorded previous app, while closed. |

Builds, receipts, and previous versions are kept in
`/Applications/.operatus-local-updates`. No backup is automatically deleted.
Allow at least 2 GiB free before preparing a build; retained versions use roughly
500 MB each and can be reviewed for cleanup later. Failed builds remain there for
inspection. A concurrent refresh is rejected. After an interrupted refresh, inspect
`refresh.lock/owner.json` and confirm that its process has exited before removing
that lock directory. Do not clear it while another refresh is running.

Rollback restores the application only, **not database migrations**. If a newer
app has already migrated your data incompatibly, ask for recovery help before
running older code. A normal replacement failure restores the old bundle; an OS
crash between the two renames may require restoring the retained `previous-*.app`
manually. Nothing removes the previous application automatically.

The double-click launcher uses your current Node installation and source path.
Recreate it after moving the checkout or removing that Node version. It opens a
Terminal window for progress and errors; it is not a background daemon.

This is separate from the app's release updater. Published, signed releases can
use the existing release-update path later. This local tool never enables it or
disables macOS security checks.
