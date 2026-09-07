# Scoped control from isolated role processes

Date: 2026-09-06. No live model invocation; subscription launch hold unchanged.

## Implemented

`prepareControlClient` materializes a bounded, digest-checked copy of the shipped control helper into a new private profile directory outside the provider's writable home and scratch areas. The initial test used a scoped token environment. A [subsequent native-tool check](2026-09-06-claude-native-tools.md) found that Claude scrubs that token in Bash children. The current implementation instead uses a private, read-only sibling control-capability file and exact-file sandbox access. No personal Node setup or provider credential is copied; neither the helper source, returned environment nor receipts contain the scoped token.

The provider boundary can now grant outbound access to that exact Unix socket and read access to the helper/runtime. It does not grant TCP, unrelated Unix sockets, socket binding or write access to the helper. Its receipt distinguishes `control-socket-only` from a completely network-denied profile; both retain `launchAllowed: false`. Boundary inputs remain trusted main-owned capabilities, not renderer-supplied paths.

The syscall/path distinction was checked against the primary [Anthropic sandbox-runtime implementation](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts): Unix socket creation and connection permissions are separate. Our policy permits creation plus an exact outbound path, without its broader socket-binding allowances. Real-process tests, not that source alone, establish the behavior below.

## Verified

An Electron-hosted fixture starts the actual Gauntlet local control service, prepares a real linked worktree, and executes the shipped helper in a sandboxed shell using the app's Node runtime.

- The worker writes an artifact file and invokes the `commit` helper inside its boundary. The main process records the resulting exact commit; the helper receives the new artifact identity.
- The same worker token cannot invoke a Conductor cancellation command.
- A fresh Critic helper reads its exact review manifest and submits a synthetic report; the run waits for acknowledgment.
- A separate read-only Conductor helper explicitly acknowledges the report before the fixture can pass.
- The primary branch remains unchanged.
- Unrelated Unix and TCP listeners accept zero connections from the restricted process. Creating a new Unix listener and changing the helper file also fail.
- A wrong helper digest is rejected before materialization, and receipts/helper contents do not expose the scoped token.

The initial focused integration set passed **18 tests**, including main commits, control draining and the existing process-boundary tests. A further digest/receipt test was added for the final suite. Node/preload and renderer typechecks passed. The review and acknowledgment bodies are synthetic test data, not model judgments or proof of autonomous work.

## Limits

The tested capability is local command transport. It is not provider HTTP networking, credential admission, a real CLI tool invocation, an installed production session, or the final composed launcher. The production spawn path remains held and still requires replacement/integration with these prepared capabilities. The native CLIs' own tool permissions must also be checked within that composed path.

Only macOS confinement is implemented here. Runtime identity is supplied by the trusted app/main caller, while the helper copy has an explicit digest check. No global host socket access, credential forwarding, account changes, release or deployment was introduced.

Sources/tests: `src/main/gauntlet/controlClient.ts`, `src/main/subscriptionSandbox.ts`, `test/gauntlet-isolated-control.test.cjs`. Local focused logs: `/tmp/operatus-isolated-control.log`, `/tmp/operatus-isolated-control-integrated.log`, `/tmp/operatus-isolated-control-types.log`.

Final verification: **316 passed, zero failed, two opt-in native-copy tests skipped** in the full Electron-hosted root suite; Electron build passed. The copy tests were not rerun in this low-storage pass. Logs: `/tmp/operatus-isolated-control-full.log` and `/tmp/operatus-isolated-control-build.log`. No new visual smoke or live-provider acceptance is implied.
