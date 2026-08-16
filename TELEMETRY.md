# Telemetry

Ventura analytics are disabled by default. Development and fork builds compile without a PostHog key and send nothing. Enabling the Settings toggle alone cannot transmit without a deliberately configured build-time destination.

If a future Ventura-owned release enables analytics, the existing implementation permits only these anonymous, fixed-shape events: `first_run`, `app_launched`, `agent_spawned` with provider, `feature_used` with an allowlisted feature name, and `session_ended` with a coarse duration bucket. Common properties are limited to app version, operating system, and CPU architecture.

Prompts, transcripts, output, file paths, repository and branch names, hostnames, email addresses, account identities, machine identifiers, API keys, run objectives, findings, and arbitrary free-form properties are never allowlisted.

Sending requires all of the following:

1. A PostHog key and host deliberately injected at build time.
2. `telemetryEnabled: true` in the user's configuration; the default is false.
3. `DO_NOT_TRACK` unset or set to `0`.

The allowlist is enforced in `src/main/analytics.ts`. A future change to event shape or default behavior must update code, this document, tests, and onboarding together.
