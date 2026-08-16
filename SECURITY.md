# Security policy

## Scope

Ventura is a local-first desktop application that spawns CLI coding agents in PTYs and works in repositories a user selects. Its Gauntlet control socket is local-only, permission-restricted, size-bounded, and requires a Conductor or per-launch scoped token. The renderer has no direct Node access and cannot impersonate workers, Critics, or Conductor acknowledgments.

Optional Slack, webhook, voice, integration, update, and analytics features can use the network when explicitly configured. Updater and analytics destinations are disabled by default for the Ventura milestone. A future remote portal must use authenticated device pairing, encrypted envelopes, replay protection, redaction policy, and destination-side authority checks; no unauthenticated listener or automatic public tunnel is permitted.

## Supported versions

Security fixes currently target `main` and the active milestone branch only. No installer release is supported yet.

## Reporting a vulnerability

Do not open a public issue containing exploit details. Use GitHub's **Security → Report a vulnerability** flow for [ConnorBritain/ventura](https://github.com/ConnorBritain/ventura/security/advisories/new). Include reproduction steps, affected revision, impact, and any suggested mitigation.

## Reviewer priorities

- Main/renderer IPC schemas and path validation
- local socket permissions, scoped tokens, request limits, and stale-action rejection
- exact Git SHA/worktree identity and Critic mutation detection
- Skill Depot Git pinning, path traversal, symlink, digest, and materialization boundaries
- provider capability receipts and any advisory-versus-enforced mismatch
- secrets, prompts, paths, evidence, and terminal output crossing remote projections
- optional network endpoints, SSRF controls, webhook authentication, and credential storage

See [docs/GAUNTLET.md](docs/GAUNTLET.md) and [docs/architecture/remote-portal.md](docs/architecture/remote-portal.md).
