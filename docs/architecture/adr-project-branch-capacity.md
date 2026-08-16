# ADR: Projects, machine Branches, and capacity-shaped offices

- Status: Accepted
- Date: 2026-08-16
- Owners: Operatus architecture

## Context

Operatus currently presents a Firm as a workspace containing Branches, with one
Branch representing one durable machine identity. Repositories and projected
runs are then associated with the paired node. This is sufficient for a single
project per machine, but it becomes ambiguous when:

- one project needs work from several machines;
- one machine contributes to several unrelated projects;
- a powerful machine should host more concurrent workers than a small laptop;
- an operator wants a visual office that reflects configured capacity rather
  than merely applying a different color theme; or
- shared boards, roadmaps, skill locks, and published knowledge should span a
  selected group of machines without moving local execution authority into the
  hosted control plane.

The product also needs to describe two legitimate scaling strategies. Vertical
scaling increases concurrent agent capacity on one machine. Horizontal scaling
adds more machine Branches. Operatus should make both strategies legible without
pretending that a local socket, provider session, worktree, or Git checkout spans
machines.

## Decision

Operatus will use the following hierarchy:

```text
Firm
  → Project
      → Branch allocation
          → Branch (one physical machine)
              → Venture / Gauntlet run
                  → Worker / worktree / artifact
```

### Firm

A Firm is the identity and policy boundary currently represented by a hosted
workspace. It owns membership, the machine directory, shared policy, the pinned
Skill Depot catalog, explicitly published knowledge, and durable audit history.
It does not own local provider processes, local files, Git artifacts, or
Gauntlet state transitions.

### Project

A Project is a shared work context inside a Firm. It may contain repository
identities, task-board or roadmap integrations, shared goals, published
knowledge, skill assignments, and redacted run history. A Project can use
several Branches, and one Branch can participate in several Projects.

Project selection changes the work context being viewed. It does not change the
identity of the physical machine.

### Branch

A Branch remains one durable physical machine identity. A macOS, Windows, or
Linux machine runs one Operatus node and appears as one named Branch in the
Firm. Its name, visual theme, detected capabilities, presence, and pairing
history survive project switches and temporary disconnection.

A Branch may serve multiple Projects, but each local repository and run remains
bound to the exact Branch that owns its files and process state.

### Branch allocation

The many-to-many relationship between Projects and Branches is represented by
a Branch allocation. It records whether a Branch may serve a Project and the
operator-defined limits for that pairing, including:

- maximum concurrent workers;
- maximum worktrees;
- maximum concurrent Gauntlet runs;
- allowed providers and models;
- assigned immutable skill locks;
- repository availability; and
- optional scheduling priority.

An allocation may narrow a Branch's global limits but may never exceed them.
Changing an allocation does not rewrite historical runs.

## Capacity model

Each Branch reports detected capacity separately from operator limits.

Detected capacity may include platform, architecture, CPU, memory, provider
availability, current load, and health. These values are advisory observations.
Operator limits are explicit policy and remain authoritative even when the
machine could support more work.

The initial limits are:

- `maxConcurrentWorkers`;
- `maxWorktrees`;
- `maxConcurrentRuns`; and
- a capacity mode of `fixed` or `assisted`.

Assisted mode may recommend limits from observed resources, but it must not
silently increase them. Local launch admission enforces the resolved limit.
Hosted settings and floor graphics are projections of that policy, not the
enforcement point.

Vertical scale means raising capacity within one Branch. Horizontal scale means
adding Branches and assigning them to Projects. Automatic cross-Branch routing
is not required for either model; operators may choose the destination Branch
manually until a bounded scheduler is implemented.

## Dynamic office visualization

The office will be assembled from deterministic modular layouts rather than by
shrinking a single finished illustration. A layout resolver receives the
configured worker capacity, active roles, and viewport class and returns a
stable set of stations and paths.

The first layout bands are:

| Configured worker capacity | Presentation |
|---|---|
| 1–4 | Compact studio |
| 5–8 | Standard Branch office |
| 9–12 | Expanded operations floor |
| 13–16 | Large Branch floor |
| More than 16 | Aggregated teams or departments |

Every layout preserves a Conductor position, worker desks, evidence/Critic
space, repair space, valid movement paths, and accessible non-color labels.
Configured but idle capacity appears as available desks. Active workers occupy
those desks. Capacity above the visual upper bound is summarized rather than
rendered as unreadably small characters.

Layout selection, character positions, animation, and office decoration remain
non-authoritative projections. They cannot launch workers, change limits,
acknowledge Critic reports, or alter run state.

## Branch onboarding

Adding a Branch to a Firm will use a short setup flow:

1. Name the Branch and choose its visual theme.
2. Pair one physical node.
3. Review detected resources, providers, and health.
4. Select a capacity preset or explicit limits.
5. Select the Projects the Branch may serve.
6. Choose allowed providers, models, and skills for each allocation.
7. Preview the resulting office layout.
8. Confirm the policy and bring the Branch online.

All choices remain editable. Lowering capacity stops new launches from being
admitted but does not terminate active work unless the operator performs a
separate explicit action.

## Data-model direction

The hosted schema will evolve additively:

- `workspaces` continue to represent Firms during migration;
- add `projects` scoped to a Firm;
- add `project_branches` for many-to-many allocation and project-specific
  limits;
- move repository membership into a Project while retaining its owning node;
- add a versioned Branch capacity profile with detected and operator-defined
  fields kept separate; and
- include resolved capacity and layout receipts in redacted projections.

Existing personal Firms receive one default Project. Existing Branch, node,
repository, and run identities remain stable. Migrations must retain RLS,
explicit grants, append-only audit events, and one active node per Branch.

## Authority and coordination

The hosted Firm and Project layers may coordinate shared boards, sealed work
orders, immutable skill locks, and redacted status. They do not become Git or
Gauntlet authority. Every destination Branch revalidates work locally against
its allocation, capacity, repository availability, and current run state.

Cross-Branch automation, when added, will send bounded work orders through the
authenticated relay. It will not expose one machine's local socket, terminal,
credentials, or filesystem to another machine.

## Consequences

This decision adds a Project layer and an explicit many-to-many allocation,
which is more structured than the current tree. In return it prevents physical
machines, work contexts, and visual offices from being conflated. It supports
side projects, fleet-wide initiatives, vertically scaled compute, horizontally
scaled fleets, and capacity-aware presentation without changing the local
authority model.

The main implementation cost is coordinated schema, onboarding, admission
control, and renderer work. Fully automatic scheduling is intentionally deferred
until manual Branch selection, shared Project views, and capacity enforcement
are trustworthy.

## Delivery sequence

1. Add Projects and Branch allocations with a default-project migration.
2. Add Branch capacity profiles and the onboarding/settings flow.
3. Enforce worker, worktree, and run admission limits locally.
4. Add deterministic modular office layouts and capacity receipts.
5. Add Project-wide boards, run aggregation, and repository views.
6. Add optional bounded cross-Branch routing after the manual model is proven.
