-- Personal presentation preferences and one-machine-per-branch semantics.
-- A branch is the durable identity of one execution machine. Revoked nodes stay
-- in history, while only one active node may occupy the branch at a time.

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  appearance text not null default 'system' check (appearance in ('system', 'light', 'dark')),
  avatar_theme text not null default 'cedar' check (
    avatar_theme in ('cedar', 'harbor', 'saffron', 'juniper', 'clay', 'iris', 'moss', 'ember', 'coast', 'orchid', 'slate', 'sol')
  ),
  machine_scope text not null default 'all' check (machine_scope in ('all', 'online', 'favorites')),
  density text not null default 'comfortable' check (density in ('comfortable', 'compact')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branch_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid not null,
  workspace_id uuid not null,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, branch_id),
  foreign key (branch_id, workspace_id) references public.branches(id, workspace_id) on delete cascade
);

create index branch_preferences_workspace_idx
  on public.branch_preferences(user_id, workspace_id, favorite);

create unique index nodes_one_active_per_branch_idx
  on public.nodes(branch_id)
  where revoked_at is null;

create trigger user_preferences_touch before update on public.user_preferences
for each row execute function private.touch_updated_at();

create trigger branch_preferences_touch before update on public.branch_preferences
for each row execute function private.touch_updated_at();

insert into public.user_preferences (user_id)
select profile.user_id
from public.profiles profile
on conflict (user_id) do nothing;

alter table public.user_preferences enable row level security;
alter table public.branch_preferences enable row level security;

create policy user_preferences_select_self on public.user_preferences
for select to authenticated
using ((select auth.uid()) = user_id);

create policy user_preferences_insert_self on public.user_preferences
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy user_preferences_update_self on public.user_preferences
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy branch_preferences_select_self on public.branch_preferences
for select to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_workspace_member(workspace_id))
);

create policy branch_preferences_insert_self on public.branch_preferences
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.is_workspace_member(workspace_id))
);

create policy branch_preferences_update_self on public.branch_preferences
for update to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_workspace_member(workspace_id))
)
with check (
  (select auth.uid()) = user_id
  and (select private.is_workspace_member(workspace_id))
);

create policy branch_preferences_delete_self on public.branch_preferences
for delete to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_workspace_member(workspace_id))
);

create policy workspaces_update_admin on public.workspaces
for update to authenticated
using ((select private.has_workspace_role(id, array['owner', 'admin'])))
with check ((select private.has_workspace_role(id, array['owner', 'admin'])));

grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, update, delete on public.branch_preferences to authenticated;
grant update on public.workspaces to authenticated;

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

  insert into public.user_preferences (user_id)
  values (new.id);

  insert into public.workspaces (id, name, slug, created_by)
  values (
    workspace_id,
    left(account_name || '''s company', 120),
    'personal-' || left(replace(new.id::text, '-', ''), 12),
    new.id
  );

  insert into public.workspace_memberships (workspace_id, user_id, role, status)
  values (workspace_id, new.id, 'owner', 'active');

  insert into public.branches (workspace_id, name, slug, theme, created_by)
  values (workspace_id, 'Main machine', 'main-machine', 'cedar', new.id);

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
