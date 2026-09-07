# Subscription startup admission, September 6

## Change

Replaced the blanket hold only at the isolated Gauntlet entrypoints: desktop
creation, lifecycle advancement, and factory admission. Ordinary Add agent/PTYS,
hidden workers, voice, and API inference remain blocked. The Runs UI no longer
disables its start button unconditionally; main still owns launch authority.

Codex credits are now descriptive evidence (`none-observed`, `available`, or
`unknown`), not a reason to reject an authenticated subscription. Account match,
valid OAuth, Plus/Pro membership and subscription capacity remain mandatory.
Available credits cannot override an exhausted subscription window. No top-up
verification is claimed. The operator confirmed extras/top-ups are disabled.

## Verification

- 55 focused policy, account, gateway and desktop-dispatch tests passed.
- 7 SQLite-backed provider-factory/admission-evidence tests passed.
- Both TypeScript checks and the Electron build passed.
- Real local inspection found the pinned Claude 2.1.263 and Codex 0.153.4 binaries.
  Ambient credential/routing diagnostic: none detected. Personal configurations
  are customized and are intentionally not imported into agent profiles.
- Real Codex account metadata passed as Pro with credits available.
- A live Codex CLI startup probe used the production factory with no injected
  account or model-response dependencies. GPT-5.6 Sol returned the requested
  marker, the native process exited, and gateway revocation was confirmed.
  Launch: `975c04b0-f581-4318-99e1-531dd36e4b0e`.
  Native thread: `01a078ec-2601-7351-ad69-b665ec792219`.
  Native turn: `01a078ec-2610-7001-a526-545a21117dfe`.
  Local receipt: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-live-startup-Xery0e/receipt.json`.
- Claude OAuth was refreshed through the official CLI/browser flow for the
  operator's requested account. This exposed a reader bug: the service-only
  Keychain query selected an old `unknown` entry rather than the current OS
  account's entry. The reader now supplies the OS account explicitly. Its new
  regression test and the seven existing Claude admission tests passed.
- Real Claude metadata then passed as active Max with extra usage disabled.
  The live production-factory probe returned the requested marker using
  `claude-fable-5-1`, with process exit and gateway revocation confirmed.
  Launch: `9eeee724-a8eb-422b-8b79-5ee2c4497f2e`.
  Session: `658ccac8-00e6-4a7f-a6a6-4b1d40d62edf`.
  Local receipt: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-live-startup-dfii5T/receipt.json`.
- The 40 focused profile, process sandbox and fresh-session tests also passed.
- The React checklist review found no new effects, subscriptions, secret-bearing
  renderer data or authority changes in the three UI edits. They change status
  text and remove the stale unconditional button disable only.

This proves real Claude and Codex startup, not a full Gauntlet, a reviewed candidate,
or desktop visual acceptance. No test candidate commit was produced.

## Repeat the bounded live startup check

This intentionally uses real subscription allowance. Each invocation requests
one short response, uses a 90-second native-session timeout, grants no Gauntlet
control commands, and leaves a redacted receipt in a new temporary directory.

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tools/smoke-subscription-startup.cjs --live codex
# After reconnecting Claude Max:
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tools/smoke-subscription-startup.cjs --live claude
```

For the desktop, run `env -u ELECTRON_RUN_AS_NODE npm run preview` from the
repository and use Runs. The older Add agent path remains intentionally held.
