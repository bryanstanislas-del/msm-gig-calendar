-- ROLLBACK for ALL ads migrations (20261015120000 and every later ads forward
-- migration). MANUAL USE ONLY.
-- Lives outside supabase/migrations so it is never applied automatically.
--
-- Refuses to run if any non-TEST booking, any live-mode payment, or any
-- uploaded creative object exists (financial/audit records and storage
-- files must be exported and handled deliberately first; Supabase storage
-- files must be removed through the Storage API/dashboard, not SQL).
-- Touches nothing outside the advertising objects created by the up
-- migration (promo_slots, featured_listings, founding_supporters and all
-- Calendar tables are unaffected).

begin;

do $$
begin
  if exists (select 1 from public.ad_bookings where not is_test) then
    raise exception 'Refusing rollback: non-test bookings exist. Export and resolve them first.';
  end if;
  if exists (select 1 from public.ad_payments where livemode) then
    raise exception 'Refusing rollback: live-mode payments exist.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'ad-creatives-private') then
    raise exception 'Refusing rollback: empty the ad-creatives-private bucket via the Storage API/dashboard first.';
  end if;
end $$;

drop policy if exists ads_creatives_owner_insert on storage.objects;
drop policy if exists ads_creatives_owner_admin_select on storage.objects;
delete from storage.buckets where id = 'ad-creatives-private';

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ad\_%' loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;

-- Every advertising table (public.ad_*), including those added by later
-- forward migrations (20261016090000, 20261016120000, ...).
do $$
declare t record;
begin
  for t in select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ad\_%' loop
    execute format('drop table if exists %s cascade', t.rel);
  end loop;
end $$;
drop schema if exists ads_internal cascade;

commit;
