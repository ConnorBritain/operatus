-- Preserve applied migration history while moving the callable API to Operatus.

alter function public.enroll_atelier_node(text, text, text, text, text, text, text, jsonb, text)
  rename to enroll_operatus_node;

alter function public.claim_atelier_commands(text, integer)
  rename to claim_operatus_commands;

alter function public.revoke_atelier_node(uuid, uuid, uuid)
  rename to revoke_operatus_node;

revoke all on function public.enroll_operatus_node(text, text, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.enroll_operatus_node(text, text, text, text, text, text, text, jsonb, text)
  to service_role;

revoke all on function public.claim_operatus_commands(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_operatus_commands(text, integer)
  to service_role;

revoke all on function public.revoke_operatus_node(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_operatus_node(uuid, uuid, uuid)
  to service_role;
