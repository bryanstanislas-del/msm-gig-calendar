-- LOCAL/DISPOSABLE DB ONLY. Refund assessment + business cancellation
-- (migration 20261016150000). No money moves: assessments are proposed,
-- approved and processor outcomes recorded manually. Rolled back.
-- Signal: "ads refunds/cancellation: ALL CHECKS PASSED".
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
  u_owner uuid; u_admin uuid; adv uuid; p_daily uuid; e date; s0 date;
  bp uuid; bs uuid; bw uuid; bc uuid; bu uuid; bh uuid; bq uuid; bq2 uuid; bm uuid; vq uuid; vq2 uuid;
  vp uuid; vs uuid;
  a1 uuid; a2 uuid; aw uuid; ac uuid; x1 uuid; x2 uuid; x3 uuid; x4 uuid; am uuid; rogue uuid; tq timestamptz; tq2 timestamptz;
  st timestamptz; bwr tstzrange; purchased bigint; n int; r jsonb; paid int;
begin
  insert into auth.users (email) values ('zz-owner@example.invalid') returning id into u_owner;
  insert into auth.users (email) values ('zz-admin@example.invalid') returning id into u_admin;
  insert into public.user_roles (user_id, role) values (u_admin, 'admin');
  update public.ad_settings set bool_value = true where key in ('ads_portal_enabled', 'ads_checkout_enabled', 'ads_delivery_enabled', 'ads_priority_review_enabled');
  update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
  update public.ad_products set active = true;
  select id into p_daily from public.ad_products where code = 'TEST-wp-home-top-daily';
  e := ads_internal.earliest_standard_start(now());
  s0 := greatest(e, date '2026-10-26');          -- avoid the autumn clock change where possible
  perform zz.as_user(u_owner);
  insert into public.ad_advertisers (display_name, contact_email) values ('ZZ Co', 'zz-owner@example.invalid') returning id into adv;

  -- ── Exact maths parity with src/ads/refunds.js ─────────────────────
  perform zz.as_pg();
  perform zz.ok(ads_internal.lost_time_refund_pence(30000, 720 * 3600, 6 * 3600) = 250, 'GBP 300 / 720 h x 6 h = GBP 2.50');
  perform zz.ok(ads_internal.lost_time_refund_pence(10000, 720 * 3600, 3600) = 14, 'fractional 13.89p -> 14p (final penny only)');
  perform zz.ok(ads_internal.lost_time_refund_pence(10000, 720 * 3600, 3 * 3600) = 42, '3 h together = 41.67p -> 42p, not 3 x 14p');
  perform zz.ok(ads_internal.lost_time_refund_pence(10000, 720 * 3600, 7 * 3600) = 97, '97.22p -> 97p');
  perform zz.ok(ads_internal.lost_time_refund_pence(30000, 720 * 3600, 900 * 3600) = 30000, 'capped at the placement charge');

  -- ── Priority booking, 28 days, initial priority deadline missed ─────
  perform zz.at('2026-10-20 09:00+01');
  perform zz.as_user(u_owner);
  bp := public.ad_create_hold(p_daily, s0, s0 + 27, true);
  perform zz.as_pg();
  perform zz.ok(zz.pay(bp, 'rp') = 'confirmed', 'priority booking paid');
  vp := zz.submit(u_owner, bp, 'https://example.com/p');
  perform zz.as_pg(); perform zz.at('2026-10-20 21:00:01+01');   -- 12 h + 1 s after material
  perform zz.as_user(u_admin);
  perform public.ad_admin_review(vp, 'approve');
  perform zz.ok((public.ad_review_sla(bp) ->> 'priority_fee_refund_assessment_needed')::boolean, 'missed initial priority deadline flagged');

  -- Server checks before anything is proposed.
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_admin_propose_refund(%L, true, '[]', 'Priority missed')$q$, bp), '%ADS_FORBIDDEN%', 'advertiser cannot propose refunds');
  perform zz.as_pg(); st := lower(ads_internal.booked_range(bp));
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_refund(%L, false, %L, 'Outage on homepage')$q$, bp,
    jsonb_build_array(jsonb_build_object('from', st, 'until', st + interval '1 hour', 'evidence', 'short'))), '%ADS_EVIDENCE_REQUIRED%', 'evidence required per interval');
  perform zz.err(format($q$select public.ad_admin_propose_refund(%L, false, %L, 'Outage on homepage')$q$, bp,
    jsonb_build_array(jsonb_build_object('from', st, 'until', st, 'evidence', 'Uptime monitor incident #1'))), '%ADS_BAD_INTERVAL%', 'empty interval refused');
  perform zz.err(format($q$select public.ad_admin_propose_refund(%L, false, %L, 'Outage before run')$q$, bp,
    jsonb_build_array(jsonb_build_object('from', st - interval '5 hours', 'until', st, 'evidence', 'Uptime monitor incident #1'))), '%ADS_NOTHING_TO_REFUND%', 'time outside the booked run is not lost time');

  -- Worked example: priority fee + 6 h lost = GBP 152.50 (when 672 h purchased).
  a1 := public.ad_admin_propose_refund(bp, true,
    jsonb_build_array(jsonb_build_object('from', st + interval '10 hours', 'until', st + interval '16 hours', 'evidence', 'Serving outage, Vercel incident log ref ZZ-1')),
    'Priority deadline missed + homepage outage');
  perform zz.as_pg();
  select purchased_seconds into purchased from public.ad_refund_lines where assessment_id = a1 and kind = 'lost_time';
  perform zz.ok((select pence from public.ad_refund_lines where assessment_id = a1 and kind = 'priority_fee') = 15000, 'full priority fee line');
  perform zz.ok((select pence = ads_internal.lost_time_refund_pence(28000, purchased, 6 * 3600) and lost_seconds = 6 * 3600
                 from public.ad_refund_lines where assessment_id = a1 and kind = 'lost_time'), 'lost time from placement charge only (fee excluded)');
  perform zz.ok(purchased <> 672 * 3600 or (select total_pence from public.ad_refund_assessments where id = a1) = 15250, 'GBP 280 / 672 h x 6 h + fee = GBP 152.50');
  perform zz.ok((select status = 'proposed' and gates = '{}' and target_pay_by is null from public.ad_refund_assessments where id = a1), 'proposed, no payment target until approval');
  perform zz.err(format($q$update public.ad_refund_lines set pence = 1 where assessment_id = %L$q$, a1), '%ADS_IMMUTABLE%', 'lines immutable');
  perform zz.err(format($q$delete from public.ad_refund_assessments where id = %L$q$, a1), '%ADS_IMMUTABLE%', 'assessments never deleted');

  -- No double counting: fee once; overlapping time only counts the new part.
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_refund(%L, true, '[]', 'Priority again')$q$, bp), '%ADS_ALREADY_ASSESSED%', 'priority fee only once');
  a2 := public.ad_admin_propose_refund(bp, false,
    jsonb_build_array(jsonb_build_object('from', st + interval '12 hours', 'until', st + interval '18 hours', 'evidence', 'Serving outage, Vercel incident log ref ZZ-2')),
    'Second overlapping outage report');
  perform zz.as_pg();
  perform zz.ok((select lost_seconds = 2 * 3600 and pence = ads_internal.lost_time_refund_pence(28000, purchased, 2 * 3600)
                 from public.ad_refund_lines where assessment_id = a2), 'overlap removed: only 2 new hours assessed');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_refund(%L, false, %L, 'Duplicate report')$q$, bp,
    jsonb_build_array(jsonb_build_object('from', st + interval '10 hours', 'until', st + interval '18 hours', 'evidence', 'Serving outage, duplicate report'))),
    '%ADS_NOTHING_TO_REFUND%', 'already-assessed time cannot be claimed twice');

  -- Processing is distinct from approval; nothing before approval.
  perform zz.err(format($q$select public.ad_admin_record_refund_processing(%L, 'submitted', 're_test1', 'refund-key-0001', null)$q$, a1), '%ADS_INVALID_STATE%', 'no processing before approval');
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Looks right')$q$, a1), '%ADS_FORBIDDEN%', 'advertiser cannot approve');
  perform zz.ok((select count(*) from public.ad_refund_assessments) = 0, 'assessments admin-only (advertiser view is a gap)');
  perform zz.as_pg(); perform zz.at('2026-11-01 10:00+00');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', '')$q$, a1), '%ADS_REASON_REQUIRED%', 'decision note required');
  perform public.ad_admin_decide_refund(a1, 'approve', 'Entitlement and amount confirmed');
  perform zz.ok((select status = 'approved' and target_pay_by = '2026-11-15 10:00+00' from public.ad_refund_assessments where id = a1), 'approval sets the 14-day contractual target');
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'reject', 'Changed mind')$q$, a1), '%ADS_INVALID_STATE%', 'decision is final');
  perform zz.err(format($q$select public.ad_admin_record_refund_processing(%L, 'submitted', 'not-a-stripe-id', 'refund-key-0001', null)$q$, a1), '%ADS_BAD_PROVIDER_ID%', 'Stripe refund id required');
  perform zz.ok(public.ad_admin_record_refund_processing(a1, 'submitted', 're_test1', 'refund-key-0001', 'Issued manually in Stripe sandbox') = 'recorded', 'submitted recorded');
  perform zz.ok(public.ad_admin_record_refund_processing(a1, 'submitted', 're_test1', 'refund-key-0001', null) = 'duplicate', 'duplicate admin action idempotent');
  perform zz.ok(public.ad_admin_record_refund_processing(a1, 'failed', null, 'refund-key-0002', 'Card expired') = 'recorded', 'failure recorded (assessment stays approved)');
  perform zz.ok((select status from public.ad_refund_assessments where id = a1) = 'approved', 'processor failure does not undo approval');
  perform zz.ok(public.ad_admin_record_refund_processing(a1, 'succeeded', 're_test2', 'refund-key-0003', null) = 'recorded', 'retry succeeded');
  perform zz.err(format($q$select public.ad_admin_record_refund_processing(%L, 'succeeded', 're_test3', 'refund-key-0004', null)$q$, a1), '%already succeeded%', 'no double success');
  perform zz.ok((select count(*) from public.ad_refund_processing_events where assessment_id = a1) = 3, 'processor events append-only');

  -- Funding: an APPROVED partial refund keeps delivery; anything beyond does not.
  perform zz.as_pg();
  select total_pence into paid from public.ad_refund_assessments where id = a1;
  perform zz.as_service();
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_rp_ref1', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_rp', 'amount_refunded', paid));
  perform zz.as_pg();
  perform zz.ok(ads_internal.booking_funded(bp) and (select status from public.ad_bookings where id = bp) = 'confirmed', 'approved partial refund: still funded, run continues');
  perform zz.ok(r ->> 'outcome' = 'partially_refunded_within_approved'
                and (select status_reason from public.ad_bookings where id = bp) like '%within approved refund assessments: delivery and approval continue', 'status note says delivery continues (not suspended)');
  perform zz.as_service();
  r := public.ad_apply_stripe_event(jsonb_build_object('id', 'evt_rp_ref2', 'type', 'charge.refunded', 'livemode', false,
         'payment_intent_id', 'pi_test_rp', 'amount_refunded', paid + 1));
  perform zz.as_pg();
  perform zz.ok(not ads_internal.booking_funded(bp), 'refund beyond approved assessments (a2 unapproved) unfunds delivery');
  perform zz.ok(r ->> 'outcome' = 'partially_refunded_flagged'
                and (select status_reason from public.ad_bookings where id = bp) like '%beyond approved refund assessments: delivery and approval suspended%', 'status note says suspended when beyond approved');

  -- ── Whole run lost = manual gate; cannot be approved ─────────────────
  perform zz.at('2026-10-20 09:00+01');
  perform zz.as_user(u_owner);
  bw := public.ad_create_hold(p_daily, s0 + 28, s0 + 28);
  perform zz.as_pg(); perform zz.pay(bw, 'rw');
  perform zz.as_pg(); bwr := ads_internal.booked_range(bw);
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_refund(%L, true, '[]', 'Not a priority booking')$q$, bw), '%ADS_PRIORITY_REFUND_NOT_DUE%', 'no fee refund when no priority deadline was missed');
  aw := public.ad_admin_propose_refund(bw, false,
    jsonb_build_array(jsonb_build_object('from', lower(bwr) - interval '1 day', 'until', upper(bwr) + interval '1 day',
                                         'evidence', 'Homepage down for the whole day, incident ZZ-3')), 'Whole day lost');
  perform zz.as_pg();
  perform zz.ok((select status = 'manual_gate' and 'whole_run_lost' = any(gates) and total_pence = 1000 from public.ad_refund_assessments where id = aw), 'whole run lost -> manual gate, clipped + capped');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Approve anyway')$q$, aw), '%ADS_MANUAL_GATE%', 'manual gate cannot be approved');
  perform public.ad_admin_decide_refund(aw, 'reject', 'Policy for whole-run loss not agreed; handled offline');

  -- ── Cancellation: removal separate from the financial assessment ────
  perform zz.as_user(u_owner);
  bc := public.ad_create_hold(p_daily, s0 + 29, s0 + 30);
  bu := public.ad_create_hold(p_daily, s0 + 31, s0 + 31);
  bh := public.ad_create_hold(p_daily, s0 + 32, s0 + 32);
  perform zz.as_pg(); perform zz.pay(bc, 'rc'); perform zz.pay(bu, 'ru');
  perform zz.as_user(u_owner);
  perform zz.err(format($q$select public.ad_admin_cancel_booking(%L, 'Advertiser wants out', 'business', 'advertiser')$q$, bc), '%ADS_FORBIDDEN%', 'advertiser cannot use admin cancellation');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_cancel_booking(%L, 'Advertiser wants out', 'consumer', 'advertiser')$q$, bc), '%ADS_CONSUMER_CANCELLATION_PATH_DISABLED%', 'consumer path disabled');
  perform zz.err(format($q$select public.ad_admin_cancel_booking(%L, 'Advertiser wants out', 'checkbox', 'advertiser')$q$, bc), '%ADS_BAD_PARTY_TYPE%', 'party type validated');
  perform zz.err(format($q$select public.ad_admin_cancel_booking(%L, 'Advertiser wants out', 'business', 'someone')$q$, bc), '%ADS_BAD_INITIATOR%', 'initiator validated');
  perform zz.err(format($q$select public.ad_admin_propose_cancellation_refund(%L, 0, 0, 'Booking schedule evidence', 'Before removal')$q$, bc), '%remove the campaign first%', 'assessment needs removal first');
  perform public.ad_admin_cancel_booking(bc, 'Business advertiser cancelled by email', 'business', 'advertiser');
  perform zz.as_pg();
  perform zz.ok((select status from public.ad_bookings where id = bc) = 'cancelled' and not ads_internal.booking_funded(bc), 'removed: no longer served');
  perform zz.ok(not exists (select 1 from public.ad_payments where booking_id = bc and requires_refund), 'removal is not an automatic refund');
  perform zz.ok((select party_type = 'business' and initiated_by = 'advertiser' from public.ad_cancellation_cases where booking_id = bc)
                and (select status_reason from public.ad_bookings where id = bc) like 'Cancelled at the advertiser''s request%', 'actual initiator recorded (advertiser)');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_cancel_booking(%L, 'Again please', 'business', 'advertiser')$q$, bc), '%ADS_INVALID_STATE%', 'cannot remove twice');
  perform zz.err(format($q$select public.ad_admin_propose_cancellation_refund(%L, 1500, 600, 'Delivered nothing; resale failed', 'Too much retained')$q$, bc), '%cannot exceed the booking price%', 'retained capped at the price');
  perform zz.err(format($q$select public.ad_admin_propose_cancellation_refund(%L, 0, 500, 'short', 'No evidence')$q$, bc), '%ADS_EVIDENCE_REQUIRED%', 'loss needs evidence');
  perform zz.err(format($q$select public.ad_admin_propose_cancellation_refund(%L, -1, 0, 'Delivered nothing at all', 'Negative')$q$, bc), '%ADS_BAD_AMOUNT%', 'no negative amounts');
  ac := public.ad_admin_propose_cancellation_refund(bc, 300, 200, 'Run not started; slot resold for one of two days', 'Business cancellation assessment');
  perform zz.as_pg();
  perform zz.ok((select kind = 'cancellation' and status = 'proposed' and total_pence = 2000 - 500 from public.ad_refund_assessments where id = ac), 'refund = price - delivered - evidenced net loss');
  perform zz.ok((select (details ->> 'net_loss_pence')::int = 200 from public.ad_refund_lines where assessment_id = ac), 'breakdown stored');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_cancellation_refund(%L, 0, 0, 'Second assessment attempt', 'Again')$q$, bc), '%ADS_ALREADY_ASSESSED%', 'one live cancellation assessment per booking');

  -- Undetermined party type (2-arg legacy entry point) -> assessment gated.
  perform public.ad_admin_cancel_booking(bu, 'Removed via legacy admin button');
  perform zz.as_pg();
  perform zz.ok((select party_type from public.ad_cancellation_cases where booking_id = bu) = 'undetermined', 'legacy cancel records undetermined status');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_cancellation_refund(%L, 0, 0, 'Nothing delivered yet', 'Assess')$q$, bu), '%record who initiated%', 'legacy removal: undetermined initiator gated');
  -- Unpaid hold can still be removed.
  perform public.ad_admin_cancel_booking(bh, 'Removing an unpaid hold', 'business', 'msm');
  perform zz.as_pg();
  perform zz.ok((select status from public.ad_bookings where id = bh) = 'cancelled', 'unpaid hold removed');
  perform zz.err('update public.ad_cancellation_cases set party_type = ''business''', '%ADS_IMMUTABLE%', 'cancellation cases immutable');
  perform zz.as_user(u_owner);
  perform zz.ok((select count(*) from public.ad_cancellation_cases) = 0 and (select count(*) from public.ad_refund_lines) = 0, 'advertiser sees no internal assessment rows');


  -- ── MSM-initiated removal: no advertiser-cancellation loss rules ───────
  perform zz.as_pg(); perform zz.at('2026-10-20 09:00+01');
  perform zz.as_user(u_owner);
  bm := public.ad_create_hold(p_daily, s0 + 33, s0 + 34);
  perform zz.as_pg(); perform zz.pay(bm, 'rm');
  perform zz.as_user(u_admin);
  perform public.ad_admin_cancel_booking(bm, 'MSM homepage redesign removes the slot', 'business', 'msm');
  perform zz.as_pg();
  perform zz.ok((select initiated_by from public.ad_cancellation_cases where booking_id = bm) = 'msm'
                and (select status_reason from public.ad_bookings where id = bm) like 'Removed by MSM%', 'MSM initiator recorded');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_propose_cancellation_refund(%L, 0, 100, 'Claimed lost resale value', 'MSM removal')$q$, bm),
                 '%MSM-initiated removal cannot retain%', 'MSM removal cannot retain net loss');
  am := public.ad_admin_propose_cancellation_refund(bm, 200, 0, 'One hour delivered before removal (log ZZ-9)', 'MSM removal assessment');
  perform zz.as_pg();
  perform zz.ok((select status = 'manual_gate' and 'msm_initiated_cancellation' = any(gates) and total_pence = 2000 - 200 from public.ad_refund_assessments where id = am),
                'MSM removal: price minus delivered value, gated for manual decision (other remedies)');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Approve it')$q$, am), '%ADS_MANUAL_GATE%', 'MSM removal assessment not auto-approvable');

  -- ── Cross-kind order 1: cancellation first, then service failure ──────
  perform zz.as_pg(); perform zz.at('2026-10-20 09:00+01');
  perform zz.as_user(u_owner);
  bq := public.ad_create_hold(p_daily, s0 + 35, s0 + 36, true);     -- 2000 placement + 15000 fee = 17000
  perform zz.as_pg(); perform zz.pay(bq, 'rq');
  vq := zz.submit(u_owner, bq, 'https://example.com/q');
  perform zz.as_pg(); perform zz.at('2026-10-20 21:30+01');
  perform zz.as_user(u_admin);
  perform public.ad_admin_review(vq, 'approve');
  perform public.ad_admin_cancel_booking(bq, 'Advertiser emailed to cancel ref ZZ-Q', 'business', 'advertiser');
  x1 := public.ad_admin_propose_cancellation_refund(bq, 0, 500, 'Slot left unsold, quotes ZZ-Q2', 'Advertiser cancellation');
  perform zz.as_pg(); tq := lower(ads_internal.booked_range(bq));
  perform zz.ok((select status = 'proposed' and total_pence = 16500 from public.ad_refund_assessments where id = x1), 'cancellation balance 17000 - 500');
  perform zz.as_user(u_admin);
  x2 := public.ad_admin_propose_refund(bq, true,
    jsonb_build_array(jsonb_build_object('from', tq, 'until', tq + interval '6 hours', 'evidence', 'Serving outage, incident ZZ-Q3')), 'Priority missed + outage');
  perform zz.as_pg();
  perform zz.ok((select status = 'manual_gate' and gates @> array['cross_kind_allocation', 'exceeds_booking_total'] and total_pence = 15000 + 250
                 from public.ad_refund_assessments where id = x2), 'later service failure gated, full entitlement recorded (not erased)');
  perform zz.ok((select sum(total_pence) from public.ad_refund_assessments where booking_id = bq and status = 'approved') is null, 'nothing over-refunded');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Approve fee')$q$, x2), '%ADS_MANUAL_GATE%', 'gated service failure not approvable');
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Approve balance')$q$, x1), '%cross_kind_allocation%', 'approval re-validates: open other-kind assessment blocks');
  perform public.ad_admin_decide_refund(x2, 'reject', 'Allocation resolved offline; re-propose after cancellation decision');
  perform public.ad_admin_decide_refund(x1, 'approve', 'Cancellation balance confirmed');
  -- re-proposal after rejection: still gated by the approved cancellation; amounts never erased
  x3 := public.ad_admin_propose_refund(bq, true,
    jsonb_build_array(jsonb_build_object('from', tq, 'until', tq + interval '6 hours', 'evidence', 'Serving outage, incident ZZ-Q3')), 'Re-proposed after rejection');
  perform zz.as_pg();
  perform zz.ok((select status = 'manual_gate' and 'cross_kind_allocation' = any(gates) and total_pence = 15250 from public.ad_refund_assessments where id = x3),
                'rejected time/fee become claimable again, still gated against the approved cancellation');

  -- ── Cross-kind order 2: service failure first, then cancellation ──────
  perform zz.at('2026-10-20 09:00+01');
  perform zz.as_user(u_owner);
  bq2 := public.ad_create_hold(p_daily, s0 + 37, s0 + 38, true);
  perform zz.as_pg(); perform zz.pay(bq2, 'rq2');
  vq2 := zz.submit(u_owner, bq2, 'https://example.com/q2');
  perform zz.as_pg(); perform zz.at('2026-10-20 21:30+01');
  perform zz.as_user(u_admin);
  perform public.ad_admin_review(vq2, 'approve');
  x4 := public.ad_admin_propose_refund(bq2, true, '[]', 'Priority deadline missed');
  perform public.ad_admin_cancel_booking(bq2, 'Advertiser cancelled by phone, call log ZZ-R', 'business', 'advertiser');
  ac := public.ad_admin_propose_cancellation_refund(bq2, 0, 0, 'Nothing delivered; slot resold', 'Advertiser cancellation');
  perform zz.as_pg();
  perform zz.ok((select status = 'manual_gate' and gates = array['cross_kind_allocation'] and total_pence = 17000 - 15000 from public.ad_refund_assessments where id = ac)
                and (select (details ->> 'previously_assessed_pence')::int = 15000 from public.ad_refund_lines where assessment_id = ac),
                'later cancellation gated; earlier fee assessment deducted, never double recovered');
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Approve fee')$q$, x4), '%cross_kind_allocation%', 'fee approval blocked while cancellation open');
  perform public.ad_admin_decide_refund(ac, 'reject', 'Assess after the fee decision');
  perform public.ad_admin_decide_refund(x4, 'approve', 'Fee refund confirmed');
  perform zz.as_pg();
  perform zz.ok((select sum(total_pence) from public.ad_refund_assessments where booking_id = bq2 and status = 'approved') <= 17000, 'approved total within paid');

  -- ── Approval re-validates ceilings even against inconsistent rows ────
  insert into public.ad_refund_assessments (booking_id, kind, status, total_pence, note, proposed_at)
  values (bq2, 'service_failure', 'proposed', 2001, 'ZZ rogue row bypassing proposal checks', now()) returning id into rogue;
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Rogue approve')$q$, rogue), '%ADS_REFUND_CEILING%', 'booking-wide ceiling at approval');
  perform zz.as_pg();
  insert into public.ad_refund_assessments (booking_id, kind, status, total_pence, note, proposed_at)
  values (bq2, 'service_failure', 'proposed', 1, 'ZZ rogue fee line', now()) returning id into rogue;
  insert into public.ad_refund_lines (assessment_id, kind, pence) values (rogue, 'priority_fee', 1);
  perform zz.as_user(u_admin);
  perform zz.err(format($q$select public.ad_admin_decide_refund(%L, 'approve', 'Rogue fee')$q$, rogue), '%exceed the fee%', 'separate fee cap at approval');

  raise notice 'ads refunds/cancellation: ALL CHECKS PASSED';
end $$;
rollback;
