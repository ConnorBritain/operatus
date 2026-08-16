# Gauntlet Runs

A Gauntlet Run conducts fresh CLI agents against an immutable quality bar and exact Git commits.

## Start a run

1. Open **Command Center → Runs**.
2. Choose a local Git repository with a clean, resolvable base commit.
3. Enter a bounded objective. Select Claude Code or Codex and an optional model for each role.
4. Optionally assign synchronized Skill Depot entries to roles. The resolved skills are locked when the run is created.
5. Start the run and watch the contract, launches, commits, checks, reports, acknowledgments, repair packets, and events from the Runs surface.

Operatus creates `operatus/gauntlet/<run-id>` and leaves the final candidate branch unmerged and unpushed. Review or integrate it with ordinary Git tools after the run ends.

## Roles

- **Conductor:** long-lived lead; freezes intent, interprets evidence, acknowledges critics, synthesizes repair, and stops or escalates.
- **Implementer:** fresh worker in an isolated candidate worktree.
- **Critic:** fresh, independent, read-only worker on one detached exact commit.
- **Repairer:** fresh worker receiving only the frozen contract, expected commit, and bounded repair packet.

Defaults are Claude Code for Conductor, Implementer, and Repairer, and Codex for Critic. Every role is configurable.

## Authority

`gauntlet.db` under Operatus application data is the local protocol authority. Git commits are artifact authority. A report for another SHA or bar digest is stale and cannot pass or repair the current artifact.

The candidate branch is `operatus/gauntlet/<run-id>`. Operatus never merges or pushes it automatically.

The renderer may start, observe, and cancel runs, but it cannot submit worker completions, critic reports, or Conductor acknowledgments. Those operations require the scoped token placed only in the launched role's environment. This prevents a visual projection or compromised browser surface from impersonating a protocol actor.

## Required local tools

Install and authenticate at least one supported CLI. The default profile requires both:

```text
claude --version
codex --version
```

Gauntlet execution uses those existing CLI subscriptions. Optional voice or third-party integrations are separate and may require their own credentials.

Operatus discovers and authenticates the CLIs through the inherited Munder runtime. It does not ask for hosted model API keys for Gauntlet execution. If a configured CLI is missing or unauthenticated, the launch fails explicitly and follows the bounded infrastructure-retry policy.

## Provider enforcement

| Role/provider | Filesystem | Fresh context | Tool restrictions |
|---|---|---|---|
| Codex Critic | enforced read-only launch | enforced fresh session | enforced/partial according to available Codex flags |
| Claude Critic | prompt plus isolated detached worktree | fresh process | partial; mutation is detected after review |
| Claude/Codex builder | isolated candidate worktree | enforced fresh session | advisory beyond worktree and control-token boundaries |

Every launch records its actual capability receipt. Operatus does not claim provider parity where the underlying CLI cannot enforce it.

## Role control helper

Operatus-launched roles receive `OPERATUS_GAUNTLET_SOCKET`, `OPERATUS_GAUNTLET_TOKEN`, and `OPERATUS_GAUNTLET_HELPER`. The helper accepts only:

```text
operatus-gauntlet freeze      --run <id> --file contract.json
operatus-gauntlet complete    --run <id> --launch <id> --sha <40-char-sha>
operatus-gauntlet critic      --run <id> --launch <id> --file report.json
operatus-gauntlet acknowledge --run <id> --file acknowledgment.json
operatus-gauntlet escalate    --run <id> --reason <text>
operatus-gauntlet cancel      --run <id> --reason <text>
```

Requests are newline-framed JSON, limited to 1 MiB, checked against the current run state, and committed transactionally. These environment values are local authorities and must not be copied into logs or remote projections.

## Agent Primitives development override

The committed submodule pin remains the default and release lock. For development only, set `OPERATUS_AGENT_PRIMITIVES_PATH` to an absolute or relative local Git checkout before starting Operatus. An override must have an exact Git HEAD; each launch receipt records that actual commit and file digest without changing the committed submodule pin. Packaged builds continue to use only the bundled pin.

## Inspection and recovery

- Exact commits and frozen check receipts are visible in the Runs detail view.
- Restart reconciliation marks an interrupted launch failed, preserves its worktree, and permits at most the configured fresh relaunch.
- Dirty, wrong-SHA, mutated-Critic, timed-out, and crashed launch worktrees are detached and locked for diagnosis rather than deleted.
- A stale report is recorded as an invalid transition result and cannot drive acknowledgment or repair.
- Cancel is terminal. Repair non-convergence becomes `human_required`; infrastructure exhaustion becomes `infrastructure_failure`.
- The local authority database is `gauntlet.db` inside the Operatus application profile. Do not edit it directly; inspect through the Runs UI and event stream.

## Failure behavior

Malformed structured output, a dirty completion, a wrong SHA, critic mutation, timeout, crash, or duplicate action fails closed. One infrastructure relaunch is allowed by default. Three repair rounds are allowed before human escalation.

Default budgets are 30 minutes for implementation/repair, 20 minutes for critique, and two hours overall. A transport or malformed-output relaunch does not consume a repair round. Repeated infrastructure failure terminates explicitly rather than silently passing.
