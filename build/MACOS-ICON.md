# macOS Dock export

The canonical artwork remains `build/icon.png` (unchanged SHA-256
`950dca73621cab40ceebe973e8028ef468b49c3a421648f4878eb506a70da5ab`).
Do not use that opaque full-square source directly in the macOS Dock.

`tools/build-macos-icon.cjs` scales the original artwork without redrawing it,
adds a 100px transparent margin on a 1024px canvas, and applies a continuous-corner
SVG mask to the beige tile. It exports `build/icon-macos.png` for development
and `build/icon.icns` for packaging, including standard 1x/2x representations.
Windows/Linux and website source artwork are deliberately unchanged.

Regenerate on macOS with an installed `sharp` module and Apple's `iconutil`:

```sh
node tools/build-macos-icon.cjs /absolute/path/to/sharp
```

Omit the argument when `sharp` is available through normal Node module resolution.
The generated assets are committed inputs; ordinary builds do not need sharp.
The script preserves its temporary iconset and prints its location for inspection.

An image-tool trial on 2026-09-05 was rejected because it changed the artwork and
painted a checkerboard without alpha. None of that generated variant is shipped.
Its prompt requested only rounded beige corners, transparent padding, and the
unchanged coral gem/desk composition. The accepted export is the deterministic
platform wrapper above, with no new model-generated artwork or API request.

Validation: inspect at 32/64px and on contrasting backgrounds, assert transparent
outer pixels and an opaque center, and run `node --test test/desktop-branding.test.cjs`.
The regression checks also require a packaged 1024px alpha representation.
Compare decoded pixels when regenerating: iconutil can change PNG compression
without changing the image. Changes require rebuilding/relaunching the application;
an already running Dock process retains its old icon.
