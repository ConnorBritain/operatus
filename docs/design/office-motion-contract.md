# Office motion contract

Date: 2026-09-05. Quiet default implemented; full role/station mapping planned.

2026-09-06 follow-up: [station reachability](../reviews/2026-09-06-office-station-reachability.md)
now covers the evidence-room doorway and failed-route cancellation. Compiled
captures expose remaining chair alignment and lifecycle-label mismatches.

## Observation

The inherited character system deliberately alternates random wandering and
desk rest in 30-second phases. Separate directors send relaxed workers to coffee,
cafeteria and errands and trigger reactions near the boss. These animations are
ambience, not evidence that agents are cooperating or making verified progress.

## Immediate change

Idle workers return to their assigned desk without a working halo. Random
wandering, timed social/errand directors and automatic completion cheers are
disabled. Existing directed state movement and actual message envelopes remain.
This is a quieter baseline, not the completed Gauntlet spatial projection.

## Target behavior

| Observed state/event | Visual meaning |
| --- | --- |
| Admitted launch starting | Enter and move to assigned role station; label starting until readiness is confirmed |
| Implementer running | Work at a stable implementation desk |
| Critic running | Inspect at an evidence station, tied to the reviewed SHA |
| Repairer running | Work at a repair station, tied to its bounded packet |
| Conductor interpreting/acknowledging | Remain at the lead's station; show the relevant decision/work order |
| Waiting for auth, permission, quota or a human | Rest without work animation; explicit reason and freshness indicator |
| Process exited/failed | Stop work animation immediately; retain an inspectable inactive marker |
| Worker completion | Await verification, not a success celebration |
| Acknowledged pass | Mark the verified candidate; do not imply it was integrated, merged or shipped |
| Actual mailbox delivery | Brief sender-to-recipient indicator with a discoverable message, not invented conversation |
| Stale/disconnected projection | Explicit unknown/stale state, never continued fictional activity |

Transitions animate once and settle. Repeated snapshots must not trigger
repeated journeys. Selection, panel focus and scroll position do not change when
an agent moves or launches. The user can inspect a journey's cause. Reduced motion
uses direct placement and text labels. A failed path should place/label the agent
honestly rather than make it circle indefinitely.

Stable agent, role, work-order and station IDs outlive a renderer refresh. Station
capacity follows local admission policy, not the number of decorative chairs.
Above the visual limit, summarize teams rather than shrinking people and labels.
The floor never launches a worker or changes a run's authoritative state.

Test the projection as a pure state-to-intent resolver, with separate pathfinding
and rendering tests, before introducing role-specific travel. Verify long idle,
blocked, retry, cancellation, exit, restart and stale snapshots; animation must
not imply a stronger outcome than the stored evidence.
