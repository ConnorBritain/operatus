# Host environment hardening and launch integration trace

## Change

Visible and hidden CLI PTYs no longer copy the entire host environment. They
start from a small compatibility allowlist of OS paths, identity, temporary
directory, locale and terminal variables. Unknown ambient variables are omitted
even when their names do not resemble credentials. This excludes opaque tokens,
custom provider configuration, inherited Hive identity, SSH-agent sockets, proxy
settings and runtime injection variables from automatic inheritance.

Explicit per-agent environment additions remain separate. Both PTY paths apply
the existing credential scrubber after this merge, so recognized API credentials
and injection variables cannot be restored through an override. The hidden path
previously lacked this final scrubbing step. Its comment no longer claims that
interactive transport itself proves subscription billing.

Personal HOME and platform configuration paths remain in this compatibility
allowlist. Arbitrary explicitly supplied environment values are not made safe by
the host allowlist. This is defense in depth in a held legacy path, not an admitted
provider runtime, credential broker, filesystem sandbox or network restriction.

## Trace from run to executable

Inspection of the current implementation establishes the remaining integration
work. `advanceGauntlet` stops at the global subscription hold before preparing
work. Otherwise, `spawnPreparedGauntlet` selects a provider preset, builds role
arguments, materializes skills in a Hive agent home, and calls `spawnAgentCore`.
That path checks lifecycle ownership and the billing hold before legacy
installation/provisioning, then ultimately uses `PtyManager.spawn`, which has
its own hold and environment filtering.

The isolated subscription profiles and account components are not consumed by
this path. In particular, the legacy credential scrubber drops both
`CLAUDE_CONFIG_DIR` and `CODEX_HOME`. Passing the prepared profile as an ordinary
environment override would therefore remove its provider-home selection, not
establish confinement. A replacement main-owned launcher must consume an
explicit validated environment without a legacy merge or silent field removal.
Do not solve this by removing the scrubber or lifting the hold.

The replacement still needs to bind exact executable identity, account receipt,
profile/configuration identity, role capability, expected Git artifact and
launch/session identity, and enforce filesystem/network restrictions throughout
execution. Private profile preparation and OAuth status are components, not that
combined proof. Real account credentials were not accessed in this pass.

## Verification

`test/agent-environment.test.cjs` verifies unknown ambient-variable exclusion,
Windows-key casing compatibility, explicit Hive identity, final override
scrubbing and non-mutation of the source environment. A second test calls the
actual visible and hidden launch functions with a fake `node-pty` primitive,
capturing their final environment and throwing before any process starts.
Its test-only hold substitution is confined to that test process and restored;
production has no bypass. No real CLI or inference runs in this test.

All 289 root tests pass with zero skips, including explicitly digest-pinned
offline native CLI probes. Main/preload and renderer typechecks, Electron build
and `git diff --check` pass. No UI changed, so this pass adds no new visual
acceptance claim. No deployment, push, merge or release occurred.

## Documentation boundary

Official OpenAI documentation was fetched again for the configuration and
authentication boundary. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
defines `forced_login_method` as an authentication-method restriction. The
[authentication guide](https://learn.chatgpt.com/docs/auth) documents separate
ChatGPT and API-key login routes. Neither fact is being treated here as proof
that a live session cannot consume available credits. The previously recorded
Codex credit-spending uncertainty remains unresolved; the user's confirmed
disabled extras/top-ups are not being changed or contradicted.

The global subscription launch hold remains enabled. Concurrent live Gauntlets,
full provider containment, and owner-operator workload acceptance remain open.
