# Gauntlet Runs

> Current development build: isolated macOS Gauntlets are enabled, with
> subscription authentication checked before each launch. Legacy Add agent,
> hidden workers and API inference remain disabled. See the
> [subscription-only policy](architecture/adr-subscription-only.md) and
> [startup verification](reviews/2026-09-06-startup-admission.md).

A Gauntlet Run conducts fresh CLI agents against an immutable quality bar and exact Git commits.

## Start a run

1. Open the top-level **Runs** view.
2. Choose a local Git repository with a clean, resolvable base commit.
3. Enter a bounded objective. The form uses your saved Conductor preference, with Codex / GPT-6 Astra as the new-profile default. Either Claude or Codex can conduct. Implementer and Repairer use Claude; the independent Critic uses Codex / GPT-5.6 Sol. Blank models resolve to the inspected role defaults (Astra for a Codex Conductor, Fable 5.1 for Claude, Sol for a Codex Critic); unsupported combinations fail without fallback.
4. Optionally assign synchronized Skill Depot entries to roles. The resolved skills are locked when the run is created.
5. Start the run and watch the contract, launches, commits, checks, reports, acknowledgments, repair packets, and events from the Runs surface.

The desktop dispatches a new run directly to its isolated native lifecycle. It
does not require an ordinary terminal Conductor or deliver the objective through
a shared mailbox. The form returns the recorded run immediately; Electron main
owns subsequent execution. An expired login, unavailable subscription allowance,
unsupported binary, or unsafe configuration causes an explicit stop. Reconnect
in the provider's own CLI and start a new run after resolving an expired login.
Do not treat a successful startup probe as acceptance of the full Gauntlet loop.

To open this checkout's rebuilt desktop app:

```bash
cd /Users/dahlia/Code/operatus
env -u ELECTRON_RUN_AS_NODE npm run preview
```

Keep paid extra usage and automatic top-ups disabled on both accounts. Codex
credit availability is recorded, not treated as API authentication or proof of
disabled top-ups. Subscription exhaustion still stops requests.

Each new worker attempt gets `operatus/gauntlet/<run-id>-attempt-<launch-id>`. The final candidate branch is recorded on the latest artifact and remains unmerged and unpushed. Review or integrate that exact artifact with ordinary Git tools after the run ends.

### Passed is not delivered

A passed candidate stays in **Needs you** until you record its disposition in
**Candidate handoff**. Inspect the exact commit and Critic evidence, then note
who takes it forward and the next action, or why you are setting it aside.
Saving requires the current run version and exact candidate SHA with an existing
artifact receipt. It records a human note, not proof of integration or delivery.

The candidate can be returned to Needs you with a new reason. Its full disposition
history remains in the timeline. Runtime warnings have their own review and are
not dismissed by a candidate note. Neither action starts a provider, changes a
verdict, merges or pushes a commit, or removes a worktree. Unhandled candidates
remain discoverable beyond the 100-item closed-history limit, including older
passed runs that have never had a handoff recorded.

## Local run capacity

### Skill preparation limits

Each role's complete assigned skill set is limited to 64 MiB and 8,000 file/directory
entries per materialized profile, in addition to the existing per-skill 16 MiB /
2,000-entry bounds. Nesting is limited to 64 levels. Oversized new selections are
rejected before the run is persisted; older locks are revalidated before copying.
Support files and the canonical tree digests are preserved, not silently truncated.

Preparation checks all selected trees before creating targets, copies regular
files in bounded chunks, rejects symlinks/special files and refuses to merge with
existing skill targets. It requires enough destination-volume space for the
planned bytes plus a 512 MiB diagnostic reserve. Unknown filesystem statistics
fail closed. Failed copies are not launched or reused; partial private preparation
may remain for inspection. No repository installation scripts run.

These limits govern skill preparation only. They are not filesystem quotas and
cannot reserve space against other processes. Worktrees, provider scratch files,
native executable caches and aggregate multi-run storage still need broader
resource-pressure acceptance.

### Run reservations

The **Capacity** disclosure in Runs shows native lifecycle reservations, waiting
runs and quarantined slots. The default is two concurrent Gauntlets, configurable
from one to eight. Each reservation permits a Conductor and one fresh worker at
a time. This is not a machine-wide CPU/memory limit or a shared subscription quota.
Ordinary agents are outside this scheduler.

Waiting is FIFO and persisted in the main-process SQLite database. It does not
prepare a Conductor identity, provider profile or worker worktree. Waiting consumes
the original overall run budget. Cancelling a waiting run starts no provider.
Lowering the limit retains active reservations and delays further admission.

Shutdown preserves unprepared waiting entries. An interrupted active reservation
is quarantined on restart, not automatically resumed or declared dead. Failed
native preparation without a drain handle and unconfirmed process/gateway shutdown
also retain capacity. Inspect the run's native process and gateway evidence, end
any interrupted active run, and enter an inspection note before using **Release
inspected reservation**. This is an audited human scheduling decision, not proof
that every process descendant stopped; runtime warnings and artifact verdicts are
unchanged. Capacity controls do not bypass subscription admission.

These paths have deterministic and native-CLI/synthetic-provider coverage. The
new capacity controls still require an unlocked-Mac visual/interaction acceptance
pass, and live subscription-backed multi-run acceptance remains open.

## Role ownership

- **Conductor:** long-lived lead; freezes intent, interprets evidence, acknowledges critics, synthesizes repair, and stops or escalates.
- **Implementer:** fresh worker in an isolated candidate worktree.
- **Critic:** fresh, independent, read-only worker on one detached exact commit.
- **Repairer:** fresh worker receiving only the frozen contract, expected commit, and bounded repair packet.

The desktop defaults to Codex / GPT-6 Astra for Conductor unless you have saved a different preference. Implementer and Repairer use Claude Code; Critic uses Codex / GPT-5.6 Sol. Changing the Conductor provider clears the other provider's model selection. The lower-level backend retains its original Claude default for callers that omit provider configuration.

A Codex Conductor owns one fresh app-server process and native thread across
orientation and subsequent acknowledgment turns. Every turn has a distinct,
persisted native identity. Critics never share or resume that thread. The lead
receives the exact main-produced candidate patch and frozen check receipts, not
only a Critic summary or the original orientation checkout. Neither provider can
write authoritative run state directly; the scoped control socket still validates
every decision. Subscription admission, read-only lead confinement, timeouts and
gateway revocation remain mandatory. Interrupted app sessions do not automatically
resume after restart.

## Authority

### Native session diagnostics

Under **Role sessions → Output diagnostics**, new native exit records retain
received/stdout/stderr byte counts and whether each in-memory diagnostic preview
was truncated. These are historical transport measurements, not task progress,
and preview truncation alone does not mean failure. Raw model output, stderr text,
commands and credentials are not added to this journal. Missing measurements on
an active, interrupted or older launch are unavailable, never assumed zero.

Known native failures also provide a **Next inspection** suggestion alongside
their recorded reason. Unconfirmed shutdown takes precedence over retry advice.
A generic provider error does not establish authentication failure or exhausted
allowance. Suggestions do not execute commands, restart sessions, release capacity
or change protocol authority. This surface still requires visual acceptance on
an unlocked Mac.

### Subscription evidence

Under **Role sessions → Session identity and safeguards**, native Claude launches
retain a historical account check: the pinned executable version/digest, model,
hashed account and organization identities, observation time, short validity
window, Claude Max plan and extra-usage-disabled result. No credential or
credential hash is stored in this record. Fixture/injected dependencies are
explicitly labeled and are not live-provider evidence.

The main process must persist this check before the production native compositor
starts a session. Missing/failed persistence stops preparation. The record is
immutable and session-bound; a cancelled, replaced or already-started launch
cannot acquire a new retroactive check. An exact duplicate delivery is harmless.

This receipt is a component check, never a reusable capability or a promise of
current account health. The gateway separately rechecks the account for requests.
The global subscription hold, executable/model admission and process confinement
still apply. Existing launches without a record are shown as missing evidence,
not implicitly approved. Codex admission remains unproven and unsupported by this
Claude-specific compositor; it is not silently substituted.

### Protocol and artifact authority

`gauntlet.db` under Operatus application data is the local protocol authority. Git commits are artifact authority. A report for another SHA or bar digest is stale and cannot pass or repair the current artifact.

Attempt branches preserve interrupted commits without treating them as accepted artifacts. Retries use fresh branches at the authoritative expected SHA, not at an abandoned attempt's HEAD. Older runs may retain the legacy `operatus/gauntlet/<run-id>` branch. Operatus never resets, merges, or pushes these refs automatically. See the [attempt-branch ADR](architecture/adr-gauntlet-attempt-branches.md).

The **Retained work · observations** panel records preservation separately from
accepted artifacts. A pending request means cleanup has not yet been confirmed;
the finished observation records preserved, missing, or failed, along with the
observed commit, dirty state and recovery location when available. Cancellation
can finish before an in-flight check closes, so the preservation result may arrive
later. Restart reconciliation retries pending requests, including on terminal runs.
These are append-only main-process receipts, not approval, live filesystem health,
or a tamper-proof log against the machine's owner. Files may change after observation.
Worktrees created before their launch was recorded still require separate orphan
recovery. See [verification and limits](reviews/2026-09-06-preservation-receipts.md).

Repair rounds and infrastructure retries are separate budgets. A granted
transport retry restarts the same round in a fresh session at the same artifact,
even on the last permitted repair round. It consumes the run's infrastructure
retry allowance, not another repair round. A new substantive repair still
requires acknowledged Critic evidence and available repair capacity.

The renderer may start, observe, and cancel runs, but it cannot submit worker completions, critic reports, or Conductor acknowledgments. Those operations require the assigned run/launch capability. The isolated helper reads its private credential sidecar; the renderer does not receive it. There is no global Conductor token. A restarted backend rejects the previous Conductor capability and escalates interrupted ownership for explicit recovery. Production isolated launch composition remains held; see the release-readiness roadmap.

## Required local tools

Install and authenticate at least one supported CLI. The default profile requires both:

```text
claude --version
codex --version
```

Gauntlet execution is intended to use those existing CLI subscriptions only.
API-backed voice and external inference are disabled in this development build.

CLI discovery retains inherited runtime diagnostics. The isolated Claude path
instead requires an inspected executable copied into a private profile,
main-owned subscription admission and a revocable local gateway. It does not
import arbitrary provider configuration or API keys. Missing or unverified
admission fails closed; the configured Codex Critic is never silently replaced
with Claude. Installation alone is not admission.

## Provider enforcement

| Current path | Demonstrated boundary | Context | Remaining gate |
|---|---|---|---|
| Native Claude Critic on macOS, scripted fixture | OS-enforced detached artifact read-only boundary and exact evidence grant | Fresh CLI process and explicit session UUID | Real subscription-only judgment and full acceptance |
| Native Claude Implementer/Repairer on macOS, scripted fixture | Candidate writes with isolated profile/scratch and protected control/skill files | Fresh CLI process and explicit session UUID | Real substantial-project acceptance and resource capacity |
| Native Claude Conductor on macOS, scripted fixture | Read-only repository and own-run evidence; scoped socket decisions | One persistent CLI process per run | Real conducted operation and explicit recovery UX |
| Native Codex | Not admitted | Not demonstrated through the isolated runner | No-paid-credit assurance and native adapter acceptance |

Prepared capability receipts describe intended restrictions, not proof of a
successful sandbox launch. Main-observed runtime receipts separately record the
actual process/session and boundary digest. Admission-receipt persistence and
full provider parity remain unfinished. See the readiness roadmap for evidence.

## Role control helper

Isolated roles receive `HIVE_NODE` and `OPERATUS_GAUNTLET_HELPER` paths. The helper
reads a private, read-only launch capability sidecar; the token is not placed in
the process environment or renderer. Inside an assigned role, commands include:

```text
"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" freeze --run <id> --launch <lead-id> --file contract.json
"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" commit --run <id> --launch <worker-id> --expected-sha <sha> --bar-digest <digest> --message <text>
"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" complete --run <id> --launch <worker-id> --sha <40-char-sha>
"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" critic --run <id> --launch <critic-id> --file report.json
"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" acknowledge --run <id> --launch <lead-id> --file acknowledgment.json
"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" escalate --run <id> --launch <lead-id> --reason <text>
"$HIVE_NODE" "$OPERATUS_GAUNTLET_HELPER" cancel --run <id> --launch <lead-id> --reason <text>
```

Requests are newline-framed JSON, limited to 1 MiB, checked against the current
run state, and committed transactionally. A worker cannot use lead commands.
The capability sidecar must not be copied into logs or remote projections.

## Agent Primitives development override

The committed submodule pin remains the default and release lock. For development only, set `OPERATUS_AGENT_PRIMITIVES_PATH` to an absolute or relative local Git checkout before starting Operatus. An override must have an exact Git HEAD; each launch receipt records that actual commit and file digest without changing the committed submodule pin. Packaged builds continue to use only the bundled pin.

## Inspection and recovery

- Exact commits and frozen check receipts are visible in the Runs detail view.
- Restart reconciliation preserves interrupted work, records unknown process exits, rejects old lead capabilities and escalates lost Conductor ownership for explicit recovery. It does not resume the former CLI from a recorded PID.
- Dirty, wrong-SHA, mutated-Critic, timed-out, and crashed launch worktrees are detached and locked for diagnosis rather than deleted.
- A stale report is recorded as an invalid transition result and cannot drive acknowledgment or repair.
- Cancel is terminal. Repair non-convergence becomes `human_required`; infrastructure exhaustion becomes `infrastructure_failure`.
- The local authority database is `gauntlet.db` inside the Operatus application profile. Do not edit it directly; inspect through the Runs UI and event stream.

## Failure behavior

Malformed structured output, a dirty completion, a wrong SHA, critic mutation, timeout, crash, or duplicate action fails closed. One infrastructure relaunch is allowed by default. Three repair rounds are allowed before human escalation.

Default budgets are 30 minutes for implementation/repair, 20 minutes for critique, and two hours overall. A transport or malformed-output relaunch does not consume a repair round. Repeated infrastructure failure terminates explicitly rather than silently passing.
