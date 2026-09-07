# Inspectable subscription-admission evidence

## Result

The account checker already produced a short-lived, main-owned receipt, but the
native run did not retain it. The Claude compositor now requires a main-owned
evidence callback and persists a redacted check before starting each Conductor,
Implementer, Critic or Repairer session. If persistence fails, native startup is
not attempted and capacity remains quarantined for inspection.

Runs exposes the record under Role sessions / Session identity and safeguards.
Missing records are explicitly missing evidence. Fixture/injected dependencies
are labeled, so a synthetic account result cannot masquerade as a production
provider check when viewed later.

## What is recorded

- Exact run, launch and session identity, with an append-only observation sequence.
- Claude account-check component, evidence source, pinned executable version and
  SHA-256 digest, and assigned model.
- Hashed account and organization identities, Max plan, observed disabled extra
  usage, observation time and short component-validity window.
- `launchAllowed: false`: this historical receipt cannot authorize a new process,
  bypass the global hold, resume a session or provide a credential.

The allowlist excludes the credential, credential hash, raw account metadata,
email, authentication paths, local routing tokens and any future unknown fields.
The gateway still rechecks the account for requests. A historical component check
does not claim present account health or end-to-end no-charge admission.

## Validation and authority

Schema v6 prevents older v5 binaries reopening this newer native-start contract.
The record must match the current prepared launch, provider and configured model,
be within its at-most-30-second validity interval, and precede observed native
startup. Cancelled/replaced launches cannot acquire retroactive checks. Exact
duplicates remain idempotent, including historical re-delivery after startup;
changed bodies and extra fields are rejected. Protocol version, bar, artifact,
Conductor acknowledgment and runtime-warning semantics remain separate.

The source discriminator is chosen by the main compositor. Injected account,
inspection or gateway dependencies are never labeled production metadata. No
renderer command exists for supplying admission evidence.

## Tests and retained evidence

28 focused tests passed with no skips:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron --test \
  test/gauntlet-subscription-evidence.test.cjs \
  test/gauntlet-runtime-journal.test.cjs test/gauntlet-runtime-attention.test.cjs \
  test/gauntlet-preservation.test.cjs test/gauntlet-schedule.test.cjs
```

The pinned real Claude executable completed two five-session loops through
synthetic provider responses, with large-output stress. All five admission rows
preceded their matching process-start rows. A third injected journal-failure
scenario ended `human_required` with zero native handles/provider requests and
quarantined capacity. Three tests passed, zero skipped, no real inference.

Initial evidence roots under
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

- `op-native-runner-vGoVib`: normal loop, run `78728e85-64f8-47d1-bb33-6e52e5ebbb15`.
- `op-native-runner-CJNO2i`: injected final revocation-report failure, run `a646989a-1534-420b-89e0-1e7e59b4286b`.
- `op-native-runner-ym1yTj`: admission-write failure, run `1c87379e-1343-49dd-856f-7597c043820b`.

The final source-labeled rerun also passed all 28 focused and three native tests:
`op-native-runner-SPruQl` (normal), `op-native-runner-TcjGl1` (revocation), and
`op-native-runner-GKyWh4` (admission write). Its successful receipts explicitly
record `source: injected-dependencies`. Both TypeScript checks, the Electron
build and whitespace validation passed on the final source. Existing bundle
size/dynamic-import warnings remain.

During review, the older synthetic runner's revocation-failure fixture used the
invalid literal `failed` rather than the runtime schema's `unconfirmed`. It had
tested rejected exit persistence, not a valid unconfirmed exit. That literal is
corrected and the test now also asserts the unconfirmed exit is actually stored.
The real-CLI injected revocation test already used the valid runtime shape.

## Remaining acceptance

These are safe fixture results, not live Claude/Codex admission. The production
subscription hold is unchanged. The new text is implemented and typechecked, but
its visual presentation still needs the unlocked-Mac and requested viewport pass.
No additional GUI attempt was made while the preceding attempt remained blocked
by the locked Mac. No user profile, account, billing setting or hosted deployment
was changed. Failure reasons before account verification remain explicit run
stop reasons; they do not generate fabricated successful component receipts.
