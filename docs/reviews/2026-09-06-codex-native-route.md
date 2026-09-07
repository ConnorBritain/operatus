# Codex native subscription-shaped route probe

Date: 2026-09-06. This is a real installed Codex process talking only to a
rejecting local HTTP/WebSocket observer with synthetic credentials. No real
account was read, no request was forwarded, and no inference was performed.
The global subscription launch hold remains enabled.

## What changed the next implementation step

The pinned Codex executable can use its built-in `openai` provider with
file-based ChatGPT authentication through a loopback model endpoint. A custom
API-key provider or undocumented external-token login is not needed to establish
this transport shape. The production Codex adapter is still missing.

Two separate URL settings matter:

- `chatgpt_base_url` redirects account/settings-related requests, but did not
  redirect model requests in the first actual probe.
- `openai_base_url` additionally redirected model catalog and Responses
  WebSocket/HTTP requests while retaining the synthetic ChatGPT bearer and
  account header. No API key was supplied or observed.

The first probe, retained at
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-codex-route-UCR6eJ/receipt.json`,
failed its routing assertion and required the bounded 25-second kill. Its model
connection attempts still targeted the public service and were blocked by the
mandatory outer Seatbelt boundary. This failure is not a successful smoke.

The corrected probe passed. It also showed that a single turn can attempt many
requests before reporting failure: the final rerun observed 14 WebSocket
handshakes and 12 HTTP POST attempts after local 401 responses, plus four
catalog/settings GETs. Exact retry counts are observations, not a stable
contract. Automatic refresh attempted the public OAuth endpoint and failed
under the outer network denial. A future gateway must bound all transports,
reject refresh/alternate routes, and revoke on cancellation; a turn counter
alone is insufficient.

The native process exited **0** while `turn/completed` said **failed**. Native
process exit must never stand in for a successful Critic result.

## Profile fix

Added `features.plugins = false` and `analytics.enabled = false` to the private
app-owned Codex profile. The initial profile, despite disabling remote-plugin
catalog and apps, still attempted plugin discovery and analytics. The corrected
native rerun observed neither. The observer rejects every endpoint, and the
outer sandbox independently denies external networking; absence in this trace
does not establish a complete side-channel audit.

No production routing override, credential copy, model substitution or release
hold change was introduced. Local URL overrides and fake tokens exist only in
the opt-in test.

## Sources and version boundary

The OpenAI Docs skill guided official-source inspection before implementation:

- [App-server protocol and auth](https://learn.chatgpt.com/docs/app-server):
  initialization, thread/turn lifecycle, structured terminal state, and account
  authentication modes.
- [Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#azure-provider-and-per-provider-tuning):
  use `openai_base_url` for the built-in provider, not a reserved provider-ID
  override.
- [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference):
  separate ChatGPT URL, analytics and plugin configuration.

Current docs describe experimental external ChatGPT tokens, but the previously
generated schema from this exact installed build marks that login shape
internal-only. We did not use it. The probe uses only synthetic `auth.json`
tokens in a newly allocated private home.

Executable: `/Applications/ChatGPT.app/Contents/Resources/codex`, version
0.153.4, pinned SHA-256
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.
Each probe copies/verifies that binary before use and removes only its owned
temporary executable afterward; profiles and diagnostic receipts are retained.

## Reproduction and final evidence

```sh
OPERATUS_CODEX_PROBE_PATH=/Applications/ChatGPT.app/Contents/Resources/codex \
OPERATUS_CODEX_PROBE_SHA256=a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629 \
node --test test/codex-local-route-probe.test.cjs \
  test/subscription-provider-offline-smoke.test.cjs \
  test/subscription-profile.test.cjs test/codex-account-admission.test.cjs
```

Result: **14 passed, 0 failed, 1 skipped**. The skip is the unrelated opt-in
Claude binary smoke; no Claude probe path was supplied in this run. Both real
Codex tests ran. Node typecheck and `git diff --check` passed.

Final receipt:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-codex-route-2drgp1/receipt.json`.

- Actual thread: `01a07843-c804-7ab3-9ab8-cd86c74385da`.
- Actual turn: `01a07843-c80f-76c0-9a56-4edc41bc4f7d`.
- 30 local requests; all observed authentication was the expected synthetic
  ChatGPT bearer/account pair, with no API-key header.
- Terminal turn `failed`, native exit 0, no timeout.
- Artifact read-only, Git metadata write denied, one local network port allowed,
  `launchAllowed: false` throughout.

## Still required

1. A successful scripted native Codex response/tool cycle through a main-owned
   local gateway, including bounded compressed HTTP bodies and WebSocket frames.
2. Fresh Critic identity, exact review evidence, native read-only tooling,
   structured report validation, lifecycle/revocation and runner integration.
3. Proven safe real-account admission and real Claude-plus-Codex judgments.
   Synthetic token shape and local success cannot prove subscription availability
   or prohibit spending existing credits.
4. The agreed unlocked-Mac visual and concurrent real-project acceptance.

This probe does not satisfy any of those acceptance gates or establish that
`gpt-5.6-sol` is currently usable on the real account; its request was rejected.
