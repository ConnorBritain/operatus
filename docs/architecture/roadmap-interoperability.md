# Roadmap interoperability

Ventura milestone one implements `LocalGauntletBackend`. Its authority is transactional SQLite and exact local Git commits. A future `RoadmapGauntletBackend` will implement the same domain operations while delegating authority, actor identity, and idempotency to Roadmap and GitHub.

## Canonical operations

| Ventura backend method | Protocol operation | Roadmap mapping direction |
|---|---|---|
| `start` | `gauntlet_start` | create/bind a Roadmap run and protected artifact context |
| `status` | `gauntlet_status` | reconcile the authoritative Roadmap ledger and GitHub artifact |
| `submitCritic` | `gauntlet_critic` | submit a report bound to exact commit and bar digest |
| `acknowledge` | `gauntlet_ack` | persist lead finding partition and decision |
| `requestRepair` / repair launch | `gauntlet_repair` | issue a bounded packet against expected artifact |
| `cancel` | `gauntlet_cancel` | append terminal cancellation with actor identity |

The shared vocabulary—run, frozen bar, artifact, report, acknowledgment, repair, escalation—must not vary by backend. Backend-specific receipts are namespaced and shown alongside the common identities.

## Local/remote differences

Local mode does not emulate GitHub comments, pull-request markers, protected-ref claims, actor checks, or tombstones. SQLite uniqueness constraints and run versions provide local idempotency; role tokens provide scoped actor authority; Git commits provide content identity. Roadmap mode must use Roadmap's native claims and GitHub authority rather than treating the local database as a competing source of truth.

Provider execution is orthogonal to backend authority. A future hybrid run may launch a local PTY or a remote Roadmap worker, but every result must still bind the backend's expected full commit SHA and frozen-bar digest. Renderer snapshots remain backend-neutral.

## Compatibility invariants

- No backend may accept a stale report or allow a builder to acknowledge itself.
- Repair always starts from the exact expected artifact and produces a new artifact.
- Every changed artifact gets a fresh Critic session.
- Workers never merge or push unless a separately authorized backend operation says so.
- Backend migration never rewrites historical receipts; it begins a new namespaced run or records an explicit handoff event.

Roadmap-backed and hybrid execution are intentionally outside milestone one. This document fixes the seam without pretending the remote authority has already been implemented.
