-- Atelier hosted identity and narrow multi-machine control plane.
-- Local SQLite and Git remain authoritative for run state and artifacts.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  theme text not null default 'cedar' check (
    theme in ('cedar', 'harbor', 'saffron', 'juniper', 'clay', 'iris', 'moss', 'ember', 'coast', 'orchid', 'slate', 'sol')
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id)
);

create table public.client_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  platform text not null check (char_length(platform) between 1 and 40),
  public_key text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  branch_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  hostname text not null check (char_length(hostname) between 1 and 255),
  platform text not null check (platform in ('darwin', 'win32', 'linux')),
  architecture text not null check (char_length(architecture) between 1 and 32),
  app_version text not null check (char_length(app_version) between 1 and 40),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  public_key text,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  paired_by uuid references auth.users(id) on delete set null,
  status text not null default 'offline' check (status in ('online', 'offline', 'degraded', 'revoked')),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, workspace_id) references public.branches(id, workspace_id)
);

create table public.pairing_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  branch_id uuid not null,
  created_by uuid not null references auth.users(id),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  node_id uuid references public.nodes(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  foreign key (branch_id, workspace_id) references public.branches(id, workspace_id)
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  local_repository_id text not null check (char_length(local_repository_id) between 8 and 128),
  display_name text not null check (char_length(display_name) between 1 and 160),
  remote_host text,
  remote_owner text,
  remote_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (node_id, local_repository_id)
);

create table public.run_projections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  repository_id uuid references public.repositories(id) on delete set null,
  local_run_id text not null check (char_length(local_run_id) between 1 and 128),
  title text not null check (char_length(title) between 1 and 240),
  phase text not null check (char_length(phase) between 1 and 64),
  terminal_status text,
  artifact_sha text check (artifact_sha is null or artifact_sha ~ '^[0-9a-f]{40}$'),
  run_version bigint not null default 0 check (run_version >= 0),
  snapshot jsonb not null default '{}'::jsonb check (
    jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 131072
  ),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (node_id, local_run_id)
);

create table public.commands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  run_projection_id uuid references public.run_projections(id) on delete set null,
  issued_by uuid not null references auth.users(id),
  issued_from_device_id uuid references public.client_devices(id) on delete set null,
  operation text not null check (
    operation in ('message_conductor', 'pause_run', 'cancel_run', 'answer_human_required', 'approve_human_gate')
  ),
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384
  ),
  idempotency_key uuid not null,
  expected_run_version bigint check (expected_run_version is null or expected_run_version >= 0),
  status text not null default 'queued' check (
    status in ('queued', 'delivered', 'accepted', 'rejected', 'expired', 'failed')
  ),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  acknowledgment jsonb check (acknowledgment is null or octet_length(acknowledgment::text) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (node_id, idempotency_key),
  check (expires_at > created_at)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_kind text not null check (actor_kind in ('user', 'device', 'node', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_device_id uuid references public.client_devices(id) on delete set null,
  actor_node_id uuid references public.nodes(id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  resource_kind text not null check (char_length(resource_kind) between 1 and 80),
  resource_id text,
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384
  ),
  created_at timestamptz not null default now()
);

create index workspace_memberships_user_idx on public.workspace_memberships(user_id, status);
create index branches_workspace_idx on public.branches(workspace_id);
create index client_devices_user_idx on public.client_devices(user_id) where revoked_at is null;
create index nodes_workspace_idx on public.nodes(workspace_id, last_seen_at desc);
create index nodes_branch_idx on public.nodes(branch_id, last_seen_at desc);
create index pairing_invitations_expiry_idx on public.pairing_invitations(expires_at) where consumed_at is null;
create index repositories_node_idx on public.repositories(node_id);
create index run_projections_node_idx on public.run_projections(node_id, updated_at desc);
create index commands_node_queue_idx on public.commands(node_id, status, created_at);
create index audit_events_workspace_idx on public.audit_events(workspace_id, created_at desc);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces
for each row execute function private.touch_updated_at();
create trigger memberships_touch before update on public.workspace_memberships
for each row execute function private.touch_updated_at();
create trigger branches_touch before update on public.branches
for each row execute function private.touch_updated_at();
create trigger nodes_touch before update on public.nodes
for each row execute function private.touch_updated_at();
create trigger commands_touch before update on public.commands
for each row execute function private.touch_updated_at();

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function private.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.has_workspace_role(uuid, text[]) from public;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id uuid := gen_random_uuid();
  account_name text;
begin
  account_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Personal'
  );

  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    left(account_name, 120),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );

  insert into public.workspaces (id, name, slug, created_by)
  values (
    workspace_id,
    left(account_name || '''s Atelier', 120),
    'personal-' || left(replace(new.id::text, '-', ''), 12),
    new.id
  );

  insert into public.workspace_memberships (workspace_id, user_id, role, status)
  values (workspace_id, new.id, 'owner', 'active');

  insert into public.branches (workspace_id, name, slug, theme, created_by)
  values (workspace_id, 'Main studio', 'main-studio', 'cedar', new.id);

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function public.enroll_atelier_node(
  invitation_code_hash text,
  node_token_hash text,
  node_name text,
  node_hostname text,
  node_platform text,
  node_architecture text,
  node_app_version text,
  node_capabilities jsonb default '{}'::jsonb,
  node_public_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.pairing_invitations%rowtype;
  new_node_id uuid;
begin
  select * into invitation
  from public.pairing_invitations
  where code_hash = invitation_code_hash
    and consumed_at is null
    and expires_at > now()
  for update;

  if invitation.id is null then
    raise exception 'PAIRING_INVITATION_INVALID_OR_EXPIRED';
  end if;

  insert into public.nodes (
    workspace_id, branch_id, name, hostname, platform, architecture,
    app_version, capabilities, public_key, token_hash, paired_by
  ) values (
    invitation.workspace_id,
    invitation.branch_id,
    left(node_name, 120),
    left(node_hostname, 255),
    node_platform,
    left(node_architecture, 32),
    left(node_app_version, 40),
    coalesce(node_capabilities, '{}'::jsonb),
    node_public_key,
    node_token_hash,
    invitation.created_by
  ) returning id into new_node_id;

  update public.pairing_invitations
  set consumed_at = now(), node_id = new_node_id
  where id = invitation.id;

  insert into public.audit_events (
    workspace_id, actor_kind, actor_user_id, actor_node_id,
    action, resource_kind, resource_id
  ) values (
    invitation.workspace_id, 'system', invitation.created_by, new_node_id,
    'node.enrolled', 'node', new_node_id::text
  );

  return new_node_id;
end;
$$;

revoke all on function public.enroll_atelier_node(text, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.enroll_atelier_node(text, text, text, text, text, text, text, jsonb, text) to service_role;

create or replace function public.claim_atelier_commands(node_token_hash text, command_limit integer default 20)
returns table (
  id uuid,
  operation text,
  payload jsonb,
  idempotency_key uuid,
  expected_run_version bigint,
  expires_at timestamptz,
  run_projection_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_node_id uuid;
begin
  select node.id into authenticated_node_id
  from public.nodes node
  where node.token_hash = node_token_hash
    and node.revoked_at is null;

  if authenticated_node_id is null then
    raise exception 'NODE_AUTHENTICATION_FAILED';
  end if;

  update public.commands command
  set status = 'expired', updated_at = now()
  where command.node_id = authenticated_node_id
    and command.status in ('queued', 'delivered')
    and command.expires_at <= now();

  return query
  with candidates as (
    select command.id
    from public.commands command
    where command.node_id = authenticated_node_id
      and command.status = 'queued'
      and command.expires_at > now()
    order by command.created_at
    limit greatest(1, least(command_limit, 50))
    for update skip locked
  ), delivered as (
    update public.commands command
    set status = 'delivered', delivered_at = now(), updated_at = now()
    from candidates
    where command.id = candidates.id
    returning command.*
  )
  select delivered.id, delivered.operation, delivered.payload,
    delivered.idempotency_key, delivered.expected_run_version,
    delivered.expires_at, delivered.run_projection_id
  from delivered
  order by delivered.created_at;
end;
$$;

revoke all on function public.claim_atelier_commands(text, integer) from public, anon, authenticated;
grant execute on function public.claim_atelier_commands(text, integer) to service_role;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.branches enable row level security;
alter table public.client_devices enable row level security;
alter table public.nodes enable row level security;
alter table public.pairing_invitations enable row level security;
alter table public.repositories enable row level security;
alter table public.run_projections enable row level security;
alter table public.commands enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_self on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);
create policy profiles_update_self on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy workspaces_select_member on public.workspaces for select to authenticated
using ((select private.is_workspace_member(id)));
create policy memberships_select_member on public.workspace_memberships for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy branches_select_member on public.branches for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy branches_update_admin on public.branches for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'admin'])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'admin'])));
create policy devices_select_self on public.client_devices for select to authenticated
using ((select auth.uid()) = user_id);
create policy nodes_select_member on public.nodes for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy pairing_select_creator on public.pairing_invitations for select to authenticated
using ((select auth.uid()) = created_by and (select private.is_workspace_member(workspace_id)));
create policy repositories_select_member on public.repositories for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy projections_select_member on public.run_projections for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy commands_select_member on public.commands for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy audit_select_member on public.audit_events for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.workspaces, public.workspace_memberships, public.nodes,
  public.pairing_invitations, public.repositories, public.run_projections,
  public.commands, public.audit_events to authenticated;
grant select, update on public.branches to authenticated;
grant select on public.client_devices to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nodes'
  ) then
    alter publication supabase_realtime add table public.nodes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'run_projections'
  ) then
    alter publication supabase_realtime add table public.run_projections;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'commands'
  ) then
    alter publication supabase_realtime add table public.commands;
  end if;
end;
$$;
