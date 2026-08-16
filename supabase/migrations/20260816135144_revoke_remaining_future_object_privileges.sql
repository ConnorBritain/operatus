-- Supabase's historical defaults include table maintenance privileges beyond
-- CRUD (truncate, references, and trigger). Remove the whole inherited grant
-- so future objects remain unreachable until a migration opts them in.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated, service_role;
