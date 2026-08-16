# Milestone-one acceptance record

This record distinguishes shipped milestone-one behavior from deliberately
sequenced roadmap work. It is an engineering receipt, not a claim that every
future Operatus surface is already delivered.

## Accepted milestone behavior

| Requirement | Evidence in this repository |
|---|---|
| History-preserving fork and provenance | `upstream` policy, MIT license preservation, `UPSTREAM.md`, `THIRD_PARTY_NOTICES.md`, and source-synthesis records |
| Frozen observable bar | immutable normalized contract plus SHA-256 digest in `src/main/gauntlet/core.ts` |
| Exact Git artifacts | full-SHA validation, strict candidate/critic worktrees, clean-commit enforcement, and no shared-checkout fallback |
| Independent conducted loop | long-lived Conductor; fresh Implementer, Critic, and Repairer session identities; explicit acknowledgment before pass or repair |
| Bounded convergence | configurable validated time/repair/retry budgets with explicit `human_required`, `cancelled`, and infrastructure-failure outcomes |
| Durable authority | transactional SQLite schema, migrations, unique launch/report records, append-only events, version checks, and restart reconciliation |
| Agent Primitives | clean pinned submodule, validated registry resolution, local override, and per-launch primitive receipts |
| Skill Depot | manually synchronized pinned sources, Matt Pocock baseline, opt-in content, collision handling, digest locks, read-only materialization, and no install-script execution |
| Observable desktop | Runs surface, exact artifacts/checks/findings/acknowledgments/repairs, role terminals, and floor projection |
| Product and art independence | Operatus application profile, easel identity, original operations-floor assets, provenance inventory, and forbidden-name/hash guard |
| Branch identity | twelve accessible built-in themes with a per-workspace name and persistent visual marker |
| Verification | Gauntlet unit/integration suite, retained-runtime focused suite, node/web typechecks, production build, asset guard, macOS package, and packaged launch smoke |

The protocol suite covers legal and stale transitions, exact artifact ancestry,
wrong SHA, dirty and mutated worktrees, frozen-check timeouts, critic mutation,
fresh repair/re-critique, retry exhaustion, overall timeout, cancellation,
restart recovery, explicit human escalation, Skill Depot safety, and branch-theme
identity. CI repeats the source-level verification and unsigned macOS build.

## Deliberately deferred

- Signing, notarization, release publishing, and merging candidate run branches.
- A Roadmap/GitHub authority backend and hybrid local/remote execution.
- The remote daemon, browser/PWA client, pairing, push delivery, and the
  Tailscale Serve setup flow. Their trust and transport seams are specified in
  `remote-portal.md`; milestone one keeps all run authority local.
- Windows installer acceptance and continuous Windows smoke coverage. Core
  socket, path, check-shell, and process-tree seams are cross-platform, but the
  release artifact has not yet been certified on Windows hardware.
- Signed skin/module manifests, avatar construction, commercial entitlements,
  and hosted multi-user identity.

These deferred items may add surfaces or transports, but must not weaken the
frozen contract, exact artifact identity, role authority, or local audit trail.
