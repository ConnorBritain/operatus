# Configured budgets reach native sessions

Date: 2026-09-06. Global release hold unchanged; provider responses and account metadata remain synthetic in native smoke.

The isolated factory previously hard-coded a two-hour Conductor, 20-minute Critic and 30-minute worker. It now obtains a fresh main-owned budget immediately before native spawn. The budget uses the persisted run start/limits and launch creation time. Admission/profile preparation consumes elapsed time; fresh attempts receive their own role deadline but never a new overall run allowance. Conductor lifetime is bounded by remaining run time, with each turn capped by the configured worker limit and remaining lifetime. No UI-supplied duration directly controls spawn.

Expired overall runs fail before admission. Exhausted role preparation cannot start a late native process. Tiny remaining budgets are rejected, not rounded up. Native timer validation supports the domain's configured upper bounds (one day per worker, seven days per run), rather than silently substituting the old pilot caps. These are timeout ceilings, not promised uninterrupted availability: provider/account expiry, request/message limits, cancellation and infrastructure failures can stop work sooner. Long-duration real-provider operation is not accepted by this pass.

## Verification

- Three pure budget checks passed: role/run deadline intersection, elapsed preparation, invalid/expired bounds and supported long configurations.
- Twelve isolated runner tests passed, including concurrent runs with different limits, expired pre-admission rejection and expired worker preparation without any worker spawn. Fifteen budget/runner checks total, zero skips.
- Sixteen fresh/persistent transport checks passed within the earlier 26-test transport/runner suite, including timeout/cancellation and gateway revocation.
- Two assembled native scripted repair loops passed with zero skips in 16.5 seconds. Both used non-default limits: 90 seconds overall, 45 seconds per worker and 30 seconds per Critic. Actual transport receipts exposed all five native timeout values, each within the assigned limit; the Conductor turn limit was at most 45 seconds.
- Clean run `74260e87-d8f7-45c9-8f9c-9a66d1c9e042`: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-57agSm`.
- Injected final gateway-close reporting failure run `6911f0e4-130a-4734-8b3b-747dd12d275b`: `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/op-native-runner-sLiAFZ`. Both roots retain `receipt.json` with `nativeBudgets`, Git, SQLite and scoped evidence. Disposable native executable copies were removed.
- Main/preload and renderer typechecks, Electron build and `git diff --check` passed. Existing Vite mixed static/dynamic import warnings remain. CI includes budget regressions; no remote CI execution claimed.

No GUI changes or new viewport acceptance occurred. Configurable simultaneous-session capacity, storage-pressure admission, locked skill materialization, native output/sprites, Codex spending safety and real-provider multi-run acceptance remain unfinished.
