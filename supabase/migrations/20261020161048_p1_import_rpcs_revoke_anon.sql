-- Import RPCs are admin-only (each gates on is_admin_or_above()); anon never needs them.
-- Applied to production 2026-10-20 as 20261020161048.
-- Note: is_admin/is_admin_or_above/is_super_admin/has_role/manages_entity
-- deliberately stay executable by anon because RLS policies evaluate them
-- during anonymous reads.
set lock_timeout = '3s';
revoke execute on function public.start_import_run(text, integer) from public, anon;
revoke execute on function public.complete_import_run(uuid, integer, integer) from public, anon;
revoke execute on function public.rollback_import_run(uuid) from public, anon;
revoke execute on function public.import_gig_row(uuid, text, text, text, date, text, text, text, text, uuid, text, jsonb, jsonb, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.start_import_run(text, integer) to authenticated, service_role;
grant execute on function public.complete_import_run(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.rollback_import_run(uuid) to authenticated, service_role;
grant execute on function public.import_gig_row(uuid, text, text, text, date, text, text, text, text, uuid, text, jsonb, jsonb, text, text, text, uuid, uuid) to authenticated, service_role;
