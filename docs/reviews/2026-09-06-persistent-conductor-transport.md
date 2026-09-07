# Persistent native Conductor transport

Date: 2026-09-06. Synthetic provider responses only. Production subscription launch hold remains enabled.

## Implemented

`ClaudeConductorSessionRuntime` uses one isolated native Claude process with newline-delimited streaming input/output. It keeps stdin open between turns, retains one session ID, and accepts only one in-flight message at a time. Message identities cannot be replayed, and input, per-turn duration, total duration, line size, total output and message count are bounded. It uses the same private profile/control helper/outer sandbox architecture as fresh workers, without routing through the legacy PTY launcher or importing ambient environment/configuration.

A valid result completes one conversation turn. It does not acknowledge a report or pass a run. Only an authenticated helper command causes those state transitions. Conductor tools are Read/Glob/Grep/Bash with read-only repository access; external networking is denied and only the owned local gateway/control socket is admitted. The transport holds identity claims after exit, revokes the gateway on stop/failure and at close, and reports unconfirmed revocation as failure. Process exit is not claimed as descendant quiescence. Restart/resume is not implemented.

Protocol references: [Anthropic streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [CLI reference](https://code.claude.com/docs/en/cli-usage), and the inspected native Claude 2.1.263 `--help`. No hosted Agent SDK or API-key configuration was added.

## Native failure and correction

The first native attempt timed out with zero requests reaching the synthetic gateway. CLI diagnostics showed connection errors. Unlike the fresh-worker adapter, the new adapter initially omitted `providerBrokerPort` when constructing the sandbox. The sandbox correctly blocked the request. Passing the owned gateway's exact port fixed the defect; an offline regression now requires that exact port in the generated boundary. No external-network exemption or unsandboxed fallback was introduced.

## Executed native evidence

The opt-in `test/claude-native-tools.test.cjs` passes with one test and zero failures/skips in 8.8 seconds. It executes Claude 2.1.263 pinned to SHA-256 `ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9`, with synthetic OAuth and entirely scripted local responses.

One native Conductor process freezes the bar, remains alive while fresh Implementer/Critic/Repairer/Critic processes execute, requests repair through an explicit acknowledgment, and later acknowledges the final PASS report. Its third provider request includes the earlier two message markers. Both reports remain awaiting acknowledgment until the native Conductor invokes its helper. Both Critics are denied artifact/evidence writes and Conductor impersonation. The original checkout and main branch remain unchanged.

- Fixture root: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-tools-suN72k`.
- Receipt: `native-tool-receipt.json` beneath that root; SQLite and Git artifacts are retained there.
- Run: `77146591-6954-45da-afa2-444346320ddc`.
- First artifact: `a3c85a87a451f0949e5d35f77ff34de9f877b8be`.
- Repaired child: `b2e2be7e724cdb4e116805a3cc05091ce6f39b6b`.
- Conductor PID during execution: `82366`; session: `565dd961-53af-4655-9b3a-4b7647241359`.
- Three Conductor turns, six scripted model requests, graceful zero-code exit and confirmed gateway closure.
- Four distinct fresh-worker session IDs match their persisted launch identities.

At the time of this first transport fixture, the Conductor session was recorded only in its fixture receipt and acknowledgments retained the legacy identity. The subsequent [run-scoped authority pass](2026-09-06-conductor-authority.md) replaces that global authority and verifies the native session against a persisted launch, without claiming production composition or persisted PID/delivery receipts.

The focused Conductor/fresh-worker/main-commit/isolated-control suite passed all 24 tests with zero skips. Node/preload and renderer typechecks, Electron build, and `git diff --check` passed. Existing Vite mixed static/dynamic import warnings remain; no viewport acceptance was repeated. CI includes the offline Conductor tests; the native provider fixture remains explicitly opt-in and cannot silently consume a subscription.

## Remaining critical path

Compose both transports into production main-process launch ownership, persist Conductor identity and delivery receipts, handle cancellation/recovery and live output, and bind per-run evidence access to immutable artifacts. The current production launcher still uses legacy PTYs, and the new adapter is not imported there. Resume needs an explicit persisted-session recovery design rather than a fresh process disguised as the original Conductor.

Real subscription credential composition and live independent judgments remain unaccepted. The configurable Claude Critic fixture does not establish Codex subscription-credit safety or change the default Critic provider. No real-model calls, launch-hold changes, account-setting changes, deployment, release or merge occurred. Visual UX and concurrent live runs were not exercised in this pass.
