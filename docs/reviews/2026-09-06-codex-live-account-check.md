# Codex account admission: real subscription, unresolved credit spending

## Observed, not inferred

On 2026-09-06 at 06:08 UTC, a read-only check of the existing native Codex
subscription credential and first-party usage endpoint established:

- Local auth mode is `chatgpt`, with no stored API key.
- The server returned HTTP 200, `plan_type: pro`, and an account identity matching
  the token's selected account. JWT decoding alone was not treated as proof.
- Ordinary subscription usage was allowed and not marked exhausted.
- The server also returned `credits.has_credits: true`, `unlimited: false`, and
  a positive balance. Its provenance and automatic top-up settings were not
  established by this response. Do not label these credits purchased or claim
  that this contradicts the user's confirmation of disabled paid extras.

At 06:11 UTC, the new production account component was exercised directly. It
returned `{ok:false, reason:'credits-available-or-unknown'}` as intended. No CLI
session, model turn, token refresh, credit redemption, billing mutation or API
inference occurred. Credentials remained in memory and were not printed or
copied to an agent home. The user's authentication file was not changed.

## Implementation

`src/main/codexAccountAdmission.ts` separates account evidence from eventual
launch authority. Its default reader uses the OS user's home, not ambient
`HOME`/`CODEX_HOME`; it rejects symlink aliases, non-regular files, shared file
permissions, oversized data and concurrent file changes. It never refreshes or
rewrites the personal credential store. This reader is not implemented for
Windows credential storage yet.

Transport is one fixed HTTPS GET to
`https://chatgpt.com/backend-api/wham/usage`, with the existing subscription
Bearer token and selected account header. It has a ten-second deadline, 128 KiB
response bound, certificate validation, and no redirects, proxy configuration,
retries, purchase endpoints or inference endpoints. Errors are reduced to fixed
non-secret reasons. No credential reader is exposed through renderer IPC.

Only matching server-confirmed Plus/Pro accounts with explicitly zero available
credits and available ordinary subscription capacity can yield a short-lived
account receipt. Missing or ambiguous credit metadata fails closed. Even those
receipts have `launchAllowed:false` and explicitly do **not** claim automated
top-up verification. Object identity, expiry and revocation protect the private
credential lease; serializing a receipt cannot authorize credential access.

The current real account therefore cannot pass this conservative component.
Do not empty the credit balance, change account settings, change the default
Critic, or bypass the runtime hold to make the test pass.

## Source basis and limits

The [official account interface](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
distinguishes authentication from usage/credit metadata. The
[official pricing documentation](https://learn.chatgpt.com/docs/pricing#what-are-tokens-and-credits)
states that available credits can extend work after included limits are reached.
Neither fetched page establishes a CLI switch that forbids spending existing
credits while using subscription allowance. Further investigation is required;
absence from these pages is not proof that no such control exists.

The metadata path, GET method and account header were checked against the
[native backend client](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/backend-client/src/client/rate_limit_resets.rs)
and its credit-status schema. The usage response is a point-in-time observation,
not a spending lock. Periodic polling alone cannot guarantee no credit spending
between observations, particularly with multiple concurrent sessions.

## Verification and next gate

- 244 root tests passed, zero skipped, including both pinned native CLI offline
  negative-auth probes. Routine CI uses synthetic account data only.
- Main/preload and renderer typechecks passed; Electron development build passed.
- `git diff --check` passed. No UI was changed by this account-only component.
- The global launch hold remains in place. Full real-provider pass/repair loops,
  concurrency, worker credential isolation and operator acceptance remain open.

Next: determine whether the provider offers an enforceable subscription-only
spending control for this account; separately continue role-specific worker
filesystem/network containment. Account admission is necessary but does not
solve inherited credentials, child processes, artifact authority, or mid-run
provider/account changes.
