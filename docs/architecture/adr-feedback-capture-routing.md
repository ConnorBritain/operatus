# ADR: Durable feedback capture and scoped routing

- Status: Proposed
- Date: 2026-08-16
- Owners: Operatus architecture

## Context

Useful observations currently arise in terminal sessions, Critic findings,
Conductor decisions, repair outcomes, and direct operator feedback. Leaving those
observations inside one transcript makes them easy to lose. Publishing every
observation into shared memory is also unsafe: a tentative note from one worker
must not silently become policy for every future agent.

Operatus needs a durable path for learning while preserving fresh-context roles,
the frozen Gauntlet contract, local authority, privacy boundaries, and an
inspectable reason for why a later agent received particular guidance.

## Decision

Operatus will introduce a typed `FeedbackRecord` with an explicit audience,
review state, provenance, and lifecycle. Feedback is captured as evidence first
and becomes reusable guidance only after a human or authorized Conductor accepts
it for a defined scope.

### Feedback scopes

Each record targets exactly one primary scope:

- `launch`: only the current Implementer, Critic, Repairer, or Conductor launch;
- `role`: future launches of a named role or agent profile;
- `branch`: work performed on one physical machine;
- `project`: work performed for one shared Project across eligible Branches; or
- `firm`: guidance intentionally shared across the operator's entire Firm.

A narrower record may be promoted to a broader scope, but promotion is a new
audited decision. Subagents and workers may propose feedback; they cannot publish
Firm-wide guidance or alter another role's future context by themselves.

### Record contract

A `FeedbackRecord` contains:

- a stable ID and creation timestamp;
- source run, launch, role, artifact, and author identity when available;
- the observation, its supporting evidence, and an optional suggested action;
- target scope and optional role, Branch, Project, or repository selectors;
- status of `proposed`, `accepted`, `rejected`, `superseded`, or `expired`;
- reviewer identity, reason, and decision timestamp; and
- sensitivity, retention, expiry, and supersession metadata.

Accepted feedback is delivered to eligible future launch packets with a
resolution receipt containing the feedback IDs and digests. The recipient can
therefore distinguish protocol instructions, selected skills, and learned
guidance.

### Authority boundaries

Feedback cannot change a frozen bar, artifact identity, state transition,
acknowledgment authority, provider capability, or pinned skill source. It may
suggest a skill assignment or policy change, but those changes follow their own
approval and locking process.

Raw terminal output and prompts are not automatically promoted or synchronized.
Hosted projections contain only the record fields permitted by the Firm's
privacy policy. Local Git and SQLite state remain authoritative for run evidence.

### Product flow

The first feedback surface will allow an operator or Conductor to capture a note
from a Critic finding, completion receipt, repair outcome, or manual observation.
The author selects the intended audience, reviewer, and optional expiry. A review
queue makes proposed items visible before they can affect future work.

Run and agent detail views will show which accepted feedback was supplied, which
items were ignored, and which newer record superseded an older one. Operators can
revoke or narrow previously accepted guidance without rewriting historical
receipts.

## Consequences

This model makes practical lessons durable and directs them to the agents that
need them without creating an unreviewed global memory. It adds a review queue,
scope resolution, retention controls, and launch-packet receipts. Those costs are
necessary to prevent stale, contradictory, sensitive, or low-confidence notes
from quietly steering the whole Firm.

## Delivery sequence

1. Add the feedback schema, append-only decision events, and scope resolver.
2. Add manual capture from findings, completions, and run detail.
3. Add review, promotion, supersession, expiry, and revocation controls.
4. Add receipted delivery to fresh launch packets by role and scope.
5. Add optional suggestions from repeated outcomes, without automatic promotion.
