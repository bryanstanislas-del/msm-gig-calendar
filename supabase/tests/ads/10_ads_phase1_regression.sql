-- Advertising phase 1 regression suite. LOCAL/DISPOSABLE DATABASE ONLY.
-- Run via scripts/ads-local-db-test.sh (shim + migration + this file).
-- Everything runs in one transaction and is rolled back. Uses ZZTEST
-- fixtures only; it exercises role-spoofing paths and must never be run
-- with a production connection string.
--
-- Signal: "NOTICE: ads phase1 regression: ALL CHECKS PASSED".

begin;

create schema zz_test;
grant usage on schema zz_test to anon, authenticated, service_role;

create function zz_test.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function zz_test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
create function zz_test.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
create function zz_test.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'postgres', true);
end $$;
create function zz_test.expect_error(p_sql text, p_like text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then
      raise exception 'FAIL [%]: expected error like "%", got "%"', p_label, p_like, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL [%]: expected error like "%", but statement succeeded', p_label, p_like;
end $$;
create function zz_test.ok(p boolean, p_label text) returns void language plpgsql as $$
begin
  if p is not true then raise exception 'FAIL [%]', p_label; end if;
end $$;
-- LOCAL TEST HELPER ONLY: moves a booking's dates (and its per-day
-- inventory rows) so delivery can be exercised "today" even though the
-- standard rule never allows booking today. Call as postgres.
create function zz_test.shift_booking(p_booking uuid, p_new_start date) returns void language plpgsql as $$
declare d integer;
begin
  select p_new_start - start_date into d from public.ad_bookings where id = p_booking;
  create temp table zz_days on commit drop as select booking_id, unit_id, day + d as day from public.ad_booking_inventory_days where booking_id = p_booking;
  delete from public.ad_booking_inventory_days where booking_id = p_booking;
  insert into public.ad_booking_inventory_days select * from zz_days;
  drop table zz_days;
  update public.ad_bookings set start_date = start_date + d, end_date = end_date + d where id = p_booking;
end $$;
grant execute on all functions in schema zz_test to anon, authenticated, service_role;

do $$
declare
  u_owner uuid; u_other uuid; u_third uuid; u_admin uuid; u_padmin uuid;
  adv_owner uuid; adv_other uuid; adv_third uuid;
  p_daily uuid; p_weekly uuid; unit_top uuid;
  today date := (now() at time zone 'Europe/London')::date;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; c1 uuid; c2 uuid; c4 uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid;
  q jsonb; r jsonb; n integer; t text; ok boolean;
  ck1 text := repeat('a', 64); ck2 text := repeat('b', 64);
  dsk jsonb; mob jsonb;
  b5 uuid; c5 uuid; v5 uuid; v6 uuid;
  e date; -- server-computed earliest STANDARD start date (review window)
begin
  -- ── Fixtures ────────────────────────────────────────────────────────
  insert into auth.users (email) values ('zztest-owner@example.invalid') returning id into u_owner;
  insert into auth.users (email) values ('zztest-other@example.invalid') returning id into u_other;
  insert into auth.users (email) values ('zztest-third@example.invalid') returning id into u_third;
  insert into auth.users (email) values ('zztest-admin@example.invalid') returning id into u_admin;
  insert into auth.users (email) values ('zztest-padmin@example.invalid') returning id into u_padmin;
  insert into public.user_roles (user_id, role) values (u_admin, 'admin');
  insert into public.profiles (user_id, role, band_name) values (u_padmin, 'admin', 'ZZTEST admin profile');

  select id into p_daily from public.ad_products where code = 'TEST-wp-home-top-daily';
  select id into p_weekly from public.ad_products where code = 'TEST-wp-home-top-weekly';
  select id into unit_top from public.ad_inventory_units where code = 'wordpress-home-top';

  -- ── Defaults: everything OFF ────────────────────────────────────────
  perform zz_test.ok((select bool_and(not bool_value) from public.ad_settings where bool_value is not null), 'all toggles default off');
  perform zz_test.ok((select bool_and(not active and is_test) from public.ad_products), 'products inactive + test by default');
  perform zz_test.ok((select bool_and(not active) from public.ad_inventory_units), 'units inactive by default');
  perform zz_test.ok((select not public from storage.buckets where id = 'ad-creatives-private'), 'creative bucket is private');

  perform zz_test.as_user(u_owner);
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, today + 5, today + 6), '%ADS_DISABLED%', 'hold refused while portal disabled');
  perform zz_test.as_anon();
  perform zz_test.ok((select public.ad_public_flags() ->> 'portal') = 'false', 'anon flags readable');
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'nothing delivered by default');

  -- Admin enables the test setup (owner/other cannot).
  perform zz_test.as_user(u_owner);
  perform zz_test.expect_error($q$select public.ad_admin_set_setting('ads_portal_enabled', true)$q$, '%ADS_FORBIDDEN%', 'advertiser cannot flip toggles');
  perform zz_test.as_user(u_admin);
  perform public.ad_admin_set_setting('ads_portal_enabled', true);
  perform public.ad_admin_set_setting('ads_checkout_enabled', true);
  perform public.ad_admin_set_setting('ads_delivery_enabled', true);
  perform public.ad_admin_set_setting('min_lead_days', null, 0);
  perform zz_test.expect_error($q$select public.ad_admin_set_setting('ads_priority_review_enabled', true)$q$, '%ADS_NOT_AVAILABLE_IN_PHASE_1%', 'priority review cannot be enabled');
  perform zz_test.expect_error($q$select public.ad_admin_set_setting('stripe_livemode', true)$q$, '%ADS_NOT_AVAILABLE_IN_PHASE_1%', 'live mode cannot be enabled');
  perform zz_test.expect_error($q$select public.ad_admin_set_setting('ads_venue_gig_targeting_enabled', true)$q$, '%ADS_NOT_AVAILABLE_IN_PHASE_1%', 'venue/gig ads stay off');
  update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
  perform zz_test.as_postgres();
  e := ads_internal.earliest_standard_start(now());
  perform zz_test.ok(e >= today + 2 and e <= today + 7, 'earliest standard start is 2..7 days ahead (review window), got ' || e);
  perform zz_test.as_user(u_admin);
  update public.ad_products set active = true where code in ('TEST-wp-home-top-daily', 'TEST-wp-home-top-weekly');

  -- ── Anonymous access ────────────────────────────────────────────────
  perform zz_test.as_anon();
  perform zz_test.expect_error('select count(*) from public.ad_bookings', '%permission denied%', 'anon cannot read bookings');
  perform zz_test.expect_error('select count(*) from public.ad_advertisers', '%permission denied%', 'anon cannot read advertisers');
  perform zz_test.expect_error('select count(*) from public.ad_creative_versions', '%permission denied%', 'anon cannot read creative versions');
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, today, today), '%permission denied%', 'anon cannot hold');
  perform zz_test.expect_error($q$select public.ad_apply_stripe_event('{"id":"evt_x","type":"checkout.session.completed"}')$q$, '%permission denied%', 'anon cannot post stripe events');
  perform zz_test.expect_error($q$select public.ad_record_metric('impression', gen_random_uuid(), 'wordpress-home-top', repeat('a',64))$q$, '%permission denied%', 'anon cannot record metrics directly');

  -- ── Advertiser accounts ────────────────────────────────────────────
  perform zz_test.as_user(u_owner);
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, today, today), '%ADS_NO_ADVERTISER%', 'hold needs advertiser profile');
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZTEST Owner Co', 'zztest-owner@example.invalid') returning id into adv_owner;
  perform zz_test.expect_error($q$insert into public.ad_advertisers (display_name, contact_email, status) values ('x2', 'a@b.cd', 'active')$q$, '%permission denied%', 'cannot set advertiser status');
  perform zz_test.expect_error(format($q$update public.ad_advertisers set status = 'suspended' where id = %L$q$, adv_owner), '%permission denied%', 'cannot change own status');

  perform zz_test.as_user(u_other);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZTEST Other Ltd', 'zztest-other@example.invalid') returning id into adv_other;
  perform zz_test.ok((select count(*) from public.ad_advertisers) = 1, 'other user sees only own advertiser');
  perform zz_test.expect_error(format($q$insert into public.ad_advertisers (display_name, contact_email, owner_user_id) values ('Spoof', 's@p.of', %L)$q$, u_owner), '%permission denied%', 'cannot create advertiser for another user');

  perform zz_test.as_user(u_third);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZTEST Third', 'zztest-third@example.invalid') returning id into adv_third;

  -- ── Dates / validation ─────────────────────────────────────────────
  perform zz_test.as_user(u_owner);
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, today + 3, today + 2), '%ADS_INVALID_DATES%', 'end before start rejected');
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_weekly, e + 1, e + 3), '%between 7 and 28%', 'weekly package min days enforced');
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, today - 1, today), '%too soon%', 'past start rejected');
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, today + 400, today + 401), '%too far ahead%', 'far future rejected');
  -- Tampered/early dates are refused server-side whatever the UI sent.
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, e - 1, e - 1), '%earliest standard UK start date is ' || e || '%', 'day before earliest standard start rejected (hold)');
  perform zz_test.expect_error(format('select public.ad_quote(%L, %L, %L)', p_daily, e - 1, e + 1), '%too soon%', 'day before earliest standard start rejected (quote)');
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_daily, today + 1, today + 1), '%too soon%', 'tomorrow rejected');
  perform zz_test.ok((public.ad_earliest_start() ->> 'earliest_start')::date = e, 'portal helper returns the same earliest date');

  -- ── Hold + server-side price snapshot ──────────────────────────────
  q := public.ad_quote(p_daily, e, e + 2);
  perform zz_test.ok((q ->> 'total_pence')::int = 3000 and (q ->> 'available')::boolean and (q ->> 'is_test')::boolean, 'quote computed server-side');
  b1 := public.ad_create_hold(p_daily, e, e + 2);  -- earliest standard date accepted
  perform zz_test.ok((select total_pence from public.ad_purchase_snapshots where booking_id = b1) = 3000, 'snapshot total = 3 x 1000');
  perform zz_test.ok((select status from public.ad_bookings where id = b1) = 'held', 'booking held');
  select id into c1 from public.ad_campaigns where booking_id = b1;
  perform zz_test.expect_error(format($q$update public.ad_bookings set status = 'confirmed' where id = %L$q$, b1), '%permission denied%', 'advertiser cannot self-confirm');
  perform zz_test.expect_error(format($q$update public.ad_bookings set start_date = start_date - 1 where id = %L$q$, b1), '%permission denied%', 'advertiser cannot move dates');
  perform zz_test.expect_error(format($q$update public.ad_purchase_snapshots set total_pence = 1 where booking_id = %L$q$, b1), '%permission denied%', 'advertiser cannot edit snapshot');
  perform zz_test.expect_error(format($q$update public.ad_campaigns set approved_version_id = null, review_status = 'approved' where id = %L$q$, c1), '%permission denied%', 'advertiser cannot self-approve');
  update public.ad_products set price_per_day_pence = 100 where id = p_daily;
  get diagnostics n = row_count;
  perform zz_test.ok(n = 0, 'advertiser cannot change prices (RLS: 0 rows)');
  perform zz_test.expect_error($q$insert into public.ad_payments (booking_id, livemode, checkout_session_id, amount_pence, currency) values (gen_random_uuid(), false, 'cs_test_x', 1, 'gbp')$q$, '%permission denied%', 'advertiser cannot insert payments');
  perform zz_test.expect_error(format($q$select public.ad_apply_stripe_event('{"id":"evt_spoof","type":"checkout.session.completed","livemode":false,"booking_id":"%s","payment_status":"paid"}')$q$, b1), '%permission denied%', 'advertiser cannot post stripe events');
  perform zz_test.expect_error(format($q$select public.ad_admin_review(gen_random_uuid(), 'approve')$q$), '%ADS_FORBIDDEN%', 'advertiser cannot approve');

  -- ── Other user isolation ───────────────────────────────────────────
  perform zz_test.as_user(u_other);
  perform zz_test.ok((select count(*) from public.ad_bookings) = 0, 'other user cannot see booking');
  perform zz_test.ok((select count(*) from public.ad_purchase_snapshots) = 0, 'other user cannot see snapshot');
  perform zz_test.ok((select count(*) from public.ad_campaigns) = 0, 'other user cannot see campaign');
  perform zz_test.expect_error(format('select public.ad_cancel_hold(%L)', b1), '%ADS_NOT_FOUND%', 'other user cannot cancel');
  perform zz_test.expect_error(format('select public.ad_prepare_checkout(%L)', b1), '%ADS_NOT_FOUND%', 'other user cannot checkout');
  perform zz_test.expect_error(format('select public.ad_report(%L, null, null)', b1), '%ADS_NOT_FOUND%', 'other user cannot report');

  -- ── Shared physical inventory across packages ──────────────────────
  perform zz_test.expect_error(format('select public.ad_create_hold(%L, %L, %L)', p_weekly, e + 2, e + 8), '%ADS_CAPACITY_UNAVAILABLE%', 'weekly package cannot oversell day held by daily package');
  b2 := public.ad_create_hold(p_weekly, e + 3, e + 9);
  perform zz_test.ok(b2 is not null, 'non-overlapping weekly hold ok');
  -- Test-only: move b1 to today..today+2 so the delivery/report tests below
  -- can run now (the snapshot keeps its original booked dates).
  perform zz_test.as_postgres();
  perform zz_test.shift_booking(b1, today);

  -- ── Checkout amount is server-owned ────────────────────────────────
  perform zz_test.as_user(u_owner);
  q := public.ad_prepare_checkout(b1);
  perform zz_test.ok((q ->> 'total_pence')::int = 3000, 'prepare_checkout returns snapshot amount');
  perform zz_test.as_service();
  perform zz_test.expect_error(format($q$select public.ad_record_checkout_session(%L, 'cs_test_b1a', 2999, 'gbp', false, now() + interval '50 minutes')$q$, b1), '%ADS_AMOUNT_MISMATCH%', 'checkout amount must equal snapshot');
  perform zz_test.expect_error(format($q$select public.ad_record_checkout_session(%L, 'cs_live_b1a', 3000, 'gbp', true, now() + interval '50 minutes')$q$, b1), '%ADS_MODE_MISMATCH%', 'live session refused in test phase');
  perform public.ad_record_checkout_session(b1, 'cs_test_b1a', 3000, 'gbp', false, now() + interval '50 minutes');
  perform zz_test.as_user(u_owner);
  perform zz_test.expect_error(format('select public.ad_cancel_hold(%L)', b1), '%ADS_CHECKOUT_IN_PROGRESS%', 'cannot cancel during open checkout');

  -- ── Storage policies (private drafts) ──────────────────────────────
  t := adv_owner || '/' || c1 || '/' || gen_random_uuid() || '-desktop.png';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  perform zz_test.expect_error(format($q$insert into storage.objects (bucket_id, name) values ('ad-creatives-private', '%s/%s/%s-desktop.png')$q$, adv_other, c1, gen_random_uuid()), '%row-level security%', 'cannot upload into another advertiser prefix');
  perform zz_test.expect_error(format($q$insert into storage.objects (bucket_id, name) values ('ad-creatives-private', '%s/%s/evil.svg')$q$, adv_owner, c1), '%row-level security%', 'bad filename/extension refused');
  update storage.objects set name = name || 'x' where name = t;
  get diagnostics n = row_count;
  perform zz_test.ok(n = 0, 'uploaded creative cannot be overwritten');
  perform zz_test.ok((select count(*) from storage.objects where name = t) = 1, 'owner can read own draft');
  perform zz_test.as_user(u_other);
  perform zz_test.ok((select count(*) from storage.objects where name = t) = 0, 'other user cannot read draft');
  perform zz_test.as_anon();
  perform zz_test.ok((select count(*) from storage.objects where name = t) = 0, 'anon cannot read draft');
  perform zz_test.as_user(u_admin);
  perform zz_test.ok((select count(*) from storage.objects where name = t) = 1, 'admin can read draft for review');

  -- ── Creative submission (server-verified, service role) ────────────
  perform zz_test.as_postgres();
  dsk := jsonb_build_object('path', t, 'mime', 'image/png', 'bytes', 50000, 'width', 1200, 'height', 250, 'sha256', repeat('1', 64));
  t := adv_owner || '/' || c1 || '/' || gen_random_uuid() || '-mobile.png';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  mob := jsonb_build_object('path', t, 'mime', 'image/png', 'bytes', 30000, 'width', 600, 'height', 250, 'sha256', repeat('2', 64));

  perform zz_test.as_user(u_owner);
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.com', 'Alt text')$q$, u_owner, c1, dsk, mob), '%permission denied%', 'advertiser cannot bypass server verification');
  perform zz_test.as_service();
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.com', 'Alt text')$q$, u_other, c1, dsk, mob), '%ADS_NOT_FOUND%', 'actor must own campaign');
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.com', 'Alt text')$q$, u_owner, c1, dsk || '{"width":1199}', mob), '%dimensions%', 'wrong desktop dimensions refused');
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.com', 'Alt text')$q$, u_owner, c1, dsk || '{"mime":"image/svg+xml"}', mob), '%type%', 'svg refused');
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.com', 'Alt text')$q$, u_owner, c1, dsk || '{"bytes":2000000}', mob), '%size%', 'oversize refused');
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.com', 'Alt text')$q$, u_owner, c1, mob, dsk), '%path%', 'desktop/mobile swap refused');
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.com', 'Alt text')$q$, u_owner, c1, dsk || jsonb_build_object('path', adv_owner || '/' || c1 || '/' || gen_random_uuid() || '-desktop.png'), mob), '%missing%', 'unknown object refused');
  foreach t in array array['http://example.com', 'javascript:alert(1)', 'https://localhost/x', 'https://user:pw@example.com', 'https://192.168.0.1/', 'https://exa mple.com', 'data:text/html,x', '//example.com'] loop
    perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, %L, 'Alt text')$q$, u_owner, c1, dsk, mob, t), '%ADS_INVALID_DESTINATION%', 'unsafe destination refused: ' || t);
  end loop;
  v1 := public.ad_submit_creative_version(u_owner, c1, dsk, mob, 'https://example.com/landing?utm_source=msm', 'ZZTEST banner');
  perform zz_test.ok((select review_status from public.ad_campaigns where id = c1) = 'awaiting_payment', 'complete creative before payment: awaiting payment');
  perform zz_test.ok((select review_clock_started_at is null from public.ad_creative_versions where id = v1), 'review clock not started before payment');

  perform zz_test.as_user(u_admin);
  perform zz_test.expect_error(format($q$select public.ad_admin_review(%L, 'approve')$q$, v1), '%ADS_NOT_PAID%', 'cannot approve unpaid booking');

  -- ── Stripe events: verification-independent DB semantics ───────────
  perform zz_test.as_service();
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_amt', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b1a', 'booking_id', b1, 'payment_status', 'paid', 'amount_total', 1, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'amount_mismatch_flagged', 'tampered amount flagged');
  perform zz_test.ok((select status from public.ad_bookings where id = b1) = 'held', 'tampered amount does not confirm');

  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_live', 'type', 'checkout.session.completed', 'livemode', true,
         'session_id', 'cs_test_b1a', 'booking_id', b1, 'payment_status', 'paid', 'amount_total', 3000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'ignored_mode_mismatch', 'live event ignored in test mode');

  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_wrongbooking', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b1a', 'booking_id', b2, 'payment_status', 'paid', 'amount_total', 3000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'ignored_booking_mismatch', 'metadata booking mismatch ignored');

  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_paid1', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b1a', 'payment_intent_id', 'pi_test_b1', 'booking_id', b1, 'payment_status', 'paid',
         'amount_total', 3000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'confirmed', 'verified payment confirms booking');
  perform zz_test.ok((select status from public.ad_bookings where id = b1) = 'confirmed', 'booking confirmed');
  perform zz_test.ok((select review_status from public.ad_campaigns where id = c1) = 'under_review', 'payment moves to UNDER REVIEW, never approved');
  perform zz_test.ok((select approved_version_id is null from public.ad_campaigns where id = c1), 'payment never approves');
  perform zz_test.ok((select status from public.ad_creative_versions where id = v1) = 'submitted', 'version still awaiting review');
  perform zz_test.as_postgres();
  perform zz_test.ok((select review_due_before = ads_internal.review_due_before(review_clock_started_at) from public.ad_creative_versions where id = v1), 'review deadline set');
  perform zz_test.as_service();
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'paid but unapproved creative is not delivered');

  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_paid1', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b1a', 'booking_id', b1, 'payment_status', 'paid', 'amount_total', 3000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'duplicate', 'webhook retry is idempotent');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_paid1_again', 'type', 'checkout.session.async_payment_succeeded', 'livemode', false,
         'session_id', 'cs_test_b1a', 'booking_id', b1, 'payment_status', 'paid', 'amount_total', 3000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'already_applied', 'second success event for same session is a no-op');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_exp_late', 'type', 'checkout.session.expired', 'livemode', false,
         'session_id', 'cs_test_b1a', 'booking_id', b1));
  perform zz_test.ok(r ->> 'outcome' = 'ignored_not_open' and (select status from public.ad_payments where checkout_session_id = 'cs_test_b1a') = 'paid',
         'out-of-order expired event cannot un-pay');
  perform zz_test.ok((select count(*) from public.ad_payment_events where provider_event_id = 'evt_paid1') = 1, 'event stored once');

  -- ── Payment visibility ─────────────────────────────────────────────
  perform zz_test.as_user(u_owner);
  perform zz_test.ok((select count(*) from public.ad_payments) = 1, 'owner sees own payment');
  perform zz_test.ok((select count(*) from public.ad_payment_events) = 0, 'owner cannot see raw provider events');
  perform zz_test.ok((select count(*) from public.ad_audit_log) = 0, 'owner cannot see audit log');
  perform zz_test.as_user(u_padmin);
  perform zz_test.ok((select count(*) from public.ad_payment_events) >= 5, 'profile-role admin sees provider events');

  -- ── Approval bound to version ──────────────────────────────────────
  perform zz_test.as_user(u_admin);
  perform zz_test.expect_error(format($q$select public.ad_admin_review(%L, 'reject', 'no')$q$, v1), '%ADS_REASON_REQUIRED%', 'reject needs reason');
  perform public.ad_admin_review(v1, 'approve');
  perform zz_test.ok((select approved_version_id = v1 and review_status = 'approved' from public.ad_campaigns where id = c1), 'approved v1');
  perform zz_test.as_anon();
  r := public.ad_public_delivery('wordpress-home-top');
  perform zz_test.ok(jsonb_array_length(r) = 1 and (r -> 0 ->> 'creative_version_id')::uuid = v1, 'approved creative delivered');
  perform zz_test.ok((select array_agg(k order by k) from jsonb_object_keys(r -> 0) k)
                     = array['alt_text', 'creative_version_id', 'desktop', 'mobile', 'placement', 'serve_until'], 'delivery exposes only safe fields');
  perform zz_test.ok(r::text not like '%example.invalid%' and r::text not like '%ZZTEST Owner%' and r::text not like '%' || b1 || '%', 'no contact/advertiser/booking data in delivery');
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-middle') = '[]'::jsonb, 'other placements unaffected');

  -- ── Delivery window = booked London dates only ─────────────────────
  perform zz_test.as_postgres();
  update public.ad_bookings set start_date = today - 2, end_date = today - 1 where id = b1;
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'ended booking not delivered (expiry)');
  update public.ad_bookings set start_date = today + 1, end_date = today + 2 where id = b1;
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'future booking not delivered yet');
  update public.ad_bookings set start_date = today, end_date = today + 2 where id = b1;
  perform zz_test.ok(jsonb_array_length(public.ad_public_delivery('wordpress-home-top')) = 1, 'restored window delivers');
  perform zz_test.ok((public.ad_public_delivery('wordpress-home-top') -> 0 ->> 'serve_until')::timestamptz = ads_internal.london_day_start(today + 3), 'serve_until is exclusive London midnight after end date');
  update public.ad_settings set bool_value = false where key = 'ads_delivery_enabled';
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'delivery kill switch');
  update public.ad_settings set bool_value = true where key = 'ads_delivery_enabled';

  -- ── Immutability ───────────────────────────────────────────────────
  perform zz_test.expect_error(format($q$update public.ad_creative_versions set destination_url = 'https://evil.example' where id = %L$q$, v1), '%ADS_IMMUTABLE%', 'approved version content immutable (even for owner role)');
  perform zz_test.expect_error(format($q$update public.ad_purchase_snapshots set total_pence = 1 where booking_id = %L$q$, b1), '%ADS_IMMUTABLE%', 'snapshot immutable');
  perform zz_test.expect_error('delete from public.ad_audit_log', '%ADS_IMMUTABLE%', 'audit log append-only');

  -- ── Creative replacement requires fresh review ─────────────────────
  t := adv_owner || '/' || c1 || '/' || gen_random_uuid() || '-desktop.webp';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  perform zz_test.as_service();
  v2 := public.ad_submit_creative_version(u_owner, c1, dsk || jsonb_build_object('path', t, 'mime', 'image/webp'), mob, 'https://example.org/new', 'ZZTEST banner v2');
  perform zz_test.ok((select review_status from public.ad_campaigns where id = c1) = 'under_review', 'replacement goes back to review');
  perform zz_test.ok((select review_clock_started_at is not null from public.ad_creative_versions where id = v2), 'replacement on paid booking starts its own clock');
  r := public.ad_public_delivery('wordpress-home-top');
  perform zz_test.ok((r -> 0 ->> 'creative_version_id')::uuid = v1, 'unreviewed replacement never served; prior approved keeps serving');
  perform zz_test.as_user(u_admin);
  perform zz_test.expect_error(format($q$select public.ad_admin_review(%L, 'approve')$q$, v1), '%ADS_STALE_VERSION%', 'old version cannot be re-reviewed');
  perform public.ad_admin_review(v2, 'approve');
  r := public.ad_public_delivery('wordpress-home-top');
  perform zz_test.ok((r -> 0 ->> 'creative_version_id')::uuid = v2, 'approved replacement served');
  perform zz_test.ok((select status from public.ad_creative_versions where id = v1) = 'superseded', 'old approved version superseded');

  -- A rejected replacement never serves and has no redirect destination.
  perform zz_test.as_postgres();
  t := adv_owner || '/' || c1 || '/' || gen_random_uuid() || '-desktop.jpg';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  perform zz_test.as_service();
  v3 := public.ad_submit_creative_version(u_owner, c1, dsk || jsonb_build_object('path', t, 'mime', 'image/jpeg'), mob, 'https://never-approved.example.net/', 'ZZTEST v3');
  r := public.ad_serving_lookup(v3, 'wordpress-home-top');
  perform zz_test.ok(not (r ->> 'approved')::boolean and r ->> 'destination_url' is null, 'draft has no click destination');
  perform zz_test.as_user(u_admin);
  perform public.ad_admin_review(v3, 'reject', 'Artwork text unreadable');
  perform zz_test.as_service();
  r := public.ad_serving_lookup(v3, 'wordpress-home-top');
  perform zz_test.ok(r ->> 'destination_url' is null and not (r ->> 'eligible')::boolean, 'rejected version never redirects/serves');
  r := public.ad_serving_lookup(v1, 'wordpress-home-top');
  perform zz_test.ok((r ->> 'approved')::boolean and not (r ->> 'eligible')::boolean and r ->> 'destination_url' = 'https://example.com/landing?utm_source=msm', 'previously approved version still redirects but is not eligible');
  r := public.ad_serving_lookup(v2, 'wordpress-home-top');
  perform zz_test.ok((r ->> 'eligible')::boolean and r ->> 'desktop_object_path' like '%-desktop.webp', 'current approved version eligible');
  perform zz_test.ok((public.ad_public_delivery('wordpress-home-top') -> 0 ->> 'creative_version_id')::uuid = v2, 'rejection of v3 keeps approved v2 live');
  perform zz_test.as_user(u_owner);
  perform zz_test.ok((select rejection_reason from public.ad_creative_versions where id = v3) = 'Artwork text unreadable', 'advertiser sees rejection reason');

  -- ── Pause ──────────────────────────────────────────────────────────
  perform zz_test.as_user(u_admin);
  perform public.ad_admin_set_paused(c1, true, 'ZZTEST pause');
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'paused campaign not delivered');
  perform public.ad_admin_set_paused(c1, false);

  -- ── Metrics: eligibility, dedupe, rate limits ──────────────────────
  perform zz_test.as_service();
  perform zz_test.ok(public.ad_record_metric('impression', v2, 'wordpress-home-top', ck1) = 'counted', 'impression counted');
  perform zz_test.ok(public.ad_record_metric('impression', v2, 'wordpress-home-top', ck1) = 'duplicate', 'impression deduped');
  perform zz_test.ok(public.ad_record_metric('impression', v2, 'wordpress-home-top', ck2) = 'counted', 'distinct client counted');
  perform zz_test.ok(public.ad_record_metric('click', v2, 'wordpress-home-top', ck1) = 'counted', 'click counted');
  perform zz_test.ok(public.ad_record_metric('click', v2, 'wordpress-home-top', ck1) = 'duplicate', 'click deduped');
  perform zz_test.ok(public.ad_record_metric('impression', v1, 'wordpress-home-top', ck1) = 'not_eligible', 'superseded version not attributable');
  perform zz_test.ok(public.ad_record_metric('impression', v3, 'wordpress-home-top', ck1) = 'not_eligible', 'rejected version not attributable');
  perform zz_test.ok(public.ad_record_metric('impression', v2, 'wordpress-home-middle', ck1) = 'not_eligible', 'wrong placement not attributable');
  perform zz_test.ok(public.ad_record_metric('impression', v2, 'wordpress-home-top', 'not-a-hash') = 'rejected_client', 'raw client identifiers refused');
  for n in 1..125 loop t := public.ad_record_metric('impression', v2, 'wordpress-home-top', repeat('c', 64)); end loop;
  perform zz_test.ok(t = 'rate_limited', 'per-client rate limit');
  perform zz_test.ok((select impressions from public.ad_metrics_daily where creative_version_id = v2) = 3, 'aggregate impressions = 3 (2 clients + 1 rate-limited client)');

  -- ── Reports ────────────────────────────────────────────────────────
  perform zz_test.as_user(u_owner);
  r := public.ad_report(b1, today - 10, today + 10);
  perform zz_test.ok((r ->> 'from')::date = today and (r ->> 'to')::date = today + 2, 'report clamped to booked dates');
  perform zz_test.ok(jsonb_array_length(r -> 'rows') = 3 and (r -> 'rows' -> 0 ->> 'impressions')::int = 3 and (r -> 'rows' -> 0 ->> 'clicks')::int = 1, 'report rows');
  perform zz_test.ok(r::text not like '%example.invalid%', 'report has no contact data');
  r := public.ad_report(b1, today + 1, today + 1);
  perform zz_test.ok(jsonb_array_length(r -> 'rows') = 1 and (r -> 'rows' -> 0 ->> 'impressions')::int = 0, 'single-day sub-range');

  -- ── Hold expiry, re-sale and late payment ──────────────────────────
  perform zz_test.as_service();
  perform public.ad_record_checkout_session(b2, 'cs_test_b2a', 5600, 'gbp', false, now() + interval '40 minutes');
  perform zz_test.as_postgres();
  update public.ad_bookings set hold_expires_at = now() - interval '1 minute' where id = b2;  -- time passes
  perform zz_test.as_user(u_third);
  b3 := public.ad_create_hold(p_daily, e + 5, e + 6);
  perform zz_test.as_postgres();
  perform zz_test.ok((select status from public.ad_bookings where id = b2) = 'expired', 'lapsed hold expired on next reservation');
  perform zz_test.as_service();
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b2_late', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b2a', 'payment_intent_id', 'pi_test_b2', 'booking_id', b2, 'payment_status', 'paid',
         'amount_total', 5600, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'payment_conflict_refund_required', 'late payment after resale -> conflict');
  perform zz_test.ok((select status from public.ad_bookings where id = b2) = 'payment_conflict', 'conflict booking does not hold inventory');
  perform zz_test.ok((select requires_refund from public.ad_payments where checkout_session_id = 'cs_test_b2a'), 'refund flagged');
  perform zz_test.ok((select status from public.ad_bookings where id = b3) = 'held', 'resold hold untouched');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b2_refund', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_b2', 'amount_refunded', 5600));
  perform zz_test.ok(r ->> 'outcome' = 'refunded' and (select status from public.ad_bookings where id = b2) = 'refunded', 'manual refund recorded');
  perform zz_test.ok(not (select requires_refund from public.ad_payments where checkout_session_id = 'cs_test_b2a'), 'refund flag cleared');

  -- Dynamic payment methods: delayed-notification methods stay gated.
  -- "unpaid" completion never confirms; async failure never confirms; only
  -- async_payment_succeeded confirms -- and still never approves.
  perform zz_test.as_service();
  perform public.ad_record_checkout_session(b3, 'cs_test_b3a', 2000, 'gbp', false, now() + interval '40 minutes');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b3a_unpaid', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b3a', 'payment_intent_id', 'pi_test_b3a', 'booking_id', b3, 'payment_status', 'unpaid', 'amount_total', 2000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'awaiting_async_payment', 'unpaid (delayed method) completion recorded as awaiting');
  perform zz_test.ok((select status from public.ad_bookings where id = b3) = 'held'
                     and (select status from public.ad_payments where checkout_session_id = 'cs_test_b3a') = 'open', 'unpaid completion does not confirm or mark paid');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b3a_failed', 'type', 'checkout.session.async_payment_failed', 'livemode', false,
         'session_id', 'cs_test_b3a', 'booking_id', b3));
  perform zz_test.ok(r ->> 'outcome' = 'session_closed' and (select status from public.ad_payments where checkout_session_id = 'cs_test_b3a') = 'failed'
                     and (select status from public.ad_bookings where id = b3) = 'held', 'async failure closes payment, booking stays unpaid');
  perform public.ad_record_checkout_session(b3, 'cs_test_b3b', 2000, 'gbp', false, now() + interval '40 minutes');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b3b_unpaid', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b3b', 'payment_intent_id', 'pi_test_b3b', 'booking_id', b3, 'payment_status', 'unpaid', 'amount_total', 2000, 'currency', 'gbp'));
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b3b_succeeded', 'type', 'checkout.session.async_payment_succeeded', 'livemode', false,
         'session_id', 'cs_test_b3b', 'payment_intent_id', 'pi_test_b3b', 'booking_id', b3, 'payment_status', 'paid', 'amount_total', 2000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'confirmed' and (select status from public.ad_bookings where id = b3) = 'confirmed', 'async success confirms');
  perform zz_test.ok((select approved_version_id is null and review_status = 'awaiting_creative' from public.ad_campaigns where booking_id = b3), 'async success never approves');
  perform zz_test.as_postgres();

  -- Late payment where capacity is still free -> confirmed_late.
  perform zz_test.as_user(u_other);
  b4 := public.ad_create_hold(p_daily, e + 20, e + 20);
  select id into c4 from public.ad_campaigns where booking_id = b4;
  perform zz_test.as_postgres();
  update public.ad_bookings set hold_expires_at = now() - interval '5 minutes' where id = b4;
  perform zz_test.as_service();
  -- Session row never recorded (server crashed after Stripe created it):
  -- recreated from the snapshot, never from the event amount.
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b4', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b4a', 'payment_intent_id', 'pi_test_b4', 'booking_id', b4, 'payment_status', 'paid',
         'amount_total', 1000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'confirmed_late' and (select status from public.ad_bookings where id = b4) = 'confirmed', 'late payment with free capacity confirmed');
  perform zz_test.ok((select review_status from public.ad_campaigns where id = c4) = 'awaiting_creative', 'paid without creative: awaiting creative, no clock');

  -- Refund arrives before we know the payment intent -> retry later, nothing stored.
  perform zz_test.expect_error($q$select public.ad_apply_stripe_event('{"id":"evt_early_refund","type":"charge.refunded","livemode":false,"payment_intent_id":"pi_unknown","amount_refunded":100}')$q$, '%ADS_RETRY_LATER%', 'unknown-PI refund deferred');
  perform zz_test.ok((select count(*) from public.ad_payment_events where provider_event_id = 'evt_early_refund') = 0, 'deferred event not marked processed');

  -- Second payment for an already-confirmed booking -> refund required.
  perform public.ad_record_checkout_session(b1, 'cs_test_b1b', 3000, 'gbp', false, now() + interval '40 minutes');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b1_double', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b1b', 'payment_intent_id', 'pi_test_b1b', 'booking_id', b1, 'payment_status', 'paid',
         'amount_total', 3000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'unexpected_payment_refund_required', 'double payment flagged');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b1_double_refund', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_b1b', 'amount_refunded', 3000));
  perform zz_test.ok((select status from public.ad_bookings where id = b1) = 'confirmed', 'refunding the duplicate keeps the original booking live');
  perform zz_test.ok(r ->> 'outcome' = 'non_funding_payment_refunded', 'duplicate refund recognised as non-funding');
  perform zz_test.as_postgres();
  perform zz_test.ok(ads_internal.booking_funded(b1), 'booking still funded by payment A after duplicate B refunded');
  perform zz_test.ok((select funding_payment_id from public.ad_bookings where id = b1) = (select id from public.ad_payments where checkout_session_id = 'cs_test_b1a'), 'funding payment is A, never the duplicate');

  -- Replacement artwork can still be approved after the duplicate refund.
  t := adv_owner || '/' || c1 || '/' || gen_random_uuid() || '-desktop.png';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  perform zz_test.as_service();
  v4 := public.ad_submit_creative_version(u_owner, c1, dsk || jsonb_build_object('path', t), mob, 'https://example.org/v4', 'ZZTEST v4');
  perform zz_test.as_user(u_admin);
  perform public.ad_admin_review(v4, 'approve');
  perform zz_test.ok((public.ad_public_delivery('wordpress-home-top') -> 0 ->> 'creative_version_id')::uuid = v4, 'replacement approved + delivered after duplicate refund');

  -- Original (first) approval also succeeds after a refunded duplicate.
  perform zz_test.as_user(u_owner);
  b5 := public.ad_create_hold(p_daily, e + 25, e + 25);
  select id into c5 from public.ad_campaigns where booking_id = b5;
  perform zz_test.as_service();
  perform public.ad_record_checkout_session(b5, 'cs_test_b5a', 1000, 'gbp', false, now() + interval '40 minutes');
  perform public.ad_record_checkout_session(b5, 'cs_test_b5b', 1000, 'gbp', false, now() + interval '40 minutes');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b5a', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b5a', 'payment_intent_id', 'pi_test_b5a', 'booking_id', b5, 'payment_status', 'paid', 'amount_total', 1000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'confirmed', 'b5 payment A confirms');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b5b', 'type', 'checkout.session.completed', 'livemode', false,
         'session_id', 'cs_test_b5b', 'payment_intent_id', 'pi_test_b5b', 'booking_id', b5, 'payment_status', 'paid', 'amount_total', 1000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'unexpected_payment_refund_required', 'b5 duplicate B flagged');
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b5b_refund', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_b5b', 'amount_refunded', 1000));
  perform zz_test.as_postgres();
  t := adv_owner || '/' || c5 || '/' || gen_random_uuid() || '-desktop.png';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  dsk := dsk || jsonb_build_object('path', t);
  t := adv_owner || '/' || c5 || '/' || gen_random_uuid() || '-mobile.png';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  perform zz_test.as_service();
  v5 := public.ad_submit_creative_version(u_owner, c5, dsk, mob || jsonb_build_object('path', t), 'https://example.org/b5', 'ZZTEST b5');
  perform zz_test.as_user(u_admin);
  perform public.ad_admin_review(v5, 'approve');
  perform zz_test.ok((select approved_version_id from public.ad_campaigns where id = c5) = v5, 'original approval succeeds after duplicate refunded');
  -- Refunding the FUNDING payment of b5 closes it; nothing further can be approved.
  perform zz_test.as_service();
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b5a_refund', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_b5a', 'amount_refunded', 1000));
  perform zz_test.as_postgres();
  perform zz_test.ok(r ->> 'outcome' = 'refunded' and (select status from public.ad_bookings where id = b5) = 'refunded' and not ads_internal.booking_funded(b5), 'funding refund closes b5');
  perform zz_test.as_service();
  perform zz_test.expect_error(format($q$select public.ad_submit_creative_version(%L, %L, %L, %L, 'https://example.org/b5x', 'ZZTEST b5x')$q$, u_owner, c5, dsk, mob || jsonb_build_object('path', t)), '%ADS_INVALID_STATE%', 'no new artwork on refunded booking');

  -- Partial refund flags, full refund stops delivery.
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b1_partial', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_b1', 'amount_refunded', 1000));
  perform zz_test.ok(r ->> 'outcome' = 'partially_refunded_flagged' and (select status from public.ad_bookings where id = b1) = 'confirmed', 'partial refund flagged');
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'partial refund of FUNDING payment stops delivery (no unfunded delivery)');
  perform zz_test.as_postgres();
  t := adv_owner || '/' || c1 || '/' || gen_random_uuid() || '-desktop.png';
  insert into storage.objects (bucket_id, name, owner) values ('ad-creatives-private', t, u_owner);
  perform zz_test.as_service();
  v6 := public.ad_submit_creative_version(u_owner, c1, dsk || jsonb_build_object('path', t), mob, 'https://example.org/v6', 'ZZTEST v6');
  perform zz_test.as_user(u_admin);
  perform zz_test.expect_error(format($q$select public.ad_admin_review(%L, 'approve')$q$, v6), '%ADS_NOT_FUNDED%', 'partially refunded funding payment blocks approval');
  perform zz_test.as_service();
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b1_full', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_b1', 'amount_refunded', 3000));
  perform zz_test.ok((select status from public.ad_bookings where id = b1) = 'refunded', 'full refund closes booking');
  perform zz_test.ok(public.ad_public_delivery('wordpress-home-top') = '[]'::jsonb, 'refunded booking stops delivering');
  perform zz_test.as_user(u_admin);
  perform zz_test.expect_error(format($q$select public.ad_admin_review(%L, 'approve')$q$, v6), '%ADS_NOT_PAID%', 'refunded booking cannot be approved');
  perform zz_test.as_service();
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_b1_completed_after_refund', 'type', 'checkout.session.async_payment_succeeded', 'livemode', false,
         'session_id', 'cs_test_b1a', 'booking_id', b1, 'payment_status', 'paid', 'amount_total', 3000, 'currency', 'gbp'));
  perform zz_test.ok(r ->> 'outcome' = 'ignored_already_refunded' and (select status from public.ad_bookings where id = b1) = 'refunded', 'success after refund cannot resurrect');
  perform zz_test.ok(public.ad_apply_stripe_event('{"id":"evt_other","type":"customer.created","livemode":false}') ->> 'outcome' = 'ignored_type', 'other types ignored');

  -- ── Working days, DST, holidays (Europe/London) ────────────────────
  perform zz_test.as_postgres();
  perform zz_test.ok(ads_internal.london_day_start('2026-03-29') = '2026-03-29 00:00:00+00', 'GMT midnight before spring-forward');
  perform zz_test.ok(ads_internal.london_day_start('2026-03-30') = '2026-03-29 23:00:00+00', 'BST midnight after spring-forward');
  perform zz_test.ok(ads_internal.london_day_start('2026-10-26') - ads_internal.london_day_start('2026-10-25') = interval '25 hours', 'autumn DST day is 25h');
  perform zz_test.ok(ads_internal.london_day_start('2026-03-30') - ads_internal.london_day_start('2026-03-29') = interval '23 hours', 'spring DST day is 23h');
  perform zz_test.ok(ads_internal.review_due_before('2026-10-15 09:00:00+01') = '2026-10-16 23:00:00+00', 'Thu -> end of Fri (BST)');
  perform zz_test.ok(ads_internal.review_due_before('2026-10-16 18:00:00+01') = '2026-10-19 23:00:00+00', 'Fri -> end of Mon');
  perform zz_test.ok(ads_internal.review_due_before('2026-10-15 23:30:00+00') = '2026-10-19 23:00:00+00', '23:30 UTC Thu is Fri in London -> end of Mon');
  perform zz_test.ok(ads_internal.review_due_before('2026-10-24 12:00:00+01') = '2026-10-27 00:00:00+00', 'Sat -> end of Mon across DST change (GMT)');
  perform zz_test.ok(ads_internal.review_due_before('2026-04-02 10:00:00+01') = '2026-04-07 23:00:00+00', 'Easter: Good Friday + Easter Monday skipped');
  perform zz_test.ok(ads_internal.review_due_before('2026-12-24 10:00:00+00') = '2026-12-30 00:00:00+00', 'Christmas + substitute Boxing Day skipped');
  -- STANDARD earliest start = day after the end of the next UK working day.
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-16 17:00:00+01') = '2026-10-20', 'Fri 17:00 ready -> Tue earliest');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-17 12:00:00+01') = '2026-10-20', 'Sat ready -> Tue earliest');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-18 12:00:00+01') = '2026-10-20', 'Sun ready -> Tue earliest');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-19 09:00:00+01') = '2026-10-21', 'Mon ready -> Wed earliest');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-15 09:00:00+01') = '2026-10-17', 'Thu ready -> Sat earliest (adverts may start at weekends)');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-15 22:59:59+00') = '2026-10-17', '23:59:59 BST Thu is still Thursday');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-15 23:00:00+00') = '2026-10-20', '00:00 BST Fri (23:00 UTC Thu) is Friday -> Tue');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-12-03 23:59:59+00') = '2026-12-05', 'GMT: last second of Thu -> Sat');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-12-04 00:00:00+00') = '2026-12-08', 'GMT: first second of Fri -> Tue');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-23 17:00:00+01') = '2026-10-27', 'Fri before autumn clock change -> Tue');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-03-27 17:00:00+00') = '2026-03-31', 'Fri before spring clock change -> Tue');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-04-02 10:00:00+01') = '2026-04-08', 'Thu before Easter: Good Fri + Easter Mon skipped -> Wed');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-08-28 17:00:00+01') = '2026-09-02', 'Fri before summer bank holiday -> Wed');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-12-24 10:00:00+00') = '2026-12-30', 'Christmas Eve: 25th + substitute 28th skipped -> Wed 30th');
  update public.ad_settings set int_value = 10 where key = 'min_lead_days';
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-16 17:00:00+01') = '2026-10-26', 'optional min_lead_days floor applies when later');
  update public.ad_settings set int_value = 0 where key = 'min_lead_days';
  insert into public.ad_uk_holidays values ('2026-10-16', 'ZZTEST configurable holiday');
  perform zz_test.ok(ads_internal.review_due_before('2026-10-15 09:00:00+01') = '2026-10-19 23:00:00+00', 'admin-configured holiday respected');
  perform zz_test.ok(ads_internal.earliest_standard_start('2026-10-15 09:00:00+01') = '2026-10-20', 'configured holiday also moves earliest start (Thu -> Tue)');

  raise notice 'ads phase1 regression: ALL CHECKS PASSED';
end $$;

rollback;
