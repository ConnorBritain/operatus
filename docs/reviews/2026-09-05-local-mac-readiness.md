# Operatus local Mac readiness review

Reviewed 5 September 2026. This is an assessment and live smoke, not a release certification.

## Verdict

**The application builds, opens, and renders well. The unattended Gauntlet workflow is not ready for important repositories yet.** Two real-provider smoke runs exposed startup, recovery, and artifact-isolation problems that are not caught by the green automated suite. A focused reliability milestone should precede packaging or further visual expansion.

The working checkout is `/Users/dahlia/Code/operatus`, branch `agent/operatus-gauntlet-milestone`, at `a0e9f917230d4b6ce2801ae06f6cc64d424283d8`. It matched its origin branch and was clean before this review. The old task working directory `/Users/dahlia/Documents/ChatGPT/matrix` is not the repository.

## What is already here

- Electron main-process runtime, real Claude/Codex PTYs, Hive coordination, renderer terminals, and the original-style reskinned Pixi office.
- Isolated Gauntlet modules for contracts, state transitions, SQLite persistence, control commands, worktrees, primitive resolution, and skills.
- A clean pinned Agent Primitives submodule at `7c0ceb64d0ffb8c7b4c8548b6fdd09e4ee9a17c0`.
- A hosted portal with identity, settings, pairing, and a narrow remote-command surface. Its public login and health endpoint were checked; authenticated pairing and cross-machine commands were not exercised in this review.
- Build and CI machinery, but no published Operatus GitHub release. The local `dist/mac-arm64/Atelier.app` is an older branded build, not a current Operatus installation. No `/Applications/Operatus.app` was found.

The desktop process currently hosts the local execution services. A separate always-on Operatus daemon is not necessary to begin supervised local use while Electron is open; it is a later requirement for continuing work independently of the desktop application. Provider remote-control daemons are a different concern from an Operatus branch daemon.

## Automated checks

| Check | Result |
| --- | --- |
| Node/preload and renderer TypeScript | Passed |
| Complete root Node/Electron test suite | 181 passed, 0 failed |
| Focused and Gauntlet script entrypoints | Also passed; overlapping subsets, not extra tests |
| Portal tests | 6 passed |
| Portal TypeScript | Passed |
| Electron production compilation | Passed |
| Operatus asset/provenance check | Passed |
| Latest origin CI at reviewed commit | Successful |
| Public portal health | `status: ok`, `authority: local-node` |

[Reviewed CI run](https://github.com/ConnorBritain/operatus/actions/runs/31986217943). The renderer's main generated bundle is approximately 12 MB uncompressed; this is a performance follow-up, not a failure of this smoke.

## Actual execution smoke

Used the compiled Electron application, real local SQLite and PTYs, a separate test application profile, and a disposable Git repository. No provider responses or run transitions were mocked. The objective was deliberately small: change `sum(a,b)` from subtraction to addition, leave three tests unchanged, commit the result, obtain an independent critique, and have the Conductor acknowledge it. No merge or push was requested or performed.

### Run 1: Claude startup failed

Run `d7efb425-cf65-43b5-b2f1-ffa533a7c96c` froze a contract, then launched two fresh Implementers. Both stopped at Claude's folder-trust prompt and exited before producing a receipt. The backend exhausted the configured transport retry and recorded `infrastructure_failure`, preserving the worktrees. No artifact was created.

The test exposed Mac path aliasing: the initial profile used `/tmp/...`, while Claude presented the equivalent `/private/tmp/...` path. The existing trust-preparation code stores the supplied path literally. A second test used canonical paths throughout, and Claude implementation then succeeded. This is evidence for a canonicalization problem, not proof that every first-run trust case is resolved.

### Run 2: implementation succeeded, critique failed

Run `a48d704d-3aa4-454a-aef4-955095e9cd4c` used canonical paths. After an initial startup-dialog interruption, a manual Conductor nudge was needed to begin orientation. The Conductor also needed schema-error retries because its prompt omitted required check fields.

The fresh Implementer produced commit `29b923261db56898b23d017f2c28e7a67ec8e67d`, descended from fixture base `05a9d0fb8628aecb84d0e9ff50f7f9b139181557`. It changed only the intended addition expression. Independent manual verification afterward, inside a preserved detached worktree at that exact commit, passed all three tests; that worktree was clean and the test file was unchanged.

Both fresh Codex Critics stopped at the directory-trust prompt and exited without reports. The terminal run result was `infrastructure_failure`, not `passed`. There was no Critic report, Conductor acknowledgment, or repair/re-critique cycle. Those remain unproven end to end.

Codex's optional remote startup also failed because the isolated `CODEX_HOME` did not contain the managed standalone installation expected by its daemon. The application fell back to its local TUI, where the trust prompt then blocked the role. Installing another global binary alone does not address the isolated-home mismatch.

### Important isolation and recovery findings

1. **Checks were not bound to the artifact in practice.** Every frozen check used an absolute `cd` back to the original fixture checkout. Although the runner supplies an artifact worktree as `cwd`, an unrestricted shell command can leave it. One check reported ` M sum.cjs` in that original checkout. The checkout was indeed dirty after the smoke. Do not attribute the mutation to a particular agent without further tracing, but the boundary failure is directly observed. The independently tested artifact happens to be correct in this tiny example; its automated receipts did not prove that.
2. **Failed workers resurrected outside protocol recovery.** On restarting and selecting a different test Hive, failed Implementers from the first run were restored through ordinary team restoration using their old identities. Gauntlet launches must not be resumable through this generic path. A main-process guard and SQLite-driven reconciliation are required, in addition to scoping renderer persistence to the Hive.
3. **Process labels are misleading.** Failed/absent PTYs remained represented as `live`/`idle` in worker surfaces. The authoritative Runs view did correctly show infrastructure failure.
4. **Startup is not yet a readiness protocol.** Authentication, trust dialogs, optional remote-control setup, and prompt delivery can overlap. The shell-selected Claude and app-selected Claude were also different installations. A direct inference check using the app-selected native Claude did succeed, so this is not simply an unavailable subscription.
5. **Shutdown needs a clean follow-up test.** The app's normal `confirmClose` path closed the window but left the instrumented Electron process alive. Reproduce without remote debugging before assigning the cause. Test workers were explicitly stopped before cleanup; the remaining test application exited after a targeted SIGTERM.

The smoke used disposable paths precisely because these boundary conditions were not yet proven. Failed worktrees and SQLite evidence were retained for diagnosis.

## Visual review

Inspected real desktop rendering at the Mac's expanded usable viewport of 1440×870 logical pixels (Retina display) and an emulated 1920×1080 renderer viewport. Also inspected the production portal at both sizes in Chrome. This checks layout, not a second physical monitor's GPU behavior.

- The warm office, readable rooms, lighting, and restrained pixel accents remain attractive. There was no blank floor or horizontal page overflow in the inspected views.
- At 1920×1080, the office gets considerable space while the Runs panel stays around 730 px wide. Its run list leaves only roughly 490 px for detailed evidence. A resizable/focusable evidence view would improve daily use more than another office redesign.
- Navigation and agent-card labels are cramped; even Conductor truncates on its card. The pixel headings are suitable for short labels but not dense evidence.
- The portal's coral gem is intact and centered, and its login/art composition is coherent. At the shorter Mac viewport, the lower login content requires scrolling; at 1080 px high the composition fits much better.
- Desktop typography still differs from the portal, and desktop fonts are fetched from Google Fonts. Bundle them for offline consistency, then harmonize text sizes and hierarchy.
- Authenticated hosted Firm views, mobile behavior, large active teams, and high-volume terminal performance were not tested in this pass.

Screenshots accompany this review in `assets/2026-09-05/`.

- [Desktop, expanded Mac](assets/2026-09-05/desktop-mac.png)
- [Desktop, 1920×1080](assets/2026-09-05/desktop-1920.png)
- [Production portal, expanded Mac](assets/2026-09-05/portal-mac.png)
- [Production portal, 1920×1080](assets/2026-09-05/portal-1920.png)
- [Post-run workers and stale status presentation](assets/2026-09-05/post-run-workers.png)

## Upstream Munder Difflin: what to fold in

Fetched and inspected upstream through `3f53763fa4b82748e9e1ea6bff69e01fdfc52823`. There are 416 upstream-reachable commits not in this checkout since the shared fork point `d28a0cf5ecec6e82d33242be742fdb7bf97e8ff7`; this includes merges and documentation, not 416 independent features. The reviewed changelog includes release 0.4.6 dated 27 August.

Selective adaptation is preferable to a wholesale product merge because Operatus adds authority boundaries and removes upstream branding, art, telemetry destinations, and updater behavior.

| Priority | Upstream change | Operatus application |
| --- | --- | --- |
| First | [Validate engine commands](https://github.com/chaitanyagiri/munder-difflin/commit/ea7e0d2f3535216acfa4e4000e7ffe2e1a7770ba) | Harden executable discovery and spawn requests before everyday use. |
| First | [Keep OS sandbox in auto mode](https://github.com/chaitanyagiri/munder-difflin/commit/e42b0e2f39c44312d94f4cef9517027daa75768d) | Adapt role-specific write access; preserve read-only Critics and scoped helper transport. Do not claim prompts alone enforce isolation. |
| First | [Scope roster fallback to the Hive](https://github.com/chaitanyagiri/munder-difflin/commit/b01770e4ea5b9889a07c98195dc0fdd1f0077fb8) | Addresses part of the observed cross-Hive restoration issue; additionally exclude Gauntlet launches from generic restore. |
| First | PTY environment isolation (`e9a2310c`, `7049fac1`) and UTF-8 setup (`dfeb2de0`) | Strip inherited parent-session identity while retaining deliberate auth/config environment. |
| Next | [Main-process mailbox watchdog](https://github.com/chaitanyagiri/munder-difflin/commit/68cbc25cba6737b2328c158c12ac5d066dbe49a2), stale-nudge handling and atomic Hive writes | Reliable Conductor wakeups without dependence on a visible renderer, with permission holds respected. |
| Next | Apple Silicon memory embedding fixes (`70092b6a`, `0031e7dc`) and retry/quarantine improvements | Validate optional semantic memory on this Mac before enabling it for real work. |
| Next | [Bundle fonts](https://github.com/chaitanyagiri/munder-difflin/commit/41ea4c37b1a21dee7b9c82e9f0e60f43032634c5), hidden-floor rendering (`20d1207b`), WebGL recovery (`1155c344`) | Offline appearance, less idle graphics work, and resilience. |
| Installability | Native rebuild/Python compatibility (`9bb060dd`) | Important for reproducing this setup on a clean machine, even though installed dependencies build here. |
| Windows follow-up | Quit/process-tree cleanup (`276f782a`, `5443a045`) | Adopt and test when moving beyond the Mac. |

Editable names, focus-mode restoration, model-catalog improvements, and notification settings are useful later. They should not displace the live-loop blockers above. No upstream changes were merged during this assessment.

## Lean path to useful local operation

1. **Make launch readiness explicit.** Show the exact provider executable/version and auth result. Resolve canonical paths consistently. Handle user trust decisions before dispatching task text. Make provider remote-control features optional for local Gauntlet workers. Publish complete, versioned command schemas to agents.
2. **Close the isolation/recovery gaps.** Keep the shared checkout untouched; run checks against a verified exact artifact with a constrained execution boundary, not just a starting directory. Prevent generic restoration of protocol-owned workers and reconcile UI status from live processes plus SQLite.
3. **Run an unattended acceptance fixture.** Require implementation → commit → real independent critique → explicit acknowledgment → pass. Then run a deliberately failing case requiring a fresh repairer and fresh re-critique. Exercise restart, cancellation, trust/auth failure, and normal quit. Assert the shared checkout is unchanged throughout.
4. **Use source builds on this Mac first.** The existing checkout can compile with `npm run build` and launch with `npm run preview`; `npm run dev` is the editing workflow. Node 22, Git, Xcode Command Line Tools, dependencies, and the pinned submodule are present. These commands open the app but do not cure the blockers. Use only a supervised disposable project until the acceptance fixture passes.
5. **Then dogfood one real bounded project.** Keep the desktop open, avoid merge/push automation, and inspect the candidate commit. Signing, installers, and a separate branch daemon can follow. Re-test remote pairing independently once local execution is reliable.

This is a focused reliability effort, not a rewrite of the floor or control plane. Completion should be defined by the real-provider acceptance results, not by another green build alone.

## Evidence locations

- Temporary fixture, isolated profile, SQLite records and preserved failed worktrees: `/private/tmp/operatus-smoke-20260905-OJIvXx`.
- Root suite log: `/tmp/operatus-full-suite-20260905.log`.
- Build log: `/tmp/operatus-build-20260905.log`.
- Instrumented local app log: `/tmp/operatus-live-smoke-20260905.log`.
- These temporary paths are local diagnostic material and may be removed by system cleanup. No raw credentials or complete provider transcripts are committed with this report.

## Follow-up: subscription-only safety slice

The operator subsequently required no API-billed inference paths. The rebuilt
application now holds all agent launches pending enforceable subscription-only,
no-overage admission. This supersedes the source-launch instructions above for
live inference: do not bypass the hold to run the earlier smoke fixture. See the
[billing ADR](../architecture/adr-subscription-only.md) for implemented guards and
remaining admission work. This is not yet a working subscription runtime.

Verification on 2026-09-05:

- Eight billing-policy tests passed, including direct/hidden PTY rejection,
  synthetic credential scrubbing, API transport spies and a real loopback broker
  rejection before secret lookup. No model inference was required.
- Full Electron-hosted root suite: 189 passed, zero failed. Node/web typechecks,
  Electron build and `git diff --check` passed.
- In an isolated desktop profile with synthetic inherited API-key values, a
  schema-valid Claude spawn request returned the subscription safety hold.
  `listPtys()` was empty before and after. No real provider session was started.
- The visible safety status was inspected at 1440×870 and an emulated
  1920×1080 renderer viewport, without horizontal overflow. These empty-floor
  captures do not constitute a populated-team motion or live-loop acceptance.
- Compiled desktop initialization reported `Operatus` while preserving the
  isolated profile path. A local unsigned `dist/mac-arm64/Operatus.app` was built;
  its plist identifies `Operatus`, `com.connorbritain.operatus`, and `icon.icns`.
  This was not installed, signed, notarized or published. The UI check used the
  compiled source with Electron instrumentation, not a packaged-app acceptance.
- Normal close again left the instrumented Electron process alive despite zero
  PTYs. Only that isolated test process was terminated with SIGTERM. The quit
  investigation remains open; this is not a successful lifecycle acceptance.

Evidence: [Mac safety hold](assets/2026-09-05/10-subscription-safety-hold.png),
[1920×1080 safety hold](assets/2026-09-05/11-subscription-safety-hold-1920.png).
Local logs: `/tmp/operatus-policy-suite-20260905.log` and
`/tmp/operatus-policy-package-20260905.log`.
