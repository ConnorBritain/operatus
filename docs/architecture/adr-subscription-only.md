# ADR: subscription-only inference with fail-closed launch admission

- Status: Accepted product constraint; isolated macOS admission enabled September 6
- Date: 2026-09-05
- Authority: explicit operator requirement, no API charges permitted

## Decision

### September 6 live-loop correction: bounded billing metadata

A live Conductor failed after several real tool calls because querying the
Anthropic usage endpoint on every inference request exhausted its metadata rate
limit. The endpoint returned HTTP 429 and a 268-second Retry-After. This was not
an OAuth login failure.

Successful Claude Max/extra-usage observations are now cached for at most five
minutes, keyed to the exact OAuth credential. Every request still rereads and
validates the credential and expiry. Rotation requires new metadata; cache expiry
requires a successful refresh, with no stale-on-error fallback. Instance-owned
credential leases still last at most 30 seconds. Receipts distinguish the fresh
credential check from `metadataObservedAt`, preserving the actual billing
observation age. Account-side changes can take up to five minutes to be observed;
the operator must keep extra usage disabled throughout a run. API keys, alternate
routes, account switching within a launch and paid fallback remain forbidden.

### September 6 amendment: bounded, evidence-based admission

The operator authorized reasonable subscription-authentication evidence rather
than an unconditional startup hold. The operator has confirmed paid extras and
automatic top-ups are disabled on both accounts. This confirmation is an
operating prerequisite, not a claim of programmatic enforcement.

Only the isolated macOS Gauntlet factory is enabled. It retains pinned native
executables, app-authored profiles, forced subscription login, outer process
confinement, and fixed subscription transports that never use API keys or fall
back to API billing. Main-owned account checks run before launch and before
each forwarded request. Ordinary PTYs, hidden workers, and API integrations
remain blocked because they do not use this boundary.

Codex must authenticate as ChatGPT Plus/Pro with available subscription capacity.
Available or unknown credits are recorded accurately; neither proves API billing
or paid top-ups are enabled. Known exhausted subscription windows are rejected
even when credits exist. Claude retains its active Max and extra-usage-disabled
checks. Expired credentials require reconnection through the provider CLI.

This amendment supersedes the blanket interlock and the requirement below to
programmatically prove every account billing setting. It does not assert a
zero-dollar guarantee or completion of a live multi-role Gauntlet.

References: [Codex authentication](https://learn.chatgpt.com/docs/auth),
[Claude authentication precedence](https://code.claude.com/docs/en/authentication).

### Original product constraint

Operatus may use only supported Claude and Codex subscription sessions. There is
no BYOK mode, paid API fallback, usage-credit purchase, auto-recharge, premium
metered mode, or user-facing switch that relaxes this constraint. Free API tiers
are not an exception: their exhaustion must never become a billable fallback.
An unavailable subscription means queued/blocked work, not another billing path.

This applies to Conductor, Implementer, Critic, Repairer, hidden summarization,
memory jobs, voice/transcription, plugins and tools invoked on their behalf.
Ordinary local file/Git inspection and non-inference identity transport are
different capabilities; they do not justify an arbitrary credentialed gateway.

## Why OAuth alone is insufficient

Anthropic documents that API keys in the environment can take precedence over
subscription login. It also offers separately paid usage credits on subscription
accounts. Therefore “logged in” and “OAuth” do not prove “included subscription
usage only.” Hiding a purchase command does not turn off account-side overage.

Sources inspected:

- [Claude API-key environment behavior](https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code)
- [Claude usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans)
- [Codex authentication restrictions](https://learn.chatgpt.com/docs/auth#enforce-a-login-method-or-workspace)

Provider behavior and CLI flags must be revalidated for the admitted versions.
Do not infer enforceability from a variable name or an old configuration example.

## Historical first slice: a safety interlock

The September 5 build denied all agent startup while admission was incomplete. This
is intentional and visible in the desktop UI. It is **not** a claim that working
subscription-only execution has already been implemented.

The main spawn entrypoint rejects before discovery, installers, global trust
changes, credential materialization, provisioning or remote-daemon startup. The
PTY manager also rejects direct callers. Hidden Claude sessions and unaudited
MemPalace execution are held. Realtime token minting, Groq chat/transcription,
provider API-key writes, credentialed generic broker forwarding/probes and LLM
proxy startup are denied at their execution boundaries.

A pure environment scrubber is included as defense in depth for later admitted
launches. It is not sufficient by itself: project/user config, rc files, keychain
entries, credential helpers, dynamic plugins and subprocesses remain possible
credential sources in an unconstrained runtime.

No settings flag, environment variable, renderer claim, or confirmation checkbox
can lift the interlock. Existing credentials are not deleted or modified. These
changes apply to this rebuilt application, not older installed binaries or
unrelated tools on the operator's machine.

## Original admission checklist (amended above)

1. Resolve and validate the supported executable/version and its actual auth
   source with non-inference probes. Reject API-key, gateway, cloud-provider,
   unknown or conflicting authentication. Never print secrets or auth files.
2. Construct controlled provider configuration rather than copying arbitrary
   user config. For Codex, enforce its documented ChatGPT-only login restriction
   and reject provider/profile overrides. Investigate equivalent enforceable
   Claude controls; do not assume a prompt can enforce billing.
3. Bind admission to executable, configuration, credential source/account,
   selected model, billing capability and freshness. Revalidate at launch and
   invalidate on changes. The renderer receives a redacted receipt, not authority
   to mint one. Prevent later interactive or tool-driven billing-mode switches.
4. Establish a provider-side no-overage policy, including credits, extra usage,
   auto-recharge and premium metered modes. If its enforcement or current state
   cannot be established, keep that provider blocked. Do not treat a self-report
   or hiding the purchase UI as verification. Account-level controls are a
   prerequisite, not a replacement for launch/config isolation.
5. Constrain agent subprocesses and checks so they cannot read ambient API
   credentials and call paid endpoints independently. This is part of R1's
   filesystem/network boundary. A hostname denylist alone cannot distinguish all
   subscription traffic from paid API/gateway traffic or cover arbitrary proxies.
6. Reject unaudited skills, MCP/plugins and generic credentialed integrations
   that can trigger inference. Reintroduce useful non-inference integrations only
   through narrow, tested adapters. Provider policies must also govern child
   agents and hidden operations, not just the first PTY.
7. Test synthetic planted keys/configs/helpers, conflicting auth, shell startup,
   custom executables/providers, resume/retry, expiry, limits and denied network
   paths. Prove zero paid-request attempts with transport spies before any live
   subscription test. An invalid guard must stop work, not degrade to a fallback.

An application cannot guarantee that a third-party provider will never make a
billing mistake or that unrelated programs will never charge the account. Do not
promise an absolute dollar guarantee. The enforceable product commitment is no
Operatus-authorized paid inference path, and no execution where that cannot be
established. Provider account spending/overage controls remain necessary.

## Verification

`npm run test:billing` tests the legacy hold, isolated Mac gate, environment scrubbing, direct and
hidden PTY denial, API chat/transcription and realtime denial, and real loopback
broker rejection before secret lookup/forwarding. CI runs it explicitly. Static
wiring checks supplement behavioral tests; they do not replace the future
working-provider admission tests. All test credentials are synthetic and no
model inference is needed to run the suite.
