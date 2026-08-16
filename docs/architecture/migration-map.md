# Munder-to-Ventura migration map

| Concern | Reused runtime | Ventura boundary | Authority after migration |
|---|---|---|---|
| CLI processes | node-pty, provider discovery, terminal streaming | role launch adapter and fresh session identity | provider process plus Gauntlet launch record |
| Git work | existing inspection/diff UI | fail-closed `ArtifactWorkspace`; no shared-checkout fallback | exact full Git commit |
| Agent coordination | Hive homes, mailbox, memory, hooks | collaboration only; no completion authority | SQLite state machine |
| Persistence | better-sqlite3 dependency | dedicated WAL/FULL `gauntlet.db`, migrations, transactions | Electron main single writer |
| Review | provider terminals | detached Critic worktree plus typed primitive receipts | report bound to artifact/bar |
| Lead judgment | long-lived orchestrator | explicit persisted acknowledgment and repair packet | Conductor token/launch |
| Skills | inherited per-agent homes | pinned Skill Depot, role lock, read-only materialization | immutable skill receipt |
| Renderer | React/Zustand command center | Runs snapshots/events; secured IPC | projection only |
| Floor | Pixi movement and stations | original Ventura map, neutral procedural sprites, run zones | projection only |
| Product profile | inherited Electron shell | new app ID, data namespace, deep link, updater/analytics defaults | Ventura-owned configuration |
| Remote access | inherited provider-specific remote features | transport-neutral redacted projection | local node remains authority |

Legacy low-level file names and internal CSS/IPC identifiers may remain where they are not user-visible and changing them would destabilize reusable runtime code. Parody-specific product content, restricted visual assets, upstream update/analytics destinations, and user-visible Office character identities do not cross the distributable boundary.

Upstream changes are merged deliberately through `upstream`; conflicts touching exact-artifact, frozen-bar, acknowledgment, or worktree safety invariants require an explicit architectural review.
