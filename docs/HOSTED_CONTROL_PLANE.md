# Hosted control plane operations

Atelier's hosted portal is a responsive Next.js application in `apps/portal`. The reference production deployment is `https://atelier-pidgeon.vercel.app`, backed by the Supabase project identified by ref `bdoupypceewmjuozptgv`.

## Authority boundary

The portal is identity, discovery, presence, projection, command queue, and audit infrastructure. It is not Gauntlet authority.

- Electron's local SQLite database remains authoritative for run transitions.
- Git commits remain authoritative for artifact content.
- A paired node sends an explicitly redacted projection; it never sends repository paths, prompts, source files, credentials, or unrestricted terminal output.
- A browser can enqueue only named operations. The node checks expiry, local run identity, expected run version, current state, and operation support before acting.
- Each authenticated browser receives a revocable, HTTP-only client-device identity. Pairing and command audit records bind both the user and the originating browser without treating the device cookie as authority by itself.
- The current desktop build accepts `message_conductor` and `cancel_run`. Other reserved operations are rejected until their local state semantics exist.
- No arbitrary shell command, merge, push, frozen-bar edit, role impersonation, or skill installation is exposed.

## Local development

Copy `apps/portal/.env.example` to `apps/portal/.env.local` and provide:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `ATELIER_NODE_TOKEN_PEPPER`

The secret key and token pepper are server-only. Never prefix them with `NEXT_PUBLIC_`, download them into an untrusted client, or commit them. Start and verify the portal with:

```bash
npm ci --prefix apps/portal
npm --prefix apps/portal test -- --run
npm --prefix apps/portal run typecheck
npm --prefix apps/portal run dev
```

## Database changes

Source-controlled SQL lives in `supabase/migrations`. Apply migrations through the Supabase CLI or Management API, then ensure the exact timestamp is present in `supabase_migrations.schema_migrations`. Run Supabase's security advisor after every schema or policy change. All browser-visible tables must retain RLS and explicit grants. Default privileges for future public and private objects are revoked from API roles, so every new table, sequence, or function must be granted deliberately in the migration that creates it.

The initial production baseline consists of:

- `20260816123849_identity_control_plane.sql`
- `20260816130021_secure_rls_event_trigger.sql`
- `20260816135055_lock_down_future_api_objects.sql`
- `20260816135144_revoke_remaining_future_object_privileges.sql`
- `20260816140844_revoke_remote_access.sql`

## OAuth

Supabase Auth owns the application session. Google and GitHub use the provider callback:

```text
https://bdoupypceewmjuozptgv.supabase.co/auth/v1/callback
```

The application callback is:

```text
https://atelier-pidgeon.vercel.app/auth/callback
```

Production, preview, and localhost callback URLs must be explicitly allow-listed in Supabase. Do not use wildcard provider callbacks.

## Pairing a machine

1. Sign in at the portal.
2. Choose a branch and select **Pair a machine**.
3. In the desktop app, open **Settings → Connections → Remote studio**.
4. Enter the 12-character one-time code and a recognizable machine name.
5. Confirm that both surfaces show the machine online.

The invitation expires after ten minutes and can be used once. The node receives a random bearer token, stores it with Electron `safeStorage`, and makes outbound HTTPS requests every 15 seconds. Disconnecting deletes the local encrypted token. Revoking the node in the hosted directory invalidates future requests.

## Recovery and rotation

- If pairing fails, create a new invitation; never reuse or extend an expired code.
- If a node token may be exposed, revoke the node and pair it again.
- Owners and admins can select **Disconnect machine** in the portal. Revocation atomically disables the node token, expires queued or delivered commands, and appends the acting user/device to the workspace audit history. The local machine retains its files and Git state but cannot reconnect until it is paired again.
- Rotate `ATELIER_NODE_TOKEN_PEPPER` only with a planned re-pair of every node; hashes created with the old pepper will no longer authenticate.
- Rotate the Supabase secret key in Supabase and Vercel together, redeploy, verify `/api/health`, then revoke the old key.
- OAuth client secrets live only in the provider and Supabase Auth configuration.

## Deployment verification

Every portal release must pass its tests, typecheck, and production build. After deployment:

1. `GET /api/health` returns `status: ok` without authentication.
2. An anonymous Data API request cannot list nodes.
3. Google/GitHub sign-in returns through `/auth/callback` and registers the browser as a client device.
4. A new user receives one personal workspace and Main studio branch.
5. A pairing code enrolls exactly one node.
6. The node sync contains no local path or private objective.
7. A stale command is rejected and acknowledged without changing the local run.

## Tailscale

The hosted portal works over ordinary HTTPS from a tailnet or any other network. Tailscale remains useful for private direct-to-machine services later, but the current hosted connector needs no inbound port, Serve rule, Funnel, or public tunnel on the node.
