# Native Claude Critic and receipt-time worktree retention

Date: 2026-09-06. Executed native tool verification using scripted local responses. No live subscription inference.

Later transport work: the fixture now uses a dedicated worker adapter instead of the direct test launcher. Its first rerun was disk-skipped; the zero-skip result below is historical, not verification of that adapter. See [the transport record](2026-09-06-fresh-claude-session-transport.md).

## Result

The expanded native fixture passed with **zero skips**. It used pinned Claude Code 2.1.263, real disposable Git/SQLite/control-helper state, the outer Mac process sandbox, synthetic account metadata and a local scripted gateway. The run selected Claude as a configurable Critic; the production Codex default was not changed.

Executable SHA-256: `ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9`.

| Native boundary | Observed result |
| --- | --- |
| Inspection role | Read succeeds; Write denied; no candidate accepted |
| Implementer | Read/Write and scoped helper commit succeed; source main remains unchanged |
| Fresh Critic | Separate profile/process; offered tools are Bash, Glob, Grep and Read |
| Exact evidence | Artifact, manifest and patch read successfully; manifest and report bind the same full candidate SHA |
| Mutation attempts | Shell writes to artifact and evidence fail with an OS permission error |
| Authority | Critic token cannot issue a Conductor cancellation command |
| Report | Scoped helper succeeds; persisted run waits at `awaiting_lead_ack`, with no acknowledgment |
| Actual identity | Native JSON `session_id` matches the stored worker/Critic launch session IDs supplied with `--session-id`; the identities differ |
| After report | A fresh Bash child executes `/bin/cat value.txt` successfully from the Critic's still-present working directory |

Final candidate: `9bccb92654548e427594538bf363dabbf1f61ea7`. Worker session: `46b8e94a-e825-4a7a-b890-5004639e5aec`. Critic session: `5c1e1d28-ac9d-45b8-b4e6-85ecc73a5ee7`.

The additional evidence directory is supplied explicitly through `--add-dir` and independently granted read-only OS access. Naming a directory to the CLI is not a read-only security boundary by itself. These flags are described in the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference); the executed mutation attempts establish the observed confinement here.

## Defect found and fixed

The first run stopped at a case-sensitive test assertion: the native shell writes “operation not permitted” in lowercase. The assertion now accepts case variation while still requiring a failed tool result, the permission-error text, unchanged file contents and an unchanged accepted artifact.

The subsequent run exposed a real backend defect. `submitCritic` removed the review worktree immediately after persisting a report, before the provider process finished. The final fixture-side read failed with `ENOENT`. The legacy worker completion path also attempted receipt-time cleanup.

Both receipt-time cleanup calls have been removed. **A completion receipt is not proof of process termination.** Candidate and Critic worktrees now remain at their recorded launch paths until a separate lifecycle-owned cleanup can establish quiescence and safe release. No ordinary cleanup fallback was introduced.

The final native check deliberately uses Bash/cat after report submission because Claude's built-in Read can return a cached result for an unchanged file. A cached tool result would be weaker evidence that the working directory remains usable. The test also checks the actual file from the parent process.

## Regression evidence

- **38 focused tests passed**, zero skips: backend loop, main-owned commits, isolated control helper, worktree/evidence validation, cleanup ownership, recovery and operator review.
- Legacy completion, repair and both Critic reports preserve their recorded worktrees; source files remain unchanged.
- Node/preload and renderer typechecks and the Electron build passed; `git diff --check` passed.
- Native test: one passed, zero failed, zero skipped. Temporary copied executable removed by the fixture; diagnostic worktrees retained.

Retained [native output](assets/2026-09-06/native-critic/native.tap) and [focused regression output](assets/2026-09-06/native-critic/focused.tap). Logs: `/tmp/operatus-native-critic-final-pass.log`, `/tmp/operatus-critic-lifecycle-tests.log`, `/tmp/operatus-critic-lifecycle-types.log`.

## Still open

This does not prove independent model judgment, complete primitive-prompt consumption, actual Max authentication, Codex compatibility, a long-lived Conductor, native repair/re-critique, concurrent live Gauntlets or UI-to-provider production composition. The scripted response is an executable tool test, not a successful coding judgment.

The production spawn path still needs to bind its actual provider session to the launch receipt and compose the isolated profile, gateway, helper, assignment and process lifecycle. Test-supplied session IDs do not fix that production path automatically. Receipt `completed`/`finishedAt` fields describe protocol submission, not independently observed process death.

Safe cleanup after verified process termination, including ownership-aware restart reconciliation and explicit storage-pressure handling, remains unfinished. Retention is intentionally conservative and can consume disk space. No garbage collector was enabled to compensate, and no user files were deleted. The global subscription hold remains active. This pass did not repeat visual, upstream or hosted-portal acceptance.
