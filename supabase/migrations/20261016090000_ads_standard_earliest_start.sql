-- Ads phase 1 follow-up: STANDARD earliest bookable start date derived from
-- the agreed review window.
--
-- STATUS: NOT APPLIED to any remote database. Additive forward migration on
-- top of 20261015120000_ads_platform_phase1.sql (which is already applied on
-- staging oyakrgdmplmxmlhjfqcd and is deliberately left unchanged).
--
-- Agreed standard review window: MSM reviews by the END OF THE NEXT UK
-- WORKING DAY after the booking is fully paid AND has complete artwork +
-- links (weekends and ad_uk_holidays skipped; Europe/London, DST-aware) --
-- the same rule as ads_internal.review_due_before().
--
-- The earliest STANDARD start date is therefore the London date on which
-- that review window ends if the advertiser became "ready" right now:
--   earliest = (review_due_before(now()) at time zone 'Europe/London')::date
-- e.g. ready Friday 17:00 -> review by end of Monday -> earliest start Tuesday.
--
-- This ASSUMES readiness at quote/hold time (best case). It does not assume
-- payment or artwork that has not happened: if they arrive later, the review
-- deadline moves later and approval may land after the booked start; the
-- advert then runs only on the remaining booked days (no automatic
-- extension or refund -- commercial policy undecided). Approval is never
-- promised. Priority review (GBP 150 / 12 elapsed hours) remains
-- UNIMPLEMENTED and locked off; nothing here shortens the standard window.
--
-- min_lead_days becomes an OPTIONAL extra floor (today + N) on top of the
-- review-window date; the effective earliest date is the later of the two.
-- Its seeded TEST value 3 (which allowed e.g. Friday -> Monday) is reset to 0
-- here only if it is still exactly the seed value.

create or replace function ads_internal.earliest_standard_start(p_now timestamptz default now())
returns date language sql stable security definer set search_path = '' as $$
  select greatest(
    (ads_internal.review_due_before(p_now) at time zone 'Europe/London')::date,
    (p_now at time zone 'Europe/London')::date + coalesce(ads_internal.setting_int('min_lead_days'), 0))
$$;
comment on function ads_internal.earliest_standard_start(timestamptz) is
  'Earliest STANDARD start date (Europe/London) if payment + complete artwork/links were ready at p_now: the day after the end of the next UK working day, or today + min_lead_days if later.';

-- Same checks as before; only the "too soon" rule changes (server-side, so a
-- tampered client date is rejected regardless of the UI).
create or replace function ads_internal.validate_booking_dates(p_product public.ad_products, p_start date, p_end date)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare
  today date := ads_internal.london_today();
  earliest date := ads_internal.earliest_standard_start(now());
  days integer;
begin
  if p_start is null or p_end is null then raise exception 'ADS_INVALID_DATES: start and end are required'; end if;
  if p_end < p_start then raise exception 'ADS_INVALID_DATES: end date is before start date'; end if;
  if p_start < earliest then
    raise exception 'ADS_INVALID_DATES: start date is too soon (earliest standard UK start date is %)', earliest;
  end if;
  if p_start > today + coalesce(ads_internal.setting_int('max_advance_days'), 365) then
    raise exception 'ADS_INVALID_DATES: start date is too far ahead';
  end if;
  days := (p_end - p_start) + 1;
  if days < p_product.min_days or days > p_product.max_days then
    raise exception 'ADS_INVALID_DATES: this package needs between % and % days', p_product.min_days, p_product.max_days;
  end if;
  return days;
end; $$;

-- Portal helper: what the UI uses for its date picker min/default.
create or replace function public.ad_earliest_start() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ADS_AUTH_REQUIRED'; end if;
  return jsonb_build_object(
    'earliest_start', ads_internal.earliest_standard_start(now()),
    'assumes_ready_at', now(),
    'review_due_before_if_ready_now', ads_internal.review_due_before(now()),
    'rule', 'standard review by end of next UK working day after payment + complete artwork/links');
end; $$;

update public.ad_settings
   set description = 'Optional extra floor: earliest start is also at least London today + N days. The standard rule is the review window (see ads_internal.earliest_standard_start). TEST value.'
 where key = 'min_lead_days';
update public.ad_settings set int_value = 0, updated_at = now()
 where key = 'min_lead_days' and int_value = 3;

revoke all on function ads_internal.earliest_standard_start(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ad_earliest_start() from public, anon, authenticated, service_role;
grant execute on function public.ad_earliest_start() to authenticated;
