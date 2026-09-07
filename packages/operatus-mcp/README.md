# Operatus local MCP

A small stdio MCP server for controlling an **already-running local Operatus
desktop** from Codex, Claude Code, or another compatible MCP host. No hosted
service, inference API key, Computer Use dependency, or second scheduler.
Current execution support is macOS only. Windows/Linux daemon support is not
implied by a cross-platform Node client.

## Install

Use an Operatus checkout containing `src/main/gauntlet/operatorServer.ts`, build
and open that app once, then install this package's pinned dependencies:

```sh
cd /absolute/path/to/operatus
npm ci --ignore-scripts --prefix packages/operatus-mcp
node packages/operatus-mcp/configure.mjs --allow-repository /absolute/path/to/your/project
```

Repeat `--allow-repository` to allow multiple projects. A parent directory allows
repositories beneath it, so prefer individual projects unless you deliberately
want a broader development root. With no roots, starts and cancellations are
disabled, but observation of this profile's runs remains available. Setup refuses
to overwrite an existing config. Review changes manually in
`~/Library/Application Support/operatus/operator-mcp/config.json`, retain mode
`0600`, and restart Operatus after configuration changes.

For a non-default profile, pass `--profile /absolute/profile` to both setup and
the MCP server. This is a whole-profile operator, not per-client multi-tenant
authorization. Its tools can return private objectives, repository paths and
check logs to the configured MCP host; only connect hosts/providers you trust
with that material. No credentials are returned by the tool projections.

After restarting the updated desktop, register the stdio server:

```sh
codex mcp add operatus -- node /absolute/path/to/operatus/packages/operatus-mcp/server.mjs
claude mcp add --scope user --transport stdio operatus -- node /absolute/path/to/operatus/packages/operatus-mcp/server.mjs
```

Use an absolute Node executable path if your GUI client's PATH cannot find it.
Reload/restart the client session after registration. These commands do not grant
blanket approval to run tools. Keep the host's normal tool approvals enabled.
They register an MCP, not a paid API computer-use agent. Provider subscription
allowance is consumed only when you authorize actual Gauntlets.

## Tools

| Tool | Scope |
| --- | --- |
| `operatus_status` | Runtime hold, allowed roots, capacity and queue |
| `operatus_runs` | Bounded recent run list, optional repository filter |
| `operatus_run` | One run, optionally its exact artifacts, checks, reports, acknowledgments and runtime receipts |
| `operatus_start` | Create and dispatch one authorized run through the existing native scheduler |
| `operatus_cancel` | Cancel one exact run after repository/version checks |

Start requires an absolute allowed repository, bounded objective, full 40-character
`baseSha`, and a stable `requestId` (8–128 letters, digits, underscores or hyphens).
Read the desired commit from Git before requesting a start. Optional
`conductorProvider` and `conductorModel` choose Claude/Codex within the existing
admission policy; otherwise the saved desktop preference applies. Workers and
Critic retain current runtime defaults. This initial bridge does not change
budgets, capacity, skills, priority, credentials or provider admission settings.

**After an uncertain start result, reuse exactly the same requestId and
parameters.** The app persists creation and its receipt in one SQLite transaction.
A repeated ID with changed intent fails. A replay returns the original run,
including after restart; it never starts a second one or silently resumes an
interrupted provider. Status reflects the scheduler, not MCP process lifetime.
Closing your MCP client does not cancel work. A cancel response records intent,
not proof of completed process shutdown; inspect runtime receipts afterward.

Example request to your agent:

> Use Operatus for this repository and bounded objective. Inspect readiness and
> capacity first, start one run on this exact commit, and observe its evidence.
> Leave the candidate unmerged. Bring back any decision that needs me.

Use a different request ID for each independent project. Do not submit downstream
work until its dependencies are ready. Never treat a Critic PASS as a completed
Gauntlet without the Conductor acknowledgment and clean runtime evidence.

## Security and limits

- Disabled unless explicitly configured in the app profile. No TCP/HTTP listener.
- A new owner-only Unix socket and random token are created per desktop lifetime.
  The endpoint file is `0600`; its directory is `0700`. The MCP reads it locally,
  never prints it, and never uses role-scoped helper credentials.
- Trust boundary: your OS account and unsandboxed clients running as you. This
  does not defend against malicious programs already able to read your files.
  Operatus-launched agents retain their separate restricted sandboxes.
- Canonical repository-root checks reject path traversal and symlink escapes.
- Requests are limited to 64 KiB and responses to 2 MiB. Oversized evidence fails
  explicitly; request `evidence:false` and use the desktop for the large report.
- Start receipts and human cancellation events remain in the authoritative app
  database. There is no direct MCP database writer or alternate run authority.
- No freeze, acknowledge, repair, pass, raw shell, filesystem-write, merge, push,
  quota override, remote machine enrollment, or account-change tools.
- Set `enabled` to `false` and restart Operatus to revoke this integration. Remove
  its MCP registration from clients if desired. Existing Gauntlets are not deleted.

The previous Computer Use skills remain useful for visual/UI acceptance. This
MCP is a distinct explicit operator interface, not hidden renderer IPC or a claim
that desktop clicks were tested. Do not use a UI-only skill to claim MCP actions
were visual interaction.

## Verification

`npm test --prefix packages/operatus-mcp` exercises real MCP protocol negotiation
and errors without inference. The repository's `test/operator-mcp.test.cjs` runs
under its Electron Node runtime to exercise real SQLite, an authenticated socket,
an SDK stdio client, exactly-once creation, restart replay, cancellation guards,
policy privacy, and role-authority exclusion. Its provider dispatcher is a test
double: it does not certify a live subscription-backed Gauntlet.

Configuration references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Claude Code MCP](https://code.claude.com/docs/en/mcp),
[MCP SDK stdio](https://ts.sdk.modelcontextprotocol.io/server).
