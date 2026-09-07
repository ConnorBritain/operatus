# Focused fixes after the live concurrency smoke

## Readiness decision

Ready for supervised local macOS use with two bounded, independent Gauntlets
and a queued third. The earlier live smoke established subscription-backed
execution, overlap, queue handoff, exact artifacts, independent critique, and
explicit Conductor acknowledgment. These changes address its two concrete
follow-up defects. They do not certify unattended full-app QA, Windows/Linux,
multi-machine execution, or arbitrary dependency-heavy workloads.

No additional live model calls, merges, pushes, releases, or deployments were
made for this follow-up. Existing candidates and receipts remain intact.
The local compiled app was rebuilt; previously packaged app copies are not updated.

## Node child execution

Each new isolated launch now receives a main-owned, read-only `bin/node`
launcher as `HIVE_NODE` and on PATH. It explicitly sets
`ELECTRON_RUN_AS_NODE=1` before executing the bundled runtime. This survives
replacement child environments, including an empty environment, instead of
depending on the agent preserving the flag. Claude Conductor, Claude fresh
workers, and Codex fresh Critics use the same environment adapter.

The macOS sandbox grants read access to that exact launcher, not a writable
runtime directory. Existing subscription admission, network restrictions,
scoped control authority, and root-process cleanup behavior are unchanged.
Prompts explain how to capture HIVE_NODE for child processes. Deliberately
executing raw `process.execPath` without Node mode is still unsupported;
the launcher fixes the supported agent-facing path, not every possible command.

An actual sandbox regression exercised absolute launcher and PATH invocation,
replacement/empty environments, nested `node --test` children, refusal to
rewrite the launcher, and continued execution after that refused write.
Existing authority, ambient-credential isolation, and transport tests passed.

## Completed-run layout

The run-detail grid now uses `minmax(0, 1fr)`, a zero minimum width, and wrapping
for long content. The live harness measures the inner evidence viewport and
detail panel as well as the document, so a fitting outer page no longer hides
clipping inside the panel.

Reopened the three real, already-passed candidates in the compiled desktop.
The bootstrap refuses profiles containing active/non-passed runs. Switching
among all three at 1440×870 and 1920×1080 preserved run/artifact identity and
launch counts, with zero renderer errors. No new provider sessions were needed.

Before the fix, all three Mac-width panels failed the new assertion. Attention
had 1120px of content in a 958px detail panel. After the fix, all six viewport/run
combinations passed; the Mac detail panel was 958px wide with 958px scrollWidth.
Manual inspection of the Attention screenshots at both sizes confirmed readable
wrapped content and no inner horizontal scrollbar. Screenshots use native DPR 2;
this was not a physical 1080p-monitor test.

## Evidence and checks

- Earlier live acceptance: [concurrency report](2026-09-06-live-concurrency-ui.md).
- Before-fix UI evidence: `/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-completed-layout-fe5GUy`.
- After-fix UI evidence: `/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-completed-layout-tBn5DM`.
- Each UI evidence directory contains receipt.json and six screenshots.
- `npm run build`, `npm run typecheck:node`, and `npm run typecheck:web` passed.
- All 57 focused tests passed with zero skips. They cover isolated control, Claude fresh/Conductor sessions, Codex
  fresh sessions, sandbox restrictions, prompt contracts, concurrency evidence,
  and nested layout overflow detection.

The verification skill kept this follow-up tied to the observed failing
boundaries and the real desktop/sandbox, without expanding into another live
acceptance campaign. The original smoke's partial verdict remains historical;
these targeted regression results supplement it rather than rewriting it as a
crash-free live run.

Next step: use the rebuilt local app for a real bounded project with explicit
tests and review the unmerged candidate. Keep concurrency at two initially.
