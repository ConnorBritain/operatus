# Live Gauntlet handoff: bounded attempt

## Result

Partial success, not end-to-end acceptance. The Conductor startup failure was
resolved. The subsequent live run froze a bar, launched a fresh Implementer,
created an exact commit and executed its frozen checks. Critic preparation
failed before native startup. No report, acknowledgment, repair or pass exists.
The larger dashboard QA task was not launched because its prerequisite failed.

## Fix and verification

The original Conductor transcript ends with the local gateway rejecting a
subscription recheck. A diagnostic retry narrowed this to `usage-unavailable`.
A fixed-host metadata probe returned HTTP 429 on `/api/oauth/usage`, with
Retry-After 268 seconds; profile metadata remained HTTP 200.

Claude admission now caches only successful Max/disabled-extra-usage metadata
for five minutes, keyed to the exact OAuth credential. Credentials are still
reread and checked on every request. Credential changes and expired observations
require fresh metadata; failed refreshes cannot use stale observations. Short
credential leases and historical metadata timestamps remain separate. The ADR
documents the bounded observation delay. No API fallback or alternative account
was enabled. Orientation also names the available Node runtime explicitly.

Focused account/gateway tests (19), prompt contract test (1), SQLite admission
evidence tests (5), and provider factory tests (3) passed. Both TypeScript checks
and the Electron build passed. The subsequent live handoff exercised the fix.

## Real run evidence

- Run: `9a34a181-0a4f-4e4f-9ad5-57f9a9bc97dc`.
- Base: `a8141658e90b44985d62e1341b37379f3ba67a94`.
- Candidate: `8181da0a96bfd0f845d64eef4deb24e1a22bf77e`.
- Frozen bar: `737a969ff2ed7fb316084d111aca4776e37c256c5e2035b84f47c9bca6c88159`.
- Conductor and Implementer were distinct real Claude subscription processes.
- The harness deliberately injected the documented upper-bound defect before
  the candidate commit. This is a test intervention, not an Implementer mistake.
- Existing tests and extended behavior checks failed on that real defect. The
  unchanged-test-file/interface/scope check passed. Main remained unchanged.
- Codex Critic was prepared in SQLite, but no native Critic startup or admission
  receipt was recorded. The run ended `infrastructure_failure`; capacity was
  quarantined rather than automatically retried.
- Both started processes exited and their gateways were revoked.
- No desktop visual verification, concurrency acceptance or cancellation-only
  test was completed in this attempt.

Full receipt and fault-injection record are preserved under:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-live-gauntlet-7tJ09x/`.

## Next blocker

Only 117 MiB was free at Critic preparation. The pinned Codex binary alone is
220,585,024 bytes. Its isolated version probe reported unavailable, though the
installed binary reported `codex-cli 0.153.4` directly and its subscription
account check passed. The runner currently hides preparation exceptions behind
a generic failure, which should be made more actionable without exposing secrets.

Removed only the two regenerable, verified Claude binary copies created in this
attempt, after confirming process exit and gateway revocation. No source,
candidate, transcript, credential or receipt was deleted. Afterwards the disk
reported 697 MiB free. This is still too little headroom for dependable app QA.
After that cleanup, the same isolated Codex version probe succeeded and reported
`0.153.4`, supporting disk exhaustion as the preparation failure cause.
Obtain several GiB of headroom before another live loop; do not expand into
unreviewed disk cleanup. Complete the live critique/acknowledgment/repair cycle
before treating synthetic dashboard fixtures as proof of real orchestration.
