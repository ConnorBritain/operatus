# Terminal legibility: viewport emulation correction

6 September 2026. The tiny, vertically displaced terminal text in the previous focus screenshots was reproduced under mismatched display-scale emulation. It did not reproduce under native window sizing or scale-matched larger-layout emulation. No production font or renderer change was needed for this finding.

## Evidence

The compiled Electron main/preload/renderer received labeled synthetic text through its actual PTY-data subscription. There was no provider process. Fonts were loaded and captures waited beyond the app's 60/240ms attach refits.

| Case | Page DPR | Native display | Terminal CSS size | Glyph canvas buffer | Result |
| --- | --- | --- | --- | --- | --- |
| Original `page.setViewportSize`, 1920×1080 | 1 | 2× | 1596×672 | 3192×1344 | Tiny text displaced downward, reproduced after settling |
| Native Mac window, 1440×870 | 2 | 2× | 1155×464 | 2310×928 | Readable text at expected top-left position |
| 1920×1080 layout emulated at native scale | 2 | 2× | 1596×672 | 3192×1344 | Readable text at expected top-left position |

The installed `@xterm/addon-webgl` is 0.19.0. Its `DevicePixelObserver.ts` uses `ResizeObserver.devicePixelContentBoxSize`; `WebglRenderer.ts` adjusts the canvas buffer to those physical dimensions while keeping its calculated cell-grid dimensions. In the failing emulation, the page's 1× DPR and the physical 2× observer disagree. The controlled comparison supports a test-emulation artifact, not evidence that the user needs a larger application font.

The 1920×1080 result remains an emulated **layout** on this Mac's 2× display, not a test of a physical 1× 1080p monitor. The native Mac result has matching 1440×870 window content and renderer bounds with no device-metrics override.

## Test infrastructure changes

- `tools/electron-viewport.cjs` uses native window sizing when the requested content fits the display's work area; larger layouts retain the measured native scale in emulation. It checks the resulting viewport and DPR and rejects an ambiguous multi-window fixture.
- The agent-view smoke now waits for terminal canvas dimensions to match CSS dimensions × DPR before capturing. Its receipt records mode, DPR and buffer/CSS sizes. Screenshots are saved at CSS-pixel scale.
- Runs, attempt-branch and reset-refusal smoke tools use the same viewport helper. The latter two were syntax-checked but their complete flows were not rerun in this turn.
- `tools/inspect-terminal-layout.cjs` retains both `native-scale` and diagnostic `emulated-one` modes for reproduction. It reports native/renderer metrics and never changes production launch admission.

Six focused tests pass: three viewport/canvas tests and the three prior agent-view tests. The corrected compiled agent-view smoke and Runs-context smoke both pass at the two target layouts, with no renderer errors and no PTYs. The agent-view captures were visually inspected:

- [Native expanded Mac](assets/2026-09-05/33-agent-view-native-scale-mac.png)
- [Scale-matched 1920×1080 layout](assets/2026-09-05/34-agent-view-native-scale-1080p.png)

No production code changed in this turn, so no fresh application build or complete root-suite result is claimed. The preceding 298-test full-suite result remains the last full run; this turn adds three test cases for the verification infrastructure.

## Limits and next readiness gates

This corrects the prior tiny-text diagnosis and makes future canvas screenshots more trustworthy. It does not establish live terminal status, real provider streaming, throughput, sleep/wake rendering, mixed-scale monitor transitions, 6/12-worker density or concurrent Gauntlet readiness. The existing “live” terminal label and truncated roster names remain open UX work. Subscription-only provider admission and the full real-provider loop remain higher-priority functional gates.

Native and mismatched diagnostic receipts are in the disposable `operatus-run-control-k470u9` fixture. Corrected interaction receipts are in `/private/var/folders/8b/jff4zg2100l8142wzkgkhm680000gq/T/operatus-run-control-rpMPGt`. Logs: `/tmp/operatus-terminal-layout.log`, `/tmp/operatus-terminal-layout-native.log`, `/tmp/operatus-agent-view-native-scale.log`, `/tmp/operatus-run-context-native-scale.log`. Temporary evidence may be reclaimed by the OS.
