-- LOCAL/DISPOSABLE DB ONLY. Booking amendments + exact intervals (migration
-- 20261016230000). Clock-driven via ads.test_now; delivery boundaries use
-- the transaction's fixed now(). Rolled back.
-- Signal: "ads booking amendments: ALL CHECKS PASSED".
begin;
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
create function zz.approve_at(p_admin uuid, p_owner uuid, p_booking uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v uuid; begin
  perform zz.as_pg(); perform zz.at(p_at - interval '1 hour');
  v := zz.submit(p_owner, p_booking, 'https://example.com/' || left(p_booking::text, 8));
  perform zz.as_pg(); perform zz.at(p_at);
  perform zz.as_user(p_admin);
  perform public.ad_admin_review(v, 'approve');
  perform zz.as_pg();
  return v; end $$;
create function zz.st(p_booking uuid) returns timestamptz language sql security definer as $$ select lower(ads_internal.original_range(p_booking)) $$;
grant execute on all functions in schema zz to anon, authenticated, service_role;

do $$
declare
  u_owner uuid; u_other uuid; u_admin uuid; p_daily uuid; e date; s0 date;
  bA uuid; bF uuid; bP uuid; bR uuid; bH uuid; bX uuid; bN uuid; bG uuid; bD uuid; bL uuid; bE uuid;
  am uuid; am2 uuid; st timestamptz; pk timestamptz; a record; r jsonb; v uuid; t text; n int;
begin
  insert into auth.users (email) values ('zz-owner@example.invalid') returning id into u_owner;
  insert into auth.users (email) values ('zz-other@example.invalid') returning id into u_other;
  insert into auth.users (email) values ('zz-admin@example.invalid') returning id into u_admin;
  insert into public.user_roles (user_id, role) values (u_admin, 'admin');
  update public.ad_settings set bool_value = true where key in ('ads_portal_enabled', 'ads_checkout_enabled', 'ads_delivery_enabled');
  update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
  update public.ad_products set active = true;
  select id into p_daily from public.ad_products where code = 'TEST-wp-home-top-daily';
  e := ads_internal.earliest_standard_start(now());
  s0 := e + 10;
  update public.ad_settings set int_value = 20 where key = 'max_active_holds_per_advertiser';   -- fixture: several holds before paying
  perform zz.as_user(u_owner);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ Owner', 'zz-owner@example.invalid');
  perform zz.as_user(u_other);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ Other', 'zz-other@example.invalid');

  perform zz.as_user(u_owner);
  bA := public.ad_create_hold(p_daily, s0, s0 + 1);
  bP := public.ad_create_hold(p_daily, s0 + 5, s0 + 5);
  bR := public.ad_create_hold(p_daily, s0 + 8, s0 + 8);
  bX := public.ad_create_hold(p_daily, s0 + 11, s0 + 11);
  bN := public.ad_create_hold(p_daily, s0 + 14, s0 + 14);
  perform zz.as_user(u_other);
  bF := public.ad_create_hold(p_daily, s0 + 2, s0 + 2);
  bG := public.ad_create_hold(p_daily, s0 + 15, s0 + 15);
  perform zz.as_pg();
  perform zz.pay(bA, 'a1'); perform zz.pay(bP, 'a2'); perform zz.pay(bR, 'a3'); perform zz.pay(bX, 'a4'); perform zz.pay(bN, 'a5');
  perform zz.pay(bF, 'a6'); perform zz.pay(bG, 'a7');
  st := zz.st(bA);

  -- ── Gates ───────────────────────────────────────────────────────────
  perform zz.approve_at(u_admin, u_owner, bA, st + interval '10 hours 17 minutes');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_amendment(%L, 'Correction delay')$q$, bA), '%ADS_AMENDMENTS_DISABLED%', 'feature off by default');
  perform zz.as_pg(); update public.ad_settings set bool_value = true where key = 'ads_amendments_enabled';
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_amendment(%L, 'Correction delay')$q$, bA), '%ADS_POLICY_GATE%offer expiry%', 'offer expiry undecided -> refused');
  perform public.ad_admin_set_setting('amendment_offer_minutes', null, 1440);
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_admin_propose_amendment(%L, 'Correction delay')$q$, bA), '%ADS_FORBIDDEN%', 'advertiser cannot propose');

  -- ── Shortened at a confirmed following booking (never displaced) ────
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bA, 'Correction delay: approved 10:17 on day one');
  perform zz.as_pg();
  select * into a from public.ad_booking_amendments where id = am;
  perform zz.ok(a.proposed_from = st + interval '11 hours' and a.original_from = st and a.original_until = st + interval '48 hours',
                'start = next whole UK hour strictly after approval; original interval kept');
  perform zz.ok(a.proposed_until = zz.st(bF) and not a.preserves_duration and a.shortened_seconds = 11 * 3600 and a.following_booking_id = bF,
                'shortened at the following booking boundary (11 h), never displacing it');
  perform zz.ok(a.basis ->> 'capacity_held' = 'false' and a.basis ->> 'policy_status' like 'PROVISIONAL%', 'proposal holds no capacity; policy marked provisional');
  perform zz.ok(ads_internal.effective_range(bA) = ads_internal.original_range(bA), 'nothing changes before agreement');
  perform zz.err(format($q$update public.ad_booking_amendments set proposed_until = proposed_until + interval '1 hour' where id = %L$q$, am), '%ADS_IMMUTABLE%', 'proposal intervals immutable');

  -- Ownership: only the booking owner can respond; admins cannot accept for them.
  perform zz.as_user(u_other);
  perform zz.err(format($q$select public.ad_respond_amendment(%L, 'accept')$q$, am), '%ADS_NOT_FOUND%', 'other advertiser cannot respond');
  perform zz.ok((select count(*) from public.ad_booking_amendments) = 0, 'other advertiser cannot see it');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_respond_amendment(%L, 'accept')$q$, am), '%ADS_NOT_FOUND%', 'admin cannot accept on the advertiser''s behalf');
  perform zz.as_user(u_owner);
  perform zz.ok((select count(*) from public.ad_booking_amendments where id = am) = 1, 'owner sees the proposal');
  perform zz.err(format($q$update public.ad_bookings set serve_from = now() where id = %L$q$, bA), '%permission denied%', 'advertiser cannot move the interval directly');
  perform zz.ok(public.ad_respond_amendment(am, 'accept') = 'accepted', 'owner accepts');
  perform zz.err(format($q$select public.ad_respond_amendment(%L, 'accept')$q$, am), '%ADS_INVALID_STATE%', 'decided proposals are final');
  perform zz.as_pg();
  perform zz.ok((select serve_from = st + interval '11 hours' and serve_until = zz.st(bF) and start_date = s0 and end_date = s0 + 1 from public.ad_bookings where id = bA),
                'effective interval changed; original order dates untouched');
  perform zz.ok((select booked_from = st and booked_until = st + interval '48 hours' from public.ad_booking_confirmations where booking_id = bA)
                and (select start_date = s0 and end_date = s0 + 1 from public.ad_purchase_snapshots where booking_id = bA), 'historical order + confirmation unaltered');
  perform zz.ok((select array_agg(kind || ':' || serve_from::text order by id) from public.ad_booking_interval_history where booking_id = bA)
                = array['original:' || st::text, 'amended:' || (st + interval '11 hours')::text], 'original + changed interval history');
  perform zz.ok((select array_agg(day order by day) from public.ad_booking_inventory_days where booking_id = bA) = array[s0, s0 + 1]
                and (select array_agg(day order by day) from public.ad_booking_inventory_days where booking_id = bF) = array[s0 + 2], 'following booking untouched');
  perform zz.err(format($q$delete from public.ad_booking_interval_history where booking_id = %L$q$, bA), '%ADS_IMMUTABLE%', 'history append-only');

  -- ── Duration preserved where capacity permits; later holds respect it ─
  st := zz.st(bP);
  perform zz.approve_at(u_admin, u_owner, bP, st + interval '3 hours');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bP, 'Correction delay');
  perform zz.as_user(u_owner);
  perform public.ad_respond_amendment(am, 'accept');
  perform zz.as_pg();
  perform zz.ok((select serve_from = st + interval '4 hours' and serve_until = st + interval '28 hours' from public.ad_bookings where id = bP)
                and (select preserves_duration from public.ad_booking_amendments where id = am), 'purchased 24 elapsed hours preserved');
  perform zz.ok((select array_agg(day order by day) from public.ad_booking_inventory_days where booking_id = bP) = array[s0 + 5, s0 + 6], 'inventory follows the touched London days');
  perform zz.as_user(u_other);
  perform zz.err(format('select public.ad_create_hold(%L, %L, %L)', p_daily, s0 + 6, s0 + 6), '%ADS_CAPACITY_UNAVAILABLE%', 'existing amended run protected from new holds');
  -- Report + refund use the accepted interval / original purchase.
  perform zz.as_user(u_owner);
  r := public.ad_report(bP, null, null);
  perform zz.ok((r ->> 'amended')::boolean and (r ->> 'served_from')::timestamptz = st + interval '4 hours' and (r ->> 'served_seconds')::bigint = 86400
                and (r ->> 'original_from')::timestamptz = st and jsonb_array_length(r -> 'rows') = 2, 'report: served interval, exact duration, touched days');
  perform zz.as_user(u_admin);
  am2 := public.ad_admin_propose_refund(bP, false, jsonb_build_array(jsonb_build_object('from', st, 'until', st + interval '10 hours', 'evidence', 'Outage log ZZ-AM-1')), 'Outage');
  perform zz.as_pg();
  perform zz.ok((select lost_seconds = 6 * 3600 and purchased_seconds = 86400 and pence = 250 from public.ad_refund_lines where assessment_id = am2),
                'lost time clipped to the served interval; denominator = original purchased hours (1000 x 6/24)');

  -- ── Race: proposal holds nothing; acceptance rechecks atomically ─────
  st := zz.st(bR);
  perform zz.approve_at(u_admin, u_owner, bR, st + interval '2 hours');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bR, 'Correction delay');
  perform zz.as_user(u_other);
  bH := public.ad_create_hold(p_daily, s0 + 9, s0 + 9);                      -- free at day level: proposal held nothing
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_respond_amendment(%L, 'accept')$q$, am), '%ADS_CAPACITY_UNAVAILABLE%', 'acceptance refused: interval no longer free');
  perform zz.as_pg();
  perform zz.ok(ads_internal.effective_range(bR) = ads_internal.original_range(bR) and (select status from public.ad_booking_amendments where id = am) = 'proposed',
                'refused acceptance changes nothing');
  perform zz.as_user(u_admin);
  am2 := public.ad_admin_propose_amendment(bR, 'Re-proposed after the new hold');
  perform zz.as_pg();
  perform zz.ok((select status from public.ad_booking_amendments where id = am) = 'superseded'
                and (select proposed_until = zz.st(bH) and following_booking_id = bH from public.ad_booking_amendments where id = am2), 'superseded; new proposal stops at the hold');
  perform zz.as_user(u_owner);
  perform zz.ok(public.ad_respond_amendment(am2, 'accept') = 'accepted', 'accept the re-proposal');

  -- ── Expired and stale proposals ─────────────────────────────────────
  st := zz.st(bX);
  perform zz.approve_at(u_admin, u_owner, bX, st + interval '1 hour 30 minutes');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bX, 'Correction delay');
  perform zz.as_pg(); perform zz.at(st + interval '1 hour 30 minutes' + interval '24 hours');   -- exactly at expiry
  perform zz.as_user(u_owner);
  perform zz.ok(public.ad_respond_amendment(am, 'accept') = 'expired', 'expired proposal cannot be accepted');
  perform zz.as_pg();
  perform zz.ok((select status from public.ad_booking_amendments where id = am) = 'expired' and ads_internal.effective_range(bX) = ads_internal.original_range(bX), 'expiry recorded; nothing moved');
  perform zz.as_user(u_admin);
  perform public.ad_admin_set_setting('amendment_offer_minutes', null, 10080);
  perform zz.as_pg(); perform zz.at(st + interval '1 hour 31 minutes');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bX, 'Second offer');
  perform zz.as_pg(); perform zz.at(st + interval '2 hours' + interval '24 hours');               -- exactly at the proposed end
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_respond_amendment(%L, 'accept')$q$, am), '%already ended%', 'already-expired run never applied');
  perform zz.ok(public.ad_respond_amendment(am, 'reject') = 'rejected', 'owner can still reject');

  -- ── No remaining capacity -> no negative/zero run ────────────────────
  st := zz.st(bN);
  perform zz.approve_at(u_admin, u_owner, bN, st + interval '23 hours 30 minutes');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_amendment(%L, 'Too late')$q$, bN), '%ADS_NO_CAPACITY%', 'next hour = following booking start -> refused');
  -- approved before start: no amendment needed
  perform zz.as_pg(); perform zz.at(zz.st(bG) - interval '2 days');
  perform zz.as_user(u_owner);
  bE := public.ad_create_hold(p_daily, s0 + 20, s0 + 20);
  perform zz.as_pg(); perform zz.pay(bE, 'a8');
  perform zz.approve_at(u_admin, u_owner, bE, zz.st(bE) - interval '1 hour');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_amendment(%L, 'Not needed')$q$, bE), '%ADS_NO_AMENDMENT_NEEDED%', 'approval before start needs no amendment');
  -- already-expired run never proposed
  perform zz.as_pg(); perform zz.at(zz.st(bX) + interval '26 hours');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_amendment(%L, 'Late offer')$q$, bX), '%ADS_NO_CAPACITY%', 'run that would already have ended is refused');

  -- booking removed after the proposal -> stale, never applied
  perform zz.as_pg(); perform zz.at(zz.st(bE) - interval '3 days');
  perform zz.as_user(u_owner);
  bD := public.ad_create_hold(p_daily, s0 + 17, s0 + 17);
  perform zz.as_pg(); perform zz.pay(bD, 'a9');
  perform zz.approve_at(u_admin, u_owner, bD, zz.st(bD) + interval '1 hour');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bD, 'Correction delay');
  perform public.ad_admin_cancel_booking(bD, 'Advertiser cancelled by email ZZ', 'business', 'advertiser');
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_respond_amendment(%L, 'accept')$q$, am), '%booking no longer active%', 'stale: cancelled booking never amended');

  -- ── DST: purchased elapsed hours preserved across the spring change ──
  perform zz.as_pg(); perform zz.at('2027-03-20 12:00+00');
  perform zz.as_user(u_owner);
  bD := public.ad_create_hold(p_daily, '2027-03-27', '2027-03-28');          -- Sun 28 Mar 2027 has 23 hours
  perform zz.as_pg(); perform zz.pay(bD, 'a10');
  perform zz.approve_at(u_admin, u_owner, bD, '2027-03-27 10:17+00');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bD, 'Correction delay over the clock change');
  perform zz.as_pg();
  perform zz.ok((select purchased_seconds = 47 * 3600 and proposed_from = '2027-03-27 11:00+00' and proposed_until = '2027-03-29 10:00+00' and preserves_duration
                 from public.ad_booking_amendments where id = am), '47 elapsed hours kept: 11:00 GMT Sat -> 11:00 BST Mon');
  perform zz.as_user(u_owner);
  perform public.ad_respond_amendment(am, 'accept');
  perform zz.as_pg();
  perform zz.ok((select array_agg(day order by day) from public.ad_booking_inventory_days where booking_id = bD) = array['2027-03-27'::date, '2027-03-28', '2027-03-29'],
                'touched London days across DST');

  -- ── 24-hour packages: explicit gates ─────────────────────────────────
  perform zz.as_pg(); perform zz.at(now()); pk := ads_internal.london_day_start(s0 + 40);
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_quote_elapsed(%L, %L, 720)$q$, p_daily, pk), '%ADS_POLICY_GATE%', '24 h packages gated off');
  perform zz.as_pg(); update public.ad_settings set bool_value = true where key = 'ads_hourly_packages_enabled';
  perform zz.as_user(u_owner);
  r := public.ad_quote_elapsed(p_daily, pk, 720);
  perform zz.ok((r ->> 'elapsed_hours')::int = 720 and (r ->> 'end_at')::timestamptz - (r ->> 'start_at')::timestamptz = interval '720 hours'
                and r -> 'price' = 'null'::jsonb and (r ->> 'available')::boolean, 'quote support: exact 720 elapsed hours, price withheld');
  perform zz.err(format($q$select public.ad_quote_elapsed(%L, %L, 30)$q$, p_daily, pk), '%whole 24-hour%', 'only 24 h multiples');
  perform zz.err(format($q$select public.ad_quote_elapsed(%L, %L, 24)$q$, p_daily, pk + interval '30 minutes'), '%whole UK hour%', 'whole-hour starts only');
  perform zz.err(format($q$select public.ad_create_hold_elapsed(%L, %L, 720, false)$q$, p_daily, pk), '%ADS_POLICY_GATE%', 'holds for 24 h packages always refused');

  -- ── Serving path enforces the exact interval (start inclusive, end exclusive)
  perform zz.as_pg(); perform zz.at(zz.st(bE) - interval '3 days');
  perform zz.as_user(u_owner);
  bL := public.ad_create_hold(p_daily, s0 + 22, s0 + 22);
  perform zz.as_pg(); perform zz.pay(bL, 'a11');
  v := zz.approve_at(u_admin, u_owner, bL, zz.st(bL) - interval '1 day');
  perform zz.as_pg();
  delete from public.ad_booking_inventory_days where booking_id = bL;          -- LOCAL TEST ONLY: make it "today"
  insert into public.ad_booking_inventory_days select bL, id, ads_internal.london_today() from public.ad_inventory_units where code = 'wordpress-home-top';
  update public.ad_bookings set serve_from = now() - interval '1 hour', serve_until = now() + interval '1 hour' where id = bL;
  perform zz.ok((public.ad_public_delivery('wordpress-home-top') -> 0 ->> 'creative_version_id')::uuid = v
                and (public.ad_public_delivery('wordpress-home-top') -> 0 ->> 'serve_until')::timestamptz = now() + interval '1 hour', 'served with exact serve_until');
  perform zz.as_service();
  perform zz.ok(public.ad_record_metric('impression', v, 'wordpress-home-top', repeat('a', 32)) = 'counted', 'impression counted inside the interval');
  perform zz.as_pg();
  update public.ad_bookings set serve_until = now() where id = bL;
  perform zz.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'end boundary exclusive: not served at serve_until even if no job ran');
  perform zz.as_service();
  perform zz.ok(public.ad_record_metric('impression', v, 'wordpress-home-top', repeat('b', 32)) = 'not_eligible', 'no impressions after the end');
  perform zz.as_pg();
  update public.ad_bookings set serve_from = now(), serve_until = now() + interval '1 hour' where id = bL;
  perform zz.ok(jsonb_array_length(public.ad_public_delivery('wordpress-home-top')) = 1, 'start boundary inclusive');
  update public.ad_bookings set serve_from = now() + interval '1 second', serve_until = now() + interval '1 hour' where id = bL;
  perform zz.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'never before the start');
  update public.ad_bookings set serve_from = now() - interval '1 hour' where id = bL;

  -- Replacement under review: earlier approved creative keeps running unless the gate is switched.
  perform zz.submit(u_owner, bL, 'https://example.com/replacement');
  perform zz.as_pg();
  perform zz.ok((public.ad_public_delivery('wordpress-home-top') -> 0 ->> 'creative_version_id')::uuid = v, 'default: previous approved creative keeps running');
  update public.ad_settings set bool_value = true where key = 'replacement_pauses_previous_creative';
  perform zz.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'gate on: paused while replacement is reviewed');
  update public.ad_settings set bool_value = false where key = 'replacement_pauses_previous_creative';

  -- Anonymous/other users never see amendments or history.
  perform zz.as_user(u_other);
  perform zz.ok((select count(*) from public.ad_booking_interval_history where booking_id = bA) = 0, 'other user sees no interval history');
  perform zz.err($q$select public.ad_admin_withdraw_amendment(gen_random_uuid(), 'No permission')$q$, '%ADS_FORBIDDEN%', 'non-admin cannot withdraw');

  raise notice 'ads booking amendments: ALL CHECKS PASSED';
end $$;
rollback;
