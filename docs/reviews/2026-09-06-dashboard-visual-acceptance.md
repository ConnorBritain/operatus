# Compiled dashboard acceptance

## Result

The compiled Electron Runs surface passed portfolio and persistent-context UI
tests at 1440×870 and 1920×1080 on September 6, 2026. The fixture contains 43
synthetic runs across three repositories. These are UI states, not 43 live agents
or evidence of concurrent subscription execution.

Evidence directory:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-7mVxE0`.

- `portfolio-ui-receipt.json`: repository filtering, 14 attention items,
  review/reopen behavior, stale-review rejection, selection preservation, and
  rejection of an untrusted IPC sender passed.
- `run-context-ui-receipt.json`: objective/repository/responsibility remain
  visible while evidence scrolls; repository switches reset evidence scroll;
  filters do not steal selection; Skill Depot does not retain a stale run header.
- Both tests reported no renderer errors, horizontal page overflow, or live PTYs.
- Review actions clear operator attention, not protocol verdicts. Routine
  Conductor acknowledgments are not presented as human approvals.

The 1440×870 test used the native window on the connected Mac at DPR 2. The
1920×1080 test used emulated layout dimensions at that same DPR. This is not
acceptance on a physical 1920×1080 monitor at DPR 1.

## Visual inspection

The main reviewer inspected the attention screenshots at both sizes and the
Mac persistent-context screenshot. The cream/lavender palette, pixel headings,
selected-row highlight, and pinned objective provide readable hierarchy.
Preserved work is clearly distinguished from an accepted artifact.

The interface is usable but still text-heavy. The persistent subscription banner
and repeated objective/status/repository summaries compete with the work. At
1440×870 the queue has roughly 385 pixels of visible height; at 1920×1080 it has
roughly 625. Compact summaries and a less dominant status banner are reasonable
next design candidates, not fixes proven necessary by the automated assertions.

An obsolete `startup held` header was corrected to `macOS pilot` before the
passing captures. The actual subscription launch gate remains authoritative.
The UI test fixture now holds provider startup only within its own process so
synthetic tasks cannot consume subscriptions.

## Not established

This does not prove three real simultaneous Gauntlets, production remote
execution, mobile/Windows/Linux behavior, live sprite meaning or movement, or
full-app QA. The separate live acceptance proves one complete subscription
Gauntlet including repair. A second live Gauntlet evaluates this frozen evidence
bundle was attempted; its failure is recorded below.

## Broader QA Gauntlet: stopped, not passed

Run `23e402a3-e7ef-4e17-82b1-3e9bdcb2d868` used an immutable source/evidence
snapshot at `5982e60b90f3c6a831c3717da071016dfbaee4cd`. It ended as
`human_required` during orientation after approximately 56 seconds, with no
artifact or Critic report. It is not a second successful Gauntlet.

The Conductor process recorded `output_limit`, exit 143, and confirmed gateway
revocation. It received 1,462,735 stdout bytes overall. The transport permits
64 MiB per session but only 1 MiB per JSON line, so this was a record-size limit,
not overall session exhaustion. Its last observed activity was a Read request.
The bundle includes high-resolution screenshots; image transport is a likely
cause, but the oversized record was not retained and its exact contents are
not proven. Smaller bounded image payloads or safely bounded transport handling
need a focused test before advertising image-heavy QA support. No output limit
was loosened during this attempt, and no further live retry was made.

Receipt:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-dashboard-qa-I5wFKU/receipt.json`.

## Readiness decision

Use as a supervised macOS pilot for bounded coding Gauntlets. One real complete
repair loop and the compiled multi-repository dashboard interactions are now
proven. Do not treat sweeping visual/full-app QA or simultaneous real Gauntlets
as accepted yet. Next acceptance should address the bounded image-transport
failure, then test a small number of real simultaneous runs without changing
their frozen criteria or weakening subscription-only admission.
