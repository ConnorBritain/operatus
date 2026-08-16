-- Make future Data API exposure opt-in. Existing objects keep their explicit
-- Atelier grants; every new table, sequence, or function must be granted
-- deliberately in the migration that creates it.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke select, insert, update, delete on tables from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke usage, select on sequences from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;
