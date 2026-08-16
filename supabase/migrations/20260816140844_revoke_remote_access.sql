-- Atomically revoke a paired node, expire its pending work, and retain the
-- identity-bound audit record. This privileged operation is reachable only
-- from Atelier's server-side service role and revalidates actor membership.

create or replace function public.revoke_atelier_node(
  target_node_id uuid,
  actor_user_id uuid,
  actor_device_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
  actor_role text;
begin
  select node.workspace_id into target_workspace_id
  from public.nodes node
  where node.id = target_node_id
  for update;

  if target_workspace_id is null then
    raise exception 'NODE_NOT_FOUND';
  end if;

  select membership.role into actor_role
  from public.workspace_memberships membership
  where membership.workspace_id = target_workspace_id
    and membership.user_id = actor_user_id
    and membership.status = 'active';

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'NODE_REVOCATION_FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.client_devices device
    where device.id = actor_device_id
      and device.user_id = actor_user_id
      and device.revoked_at is null
  ) then
    raise exception 'DEVICE_NOT_AUTHORIZED';
  end if;

  if exists (
    select 1 from public.nodes node
    where node.id = target_node_id and node.revoked_at is not null
  ) then
    return false;
  end if;

  update public.nodes
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where id = target_node_id;

  update public.commands
  set status = 'expired',
      acknowledged_at = now(),
      acknowledgment = jsonb_build_object('reason', 'NODE_REVOKED'),
      updated_at = now()
  where node_id = target_node_id
    and status in ('queued', 'delivered');

  insert into public.audit_events (
    workspace_id, actor_kind, actor_user_id, actor_device_id,
    actor_node_id, action, resource_kind, resource_id, metadata
  ) values (
    target_workspace_id, 'device', actor_user_id, actor_device_id,
    null, 'node.revoked', 'node', target_node_id::text,
    jsonb_build_object('pending_commands_expired', true)
  );

  return true;
end;
$$;

revoke all on function public.revoke_atelier_node(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_atelier_node(uuid, uuid, uuid)
  to service_role;
