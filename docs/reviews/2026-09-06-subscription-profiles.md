# Controlled subscription-profile preparation

## Result

Profile preparation and genuine-CLI offline negative tests now exist. They are
not wired into the held legacy spawn path and do not authorize live inference.
They replace assumptions about flags with observed behavior and establish the
configuration layer the subscription credential/admission broker must consume.

The preceding turn was progress: version diagnostics reached the actual desktop
Settings UI. This follow-up targets configuration/authentication directly. Full
Gauntlet acceptance and the owner-operator workload exercise remain incomplete.

## Implemented

- `prepareSubscriptionProfile` creates a new private home and temp directory,
  writes app-authored read-only configuration, and returns an allowlisted
  environment with no inherited credentials or user configuration. No credential
  file, symlink to a personal home, package directory or remote daemon is created.
- Claude uses restricted mode, no user/project/local settings sources, an explicit
  settings file, disabled hooks/connectors, and strict MCP with no configured
  servers. `CLAUDE_CODE_TMPDIR` keeps its internal files inside the profile;
  ordinary `TMPDIR` alone does not do that on macOS.
- Codex uses forced ChatGPT login, the file credential store, first-party provider,
  no login shell, a read-only default sandbox, no approval prompts, and disabled
  hooks, apps, shell snapshots, remote plugins and nested agents. The genuine
  app-server accepted this configuration with `--strict-config` and returned the
  exact isolated CODEX_HOME during a protocol initialization handshake. No thread
  or model turn was created.
- Profile receipts record the configuration digest and explicitly state absent
  credentials and `launchAllowed: false`. File modes are defense in depth, not
  immutability against a same-user process; eventual launch confinement and
  revalidation must protect the profile separately from the artifact worktree.
- Native copying is shared between version and offline-auth tests: read from one
  bounded, no-follow file descriptor, write an exclusive private copy, verify its
  inspected digest and make it executable. Tests remove only their private copy.
- Claude auth-status classification rejects API/provider mismatches regardless
  of exit status. OAuth labels produce only `subscription-hint`, never validated
  authentication, entitlement, or billing admission.

## Findings that changed the implementation

1. Claude 2.1.263 requires OS ICU data to initialize more than its version handler.
   Allowing `/usr/share/icu` resolves its immediate sandbox SIGKILL. No broad
   `/usr/share`, `/Library`, personal-home, network or Mach-service allowance was
   retained. Existing outside-file/symlink and loopback-denial tests still apply.
2. An invalid synthetic `ANTHROPIC_API_KEY` makes Claude `auth status` return exit
   0, `loggedIn: true`, `authMethod: api_key`, and `forcedLoginMethod: claudeai`.
   This is a local credential-source report, not server authentication. Testing
   `forceLoginOrgUUID` did not make this status command an admission check either.
3. `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` suppresses the stored subscription
   OAuth path in this CLI. With the same synthetic credential file it reports
   no login; without that variable it reports `authMethod: claude.ai`. The variable
   is excluded from our profile, as is API-oriented `--bare` mode.
4. A synthetic, nonfunctional OAuth record also produces a logged-in hint. That
   proves why recognizing the OAuth path cannot replace live account validation.
5. Codex 0.153.4 rejects the synthetic API auth file under forced ChatGPT login.
   It rejects `--strict-config` on the `login` command itself, so strict config is
   tested through a separate app-server initialization handshake, not omitted and
   claimed validated. No account logout command was used on a personal profile.
6. Claude's variadic `--mcp-config` can consume following subcommand words as
   filenames. The profile uses strict MCP without that argument; `auth status`
   remains a subcommand rather than ambiguous prompt/config input.

Primary references: [Claude authentication](https://code.claude.com/docs/en/authentication),
[Claude environment controls](https://code.claude.com/docs/en/env-vars),
[Claude CLI reference](https://code.claude.com/docs/en/cli-reference),
[Codex authentication restrictions](https://learn.chatgpt.com/docs/auth#enforce-a-login-method-or-workspace),
and [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
The findings above are observations of the pinned installed binaries, not claims
that every CLI release or platform behaves identically.

## Reproduction and limits

`test/subscription-provider-offline-smoke.test.cjs` is opt-in and requires explicit
`OPERATUS_CLAUDE_PROBE_PATH` / `OPERATUS_CLAUDE_PROBE_SHA256` and/or
`OPERATUS_CODEX_PROBE_PATH` / `OPERATUS_CODEX_PROBE_SHA256`. It runs only on macOS
under the offline boundary. Omitted executable paths skip those tests; no default
CI installation, personal credentials or subscription capacity is required.
The exact paths/digests used are in the preceding version review and test command
history. Never substitute a plain PATH-discovered executable or omit its digest.

Tests use synthetic tokens, a project API-key/helper injection, private profiles,
and a network-denying sandbox. They assert ignored project helpers, profile
isolation, source classification, and Codex's API rejection. Routine tests also
cover directory/file permissions, configuration digests and absent inherited
credentials. Neither a model response nor a true authenticated subscription is
asserted. No visual UI changed in this pass.

Evidence logs: `/tmp/operatus-profile-tests.log`,
`/tmp/operatus-profile-typecheck.log`, `/tmp/operatus-profile-build.log`.
The full Electron-hosted root suite passed **229 tests with zero skips**, including
both opt-in native-provider cases. Node/web typechecks and the Electron build pass.

## Next required work

Build the main-owned subscription credential/admission broker, validate real
account identity and subscription route without a model request, enforce quota
exhaustion as a stop, and protect the profile from worker configuration changes.
Then connect the prepared, exact-identity provider process to the Gauntlet launch
path, excluding the legacy personal-config copy, auth symlink and optional remote
daemon setup. Do not merely turn off the existing global hold.

Windows/Linux profile containment, cross-machine quota coordination, live pass
and repair/re-critique, and the full operator/visual workload smoke remain open.
