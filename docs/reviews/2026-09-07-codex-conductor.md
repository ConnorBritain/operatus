# Codex Conductor runtime

## Scope

The earlier model picker did not select an execution adapter. The isolated
runner wired Conductor sessions to Claude and supported Codex only as a fresh
read-only Critic. This change adds Codex as a long-lived Conductor, with GPT-6
Astra as the default for new desktop profiles. Existing explicit preferences
remain intact. Claude still implements/repairs; Codex Critic remains pinned to
GPT-5.6 Sol. Legacy Add agent startup remains held.

The shared Codex app-server transport creates one native thread and submits
sequential turns on it, consistent with the [official protocol](https://learn.chatgpt.com/docs/app-server).
Each Conductor turn is durably receipted. A Critic still receives a separate
process, thread and single turn. No provider fallback, imported history, API-key
route, paid-credit redemption or automatic restart recovery was added.

The same subscription admission, isolated profile, exact model binding, outer
read-only sandbox, scoped control commands, budgets, process cleanup and gateway
revocation apply. The Conductor can read only its own run's review evidence.

## Verification

Offline coverage exercises multiple Conductor turns, fresh Critic isolation,
foreign/reused native identities, role/profile mismatch, timeouts, duplicate
messages, bounded repairs, provider defaults and cleanup. Node and renderer
typechecks are required. These protocol fixtures are not live inference proof.

`tools/smoke-codex-conductor.cjs --live` runs a real subscription-backed,
eight-minute-bounded acceptance in a disposable repository. Only `capacity.cjs`
may change; fixed tests and main remain untouched. It requires one Astra thread,
multiple native turns, independent Sol critique, explicit acknowledgment, exact
artifact/check receipts and confirmed process exit/gateway revocation. It is a
runtime test, not a desktop interaction or concurrent-Astra acceptance test.

### First live attempt

- Run: `ccfa874d-2e76-4684-b6d8-ea60049a3425`
- Evidence root: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-astra-conductor-Yk6rSe`
- Result: `human_required`, not passed.
- Astra froze the contract, Claude produced a passing exact candidate, and the
  independent Critic returned PASS. The same Astra thread acknowledged but
  escalated because the packet provided a Critic summary without a usable patch
  or raw check receipts. Cleanup and subscription evidence passed.
- Correction: acknowledgment now supplies the existing main-produced patch
  manifest/path and frozen check receipts, revalidates their artifact/bar
  bindings and patch integrity, and identifies the orientation checkout as the
  base rather than the candidate. No sandbox or acceptance bar was weakened.

### Second live attempt

- Run: `1a6110e0-d1cb-4fc0-9b11-94856ba21b07`
- Evidence root: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-astra-conductor-QNYlFs`
- Result: `human_required`, not passed. Astra froze the bar and Claude produced
  a passing candidate. The fresh Critic submitted PASS but then hit its bounded
  session timeout. The runner correctly stopped before delivering the final
  acknowledgment turn. The intermediate `awaiting_lead_ack` state recorded the
  report, not completion of the Critic process or delivery to the Conductor.
- All launches had live subscription evidence, confirmed root-process exit and
  gateway revocation. Main/tests were unchanged; only the assigned implementation
  file changed. Capacity was released. No candidate was merged or pushed.

The complete corrected Astra-led loop is **not yet live-accepted**. Remaining
verification is one bounded run with a clean Critic finish and final same-thread
Astra acknowledgment. Do not count the offline repair loop as that proof.

Final focused regression run: 65 tests passed. Both typechecks and the Electron
build passed. The unsigned Apple Silicon package passed SQLite/PTy native probes
and compiled-main/preload identity checks. Prepared bundle `build-0kzzhW` has
app.asar SHA-256 `bdb1a81a4cf92f4c8e24d4ee4b83e3f5b2ec2bfb9c1b86aaca6d387c662dafb3`.
The React checklist kept async saved-preference loading from overwriting ongoing
form edits and clears incompatible model selections when switching providers.
