# Claude account admission: real read-only evidence

## Verified, without inference

At **2026-09-06 05:56:27 UTC**, the implemented account component read the existing
default Claude subscription Keychain entry and successfully requested the
provider's profile and usage metadata. Both returned HTTP 200. Observed facts:

- The account is an active Claude Max subscription. The initial metadata inspection
  reported its tier as Max 20x.
- The profile's `has_extra_usage_enabled` is false.
- The usage response's `extra_usage.is_enabled` is false.
- The credential is unexpired and has profile and inference scopes.
- The resulting account-only receipt has a 30-second lifetime and explicitly
  retains `launchAllowed: false`. The diagnostic receipt was revoked afterward.

This corroborates the operator's Max/disabled-extra-usage statements with current
provider responses. It is not a permanent guarantee of future account settings,
an independent auto-top-up audit, model-specific quota availability, or permission
to lift the runtime hold. The operator's separate confirmation of disabled
automatic top-ups remains human evidence. No model request, purchase, billing
change, login/logout, refresh, or write of real credential material occurred.
Tokens, raw response bodies, email addresses and raw account IDs were not emitted
or persisted in the review. No user login was altered.

## Implemented boundary

`ClaudeAccountAdmission` reads only the known `Claude Code-credentials` Keychain
entry, internally parses its OAuth field, and requires unexpired profile/inference
scope. It never invokes a shell or configured credential helper. Secrets remain
inside the main-process component; reader errors become fixed messages.

Transport permits only TLS GETs to `api.anthropic.com` at `/api/oauth/profile` and
`/api/oauth/usage`. There is no arbitrary URL, API-key header, inherited proxy,
redirect following, retry, token refresh, purchase or inference operation. It
uses a separate HTTPS agent, normal certificate validation, a 10-second overall
deadline and a 128 KiB response bound. Non-200 or malformed responses fail closed.

Both current server records must explicitly disable extra usage. Account and
organization IDs must be valid, the account must be Max, and its subscription
must be active. Unknown, missing, string-valued, enabled or conflicting flags
cannot produce a receipt.

Receipts carry account/organization/credential digests and observation/expiry
times. Only the exact frozen receipt object issued by the same instance can
retrieve its credential from a private WeakMap. Copied JSON, expired or revoked
receipts cannot do so. The receipt is an **account component**, not a worker
capability or final executable/configuration/model/run admission. It has no IPC
or renderer route and remains outside the held legacy launch path.

## Source and validation

The authentication/storage behavior is described in the
[Claude authentication documentation](https://code.claude.com/docs/en/authentication).
The fixed metadata paths and first-party API base were also inspected in the
installed Claude **2.1.263** binary, SHA-256
`ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9`.
These metadata endpoints are treated as a version-checked integration, not an
assumed stable public API. Schema changes or access failures must block admission.

Seven new synthetic tests cover valid-shaped responses, spoofed/copied receipts,
expiry/revocation/backwards clocks, malformed credentials, account restrictions,
overage rejection, redaction, fixed TLS GET transport, redirects, oversized and
malformed bodies, and synchronous transport failures. Tests never read a real
Keychain entry or call the real provider. The live read-only check above was run
separately with the production component and then revoked.

Evidence: `/tmp/operatus-account-tests.log`,
`/tmp/operatus-account-typecheck.log`, `/tmp/operatus-account-build.log`.
The Electron-hosted root suite passed **236 tests with zero skips**; both
typechecks and the Electron build passed.
No UI or visual change was made in this pass.

## Remaining acceptance gates

Validate the equivalent Codex account/credits boundary. Combine fresh account
evidence with approved native identity, immutable app-authored configuration,
model/role/run scope, and enforced worker filesystem/network confinement.
Revalidate before launch and define safe stops for changed account state, expired
authentication, unavailable quota, and provider errors. The account component
alone does not protect child processes or cover mid-run state changes.

Then replace, rather than bypass, the temporary hold on that guarded path and run
real pass and repair/re-critique Gauntlets. Concurrent multi-project operator UX,
remaining upstream runtime fixes and full visual acceptance are still open.
