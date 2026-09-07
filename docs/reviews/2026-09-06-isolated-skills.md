# Locked skills reach isolated Claude roles

Date: 2026-09-06. Global subscription hold unchanged; no real inference or user account access in this pass.

## Functional change

The isolated runner previously refused every run with assigned skills. The Claude factory now supports them: each prepared role carries the persisted run lock, copies only its explicit assignments into its new private provider home's `skills` directory, and adds exact SKILL.md paths and source/tree identities to the role prompt. The Conductor's first delivered prompt includes its assignments; fresh workers receive their own. Factories without this capability still refuse assigned runs.

A per-launch `operatus-lock.json` records run, launch, role and entries; its digest is in the prompt. The existing run skill receipt remains in SQLite. No source sync, repository install, plugin loading, broad Skill-tool discovery, permission expansion, or third-party auto-assignment occurs during launch. Guidance cannot change the frozen bar, artifact identity, role permissions or acknowledgment authority.

Materialization validates safe skill names, roles, source IDs, full source commits, clean checkouts, tree digests before and after copying, collisions, symlinks, regular file types and missing support files. Each skill tree is bounded to 2,000 entries and 16 MiB. Disabled sources cannot receive new assignments; already locked runs retain their explicit assignments. A changed/repinned cache fails subsequent materialization rather than silently changing a locked skill. Keeping multiple cached revisions across manual repins remains a future improvement.

Read-only file modes are supplemented by the mandatory macOS sandbox's denial of writes, attribute changes and replacement under the private skills directory. Restricted Claude file tools get an explicit `--add-dir` for that exact directory, not the whole profile or depot. This grant does not override the OS write denial.

## Native failures that informed the fix

The first native test could not read the skill files: `--restricted` required an explicit directory grant even though the OS sandbox permitted reading. The test also initially used a subprocess environment variable that Claude strips; its mutation probe was corrected to use the actual assigned path. After that correction, native Claude denied the sensitive-file mutation before execution. Separate actual sandboxed shell checks prove OS-level protection against chmod, rewrite, rename, delete and hard-link writes independently of Claude's tool-layer refusal. No restrictions were disabled to pass these checks.

## Executed evidence

- 35 focused tests passed with zero skips across isolated skills, depot, runner and fresh/persistent transports. After adding clean-checkout validation, the five skill/depot tests passed again, including dirty/ambiguous catalog rejection. Existing sandbox and runner coverage also passed in an earlier 20-test run.
- Final native scripted integration: two repair/re-critique loops passed, zero skips, in 21.1 seconds. Each used five actual CLI processes, four explicit role assignments and 39 scripted local provider responses. All five processes read SKILL.md and support.md; mutation attempts were refused; copied contents remained identical; five manifests matched the persisted role lock and exact launch IDs. Two artifacts and explicit repair/pass acknowledgments remained intact.
- Clean run `04bddebc-6a71-4814-a175-0915f1d51051`: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-V1Hxyp/receipt.json`.
- Injected final gateway-close reporting failure run `8acafed3-ab49-4004-bf67-c963091bc9bf`: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-NJnWQ6/receipt.json`. As before, this fixture closes the gateway before simulating lost confirmation; runtime attention remains distinct from the scripted artifact verdict.
- Receipts retain `materializations`, source locks, native session identities and tool results. Private executable copies were removed by the existing fixture cleanup; skill profiles, manifests, Git and SQLite evidence remain.
- Main/preload and web typechecks, the Electron build and `git diff --check` passed after the final code changes. Existing Vite warnings remain. CI includes isolated-skill tests; no remote CI execution is claimed.

## Limits

This establishes assigned-skill delivery and containment for the isolated macOS Claude path, not real-model adherence or subscription billing acceptance. Codex remains unadmitted and was not substituted in user runs. No new GUI/viewport acceptance occurred. The materialization manifest is retained in the private profile and native test receipts; it is not yet a separate launch observation in the UI. Large multi-skill aggregate storage/copy responsiveness, long-term immutable cache retention, full native output inspection, capacity/storage admission and real concurrent owner-operator acceptance remain unfinished.
