-- P0 follow-up (applied 2026-10-20 as 20261020160559).
-- Remove privileges on public.profiles that no client path uses.
-- anon keeps SELECT (public listings); authenticated keeps SELECT/INSERT/
-- UPDATE/DELETE, all still governed by RLS + profiles_guard_protected_columns.
-- TRUNCATE is not covered by RLS, so it is removed from both API roles.
set lock_timeout = '3s';
revoke all on function public.profiles_guard_protected_columns() from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.profiles from anon;
revoke truncate, references, trigger, maintain on table public.profiles from authenticated;
