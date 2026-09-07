# Main-owned worker commits

Date: 2026-09-06. Live subscription launches remain held.

## Implemented path

Workers now request `commit` through the scoped local helper instead of running `git add` or `git commit` themselves. The request supplies the launch identity/token, expected starting SHA, frozen-bar digest and a bounded one-line commit message. It accepts no repository path, branch override, Git options or executable.

The backend authenticates the assigned Implementer/Repairer, validates artifact and contract identities and claims the existing per-run completion lock. The main process then stages the assigned linked worktree, creates a one-parent commit and compare-and-swaps only its assigned attempt ref. The commit is validated, frozen checks execute, and the artifact is validated again before the existing transactional artifact-recording transition.

Critic reports remain advisory until Conductor acknowledgment. The commit operation does not pass a run, merge, push, sign, revise the bar or authorize model inference. The older SHA-completion operation remains available for existing callers; its existence does not bypass the launch hold.

## Git boundary

The new adapter uses the installed Apple Command Line Tools Git executable under a Mac Seatbelt policy and a minimal environment. Only that executable can execute, network is denied, and working files cannot be written by the Git process. It may write Git objects, its own worktree index/lock, and the assigned attempt ref/reflog. Git also requires its own worktree `HEAD.lock` and HEAD reflog; symbolic HEAD itself is not writable. Other branches and the user's primary checkout/index are not writable through this boundary.

Hooks, filesystem monitoring, signing and external diff/text conversion are disabled per process. Executable filters cannot run. Repositories that require such filters fail with work retained instead of executing them outside confinement. Commit author/committer metadata is explicitly Operatus; personal Git identity/configuration is not modified.

The adapter validates that the candidate is a linked worktree of the assigned repository and is on its assigned branch. It requires the exact expected HEAD before committing, uses a single explicit parent and updates the ref with the expected old value. A concurrent external ref change cannot silently overwrite that ref.

New main-committed worktrees remain available for inspection after artifact recording. They are not handed to the legacy unconfined worktree-removal command. Existing generic Gauntlet cleanup ownership protections continue to apply. A dedicated confined cleanup path remains future work.

## Verification

The focused integration set passed **24 tests**, covering main commits, exact review packets, isolated attempt branches, check cancellation and control-service draining. Typechecks passed.

New tests use real Git repositories, SQLite, sandboxed shell edits and the actual local control socket. They verify:

- A worker edits within its boundary; the main process commits the exact parent and preserves the original checkout and `main`.
- A planted pre-commit hook does not execute.
- Wrong tokens, expected SHAs, bar digests and switched branches are rejected without creating a commit.
- A required executable clean filter is denied; edited work and the old branch commit survive, with no accepted artifact.
- Duplicate completion cannot record another artifact.
- A scoped socket request records an implementation, then a fresh repair with the original artifact as parent. A fresh Critic and explicit acknowledgment follow. Both fresh session identities and an untouched `main` are asserted.

The last test's findings and verdicts are explicitly synthetic. It proves the deterministic control/protocol path, not live reviewer quality or subscription execution. Source: `test/gauntlet-main-commit.test.cjs`; local result: `/tmp/operatus-main-commit-integration.log`.

## Remaining limitations

Follow-up: candidate commit/validation subprocesses are now asynchronous and cancellation-aware, with real stopped-process, peer-run and timeout verification. See [the current execution record](2026-09-06-async-candidate-git.md). The synchronous description below records the initial implementation, not the current candidate adapter.

The isolated provider launcher still needs credential/network admission and scoped helper transport. These changes do not lift the global hold or establish a live Gauntlet smoke. Windows/Linux remain unsupported by this initial enforced Git adapter. Git subprocesses have bounded time/output limits but are synchronous in this first implementation; responsiveness on large repositories needs measured follow-up and asynchronous cancellation-aware execution.

If interrupted after the ref moves but before artifact recording, the existing preserved-attempt/restart recovery semantics apply. The backend does not silently adopt an unrecorded commit or reset the attempt. Successful candidates are retained, not merged or pushed. No user files, credentials or billing preferences were changed during verification.

Final regression: **313 passed, zero failed, two skipped** in the full Electron-hosted root suite. The two opt-in native-provider copy tests were deliberately omitted because this Mac had under 400 MiB free; they passed in the preceding turn, not in this run. `npm run build` also passed. Logs: `/tmp/operatus-main-commit-full.log` and `/tmp/operatus-main-commit-build.log`. No new visual or live-provider smoke is claimed.
