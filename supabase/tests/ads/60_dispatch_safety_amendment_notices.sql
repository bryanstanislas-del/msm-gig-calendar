-- LOCAL/DISPOSABLE DB ONLY. Outbox dispatch safety (lost acknowledgements,
-- worker crash / lease expiry, recovery beyond the provider idempotency
-- window, changed recipient/content) and amendment notifications + review
-- fixes (migration 20261017090000). No provider is called. Rolled back.
-- Signal: "ads dispatch safety + amendment notices: ALL CHECKS PASSED".
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
-- Synthetic outbox row (as postgres) for dispatch-safety cases.
create function zz.row(p_tag text) returns uuid language plpgsql security definer as $$
declare i uuid; begin
  insert into public.ad_notification_outbox (kind, dedupe_key, recipient_role, recipient_email, payload, next_attempt_at, created_at)
  values ('booking_confirmation', 'zz:' || p_tag, 'advertiser', 'zz-' || p_tag || '@example.invalid', jsonb_build_object('tag', p_tag),
          'infinity', ads_internal.clock_now()) returning id into i;     -- not due until a scenario makes it due
  return i; end $$;
create function zz.due(p_id uuid) returns void language sql security definer as $$
  update public.ad_notification_outbox set next_attempt_at = least(next_attempt_at, ads_internal.clock_now()) where id = p_id and status = 'pending' $$;
create function zz.claim_one(p_id uuid) returns jsonb language plpgsql as $$
declare c jsonb; begin
  perform zz.due(p_id);
  perform zz.as_service();
  select x into c from jsonb_array_elements(public.ad_notify_claim(50, 300)) x where (x ->> 'id')::uuid = p_id;
  return c; end $$;
create function zz.o(p_id uuid) returns public.ad_notification_outbox language sql security definer as $$
  select * from public.ad_notification_outbox where id = p_id $$;
grant execute on all functions in schema zz to anon, authenticated, service_role;

do $$
declare
  u_owner uuid; u_other uuid; u_admin uuid; p_daily uuid; e date; s0 date;
  H text := repeat('ab', 32); H2 text := repeat('cd', 32); T0 timestamptz := '2026-11-02 09:00+00';
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; c jsonb; i int; t text; o public.ad_notification_outbox;
  bA uuid; bF uuid; bP uuid; bR uuid; bX uuid; bS uuid; bQ uuid; am uuid; am2 uuid; st timestamptz; v uuid; j jsonb;
begin
  insert into auth.users (email) values ('zz-owner@example.invalid') returning id into u_owner;
  insert into auth.users (email) values ('zz-other@example.invalid') returning id into u_other;
  insert into auth.users (email) values ('zz-admin@example.invalid') returning id into u_admin;
  insert into public.user_roles (user_id, role) values (u_admin, 'admin');
  update public.ad_settings set bool_value = true where key in ('ads_portal_enabled', 'ads_checkout_enabled', 'ads_delivery_enabled', 'ads_email_enabled', 'ads_amendments_enabled');
  update public.ad_settings set int_value = 1440 where key = 'amendment_offer_minutes';
  update public.ad_settings set int_value = 20 where key = 'max_active_holds_per_advertiser';
  update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
  update public.ad_products set active = true;
  select id into p_daily from public.ad_products where code = 'TEST-wp-home-top-daily';

  -- ════ Part 1: dispatch safety ════════════════════════════════════════
  perform zz.as_pg(); perform zz.at(T0);
  r1 := zz.row('lost-ack'); r2 := zz.row('crash-before'); r3 := zz.row('changed-to'); r4 := zz.row('changed-content');
  r5 := zz.row('beyond-window'); r6 := zz.row('cap-never'); r7 := zz.row('cap-dispatched'); r8 := zz.row('failed-late');

  -- Lost acknowledgement: provider called, result never recorded (worker crash).
  c := zz.claim_one(r1);
  perform zz.ok((c ->> 'attempt')::int = 1 and c ->> 'idempotency_key' = 'msm-ads-notify-' || r1 || '-g1', 'claimed with generation-1 key');
  perform zz.ok(public.ad_notify_begin_dispatch(r1, 1, 'zz-lost-ack@example.invalid', H) = 'proceed', 'first dispatch recorded before the provider call');
  perform zz.ok(public.ad_notify_begin_dispatch(r1, 0, 'zz-lost-ack@example.invalid', H) = 'stale', 'wrong attempt is stale');
  perform zz.err(format($q$select public.ad_notify_begin_dispatch(%L, 1, 'zz-lost-ack@example.invalid', 'nothex')$q$, r1), '%ADS_BAD_REQUEST%', 'content hash validated');
  perform zz.as_pg(); perform zz.at(T0 + interval '6 minutes');                -- lease (300 s) expired
  c := zz.claim_one(r1);
  perform zz.ok((c ->> 'attempt')::int = 2 and c ->> 'idempotency_key' = 'msm-ads-notify-' || r1 || '-g1'
                and c ->> 'dispatch_recipient' = 'zz-lost-ack@example.invalid' and c ->> 'dispatch_content_sha256' = H,
                'reclaimed inside the window with the SAME key and the frozen identity');
  perform zz.ok(public.ad_notify_begin_dispatch(r1, 2, 'zz-lost-ack@example.invalid', H) = 'proceed', 'identical retry inside the window (provider dedupes)');
  perform zz.ok(zz.claim_one(r1) is null, 'not claimed twice while leased');
  perform zz.ok(public.ad_notify_result(r1, 1, 'accepted', 're_msg_old_1', null) = 'stale', 'crashed worker''s late acknowledgement ignored');
  perform zz.ok(public.ad_notify_result(r1, 2, 'accepted', 're_msg_lost_ack', null) = 'accepted', 'accepted once');
  perform zz.as_pg();
  perform zz.ok((select count(*) from public.ad_notification_events where outbox_id = r1 and event in ('lease_expired', 'dispatch_started', 'dispatch_retry')) = 3, 'history shows the crash and the retry');
  perform zz.err(format($q$update public.ad_notification_outbox set dispatch_recipient = 'other@example.invalid' where id = %L$q$, r1), '%ADS_IMMUTABLE%', 'dispatch identity frozen');
  perform zz.err(format($q$update public.ad_notification_outbox set payload = '{}' where id = %L$q$, r1), '%ADS_IMMUTABLE%', 'payload frozen');
  perform zz.err(format($q$update public.ad_notification_outbox set recipient_email = 'other@example.invalid' where id = %L$q$, r1), '%ADS_IMMUTABLE%', 'recipient frozen');

  -- Crash BEFORE any provider call: safe to retry; dispatch time = real first dispatch.
  perform zz.as_pg(); perform zz.at(T0);
  c := zz.claim_one(r2);
  perform zz.as_pg(); perform zz.at(T0 + interval '6 minutes');
  c := zz.claim_one(r2);
  perform zz.ok((c ->> 'attempt')::int = 2 and c ->> 'dispatch_recipient' is null, 'never dispatched: reclaimed with no identity');
  perform zz.ok(public.ad_notify_begin_dispatch(r2, 2, 'zz-crash-before@example.invalid', H) = 'proceed', 'first dispatch on attempt 2');
  perform zz.as_pg();
  perform zz.ok((zz.o(r2)).first_dispatched_at = T0 + interval '6 minutes', 'window starts at the real first dispatch');
  perform zz.as_service();
  perform zz.err(format($q$select public.ad_notify_result(%L, 2, 'accepted', null, null)$q$, r2), '%ADS_BAD_REQUEST%', 'acceptance needs the provider id');
  perform zz.ok(public.ad_notify_result(r2, 2, 'accepted', 're_msg_crash_b', null) = 'accepted', 'accepted after the crash-before-dispatch retry');

  -- Changed recipient (e.g. ADS_ADMIN_ALERT_EMAIL edited) or changed content (template/sender/payload) after dispatch.
  perform zz.as_pg(); perform zz.at(T0);
  c := zz.claim_one(r3); perform public.ad_notify_begin_dispatch(r3, 1, 'alerts-old@example.invalid', H);
  c := zz.claim_one(r4); perform public.ad_notify_begin_dispatch(r4, 1, 'zz-changed-content@example.invalid', H);
  perform zz.as_pg(); perform zz.at(T0 + interval '6 minutes');
  c := zz.claim_one(r3);
  perform zz.ok(public.ad_notify_begin_dispatch(r3, 2, 'alerts-new@example.invalid', H) = 'blocked', 'changed recipient never sent under the old key');
  c := zz.claim_one(r4);
  perform zz.ok(public.ad_notify_begin_dispatch(r4, 2, 'zz-changed-content@example.invalid', H2) = 'blocked', 'changed content never sent under the old key');
  perform zz.as_pg();
  perform zz.ok((zz.o(r3)).status = 'needs_reconciliation' and (zz.o(r3)).reconciliation_reason like 'recipient or content changed%'
                and (zz.o(r4)).status = 'needs_reconciliation', 'both need manual reconciliation');

  -- Recovery beyond the provider idempotency window (24 h; we stop at 23 h).
  perform zz.at(T0);
  c := zz.claim_one(r5); perform public.ad_notify_begin_dispatch(r5, 1, 'zz-beyond-window@example.invalid', H);
  perform zz.ok(public.ad_notify_result(r5, 1, 'retryable_error', null, 'network: timeout after 10000 ms') = 'retry_scheduled', 'timeout -> retry (outcome unknown)');
  perform zz.as_pg(); perform zz.at(T0 + interval '23 hours');
  perform zz.ok(zz.claim_one(r5) is null, 'no provider call 23 h after first dispatch');
  perform zz.as_pg();
  perform zz.ok((zz.o(r5)).status = 'needs_reconciliation' and (zz.o(r5)).reconciliation_reason like '%idempotency window%', 'parked for reconciliation, not re-sent');
  -- An expired lease 30 h later is never blindly reclaimed either.
  perform zz.at(T0);
  r5 := zz.row('lease-30h');
  c := zz.claim_one(r5); perform public.ad_notify_begin_dispatch(r5, 1, 'zz-lease-30h@example.invalid', H);
  perform zz.as_pg(); perform zz.at(T0 + interval '30 hours');
  perform zz.ok(zz.claim_one(r5) is null and (zz.o(r5)).status = 'needs_reconciliation', 'stale lease after 30 h -> reconciliation');
  -- A retry that would only happen after the window is not scheduled.
  perform zz.at(T0);
  r5 := zz.row('late-retry');
  c := zz.claim_one(r5); perform public.ad_notify_begin_dispatch(r5, 1, 'zz-late-retry@example.invalid', H);
  perform zz.as_pg(); perform zz.at(T0 + interval '22 hours 58 minutes');
  perform zz.as_service();
  perform zz.ok(public.ad_notify_result(r5, 1, 'retryable_error', null, 'HTTP 503') = 'needs_reconciliation', 'retry past the window -> reconciliation instead');

  -- Attempt cap: expired leases cannot bypass it.
  perform zz.as_pg(); perform zz.at(T0); perform zz.due(r6); perform zz.due(r7);
  for i in 1..6 loop
    perform zz.as_pg(); perform zz.at(T0 + make_interval(mins => 6 * i));
    perform zz.as_service();
    c := public.ad_notify_claim(50, 300);                        -- r6: crash before the provider each time; r7: crash after it
    select x into j from jsonb_array_elements(c) x where (x ->> 'id')::uuid = r7;
    perform zz.ok(j is not null and exists (select 1 from jsonb_array_elements(c) x where (x ->> 'id')::uuid = r6), 'attempt ' || i || ' claimed');
    perform public.ad_notify_begin_dispatch(r7, (j ->> 'attempt')::int, 'zz-cap-dispatched@example.invalid', H);
  end loop;
  perform zz.as_pg();
  perform zz.ok((zz.o(r6)).attempts = 6 and (zz.o(r7)).attempts = 6, 'six attempts each');
  perform zz.at(T0 + interval '60 minutes');
  perform zz.as_service();
  perform zz.ok(not exists (select 1 from jsonb_array_elements(public.ad_notify_claim(50, 300)) x where (x ->> 'id')::uuid in (r6, r7)), 'no seventh attempt via an expired lease');
  perform zz.as_pg();
  perform zz.ok((zz.o(r6)).status = 'dead' and (zz.o(r7)).status = 'needs_reconciliation', 'never dispatched -> dead; possibly sent -> reconciliation');

  -- Admin retry is refused where a re-send could duplicate.
  perform zz.as_user(u_admin);
  perform public.ad_admin_retry_notification(r6, 'Never reached the provider');
  perform zz.as_pg();
  perform zz.ok((zz.o(r6)).status = 'pending' and (zz.o(r6)).attempts = 0, 'never-dispatched dead row can be retried');
  perform zz.at(T0);
  c := zz.claim_one(r8); perform public.ad_notify_begin_dispatch(r8, 1, 'zz-failed-late@example.invalid', H);
  perform public.ad_notify_result(r8, 1, 'permanent_error', null, 'HTTP 422 validation_error');
  perform zz.as_pg(); perform zz.at(T0 + interval '25 hours');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_retry_notification(%L, 'Try again later')$q$, r8), '%ADS_RECONCILE_FIRST%', 'retry beyond the window refused');
  perform zz.err(format($q$select public.ad_admin_retry_notification(%L, 'Try again')$q$, r7), '%ADS_INVALID_STATE%', 'reconciliation rows are not blindly retried');

  -- Manual reconciliation.
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_admin_reconcile_notification(%L, 'confirmed_not_sent', null, 'Checked Resend dashboard')$q$, r7), '%ADS_FORBIDDEN%', 'advertiser cannot reconcile');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_reconcile_notification(%L, 'confirmed_not_sent', null, 'short')$q$, r7), '%ADS_REASON_REQUIRED%', 'evidence note required');
  perform public.ad_admin_reconcile_notification(r7, 'confirmed_not_sent', null, 'Resend dashboard: no message for this recipient');
  perform public.ad_admin_reconcile_notification(r3, 'confirmed_sent', 're_msg_found_in_dash', 'Resend dashboard shows delivered to old address');
  perform public.ad_admin_cancel_notification(r4, 'Superseded by a corrected template');
  perform zz.as_pg();
  perform zz.ok((zz.o(r7)).status = 'pending' and (zz.o(r7)).dispatch_generation = 2 and (zz.o(r7)).first_dispatched_at is null, 'not sent -> new generation');
  perform zz.ok((zz.o(r3)).status = 'accepted' and (zz.o(r3)).provider_message_id = 're_msg_found_in_dash', 'sent -> recorded, never re-sent');
  perform zz.ok((zz.o(r4)).status = 'cancelled', 'reconciliation row can be cancelled');
  perform zz.at(T0 + interval '26 hours');
  c := zz.claim_one(r7);
  perform zz.ok(c ->> 'idempotency_key' = 'msm-ads-notify-' || r7 || '-g2' and (c ->> 'attempt')::int = 1, 'new generation uses a new key');

  -- ════ Part 2: amendment notifications + review fixes ════════════════
  perform zz.as_pg(); perform zz.at(now());
  e := ads_internal.earliest_standard_start(now());
  s0 := e + 10;
  perform zz.as_user(u_owner);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ <Owner>', 'zz-owner@example.invalid');
  bA := public.ad_create_hold(p_daily, s0, s0 + 1);
  bP := public.ad_create_hold(p_daily, s0 + 5, s0 + 5);
  bR := public.ad_create_hold(p_daily, s0 + 8, s0 + 8);
  bX := public.ad_create_hold(p_daily, s0 + 11, s0 + 11);
  bS := public.ad_create_hold(p_daily, s0 + 14, s0 + 14);
  bQ := public.ad_create_hold(p_daily, s0 + 17, s0 + 17);
  perform zz.as_user(u_other);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ Other', 'zz-other@example.invalid');
  bF := public.ad_create_hold(p_daily, s0 + 2, s0 + 2);
  perform zz.as_pg();
  perform zz.pay(bA, 'n1'); perform zz.pay(bP, 'n2'); perform zz.pay(bR, 'n3'); perform zz.pay(bX, 'n4'); perform zz.pay(bS, 'n5'); perform zz.pay(bQ, 'n6'); perform zz.pay(bF, 'n7');

  -- Proposed -> accepted (owner recipient, persisted intervals, durable dedupe).
  st := zz.st(bA);
  perform zz.approve_at(u_admin, u_owner, bA, st + interval '10 hours 17 minutes');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bA, 'Internal: approved late because of reviewer rota');
  perform zz.as_pg();
  perform zz.ok((select recipient_email = 'zz-owner@example.invalid' and recipient_role = 'advertiser' and amendment_id = am
                 and (payload ->> 'proposed_from')::timestamptz = st + interval '11 hours' and (payload ->> 'proposed_until')::timestamptz = zz.st(bF)
                 and (payload ->> 'expires_at')::timestamptz = (select expires_at from public.ad_booking_amendments where id = am)
                 and not (payload ? 'note')
                 from public.ad_notification_outbox where kind = 'amendment_proposed' and amendment_id = am), 'proposal email: owner, exact persisted facts, no internal note');
  perform zz.as_user(u_owner);
  perform public.ad_respond_amendment(am, 'accept');
  perform zz.as_pg();
  perform zz.ok((select count(*) from public.ad_notification_outbox where amendment_id = am) = 2
                and exists (select 1 from public.ad_notification_outbox where dedupe_key = 'amendment_accepted:' || am), 'acceptance email enqueued once');
  perform zz.err(format($q$insert into public.ad_notification_outbox (kind, dedupe_key, recipient_role, recipient_email, payload, next_attempt_at, created_at)
                 values ('amendment_accepted', 'amendment_accepted:%s', 'advertiser', 'x@example.invalid', '{}', now(), now())$q$, am), '%duplicate key%', 'durable dedupe key');

  -- Defect (a): a replacement approved after the accepted amendment emails the AMENDED run.
  v := zz.approve_at(u_admin, u_owner, bA, st + interval '20 hours');
  perform zz.ok((select (payload ->> 'booked_from')::timestamptz = st + interval '11 hours' and (payload ->> 'booked_until')::timestamptz = zz.st(bF)
                 from public.ad_notification_outbox where kind = 'review_outcome' and creative_version_id = v), 'outcome email shows the effective (amended) run');

  -- Rejected / withdrawn / expired / superseded.
  st := zz.st(bP);
  perform zz.approve_at(u_admin, u_owner, bP, st + interval '3 hours');
  perform zz.as_user(u_admin); am := public.ad_admin_propose_amendment(bP, 'Correction delay');
  perform zz.as_user(u_owner); perform public.ad_respond_amendment(am, 'reject');
  perform zz.as_pg();
  perform zz.ok(exists (select 1 from public.ad_notification_outbox where dedupe_key = 'amendment_rejected:' || am), 'rejection email');
  st := zz.st(bR);
  perform zz.approve_at(u_admin, u_owner, bR, st + interval '3 hours');
  perform zz.as_user(u_admin); am := public.ad_admin_propose_amendment(bR, 'Correction delay');
  perform public.ad_admin_withdraw_amendment(am, 'Proposed in error');
  perform zz.as_pg();
  perform zz.ok(exists (select 1 from public.ad_notification_outbox where dedupe_key = 'amendment_withdrawn:' || am), 'withdrawal email');
  st := zz.st(bX);
  perform zz.approve_at(u_admin, u_owner, bX, st + interval '1 hour 30 minutes');
  perform zz.as_user(u_admin); am := public.ad_admin_propose_amendment(bX, 'Correction delay');
  perform zz.as_user(u_owner);
  perform zz.err('select public.ad_expire_amendments()', '%ADS_FORBIDDEN%', 'advertiser cannot run the expiry sweep');
  perform zz.as_pg(); perform zz.at(st + interval '1 hour 30 minutes' + interval '24 hours' - interval '1 second');
  perform zz.as_service();
  perform zz.ok(public.ad_expire_amendments() = 0, 'not expired one second early (configured period unchanged)');
  perform zz.as_pg(); perform zz.at(st + interval '1 hour 30 minutes' + interval '24 hours');
  perform zz.as_service();
  perform zz.ok(public.ad_expire_amendments() = 1 and public.ad_expire_amendments() = 0, 'expired exactly at expires_at, once');
  perform zz.as_pg();
  perform zz.ok((select status from public.ad_booking_amendments where id = am) = 'expired'
                and (select count(*) from public.ad_notification_outbox where dedupe_key = 'amendment_expired:' || am) = 1, 'expiry email once');
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_respond_amendment(%L, 'accept')$q$, am), '%ADS_INVALID_STATE%', 'expired offer cannot be accepted');
  -- Delivery of an amendment email changes nothing about the offer.
  perform zz.as_pg(); perform zz.at(now());
  st := zz.st(bS);
  perform zz.approve_at(u_admin, u_owner, bS, st + interval '2 hours');
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bS, 'First offer');
  am2 := public.ad_admin_propose_amendment(bS, 'Second offer');
  perform zz.as_pg();
  perform zz.ok((select count(*) from public.ad_notification_outbox where booking_id = bS and kind like 'amendment_%') = 2
                and not exists (select 1 from public.ad_notification_outbox where dedupe_key like 'amendment_superseded:%'), 'superseded: covered by the newer proposal email');
  select id into r1 from public.ad_notification_outbox where dedupe_key = 'amendment_proposed:' || am2;
  perform zz.at(st + interval '2 hours 10 minutes');
  c := zz.claim_one(r1);
  perform public.ad_notify_begin_dispatch(r1, 1, 'zz-owner@example.invalid', H);
  perform public.ad_notify_result(r1, 1, 'accepted', 're_msg_amend_1', null);
  perform zz.ok(public.ad_notify_provider_event('svix_amend_0001', 'email.delivered', 're_msg_amend_1', st + interval '2 hours 11 minutes', '{}') = 'delivered', 'delivered');
  perform zz.as_pg();
  perform zz.ok((select status = 'proposed' and expires_at = proposed_at + interval '1440 minutes' from public.ad_booking_amendments where id = am2),
                'delivery neither accepts nor re-times the offer');

  -- Defect (b): the proposal starts after the FIRST approval, not a later replacement approval.
  st := zz.st(bQ);
  perform zz.approve_at(u_admin, u_owner, bQ, st + interval '3 hours');
  perform zz.approve_at(u_admin, u_owner, bQ, st + interval '9 hours');   -- replacement approved later
  perform zz.as_user(u_admin);
  am := public.ad_admin_propose_amendment(bQ, 'Correction delay');
  perform zz.as_pg();
  perform zz.ok((select proposed_from = st + interval '4 hours' from public.ad_booking_amendments where id = am), 'start = next hour after the first approval');

  -- Defect (c): advertisers cannot read internal notes or admin ids; admins can.
  perform zz.as_user(u_owner);
  perform zz.ok((select count(*) from public.ad_booking_amendments where booking_id = bA) = 1, 'owner still reads the offer');
  perform zz.err('select note from public.ad_booking_amendments', '%permission denied%', 'internal note hidden');
  perform zz.err('select proposed_by from public.ad_booking_amendments', '%permission denied%', 'admin id hidden');
  perform zz.err('select decided_by from public.ad_booking_amendments', '%permission denied%', 'decider id hidden');
  perform zz.err('select recorded_by from public.ad_booking_interval_history', '%permission denied%', 'history actor hidden');
  perform zz.ok(public.ad_admin_list_amendments(bA) is null, 'admin list returns nothing to advertisers');
  perform zz.as_user(u_admin);
  perform zz.ok(public.ad_admin_list_amendments(bA) -> 0 ->> 'note' like 'Internal:%', 'admin can read the note');

  raise notice 'ads dispatch safety + amendment notices: ALL CHECKS PASSED';
end $$;
rollback;
