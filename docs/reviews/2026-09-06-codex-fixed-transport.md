# Codex fixed subscription transport

Date: 2026-09-06. **Scripted native integration, not live subscription admission.**
The global launch hold remains unchanged. No real credential was read or used.

## Change

`codexSubscriptionTransport.ts` implements the provider-facing side of the
[local credential gateway](2026-09-06-codex-subscription-gateway.md). Its only
destination is `chatgpt.com:443/backend-api/codex/responses`, over HTTPS or WSS.
It supplies explicit TLS certificate validation, server name and a private
non-pooling HTTPS agent. Caller routing, proxy, API-key and alternate-auth headers
are not forwarded. There is no destination, CA or proxy configuration, redirect,
retry, token refresh or metered-provider fallback in this adapter.

HTTP rejects non-200 responses and unexpected compression/content types without
relaying the upstream error body. It bounds request/response bytes and closes
the request on cancellation, streaming failure or consumer completion. A
ten-second header deadline is separate from the stream deadline. The gateway's
configured deadline governs each exchange; the transport adds a thirty-minute
absolute ceiling, matching the gateway's largest permitted timeout.

WebSockets retain one provider connection across sequential exchanges, with one
active response owner. Overlap, cancellation, early consumer return, malformed,
binary or oversized events permanently revoke the connection. Queue limits and
pause/resume provide backpressure; total response and event-count ceilings remain.
Provider errors are reduced to a generic transport error. Closing the connection
prevents subsequent local sends; it does not undo work already accepted remotely.

The gateway still requires explicit transport composition. This adapter is **not
yet connected to the application's native Critic lifecycle** and is not itself
an authentication or launch-authority component.

## Evidence

- **44 focused tests passed under Electron, zero skips**, covering account
  admission, profiles, gateway/stream validation and 13 transport cases. These
  include real local HTTP/WebSocket framing, persistent exchanges, handshake and
  mid-stream cancellation, early return, response limits, overlapping ownership,
  malformed data and redirect refusal.
- **All six native Codex tool scenarios passed, zero skips**, with the terminal
  Node harness: direct WebSocket, compressed HTTP, gateway WebSocket/HTTP, and
  gateway plus fixed-adapter WebSocket/HTTP. Every scenario read real test evidence
  and was OS-denied both an artifact write and an outside credential read.
- The two new assembled native cases also passed under Electron's Node runtime.
- Node and renderer typechecks and `git diff --check` passed. No new GUI
  acceptance or release packaging was performed in this slice.

The fixed-adapter tests intercept **only the lowest-level HTTPS request** after
asserting its real production destination/TLS options, then deliver it to a
disposable local HTTP server. All credentials and model responses are synthetic.
The production adapter exposes no test destination override. This proves native
framing, routing options, credential separation and local cancellation, **not a
successful public TLS handshake, live service compatibility, model availability,
independent judgment or a provider-enforced credit-spend prohibition**.

Final receipt parent:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.

| Native path | Receipt directory | Native thread |
| --- | --- | --- |
| Fixed adapter, WebSocket | `op-codex-tools-7H6hSl` | `01a0786c-8061-76c1-bedd-93f72f85c0e3` |
| Fixed adapter, HTTP | `op-codex-tools-yTDpG7` | `01a0786c-90f5-7c40-9a0b-18045140545e` |

The fixtures removed their own two pinned executable copies; receipts and small
synthetic profiles remain. Earlier Electron receipts are `op-codex-tools-nCzLfv`
and `op-codex-tools-nnTvlY`. Native executables and hashes are unchanged from the
[native tool verification](2026-09-06-codex-native-tools.md).

Reproduce focused tests with `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron
--test test/codex-subscription-transport.test.cjs test/codex-response-stream.test.cjs
test/codex-subscription-gateway.test.cjs test/codex-account-admission.test.cjs
test/subscription-profile.test.cjs`. Use the pinned binary environment variables
from the native tool verification with `node --test test/codex-native-tools.test.cjs`
for all six scenarios, or Electron with `--test-name-pattern=gateway-fixed` for
the two assembled paths.

OpenAI Docs guided configuration checks using the fetched
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
The installed native route probe and binary supply the subscription route
evidence; the public reference is not a billing or private-route compatibility
contract.

## Next acceptance work

Implement a fresh Codex Critic session adapter that binds actual native
thread/turn identity and structured output to its assigned artifact and launch.
Transfer gateway ownership to that lifecycle, including cancellation and restart
reconciliation. Then compose it into the mixed Claude/Codex isolated runner
without substituting a Claude Critic. Live no-paid-credit admission and real
judgment/visual acceptance remain separate required gates.
