-- LOCAL/DISPOSABLE DB ONLY. Committed fixture for the parallel refund
-- proposal/approval races in scripts/ads-local-db-test.sh: one admin, one
-- paid 28-day booking. Ids are stored in public.zz_rc for the racing sessions.
update public.ad_settings set bool_value = true where key in ('ads_portal_enabled', 'ads_checkout_enabled', 'ads_delivery_enabled');
update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
update public.ad_products set active = true;
create table public.zz_rc (admin_id uuid, booking_id uuid, run_start timestamptz, paid integer);
grant select on public.zz_rc to authenticated;
do $$
declare u uuid; adm uuid; b uuid; amt int; e date;
begin
  insert into auth.users (email) values ('zz-rc-owner@example.invalid') returning id into u;
  insert into auth.users (email) values ('zz-rc-admin@example.invalid') returning id into adm;
  insert into public.user_roles (user_id, role) values (adm, 'admin');
  e := ads_internal.earliest_standard_start(now());
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ RC', 'zz-rc-owner@example.invalid');
  b := public.ad_create_hold((select id from public.ad_products where code = 'TEST-wp-home-top-daily'), e, e + 27);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  select total_pence into amt from public.ad_purchase_snapshots where booking_id = b;
  perform public.ad_record_checkout_session(b, 'cs_test_rc', amt, 'gbp', false, now() + interval '40 minutes');
  perform public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_rc', 'type', 'checkout.session.completed', 'livemode', false,
    'session_id', 'cs_test_rc', 'payment_intent_id', 'pi_test_rc', 'booking_id', b, 'payment_status', 'paid', 'amount_total', amt, 'currency', 'gbp'));
  perform set_config('role', 'postgres', true);
  insert into public.zz_rc values (adm, b, lower(ads_internal.booked_range(b)), amt);
end $$;
