# Exact Git evidence for isolated Critics

Date: 2026-09-06. Subscription launches remain held.

## Outcome

`LocalGauntletBackend.prepareCritic` now creates a main-produced review packet before publishing a Critic launch. It contains a full-index binary-capable patch between the run's exact base and candidate commits, plus a manifest binding both 40-character identities, frozen-bar digest and patch SHA-256. The receipt is stored on the launch and survives SQLite reopen.

The Critic prompt identifies this packet and directs the Critic to verify its manifest and digest, inspect the artifact files and run permitted checks. It does not require reading the original repository's Git metadata. Legacy prompt callers without a packet keep their existing Git instruction; new backend-prepared Critics receive the packet.

This resolves the exact-diff preparation and delivery contract, not the complete provider launch path. The new provider sandbox can grant read-only access to this separate packet directory, rejecting overlaps with writable roots. Its production composition remains held and incomplete.

## Execution boundary

The main-owned adapter uses the installed Apple Command Line Tools Git executable, with a fresh allowlisted environment and a Mac Seatbelt policy. The source Git metadata is readable only by that trusted Git operation, not by the agent. The policy denies network access and repository writes, and permits execution only of that Git executable. Fork permission is needed by its macOS startup; external executable helpers remain denied. `/dev/null` is the sole write allowance.

Commands disable replacement objects, inherited system/global configuration, external diff, text conversion, paging, hooks and filesystem monitoring. They compare commit objects rather than dirty working files. Git's documented [external-diff and text-conversion controls](https://git-scm.com/docs/git-diff#Documentation/git-diff.txt---no-ext-diff) supplement the OS boundary. Neither a prompt nor an environment variable alone is treated as confinement.

The maximum patch size is 8 MiB, with a 15-second limit per Git subprocess. Failure or excess output produces no published packet, rather than a silently truncated review. Partial/sparse repositories whose needed objects are unavailable cannot fetch them through this boundary. Apple Command Line Tools and macOS are currently required; there is no unconfined fallback.

## Verified behavior

The focused integration set passed 23 tests, covering the new packet tests, attempt isolation, repair retry budgets and provider sandbox tests. Node/preload and renderer typechecks passed.

New real Git/process tests establish:

- The patch contains committed changes, not uncommitted distractions or repository configuration secrets.
- Configured external diff/textconv/credential helpers and an ambient external-diff override do not execute the planted fixture helper.
- Both ordinary and linked repositories resolve the exact selected commits.
- Invalid SHA inputs, missing objects and over-limit diffs do not publish partial evidence.
- Both Critic and writable Implementer boundaries can read the packet but cannot edit/delete it or read the original Git configuration.
- The backend persists the packet receipt and prompts its exact path/digest.
- Altering the packet after SQLite reopen invalidates the report; no report reaches acknowledgment.

Submission revalidates the packet using bounded, no-follow reads, the recorded patch digest and manifest fields. This supplements OS write denial. A changed/missing packet produces an infrastructure failure eligible for the existing bounded fresh Critic retry, not a pass.

Initial native Git startup failures were isolated to fork permission and read/write access to `/dev/null`. No broad repository write, network or arbitrary-executable allowance was added. Fixture diagnostics contained synthetic data only.

## Limits and next work

No real provider model turn ran. No visual changes were made. The packet is a Git diff, not proof that checks passed, requirements were met, or a Critic actually inspected the evidence. Binary patches and submodule commit-pointer changes still require appropriate observable checks; the packet does not claim to inspect a submodule's contents.

The legacy PTY path still must be replaced by the composed isolated launch path. Worker commits require a separate narrowly scoped trusted operation, and the local control helper must be admitted through scoped transport. Live subscription admission, cancellation/lifecycle evidence and the complete implementation/critique/acknowledgment/repair smoke remain open. No release, push or candidate merge occurred.

Local logs: `/tmp/operatus-git-evidence-integrated.log`, `/tmp/operatus-git-evidence-types.log`.

Final regression: the Electron-hosted root suite passed **311/311 tests, zero skipped**, including both pinned native CLI offline tests. `npm run build` passed. Logs: `/tmp/operatus-full-suite-git-evidence.log` and `/tmp/operatus-git-evidence-build.log`. These results do not constitute a new visual smoke or a live model run. At completion this Mac had approximately 414 MiB free; existing work was preserved, and low storage remains an operational risk for further builds and executable-copy tests.
