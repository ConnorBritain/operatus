# Agent Primitives and Skill Depot comparison

| Property | Agent Primitive | Skill Depot entry |
|---|---|---|
| Purpose | protocol-selected behavior contract | contextual operating guidance |
| Selection | deterministic bundle/role resolution | explicit user assignment per role/run |
| Type | reviewer, transformer, author, investigator, planner | repository-defined skill metadata |
| Trust | metadata, permissions, surface, clean-context validation | untrusted prose/support files in read-only materialization |
| Identity | pinned source commit plus primitive file digest | source commit plus complete-directory digest |
| Authority | may define required review behavior, never final judgment | cannot alter protocol authority or state |
| Collision | registry ID must resolve uniquely | duplicate role/name requires explicit source precedence |
| Initial use | verification and architecture review | optional engineering/productivity context |

The General Engineering Critic is one fresh review process composed from Ventura's correctness contract, `verification-critic`, and `architecture-reviewer`. The report carries a receipt for each primitive. This composition avoids uncoordinated fanout while preserving independent, typed review concerns.

Provider capability is recorded honestly: Codex read-only review can be enforced through launch flags and detached worktree validation; Claude review is partially enforced through isolation, prompt constraints, and post-run mutation detection. A skill assignment never upgrades that enforcement level.
