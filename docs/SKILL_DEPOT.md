# Skill Depot

The Skill Depot is a user-configurable catalog of pinned Git sources containing `SKILL.md` directories. It is deliberately separate from Agent Primitives.

- Primitives are protocol-selected behavior contracts with typed receipts.
- Skills are contextual procedures assigned to a role or run.
- A skill cannot change Gauntlet state, artifact identity, or authority.

The baseline source is `https://github.com/mattpocock/skills.git` pinned to `068b6e0c62393147daf03530149cdce209c93da8`. Engineering and productivity catalogs are visible by default; `in-progress` and `misc` remain opt-in.

Synchronization is manual. Ventura checks out the exact commit without running installers or repository hooks. Symlinks and path escapes are rejected. Complete skill directories are hashed, locked per run, and copied read-only into provider-specific agent homes. Duplicate names require explicit precedence.

## Management flow

Open **Command Center → Runs → Skill Depot** to synchronize, add, disable, or remove a source. A source records a stable ID, Git URL, full 40-character commit, default include roots, and opt-in roots. Updating means deliberately changing that pin and synchronizing again; Ventura never follows a branch automatically.

Assignments are made per role while creating a run. If two enabled sources expose the same skill name for the same role, choose one source explicitly—the selected source replaces the previous assignment. The resulting `SkillLockReceipt` records source ID, commit, relative path, complete-directory digest, role, and collision outcome before the run becomes visible.

At launch, each selected skill directory—including referenced support files—is materialized read-only into that provider's isolated agent home. Repository install scripts, hooks, binaries, and setup commands are never executed during synchronization.

## Trust limits

A skill is still untrusted prose and support material. It may guide a role, but cannot freeze or alter the run contract, claim a commit, submit another role's report, acknowledge findings, or change state without the matching launch authority. Disable a source to prevent future assignments; existing run receipts remain immutable.
