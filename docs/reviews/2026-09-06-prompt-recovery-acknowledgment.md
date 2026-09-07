# Prompt recovery requires a transport acknowledgment

6 September 2026. Follow-up to the [input-ownership audit](2026-09-06-input-ownership-and-background-wake.md).

## User story and broken boundary

The operator recovers an unfinished terminal prompt into the message composer,
or explicitly closes a tracked picker, before queued instructions continue.
The path is composer button → terminal pool → preload `pty:write` → main's
`PtyManager.write` result → input hold and agent-scoped saved composer draft.

Previously both recovery functions ignored the write promise and released their
hold immediately. The composer also appended recovered text using the render's
captured draft, which becomes stale once recovery is asynchronous.

## Implemented behavior

- Recovery remains held while its write is pending. A second recovery request
  cannot send another key while the first is outstanding.
- A rejected write or transport exception leaves the original prompt/menu model
  intact and shows an accessible error instead of claiming successful recovery.
- A successful receipt may clear only the same pool entry, renderer lifecycle
  epoch and input revision. New typing, exit, reset or replacement prevents a
  late response from clearing current input. Same-text edits still count as a
  new revision. Relaunch/reset advances the epoch.
- Draft recovery never releases a separate picker latch; picker recovery never
  discards a tracked draft. Successful recovery retains the settling interval.
- A captured draft is returned on successful transport even if current input
  changed, so it can be retained for inspection. The composer appends it to the
  latest saved draft of the initiating agent, not a stale render value or the
  newly selected agent's draft.

This is a renderer recovery receipt, not proof that a provider interpreted
Ctrl-U or Escape as intended. Removed the earlier universal claim about CLI
Ctrl-U behavior. The main-process identity/input-claim service is still needed.

## Evidence

**19 focused tests passed, zero skips**, across terminal automation, terminal
recovery and queue delivery. Tests execute the actual pool recovery functions
with deferred/rejected writes and the actual `resetTerminal` function; they do
not substitute a parallel recovery implementation. Cases cover duplicate
requests, exceptions, missing/exited terminals, newer input, same-text revision
changes, replacement entries, reset, and separate picker/draft ownership.

Node/web typechecks, Electron build and `git diff --check` passed.

Using the verification skill's boundary-by-boundary story, extended
`tools/smoke-input-ownership-ui.cjs` against compiled Electron and an inert PTY
IPC handler in a disposable profile. The real composer/terminal event flow:

1. Retained an unfinished draft and queued instruction across simulated time
   away and a hidden window; checked the Mac 1440×870 and 1920×1080 layouts.
2. Rejected a recovery write. The error, draft badge and queued instruction
   remained visible. No queued payload reached the writer across a real queue
   polling interval; the composer did not claim the draft had moved.
3. Delayed a recovery acknowledgment. The UI showed that recovery was pending;
   queued delivery remained held.
4. Edited the composer during that delay, then resolved the actual outstanding
   fixture request. Both the new composer edit and captured terminal draft were
   retained. Only then could the separate queued instruction reach the writer.
5. Rechecked the time-independent picker hold. No renderer page/console errors.

Evidence root:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-vXfxEE`.
Includes `input-ownership-ui-receipt.json`, both viewport hold captures and the
visually inspected `recovery-rejected-1080p.png`. Mac capture is a native window
at DPR 2; 1920×1080 is emulated layout at the native DPR, not a physical 1×
monitor. The fixture closes its own Electron process.

Logs: `/tmp/operatus-recovery-ack-tests.log`,
`/tmp/operatus-recovery-ack-types.log`, `/tmp/operatus-recovery-ack-build.log`,
`/tmp/operatus-recovery-ack-ui.log`. The reset-epoch follow-up was covered by the
final unit/typecheck/build rerun; the UI smoke did not exercise terminal reset.

## Still open

- Main-owned atomic input claims shared by keyboard, recovery and automation;
  checks before and after readiness/payload waits; actual process generation
  binding at the write boundary. Renderer serialization alone cannot guarantee
  these across process replacement or renderer loss.
- Ordinary keyboard Enter/Escape/Ctrl-U tracking still assumes successful
  transport and provider semantics. This fix covers the explicit recovery
  controls, not all input paths.
- Recovery with a permanently unresponsive IPC request remains held, with a
  pending explanation. Add bounded, ambiguity-aware recovery without allowing a
  late write to damage a retried or replacement session.
- Real CLI multiline/picker interpretation, cancellation during writes and
  provider permission prompts, then the adapted background watchdog and live
  concurrent Gauntlet acceptance. No live provider ran here; subscription launch
  safeguards remain unchanged. Disk remains below the native pinned-copy reserve.
