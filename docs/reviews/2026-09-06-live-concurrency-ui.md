# Two working, one waiting: live desktop smoke

## Verdict

Follow-up: the two findings below have since received targeted fixes and
regression verification. See [focused pilot fixes](2026-09-06-focused-pilot-fixes.md).
This original live-attempt verdict is preserved unchanged.

**Concurrent execution and queue handoff passed. Overall smoke acceptance is
partial: manual review found a Mac-width completed-panel overflow, and an agent
test subprocess crashed and recovered. This was not a crash-free UX pass.**

The compiled desktop created all three runs through the normal New Run form.
Real Claude Fable 5.1 Conductors/Implementers and fresh Codex GPT-5.6 Sol Critics
completed all three jobs. No reports, account metadata, or model responses were
injected. No production code or admission checks were changed in this exercise.

| Project | Run | Final artifact | Outcome |
|---|---|---|---|
| Capacity | `2793715e-c87d-4cdc-b007-b0ebf38dc840` | `cbd2f37cd3405b6f0f6f793fb1508358e8364cdf` | passed |
| Attention | `65080b2b-9144-4645-80a9-2cd18af8aca5` | `81b643715aff15860a71d1ff6a866956f10670bd` | passed |
| Slots | `7c57a07d-b4a2-4197-888b-f745a34159c8` | `8dfd9322cae1c9fc24b398b8fe5a19cbfeb1c195` | passed |

Each candidate changed only implementation.cjs. Each passed four frozen checks,
including its four-test Node suite, test-file preservation, file-set preservation,
and supplemental behavior checks. Each received a PASS Critic report and explicit
Conductor acknowledgment. No repairs were needed. All tests and main branches
remain unchanged; candidates are unmerged/unpushed with no repository remotes.

## Timeline and isolation

Times below are UTC on September 7 (September 6 local time).

- 03:32:54–03:33:00: desktop Start buttons submitted all three jobs.
- 03:33:23.960 / .985: Attention and Capacity Conductors started. Their process
  lifetimes overlapped for approximately 4 minutes 58 seconds. Both subsequently
  produced commits; overlapping lifetimes were not counted as work completion.
- Slots waited without any prepared session while both reservations were held.
- 03:38:14: Capacity passed; 03:38:21.654 its Conductor exited with confirmed
  gateway revocation. At .657 its released slot was assigned to Slots; at .824
  the Slots Conductor started. This ordering comes from recorded receipts.
- 03:38:38: Attention passed and then drained independently.
- 03:42:01: Slots passed. All reservations subsequently drained to zero.

The live work took roughly nine minutes from first click to final acknowledgment.
The complete implementation, attempts, review, and cleanup took about 19 minutes,
within the agreed 60-minute limit. After confirmed root exits, absent recorded
PIDs, matching binary hashes, and no open file handles, three regenerable native
binary copies were removed (482,611,584 bytes, approximately 460 MiB). All
repositories, worktrees, receipts, screenshots, and transcripts were retained.
Nine distinct role sessions and six distinct fresh worker/Critic worktrees were
recorded, all with real subscription admission and confirmed root-process exit
and gateway revocation. This does not prove quiescence of every OS descendant.

## Visual and crash findings

Repository filtering and selection preservation passed during work and after
completion at 1440×870 and 1920×1080. Main-agent inspection covered all four
screenshots. The larger layout was emulated at native DPR 2, not tested on a
physical DPR-1 display. The app remained responsive and reported no renderer
errors. Completed candidates correctly returned responsibility to the operator
for disposition, without requiring human approval during ordinary rounds.

**Mac-width overflow:** completed-mac.png shows an inner horizontal scrollbar and
clipped objective/candidate content. The harness only checked document-level
scrollWidth and therefore missed this. All 17 automated assertions passed, but
that result does NOT establish the plan's no-horizontal-overflow criterion.
The manual result supersedes the automated overall pass for UX acceptance.
Next focused work: contain the completed detail panel's intrinsic width and add
an inner-panel overflow assertion against real completed candidates.

**Recovered test-child crash:** the supplied crash report identifies Electron
PID 29717, parent 29716, at 03:35:33.980, SIGSEGV in IOKit startup. At that time
the Attention Conductor was running child_process.spawnSync with a replacement
environment containing PATH/HOME/TMPDIR but omitting ELECTRON_RUN_AS_NODE. Its
temporary node alias resolved to the bundled Electron executable. Its diagnostic
output recorded SIGSEGV/SIGABRT. At 03:35:42 it restored ELECTRON_RUN_AS_NODE=1,
reran its checks, and continued without human protocol intervention. The desktop
and provider sessions did not crash. This is a concrete agent-runtime ergonomics
defect, not a concurrency isolation failure. No safeguards were loosened.

Before a crash-free usability claim, make the agent-facing Node execution path
robust to custom child environments and regression-test that exact scenario.
This follow-up was not implemented during the bounded smoke.

## Changes, reproduction, and retained evidence

Added a live UI harness, isolated-profile bootstrap, fixed workloads, pure
evidence analyzer, and five focused tests. The Electron build and five tests
passed. The verification skill kept the test anchored to desktop action → real
main-process scheduler → subscription providers → Git/check/report → desktop.

The first attempt stopped at onboarding before any provider launch. One harness
setup correction initialized an already-onboarded disposable workspace. The
fresh rerun used normal UI capacity and run controls; onboarding itself was not
tested. No further live reruns or product fixes were made.

Run `node tools/smoke-live-concurrency-ui.cjs --live <installed-playwright-path>
<absolute-UTC-deadline>` from the repository, with a deadline within 20 minutes.
It uses subscription allowance and must not be run as an ordinary offline test.
The current automatic overflow check is incomplete as described above.

Evidence root:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-live-concurrency-P061nt`.

- `receipt.json`: unchanged machine-generated assertions, snapshots, Git checks,
  process overlap intervals, UI actions, and capacity samples.
- `manual-review.json`: qualified overall result and unresolved findings.
- `running-mac.png`, `running-1080p.png`, `completed-mac.png`,
  `completed-1080p.png`: actual compiled desktop captures.
- `capacity`, `attention`, `slots`, and `profile`: retained repositories,
  worktrees, SQLite state, and local transcripts.
- Earlier setup failure: sibling root `op-live-concurrency-H2iWke`.

Not tested: real cancellation stress, restart recovery, same-repository
integration, multiple machines, heavy build/resource pressure, visual QA inputs,
or meaningful live sprite behavior. Those claims remain open.
