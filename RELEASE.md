# Atelier 0.1.0 development milestone

Atelier is not yet a published installer release. Milestone one is built and verified from source on macOS.

```bash
git clone --recurse-submodules git@github.com:ConnorBritain/atelier.git
cd atelier
npm ci
npm run typecheck
npm run test:gauntlet
npm run test:focused
npm run build
npm run check:atelier-assets
```

Install and authenticate both Claude Code and Codex for the default Gauntlet role profile. The desktop leaves candidate branches unmerged and unpushed. See [README.md](README.md), [docs/GAUNTLET.md](docs/GAUNTLET.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Signing, notarization, release publication, automatic candidate merging, and Roadmap-backed execution are intentionally outside this milestone.
