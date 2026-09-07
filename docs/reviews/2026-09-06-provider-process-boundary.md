# Offline provider process boundary

Date: 2026-09-06. Live provider launches remain held.

## Implemented

`src/main/subscriptionSandbox.ts` prepares an outer macOS Seatbelt boundary. It is separate from a provider's own optional tool sandbox. Unsupported platforms fail closed. The caller must provide main-owned workspace, prepared-profile and executable identities.

The Conductor and Critic can read the artifact; Implementers and Repairers can change working files. All roles are denied writes to artifact `.git` metadata and the prepared provider settings. Private runtime-cache and scratch writes are allowed. Ambient file contents and network access have no general allowance. Subprocesses inherit the restrictions. Each result records the role, profile digest and `launchAllowed: false`.

This implementation is intentionally offline. It has no credential delivery, provider networking or local control-socket allowance. It is not called by the production spawn path.

## Verification

Six tests in `test/subscription-sandbox.test.cjs` passed on this Mac using real sandboxed shell processes, not provider inference:

- Critic reads evidence but cannot edit, create or remove artifact files.
- Implementer edits working files but cannot overwrite or delete protected settings and Git metadata, or rename the protected settings parent.
- Ambient secret reads/writes through direct paths and symlinks fail.
- Hard-link aliases do not make protected files writable.
- A child shell cannot connect to a local listener; the listener accepts zero connections.
- Overlapping roots and unsupported roles/platforms are rejected.

The focused boundary, account-admission, profile and billing-policy set passed **24/24** tests. Both node/preload and renderer typechecks passed. CI now includes the new boundary tests. No full-suite rerun, Electron build or native provider launch was performed for this change. Low disk space remains a constraint on large binary-copy probes.

## Remaining acceptance

The tests establish these specific OS restrictions, not complete containment against every exploit, native Claude/Codex compatibility or subscription-only billing. Executable pinning and fresh account admission are separate components. Their receipts alone cannot authorize inference.

Production still uses the legacy Hive/PTY launch path behind the global hold. Its final environment scrub removes provider configuration-home overrides, so simply injecting a prepared profile there would not establish the intended isolated session. A dedicated composed launch path must preserve the approved profile, enforce scoped control commands, handle termination/revocation, and record lifecycle evidence.

Because workers cannot write Git metadata, artifact commits require a narrow trusted main-process operation. Do not solve this by granting broad access to shared Git metadata. Provider networking and credential handling also remain unimplemented here. Codex's unresolved credit-spending admission constraint remains independent of this filesystem work.

Before lifting any hold, verify the complete native-provider path, failure behavior, cancellation and at least one real implementation/critique/acknowledgment cycle. Until then, this is a tested offline component, not a working Gauntlet runner.

## Follow-up: native CLI compatibility

The genuine-CLI test now uses `prepareSubscriptionSandbox`, not the broader frozen-check fixture boundary. Both pinned executables passed its offline checks on this Mac:

| Executable | SHA-256 | Observed checks |
| --- | --- | --- |
| Claude 2.1.263 | `ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9` | Empty profile reports no login; synthetic OAuth file yields only a subscription hint; synthetic API key is classified as forbidden; project helper does not run. |
| Codex 0.153.4 | `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629` | Strict profile accepted during initialization; exact controlled home returned; empty login rejected; synthetic API file rejected. |

The test pins a private executable copy outside the writable roots, canonicalizes macOS temporary paths, and removes its executable copy on success or failure. It leaves small synthetic fixtures for diagnosis. An initial test-harness mismatch between `/var` and `/private/var` was corrected without weakening sandbox restrictions.

This proves startup/configuration compatibility for the exercised subcommands only, not interactive sessions, tools, skills, Git operations or inference. Codex receives only `initialize`, never `thread/start` or `turn/start`; the [official protocol](https://learn.chatgpt.com/docs/app-server#initialization) separates initialization from starting model work. The test closes after the initialization response rather than beginning a session. No real credentials or model quota were used. Local receipt: `/tmp/operatus-native-outer-boundary.log` (2 passed, zero skipped).

Integration inspection also confirms that the existing worker prompt still instructs workers to commit and Critics to invoke Git directly. Linked-worktree metadata lives outside the new boundary's allowed artifact root. Those instructions cannot be claimed compatible with this boundary. The dedicated launch path must supply exact-artifact Git evidence and a main-owned commit operation, or establish an equivalently narrow verified Git capability, before those prompts are used under it. Do not grant the complete original repository or its configuration merely to make Git commands pass.

After this follow-up, the full Electron-hosted root suite passed **307/307 tests with zero skips**, run sequentially with both explicit native executable pins. Receipt: `/tmp/operatus-full-suite-native-boundary.log` (about 62 seconds). That supersedes the earlier no-full-suite statement for this follow-up only. It is not a portal test run, a new build, a visual smoke or live Gauntlet acceptance. The global subscription hold was not changed.
