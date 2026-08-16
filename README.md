<div align="center">

# Operatus

### A local operations floor for conducted AI coding work

Operatus is a local-first operating apparatus for a scalable agent firm. Its core unit of work is an **agent venture**: a deterministic, inspectable Gauntlet loop around real Claude Code and Codex CLI sessions, exact Git commits, independent critique, and bounded repair.

![Operatus operations floor](src/renderer/src/assets/operatus/operatus-operations-floor.png)

<em>Electron · React · TypeScript · Pixi.js · node-pty · SQLite · Git</em>

</div>

## The Gauntlet loop

```text
Conductor freezes an observable bar
  → fresh Implementer creates an exact commit
  → fresh Critic inspects that commit and real checks
  → Conductor explicitly acknowledges the report
  → fresh bounded Repairer creates a new commit when needed
  → fresh re-critique
```

The loop ends as `passed`, `human_required`, `cancelled`, or an explicit infrastructure failure. A worker message or terminal claim is never enough to pass a run.

## What milestone one includes

- SQLite-authoritative runs with append-only events and deterministic restart recovery.
- Immutable SHA-256 quality bars and full 40-character Git artifact identities.
- Fail-closed candidate and detached Critic worktrees; failed work is preserved for inspection.
- Claude Code defaults for Conductor, Implementer, and Repairer; Codex defaults for Critic.
- A pinned [Agent Primitives](https://github.com/ConnorBritain/agent-primitives) registry with exact resolution receipts.
- A configurable Skill Depot, seeded with [mattpocock/skills](https://github.com/mattpocock/skills) at commit `068b6e0c62393147daf03530149cdce209c93da8`.
- A Runs surface showing the contract, phase, exact artifact, checks, findings, acknowledgment, repairs, skills, and events.
- An original, redistributable Operatus operations floor: a warm, light company-floor reskin that preserves the useful floor/terminal interaction model.
- Twelve named branch identities, stored per workspace, so machines and compute locations remain visually distinct at a glance.
- A responsive hosted portal with Supabase identity, branch/machine discovery, one-time pairing, redacted run views, and narrow audited commands.
- Updater and analytics destinations disabled by default until Operatus-owned services exist.

The candidate branch is always left unmerged and unpushed for a human to inspect.

## Requirements

- macOS for the milestone-one development smoke path. The inherited runtime also contains Windows/Linux support, but those packages are not milestone-one acceptance targets.
- Node.js 20 and npm.
- Xcode Command Line Tools (`xcode-select --install`) for native modules.
- Installed and authenticated `claude` and `codex` CLIs for the default role profile.

Operatus uses those existing CLI subscriptions. Optional voice and third-party integrations can require separate API credentials.

## Development

```bash
git clone --recurse-submodules git@github.com:ConnorBritain/operatus.git
cd operatus
npm ci
npm run dev
```

Verification:

```bash
npm run typecheck
npm run test:gauntlet
npm run test:focused
npm run build
npm run check:operatus-assets
```

The app uses a clean Operatus application profile (`com.connorbritain.operatus`) and `operatus://` deep links. Open **Runs** in the command center, choose a local Git repository, enter a bounded objective, optionally assign pinned skills by role, and start the run. The long-lived Conductor receives the orientation request and launches fresh role sessions through an authenticated local socket.

## Trust model

| Authority | Owns |
|---|---|
| SQLite in Electron main | run state, launches, reports, acknowledgments, repair packets, events |
| Git | immutable artifact content |
| Conductor | bar freeze, report acknowledgment, repair synthesis, pass/escalate judgment |
| Implementer / Repairer | one scoped completion receipt for the assigned launch |
| Critic | one report for the assigned bar and exact artifact |
| Renderer | start, observe, cancel, and manage explicit skill choices |

Role commands are schema-validated, size-bounded, and scoped by per-launch tokens. Skills are contextual guidance only; they cannot change the frozen bar, artifact identity, state transitions, or authority.

## Skill Depot

Synchronization is manual and pinned. Operatus never runs a skill repository’s installers or hooks. It rejects path escapes and symlinks, hashes complete skill directories, requires explicit precedence for duplicate names, and materializes the locked result read-only into provider-specific agent homes. See [Skill Depot](docs/SKILL_DEPOT.md).

## Remote venture control

The responsive portal is deployed at [operatus.vercel.app](https://operatus.vercel.app). Supabase identity binds users to workspaces, branches, and paired machines. Each desktop node makes outbound HTTPS requests, publishes a least-information run projection, and revalidates expiring commands against local state and exact run versions. Local SQLite and Git remain authoritative, and there is no exposed shell or inbound daemon port. See the [operations guide](docs/HOSTED_CONTROL_PLANE.md) and [remote floor architecture](docs/architecture/remote-portal.md).

## Architecture and provenance

- [Gauntlet operations guide](docs/GAUNTLET.md)
- [Architecture synthesis](docs/architecture/gauntlet-synthesis.md)
- [Roadmap interoperability](docs/architecture/roadmap-interoperability.md)
- [Hosted control plane operations](docs/HOSTED_CONTROL_PLANE.md)
- [Upstream policy](UPSTREAM.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Visual asset provenance](docs/assets/PROVENANCE.md)

Operatus retains Munder Difflin’s MIT-licensed history and required copyright notice. Restricted upstream visual assets are absent from distributable source and blocked by automated hash/name checks.

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream and dependency notices.
