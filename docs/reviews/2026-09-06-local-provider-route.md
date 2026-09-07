# Restricted local provider route probe

Date: 2026-09-06. Claude Max is the user's confirmed subscription. Paid extras remain disabled; no account setting was changed. The global provider launch hold remains active.

## Scope and result

The outer Mac process boundary now optionally permits one main-owned IPv4 loopback port. This is a preparation capability, not launch admission. Without it, the existing external-network denial remains unchanged. The main-owned control socket can still be granted separately.

Real sandboxed child-process tests verify that the designated localhost HTTP server is reachable, a different local listener accepts zero connections, and a documentation-only non-loopback address cannot be reached. Invalid ports fail before profile generation. The new positive control exposed a weakness in an older test: macOS curl failed while reading its denied OpenSSL configuration before attempting a connection. That test now uses Bash's TCP redirection, so it actually exercises the network boundary.

The opt-in native probe copies and hashes Claude Code **2.1.263** (`ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9`), supplies only a synthetic OAuth fixture in an isolated profile, and directs it to an HTTP observer on the permitted local port. The observer rejects every request with HTTP 401 and never forwards anything. No real credentials, provider response, model inference, or subscription capacity are involved.

Initially the native process reached only `HEAD /api/hello`, then exited with SIGKILL. A local crash report showed an EXC_BREAKPOINT/Foundation termination and ICU-related context; it did not establish an out-of-memory kill. Adding read-only access to OS timezone data under `/private/var/db/timezone` resolved the observed failure. No Keychain, personal configuration, broad filesystem or Mach-service permission was added.

The successful probe then observed `POST /v1/messages?beta=true` requests selecting `claude-fable-5-1`, using the synthetic bearer and no `x-api-key` header. Claude exited unsuccessfully on the observer's deliberate rejection. Request bodies and credential values are not printed; diagnostic records contain route, header names, authentication classification and model only.

## What this does not prove

- This does not prove successful Max authentication, billing behavior, a model response, tool use, or a conducted Gauntlet cycle.
- Any child tool inherits the local port capability. A future gateway must independently authenticate and validate each request, fix upstream destinations and credential origin, reject alternate billing paths, bound traffic, and stop with the launch. A localhost port alone is not a credential boundary.
- Synthetic credential files in this probe are not a decision to expose real subscription credentials to agents.
- Production launch composition, fresh account admission and teardown remain unfinished. The receipt still reports `launchAllowed: false`.
- The Codex existing-credit restriction remains unresolved. Available credits are not evidence of enabled top-ups or purchased credits; no billing settings were altered.

Anthropic's [secure deployment guide](https://code.claude.com/docs/en/agent-sdk/secure-deployment) describes credential injection outside the agent, and its [authentication reference](https://code.claude.com/docs/en/authentication) documents credential precedence and custom endpoints. Neither alone proves a subscription-only billing guarantee. The inspected [Codex pricing documentation](https://learn.chatgpt.com/docs/pricing) describes credit continuation after included limits; no prohibition on spending existing credits was found in the inspected [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). That is a documented research gap, not proof that no such control exists.

## Reproduction

Standard process-boundary tests run with `node --test test/subscription-sandbox.test.cjs`. The native probe is opt-in via `OPERATUS_CLAUDE_PROBE_PATH` and `OPERATUS_CLAUDE_PROBE_SHA256`, then `node --test test/claude-local-route-probe.test.cjs`. It never downloads a CLI or uses a personal credential store. Its large private binary copy is removed on completion, while small diagnostic fixtures remain.

The native probe passed once after the timezone permission was added. A later rerun, after strengthening exact synthetic-token/model and normal-exit assertions, failed during binary copy before launching Claude. That version has not yet been successfully rerun. The Mac reported about 231 MiB free at the subsequent disk check. No user files were removed to make room.

That failed copy exposed descriptor cleanup masking the original stream error with EBADF. `executableIdentity.ts` now transfers descriptor ownership to its read streams and awaits cleanup rather than double-closing. A small non-executable fixture verifies successful digest/copy, repeated exclusive-destination errors preserving EEXIST, unchanged source/destination bytes, and digest mismatch. This does not independently prove that low storage caused the original stream error.

Final focused verification: **21 integrated tests passed**, including real isolated control-helper transport; **8 final identity/boundary tests passed**, including the new copy-error regression. Both node and web typechecks and the Electron build passed before the descriptor correction; the node typecheck passed again afterward. A complete root suite, final post-correction Electron rebuild, and strengthened native probe remain pending. No visual or live-provider acceptance is implied.

Local logs: `/tmp/operatus-claude-local-route.log` now contains the latest copy failure, `/tmp/operatus-local-gateway-integrated.log`, `/tmp/operatus-local-gateway-final-tests.log`, `/tmp/operatus-local-gateway-types.log`, `/tmp/operatus-local-gateway-final-types.log`, and `/tmp/operatus-local-gateway-build.log`. The earlier successful request observation is recorded in this task's tool output.

Later follow-up: the [composed credential-gateway native probe](2026-09-06-claude-subscription-gateway.md) passed with the corrected copy lifecycle, exact model/token checks and normal error exit. This older direct-observer test gained a free-space guard; its follow-up run skipped before copying, as recorded in `/tmp/operatus-claude-local-route-final.log`. These are separate results, not a claim that the skipped test ran.
