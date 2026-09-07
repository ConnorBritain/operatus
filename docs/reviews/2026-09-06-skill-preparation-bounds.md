# Bounded aggregate skill preparation

## Finding

The depot limited each individual skill to 16 MiB and 2,000 entries, but permitted
200 assignments with no combined per-profile limit. Materialization validated and
copied one tree at a time using recursive `cpSync`. A later invalid selection
could therefore leave earlier copies, and a source growing between inspection and
copy had no streaming byte guard. With roughly 6 GiB free at initial inspection,
this was a concrete local-pilot resource risk.

## Implemented

- At most 64 MiB and 8,000 entries across one role's complete profile selection,
  with the existing per-tree bounds and an additional 64-level nesting bound.
- Validate aggregate role budgets during locking, before backend.start persists
  the run. Revalidate older locks and the complete selected set before creating
  materialization targets.
- Copy from regular-file descriptors with no-follow/nonblocking open flags and
  identity checks, in 64 KiB chunks. Enforce actual bytes while reading and before
  writing, including growth after initial file inspection. Targets are exclusively
  created, never merged or overwritten.
- Preserve the old canonical tree digest, complete support files and read-only
  materialized permissions. Compare the copied digest with the frozen lock.
- Check destination filesystem space against planned bytes plus a 512 MiB
  diagnostic reserve. Insufficient or unknown space refuses copying.
- Inspect the bounded tree before loading instruction text during discovery,
  and independently bound the instruction read against subsequent growth.

Failures remain explicit and do not launch or reuse partial profiles. No cleanup
of user data, existing worktrees or previously retained evidence was performed.

## Verification

13 focused tests passed, zero skipped:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-skill-tree.test.cjs test/gauntlet-isolated-skills.test.cjs \
  test/gauntlet-skill-depot.test.cjs
```

Final verification also passed both Node/web typechecks, the Electron build and
`git diff --check`. Existing bundle-size/dynamic-import warnings remain.

Coverage includes a real five-skill sparse-file selection of nearly 80 MiB, where
each tree is individually valid but both new locking and old-lock materialization
are rejected before target creation. Other tests cover aggregate entry/byte
budgets, a file growing after descriptor inspection, later invalid assignments,
symlinks, FIFO special files, deep nesting, low/unknown free space, exact legacy
digest compatibility, nested support copies, and actual Seatbelt-confined reads
with chmod/write/rename/hard-link denial.

The actual pinned Claude executable passed three scripted scenarios through the
new copy implementation: two full five-session skill/implementation/critique/
repair/re-critique loops and one deliberate admission-journal failure before
startup. All provider/account responses were synthetic; no real inference.

Retained roots under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

- `op-native-runner-p6RPRF`: normal scripted loop, run `686c1581-ea4e-4443-a62b-0debc969a5d1`.
- `op-native-runner-6E6hVM`: injected gateway-close reporting failure, run `75b02eeb-e5d2-487e-bbb3-f90dc52118fe`.
- `op-native-runner-NiyQUF`: admission-write rejection, run `7f469399-975e-4126-b0b4-f9af58109d3b`.

## Limits and remaining work

This is a bounded skill-preparation policy, not a disk quota or a reservation
against unrelated writes. It does not bound repository clones, worktrees, provider
scratch output, accumulated private profiles or native executable copies across
app restarts. Retained partial preparations still require an ownership-safe
cleanup policy. Synchronous catalog/Git inspection remains a responsiveness risk
on large catalogs. No live subscription admission or visual acceptance is claimed,
and the production launch hold is unchanged.
