# Confirmed gap: worktree created before launch recording

Historical diagnostic: the missing-inventory behavior below was subsequently
fixed by [schema-nine preparation inventory](2026-09-06-preparation-inventory.md).
The test now asserts inventory and retry refusal. Keep this original evidence as
the before-state; filesystem inspection/resolution and legacy discovery remain open.

Date: 2026-09-06. This is **a reproduced readiness defect, not a passed recovery
gate**. No provider, real credential, inference or paid service is involved.

## Evidence

Candidate and Critic preparation currently create a Git worktree before the launch
transition commits. Critic review-evidence capture also precedes launch recording.
The runtime and preservation journals require an existing launch, so neither can
inventory this earlier interval.

`test/gauntlet-prelaunch-orphan.test.cjs` creates disposable repositories, then
starts a separate owner process using the actual backend/worktree implementation.
Immediately after Git worktree creation returns, that process saves the observed
workspace identity and kills itself with SIGKILL, before the launch transition.
The parent observes the actual signal, reconstructs the backend, and reconciles.

Both candidate and Critic cases show:

- The exact worktree and expected commit remain registered in Git.
- The original checkout remains unchanged.
- No launch, preservation or runtime observation identifies the created workspace.
- The run remains awaiting implementation/critique rather than signalling the
  incomplete preparation, and a new attempt can create another distinct workspace.
- No artifact is falsely accepted and no old workspace is deleted.

The diagnostic tests assert this existing gap so it remains reproducible. Their
green result must never be counted as recovery acceptance. Replace those assertions
with required inventory/attention behavior when the fix lands. They are not added
to CI as a successful readiness gate.

Receipt parent:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.
Candidate: `op-prelaunch-orphan-TsEiMe`; Critic: `op-prelaunch-orphan-rl1Skw`.
Each retains `before.json`, `created-workspace.json`, `diagnostic.json`, SQLite and
Git/worktrees. No provider processes or executable copies were created.

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-prelaunch-orphan.test.cjs
```

## Required fix boundary

Use a dedicated SQLite preparation-intent record, not a fabricated launch or
process observation. Persist it **before any Git ref/worktree or Critic evidence
creation**. Include run ID, proposed launch ID, role, repository, expected SHA,
frozen-bar digest, intended worktree/ref/evidence paths and creation time. No token,
credential, prompt body or claimed native process belongs in the intent.

The intent write must have committed independently before filesystem effects.
A nested SQLite savepoint under an outer uncommitted control transaction does not
meet this guarantee. Current worker preparation is main-runner owned, outside the
scoped freeze/ack transaction; enforce that boundary rather than relying on it
accidentally. Finish the intent atomically with the matching launch transition.

Recovery must expose unmatched intents even when a run is terminal, preserving
path identities without following symlinks, detaching branches, deleting files,
adopting artifacts or starting a provider. Distinguish absent paths, observed
matching workspaces, redirected/mismatched paths and unavailable observations.
An intended path is not proof that creation happened or that cleanup is safe.

Acceptance needs failures before creation, after ref creation, after worktree
creation, after review-evidence capture and around launch commit; duplicate intents,
failed intent persistence, transaction rollback, symlinks, wrong repository/SHA,
terminal-run visibility, repeated recovery and legacy orphan discovery. Preserve
the existing schema-version refusal and migration behavior. The current schema is
8; any authority-affecting extension needs an explicit migration and downgrade
protection. This review proposes the boundary; it does not implement that schema.

## Scope of impact

The observed defect loses application inventory and can accumulate hidden retained
workspaces. It does not demonstrate data deletion, native execution before recording,
cross-run artifact acceptance or an API-charge escape. Existing recorded-launch
crash tests remain valid for their later lifecycle boundary, not this earlier one.
