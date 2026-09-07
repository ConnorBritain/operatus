# Occupied capacity and recovery decisions

Date: 2026-09-06. Implementation and data-path verification, **visual acceptance
still pending**.

The prior collapsed capacity summary led with running/max. After a crash, two
quarantined reservations could therefore appear as `0/2 active`, despite consuming
both slots. It listed quarantine separately, but required the operator to perform
the scheduler's arithmetic.

The summary now leads with occupied/max, counting running plus quarantined
reservations exactly as the scheduler does. Running, queued and inspection counts
remain distinct. Lowering the limit below current occupancy displays the actual
over-capacity count rather than hiding existing reservations. This presentation
does not infer process health or lift a subscription hold.

The expanded panel explains that marking a run reviewed does not free capacity,
and releasing its slot does not clear runtime warnings. Release controls are
disabled for active or unavailable run details, with an inspection instruction.
The main-process release checks remain authoritative and unchanged.

Verification:

- 21 capacity-view, scheduler and run-view tests passed with no skips.
- Both actual native owner-crash scenarios passed again and require the resulting
  capacity projection to read `2/2 slots occupied · 0 running · 1 queued · 2 need
  inspection`. Model/account responses are synthetic, as before.
- Receipt roots: `op-native-concurrent-iFItNf` and `op-native-concurrent-JeEwc4`
  under `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.
- Renderer typecheck, Electron build and whitespace checks passed. The existing
  mixed static/dynamic renderer-store import warning remains. The no-inference
  capacity tests were added to CI configuration; hosted CI was not run.

Computer Use freshly reported the Mac locked. No new screenshot, button interaction
or viewport acceptance is claimed. The copied text and count semantics are tested;
actual readability, wrapping and recovery-control usability at expanded-Mac and
1920×1080 viewports remain open. No account setting, launch hold, deployment,
candidate branch or release was changed.
