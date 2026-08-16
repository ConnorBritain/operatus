# Atelier Gauntlet architecture synthesis

## SOURCE SYNTHESIS

The original Gauntlet Loop freezes an external, observable bar before implementation; separates builders from fresh critics; evaluates the real artifact; and repeats only while material improvement remains. Claude of Duty demonstrates that parallel fanout is useful for separable work but sequential ownership is safer for coupled systems. Autoresearch contributes bounded experiments, immutable evaluation, and exact recorded outcomes. LLM Council contributes independent opinions plus a separate synthesizing authority.

Roadmap turns those ideas into a deterministic protocol around probabilistic agents. Agent Primitives separates portable behavior contracts from harness packaging. Munder supplies the local desktop runtime. Atelier composes these layers rather than treating one repository as a template for all concerns.

## EXISTING MUNDER ARCHITECTURE

Electron main owns CLI providers, PTYs, hooks, Git, worktrees, SQLite, memory, and IPC. React renders the control center; Pixi renders the floor. The Hive provides durable agent homes and asynchronous messages.

The reusable runtime is strong, but its orchestration is largely prompt- and file-convention-driven. Ordinary worktree creation may fall back to a shared checkout, completion is self-reported, and renderer/task state is not tied to an immutable artifact. Those paths are not reused for Gauntlet authority.

## AGENT PRIMITIVES CATALOG / CONTRACTS

Primitive kind describes the promise: reviewer, transformer, author, investigator, or planner. Surface describes packaging: agent, skill, command, or hook. Reviewer isolation and read-only behavior are load-bearing, and Atelier records whether each provider enforces them or merely receives an advisory prompt.

The initial General Engineering Critic composes Atelier correctness review with `verification-critic` and `architecture-reviewer`. It remains one fresh critic process for the first vertical slice and returns receipts for both typed primitives.

## REUSABLE COMPONENTS

- node-pty lifecycle and terminal streaming
- Claude Code and Codex provider discovery/authentication
- Hive mailboxes and memory as collaboration context
- better-sqlite3 and the Electron main-process single-writer pattern
- Git diff/log inspection and Monaco rendering
- Pixi floor, stations, animation, and pathfinding
- hooks, idle delivery, telemetry, and circuit-breaker signals

## ROADMAP SEMANTICS TO PRESERVE

- immutable bar plus digest
- full commit SHA identity
- stale verdict rejection
- critic result separate from lead acknowledgment
- repair packet owned by the lead
- expected-head repair
- fresh re-critique after every changed artifact
- idempotent transitions and bounded retries
- explicit `HUMAN_REQUIRED`, failure, and cancellation states

## AGENT PRIMITIVES TO REUSE

Agent Primitives is pinned as a submodule. Atelier validates the harness-neutral source, creates a resolution receipt, and composes the prompt at launch. A local-path override may be configured for development, but does not change the committed pin or run receipt.

## ROADMAP IMPLEMENTATION DETAILS NOT TO COPY BLINDLY

Local mode does not reproduce GitHub comments, PR markers, actor checks, protected-ref launch claims, or a JSON restart ledger. SQLite transactions provide local launch uniqueness and transition ordering; Git commits provide artifact identity. A later Roadmap backend delegates those responsibilities back to Roadmap/GitHub.

## ORIGINAL GAUNTLET PRINCIPLES TO PRESERVE

The Conductor owns intent and final judgment. Builders do not grade themselves. Critics inspect the real artifact without the builder's persuasive narrative. Repairers receive a bounded packet and cannot silently move the bar. Workers never merge.

## COUPLING / RISK AREAS

- `src/main/index.ts` is a large composition root; Gauntlet logic must stay outside it.
- Provider permissions differ. Enforcement claims must remain honest.
- A completion receipt is only a trigger for deterministic Git/check inspection.
- Normal worktree cleanup is unsafe for Gauntlet work and must remain separate.
- Hive, localStorage, and the visual floor are projections, not authority.
- Remote access introduces identity, encryption, redaction, and replay risks.
- Upstream updater/telemetry and restricted assets cannot ship under Atelier identity.

## PROPOSED GAUNTLET DOMAIN MODEL

`GauntletRun` owns phase and limits. `FrozenRunContract` owns objective, criteria, checks, constraints, exclusions, and digest. `AgentLaunch` binds one fresh role session to an expected SHA and capability receipt. `Artifact` binds a full commit to its producing launch. `CriticReport`, `LeadAcknowledgment`, and `RepairPacket` form an explicit trust chain. `RunEvent` is append-only. `SkillLockReceipt` fixes contextual skills independently from protocol primitives.

## PROPOSED AUTHORITY / TRUST MODEL

SQLite is local run authority. Git is artifact authority. Electron main is the only writer. Role-scoped launch tokens limit local control commands. The Conductor alone freezes, acknowledges, repairs, passes, or escalates. UI, terminal text, messages, and memory never substitute for protocol records.

## PROPOSED STATE / CONTROL MODEL

The pure reducer validates state, artifact SHA, launch identity, contract digest, report identity, repair limits, retries, and terminal behavior before a transaction is committed. Optimistic run versions reject duplicate or stale writers. Incomplete runs are reconstructed from snapshots and append-only events on restart.

## ROADMAP INTEROPERABILITY MODEL

`LocalGauntletBackend` is the first backend. A future `RoadmapGauntletBackend` maps the same operations to Roadmap MCP/CLI tools. Provider execution is orthogonal to backend authority so hybrid local/remote workers remain possible without weakening artifact identity.

## FILES LIKELY TO CHANGE

Gauntlet domain/storage/workspace modules, shared/preload contracts, main-process composition, the Runs renderer, product metadata, documentation, and visual assets.

## FILES WE SHOULD AVOID CHANGING

Low-level PTY transport, terminal emulation, provider command parsing, Hive routing, Monaco, and Pixi movement/pathfinding should change only at narrow adapter seams.

## VERTICAL SLICE IMPLEMENTATION PLAN

Build and test the reducer/store/worktree boundary; resolve primitives and skills; add authenticated local role commands; adapt fresh Claude/Codex sessions; expose immutable snapshots/events; render Runs and floor state; replace restricted art; then validate restart, staleness, malformed output, timeouts, cancellation, and non-convergence in a temporary Git repository.
