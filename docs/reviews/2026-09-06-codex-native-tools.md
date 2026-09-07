# Native Codex tools through the isolated boundary

Date: 2026-09-06. Real Codex processes and native command tools; synthetic
credentials, scripted model responses, disposable files and local servers only.
No real authentication, external forwarding, inference or billing acceptance.

## Result

Two fresh native processes completed the same three-command script:

1. Read `evidence.txt`: native command exit 0, expected evidence returned.
2. Create an artifact file: native command exit 1, OS permission denial, no file.
3. Read a synthetic credential outside the allowed roots: native command exit 1,
   OS permission denial, secret content absent from returned tool results.

Both processes then emitted the scripted final JSON message and a matching
`turn/completed` event. The fixture verifies actual command completion items,
thread/turn identity, final text, unchanged evidence and distinct native threads.
These are successful transport/tool cycles, not independent model judgments or
Gauntlet reports accepted by the backend.

The first process used WebSockets. The second rejected WebSocket upgrades and
exercised native **zstd-compressed HTTP fallback** with scripted SSE responses.
The test bounds compressed payloads at 1 MiB and decompressed HTTP bodies at
4 MiB. It sends no response to an external service. The native model catalog
and account settings requests deliberately receive 404; account-specific model
availability remains unproven.

## Two compatibility failures resolved

### Native companion executable

The main executable alone can initialize and finish a text turn, but its first
Code Mode tool call failed because `codex-code-mode-host` was absent beside the
copied binary. The fixture now verifies and copies both native files, each with
an explicit inspected digest. It removes only its two owned executable copies
after completion; retained receipts and profiles remain available.

`prepareSubscriptionSandbox` now accepts one optional main-owned Codex companion.
It must be the exact canonical regular-file sibling named
`codex-code-mode-host`, outside artifact and profile roots. The policy grants
read access to that exact file, **not** its containing directory or installed
application bundle. Claude profiles cannot request it. Existing callers do not
gain any permission. Executable identity is still the launcher's responsibility;
this policy builder does not authenticate a publisher or authorize a launch.

The native companion is:

`/Applications/ChatGPT.app/Contents/Resources/codex-code-mode-host`

SHA-256: `fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b`.

The main Codex 0.153.4 digest remains
`a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629`.

### Nested sandbox application

After adding the companion, command execution still failed because Codex tried
to apply another Seatbelt sandbox inside Operatus's existing outer sandbox.
The fixture now explicitly uses the documented
`sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' }` on the
turn. The outer process policy remains mandatory and enforces artifact
read-only access, protected configuration, limited read roots and one local
network port across the native child processes. No `dangerFullAccess`, elevated
approval, broad filesystem permission or unsandboxed fallback was introduced.

The OpenAI Docs skill guided use of the actual fetched
[app-server documentation](https://learn.chatgpt.com/docs/app-server), including
its explicit external-sandbox contract and completed-item/turn semantics. The
installed schema also contains this sandbox shape. The OS-denied writes and
credential reads are essential evidence; a configuration label alone would not
prove confinement.

Retained failed native tool attempts:

- Missing companion: `op-codex-tools-avkRRs/receipt.json`.
- Nested Seatbelt: `op-codex-tools-MFvYF8/receipt.json`.

Both are under the same temporary parent as the final evidence below. A scripted
final response could still complete after these tool failures, which reinforces
why actual evidence must drive Critic report validation.

## Final verification

- **2 actual native scenarios passed, 0 skipped**.
- **13 focused identity/profile/sandbox checks passed, 0 skipped**. The new
  policy test exercises allowed companion reads and denied sibling-secret reads,
  modification and chmod. Invalid provider, directory, writable-root and symlink
  companion selections are rejected.
- Node typecheck, Electron production build and `git diff --check` passed. The
  existing large-renderer-bundle/dynamic-import warnings remain; no installer,
  deployment or GUI acceptance was produced by the build.

Reproduce from the repository:

```sh
OPERATUS_CODEX_PROBE_PATH=/Applications/ChatGPT.app/Contents/Resources/codex \
OPERATUS_CODEX_PROBE_SHA256=a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629 \
OPERATUS_CODEX_HOST_PROBE_PATH=/Applications/ChatGPT.app/Contents/Resources/codex-code-mode-host \
OPERATUS_CODEX_HOST_PROBE_SHA256=fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b \
node --test test/codex-native-tools.test.cjs

node --test test/subscription-sandbox.test.cjs \
  test/subscription-profile.test.cjs test/executable-identity.test.cjs
```

Final receipt root prefix:
`/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/`.

| Native transport | Receipt | Actual thread | Actual turn |
| --- | --- | --- | --- |
| WebSocket | `op-codex-tools-cOg0b6/receipt.json` | `01a0784d-6a80-7e61-9384-3b1eabaf923c` | `01a0784d-6a8c-7133-b7d6-8c87b9ff85dc` |
| HTTP fallback | `op-codex-tools-6eav3j/receipt.json` | `01a0784d-7c12-7330-8873-3db364ca9b14` | `01a0784d-7c1d-74f1-86bb-e2715828d313` |

## Required next work, not satisfied by this fixture

- Main-owned Codex credential gateway: only scoped local bearer material in
  worker profiles, fresh account admission on every allowed request, fixed
  upstream allowlist, bounded WebSocket/HTTP payloads and revocation.
- Dedicated native lifecycle adapter with actual thread/turn identity, output
  limits, timeout/cancellation, malformed-stream handling and process drain.
- Exact Git artifact/review-packet reads, primitive/skill receipts and report
  submission through the real Gauntlet Critic authority, without provider
  substitution. This fixture uses plain evidence files and a scripted report.
- Real subscription-only Claude/Codex review and concurrent visual acceptance.

The production runner still rejects the unimplemented Codex path explicitly.
The global subscription safety hold remains enabled. Neither native fixture is
connected to real provider credentials or the live application launch path.
