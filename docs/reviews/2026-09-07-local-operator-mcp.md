# Local operator MCP acceptance

The local stdio bridge exposes five tools: readiness/capacity, run listing,
one-run evidence, idempotent start, and version-checked cancellation. The Mac
desktop owns the authenticated Unix socket, policy checks, SQLite receipts and
dispatch through the existing isolated scheduler. This is not an agent capability
token or an alternative Conductor.

Verified during implementation:

- MCP SDK client/server initialization, tool discovery, strict argument errors
  and honest app-unavailable responses.
- Real SQLite and authenticated Unix-socket integration with the stdio client:
  one creation on repeated request IDs, changed-intent refusal, durable replay
  after store reopen, root/symlink restrictions, stale cancellation refusal,
  normal cancellation and removal of endpoint authority on shutdown.
- A failed creation transaction persists neither run nor start receipt.
- Run projection omits role token hashes and credentials. Role-only commands
  remain unavailable. Private policy files are required.
- Existing desktop-start and Conductor authority tests still pass. Both
  typechecks, Electron packaging and native SQLite/PTy checks pass.

The automated MCP mutation test uses a fake dispatcher and **does not invoke a
model**. It proves transport, persistence and command semantics, not successful
inference. The live Astra-led full-loop limitation from the separate runtime
report remains unchanged. No new claim of unattended or cross-machine operation.

The bridge is configured per OS-account app profile and disabled by default for
other users. Setup instructions and explicit trust/response limits are in
[`packages/operatus-mcp/README.md`](../../packages/operatus-mcp/README.md).

Raw historical UI screenshots and logs under `docs/reviews/assets` are retained
locally and excluded from this development publication to avoid disclosing
personal app/account context. Historical reports may refer to those local-only
captures; they are not downloadable public attachments.

## Installed desktop connection

After installing and reopening the MCP-enabled `/Applications/Operatus.app`, a
real SDK stdio client discovered all five tools and successfully called
`operatus_status` and `operatus_runs` against the desktop's authenticated socket.
Observed: macOS, no startup hold, two concurrent slots, no dispatches, zero runs
in this profile. This read-only check launched no model sessions and changed no
run state. A null startup hold is not a substitute for each launch's subscription
admission check. Codex and Claude Code registrations were verified; Claude Code
also reported its stdio MCP connection healthy.

Local verification totals: the 18-test operator/desktop-start/authority suite,
the 26-test operator/isolated-runner suite (five tests overlap), and the standalone
MCP protocol test all passed. The staged source secret scan found no leaks.
GitHub CI has not been claimed as passed by this local report.
