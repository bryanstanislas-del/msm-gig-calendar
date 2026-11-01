-- Ads phase 1 -- validation hardening (forward migration on top of
-- 20261017090000). STATUS: NOT APPLIED to any remote database.
-- ad_notify_begin_dispatch: `p_content_sha256 !~ regex` is NULL for a NULL
-- hash, so a NULL hash (or attempt) slipped past validation and could be
-- stored as the frozen dispatch identity. Reject NULL explicitly. Body
-- otherwise unchanged; CREATE OR REPLACE keeps the existing grants.
create or replace function public.ad_notify_begin_dispatch(p_id uuid, p_attempt integer, p_recipient text, p_content_sha256 text) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox; t timestamptz := ads_internal.clock_now();
begin
  -- NULL !~ regex is NULL (not true), so NULL must be rejected explicitly.
  if p_recipient is null or char_length(p_recipient) not between 3 and 254
     or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' or p_attempt is null then
    raise exception 'ADS_BAD_REQUEST';
  end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status <> 'sending' or o.attempts <> p_attempt or o.lease_until is null or o.lease_until <= t then return 'stale'; end if;
  if o.first_dispatched_at is null then
    update public.ad_notification_outbox set first_dispatched_at = t, dispatch_recipient = p_recipient, dispatch_content_sha256 = p_content_sha256 where id = o.id;
    perform ads_internal.notify_event(o.id, 'dispatch_started', jsonb_build_object('attempt', p_attempt, 'generation', o.dispatch_generation, 'sha256', p_content_sha256));
    return 'proceed';
  end if;
  if o.dispatch_recipient is distinct from p_recipient or o.dispatch_content_sha256 is distinct from p_content_sha256 then
    perform ads_internal.to_reconciliation(o.id, 'recipient or content changed after the first dispatch');
    return 'blocked';
  end if;
  if t >= o.first_dispatched_at + ads_internal.dispatch_window() then
    perform ads_internal.to_reconciliation(o.id, 'provider idempotency window elapsed with unknown outcome');
    return 'blocked';
  end if;
  perform ads_internal.notify_event(o.id, 'dispatch_retry', jsonb_build_object('attempt', p_attempt, 'generation', o.dispatch_generation));
  return 'proceed';
end; $$;
