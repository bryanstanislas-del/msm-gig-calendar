-- ROLLBACK for 20261015120000_ads_platform_phase1.sql. MANUAL USE ONLY.
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

drop table if exists
  public.ad_rate_limits, public.ad_metric_dedupe, public.ad_metrics_daily, public.ad_admin_notes,
  public.ad_audit_log, public.ad_payment_events, public.ad_payments, public.ad_campaigns cascade;
drop table if exists
  public.ad_creative_versions, public.ad_purchase_snapshots, public.ad_booking_inventory_days,
  public.ad_bookings, public.ad_advertisers, public.ad_product_units, public.ad_products,
  public.ad_inventory_units, public.ad_uk_holidays, public.ad_settings cascade;
drop schema if exists ads_internal cascade;

commit;
