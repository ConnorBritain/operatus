-- Supabase creates this event trigger to enforce RLS on new public tables.
-- It does not need to be callable through the Data API.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
