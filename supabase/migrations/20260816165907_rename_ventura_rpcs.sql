-- Preserve applied migration history while moving the callable API to Ventura.

alter function public.enroll_atelier_node(text, text, text, text, text, text, text, jsonb, text)
  rename to enroll_ventura_node;

alter function public.claim_atelier_commands(text, integer)
  rename to claim_ventura_commands;

alter function public.revoke_atelier_node(uuid, uuid, uuid)
  rename to revoke_ventura_node;

revoke all on function public.enroll_ventura_node(text, text, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.enroll_ventura_node(text, text, text, text, text, text, text, jsonb, text)
  to service_role;

revoke all on function public.claim_ventura_commands(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_ventura_commands(text, integer)
  to service_role;

revoke all on function public.revoke_ventura_node(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_ventura_node(uuid, uuid, uuid)
  to service_role;
