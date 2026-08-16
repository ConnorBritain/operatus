# Atelier product specification

Atelier is a local-first operations floor for conducted AI coding work. Its primary workflow is Gauntlet Run: a Conductor freezes an observable quality bar; a fresh Implementer creates an exact Git commit; a fresh independent Critic evaluates the real artifact; the Conductor explicitly acknowledges the evidence; and bounded fresh repair plus re-critique continue until pass, human escalation, cancellation, or explicit failure.

The authoritative milestone specification is divided across:

- [README.md](README.md) — product scope and development entry point
- [docs/GAUNTLET.md](docs/GAUNTLET.md) — roles, trust, operation, and recovery
- [docs/architecture/gauntlet-synthesis.md](docs/architecture/gauntlet-synthesis.md) — source synthesis and domain model
- [docs/architecture/migration-map.md](docs/architecture/migration-map.md) — inherited runtime versus Atelier boundaries
- [docs/architecture/roadmap-interoperability.md](docs/architecture/roadmap-interoperability.md) — backend compatibility seam
- [docs/architecture/remote-portal.md](docs/architecture/remote-portal.md) — web, mobile, multiple-machine, and theming direction

Protocol authority is not skinable: visual branding, names, character packs, remote clients, and optional modules may change presentation and capability, but cannot change the frozen bar, artifact identity, actor authority, state transitions, or persisted evidence.
