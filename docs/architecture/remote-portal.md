# Remote floor: web and mobile direction

A phone-accessible Atelier is feasible and should be treated as a first-class client of the run protocol, not as remote desktop streaming.

## Boundary

The desktop remains execution and local-run authority. It publishes a redacted `RunSnapshot` plus ordered `RunEvent` stream through a transport-neutral service. Electron IPC is the first transport; a future encrypted relay can expose the same contract to a responsive web app, installable PWA, and thin iOS/Android shells.

The visual floor is reconstructed from protocol state. Terminals may be streamed separately with explicit redaction and retention controls.

## Remote capabilities

The first remote control surface should permit:

- view runs, agents, phase, checks, findings, and exact artifact identity;
- view an explicitly shared terminal stream;
- message the Conductor;
- pause or cancel a run;
- answer a `HUMAN_REQUIRED` question;
- approve an explicitly human-gated operation.

It must not grant arbitrary shell access, merge, push, change the frozen bar, install skills, or broaden role permissions by default.

## Security model

- Desktop initiates pairing and shows a short-lived one-time code or QR payload.
- Device keys are per-device, revocable, and stored in platform secure storage.
- Relay sees encrypted envelopes; it is not run authority.
- Every command carries user/device identity, nonce, expiry, run version, and requested operation.
- Desktop revalidates authority and state before appending an auditable event.
- Sensitive paths, prompts, terminal output, diffs, and secrets have independent sharing controls.
- Read-only observation is the default remote grant.
- No unauthenticated LAN listener or automatic public tunnel.

## Shipped hosted foundation

The Runs renderer consumes shared snapshots and ordered events rather than importing SQLite or main-process objects. `src/main/gauntlet/remoteProjection.ts` provides an explicit, least-information projection that removes local paths, authority tokens, check commands, event reasons, and human text unless an independent sharing policy enables the relevant field.

The hosted foundation is now live: Supabase Auth and RLS provide user/workspace identity; Postgres stores branches, browser-device identities, paired nodes, redacted projections, narrow commands, and audit events; the responsive Vercel portal provides desktop/mobile views; and Atelier's outbound-only node connector pairs with a short-lived code, stores its token through OS encryption, syncs every 15 seconds, and locally revalidates commands. Browser-device cookies are HTTP-only identifiers rather than bearer authority, and every command still requires a valid Supabase user session plus current workspace membership. Owners and admins can revoke a paired node transactionally; the node token stops authenticating, pending commands expire, and the actor is audited without altering local files or Git state. `message_conductor` and `cancel_run` are active. Pause and human-gate operations remain reserved until their local state-machine semantics are implemented.

## Multiple machines and office branches

The future topology is many clients to many execution nodes. Each macOS, Windows, or Linux machine runs an Atelier node that makes an outbound authenticated connection to a relay. A workspace contains named branches; branches contain machines; machines expose repositories and locally authoritative runs. Desktop, responsive web, PWA, iOS, and Android clients can switch among the machines their identity may access.

The relay carries presence, encrypted projections, and signed command envelopes. It never becomes artifact or run authority. Every command includes workspace, machine, run, device identity, nonce, expiry, idempotency key, expected run version, and narrow operation. The destination machine revalidates the command before changing local state and returns an auditable acknowledgment. Offline commands are limited to safe, explicitly queueable operations; shell input and approvals expire rather than waiting indefinitely.

```text
workspace → branch/location → machine → repository → run → launch/artifact
```

This model supports several users observing several machines without conflating physical presence, UI presence, and protocol authority.

### Twelve branch identities

Every daemon/workspace pair has a presentation-only `BranchProfile`: a human name plus one of twelve built-in visual themes—Cedar, Harbor, Saffron, Juniper, Clay, Iris, Moss, Ember, Coast, Orchid, Slate, or Sol. The profile is shown consistently in the floor wash and border, persistent branch badge, machine switcher, run cards, terminal headers, presence map, notifications, and mobile navigation. Color is never the only signal; the name and theme label travel with it for accessibility and screenshots.

Branch identity and organization skin are deliberately separate. A skin expresses the operator's overall brand; a branch theme distinguishes one machine/location from another inside that brand. Neither may affect provider settings, role capabilities, frozen contracts, artifacts, or protocol authority. The milestone-one desktop stores branch profiles by local workspace path; the remote protocol will replace that local lookup key with stable workspace and node IDs while preserving the same profile shape.

## Identity and deployment profiles

Accounts are not required for a fully local installation. Atelier should support three compatible profiles:

| Profile | Human identity | Machine/client pairing | External dependency |
|---|---|---|---|
| Personal local | none | one-time QR invitation plus per-device keys | none on one LAN; optional private VPN away from it |
| Self-hosted workspace | local accounts, passkeys, or operator-provided OIDC | workspace-issued device certificates | user-owned relay/directory |
| Hosted workspace | email/passkey with optional Google or GitHub OAuth | hosted directory plus revocable device keys | Atelier-hosted identity and encrypted relay |

GitHub identity is optional and should grant repository/PR integration, not basic access to locally running agents. Human account identity, client device identity, machine node identity, and provider login are separate credentials with separate revocation. A signed-in client still cannot impersonate a Gauntlet role; it submits a narrow human command which the destination node revalidates and records.

## Tailscale-first personal fleet

For an operator whose computers and phone already share a tailnet, Tailscale is the preferred zero-hosted-account path. Atelier's local gateway listens only on `127.0.0.1`; an explicit **Expose to my tailnet** setup action configures Tailscale Serve as a persistent HTTPS reverse proxy. Each branch remains directly addressable by its machine MagicDNS name, so a Samsung phone, Mac, or work laptop on the tailnet can reach it without a public listener, port-forwarding, or a Vercel account.

Atelier should detect `tailscale status --json`, explain the exact change, and ask before altering Serve configuration. It should then verify the resulting Serve status and show the HTTPS URL and a QR code. Disabling the integration removes only the Atelier-owned Serve route, never resets unrelated Serve configuration. The local gateway remains useful without Tailscale and continues to require Atelier's own device/session credentials as defense in depth.

Tailscale is both transport and an optional identity signal, not the run authority:

- use per-machine MagicDNS names for commands that must reach one exact branch; do not put artifact-changing commands behind a load-balanced service;
- use tailnet grants for network access and, on supporting Tailscale versions, app capabilities for `observe`, `message`, `operate`, and `admin` scopes;
- accept Tailscale identity/capability headers only on the loopback listener behind Serve, because a directly reachable backend would allow header spoofing;
- retain Atelier's nonce, expiry, idempotency key, expected run version, device key, and local authorization checks;
- support tagged unattended compute nodes as well as user-owned desktops; user identity headers and tagged-device capabilities have different semantics;
- keep Tailscale Funnel disabled: personal-fleet mode is tailnet-only.

The direct-tailnet PWA can aggregate the four configured branch endpoints in the browser. A small elected directory node can simplify discovery, but no node becomes authority for another. The optional Vercel relay remains useful later for push notifications, offline command delivery, non-tailnet guests, and commercial multi-user workspaces; it is not required for the user's personal fleet.

## Mobile delivery

The first Samsung/Android client should be the responsive web application installed as a PWA. The same shared React client can later ship through Capacitor for Play Store/App Store distribution, stronger secure storage, biometrics, background push handling, and native share/deep-link integration. Kotlin or Swift is reserved for small native plugins where the platform requires it; neither is required for the control-plane client itself.

The reusable boundary is shared protocol schemas and presentation components—not Electron IPC. Electron, browser/PWA, and Capacitor clients each adapt their transport to the same redacted snapshots, ordered events, pairing messages, and narrow commands.

## Hosted portal reference deployment

For a personal fleet of continuously running Windows and macOS nodes, the reference hosted topology is:

| Component | Responsibility |
|---|---|
| Vercel-hosted Next.js/PWA | responsive office, machine switcher, Runs views, pairing, settings |
| Postgres | users, workspaces, memberships, devices, nodes, durable command/audit records |
| Supabase Realtime | authenticated browser updates for nodes, projections, and commands |
| Vercel HTTP functions | authenticated browser and outbound-node APIs |
| Atelier node daemon | local provider processes, Git repositories, SQLite authority, command revalidation |

The first release deliberately uses short outbound HTTPS polling for nodes and Supabase Realtime for signed-in browser updates. Function instance memory is never used for membership, presence, pending commands, or run authority. A future streaming transport can replace polling without changing the durable schema or local validation boundary.

The daemon should run at login or as an operating-system service and maintain only outbound connections. A work laptop may use the browser client without installing a daemon. The Mac desktop may operate locally even when the hosted portal, identity provider, or relay is unavailable.

## Skins and commercial modules

Presentation is deliberately separate from protocol semantics. A future signed theme manifest may define color tokens, typography, logos, floor packs, station layouts, and layered character parts sharing a common animation skeleton. Users may rename displayed agents and customize avatars, while stable internal role IDs (`conductor`, `implementer`, `critic`, `repairer`) continue to govern authority.

Optional modules should extend capabilities through versioned, permission-declared interfaces. A theme is data and assets, not executable orchestration code. Entitlements may expose paid modules, but disabling or losing an entitlement must never make local run history unreadable or weaken the open protocol core.

## Later delivery sequence

1. Authenticated localhost read-only HTTP/WebSocket adapter.
2. Tailscale detection plus an explicit Serve/MagicDNS setup flow for a tailnet-only PWA.
3. Pairing, device registry, redaction, and audit UI.
4. Responsive PWA reusing the run timeline and floor projection.
5. Optional end-to-end encrypted relay with offline/push notification support.
6. Native wrappers only where background notifications, secure storage, or platform UX justify them.
7. Theme manifests, layered character creation, organizational branding, and a signed module catalog.

## Platform references

- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Tailscale Serve examples and identity headers](https://tailscale.com/docs/reference/examples/serve)
- [MagicDNS](https://tailscale.com/docs/features/magicdns)
- [Tailscale identity](https://tailscale.com/docs/concepts/tailscale-identity)
- [Tailscale grants and app capabilities](https://tailscale.com/docs/reference/syntax/grants)
- [Tailscale for Android](https://tailscale.com/docs/install/android)
- [Vercel WebSocket public beta](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)
- [Vercel WebSocket function behavior](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
