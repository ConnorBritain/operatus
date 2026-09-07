# Local Gauntlet usage readiness

Updated after the September 2026 desktop copy and Mac icon correction.

## Bottom line

Local source development, UI inspection and deterministic protocol testing are
available. **No live agent-backed Gauntlet is currently enabled.** The main
process holds launches until subscription-only authentication, configuration,
subprocess isolation and no-paid-overage admission are enforceable. This is a
real release blocker, not a configuration switch for the operator to bypass.

The current unsigned local build is `dist/mac-arm64/Operatus.app`. It has been
rebuilt with provider-neutral empty/quit copy and the padded, transparent-corner
Mac icon. Existing artwork is unchanged; development and packaged exports use
matching image pixels. Reopen the rebuilt app to see the changes. No installer,
signing, publication or update of an installed copy is implied.

## Run categories

| Intended use | Status | Required next evidence |
| --- | --- | --- |
| Develop the app, inspect the floor and run synthetic protocol fixtures | Available now | Keep real-agent startup held; use isolated profiles for UI checks |
| Tiny disposable-repo fix, one Implementer and one fresh Critic | Blocked | Subscription admission, canonical paths/trust readiness, complete helper schemas, artifact-bound checks, then an acknowledged end-to-end pass |
| Deliberately failing task requiring repair and re-critique | Blocked | Above, plus fresh Repairer/Critic identities and evidence through acknowledged repair and terminal outcome |
| Read-only architecture/verification critique | Blocked | Critic admission and verified read-only boundary; read-only does not make billing or filesystem isolation irrelevant |
| Bounded multi-file feature in a real repository | Not accepted | Pass both disposable live fixtures, prove original checkout preservation, cancellation and recovery, then supervise a low-risk pilot |
| Parallel/project-scale work, multiple worktrees | Not accepted | Ownership/dependency scheduling, capacity bounds and an independently verified integrated candidate, not just passing child runs |
| Multi-machine or unattended overnight work | Not accepted | Local reliability first, then real machine enrollment, reconnect/command authority, Windows lifecycle and long-running acceptance |

## Why green tests do not yet mean ready

The latest full local root suite passes 192 tests, including eight billing tests
and three desktop-branding regressions. Node/web typechecks and the production
build pass. The corrected empty state was checked in the actual compiled
desktop at 1440×870 with zero live PTYs. No real model inference was performed
for this correction.

Earlier live testing produced one correct implementation commit, but neither
run reached a Critic report or Conductor acknowledgment. Trust prompts blocked
startup. Checks escaped to the original checkout, failed workers were restored
outside protocol recovery, and displayed process state was stale. Normal quit
also needs investigation. These remain outstanding, independent of cosmetic
fixes and unit-test success. The [full review](2026-09-05-local-mac-readiness.md)
records the run IDs and artifact evidence.

The shortest path to useful local work is subscription admission → trustworthy
startup and exact-artifact checks → correct lifecycle/recovery → one real pass
fixture and one real repair fixture → one supervised bounded real task. A
separate daemon, signing, more themes and a cloud deployment are not prerequisites
for that first Mac acceptance. See the [roadmap](../RELEASE_READINESS_ROADMAP.md).
