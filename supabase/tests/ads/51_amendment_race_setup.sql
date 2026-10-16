-- LOCAL/DISPOSABLE DB ONLY. Committed fixture for the amendment-vs-hold race
-- in scripts/ads-local-db-test.sh: two paid, late-approved bookings, each
-- with an open amendment proposal that extends into the next (free) day.
create schema zz;
grant usage on schema zz to anon, authenticated, service_role;
create function zz.as_user(p uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create function zz.as_service() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true); perform set_config('role', 'service_role', true); end $$;
create function zz.as_pg() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', '{}', true); perform set_config('role', 'postgres', true); end $$;
create function zz.at(ts timestamptz) returns void language plpgsql as $$ begin
  perform set_config('ads.test_now', ts::text, true); end $$;
create function zz.err(p_sql text, p_like text, p_label text) returns void language plpgsql as $$ begin
  begin execute p_sql; exception when others then
    if sqlerrm not like p_like then raise exception 'FAIL [%]: got "%"', p_label, sqlerrm; end if; return; end;
  raise exception 'FAIL [%]: statement succeeded', p_label; end $$;
create function zz.ok(b boolean, l text) returns void language plpgsql as $$ begin
  if b is not true then raise exception 'FAIL [%]', l; end if; end $$;
-- Paid booking helper: verified webhook for the snapshot amount.
create function zz.pay(p_booking uuid, p_key text) returns text language plpgsql as $$
declare amt integer; r jsonb; begin
  perform zz.as_service();
  select total_pence into amt from public.ad_purchase_snapshots where booking_id = p_booking;
  perform public.ad_record_checkout_session(p_booking, 'cs_test_' || p_key, amt, 'gbp', false, now() + interval '40 minutes');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_' || p_key, 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_' || p_key, 'payment_intent_id', 'pi_test_' || p_key, 'booking_id', p_booking,
         'payment_status', 'paid', 'amount_total', amt, 'currency', 'gbp'));
  return r ->> 'outcome'; end $$;
-- Complete creative helper (server-verified submission path, service role).
create function zz.submit(p_owner uuid, p_booking uuid, p_dest text) returns uuid language plpgsql as $$
declare c uuid; a uuid; d text; m text; begin
  perform zz.as_pg();
  select id, advertiser_id into c, a from public.ad_campaigns where booking_id = p_booking;
  d := a || '/' || c || '/' || gen_random_uuid() || '-desktop.png';
  m := a || '/' || c || '/' || gen_random_uuid() || '-mobile.png';
  insert into storage.objects (bucket_id, name) values ('ad-creatives-private', d), ('ad-creatives-private', m);
  perform zz.as_service();
  return public.ad_submit_creative_version(p_owner, c,
    jsonb_build_object('path', d, 'mime', 'image/png', 'bytes', 1000, 'width', 1200, 'height', 250, 'sha256', repeat('1', 64)),
    jsonb_build_object('path', m, 'mime', 'image/png', 'bytes', 1000, 'width', 600, 'height', 250, 'sha256', repeat('2', 64)),
    p_dest, 'ZZ banner'); end $$;
grant execute on all functions in schema zz to anon, authenticated, service_role;
create table public.zz_amr (round int, amendment_id uuid, owner_id uuid, other_id uuid, product_id uuid, next_day date);
grant select on public.zz_amr to authenticated;
do $$
declare u_owner uuid; u_other uuid; u_admin uuid; p uuid; e date; b uuid; v uuid; st timestamptz; am uuid; i int;
begin
  insert into auth.users (email) values ('zz-amr-owner@example.invalid') returning id into u_owner;
  insert into auth.users (email) values ('zz-amr-other@example.invalid') returning id into u_other;
  insert into auth.users (email) values ('zz-amr-admin@example.invalid') returning id into u_admin;
  insert into public.user_roles (user_id, role) values (u_admin, 'admin');
  update public.ad_settings set bool_value = true where key in ('ads_portal_enabled', 'ads_checkout_enabled', 'ads_delivery_enabled', 'ads_amendments_enabled');
  update public.ad_settings set int_value = 1440 where key = 'amendment_offer_minutes';
  update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
  update public.ad_products set active = true;
  select id into p from public.ad_products where code = 'TEST-wp-home-top-daily';
  e := ads_internal.earliest_standard_start(now());
  perform zz.as_user(u_owner);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ AMR owner', 'zz-amr-owner@example.invalid');
  perform zz.as_user(u_other);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ AMR other', 'zz-amr-other@example.invalid');
  for i in 1..2 loop
    perform zz.as_pg(); perform zz.at(now());
    perform zz.as_user(u_owner);
    b := public.ad_create_hold(p, e + 10 * i, e + 10 * i);
    perform zz.as_pg(); perform zz.pay(b, 'amr' || i);
    perform zz.as_pg(); st := lower(ads_internal.original_range(b));
    perform zz.as_pg(); perform zz.at(st + interval '9 hours');
    v := zz.submit(u_owner, b, 'https://example.com/amr' || i);
    perform zz.as_pg(); perform zz.at(st + interval '10 hours 17 minutes');
    perform zz.as_user(u_admin);
    perform public.ad_admin_review(v, 'approve');
    am := public.ad_admin_propose_amendment(b, 'Race fixture: correction delay');
    perform zz.as_pg();
    insert into public.zz_amr values (i, am, u_owner, u_other, p, e + 10 * i + 1);
  end loop;
  perform zz.as_pg(); perform set_config('ads.test_now', '', true);
end $$;
commit;
