# Contributing to Ventura

Thanks for your interest! This is an early prototype, so there's a lot of surface
area and plenty of room to help. This guide covers setup, the gotchas, and the
conventions that keep the codebase coherent.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Development setup

### Prerequisites

- **macOS or Windows** — macOS is the currently verified development target;
  Windows support is part of the product architecture and still needs release
  packaging coverage. Linux remains a welcome community target.
- **Node.js 18+** and npm.
- A **C/C++ toolchain** to build `node-pty`'s native addon. On macOS:
  ```bash
  xcode-select --install
  ```
- **[Claude Code](https://claude.com/claude-code)** on your `PATH` if you want
  agents to actually run `claude` (the default command). Any other command works.

### Install & run

```bash
git clone --recurse-submodules <your-fork-url> ventura
cd ventura
npm install        # postinstall rebuilds node-pty against Electron's ABI
npm run dev        # live-reloading Electron build
```

> [!IMPORTANT]
> **The most common setup failure is the native `node-pty` rebuild.** The
> `postinstall` script runs `electron-rebuild` so `node-pty` matches Electron's
> ABI. If you see a "wrong ELF/Mach-O" or "NODE_MODULE_VERSION" error at launch,
> re-run `npm install` (which re-triggers `postinstall`) after confirming your
> C/C++ toolchain is installed.

## Before you open a PR

1. **Keep the type-checker green:** `npm run typecheck`.
2. **Run protocol and retained-runtime tests:** `npm run test:gauntlet` and
   `npm run test:focused`.
3. **Confirm a production build works:** `npm run build`, then run
   `npm run check:ventura-assets`.
4. **Match the aesthetic.** Any new UI **must** derive from the design tokens in
   [`DESIGN.md`](./DESIGN.md) / `src/renderer/src/design/tokens.ts` — no ad-hoc
   colors, spacing, or fonts. `tokens.ts` and `tokens.css` are mirrored; if you
   change one, change both.
5. **For anything visual, include a screenshot or short clip** in the PR.

## Project layout

| Path | What lives there |
|---|---|
| `src/main/` | Electron main process — PTYs (`pty.ts`), fs/git bridges, the hive (`hive.ts`, `hooks.ts`, `memory.ts`), config. |
| `src/preload/` | Context-bridge IPC surface. |
| `src/renderer/` | React UI, Pixi.js office scene (`scene/office/`), components, design system, stores. |
| `src/main/gauntlet/` | deterministic run state, storage, strict worktrees, providers, primitives, and skills |

See the [Architecture](./README.md#architecture) section of the README for the
data-flow overview.

## Good first areas

- Windows packaging and continuous smoke coverage.
- The Tailscale-first remote gateway and installable web client described in
  [`docs/architecture/remote-portal.md`](./docs/architecture/remote-portal.md).
- More original floor packs and accessible branch themes.

## Commit & PR conventions

- Branch off `main`; keep PRs focused on one change.
- Write a clear PR description of *what* changed and *why*.
- Don't commit `node_modules/`, `out/`, or built artifacts (already gitignored).

## A note on assets

The distributable floor and role art must be original or compatibly licensed.
If you contribute new art, record its source and terms in
[`ATTRIBUTION.md`](./src/renderer/src/assets/ATTRIBUTION.md) and
[`docs/assets/PROVENANCE.md`](./docs/assets/PROVENANCE.md). Do not restore the
restricted upstream tiles, maps, base characters, or recolors.

## Questions

Open a [discussion or issue](../../issues) — happy to help you get oriented.
