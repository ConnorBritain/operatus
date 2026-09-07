# Durable preparation inventory

Date: 2026-09-06. This supersedes the missing-inventory behavior reproduced in
[the earlier diagnostic](2026-09-06-prelaunch-orphan.md), not the full recovery acceptance gate.

Schema nine records a standalone, append-only preparation intent before worker
Git worktree/ref creation or Critic review-evidence capture. It binds the proposed
launch to the repository, full expected SHA, frozen bar, role and intended paths.
It contains no token or claimed native process. A matching launch insertion makes
the intent no longer pending in the same transaction as the protocol transition.
Nested preparation transactions and mismatched launch records are rejected.

Restart exposes unmatched intents as human-required on active runs. Terminal runs
with pending preparations remain in the uncapped operator attention inventory.
New attempts and dismissal as reviewed are refused. The detail UI labels these
paths as intended locations, not verified observations. No files are adopted,
deleted, detached or followed during this recovery projection.

Actual owner-process SIGKILL immediately after worker and Critic worktree creation
now leaves durable inventory, no fabricated launch/preservation/runtime receipt,
unchanged primary checkout and retained exact worktrees. Repeated recovery is
idempotent and another attempt is blocked. Receipts under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

- Worker: `op-prelaunch-orphan-95flhe/recovery.json`.
- Critic: `op-prelaunch-orphan-Rp8Bol/recovery.json`.

The former expected-gap tests have been converted to acceptance assertions and
added to CI alongside preparation and preservation tests. No hosted CI run is
claimed. Local checks also exercise an independent SQLite reader before Git,
failed intent insertion, nested transaction refusal, no-files-yet recovery,
immutable records, mismatched launch rollback, migration eight to nine, and
legacy launches without invented preparation records. Existing backend tests
exercise successful implementation, repair and critique after the change.

Verification: the 29-test backend/preservation/forced-crash/run-view batch passed;
the subsequent 74-test core/attempt-branch/repair/isolated-runner/scheduler/operator/
preparation/run-view batch passed. These batches overlap and are not 103 distinct
tests. Node and web typechecks, the Electron production build and `git diff
--check` passed. The build still reports the existing mixed static/dynamic store
import warning and a large renderer bundle; neither is claimed resolved here.

Existing ancestor canonicalization handles macOS `/var` and `/private/var`
aliases before planning paths. It is not a guarantee against later path races.

Still open: explicit inspected resolution, safe filesystem observations and
redirect/mismatch handling, legacy orphan discovery, a ref-created-only crash,
and visual acceptance of the new detail panel. An intent is not proof of creation
or cleanup safety. No paid/live inference was used; subscription holds remain on.
