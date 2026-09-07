# Live subscription Gauntlet acceptance

## Passed

The real mixed-provider loop passed on September 6, 2026 (02:17 UTC September 7).
No synthetic account, provider transport, model output, Critic report or
Conductor acknowledgment was supplied. The only injected fault was an explicit
test intervention before the first artifact commit, recorded separately.

- Run: `2f381934-b6dd-4e86-9723-6b9a4401e731`.
- Duration: approximately 7 minutes 27 seconds.
- Base: `a2e233fe3e1ba2ace8ee06d32de53e0cd37ab99c`.
- First artifact: `d01c8f42047605dbe92cbbd931b6350bf9247104`.
- Repaired artifact: `6f7c4fea4f3c86f58facb9068e52210bd23ef537`.
- First independent Codex report: `REVISE`; exact injected upper-bound defect
  identified and reproduced by the unchanged test suite.
- Conductor explicitly acknowledged the finding and synthesized the repair.
- A fresh Claude Repairer produced the new artifact.
- Second fresh Codex report: `PASS`; all five tests, interface/semantics checks,
  unchanged-test/no-dependency checks, and an additional numeric grid probe passed.
- Conductor explicitly acknowledged that report and passed the run.
- All harness assertions passed: terminal pass, fault receipt, one repair,
  two artifacts/reports/acknowledgments, five distinct role sessions, passing
  final checks, unchanged main/tests, and real subscription admission receipts.
- Cancellation of an additional **unstarted** run passed with zero launches.
  This is not an in-flight cancellation test.

The final candidate remains unmerged and unpushed in its disposable repository.
Full evidence: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-live-gauntlet-LkXF8A/receipt.json`.

## Corrections made during this continuation

The preceding attempt reached a repair with passing checks but timed out during
the final critique. The harness accidentally combined a 15-minute outer limit
with a 10-minute internal cap. It now uses the same supplied deadline for both.
That timed-out run remains a failure, not a retroactive pass:
`dd56df02-903c-4dbd-b56e-7c49c7aee6bd`.

Worker/Critic launch prompts now identify `$HIVE_NODE` as the available host
runtime, avoiding unsuccessful searches for a `node` PATH alias. Both prompt
regression tests pass. The live Critic subsequently reproduced the failing and
passing suites directly. Node typecheck and the Electron build passed.

The synthetic desktop fixture now installs a test-process-only provider hold.
It does not change production output or add a product configuration switch.
Its two tests prove all platforms remain held in that fixture and a changed
compiled gate prevents fixture startup. This prevents the newly enabled real
runner from executing synthetic UI tasks.

## Limits of this proof

This establishes one complete, real subscription-backed Gauntlet with repair.
It does not establish concurrent live Gauntlets, full-app QA, Windows/Linux
runtime support, live floor/terminal integration, or remote execution. The
compiled-dashboard visual pass is recorded separately and uses synthetic states.
