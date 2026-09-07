# Input ownership before background wake

6 September 2026. Bounded upstream comparison, implementation and compiled Mac
renderer verification. No provider inference or real credentials used.

## Stable upstream decision: adapt, not transplant

The latest-release page still resolves to [Munder Difflin v0.4.6](https://github.com/chaitanyagiri/munder-difflin/releases/tag/v0.4.6),
commit `64bd64df0e8d315a6e895283f776b81f84eef2cc`. Its history contains
`68cbc25cba6737b2328c158c12ac5d066dbe49a2`. Reviewed the stable
`src/main/workerWake.ts` and the introducing patch.

Moving ordinary-worker wake scheduling into Electron main is valuable: hidden
renderer timers should not determine whether workers hear about work. However,
this watchdog is not itself safe input ownership or a Conductor protocol. It
uses a 15-second beat, 12-second silence fallback, 35-second startup grace,
five-minute permission hold and its own 60-second wake cooldown. That cooldown
does not serialize it with renderer submissions.

Executed the actual stable module after TypeScript transpilation with synthetic
facts, not a provider or a live mailbox. At `now = 1000000`, an unpaused worker
with one inbox item, output 60 seconds ago and a spawn 600 seconds ago:

- An unresolved permission notification 300001 milliseconds ago no longer
  blocks its wake decision.
- Without any observed idle hook, silence alone permits a wake decision.
- A notification containing both permission-required and waiting-for-input
  language is classified as idle because the idle match wins.

These are counterexamples to Operatus's required policy, not evidence of an
upstream live incident. Ordinary-worker wake is also distinct from Gauntlet
advancement and the long-lived Conductor. Do not import raw automatic typing
and call that coordinated background reliability.

## Current Operatus defect and fix

Existing queue delivery had two ways to take over an unfinished user prompt:
draft/menu flags expired after 30 minutes, and a blank current cursor row could
override a known draft after a short echo grace. A multiline, hidden or
repainting terminal does not make its current row an ownership receipt.

`terminalAutomation.ts` now holds known drafts and pickers regardless of elapsed
time. `terminalPool.ts` no longer consults rendered prompt text to override
known input ownership. Timestamps remain diagnostic. Existing explicit input
and recovery actions release the flags, followed by the settling interval.
No main-process mailbox watchdog was added in this pass.

## Verification

`node --test test/terminal-automation.test.cjs test/terminal-recovery.test.cjs
test/queue-delivery.test.cjs`: **15 passed, zero failures, zero skips**. Tests
include time away, unknown timestamps, explicit release and functions extracted
from the actual terminal pool with a blank cursor row that must never be read
as permission. Node/web typechecks, Electron build and `git diff --check` passed.

`tools/smoke-input-ownership-ui.cjs` exercised the compiled Electron renderer and
preload with a disposable profile and an inert, synthetic PTY IPC boundary:

1. Type an unfinished draft using actual terminal keyboard events; queue a
   separate instruction through the composer.
2. Advance renderer time by 31 minutes; hide the owned Electron window across a
   real queue backstop interval, then restore it. No queued instruction reaches
   the synthetic writer.
3. At 1440×870 native DPR 2 and an emulated 1920×1080 layout at native DPR 2,
   verify the visible draft hold/recovery control and no horizontal overflow.
4. Explicitly recover the prompt into the composer; the separate queued
   instruction then reaches the inert writer, never joined to the draft.
5. Open the tracked `/model` picker with terminal keyboard events, queue another
   instruction and simulate another 31 minutes. The picker hold remains and
   that instruction is not written.

No renderer page/console errors were recorded. Screenshots were inspected:
the hold reason and recovery link remain on-screen above the composer at both
sizes, with the draft badge also visible in the header and agent strip. The
synthetic terminal intentionally does not echo text, so its empty screen is
not a real CLI rendering result or evidence of provider readiness. Controls
remain dense; this is not a full visual hierarchy or busy-firm acceptance.

Local evidence root:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-0hwkno`.
It contains `input-ownership-ui-receipt.json`, `input-hold-mac.png` and
`input-hold-1080p.png`. Logs are `/tmp/operatus-input-ownership-tests.log`,
`/tmp/operatus-input-ownership-types.log`,
`/tmp/operatus-input-ownership-build.log` and
`/tmp/operatus-input-ownership-ui.log`. These disposable local files are not
committed evidence assets. The test closes its own Electron instance.

## Remaining release gates

Follow-up: [recovery acknowledgment](2026-09-06-prompt-recovery-acknowledgment.md)
now covers explicit recovery transport rejection and late receipts. Actual TUI
interpretation and shared main-owned input authority remain unverified.

- Main-owned submission serialization and input ownership shared with the
  renderer, lifecycle hooks and control service. No draft/picker or unresolved
  permission may expire into automatic typing. Unknown readiness stays held.
- Recheck ownership after asynchronous readiness waits and around payload/Enter
  submission. A pre-await renderer check alone is not an atomic input claim.
- Explicit recovery currently assumes Ctrl-U/Escape semantics and clears flags
  without awaiting a successful PTY write. Test rejected writes, multiline
  prompts and actual provider menus before treating recovery as accepted.
- A missing pooled terminal cannot establish main-process permission to write.
  Persist or conservatively reconstruct ownership across renderer loss.
- One shared nudge claim/cooldown, stale-nudge/recipient validation, cancellation
  and shutdown fencing. Exercise competing main/renderer submissions, then a
  hidden/minimized real-provider worker with subscription admission in force.
- Verify real 1080p hardware, live provider prompt rendering and safe operator
  interruption. This fixture simulated clock passage, not an actual overnight
  sleep/resume or provider permission dialog.

The global subscription launch hold remains enabled. The native isolated
Claude rerun is still constrained by disk reserve (346 MiB available at this
check); this renderer fixture neither copies nor starts the provider binary.
