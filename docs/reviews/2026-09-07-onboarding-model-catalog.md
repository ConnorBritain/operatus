# Onboarding model catalog correction

Follow-up: the [Codex Conductor runtime work](2026-09-07-codex-conductor.md)
adds the execution adapter separately. The catalog-only scope below describes
the earlier change, not the current runtime capability.

The local Codex model cache fetched at `2026-09-07T14:44:45.998135Z`
lists seven visible models: GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, GPT-5.5,
GPT-5.4 Mini, and GPT-5.3 Codex Spark. The previous picker only included
Sol/Terra/Luna. Hidden reserve and internal review models are not exposed.

The shared renderer catalog now includes all seven. First-run Conductor
preferences default to Codex / `gpt-6-astra`, as requested by the owner.
Switching providers uses a model actually present in that provider's picker.
Claude's existing Fable 5.1 entry is retained and becomes its recommended
Conductor preference. Existing completed profiles are not silently migrated.
Finishing onboarding persists the selected `godProvider` and `godModel`.

Onboarding now only offers Claude and Codex and explains that a preference
does not grant execution admission. The isolated subscription-only Gauntlet
pilot still uses Claude Conductor sessions and its pinned Codex Critic model.
This change does **not** enable Astra-led Gauntlets, remove the legacy startup
hold, or modify subscription gateways. A resumable, subscription-isolated
Codex Conductor adapter plus live protocol verification remains separate work.

Verification: 19 provider/catalog/billing tests pass; node and renderer
typechecks pass. Local packaging runs through the refresh tool with native
SQLite and PTY checks before staging or installing. No paid model invocation
is needed to verify this catalog change.
