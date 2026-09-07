# Claude credential boundary and local gateway

## Scope

This is a main-process component for the eventual isolated launch path. It is **not connected to production spawning**, does not lift the global hold, and does not establish full subscription billing admission. No real provider credential, metadata request, or inference request was used in this verification pass.

The worker's local bearer and the subscription OAuth credential are now separate capabilities. The local bearer authorizes one per-launch localhost gateway; it is useless as an Anthropic credential. The actual account credential remains on the main-process side, supplied only after fresh account verification. Anthropic describes this external credential-injection pattern in its [secure deployment guide](https://code.claude.com/docs/en/agent-sdk/secure-deployment). Its [authentication reference](https://code.claude.com/docs/en/authentication) describes credential precedence and custom endpoints. Those documents motivate the boundary; neither is proof of no-overage billing or of this implementation's correctness.

## Implemented behavior

`openClaudeSubscriptionGateway` binds an ephemeral IPv4 loopback port and generates a random bearer. Its configured model and account identity are captured at creation; a later caller mutation cannot broaden the model assignment.

- It accepts only authenticated streaming JSON Messages requests for the exact assigned model. A native startup `HEAD /api/hello` is answered locally without model forwarding.
- It refuses browser origins, alternate Host authorities, duplicate headers, API-key/proxy-auth headers, compressed requests, other paths, HTTP CONNECT and upgrades.
- Every forwarded request obtains a fresh `ClaudeAccountAdmission` receipt. Active Max and disabled extra usage must still be observed, and account/organization hashes must match the original identity. The gateway revokes each newly issued receipt when its request ends.
- Only a short allowlist of native protocol metadata is forwarded. Real authorization is constructed from the main-owned account lease, not from client headers.
- The default transport has one fixed HTTPS destination, `api.anthropic.com:443/v1/messages?beta=true`, with certificate validation and a dedicated agent. It has no redirect following, destination override, API-key fallback, or automatic retry.
- Limits are explicit in the gateway receipt: one in-flight request, 128 admitted requests by default, a two-minute request deadline by default, 4 MiB input and 16 MiB output caps. Count/deadline configuration is bounded. These are transport limits, not a claim about billing or project capacity.
- Cancellation aborts model transport and closes local connections. An account check that finishes after close cannot trigger forwarding. Metadata verification currently retains its own bounded lifecycle; gateway close does not cancel an already-running metadata GET.
- Upstream errors are reduced to a generic message; client-error statuses are preserved so a 401 does not become a retryable 502. Redirects and server errors become 502. Unexpected MIME is rejected, and overlarge/truncated streams fail visibly instead of being treated as model success.

The worker can invoke its own gateway capability through child tools, so this is not a tool-origin authentication claim. Containment must still prevent direct external network access, and the full launch must enforce the run/role/artifact contract separately. Assignment to a model is also not, by itself, proof of that model's subscription entitlement.

## Verified with synthetic data

**35 focused tests passed**, covering account admission, the gateway, executable identity, isolated process boundaries, profile configuration and the global billing hold. Gateway tests use real localhost HTTP clients with fake metadata and fake upstream responses. They test wrong credentials/models/routes/origins, changed identity, enabled extra usage, request count and size limits, forged receipts, timeout/concurrency, cancellation during account verification, upstream status/MIME/size handling, and fixed HTTPS transport options without opening an external connection.

The pinned native **Claude Code 2.1.263** probe also passed with **zero skips**. Executable SHA-256: `ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9`.

That probe placed only the random local bearer in an isolated synthetic OAuth profile and ran the real CLI inside the Mac outer sandbox. Claude requested `claude-fable-5-1`; the gateway passed a different, main-only synthetic credential to a fake upstream. The fake upstream rejected every call with 401. Claude exited normally with failure, no API-key header was forwarded, and its output/profile did not contain the main-side synthetic credential. This verifies native routing and credential separation, **not a model response, Write/Bash tool execution, successful Max authentication, or a complete Gauntlet loop**.

Native probes now check for enough space to copy the executable while retaining a 256 MiB reserve. The older direct-local-observer rerun skipped because disk space had fallen again; it is not counted as a passing native test. The newer composed-gateway probe did execute and pass. Both probes remove only their own temporary binary copy.

## Remaining gates

1. Extend actual native tool verification to Repairer/Conductor. A [subsequent tool pass](2026-09-06-claude-native-tools.md) fixed Bash/tool-list and environment-token blockers and proved the native worker commit. The [expanded Critic/session-binding check](2026-09-06-native-critic-lifecycle.md) subsequently passed and exposed premature working-directory cleanup, now removed. Production composition and live-provider acceptance remain open.
2. Compose executable selection, immutable profile, gateway, control helper, exact artifact identity, process-tree ownership and teardown into the production launch path. Do not send isolated homes through the legacy scrubber that removes their configuration overrides.
3. Verify real subscription admission and provider entitlement/no-overage behavior before authorizing inference. The user's confirmation that paid extras/top-ups are disabled remains respected; this component never changes billing settings.
4. Resolve the separate Codex existing-credit restriction. This Claude component cannot establish Codex readiness.
5. Run the actual conducted loop and concurrent cross-project acceptance, retaining exact artifacts, fresh Critics and explicit Conductor acknowledgments. Synthetic upstream responses cannot satisfy those gates.

Sources: `src/main/claudeSubscriptionGateway.ts`, `test/claude-subscription-gateway.test.cjs`, `test/claude-native-gateway.test.cjs`. Logs: `/tmp/operatus-claude-gateway-final.log`, `/tmp/operatus-claude-native-gateway.log`, `/tmp/operatus-claude-local-route-final.log`.

Both node and web typechecks and the Electron build passed. `git diff --check` passed. Inspection confirms there is no gateway wiring in the production main entrypoint, preload or renderer. Retained test evidence: [native gateway probe](assets/2026-09-06/claude-gateway/native.tap) and [focused suite](assets/2026-09-06/claude-gateway/focused.tap). The root suite and live-provider acceptance were not run in this pass.
