# Codex main-owned gateway boundary

Date: 2026-09-06. This is isolated native transport evidence, **not live model,
billing, visual, or Gauntlet Critic acceptance**. The global launch hold remains.

## Implemented

`codexSubscriptionGateway.ts` now owns a per-launch loopback HTTP/WebSocket
capability. The native worker receives only a synthetic local bearer and local
account identifier. The main process resolves an instance-issued admission
receipt and checks account identity, plan, capacity and credit metadata again
before each request/frame. The provider-side credential stays in the main-side
transport. All tests use synthetic accounts and scripted provider responses.

The boundary rejects alternate auth, browser origins, host/routing changes,
unexpected paths, other models, non-default service tiers, compressed inbound
bodies and malformed requests. HTTP and WebSocket share one active-request slot
and a bounded launch budget. Persistent WebSockets recheck each frame; a changed
credential closes the connection instead of silently inheriting uncertain context.
Shutdown aborts pending work and waits for drain. An upstream close failure or
undrained request produces **unconfirmed revocation**, not a successful receipt.

The new response-stream module parses complete bounded SSE events, with fatal
UTF-8 validation, before exposing data. Both protocols reject recognized provider
errors, incomplete or malformed completions, oversized payloads and trailing
events. Completion is withheld until the exchange ends cleanly. HTTP discards
comments/retry metadata and returns a bounded generic error on stream rejection.
Ordinary deltas still stream. These checks validate protocol completion, not the
truth of a model's output or success against a frozen bar.

## Electron compatibility

Electron's Node 20.18.1 lacks the terminal Node 22 zstd decoder. The private,
app-authored Codex config therefore disables `features.enable_request_compression`.
Native HTTP fallback is verified uncompressed under Electron itself. The older
direct compressed-route fixture retains an explicit test-only opt-in under Node 22.
No user-wide Codex configuration was changed.

`ws` 8.21.0 and its TypeScript definitions are now direct pinned dependencies,
rather than relying on the tunnel package's transitive WebSocket version.

The OpenAI Docs skill informed the protocol checks using the fetched
[streaming-event reference](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.completed).
The earlier fetched [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents the compression setting. Neither document establishes a no-paid-credit
guarantee or live acceptance of this private subscription route.

## Verification

- **31 focused tests passed under Electron, zero skips**: admission, private
  profiles, gateway ownership/revocation and bounded response parsing.
- **Two fresh native Codex gateway scenarios passed under Electron**. The two
  unrelated direct-route scenarios were intentionally skipped by the name filter.
  Each selected scenario executed three actual native commands: read evidence
  (exit 0), attempt artifact write (exit 1, OS denial), attempt outside credential
  read (exit 1, OS denial). Each then produced a completed native turn with
  correctly bound command items. The final response was scripted, not inferred.
- Node and renderer typechecks, Electron production build and `git diff --check`
  passed. Existing large renderer bundle and dynamic-import warnings remain.
  The build does not imply that the new gateway has been composed into launch.

Retained receipt parent:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.

| Case | Receipt directory | Native thread | Admission checks |
| --- | --- | --- | --- |
| Persistent WebSocket | `op-codex-tools-g9KUOU` | `01a07862-49b9-70e1-8ef2-8c52de172da5` | 6 including initial admission |
| HTTP fallback | `op-codex-tools-UwEcbo` | `01a07862-646b-7b22-8ce5-030a6dc3c9ce` | 5 including initial admission |

The fixtures removed only their two owned native executable copies. Receipts,
synthetic profiles and test artifacts remain. No real credentials were used,
no external inference was sent, and no installation or release was published.

Reproduce:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/codex-response-stream.test.cjs test/codex-subscription-gateway.test.cjs \
  test/codex-account-admission.test.cjs test/subscription-profile.test.cjs

OPERATUS_CODEX_PROBE_PATH=/Applications/ChatGPT.app/Contents/Resources/codex \
OPERATUS_CODEX_PROBE_SHA256=a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629 \
OPERATUS_CODEX_HOST_PROBE_PATH=/Applications/ChatGPT.app/Contents/Resources/codex-code-mode-host \
OPERATUS_CODEX_HOST_PROBE_SHA256=fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b \
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  --test-name-pattern=gateway test/codex-native-tools.test.cjs
```

## Remaining release gates

Subsequent progress: the [fixed provider transport](2026-09-06-codex-fixed-transport.md)
has now been implemented and exercised with synthetic native traffic. The
paragraph below records the boundary at this review's original verification;
native Critic lifecycle composition and live admission remain open.

The transport remains an explicit required injection: **no production fixed-host
HTTP/WebSocket forwarding implementation or native Critic lifecycle composition
is supplied by this module**. Next work must implement that transport, bind actual
native thread/turn identity and output to a fresh Critic launch, and connect its
revocation to run cancellation/recovery. Preserve the default Codex Critic; do
not substitute Claude to make the loop pass.

Live Codex credit-spend admission remains unresolved. The user's disabled paid
extras/top-ups are respected; no account changes or inference-based billing tests
are authorized by this work. Actual independent judgments, full mixed-provider
Gauntlets and visual owner-operator acceptance remain required.
