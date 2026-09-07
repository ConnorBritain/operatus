# Stable upstream adoption: offline desktop typography

## Decision: adopt font bundling, adapt distribution and startup wiring

Operatus's renderer entrypoint still requested Press Start 2P, Inter and JetBrains
Mono from Google Fonts at every boot. Both Google font hosts remained permitted
in its style/font Content Security Policy. This made the intended pixel headings,
body text and terminal typography network-dependent despite local-first operation.

Inspected Munder commit `41ea4c37b1a21dee7b9c82e9f0e60f43032634c5`, including its
font definitions, binaries, copyright notices and full OFL license. A local Git
ancestry check confirms it is included in the reviewed stable v0.4.6 commit
`64bd64df0e8d315a6e895283f776b81f84eef2cc`.

Adopted only its three unmodified font binaries and self-hosting approach:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `press-start-2p-latin-400.woff2` | 4,704 | `42144b97bd2942ea606e5d880684eae0f7be5c804bdd57b1faac5a8d7699ae6e` |
| `inter-latin-var.woff2` | 48,432 | `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4` |
| `jetbrains-mono-latin-var.woff2` | 31,340 | `2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4` |

Total: 84,476 bytes. Variable Inter/JetBrains files cover the existing 400–700
weight choices. Press Start 2P remains the short-label display face. No office
art, character branding, telemetry, updater or Gauntlet behavior was imported.

Adaptations: a local stylesheet is linked by the initial HTML and imported by the
global styles. Google preconnects, stylesheet request and font/style CSP permissions
are removed. The complete font attribution/OFL text lives in renderer public assets,
is copied into `out/renderer/third-party-fonts.txt`, and is referenced by the HTML
license link. This ensures notices travel through the existing `out/**` packaging
input rather than relying on an unreferenced source text file being emitted.

The source commit's CJK/Arabic stack expansion and release-drop iframe changes are
not included in this bounded change. Existing fallback stacks remain unchanged;
these Latin subsets do not establish multilingual typography acceptance. Hosted
portal typography is likewise outside this desktop adoption.

## Executed verification

The Electron production build and existing identity/redistributable-asset check
passed. Four font tests passed, zero skipped:

```sh
npm run build
OPERATUS_VERIFY_FONT_BUILD=1 node --test test/bundled-fonts.test.cjs
npm run check:operatus-assets
git diff --check
```

Tests check WOFF2 signatures and exact upstream digests; entrypoint/style wiring;
removal of remote font CSP/request paths; included copyright/OFL notices; and the
actual production CSS resolving three local hashed font assets with the same byte
digests. The emitted license exactly matches the source. CI now runs this check
after building, so missing emitted assets/notices cannot be hidden by source-only
tests. No release was packaged, published or installed during this change.

## Remaining acceptance

This verifies the built files and request configuration, not a rendered font-load
or pixel-comparison result. The Mac has not been unlocked for the pending visual
smoke. Inspect actual startup and settled desktop rendering offline at expanded Mac
and 1920×1080, including the office/Pixi text and terminals, before closing the
visual gate. Existing bundle-size warnings, non-Latin fallback behavior, live
provider admission and operator-flow acceptance remain separate open issues.
