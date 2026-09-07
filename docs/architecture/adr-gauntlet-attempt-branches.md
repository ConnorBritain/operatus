# ADR: separate candidate branches for fresh Gauntlet attempts

Status: accepted for local development; live-provider acceptance remains open.

## Problem

A worker may commit before its completion checks finish. If the check is
interrupted, SQLite correctly has no artifact, but the run's shared candidate
branch has advanced. Retrying against the authoritative base then fails its
expected-SHA check. Resetting that ref would obscure unreviewed work; accepting
its new SHA would silently change the next worker's assignment.

## Decision

Every new Implementer or Repairer launch gets a fresh branch named
`operatus/gauntlet/<run-id>-attempt-<launch-id>`, created only at the exact
expected commit. Record that branch in the launch's `candidateBranch` field
and in any resulting artifact. A collision fails closed even when its ref
already points to the expected SHA.

`GauntletRun.branch` remains the stable naming stem and the historical branch
fallback for legacy launch rows without `candidateBranch`. New launches never
move that legacy ref. Existing JSON launch records need no destructive data
migration, and existing artifact records retain their recorded branch names.

Keep abandoned attempt refs and detached/locked failed worktrees. Their launch
IDs, expected SHAs, branch names and lifecycle records remain inspectable.
An unrecorded commit remains unreviewed, not an artifact or a passing result.
Do not reset, merge, push or automatically delete attempt branches.

The next Implementer starts from the frozen base; the next Repairer starts
from its acknowledged packet's exact artifact. Critics remain detached at an
exact artifact commit. Completion must still be on its assigned branch, clean,
and descended from its expected SHA. Switching to an unrelated branch or
detached HEAD is not an acceptable completion receipt.

The branch of the final candidate is the latest recorded artifact's `branch`,
not an assumed run-level ref. Documentation and artifact inspection must make
that explicit. Commits remain authoritative even if a human later moves a ref.

## Consequences and verification

This retains additional branches deliberately. Cleanup needs a later explicit,
provenance-aware policy. Each attempt has clear ownership without Git ref resets
or a cross-store Git/SQLite promotion transaction.

Verify committed-before-recorded restart and retry, failed repair retry from
the prior artifact rather than its abandoned commit, legacy launch fallback,
branch collisions and switched-branch rejection, retained dirty/untracked
work, distinct fresh sessions, and unchanged original checkout/ref. The full
live-provider Gauntlet gate is separate from these Git/protocol tests.
