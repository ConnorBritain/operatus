# Third-party notices

## Munder Difflin

Operatus is derived from Munder Difflin. Its source code is MIT licensed, Copyright © 2026 Chaitanya Giri. See [LICENSE](LICENSE) and [UPSTREAM.md](UPSTREAM.md).

## Agent Primitives

`vendor/agent-primitives` is a pinned Git submodule from `ConnorBritain/agent-primitives`, distributed under its included MIT license. Operatus treats it as a versioned upstream source of behavior contracts.

## Matt Pocock skills

The Skill Depot baseline points to `mattpocock/skills` at commit `068b6e0c62393147daf03530149cdce209c93da8`. That repository is MIT licensed, Copyright © 2026 Matt Pocock. Operatus does not vendor or execute its installer; users explicitly synchronize the pinned Git source and select skills by role.

## Visual assets

The Operatus operations-floor visual assets are original clean-room work created for Operatus. They do not use the former LimeZu tiles, maps, character bases, or recolors as inputs or references. Asset source and generation notes live in `docs/assets/PROVENANCE.md`.

Restricted LimeZu-derived assets inherited from Munder Difflin must not be distributed in Operatus builds. CI checks enforce their absence.
