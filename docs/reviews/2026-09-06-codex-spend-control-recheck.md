# Codex spending-control recheck

Date: 2026-09-06. Read-only documentation/executable inspection; no account data read, inference, credit redemption or settings change in this pass.

## Finding

An enforceable prohibition on spending existing credits is still unverified. Do not treat a subscription login, available quota, a disabled API-key route or periodic quota polling as that prohibition. The existing conservative account admission and global release hold remain unchanged. This is not a claim that such a provider-side control cannot exist.

## Current sources inspected

- [Official pricing](https://learn.chatgpt.com/docs/pricing#what-are-tokens-and-credits) states that available credits can extend work after included limits are reached.
- [Official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) contained no matches for credit or billing in the fetched page. No no-credit-spend setting was identified there.
- [Official app-server account surface](https://learn.chatgpt.com/docs/app-server#auth-endpoints) documents account/usage reads, reset-credit consumption and credit-notification operations. These are not a no-spend capability.

The OpenAI Docs skill constrained source selection to official documentation. Searches and actual fetched pages did not establish a safe override, so no override was introduced.

## Installed-client evidence

The bundled `/Applications/ChatGPT.app/Contents/Resources/codex` still reports 0.153.4 with SHA-256 `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.

Generated the installed client's experimental JSON protocol schema in an empty temporary HOME/CODEX_HOME using `app-server generate-json-schema --experimental`. No server/session or account login was started. Retained schema root: `/tmp/operatus-codex-schema-K0pNyW/schema` (5.2 MiB).

- `v2/ThreadStartParams.json`: SHA-256 `25f490368ec6df52a2a3b82a5469d2413307eb93439121b309f415b5648eee7a`.
- `v2/TurnStartParams.json`: SHA-256 `b36fb37326b1cf69f75c8b306f1f886d53a57c4b1b985e08e298e2407ea2ad02`.
- Inspected thread/turn properties and account request matches. They expose model/provider/service-tier and generic configuration controls but no explicit documented credit-spending prohibition. Generic metadata/config fields are not evidence that inventing a setting/header will be enforced.

Next admission evidence must come from a documented provider-enforced control or another independently verified safe account path. Do not drain credits, change top-ups, silently replace the configured Critic or use real inference to test whether billing accidentally occurs. Other local implementation work can continue with synthetic provider responses.

## Subsequent documentation check

Re-fetched the pricing and configuration pages during the preparation-inspection
pass. Pricing still describes available credits extending work beyond included
limits; the configuration reference still yielded no credit/billing setting.
[Workspace spend controls](https://learn.chatgpt.com/docs/enterprise/usage-limits)
explicitly describe plan-dependent workspace controls, not a universal Codex
limit. This does not establish a personal Pro no-credit-spend path. No account
read, setting change, credit action or inference was performed in this recheck.
The user's disabled-extra/top-up confirmation remains accepted, not contradicted.
