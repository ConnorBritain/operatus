# Mixed Claude/Codex local loop

Date: 2026-09-06. **Real native processes and local authority; scripted model
responses and synthetic accounts. No live inference or billing acceptance.**

## Production wiring

Electron main now composes `createIsolatedProviderFactory` behind the unchanged
`subscriptionLaunchError()` hold. Claude remains the Conductor, Implementer and
Repairer; a configured Codex Critic is no longer rejected merely because the
factory is Claude-only. Unsupported role/provider/model combinations fail rather
than substituting another provider. The pilot pins Claude 2.1.263/Fable 5.1 and
Codex 0.153.4/GPT-5.6 Sol; this is not arbitrary-model availability verification.

The Codex factory validates and copies the previously tested native executable
and Code Mode companion into private storage, reserves diagnostic space, creates
a fresh isolated profile, materializes explicitly locked skills, prepares the
scoped local helper, verifies account evidence and opens the fixed subscription
gateway. It rechecks the hold, cancellation, ownership and executable hashes
before startup. The child receives a local account/token pair, not the real
credential, a refresh token, an API key, or inherited user configuration.

Codex admission observations are redacted and distinct from Claude observations:
plan, no credits observed, top-ups not programmatically verified, executable and
companion hashes, account fingerprint and observation lifetime. Persistence rejects
secret fields and stronger unsupported billing claims. The UI labels each provider
without falsely calling Codex a Claude Max subscription. These are historical
observations, never capabilities that bypass the global hold.

The [official authentication documentation](https://learn.chatgpt.com/docs/auth)
distinguishes ChatGPT subscription authentication from API billing and documents
isolated file storage under `CODEX_HOME`. That distinction does **not** establish
a provider-enforced prohibition on consuming existing credits. The separate live
admission gate remains unresolved and was not changed here.

## Native smoke evidence

The existing complete-loop fixture now optionally uses the production mixed
factory (`OPERATUS_NATIVE_MIXED=1`). Only account metadata and provider responses
are injected. Actual Claude/Codex executables run native tools against real
disposable Git worktrees, the real authenticated local control socket and SQLite.

The normal case demonstrated:

1. A persistent Claude Conductor froze the observable contract through its token.
2. A fresh Claude Implementer edited and requested a main-owned exact commit.
3. A fresh Codex Critic read the artifact/review manifest and submitted `REVISE`
   through the scoped helper, bound to that artifact and bar digest.
4. The original Conductor read review evidence and explicitly acknowledged repair.
5. A fresh Claude Repairer produced a second exact commit.
6. A new Codex thread/turn re-read evidence and submitted `PASS` for that commit.
7. The Conductor explicitly acknowledged pass and completed its final delivery.
8. All five processes exited with recorded output counters and gateway revocation;
   normal capacity was released without modifying the original checkout.

All roles read locked skill/support files. Attempts to modify those skills were
denied; the Conductor was denied peer-run evidence access. Five distinct allocated
session IDs and two distinct actual Codex thread/turn pairs were recorded.

Additional cases verified lost Conductor gateway-close confirmation quarantines
capacity and reopens operator attention despite a passed artifact; an initial
Claude admission-journal failure starts no process; a Codex admission-journal
failure after implementation produces an explicit infrastructure failure with
preserved artifact, no Codex request/start/report, and quarantined capacity.

Three mixed cases passed together (normal, revocation, initial admission-write),
then the additional Codex admission-write case passed separately with the other
three excluded by its name filter. An additional 65 billing, factory, session,
journal, preservation and lifecycle regression checks passed. Node/renderer typechecks, Electron build and
whitespace checks passed. Hosted CI and GUI acceptance were not performed.

Receipt parent: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.

| Case | Directory | Run |
| --- | --- | --- |
| Normal | `op-native-runner-5QkNxr` | `9c0bd7fb-de90-4e05-9af7-f6e232f2071e` |
| Lost close confirmation | `op-native-runner-ewlU2I` | `d1ade68b-3b0c-485f-bf8e-7e49f7dec631` |
| Initial admission write | `op-native-runner-huCtKy` | `a84b7c99-1bf7-4d66-b759-1b8639da58c3` |
| Codex admission write | `op-native-runner-bmPdYS` | `9ab8de3d-7cb4-4082-a508-c3c6a8fcaa96` |

Normal artifact sequence:
`14f8608a3b0e0d9a278d2c84610c104584b0c5b0` →
`d4adf2889a96ae4708f23c7c15abc36191e6d827`.
Reports are `REVISE`, `PASS`; acknowledgments are `repair`, `pass`.
Each directory retains `receipt.json`, SQLite/Git and skill evidence. Fixture
executable copies are removed, not diagnostic work or user files.

## Failed observations retained

The first mixed normal/revocation attempts (`op-native-runner-i7GXxI` and
`op-native-runner-dsv6Ri`) hit the fixture's old aggregate 40-request ceiling.
Codex requests were counted against Claude's limit, cutting off the lead's final
response after its valid acknowledgment. The per-provider fixture bound was fixed;
production budgets were not weakened. The full rerun passed including final
delivery and shutdown, rather than accepting the partial artifact result.

The new Codex admission-write test initially expected `human_required`. Inspection
showed the existing worker-preparation policy correctly emits
`infrastructure_failure` and quarantines uncertain startup. The test was corrected
to require that exact behavior, no native Codex activity and no report.

## Still required

- Live subscription admission, particularly a proven no-existing-credit-spend
  path for the user's Codex account. No balance, top-up setting or credential was
  changed; the user's disabled extras/top-ups confirmation remains respected.
- Real independent judgments on a meaningful project, not this scripted fixture.
- Live mixed-provider concurrency and restart/failure acceptance. The subsequent
  [native scripted concurrency smoke](2026-09-06-codex-start-order.md) passed both
  cancellation cases and fixed an observed start-order defect; it is not live judgment.
- Actual expanded-Mac/1920×1080 visual and owner-operator acceptance, including the
  new identity/admission details, priorities, capacity and actionable signals.
- Full current-upstream and remaining roadmap completion audit before readiness.

No release, push, merge, deployment, paid service or account setting change occurred.
