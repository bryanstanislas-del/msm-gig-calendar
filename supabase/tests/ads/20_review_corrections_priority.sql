-- LOCAL/DISPOSABLE DB ONLY. Review, corrections and priority (migration
-- 20261016120000). Drives deadlines with the test-only clock
-- (ads.test_now, honoured only for non-API sessions). Rolled back.
-- Signal: "ads review/corrections/priority: ALL CHECKS PASSED".
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

do $$
declare
  u_owner uuid; u_other uuid; u_admin uuid; adv uuid;
  p_daily uuid; e date; q jsonb; r jsonb; s jsonb; t text; n int;
  bp uuid; bs uuid; bm uuid; bx uuid; bl uuid;          -- priority / standard / material-first / msm-error / late-response bookings
  vp uuid; vp2 uuid; vs uuid; vm uuid; vx uuid; vl uuid; vl2 uuid;
  rq uuid; rq2 uuid; rqx uuid;
  t0 timestamptz;
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
  perform zz.as_user(u_owner);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ Co', 'zz-owner@example.invalid') returning id into adv;

  -- ── Working hours parity with src/ads/ukWorkingTime.js ──────────────
  perform zz.as_pg();
  perform zz.ok(ads_internal.add_uk_working_hours('2026-10-16 16:00+01', 3) = '2026-10-19 11:00+01', 'Fri 16:00 + 3wh -> Mon 11:00');
  perform zz.ok(ads_internal.add_uk_working_hours('2026-10-19 07:00+01', 3) = '2026-10-19 12:00+01', 'before opening');
  perform zz.ok(ads_internal.add_uk_working_hours('2026-10-19 18:00+01', 3) = '2026-10-20 12:00+01', 'after close');
  perform zz.ok(ads_internal.add_uk_working_hours('2026-10-19 14:00+01', 3) = '2026-10-19 17:00+01', 'exactly to close');
  perform zz.ok(ads_internal.add_uk_working_hours('2026-10-17 11:00+01', 3) = '2026-10-19 12:00+01', 'weekend');
  perform zz.ok(ads_internal.add_uk_working_hours('2026-10-23 16:00+01', 3) = '2026-10-26 11:00+00', 'across autumn clock change');
  perform zz.ok(ads_internal.add_uk_working_hours('2026-04-02 16:00+01', 3) = '2026-04-07 11:00+01', 'Easter bank holidays');
  perform zz.ok(ads_internal.add_uk_working_hours('2026-12-24 15:30+00', 3) = '2026-12-29 10:30+00', 'Christmas + substitute day');
  perform zz.ok(exists (select 1 from public.ad_uk_holidays where holiday_date = '2028-12-26'), '2028 E&W holidays maintained');

  -- ── Priority is optional, actively selected, gated on MSM cover ─────
  perform zz.as_user(u_owner);
  perform zz.err(format('select public.ad_quote(%L, %L, %L, true)', p_daily, e, e), '%ADS_PRIORITY_UNAVAILABLE%', 'priority quote refused while cover off');
  perform zz.err(format('select public.ad_create_hold(%L, %L, %L, true)', p_daily, e, e), '%ADS_PRIORITY_UNAVAILABLE%', 'priority hold refused while cover off');
  perform zz.err($q$select public.ad_admin_set_setting('ads_priority_review_enabled', true)$q$, '%ADS_FORBIDDEN%', 'advertiser cannot enable cover');
  perform zz.as_user(u_admin);
  perform public.ad_admin_set_setting('ads_priority_review_enabled', true);
  perform zz.as_pg();
  perform zz.at('2026-10-16 16:00+01');
  perform zz.as_user(u_owner);
  q := public.ad_quote(p_daily, e, e, true);
  perform zz.ok((q ->> 'priority_fee_pence')::int = 15000 and (q ->> 'placement_pence')::int = 1000 and (q ->> 'total_pence')::int = 16000, 'priority price shown before payment');
  perform zz.ok((q ->> 'review_due_if_ready_now')::timestamptz = '2026-10-17 04:00+01', 'exact priority deadline if ready now (12 elapsed h, overnight)');
  perform zz.ok(q ->> 'terms_version' like 'DRAFT%', 'draft terms version labelled as draft');
  q := public.ad_quote(p_daily, e, e, false);
  perform zz.ok((q ->> 'priority_fee_pence')::int = 0 and (q ->> 'review_due_if_ready_now')::timestamptz = '2026-10-20 00:00+01', 'standard deadline shown (end of next working day)');

  bp := public.ad_create_hold(p_daily, e, e, true);
  bs := public.ad_create_hold(p_daily, e + 1, e + 1);          -- 3-arg entry point = standard
  perform zz.as_pg();
  perform zz.ok((select priority_fee_pence = 15000 and placement_pence = 1000 and total_pence = 16000 and priority_review
                 from public.ad_purchase_snapshots where booking_id = bp), 'priority snapshot: fee + placement split, immutable total');
  perform zz.ok((select priority_fee_pence = 0 and not priority_review from public.ad_purchase_snapshots where booking_id = bs), 'standard snapshot has no fee');
  perform zz.err(format($q$update public.ad_purchase_snapshots set priority_fee_pence = 0 where booking_id = %L$q$, bp), '%ADS_IMMUTABLE%', 'fee cannot be edited');
  perform zz.as_user(u_owner);
  perform zz.err(format($q$update public.ad_bookings set priority_review = false where id = %L$q$, bp), '%permission denied%', 'advertiser cannot toggle priority after hold');
  perform zz.as_user(u_owner);
  q := public.ad_prepare_checkout(bp);
  perform zz.ok((q ->> 'total_pence')::int = 16000 and (q ->> 'priority_fee_pence')::int = 15000 and (q ->> 'placement_pence')::int = 1000, 'checkout gets split from snapshot');

  -- ── Arrival order: payment first, then material (priority) ──────────
  perform zz.as_pg(); perform zz.at('2026-10-16 10:00+01');
  perform zz.ok(zz.pay(bp, 'bp') = 'confirmed', 'priority booking paid');
  perform zz.as_pg();
  perform zz.ok(not exists (select 1 from public.ad_review_deadlines d join public.ad_campaigns c on c.id = d.campaign_id where c.booking_id = bp), 'no clock without complete material');
  perform zz.ok((select priority_review and total_pence = 16000 and priority_fee_pence = 15000 and terms_version like 'DRAFT%'
                 from public.ad_booking_confirmations where booking_id = bp), 'durable confirmation written once on verified payment');
  perform zz.ok(zz.pay(bp, 'bp') = 'duplicate', 'duplicate webhook idempotent');
  perform zz.as_pg(); perform zz.at('2026-10-16 16:00+01');   -- material arrives Friday 16:00 BST
  vp := zz.submit(u_owner, bp, 'https://example.com/a');
  perform zz.as_pg();
  perform zz.ok((select kind = 'initial_priority' and starts_at = '2026-10-16 16:00+01' and due_at = '2026-10-17 04:00+01'
                 from public.ad_review_deadlines where creative_version_id = vp), 'priority clock starts at material (last of the two); due 12 elapsed h, overnight');
  perform ads_internal.refresh_review_state((select id from public.ad_campaigns where booking_id = bp));
  perform zz.ok((select count(*) from public.ad_review_deadlines where creative_version_id = vp) = 1, 'clock never restarts on duplicate refresh');

  -- ── Arrival order: material first, then payment (standard) ──────────
  perform zz.at('2026-10-16 09:00+01');
  vs := zz.submit(u_owner, bs, 'https://example.com/s');
  perform zz.as_pg();
  perform zz.ok(not exists (select 1 from public.ad_review_deadlines where creative_version_id = vs), 'no clock before payment clears');
  perform zz.at('2026-10-16 17:00+01');
  perform zz.ok(zz.pay(bs, 'bs') = 'confirmed', 'standard booking paid Friday 17:00');
  perform zz.as_pg();
  perform zz.ok((select kind = 'initial_standard' and starts_at = '2026-10-16 17:00+01' and due_at = '2026-10-20 00:00+01'
                 from public.ad_review_deadlines where creative_version_id = vs), 'standard clock starts at payment (last); due 23:59:59 Monday');

  -- ── Correction request at 11h59m meets the priority initial review ──
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_admin_request_correction(%L, 'advertiser_material', array['Logo is cropped at the left edge'])$q$, vp), '%ADS_FORBIDDEN%', 'advertiser cannot request corrections');
  perform zz.as_pg(); perform zz.at('2026-10-17 03:59+01');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_request_correction(%L, 'advertiser_material', array['x'])$q$, vp), '%ADS_REASON_REQUIRED%', 'reasons required');
  perform zz.err(format($q$select public.ad_admin_request_correction(%L, 'advertiser_material', '{}')$q$, vp), '%ADS_REASON_REQUIRED%', 'empty reasons refused');
  rq := public.ad_admin_request_correction(vp, 'advertiser_material', array['Logo is cropped at the left edge', 'Destination page returns 404']);
  s := public.ad_review_sla(bp);
  perform zz.ok((s ->> 'initial_review_met')::boolean and not (s ->> 'priority_fee_refund_assessment_needed')::boolean, 'genuine correction at 11h59m meets the initial priority review');
  perform zz.ok((select status from public.ad_creative_versions where id = vp) = 'correction_requested'
                and (select review_status from public.ad_campaigns where booking_id = bp) = 'correction_requested', 'version + campaign marked correction requested');

  -- Notice: known failure starts nothing; delivery starts 3 working hours.
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_record_correction_notice(%L, 'sent', now(), 'm1', 'mailer-key-0001')$q$, rq), '%permission denied%', 'advertiser cannot record notices');
  perform zz.as_service(); perform zz.at('2026-10-17 04:00+01');
  perform zz.ok(public.ad_record_correction_notice(rq, 'failed', '2026-10-17 04:00+01', 'm1', 'mailer-key-0001') = 'failed_before_delivery_no_window', 'known failed email starts no window');
  perform zz.ok((select response_due_at is null and status = 'awaiting_notice' from public.ad_correction_requests where id = rq), 'still awaiting notice');
  perform zz.at('2026-10-17 05:00+01');
  perform zz.ok(public.ad_record_correction_notice(rq, 'sent', '2026-10-16 16:00+01', 'm2', 'mailer-key-0002') = 'response_window_started', 'retry delivered');
  -- (occurred_at in the past is accepted as evidence; future times are clamped to the clock)
  perform zz.ok((select response_due_at from public.ad_correction_requests where id = rq) = '2026-10-19 11:00+01', 'Friday 16:00 delivery -> Monday 11:00 response deadline');
  perform zz.ok(public.ad_record_correction_notice(rq, 'sent', '2026-10-16 16:00+01', 'm2', 'mailer-key-0002') = 'duplicate', 'duplicate mailer event idempotent');
  perform zz.ok(public.ad_record_correction_notice(rq, 'bounced', '2026-10-17 06:00+01', 'm2', 'mailer-key-0003') = 'late_failure_exception_flagged', 'late bounce after window started -> exception');
  perform zz.ok((select notice_exception and response_due_at = '2026-10-19 11:00+01' from public.ad_correction_requests where id = rq), 'late bounce recorded; window unchanged pending MSM decision');

  -- Advertiser sees reasons, exact version and deadline -- not the internal cause.
  perform zz.as_user(u_owner);
  perform zz.ok((select reasons[2] = 'Destination page returns 404' and creative_version_id = vp and response_due_at = '2026-10-19 11:00+01'
                 from public.ad_correction_requests where id = rq), 'advertiser sees reasons, version, response deadline');
  perform zz.err('select cause from public.ad_correction_requests', '%permission denied%', 'internal cause hidden from advertiser');
  perform zz.ok((public.ad_review_sla(bp) -> 'corrections' -> 0 ->> 'cause') is null, 'SLA view hides cause from advertiser');
  perform zz.as_user(u_other);
  perform zz.ok((select count(*) from public.ad_correction_requests) = 0, 'other user sees no corrections');
  perform zz.err(format('select public.ad_review_sla(%L)', bp), '%ADS_NOT_FOUND%', 'other user cannot read SLA');

  -- Correction received EXACTLY at the deadline is timely -> 3 working hours.
  perform zz.as_pg(); perform zz.at('2026-10-19 11:00+01');
  vp2 := zz.submit(u_owner, bp, 'https://example.com/a-fixed');
  perform zz.as_pg();
  perform zz.ok((select timely and response_version_id = vp2 and status = 'responded' from public.ad_correction_requests where id = rq), 'response at deadline is timely');
  perform zz.ok((select kind = 'correction_review_priority' and due_at = '2026-10-19 14:00+01' from public.ad_review_deadlines where creative_version_id = vp2),
                'timely priority correction -> review within 3 working hours of receipt');
  perform zz.ok((select count(*) from public.ad_payments where booking_id = bp) = 1 and (select total_pence from public.ad_purchase_snapshots where booking_id = bp) = 16000,
                'no fee charged again for the correction');
  perform zz.err(format($q$update public.ad_creative_versions set correction_request_id = null where id = %L$q$, vp2), '%ADS_IMMUTABLE%', 'correction link immutable');
  perform zz.err('update public.ad_review_deadlines set due_at = due_at + interval ''1 day''', '%ADS_IMMUTABLE%', 'deadlines immutable');
  perform zz.err('delete from public.ad_review_events', '%ADS_IMMUTABLE%', 'events append-only');

  -- ── Late priority correction (1 s after deadline) -> next working day end
  perform zz.at('2026-10-21 10:00+01');
  perform zz.as_user(u_owner);
  bl := public.ad_create_hold(p_daily, e + 2, e + 2, true);
  perform zz.as_pg(); perform zz.at('2026-10-21 09:00+01');
  perform zz.pay(bl, 'bl');
  vl := zz.submit(u_owner, bl, 'https://example.com/l');
  perform zz.as_pg(); perform zz.at('2026-10-21 10:00+01');
  perform zz.as_user(u_admin);
  rq2 := public.ad_admin_request_correction(vl, 'advertiser_material', array['Text unreadable on mobile artwork']);
  perform zz.as_service();
  perform public.ad_record_correction_notice(rq2, 'sent', '2026-10-21 10:00+01', 'm3', 'mailer-key-0004');
  perform zz.as_pg();
  perform zz.ok((select response_due_at from public.ad_correction_requests where id = rq2) = '2026-10-21 13:00+01', 'Wed 10:00 + 3 working hours = 13:00');
  perform zz.at('2026-10-21 13:00:01+01');
  vl2 := zz.submit(u_owner, bl, 'https://example.com/l2');
  perform zz.as_pg();
  perform zz.ok((select not timely from public.ad_correction_requests where id = rq2), 'one second late is late');
  perform zz.ok((select kind = 'correction_review_standard' and due_at = '2026-10-23 00:00+01' from public.ad_review_deadlines where creative_version_id = vl2),
                'late priority correction -> end of next working day');

  -- ── MSM's own error is not a review and not advertiser delay ────────
  perform zz.at('2026-10-22 09:00+01');
  perform zz.as_user(u_owner);
  bx := public.ad_create_hold(p_daily, e + 3, e + 3, true);
  perform zz.as_pg(); perform zz.pay(bx, 'bx');
  vx := zz.submit(u_owner, bx, 'https://example.com/x');
  perform zz.as_pg(); perform zz.at('2026-10-22 10:00+01');
  perform zz.as_user(u_admin);
  rqx := public.ad_admin_request_correction(vx, 'msm_error', array['MSM mistyped the required dimensions in its first message']);
  s := public.ad_review_sla(bx);
  perform zz.ok(s ->> 'initial_review_met' is null, 'MSM-error correction does not satisfy the initial review');
  perform zz.as_pg(); perform zz.at('2026-10-22 21:00:01+01');
  vx := zz.submit(u_owner, bx, 'https://example.com/x2');
  perform zz.as_pg(); perform zz.at('2026-10-22 21:30+01');
  perform zz.as_user(u_admin);
  perform public.ad_admin_review(vx, 'approve');
  s := public.ad_review_sla(bx);
  perform zz.ok(not (s ->> 'initial_review_met')::boolean and (s ->> 'priority_fee_refund_assessment_needed')::boolean,
                'first real review after 12 elapsed hours -> initial priority deadline missed -> fee refund assessment needed');

  -- Standard booking reviewed on time: met, no fee involved.
  perform zz.as_pg(); perform zz.at('2026-10-19 12:00+01');
  perform zz.as_user(u_admin);
  perform public.ad_admin_review(vs, 'approve');
  s := public.ad_review_sla(bs);
  perform zz.ok((s ->> 'initial_review_met')::boolean and not (s ->> 'priority_fee_refund_assessment_needed')::boolean, 'standard on-time approval meets deadline');

  -- Destination change after approval = new version, provisional standard review, not served until approved.
  perform zz.as_pg(); perform zz.at('2026-10-19 13:00+01');
  vm := zz.submit(u_owner, bs, 'https://example.com/changed-destination');
  perform zz.as_pg();
  perform zz.ok((select kind = 'replacement_review_provisional' from public.ad_review_deadlines where creative_version_id = vm), 'replacement review kind flagged provisional (gate)');
  perform zz.ok((select approved_version_id = vs from public.ad_campaigns where booking_id = bs), 'unreviewed destination change never replaces the approved version');

  raise notice 'ads review/corrections/priority: ALL CHECKS PASSED';
end $$;
rollback;
