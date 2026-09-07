# Operator attention priorities

Date: 2026-09-06. Implemented focus annotation, not project-level strategy execution.

## Finding

Gauntlet run cards provided objective, repository, phase and next protocol role,
but same-group ordering was recency-only. An older important decision could sit
below newer incidental failures. The legacy Tasks board has task priority and
dependencies, but these are not linked to exact Gauntlet work orders. Copying its
labels onto runs would invent an authoritative relationship.

## Change

The local desktop can now set low/normal/high **attention priority** with a
required reason. Schema ten stores an append-only journal with an independent
revision. The setting is not part of a frozen bar, run lifecycle version or
dispatch reservation. It cannot change who may acknowledge, pass, repair or
launch. It does not change the apparent time of the run's last protocol activity.

Unresolved attention always sorts before ordinary active work, then priority
sorts within the open group. Closed history remains recent-first. The detail
control explains that execution stays FIFO; no queue jumping or preemption is
implied. Run cards show the priority and the recorded stop reason. Existing
office ordering uses the same shared ordering projection, without new actors or
invented motion. Priority history is inspectable from the run overview.

Only the local main frame can invoke the setter; no scoped worker or remote
control command exposes it. Stale priority writes fail without losing prior
history. Renderer reconciliation checks independent monotonic evidence revisions,
including when a late response has a newer protocol version but older priority.

## Verification

The initial 35-test batch passed, including six new priority tests, existing
review behavior, run-view ordering, preservation and preparation migration.
Checks verify unchanged contract/events/dispatch/activity timestamps, unchanged
protocol version, successful subsequent protocol transition, reopen, stale writes,
input bounds, immutable history, local-frame rejection, warning precedence,
closed-history ordering and schema-nine upgrade without invented metadata.

The actual native mixed-provider concurrency fixture also passed both scenarios
after changing attention priorities while two native requests were held and a
third run queued. Run versions, contracts, events and capacity were unchanged by
the annotations. Each scenario then cancelled the first run and completed two
scripted implementation/repair/re-critique/acknowledgment loops. Claude 2.1.263
and Codex 0.153.4 executed actual tools, with synthetic local account metadata
and model responses. There was no real inference or external provider traffic.

Receipts under `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`:

- `op-native-concurrent-yvTgPL/receipt.json`: lead cancellation, 11 native launches,
  45 scripted requests, outcomes cancelled/passed/passed.
- `op-native-concurrent-bWnNYk/receipt.json`: dirty-worker cancellation, 12 native
  launches, 48 scripted requests, same outcomes. Two runs used the same checkout
  with isolated worktrees; the third used another repository.

The fixture removed only its own copied executables after draining; Git/SQLite
and structured evidence were retained. Node and web typechecks passed.
An additional 29-test office-projection/runtime-attention/scheduler/backend batch
passed, followed by the Electron production build and `git diff --check`.

## Remaining owner-operator gap

This does not link the legacy task board to runs, express project dependencies,
record integration ownership, or prove a project complete because child runs
passed. Those require explicit work-order relationships and an integration gate.
Attention priority must not be marketed as that coordination model. R3 remains
open. This change also does not establish real-model judgment or no-credit-spend
admission, and the production subscription hold is unchanged.

No rendered acceptance is claimed for these controls while the Mac remains
locked. A task-based visual exercise must check discoverability, clutter,
selection stability and whether the operator finds the right decision quickly.
