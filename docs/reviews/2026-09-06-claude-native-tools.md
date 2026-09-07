# Native Claude tools and the scoped commit handoff

Date: 2026-09-06. Native worker commit verified on a subsequent retest; not live-provider acceptance.

## What actually ran

The pinned Claude Code 2.1.263 executable ran inside the Mac outer process boundary against a local gateway. Every model response was scripted SSE, and all account metadata and OAuth values were synthetic. No real account credential, external inference, or model judgment was used.

The fixture used real SQLite, linked Git worktrees, the local control service, and the shipped commit helper. Its requested model was `claude-fable-5-1`. Executable SHA-256: `ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9`.

| Observed stage | Result |
| --- | --- |
| Default inspection profile reads the fixture | Successful native Read |
| Inspection profile receives a scripted Write | Denied by Claude permissions; file unchanged |
| Explicit Implementer profile receives Read and Write | Both successful; assigned working file changed |
| Implementer with permission allowlist but no explicit tool list | Bash absent, so commit helper could not run |
| Implementer with explicit Bash tool | Helper ran, but Claude's subprocess scrub removed its environment token |
| Native retest after the sidecar fix below | Skipped for insufficient disk space; not a pass |
| Subsequent retest after free space recovered | Successful native Read, Write and Bash/helper commit; exact candidate recorded |

Both failed native commit attempts left the run in `implementer_in_flight` with no accepted artifact. Claude exited with code zero even though its tool failed. This reinforces why terminal prose and provider exit status cannot establish artifact completion. Failed fixture worktrees were retained for diagnosis; the test removed only its own copied binary.

## Changes

Explicit Claude role profiles now use a narrow, named tool set. Implementer and Repairer receive Read, Glob, Grep, Bash, Write and Edit. Critic and Conductor omit the writing tools. Permissions use `dontAsk`, with auto classification and permission bypass disabled; unapproved requests are denied. Inspection remains in plan mode. These profiles are preparation components, not authorization to launch outside the mandatory outer sandbox.

Claude's [CLI reference](https://code.claude.com/docs/en/cli-reference) documents that restricted mode removes command tools unless they are individually named with `--tools`. We retain restricted mode and explicitly name Bash rather than restoring the full default tool set. Tool allowlisting does not replace filesystem, network or protocol authorization. See also the [permission model](https://code.claude.com/docs/en/permissions).

The isolated control client no longer depends on a token environment variable. Main writes a `control-capability.json` sidecar beside the digest-verified helper, outside worker-writable home, scratch and worktree roots. The file is private and read-only (0400). The outer boundary grants access to that exact file, helper, runtime and socket. It contains only the scoped local control token and socket, never a subscription credential. Neither arguments, returned environment, helper source nor receipts contain the token. Claude's environment scrub remains enabled.

The helper opens that fixed sibling file without following a final symlink, checks regular-file type, owner/private permissions, bounded size and schema, and emits only a generic error on rejection. Legacy environment-based callers remain supported without mixing partial environment identity with sidecar identity. The control server still checks role, launch, expected artifact and frozen contract; possession of a worker token does not confer Conductor authority. Lifecycle revocation and cleanup remain the production launcher's responsibility.

## Verified after the fix

**44 focused tests passed, zero skips**, including real confined helper processes, candidate commits, gateway/account checks, executable identity, role configuration and the billing hold. Both typechecks and the Electron build passed.

The confined shell fixture successfully commits through the sidecar, submits a synthetic fresh Critic report and persists a separate Conductor acknowledgment. It rejects worker impersonation, sidecar/helper rewriting, unrelated Unix/TCP connections and socket binding. Malformed, oversized, group/world-readable, symlinked and partial-environment credentials fail without printing token contents. The TCP negative control now attempts an actual connection through Bash, avoiding a false negative from curl failing before connection.

The first post-fix native attempt skipped because free space was below the executable-copy requirement plus the 256 MiB reserve. Free space later recovered to approximately 693 MiB. A subsequent native retest executed and **passed with zero skips**, proving the sidecar-based worker handoff. Its candidate was `fe05f163a061fe58c0872ee64a790ef40cc09c4a`, and the source `main` checkout remained unchanged. The run stopped at `awaiting_critic`, not `passed`. No safety limit was lowered and no user data was deleted. The test removed its private executable copy after completion.

## Remaining gates

1. The worker-only retest passed; the [subsequently expanded native Critic fixture also passed](2026-09-06-native-critic-lifecycle.md), including actual session-ID binding and exact evidence reads. It exposed and fixed premature receipt-time worktree deletion.
2. Exercise native Repairer/Conductor behavior and compose these verified pieces into the real launch path. The production launcher still does not bind `AgentLaunch.sessionId` to a provider session. Native fixture assertions and generated IDs do not fix production wiring by themselves.
3. Compose account admission, executable/profile identities, gateway, control capability and lifecycle teardown into the production launcher. The existing global hold remains unchanged.
4. Resolve Codex's no-credit-spend admission gate, then perform genuine subscription-only multi-role and concurrent Gauntlet acceptance. No new UX/viewport or upstream comparison smoke was performed in this component pass.

Evidence: [native failure before the sidecar fix](assets/2026-09-06/claude-tools/native-before-sidecar.tap), [initial native retest skipped](assets/2026-09-06/claude-tools/native-sidecar-skipped.tap), [successful native worker commit](assets/2026-09-06/claude-tools/native-commit-passed.tap), [focused tests](assets/2026-09-06/claude-tools/focused.tap). Source: `src/main/subscriptionProfile.ts`, `src/main/gauntlet/controlClient.ts`, `src/main/subscriptionSandbox.ts`, `resources/operatus-gauntlet.cjs`, `test/claude-native-tools.test.cjs`, `test/gauntlet-isolated-control.test.cjs`.
