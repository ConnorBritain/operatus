# Native provider versions: diagnostic, not launch admission

## Story and outcome

An operator opens Settings → Agents & Models → Inspect local setup and sees
which CLI installations are present, their exact file digests and their reported
versions. The built Electron renderer, preload IPC, main-process inspection,
offline native probe and result rendering were exercised together. No credentials,
account settings, global PATH, installed CLI, default model or billing hold changed.

The operator confirmed Claude Max and previously confirmed disabled paid extras
and automatic top-ups on both accounts. These remain human-reported facts, not
programmatically verified account-policy receipts.

## Observed installations

| Entrypoint | Offline result |
| --- | --- |
| Native Claude `/Users/dahlia/.local/share/claude/versions/2.1.263` | 2.1.263 |
| Homebrew Claude `/opt/homebrew/Caskroom/claude-code/2.1.86/claude` | 2.1.86 |
| ChatGPT-bundled Codex `/Applications/ChatGPT.app/Contents/Resources/codex` | 0.153.4 |
| npm Codex JavaScript wrapper | Not executed; interpreter/dependency tree is not pinned |

The shell found Homebrew Claude first. The isolated Electron smoke found native
Claude first. A single resolver does not make differing process environments
identical. Explicit launch selection and identity revalidation are still needed.
Fable 5.1 is already in the picker; the native Claude version meets the previously
documented 2.1.255 minimum. Neither version nor picker presence proves entitlement.

## Probe boundary

The probe accepts only a fixed `--version` operation for native macOS entrypoints.
It opens a bounded regular file without following a final symlink, copies from
that open descriptor to a private scratch location, verifies the copy against the
inspected SHA-256, makes it read/execute-only and runs that copy. It does not run
an interpreter, login shell, auth-status command, helper, installer or AI session.

The existing deny-by-default offline Seatbelt boundary supplies an empty HOME,
allowlisted environment and denied networking, including loopback. Missing or
incompatible isolation fails the diagnostic; there is no unrestricted fallback.
Execution has a five-second timeout and 8 KiB output limit. Only a strict version
shape is returned, never raw stdout/stderr. The exact private executable copy is
removed afterward; small scratch directories are retained. The user's executable
and settings remain untouched. This is byte identity, not publisher attestation
or an authenticated subscription launch receipt.

## Investigation finding

Claude 2.1.263 reports its version under the strict sandbox but its fuller help
initialization is killed. `codesign --verify` reports the original valid on disk.
A separate help-only diagnostic with network and personal-home reads denied but
broader OS permissions succeeds. The precise missing OS permission is unresolved;
that diagnostic profile is **not** used in production or for any agent launch.
The subsequent [profile investigation](2026-09-06-subscription-profiles.md) resolved
the missing dependency to `/usr/share/icu`; only that OS data directory was added
to the deny-by-default boundary. The broader diagnostic allowance was discarded.

Installed help confirms `--bare` excludes subscription OAuth/keychain and expects
API authentication, so it must not be used as a subscription isolation shortcut.
`--restricted`, `--safe-mode`, `--setting-sources`, and strict MCP controls are
available but still require a tested subscription-specific launch composition.
See [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) and
[configuration sources](https://code.claude.com/docs/en/settings). Merely passing
flags does not prove the authentication or no-overage boundary.

## Verification

- 224 root tests pass under Electron, including five new probe tests. A compiled
  synthetic native executable verifies fixed arguments, missing inherited API
  credentials, denied outside-file access and zero connections to a real local
  test server. Other cases cover scripts, symlinks, changed bytes, unsupported
  platforms and strict output parsing. No test makes an inference request.
- Node and renderer typechecks and the Electron build pass.
- Actual desktop Settings inspection displays both Claude versions and digests,
  with no page errors. `listPtys()` returns `[]`. The isolated smoke instance was
  terminated through its own process handle; no user app or worker was stopped.
- Screenshots inspected at [1440×870](assets/2026-09-05/17-provider-versions-mac.png)
  and [1920×1080](assets/2026-09-05/18-provider-versions-1920.png). The fixed-width
  Settings pane remains legible and scrolls internally, with no document overflow.
  Its information density and duplicated hold explanations still merit a later
  UX pass. This is not acceptance of the operating-system-wide visual hierarchy.
- Logs: `/tmp/operatus-version-tests.log`, `/tmp/operatus-version-typecheck.log`,
  `/tmp/operatus-version-build.log`. Inspection took about 18 seconds in the
  Electron smoke; large-binary copying/hashing is asynchronous but noticeable.

## Next gate

Select and persist an exact approved executable identity, establish controlled
subscription-only provider configuration/authentication, test refusal on API
credentials and quota exhaustion, then prove real pass and repair Gauntlets.
The runtime hold remains active. No inference smoke, installed-app update,
release, deployment or full-readiness claim follows from these diagnostics.
