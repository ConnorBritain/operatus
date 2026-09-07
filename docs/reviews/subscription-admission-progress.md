# Subscription admission and artifact-check progress

This is a partial R1 implementation, not live Gauntlet acceptance.

## Implemented

- Subscription settings no longer offer API-key or custom-endpoint inputs.
  The main-owned diagnostic reads bounded local files, never invokes a shell,
  keychain tool, credential helper or inference session, and returns fixed status
  fields without credential values. As of the version-diagnostic follow-up, it
  runs native macOS CLI `--version` only in an offline, empty-profile sandbox.
  It hashes resolved entrypoints asynchronously;
  a JS launcher hash does not attest to its downstream native runtime.
- The Mac check runner now uses a deny-by-default Seatbelt profile. Network
  access is denied, including loopback. File content access is limited to the
  artifact, a retained private scratch directory, listed OS runtime paths and
  the host Node/Electron runtime. There is no broad home, /tmp, /usr/local or
  /System/Volumes allowance. Checks get a clean environment and non-login shell.
- The host runtime is exposed as `node` for offline artifact-relative JavaScript
  tests. Other toolchains, external dependency caches, package downloads and
  services are not admitted by this first profile. Unsupported platforms fail
  closed instead of silently running unrestricted checks.
- Receipts include boundary version, canonical cwd, scratch directory, profile
  SHA-256 and network denial. Worktree paths are canonicalized before returning
  them to launch coordination. This does not yet fix every provider trust path.
- Prompt guidance includes the missing required check fields and an example
  validated against `freezeContract`, plus report and acknowledgment shapes.

## Evidence and limits

The full local root suite passes 206 tests; node/web typechecks and the Electron
build pass. Positive sandbox tests execute a real `node --test` fixture under
both Node and Electron-hosted test runners. Negative tests attempt absolute-path
and symlink reads/writes outside the artifact and contact a real loopback server;
the original file survives and the server sees no connection. These tests use
synthetic secrets and no model inference. They are not a comprehensive OS sandbox
audit or proof of provider-process containment.

Read-only local inspection found two Claude installations and two Codex
entrypoints (npm launcher and the ChatGPT app's bundled executable). Subsequent
version-only probes, with isolated homes and network denied by Seatbelt,
confirmed Claude native **2.1.263** and Homebrew **2.1.86**, both exit 0. The shell
resolved the older Homebrew entrypoint first in the shell probe; the subsequent
Electron smoke found the native installation first. That difference reinforces
the need for explicit selection, not PATH order. The bundled Codex native binary
now reports **0.153.4** in the same offline version diagnostic. The npm wrapper
is deliberately not executed without separately pinning its interpreter/runtime.
Local configuration risk signals exist for both providers.
Codex has a stored subscription-shaped auth record; Claude's file-based hint is
unknown, which may be normal for keychain-backed login. Neither is validated
authentication. No provider credentials or account settings were changed.

The operator confirmed paid extras/usage credits and automatic top-ups are
disabled on both accounts. This is recorded human evidence, not a programmatic
account-policy receipt. It does not lift the runtime hold. Official references:
[Codex auth restrictions](https://learn.chatgpt.com/docs/auth#enforce-a-login-method-or-workspace)
and [Claude configuration and trust sources](https://code.claude.com/docs/en/settings).

### Fable 5.1 catalog correction

The operator confirmed **Claude Max**. Fable 5.1 is now present in the desktop
model picker with ID `claude-fable-5-1`; existing defaults and pinned Fable 5
choices are preserved. Claude's [model configuration guide](https://support.claude.com/en/articles/11940350-claude-code-model-configuration)
confirms the ID. Its [Fable plan guide](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)
requires CLI 2.1.255 or later. Max and premium seats can use included Fable
allowance; Pro/standard seats require usage credits. Included allowance exhaustion
must stop work, never enable credits. Model presence is not entitlement evidence.

No reinstall is needed to meet this version minimum: the native binary is already
new enough. Validated, explicit executable selection remains a launch-admission
requirement; do not silently choose whichever duplicate happens to be first on
PATH. No global shell configuration, installation, credentials or billing settings
were changed. Neither a Fable inference nor a live Gauntlet was run by these probes.

## Still required before live use

Controlled provider homes/configuration, validated executable/version selection,
authenticated subscription-only launch, no-overage enforcement, and full provider
subprocess containment are incomplete. Gauntlet worker restoration is now guarded
by the separate recovery follow-up; the generic cleanup audit, stale UI status,
normal shutdown and provider trust readiness remain open. Complete
those, then run a real acknowledged pass fixture and a real repair/re-critique
fixture. Do not bypass the billing hold for either fixture.

Local logs: `/tmp/operatus-admission-tests.log`,
`/tmp/operatus-admission-typecheck.log`, `/tmp/operatus-admission-build.log`.
The subsequent catalog correction was verified in `/tmp/operatus-model-tests.log`
(206 passing), `/tmp/operatus-model-typecheck.log`, and
`/tmp/operatus-model-build.log`. This is a source/build verification, not a
provider entitlement test or deployment to an installed desktop copy.

The subsequent [native-version diagnostic](2026-09-06-native-provider-versions.md)
passes 224 root tests, both typechecks and the Electron build, with an actual
Settings-to-IPC-to-native-probe smoke at both target viewports. It still does not
admit any provider launch.
