-- LOCAL/DISPOSABLE DB ONLY. Notification outbox (migration 20261016210000):
-- enqueue from persisted facts, disabled-by-default claim, leases, retries,
-- provider events and the correction-notice window. No email is sent: the
-- provider is never called from SQL. Rolled back.
-- Signal: "ads notification outbox: ALL CHECKS PASSED".
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
-- Worker step: record dispatch identity (as the server worker does) then report acceptance.
create function zz.dispatch_accept(p_id uuid, p_attempt int, p_msg text) returns text language plpgsql as $$
declare g text; begin
  g := public.ad_notify_begin_dispatch(p_id, p_attempt, 'zz-recipient@example.invalid', repeat('ab', 32));
  if g <> 'proceed' then return 'gate:' || g; end if;
  return public.ad_notify_result(p_id, p_attempt, 'accepted', p_msg, null); end $$;
grant execute on all functions in schema zz to anon, authenticated, service_role;

do $$
declare
  u_owner uuid; u_admin uuid; p_daily uuid; e date; bp uuid; b2 uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid; rq1 uuid; rq2 uuid; rq3 uuid; rq4 uuid;
  c jsonb; o record; oc uuid; oa uuid; oq uuid; n int; i int; t text;
begin
  insert into auth.users (email) values ('zz-owner@example.invalid') returning id into u_owner;
  insert into auth.users (email) values ('zz-admin@example.invalid') returning id into u_admin;
  insert into public.user_roles (user_id, role) values (u_admin, 'admin');
  update public.ad_settings set bool_value = true where key in ('ads_portal_enabled', 'ads_checkout_enabled', 'ads_delivery_enabled', 'ads_priority_review_enabled');
  update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
  update public.ad_products set active = true;
  select id into p_daily from public.ad_products where code = 'TEST-wp-home-top-daily';
  e := ads_internal.earliest_standard_start(now());
  perform zz.as_user(u_owner);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ <b>Co</b> & "Sons"', 'zz-owner@example.invalid');

  -- ── Enqueue from persisted facts (switch OFF) ───────────────────────
  perform zz.as_pg(); perform zz.at('2026-10-26 09:00+00');
  perform zz.as_user(u_owner);
  bp := public.ad_create_hold(p_daily, e + 20, e + 21, true);
  perform zz.as_pg(); perform zz.pay(bp, 'n1');
  perform zz.as_pg();
  select * into o from public.ad_notification_outbox where kind = 'booking_confirmation' and booking_id = bp;
  oc := o.id;
  perform zz.ok(o.status = 'pending' and o.recipient_email = 'zz-owner@example.invalid' and (o.payload ->> 'total_pence')::int = 17000
                and (o.payload ->> 'priority_fee_pence')::int = 15000 and o.payload ->> 'terms_version' like 'DRAFT%'
                and (o.payload ->> 'booked_from')::timestamptz = (select booked_from from public.ad_booking_confirmations where booking_id = bp),
                'confirmation enqueued with persisted amounts, interval and draft terms');
  v1 := zz.submit(u_owner, bp, 'https://example.com/n1');
  perform zz.as_pg();
  select * into o from public.ad_notification_outbox where kind = 'initial_priority_admin_alert' and booking_id = bp;
  oa := o.id;
  perform zz.ok(o.recipient_role = 'admin' and o.recipient_email is null and (o.payload ->> 'version_no')::int = 1
                and (o.payload ->> 'due_at')::timestamptz = '2026-10-26 21:00+00'
                and (o.payload ->> 'due_at')::timestamptz = (select due_at from public.ad_review_deadlines where creative_version_id = v1),
                'priority admin alert carries the exact persisted 12 h deadline and version');
  perform ads_internal.refresh_review_state((select id from public.ad_campaigns where booking_id = bp));
  perform zz.ok((select count(*) from public.ad_notification_outbox where booking_id = bp) = 2, 'no duplicate enqueue on refresh');

  perform zz.as_service();
  perform zz.ok(public.ad_notify_claim(10, 300) = '[]'::jsonb, 'switch OFF: worker claims nothing');
  perform zz.as_pg();
  perform zz.ok((select count(*) from public.ad_notification_outbox where status = 'pending' and attempts = 0) = 2, 'nothing changed while disabled');

  -- Access control.
  perform zz.as_user(u_owner);
  perform zz.ok((select count(*) from public.ad_notification_outbox) = 0, 'advertiser cannot read the outbox');
  perform zz.err('select public.ad_notify_claim(10, 300)', '%permission denied%', 'advertiser cannot run the worker');
  perform zz.err($q$select public.ad_notify_provider_event('evt_x_123', 'email.delivered', 'm', now(), '{}')$q$, '%permission denied%', 'advertiser cannot post provider events');
  perform zz.err(format($q$select public.ad_admin_retry_notification(%L, 'Retry please')$q$, oc), '%ADS_FORBIDDEN%', 'advertiser cannot retry');
  perform zz.as_user(u_admin);
  perform zz.ok((select count(*) from public.ad_notification_outbox) = 2, 'admin sees the outbox');
  perform zz.err('select public.ad_notify_claim(10, 300)', '%permission denied%', 'admin cannot run the worker directly (service role only)');

  -- ── Enabled: claim, lease, accept, stale results ────────────────────
  perform zz.as_pg();
  update public.ad_settings set bool_value = true where key = 'ads_email_enabled';
  perform zz.as_service();
  c := public.ad_notify_claim(10, 300);
  perform zz.ok(jsonb_array_length(c) = 2 and (c -> 0 ->> 'attempt')::int = 1
                and c -> 0 ->> 'idempotency_key' = 'msm-ads-notify-' || (c -> 0 ->> 'id') || '-g1', 'claim returns rows with a stable per-row, per-generation idempotency key');
  perform zz.ok(public.ad_notify_claim(10, 300) = '[]'::jsonb, 'leased rows are not claimed twice');
  perform zz.ok(zz.dispatch_accept(oc, 1, 're_msg_conf_1') = 'accepted', 'confirmation accepted by provider');
  perform zz.ok(public.ad_notify_result(oc, 1, 'accepted', 're_msg_conf_1', null) = 'stale', 'duplicate result ignored');
  perform zz.as_pg();
  perform zz.ok((select status = 'accepted' and delivered_at is null from public.ad_notification_outbox where id = oc), 'accepted is not delivered');

  -- Retry with backoff, then dead, then admin retry.
  perform zz.as_service();
  perform zz.ok(public.ad_notify_result(oa, 1, 'retryable_error', null, 'HTTP 503') = 'retry_scheduled', 'transient error -> retry');
  perform zz.as_pg();
  perform zz.ok((select status = 'pending' and next_attempt_at = '2026-10-26 09:05+00' and last_error = 'HTTP 503' from public.ad_notification_outbox where id = oa),
                'backoff 5 min; failure visible');
  perform zz.as_service();
  perform zz.ok(public.ad_notify_claim(10, 300) = '[]'::jsonb, 'not due yet');
  for i in 2..6 loop
    perform zz.as_pg(); perform zz.at('2026-10-26 09:00+00'::timestamptz + make_interval(hours => i * 7));
    perform zz.as_service();
    c := public.ad_notify_claim(10, 300);
    perform zz.ok((c -> 0 ->> 'attempt')::int = i, 'attempt ' || i);
    t := public.ad_notify_result(oa, i, 'retryable_error', null, 'HTTP 503');
  end loop;
  perform zz.ok(t = 'dead', 'dead after 6 attempts');
  perform zz.as_user(u_admin);
  perform public.ad_admin_retry_notification(oa, 'Provider outage resolved');
  perform zz.as_pg();
  perform zz.ok((select status from public.ad_notification_outbox where id = oa) = 'pending'
                and (select count(*) from public.ad_notification_events where outbox_id = oa and event = 'admin_retry') = 1, 'admin retry audited');
  perform zz.err(format($q$delete from public.ad_notification_events where outbox_id = %L$q$, oa), '%ADS_IMMUTABLE%', 'events append-only');
  perform zz.as_user(u_admin);
  perform public.ad_admin_cancel_notification(oa, 'Alert no longer useful');

  -- Lease expiry: a crashed worker's row is reclaimed; its late result is stale.
  perform zz.as_pg(); perform zz.at('2026-10-27 10:00+00');
  perform zz.as_user(u_admin);
  rq1 := public.ad_admin_request_correction(v1, 'advertiser_material', array['Logo <script>alert(1)</script> is cropped']);
  perform zz.as_pg();
  select id into oq from public.ad_notification_outbox where correction_request_id = rq1 and kind = 'correction_request';
  perform zz.ok((select (payload ->> 'version_no')::int = 1 and payload -> 'reasons' ->> 0 like 'Logo <script>%' and recipient_email = 'zz-owner@example.invalid'
                 from public.ad_notification_outbox where id = oq), 'correction request enqueued with exact version and raw reasons (escaped at render)');
  perform zz.as_service();
  c := public.ad_notify_claim(10, 60);
  perform zz.as_pg(); perform zz.at('2026-10-27 10:02+00');
  perform zz.as_service();
  c := public.ad_notify_claim(10, 60);
  perform zz.ok((c -> 0 ->> 'id')::uuid = oq and (c -> 0 ->> 'attempt')::int = 2, 'expired lease reclaimed');
  perform zz.ok(public.ad_notify_result(oq, 1, 'accepted', 're_msg_old', null) = 'stale', 'crashed worker result ignored');
  perform zz.ok(zz.dispatch_accept(oq, 2, 're_msg_corr_1') = 'accepted', 'current worker accepted');

  -- Provider events: accepted/sent start nothing; delivered starts the window.
  perform zz.as_pg();
  perform zz.ok((select status = 'awaiting_notice' and response_due_at is null from public.ad_correction_requests where id = rq1), 'provider acceptance starts no window');
  perform zz.as_service();
  perform zz.ok(public.ad_notify_provider_event('svix_evt_0001', 'email.sent', 're_msg_corr_1', '2026-10-27 10:02:30+00', '{}') = 'sent', 'sent event = history only');
  perform zz.ok(public.ad_notify_provider_event('svix_evt_0002', 'email.opened', 're_msg_corr_1', '2026-10-27 10:03+00', '{}') = 'ignored_type', 'opens never count');
  perform zz.err($q$select public.ad_notify_provider_event('svix_evt_0003', 'email.delivered', 're_unknown', now(), '{}')$q$, '%ADS_RETRY_LATER%', 'unknown message -> provider retries');
  perform zz.as_pg();
  perform zz.ok((select response_due_at is null from public.ad_correction_requests where id = rq1), 'still no window before delivery');
  perform zz.as_pg(); perform zz.at('2026-10-27 10:10+00');
  perform zz.as_service();
  perform zz.ok(public.ad_notify_provider_event('svix_evt_0004', 'email.delivered', 're_msg_corr_1', '2026-10-27 10:05+00', '{}') = 'delivered:response_window_started',
                'delivery starts the window');
  perform zz.ok(public.ad_notify_provider_event('svix_evt_0004', 'email.delivered', 're_msg_corr_1', '2026-10-27 10:05+00', '{}') = 'duplicate', 'duplicate provider event idempotent');
  perform zz.as_pg();
  perform zz.ok((select response_due_at = '2026-10-27 13:05+00' and notice_delivered_at = '2026-10-27 10:05+00' from public.ad_correction_requests where id = rq1),
                'window from the provider-reported delivery time (+3 working hours)');
  perform zz.ok((select status = 'delivered' from public.ad_notification_outbox where id = oq), 'outbox delivered');
  perform zz.ok((select (payload ->> 'response_due_at')::timestamptz = '2026-10-27 13:05+00' and (payload ->> 'version_no')::int = 1
                 from public.ad_notification_outbox where kind = 'correction_deadline' and correction_request_id = rq1), 'exact persisted deadline follow-up enqueued');
  perform zz.as_service();
  perform zz.ok(public.ad_notify_provider_event('svix_evt_0005', 'email.bounced', 're_msg_corr_1', '2026-10-27 10:20+00', '{}') = 'bounced:late_failure_exception_flagged',
                'late bounce = explicit exception');
  perform zz.as_pg();
  perform zz.ok((select notice_exception and response_due_at = '2026-10-27 13:05+00' from public.ad_correction_requests where id = rq1), 'window unchanged pending MSM decision');

  -- Bounce BEFORE delivery: known failure, no window.
  perform zz.at('2026-10-27 11:00+00');
  v2 := zz.submit(u_owner, bp, 'https://example.com/n2');
  perform zz.as_user(u_admin);
  rq2 := public.ad_admin_request_correction(v2, 'advertiser_material', array['Link returns 404']);
  perform zz.as_service();
  c := public.ad_notify_claim(10, 300);
  select (x ->> 'id')::uuid, (x ->> 'attempt')::int into oq, n from jsonb_array_elements(c) x where x ->> 'kind' = 'correction_request';
  perform zz.dispatch_accept(oq, n, 're_msg_corr_2');
  perform zz.ok(public.ad_notify_provider_event('svix_evt_0006', 'email.bounced', 're_msg_corr_2', '2026-10-27 11:01+00', '{}') = 'bounced:failed_before_delivery_no_window',
                'bounce before delivery starts no window');
  perform zz.as_pg();
  perform zz.ok((select status = 'awaiting_notice' and response_due_at is null from public.ad_correction_requests where id = rq2), 'request still awaiting notice');

  -- Permanent send failure: recorded as a known failed notice.
  perform zz.at('2026-10-27 11:30+00');
  v3 := zz.submit(u_owner, bp, 'https://example.com/n3');
  perform zz.as_user(u_admin);
  rq3 := public.ad_admin_request_correction(v3, 'advertiser_material', array['Alt text missing']);
  perform zz.as_service();
  c := public.ad_notify_claim(10, 300);
  select (x ->> 'id')::uuid, (x ->> 'attempt')::int into oq, n from jsonb_array_elements(c) x where x ->> 'kind' = 'correction_request';
  perform zz.ok(public.ad_notify_result(oq, n, 'permanent_error', null, 'HTTP 422 invalid recipient') = 'failed', 'permanent error -> failed');
  perform zz.as_pg();
  perform zz.ok((select outcome from public.ad_correction_notices where correction_request_id = rq3) = 'failed_before_delivery_no_window'
                and (select response_due_at is null from public.ad_correction_requests where id = rq3), 'failure visible on the correction; no window');

  -- Fallback-started window is not disturbed by a later email failure.
  perform zz.at('2026-10-27 12:00+00');
  v4 := zz.submit(u_owner, bp, 'https://example.com/n4');
  perform zz.as_user(u_admin);
  rq4 := public.ad_admin_request_correction(v4, 'advertiser_material', array['Wrong date on artwork']);
  perform public.ad_admin_record_correction_notice(rq4, 'sent', 'Phoned advertiser, read reasons aloud');
  perform zz.as_service();
  c := public.ad_notify_claim(10, 300);
  select (x ->> 'id')::uuid, (x ->> 'attempt')::int into oq, n from jsonb_array_elements(c) x where x ->> 'kind' = 'correction_request';
  perform zz.dispatch_accept(oq, n, 're_msg_corr_4');
  perform zz.ok(public.ad_notify_provider_event('svix_evt_0007', 'email.bounced', 're_msg_corr_4', '2026-10-27 12:05+00', '{}') = 'bounced:fallback_window_unaffected',
                'email bounce after fallback contact is not a late failure');
  perform zz.as_pg();
  perform zz.ok((select not notice_exception and notice_channel = 'fallback' from public.ad_correction_requests where id = rq4), 'no exception flagged');

  -- Review outcome.
  perform zz.at('2026-10-27 12:30+00');
  v5 := zz.submit(u_owner, bp, 'https://example.com/n5');
  perform zz.as_user(u_admin);
  perform public.ad_admin_review(v5, 'approve');
  perform zz.as_pg();
  perform zz.ok((select payload ->> 'outcome' = 'approved' and (payload ->> 'version_no')::int = 5 and payload ? 'booked_until'
                 from public.ad_notification_outbox where kind = 'review_outcome' and creative_version_id = v5), 'outcome enqueued with exact version');

  raise notice 'ads notification outbox: ALL CHECKS PASSED';
end $$;
rollback;
