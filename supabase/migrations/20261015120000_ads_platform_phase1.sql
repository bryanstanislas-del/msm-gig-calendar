-- MSM Shared Advertising Platform -- Phase 1 foundation
-- (ONE WordPress homepage position: wordpress-home-top)
--
-- STATUS: NOT APPLIED TO ANY REMOTE DATABASE. Additive only. Nothing in
-- this file alters or drops an existing object: promo_slots,
-- featured_listings, founding_supporters and every Calendar table are
-- untouched. Everything new is prefixed `ad_` (public, RLS-protected,
-- PostgREST-visible) or lives in the new, non-exposed `ads_internal`
-- schema.
--
-- DISABLED BY DEFAULT. Every feature toggle in ad_settings starts false,
-- every seeded inventory unit and product starts active = false, and every
-- seeded price is a clearly-labelled TEST price. Applying this migration
-- changes nothing visible anywhere until an admin flips toggles.
--
-- founding_supporters is non-purchasable recognition and is NOT referenced
-- here. promo_slots (house ads in the Calendar app) is NOT referenced here.
--
-- Core invariants enforced at the database layer (see
-- docs/ads/phase1-architecture.md for the full design):
--   * Price is computed server-side into an immutable purchase snapshot at
--     hold time; the client never supplies an amount.
--   * Physical inventory (ad_inventory_units) is shared across products, so
--     two packages that map to the same unit can never oversell it. Every
--     reservation/confirmation locks the unit rows (FOR UPDATE) before
--     counting, so concurrent holds serialise per unit.
--   * Payment NEVER approves or publishes. The Stripe-event RPC only ever
--     touches ad_payments / ad_bookings.status; approval is a separate
--     admin-only RPC bound to a specific immutable creative version.
--   * Delivery returns only approved creative of a paid (confirmed),
--     un-paused booking whose London-date window includes today.
--   * Date semantics: start_date and end_date are INCLUSIVE calendar dates
--     in Europe/London. A booking is live from 00:00 London time on
--     start_date until (exclusive) 00:00 London time on end_date + 1, which
--     Postgres' tz database makes DST-correct (23h/25h days included).

create schema if not exists ads_internal;
revoke all on schema ads_internal from public;
alter default privileges in schema ads_internal revoke execute on functions from public;
grant usage on schema ads_internal to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
--  Settings / feature toggles
-- ════════════════════════════════════════════════════════════════════

create table public.ad_settings (
  key text primary key,
  bool_value boolean,
  int_value integer,
  description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.ad_settings is 'Advertising feature toggles and tunables. Admin-only; written via ad_admin_set_setting() (audited). All toggles default OFF.';

insert into public.ad_settings (key, bool_value, int_value, description) values
  ('ads_portal_enabled',             false, null, 'Advertiser portal visible/usable (holds, uploads).'),
  ('ads_checkout_enabled',           false, null, 'Stripe Checkout may be started (TEST mode only in phase 1).'),
  ('ads_delivery_enabled',           false, null, 'Public delivery of approved creative to WordPress.'),
  ('ads_priority_review_enabled',    false, null, 'PHASE 2 -- not implemented; cannot be enabled in phase 1.'),
  ('ads_venue_gig_targeting_enabled',false, null, 'PHASE 2+ -- venue/gig advertising is OFF; cannot be enabled in phase 1.'),
  ('stripe_livemode',                false, null, 'Expected Stripe livemode flag. Phase 1 is TEST ONLY; cannot be enabled.'),
  ('hold_minutes',                   null,  60,   'Unpaid hold lifetime. Checkout must start with >= 31 minutes left (Stripe minimum session life is 30 minutes).'),
  ('min_lead_days',                  null,  3,    'Earliest bookable start date = London today + N days. TEST value, commercial decision pending.'),
  ('max_advance_days',               null,  365,  'Latest bookable start date = London today + N days.'),
  ('max_active_holds_per_advertiser',null,  3,    'Anti-hoarding limit on simultaneous unpaid holds.');

-- ════════════════════════════════════════════════════════════════════
--  UK working-day calendar (configurable)
-- ════════════════════════════════════════════════════════════════════

create table public.ad_uk_holidays (
  holiday_date date primary key,
  name text not null,
  created_at timestamptz not null default now()
);
comment on table public.ad_uk_holidays is 'Non-working days for review deadlines (England & Wales bank holidays seeded for 2026-2027; MSM must verify against gov.uk/bank-holidays and maintain).';

insert into public.ad_uk_holidays (holiday_date, name) values
  ('2026-01-01','New Year''s Day'), ('2026-04-03','Good Friday'), ('2026-04-06','Easter Monday'),
  ('2026-05-04','Early May bank holiday'), ('2026-05-25','Spring bank holiday'),
  ('2026-08-31','Summer bank holiday'), ('2026-12-25','Christmas Day'),
  ('2026-12-28','Boxing Day (substitute day)'),
  ('2027-01-01','New Year''s Day'), ('2027-03-26','Good Friday'), ('2027-03-29','Easter Monday'),
  ('2027-05-03','Early May bank holiday'), ('2027-05-31','Spring bank holiday'),
  ('2027-08-30','Summer bank holiday'), ('2027-12-27','Christmas Day (substitute day)'),
  ('2027-12-28','Boxing Day (substitute day)');

-- ════════════════════════════════════════════════════════════════════
--  Physical inventory, products (packages), product->unit mapping
-- ════════════════════════════════════════════════════════════════════

create table public.ad_inventory_units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  surface text not null check (surface in ('wordpress', 'calendar')),
  name text not null,
  rotation_capacity integer not null check (rotation_capacity between 1 and 20),
  desktop_width integer not null check (desktop_width > 0),
  desktop_height integer not null check (desktop_height > 0),
  mobile_width integer not null check (mobile_width > 0),
  mobile_height integer not null check (mobile_height > 0),
  max_bytes integer not null default 1048576 check (max_bytes between 1024 and 1048576),
  is_test boolean not null default true,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ad_inventory_units is 'Physical ad positions. Capacity is per London day, shared by every product mapped to the unit. Dimensions/capacities are TEST values pending commercial sign-off.';
create trigger ad_inventory_units_updated_at before update on public.ad_inventory_units
  for each row execute function public.update_updated_at();

-- Codes follow the existing WordPress placement naming
-- (wordpress-article-[format]-[position]) so the homepage positions are
-- wordpress-home-[position]. Only TOP is wired to a product in phase 1.
insert into public.ad_inventory_units
  (code, surface, name, rotation_capacity, desktop_width, desktop_height, mobile_width, mobile_height, is_test, active)
values
  ('wordpress-home-top',    'wordpress', 'TEST - WordPress homepage top (#msm-wp-home-top)',       1, 1200, 250, 600, 250, true, false),
  ('wordpress-home-middle', 'wordpress', 'TEST - WordPress homepage middle (#msm-wp-home-middle) - not sold in phase 1', 1, 1200, 250, 600, 250, true, false),
  ('wordpress-home-bottom', 'wordpress', 'TEST - WordPress homepage bottom (#msm-wp-home-bottom) - not sold in phase 1', 1, 1200, 250, 600, 250, true, false);

create table public.ad_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'),
  name text not null,
  description text,
  currency text not null default 'gbp' check (currency = 'gbp'),
  price_per_day_pence integer not null check (price_per_day_pence between 100 and 10000000),
  min_days integer not null default 1 check (min_days >= 1),
  max_days integer not null default 28 check (max_days >= 1),
  targeting_kind text not null default 'placement' check (targeting_kind = 'placement'),
  is_test boolean not null default true,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_days <= max_days)
);
comment on table public.ad_products is 'Sellable packages. Prices here are TEST prices only. targeting_kind is placement-only in phase 1 (series/venue/gig targeting are documented later extensions).';
create trigger ad_products_updated_at before update on public.ad_products
  for each row execute function public.update_updated_at();

create table public.ad_product_units (
  product_id uuid not null references public.ad_products(id) on delete cascade,
  unit_id uuid not null references public.ad_inventory_units(id) on delete restrict,
  primary key (product_id, unit_id)
);

-- Two TEST packages deliberately sharing the same physical unit, so the
-- shared-inventory rule is exercised (they can never both sell the same
-- London day beyond the unit's rotation_capacity).
insert into public.ad_products (code, name, description, price_per_day_pence, min_days, max_days, is_test, active) values
  ('TEST-wp-home-top-daily',  'TEST ONLY - Homepage top banner (per day)',
   'TEST PRICE - NOT FOR SALE. Commercial pricing not yet decided.', 1000, 1, 28, true, false),
  ('TEST-wp-home-top-weekly', 'TEST ONLY - Homepage top banner (7+ days)',
   'TEST PRICE - NOT FOR SALE. Shares the same physical homepage-top inventory as the daily package.', 800, 7, 28, true, false);

insert into public.ad_product_units (product_id, unit_id)
select p.id, u.id from public.ad_products p, public.ad_inventory_units u
where p.code in ('TEST-wp-home-top-daily', 'TEST-wp-home-top-weekly') and u.code = 'wordpress-home-top';

-- ════════════════════════════════════════════════════════════════════
--  Advertisers, bookings, inventory days, purchase snapshots
-- ════════════════════════════════════════════════════════════════════

create table public.ad_advertisers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique default auth.uid() references auth.users(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  contact_email text not null check (char_length(contact_email) <= 254 and contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ad_advertisers is 'One advertiser account per auth user (phase 1). Contact details are private: never returned by any public/delivery function.';
create trigger ad_advertisers_updated_at before update on public.ad_advertisers
  for each row execute function public.update_updated_at();

create table public.ad_bookings (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.ad_advertisers(id) on delete restrict,
  product_id uuid not null references public.ad_products(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('held', 'confirmed', 'expired', 'cancelled', 'refunded', 'payment_conflict')),
  hold_expires_at timestamptz not null,
  status_reason text,
  is_test boolean not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
comment on table public.ad_bookings is 'Commercial reservation. Inventory counts only while status = confirmed, or held with hold_expires_at in the future. payment_conflict = paid after the hold lapsed and capacity was gone (refund required, handled manually in Stripe).';
comment on column public.ad_bookings.end_date is 'INCLUSIVE London date. Live until 00:00 Europe/London on end_date + 1 (exclusive).';
create index ad_bookings_advertiser_idx on public.ad_bookings (advertiser_id);
create index ad_bookings_status_idx on public.ad_bookings (status);
create trigger ad_bookings_updated_at before update on public.ad_bookings
  for each row execute function public.update_updated_at();

create table public.ad_booking_inventory_days (
  booking_id uuid not null references public.ad_bookings(id) on delete restrict,
  unit_id uuid not null references public.ad_inventory_units(id) on delete restrict,
  day date not null,
  primary key (booking_id, unit_id, day)
);
create index ad_booking_inventory_days_unit_day_idx on public.ad_booking_inventory_days (unit_id, day);

create table public.ad_purchase_snapshots (
  booking_id uuid primary key references public.ad_bookings(id) on delete restrict,
  product_id uuid not null,
  product_code text not null,
  product_name text not null,
  unit_codes text[] not null,
  start_date date not null,
  end_date date not null,
  billable_days integer not null check (billable_days > 0),
  price_per_day_pence integer not null,
  priority_fee_pence integer not null default 0 check (priority_fee_pence = 0),
  total_pence integer not null check (total_pence > 0),
  currency text not null,
  vat_treatment text not null default 'undetermined-test',
  is_test boolean not null,
  pricing_version text not null default 'phase1-test-v1',
  computed_at timestamptz not null default now()
);
comment on table public.ad_purchase_snapshots is 'IMMUTABLE server-computed price at hold time. Checkout amount must equal total_pence. priority_fee_pence is pinned to 0 until priority review ships (phase 2).';

-- ════════════════════════════════════════════════════════════════════
--  Campaigns + immutable creative versions
-- ════════════════════════════════════════════════════════════════════

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.ad_bookings(id) on delete restrict,
  advertiser_id uuid not null references public.ad_advertisers(id) on delete restrict,
  review_status text not null default 'awaiting_creative'
    check (review_status in ('awaiting_creative', 'awaiting_payment', 'under_review', 'approved', 'rejected')),
  current_version_id uuid,
  approved_version_id uuid,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.ad_campaigns.review_status is 'Review state of current_version_id. Delivery uses approved_version_id only: a newer replacement never serves until it is itself approved.';
create trigger ad_campaigns_updated_at before update on public.ad_campaigns
  for each row execute function public.update_updated_at();

create table public.ad_creative_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  desktop_object_path text not null,
  desktop_mime text not null,
  desktop_bytes integer not null,
  desktop_width integer not null,
  desktop_height integer not null,
  desktop_sha256 text not null check (desktop_sha256 ~ '^[0-9a-f]{64}$'),
  mobile_object_path text not null,
  mobile_mime text not null,
  mobile_bytes integer not null,
  mobile_width integer not null,
  mobile_height integer not null,
  mobile_sha256 text not null check (mobile_sha256 ~ '^[0-9a-f]{64}$'),
  destination_url text not null,
  alt_text text not null check (char_length(btrim(alt_text)) between 3 and 250),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'superseded')),
  submitted_at timestamptz not null default now(),
  review_clock_started_at timestamptz,
  review_due_before timestamptz,
  reviewed_at timestamptz,
  rejection_reason text,
  unique (campaign_id, version_no)
);
comment on table public.ad_creative_versions is 'Each submission is a new immutable version (content columns cannot change; see trigger). Approval is bound to one version id. review_due_before is EXCLUSIVE: 00:00 Europe/London after the next UK working day following the moment paid + complete creative coincide.';

alter table public.ad_campaigns
  add constraint ad_campaigns_current_version_fk foreign key (current_version_id) references public.ad_creative_versions(id),
  add constraint ad_campaigns_approved_version_fk foreign key (approved_version_id) references public.ad_creative_versions(id);

-- ════════════════════════════════════════════════════════════════════
--  Payments + verified provider events
-- ════════════════════════════════════════════════════════════════════

create table public.ad_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.ad_bookings(id) on delete restrict,
  provider text not null default 'stripe' check (provider = 'stripe'),
  livemode boolean not null,
  checkout_session_id text not null unique check (checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$'),
  payment_intent_id text unique,
  amount_pence integer not null check (amount_pence > 0),
  currency text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'expired', 'failed', 'refunded', 'partially_refunded')),
  amount_refunded_pence integer not null default 0,
  requires_refund boolean not null default false,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on column public.ad_payments.requires_refund is 'Set when money arrived that cannot be honoured (late payment with no capacity, duplicate payment, cancelled booking). Refunds are issued manually in the Stripe dashboard; charge.refunded then updates this row.';
create index ad_payments_booking_idx on public.ad_payments (booking_id);
create trigger ad_payments_updated_at before update on public.ad_payments
  for each row execute function public.update_updated_at();

-- The ONE payment that funds a confirmed booking (set by the webhook when
-- it confirms). Duplicate/conflicting payments never become the funding
-- payment, so refunding them never affects the booking; refunding the
-- funding payment always does. See ads_internal.booking_funded().
alter table public.ad_bookings add column funding_payment_id uuid references public.ad_payments(id);

create table public.ad_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  livemode boolean not null,
  provider_created_at timestamptz,
  checkout_session_id text,
  payment_intent_id text,
  booking_id uuid,
  outcome text not null default 'received',
  received_at timestamptz not null default now()
);
comment on table public.ad_payment_events is 'Signature-verified Stripe events (minimal fields, no card data). provider_event_id UNIQUE makes webhook retries idempotent.';

-- ════════════════════════════════════════════════════════════════════
--  Audit log + admin-only notes
-- ════════════════════════════════════════════════════════════════════

create table public.ad_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('advertiser', 'admin', 'system', 'stripe')),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb
);
create index ad_audit_log_entity_idx on public.ad_audit_log (entity_type, entity_id);

create table public.ad_admin_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.ad_bookings(id) on delete restrict,
  note text not null check (char_length(note) between 1 and 4000),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
comment on table public.ad_admin_notes is 'Private MSM notes. Admin-only; never visible to advertisers or public delivery.';

-- ════════════════════════════════════════════════════════════════════
--  Metrics (privacy-minimised: daily aggregates + short-lived dedupe keys)
-- ════════════════════════════════════════════════════════════════════

create table public.ad_metrics_daily (
  creative_version_id uuid not null references public.ad_creative_versions(id) on delete restrict,
  unit_id uuid not null references public.ad_inventory_units(id) on delete restrict,
  booking_id uuid not null references public.ad_bookings(id) on delete restrict,
  day date not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  primary key (creative_version_id, unit_id, day)
);
create index ad_metrics_daily_booking_idx on public.ad_metrics_daily (booking_id, day);

-- Keys are HMACs computed server-side (never raw IP/UA); rows expire and
-- are purged by ad_purge_tracking_state(). No client grants at all.
create table public.ad_metric_dedupe (
  dedupe_key text primary key,
  expires_at timestamptz not null
);
create table public.ad_rate_limits (
  client_key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (client_key, window_start)
);

-- ════════════════════════════════════════════════════════════════════
--  Immutability triggers
-- ════════════════════════════════════════════════════════════════════

create or replace function ads_internal.block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ADS_IMMUTABLE: % rows cannot be %', tg_table_name, lower(tg_op);
end; $$;

create trigger ad_purchase_snapshots_immutable before update or delete on public.ad_purchase_snapshots
  for each row execute function ads_internal.block_mutation();
create trigger ad_audit_log_immutable before update or delete on public.ad_audit_log
  for each row execute function ads_internal.block_mutation();
create trigger ad_creative_versions_no_delete before delete on public.ad_creative_versions
  for each row execute function ads_internal.block_mutation();

create or replace function ads_internal.guard_creative_version_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.campaign_id, new.version_no, new.desktop_object_path, new.desktop_mime, new.desktop_bytes,
      new.desktop_width, new.desktop_height, new.desktop_sha256, new.mobile_object_path, new.mobile_mime,
      new.mobile_bytes, new.mobile_width, new.mobile_height, new.mobile_sha256, new.destination_url,
      new.alt_text, new.submitted_at)
     is distinct from
     (old.campaign_id, old.version_no, old.desktop_object_path, old.desktop_mime, old.desktop_bytes,
      old.desktop_width, old.desktop_height, old.desktop_sha256, old.mobile_object_path, old.mobile_mime,
      old.mobile_bytes, old.mobile_width, old.mobile_height, old.mobile_sha256, old.destination_url,
      old.alt_text, old.submitted_at) then
    raise exception 'ADS_IMMUTABLE: creative version content cannot change; submit a new version';
  end if;
  return new;
end; $$;
create trigger ad_creative_versions_content_immutable before update on public.ad_creative_versions
  for each row execute function ads_internal.guard_creative_version_update();

-- ════════════════════════════════════════════════════════════════════
--  Internal helpers
-- ════════════════════════════════════════════════════════════════════

create or replace function ads_internal.setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select bool_value from public.ad_settings where key = p_key), false)
$$;

create or replace function ads_internal.setting_int(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select (select int_value from public.ad_settings where key = p_key)
$$;

create or replace function ads_internal.london_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/London')::date
$$;

-- 00:00 Europe/London on the given date, as an absolute instant (DST-aware).
create or replace function ads_internal.london_day_start(p_day date) returns timestamptz
language sql stable set search_path = '' as $$
  select (p_day::timestamp) at time zone 'Europe/London'
$$;

create or replace function ads_internal.is_working_day(p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_day) < 6
     and not exists (select 1 from public.ad_uk_holidays h where h.holiday_date = p_day)
$$;

create or replace function ads_internal.next_working_day_after(p_day date) returns date
language plpgsql stable security definer set search_path = '' as $$
declare d date := p_day + 1;
begin
  while not ads_internal.is_working_day(d) loop d := d + 1; end loop;
  return d;
end; $$;

-- "End of the next working day" after the instant p_ready, as an EXCLUSIVE
-- instant: 00:00 London on the day after that working day.
create or replace function ads_internal.review_due_before(p_ready timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ads_internal.london_day_start(
    ads_internal.next_working_day_after((p_ready at time zone 'Europe/London')::date) + 1)
$$;

create or replace function ads_internal.audit(
  p_actor_kind text, p_entity_type text, p_entity_id uuid, p_action text, p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.ad_audit_log (actor_user_id, actor_kind, entity_type, entity_id, action, details)
  values (auth.uid(), p_actor_kind, p_entity_type, p_entity_id, p_action, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function ads_internal.owns_advertiser(p_advertiser_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ad_advertisers a
                 where a.id = p_advertiser_id and a.owner_user_id = auth.uid() and auth.uid() is not null)
$$;

create or replace function ads_internal.owns_booking(p_booking_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ad_bookings b join public.ad_advertisers a on a.id = b.advertiser_id
                 where b.id = p_booking_id and a.owner_user_id = auth.uid() and auth.uid() is not null)
$$;

create or replace function ads_internal.owns_campaign(p_campaign_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ad_campaigns c join public.ad_advertisers a on a.id = c.advertiser_id
                 where c.id = p_campaign_id and a.owner_user_id = auth.uid() and auth.uid() is not null)
$$;

-- Destination URL rule (mirrored in src/ads/validation.js): https only, no
-- credentials, no whitespace/control chars, a dotted hostname that is not
-- an IP literal or localhost, <= 2048 chars.
create or replace function ads_internal.is_safe_destination(p_url text) returns boolean
language sql immutable set search_path = '' as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     and p_url !~ '[[:space:][:cntrl:]\\<>"]'
     and p_url ~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#].*)?$'
     and lower(substring(p_url from '^https://([^/?#:]+)')) not in ('localhost')
     and lower(substring(p_url from '^https://([^/?#:]+)')) !~ '(^|\.)localhost$'
$$;

-- Storage path for draft creative: <advertiser_id>/<campaign_id>/<uuid>-(desktop|mobile).(png|jpg|jpeg|webp)
create or replace function ads_internal.creative_path_owner_ok(p_name text, p_require_open boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if auth.uid() is null or array_length(parts, 1) <> 3 then return false; end if;
  if parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(desktop|mobile)\.(png|jpg|jpeg|webp)$' then
    return false;
  end if;
  return exists (
    select 1 from public.ad_campaigns c
    join public.ad_advertisers a on a.id = c.advertiser_id
    join public.ad_bookings b on b.id = c.booking_id
    where a.id = parts[1]::uuid and c.id = parts[2]::uuid
      and a.owner_user_id = auth.uid() and a.status = 'active'
      and (not p_require_open or b.status in ('held', 'confirmed'))
  );
end; $$;

-- Row-locks physical units in a stable order (deadlock-free) so every
-- reservation/confirmation touching them serialises.
create or replace function ads_internal.lock_units(p_units uuid[]) returns uuid[]
language sql security definer set search_path = '' as $$
  with locked as (
    select u.id from public.ad_inventory_units u
    where u.id = any(p_units)
    order by u.id
    for update
  ) select coalesce(array_agg(id order by id), '{}') from locked
$$;

-- Days (in [p_start, p_end]) on which any of p_units is already at
-- rotation_capacity, counting confirmed bookings and unexpired holds and
-- excluding p_exclude_booking. Callers must hold the unit row locks.
create or replace function ads_internal.full_days(p_units uuid[], p_start date, p_end date, p_exclude_booking uuid)
returns date[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.day order by x.day), '{}')
  from (
    select u.id as unit_id, u.rotation_capacity, gs::date as day
    from public.ad_inventory_units u
    cross join generate_series(p_start, p_end, interval '1 day') gs
    where u.id = any(p_units)
  ) x
  where (
    select count(*) from public.ad_booking_inventory_days d
    join public.ad_bookings b on b.id = d.booking_id
    where d.unit_id = x.unit_id and d.day = x.day
      and b.id is distinct from p_exclude_booking
      and (b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now()))
  ) >= x.rotation_capacity
$$;

create or replace function ads_internal.validate_booking_dates(p_product public.ad_products, p_start date, p_end date)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare
  today date := ads_internal.london_today();
  days integer;
begin
  if p_start is null or p_end is null then raise exception 'ADS_INVALID_DATES: start and end are required'; end if;
  if p_end < p_start then raise exception 'ADS_INVALID_DATES: end date is before start date'; end if;
  if p_start < today + coalesce(ads_internal.setting_int('min_lead_days'), 3) then
    raise exception 'ADS_INVALID_DATES: start date is too soon (minimum lead time % days)', coalesce(ads_internal.setting_int('min_lead_days'), 3);
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

-- Recompute campaign.review_status from its current version + booking
-- payment state. Starts the review clock exactly once per version, at the
-- moment "fully paid" and "complete creative" first coincide. NEVER
-- approves anything.
create or replace function ads_internal.refresh_review_state(p_campaign_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.ad_campaigns;
  b public.ad_bookings;
  v public.ad_creative_versions;
  new_status text;
begin
  select * into c from public.ad_campaigns where id = p_campaign_id for update;
  select * into b from public.ad_bookings where id = c.booking_id;
  if c.current_version_id is null then
    new_status := 'awaiting_creative';
  else
    select * into v from public.ad_creative_versions where id = c.current_version_id;
    if v.status = 'approved' then new_status := 'approved';
    elsif v.status = 'rejected' then new_status := 'rejected';
    elsif b.status = 'confirmed' then
      new_status := 'under_review';
      if v.review_clock_started_at is null then
        update public.ad_creative_versions
          set review_clock_started_at = now(), review_due_before = ads_internal.review_due_before(now())
          where id = v.id;
      end if;
    else
      new_status := 'awaiting_payment';
    end if;
  end if;
  if new_status is distinct from c.review_status then
    update public.ad_campaigns set review_status = new_status where id = c.id;
  end if;
end; $$;

-- FUNDING INVARIANT (single definition used by delivery AND approval):
-- confirmed booking whose funding payment is still fully paid (no refund
-- of any size) for exactly the immutable snapshot amount.
create or replace function ads_internal.booking_funded(p_booking_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ad_bookings b
    join public.ad_payments p on p.id = b.funding_payment_id and p.booking_id = b.id
    join public.ad_purchase_snapshots s on s.booking_id = b.id
    where b.id = p_booking_id and b.status = 'confirmed'
      and p.status = 'paid' and p.amount_refunded_pence = 0
      and p.amount_pence = s.total_pence and p.currency = s.currency)
$$;

-- Eligible (servable right now) creatives for a placement code.
create or replace function ads_internal.eligible_creatives(p_placement text)
returns table (creative_version_id uuid, booking_id uuid, unit_id uuid, serve_until timestamptz,
               alt_text text, destination_url text, desktop_width int, desktop_height int,
               mobile_width int, mobile_height int, desktop_object_path text, mobile_object_path text)
language sql stable security definer set search_path = '' as $$
  select v.id, b.id, u.id, ads_internal.london_day_start(b.end_date + 1),
         v.alt_text, v.destination_url, v.desktop_width, v.desktop_height, v.mobile_width, v.mobile_height,
         v.desktop_object_path, v.mobile_object_path
  from public.ad_inventory_units u
  join public.ad_booking_inventory_days d on d.unit_id = u.id and d.day = ads_internal.london_today()
  join public.ad_bookings b on b.id = d.booking_id and b.status = 'confirmed'
  join public.ad_campaigns c on c.booking_id = b.id and not c.paused and c.approved_version_id is not null
  join public.ad_creative_versions v on v.id = c.approved_version_id and v.status = 'approved'
  where u.code = p_placement and u.active
    and ads_internal.setting_bool('ads_delivery_enabled')
    and ads_internal.booking_funded(b.id)
    and now() >= ads_internal.london_day_start(b.start_date)
    and now() <  ads_internal.london_day_start(b.end_date + 1)
  order by b.confirmed_at, b.id
$$;

-- ════════════════════════════════════════════════════════════════════
--  Public / advertiser RPCs
-- ════════════════════════════════════════════════════════════════════

create or replace function public.ad_public_flags() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'portal',   ads_internal.setting_bool('ads_portal_enabled'),
    'checkout', ads_internal.setting_bool('ads_checkout_enabled'),
    'delivery', ads_internal.setting_bool('ads_delivery_enabled'),
    'priority_review', false,
    'venue_gig_targeting', false)
$$;

create or replace function public.ad_quote(p_product_id uuid, p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.ad_products;
  days integer;
  units uuid[];
  v_full_days date[];
begin
  if auth.uid() is null then raise exception 'ADS_AUTH_REQUIRED'; end if;
  if not ads_internal.setting_bool('ads_portal_enabled') and not public.is_admin_or_above() then
    raise exception 'ADS_DISABLED: advertising portal is not enabled';
  end if;
  select * into p from public.ad_products where id = p_product_id and active;
  if not found then raise exception 'ADS_PRODUCT_UNAVAILABLE'; end if;
  days := ads_internal.validate_booking_dates(p, p_start, p_end);
  select array_agg(pu.unit_id) into units from public.ad_product_units pu
    join public.ad_inventory_units u on u.id = pu.unit_id and u.active where pu.product_id = p.id;
  if units is null then raise exception 'ADS_PRODUCT_UNAVAILABLE: no active inventory'; end if;
  v_full_days := ads_internal.full_days(units, p_start, p_end, null);
  return jsonb_build_object(
    'available', cardinality(v_full_days) = 0,
    'unavailable_days', to_jsonb(v_full_days),
    'billable_days', days,
    'price_per_day_pence', p.price_per_day_pence,
    'total_pence', days * p.price_per_day_pence,
    'currency', p.currency,
    'is_test', p.is_test,
    'live_from', ads_internal.london_day_start(p_start),
    'live_until_exclusive', ads_internal.london_day_start(p_end + 1));
end; $$;

create or replace function public.ad_create_hold(p_product_id uuid, p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  adv public.ad_advertisers;
  p public.ad_products;
  days integer;
  units uuid[];
  v_full date[];
  active_holds integer;
  bid uuid;
  cid uuid;
begin
  if uid is null then raise exception 'ADS_AUTH_REQUIRED'; end if;
  if not ads_internal.setting_bool('ads_portal_enabled') then
    raise exception 'ADS_DISABLED: advertising portal is not enabled';
  end if;
  select * into adv from public.ad_advertisers where owner_user_id = uid;
  if not found then raise exception 'ADS_NO_ADVERTISER: create an advertiser profile first'; end if;
  if adv.status <> 'active' then raise exception 'ADS_ADVERTISER_SUSPENDED'; end if;
  select * into p from public.ad_products where id = p_product_id and active;
  if not found then raise exception 'ADS_PRODUCT_UNAVAILABLE'; end if;
  days := ads_internal.validate_booking_dates(p, p_start, p_end);

  -- Serialise every reservation touching these physical units.
  units := ads_internal.lock_units(array(select unit_id from public.ad_product_units where product_id = p.id));
  if cardinality(units) = 0 or exists (select 1 from public.ad_inventory_units where id = any(units) and not active) then
    raise exception 'ADS_PRODUCT_UNAVAILABLE: inventory not active';
  end if;

  update public.ad_bookings set status = 'expired', closed_at = now(), status_reason = 'Hold lapsed unpaid'
    where status = 'held' and hold_expires_at <= now()
      and id in (select booking_id from public.ad_booking_inventory_days where unit_id = any(units));

  select count(*) into active_holds from public.ad_bookings
    where advertiser_id = adv.id and status = 'held' and hold_expires_at > now();
  if active_holds >= coalesce(ads_internal.setting_int('max_active_holds_per_advertiser'), 3) then
    raise exception 'ADS_TOO_MANY_HOLDS';
  end if;

  v_full := ads_internal.full_days(units, p_start, p_end, null);
  if cardinality(v_full) > 0 then
    raise exception 'ADS_CAPACITY_UNAVAILABLE' using detail = array_to_string(v_full, ',');
  end if;

  insert into public.ad_bookings (advertiser_id, product_id, start_date, end_date, status, hold_expires_at, is_test, created_by)
  values (adv.id, p.id, p_start, p_end, 'held',
          now() + make_interval(mins => coalesce(ads_internal.setting_int('hold_minutes'), 60)), p.is_test, uid)
  returning id into bid;

  insert into public.ad_booking_inventory_days (booking_id, unit_id, day)
  select bid, u, gs::date from unnest(units) u cross join generate_series(p_start, p_end, interval '1 day') gs;

  insert into public.ad_purchase_snapshots (booking_id, product_id, product_code, product_name, unit_codes,
    start_date, end_date, billable_days, price_per_day_pence, priority_fee_pence, total_pence, currency, is_test)
  select bid, p.id, p.code, p.name,
         (select array_agg(code order by code) from public.ad_inventory_units where id = any(units)),
         p_start, p_end, days, p.price_per_day_pence, 0, days * p.price_per_day_pence, p.currency, p.is_test;

  insert into public.ad_campaigns (booking_id, advertiser_id) values (bid, adv.id) returning id into cid;

  perform ads_internal.audit('advertiser', 'booking', bid, 'hold_created',
    jsonb_build_object('product', p.code, 'start', p_start, 'end', p_end, 'total_pence', days * p.price_per_day_pence));
  return bid;
end; $$;

create or replace function public.ad_cancel_hold(p_booking_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.ad_bookings;
begin
  if not ads_internal.owns_booking(p_booking_id) then raise exception 'ADS_NOT_FOUND'; end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;
  if b.status <> 'held' then raise exception 'ADS_INVALID_STATE: only an unpaid hold can be cancelled'; end if;
  if exists (select 1 from public.ad_payments where booking_id = b.id and status = 'open'
             and coalesce(session_expires_at, now() + interval '1 day') > now()) then
    raise exception 'ADS_CHECKOUT_IN_PROGRESS: wait for the open checkout to expire';
  end if;
  update public.ad_bookings set status = 'cancelled', closed_at = now(), status_reason = 'Cancelled by advertiser' where id = b.id;
  perform ads_internal.audit('advertiser', 'booking', b.id, 'hold_cancelled');
end; $$;

-- Returns the server-computed amount for the server-side checkout endpoint.
create or replace function public.ad_prepare_checkout(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
begin
  if not ads_internal.setting_bool('ads_checkout_enabled') then raise exception 'ADS_DISABLED: checkout is not enabled'; end if;
  if not ads_internal.owns_booking(p_booking_id) then raise exception 'ADS_NOT_FOUND'; end if;
  select * into b from public.ad_bookings where id = p_booking_id;
  if b.status <> 'held' or b.hold_expires_at <= now() then raise exception 'ADS_INVALID_STATE: hold is not active'; end if;
  if b.hold_expires_at < now() + interval '31 minutes' then
    raise exception 'ADS_HOLD_TOO_SHORT: less than 31 minutes left on this hold; cancel it and create a new one';
  end if;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  return jsonb_build_object(
    'booking_id', b.id, 'total_pence', s.total_pence, 'currency', s.currency, 'is_test', s.is_test,
    'product_name', s.product_name, 'start_date', s.start_date, 'end_date', s.end_date,
    'hold_expires_at', b.hold_expires_at);
end; $$;

-- ════════════════════════════════════════════════════════════════════
--  Service-role-only RPCs (called from api/ads/* with the server key)
-- ════════════════════════════════════════════════════════════════════

create or replace function public.ad_record_checkout_session(
  p_booking_id uuid, p_session_id text, p_amount_pence integer, p_currency text, p_livemode boolean, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare s public.ad_purchase_snapshots;
begin
  if p_livemode is distinct from ads_internal.setting_bool('stripe_livemode') then
    raise exception 'ADS_MODE_MISMATCH';
  end if;
  select * into s from public.ad_purchase_snapshots where booking_id = p_booking_id;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if p_amount_pence <> s.total_pence or lower(p_currency) <> s.currency then
    raise exception 'ADS_AMOUNT_MISMATCH';
  end if;
  insert into public.ad_payments (booking_id, livemode, checkout_session_id, amount_pence, currency, session_expires_at)
  values (p_booking_id, p_livemode, p_session_id, p_amount_pence, lower(p_currency), p_expires_at)
  on conflict (checkout_session_id) do nothing;
  perform ads_internal.audit('system', 'booking', p_booking_id, 'checkout_session_created',
    jsonb_build_object('session', p_session_id, 'amount_pence', p_amount_pence));
end; $$;

-- Applies ONE signature-verified Stripe event. p_event is normalised by
-- api/_ads/stripeWebhook.js: {id,type,livemode,created,session_id,
-- payment_intent_id,booking_id,amount_total,currency,payment_status,
-- charge_amount,amount_refunded}. Idempotent on event id; safe for
-- out-of-order delivery. Never changes review/approval state other than
-- (re)starting the review clock via refresh_review_state().
create or replace function public.ad_apply_stripe_event(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ev_id text := p_event->>'id';
  ev_type text := p_event->>'type';
  ev_live boolean := coalesce((p_event->>'livemode')::boolean, true);
  ev_booking uuid;
  pay public.ad_payments;
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
  units uuid[];
  v_outcome text;
  inserted_id uuid;
  refunded integer;
begin
  if ev_id is null or ev_type is null then raise exception 'ADS_BAD_EVENT'; end if;
  begin
    ev_booking := nullif(p_event->>'booking_id', '')::uuid;
  exception when invalid_text_representation then ev_booking := null;
  end;

  insert into public.ad_payment_events (provider_event_id, event_type, livemode, provider_created_at,
    checkout_session_id, payment_intent_id, booking_id)
  values (ev_id, ev_type, ev_live, to_timestamp(nullif(p_event->>'created', '')::double precision),
    p_event->>'session_id', p_event->>'payment_intent_id', ev_booking)
  on conflict (provider_event_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then return jsonb_build_object('outcome', 'duplicate'); end if;

  if ev_live is distinct from ads_internal.setting_bool('stripe_livemode') then
    v_outcome := 'ignored_mode_mismatch';
  elsif ev_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    select * into pay from public.ad_payments where checkout_session_id = p_event->>'session_id' for update;
    if not found then
      -- Session row missing (e.g. server died after Stripe created it).
      -- Recreate it only from a booking we know, at the snapshot amount.
      select * into s from public.ad_purchase_snapshots where booking_id = ev_booking;
      if not found or (p_event->>'session_id') !~ '^cs_(test|live)_[A-Za-z0-9]+$' then
        v_outcome := 'ignored_unknown_session';
      else
        insert into public.ad_payments (booking_id, livemode, checkout_session_id, amount_pence, currency)
        values (s.booking_id, ev_live, p_event->>'session_id', s.total_pence, s.currency)
        returning * into pay;
      end if;
    end if;
    if v_outcome is null and ev_booking is distinct from pay.booking_id then
      v_outcome := 'ignored_booking_mismatch';
    end if;
    if v_outcome is null and (p_event->>'payment_status') is distinct from 'paid' then
      v_outcome := 'awaiting_async_payment';
    end if;
    if v_outcome is null and ((p_event->>'amount_total')::integer is distinct from pay.amount_pence
                            or lower(p_event->>'currency') is distinct from pay.currency) then
      update public.ad_payments set requires_refund = true where id = pay.id;
      v_outcome := 'amount_mismatch_flagged';
    end if;
    if v_outcome is null and pay.status in ('refunded', 'partially_refunded') then
      v_outcome := 'ignored_already_refunded';
    end if;
    if v_outcome is null and pay.status = 'paid' then
      v_outcome := 'already_applied';
    end if;
    if v_outcome is null then
      update public.ad_payments
        set status = 'paid', paid_at = now(),
            payment_intent_id = coalesce(payment_intent_id, nullif(p_event->>'payment_intent_id', ''))
        where id = pay.id;
      units := ads_internal.lock_units(array(select distinct unit_id from public.ad_booking_inventory_days
                                             where booking_id = pay.booking_id));
      select * into b from public.ad_bookings where id = pay.booking_id for update;
      if b.status = 'held' or b.status = 'expired' then
        if cardinality(ads_internal.full_days(
             units, b.start_date, b.end_date, b.id)) = 0 then
          update public.ad_bookings set status = 'confirmed', confirmed_at = now(), closed_at = null,
            funding_payment_id = pay.id,
            status_reason = case when b.status = 'expired' or b.hold_expires_at <= now()
                                 then 'Paid after hold lapsed; capacity still available' end
            where id = b.id;
          v_outcome := case when b.status = 'held' and b.hold_expires_at > now() then 'confirmed' else 'confirmed_late' end;
          perform ads_internal.refresh_review_state((select id from public.ad_campaigns where booking_id = b.id));
        else
          update public.ad_bookings set status = 'payment_conflict', closed_at = now(),
            status_reason = 'Paid after hold lapsed and inventory was resold; refund required' where id = b.id;
          update public.ad_payments set requires_refund = true where id = pay.id;
          v_outcome := 'payment_conflict_refund_required';
        end if;
      else
        -- confirmed (second payment), cancelled, refunded, payment_conflict
        update public.ad_payments set requires_refund = true where id = pay.id;
        v_outcome := 'unexpected_payment_refund_required';
      end if;
    end if;
  elsif ev_type in ('checkout.session.expired', 'checkout.session.async_payment_failed') then
    update public.ad_payments
      set status = case when ev_type = 'checkout.session.expired' then 'expired' else 'failed' end
      where checkout_session_id = p_event->>'session_id' and status = 'open';
    v_outcome := case when found then 'session_closed' else 'ignored_not_open' end;
  elsif ev_type = 'charge.refunded' then
    select * into pay from public.ad_payments where payment_intent_id = p_event->>'payment_intent_id' for update;
    if not found then
      -- Refund arrived before we learned the payment intent: make Stripe
      -- retry later (whole transaction, including the event row, rolls back).
      raise exception 'ADS_RETRY_LATER: unknown payment intent';
    end if;
    refunded := coalesce((p_event->>'amount_refunded')::integer, 0);
    update public.ad_payments
      set amount_refunded_pence = greatest(amount_refunded_pence, refunded),
          status = case when greatest(amount_refunded_pence, refunded) >= amount_pence then 'refunded' else 'partially_refunded' end,
          requires_refund = case when greatest(amount_refunded_pence, refunded) >= amount_pence then false else requires_refund end
      where id = pay.id returning * into pay;
    -- Only the FUNDING payment's refund changes the booking. A refunded
    -- duplicate/conflict payment leaves a funded booking untouched; an
    -- unfunded booking (payment_conflict/held/expired) closes as refunded.
    if pay.status = 'refunded' then
      update public.ad_bookings set status = 'refunded', closed_at = now(), status_reason = 'Payment refunded'
        where id = pay.booking_id
          and (funding_payment_id = pay.id
               or (funding_payment_id is null and status in ('payment_conflict', 'held', 'expired', 'cancelled')));
      v_outcome := case when found then 'refunded' else 'non_funding_payment_refunded' end;
    else
      update public.ad_bookings
        set status_reason = 'Funding payment partially refunded: delivery and approval suspended pending MSM decision'
        where id = pay.booking_id and funding_payment_id = pay.id;
      v_outcome := 'partially_refunded_flagged';
    end if;
  else
    v_outcome := 'ignored_type';
  end if;

  update public.ad_payment_events set outcome = v_outcome, booking_id = coalesce(booking_id, pay.booking_id)
    where id = inserted_id;
  perform ads_internal.audit('stripe', 'booking', coalesce(pay.booking_id, ev_booking), 'stripe_event',
    jsonb_build_object('event', ev_id, 'type', ev_type, 'outcome', v_outcome));
  return jsonb_build_object('outcome', v_outcome);
end; $$;

-- Registers a COMPLETE creative version after api/ads/submit-creative has
-- downloaded both objects and verified magic bytes, size and pixel
-- dimensions server-side. p_desktop/p_mobile: {path,mime,bytes,width,height,sha256}.
create or replace function public.ad_submit_creative_version(
  p_actor_user_id uuid, p_campaign_id uuid, p_desktop jsonb, p_mobile jsonb, p_destination_url text, p_alt_text text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.ad_campaigns;
  a public.ad_advertisers;
  b public.ad_bookings;
  u public.ad_inventory_units;
  next_no integer;
  vid uuid;
  prefix text;
  side jsonb;
  side_name text;
begin
  select * into c from public.ad_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  select * into a from public.ad_advertisers where id = c.advertiser_id;
  if a.owner_user_id is distinct from p_actor_user_id or a.status <> 'active' then raise exception 'ADS_NOT_FOUND'; end if;
  select * into b from public.ad_bookings where id = c.booking_id;
  if b.status not in ('held', 'confirmed') then raise exception 'ADS_INVALID_STATE: booking is closed'; end if;
  if b.status = 'confirmed' and now() >= ads_internal.london_day_start(b.end_date + 1) then
    raise exception 'ADS_INVALID_STATE: booking has ended';
  end if;
  select iu.* into u from public.ad_inventory_units iu
    where iu.id = (select unit_id from public.ad_booking_inventory_days where booking_id = b.id limit 1);

  if not ads_internal.is_safe_destination(p_destination_url) then raise exception 'ADS_INVALID_DESTINATION'; end if;
  if p_alt_text is null or char_length(btrim(p_alt_text)) not between 3 and 250 then raise exception 'ADS_INVALID_ALT_TEXT'; end if;

  prefix := a.id::text || '/' || c.id::text || '/';
  foreach side_name in array array['desktop', 'mobile'] loop
    side := case when side_name = 'desktop' then p_desktop else p_mobile end;
    if side is null or left(side->>'path', length(prefix)) <> prefix
       or (side->>'path') !~ ('-' || side_name || '\.(png|jpg|jpeg|webp)$') then
      raise exception 'ADS_INVALID_CREATIVE: % path', side_name;
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ad-creatives-private' and o.name = side->>'path') then
      raise exception 'ADS_INVALID_CREATIVE: % object missing', side_name;
    end if;
    if (side->>'mime') not in ('image/png', 'image/jpeg', 'image/webp') then
      raise exception 'ADS_INVALID_CREATIVE: % type', side_name;
    end if;
    if (side->>'bytes')::integer not between 1 and u.max_bytes then raise exception 'ADS_INVALID_CREATIVE: % size', side_name; end if;
    if (side->>'width')::integer <> (case when side_name = 'desktop' then u.desktop_width else u.mobile_width end)
       or (side->>'height')::integer <> (case when side_name = 'desktop' then u.desktop_height else u.mobile_height end) then
      raise exception 'ADS_INVALID_CREATIVE: % dimensions', side_name;
    end if;
  end loop;

  select coalesce(max(version_no), 0) + 1 into next_no from public.ad_creative_versions where campaign_id = c.id;
  -- A pending (unreviewed) version is replaced; an approved one keeps
  -- serving until the replacement is itself approved.
  update public.ad_creative_versions set status = 'superseded'
    where campaign_id = c.id and status = 'submitted';

  insert into public.ad_creative_versions (campaign_id, version_no,
    desktop_object_path, desktop_mime, desktop_bytes, desktop_width, desktop_height, desktop_sha256,
    mobile_object_path, mobile_mime, mobile_bytes, mobile_width, mobile_height, mobile_sha256,
    destination_url, alt_text)
  values (c.id, next_no,
    p_desktop->>'path', p_desktop->>'mime', (p_desktop->>'bytes')::integer, (p_desktop->>'width')::integer, (p_desktop->>'height')::integer, p_desktop->>'sha256',
    p_mobile->>'path', p_mobile->>'mime', (p_mobile->>'bytes')::integer, (p_mobile->>'width')::integer, (p_mobile->>'height')::integer, p_mobile->>'sha256',
    p_destination_url, btrim(p_alt_text))
  returning id into vid;

  update public.ad_campaigns set current_version_id = vid where id = c.id;
  perform ads_internal.refresh_review_state(c.id);
  insert into public.ad_audit_log (actor_user_id, actor_kind, entity_type, entity_id, action, details)
  values (p_actor_user_id, 'advertiser', 'campaign', c.id, 'creative_submitted', jsonb_build_object('version_id', vid, 'version_no', next_no));
  return vid;
end; $$;

create or replace function public.ad_serving_lookup(p_version_id uuid, p_placement text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'approved', exists (select 1 from public.ad_creative_versions v where v.id = p_version_id
                        and (v.status = 'approved' or (v.status = 'superseded' and v.reviewed_at is not null))),
    'eligible', exists (select 1 from ads_internal.eligible_creatives(p_placement) e where e.creative_version_id = p_version_id),
    -- Destination of a version that is, or once was, approved (a replaced
    -- approved version keeps reviewed_at); never of a draft/rejected one.
    'destination_url', (select v.destination_url from public.ad_creative_versions v
                        where v.id = p_version_id
                          and (v.status = 'approved' or (v.status = 'superseded' and v.reviewed_at is not null))),
    'desktop_object_path', (select e.desktop_object_path from ads_internal.eligible_creatives(p_placement) e where e.creative_version_id = p_version_id),
    'mobile_object_path',  (select e.mobile_object_path  from ads_internal.eligible_creatives(p_placement) e where e.creative_version_id = p_version_id),
    'serve_until',         (select e.serve_until         from ads_internal.eligible_creatives(p_placement) e where e.creative_version_id = p_version_id))
$$;

create or replace function public.ad_record_metric(p_kind text, p_version_id uuid, p_placement text, p_client_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_hits integer;
  v_got text;
begin
  if p_kind not in ('impression', 'click') then raise exception 'ADS_BAD_METRIC'; end if;
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{32,64}$' then return 'rejected_client'; end if;

  insert into public.ad_rate_limits (client_key, window_start, hits) values (p_client_key, date_trunc('hour', now()), 1)
  on conflict (client_key, window_start) do update set hits = public.ad_rate_limits.hits + 1
  returning public.ad_rate_limits.hits into v_hits;
  if v_hits > 120 then return 'rate_limited'; end if;

  select * into e from ads_internal.eligible_creatives(p_placement) x where x.creative_version_id = p_version_id;
  if not found then return 'not_eligible'; end if;

  insert into public.ad_metric_dedupe (dedupe_key, expires_at)
  values (md5(p_kind || '|' || p_client_key || '|' || p_version_id::text || '|' || p_placement),
          now() + interval '30 minutes')
  on conflict (dedupe_key) do update set expires_at = excluded.expires_at
    where public.ad_metric_dedupe.expires_at <= now()
  returning dedupe_key into v_got;
  if v_got is null then return 'duplicate'; end if;

  insert into public.ad_metrics_daily (creative_version_id, unit_id, booking_id, day, impressions, clicks)
  values (p_version_id, e.unit_id, e.booking_id, ads_internal.london_today(),
          case when p_kind = 'impression' then 1 else 0 end, case when p_kind = 'click' then 1 else 0 end)
  on conflict (creative_version_id, unit_id, day) do update
    set impressions = public.ad_metrics_daily.impressions + excluded.impressions,
        clicks = public.ad_metrics_daily.clicks + excluded.clicks;
  return 'counted';
end; $$;

create or replace function public.ad_purge_tracking_state() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; m integer;
begin
  delete from public.ad_metric_dedupe where expires_at <= now();
  get diagnostics n = row_count;
  delete from public.ad_rate_limits where window_start < now() - interval '2 hours';
  get diagnostics m = row_count;
  return n + m;
end; $$;

create or replace function public.ad_expire_stale_holds() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  with x as (
    update public.ad_bookings set status = 'expired', closed_at = now(), status_reason = 'Hold lapsed unpaid'
    where status = 'held' and hold_expires_at <= now() returning id)
  select count(*) into n from x;
  return n;
end; $$;

-- Public delivery: approved, eligible creative + identifiers only. No
-- advertiser, booking, billing, contact or note data ever leaves here.
create or replace function public.ad_public_delivery(p_placement text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'creative_version_id', e.creative_version_id,
      'placement', p_placement,
      'alt_text', e.alt_text,
      'desktop', jsonb_build_object('width', e.desktop_width, 'height', e.desktop_height),
      'mobile',  jsonb_build_object('width', e.mobile_width,  'height', e.mobile_height),
      'serve_until', e.serve_until)), '[]'::jsonb)
  from ads_internal.eligible_creatives(p_placement) e
$$;

-- Date-range report for an advertiser's own booking (or any, for admins).
create or replace function public.ad_report(p_booking_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
  f date; t date;
begin
  if not (ads_internal.owns_booking(p_booking_id) or public.is_admin_or_above()) then raise exception 'ADS_NOT_FOUND'; end if;
  select * into b from public.ad_bookings where id = p_booking_id;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  f := greatest(coalesce(p_from, b.start_date), b.start_date);
  t := least(coalesce(p_to, b.end_date), b.end_date);
  return jsonb_build_object(
    'booking_id', b.id, 'status', b.status, 'product_name', s.product_name, 'placements', to_jsonb(s.unit_codes),
    'booked_start', b.start_date, 'booked_end', b.end_date, 'from', f, 'to', t, 'is_test', b.is_test,
    'generated_at', now(),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date,
        'impressions', coalesce((select sum(m.impressions) from public.ad_metrics_daily m where m.booking_id = b.id and m.day = d::date), 0),
        'clicks',      coalesce((select sum(m.clicks)      from public.ad_metrics_daily m where m.booking_id = b.id and m.day = d::date), 0))
        order by d)
      from generate_series(f, t, interval '1 day') d
      where f <= t), '[]'::jsonb));
end; $$;

-- ════════════════════════════════════════════════════════════════════
--  Admin RPCs
-- ════════════════════════════════════════════════════════════════════

create or replace function public.ad_admin_review(p_version_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.ad_creative_versions;
  c public.ad_campaigns;
  b public.ad_bookings;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'ADS_BAD_DECISION'; end if;
  select * into v from public.ad_creative_versions where id = p_version_id;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  select * into c from public.ad_campaigns where id = v.campaign_id for update;
  select * into b from public.ad_bookings where id = c.booking_id;
  if c.current_version_id is distinct from v.id or v.status <> 'submitted' then
    raise exception 'ADS_STALE_VERSION: only the latest submitted version can be reviewed';
  end if;
  if p_decision = 'approve' then
    if b.status <> 'confirmed' then raise exception 'ADS_NOT_PAID: booking must be paid and confirmed before approval'; end if;
    -- Same invariant as delivery: refunds of duplicate payments are
    -- irrelevant; any refund of the funding payment blocks approval.
    if not ads_internal.booking_funded(b.id) then
      raise exception 'ADS_NOT_FUNDED: the payment funding this booking has been (partly) refunded';
    end if;
    update public.ad_creative_versions set status = 'superseded'
      where id = c.approved_version_id and id <> v.id;
    update public.ad_creative_versions set status = 'approved', reviewed_at = now() where id = v.id;
    update public.ad_campaigns set approved_version_id = v.id, review_status = 'approved' where id = c.id;
  else
    if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
    update public.ad_creative_versions set status = 'rejected', reviewed_at = now(), rejection_reason = btrim(p_reason) where id = v.id;
    update public.ad_campaigns set review_status = 'rejected' where id = c.id;
  end if;
  perform ads_internal.audit('admin', 'creative_version', v.id, 'review_' || p_decision,
    jsonb_build_object('campaign_id', c.id, 'reason', p_reason));
end; $$;

create or replace function public.ad_admin_set_paused(p_campaign_id uuid, p_paused boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  update public.ad_campaigns set paused = p_paused where id = p_campaign_id;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  perform ads_internal.audit('admin', 'campaign', p_campaign_id, case when p_paused then 'paused' else 'unpaused' end,
    jsonb_build_object('reason', p_reason));
end; $$;

create or replace function public.ad_admin_cancel_booking(p_booking_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.ad_bookings;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if b.status not in ('held', 'confirmed', 'payment_conflict') then raise exception 'ADS_INVALID_STATE'; end if;
  update public.ad_bookings set status = 'cancelled', closed_at = now(), status_reason = 'Cancelled by MSM' where id = b.id;
  update public.ad_payments set requires_refund = true where booking_id = b.id and status = 'paid';
  perform ads_internal.audit('admin', 'booking', b.id, 'cancelled_by_admin', jsonb_build_object('reason', p_reason));
end; $$;

create or replace function public.ad_admin_set_setting(p_key text, p_bool boolean default null, p_int integer default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_key in ('ads_priority_review_enabled', 'ads_venue_gig_targeting_enabled', 'stripe_livemode') and coalesce(p_bool, false) then
    raise exception 'ADS_NOT_AVAILABLE_IN_PHASE_1: % cannot be enabled', p_key;
  end if;
  if p_key in ('hold_minutes') and (p_int is null or p_int not between 35 and 1440) then raise exception 'ADS_BAD_SETTING'; end if;
  if p_key in ('min_lead_days', 'max_advance_days', 'max_active_holds_per_advertiser') and (p_int is null or p_int not between 0 and 730) then
    raise exception 'ADS_BAD_SETTING';
  end if;
  update public.ad_settings set bool_value = coalesce(p_bool, bool_value), int_value = coalesce(p_int, int_value),
    updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  perform ads_internal.audit('admin', 'setting', null, 'setting_changed', jsonb_build_object('key', p_key, 'bool', p_bool, 'int', p_int));
end; $$;

create or replace function public.ad_admin_add_note(p_booking_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  insert into public.ad_admin_notes (booking_id, note, created_by) values (p_booking_id, p_note, auth.uid());
end; $$;

-- ════════════════════════════════════════════════════════════════════
--  Row level security
-- ════════════════════════════════════════════════════════════════════

alter table public.ad_settings enable row level security;
alter table public.ad_uk_holidays enable row level security;
alter table public.ad_inventory_units enable row level security;
alter table public.ad_products enable row level security;
alter table public.ad_product_units enable row level security;
alter table public.ad_advertisers enable row level security;
alter table public.ad_bookings enable row level security;
alter table public.ad_booking_inventory_days enable row level security;
alter table public.ad_purchase_snapshots enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_creative_versions enable row level security;
alter table public.ad_payments enable row level security;
alter table public.ad_payment_events enable row level security;
alter table public.ad_audit_log enable row level security;
alter table public.ad_admin_notes enable row level security;
alter table public.ad_metrics_daily enable row level security;
alter table public.ad_metric_dedupe enable row level security;
alter table public.ad_rate_limits enable row level security;

create policy ad_settings_admin_select on public.ad_settings for select to authenticated using (public.is_admin_or_above());
create policy ad_holidays_read on public.ad_uk_holidays for select to anon, authenticated using (true);
create policy ad_holidays_admin_write on public.ad_uk_holidays for all to authenticated
  using (public.is_admin_or_above()) with check (public.is_admin_or_above());

create policy ad_units_read on public.ad_inventory_units for select to authenticated
  using (active or public.is_admin_or_above());
create policy ad_units_admin_update on public.ad_inventory_units for update to authenticated
  using (public.is_admin_or_above()) with check (public.is_admin_or_above());
create policy ad_products_read on public.ad_products for select to authenticated
  using ((active and ads_internal.setting_bool('ads_portal_enabled')) or public.is_admin_or_above());
create policy ad_products_admin_update on public.ad_products for update to authenticated
  using (public.is_admin_or_above()) with check (public.is_admin_or_above());
create policy ad_product_units_read on public.ad_product_units for select to authenticated using (true);

create policy ad_advertisers_select on public.ad_advertisers for select to authenticated
  using (owner_user_id = auth.uid() or public.is_admin_or_above());
create policy ad_advertisers_insert on public.ad_advertisers for insert to authenticated
  with check (owner_user_id = auth.uid() and status = 'active');
create policy ad_advertisers_update on public.ad_advertisers for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy ad_bookings_select on public.ad_bookings for select to authenticated
  using (ads_internal.owns_advertiser(advertiser_id) or public.is_admin_or_above());
create policy ad_booking_days_select on public.ad_booking_inventory_days for select to authenticated
  using (ads_internal.owns_booking(booking_id) or public.is_admin_or_above());
create policy ad_snapshots_select on public.ad_purchase_snapshots for select to authenticated
  using (ads_internal.owns_booking(booking_id) or public.is_admin_or_above());
create policy ad_campaigns_select on public.ad_campaigns for select to authenticated
  using (ads_internal.owns_advertiser(advertiser_id) or public.is_admin_or_above());
create policy ad_versions_select on public.ad_creative_versions for select to authenticated
  using (ads_internal.owns_campaign(campaign_id) or public.is_admin_or_above());
create policy ad_payments_select on public.ad_payments for select to authenticated
  using (ads_internal.owns_booking(booking_id) or public.is_admin_or_above());
create policy ad_metrics_select on public.ad_metrics_daily for select to authenticated
  using (ads_internal.owns_booking(booking_id) or public.is_admin_or_above());
create policy ad_payment_events_admin on public.ad_payment_events for select to authenticated using (public.is_admin_or_above());
create policy ad_audit_admin on public.ad_audit_log for select to authenticated using (public.is_admin_or_above());
create policy ad_notes_admin on public.ad_admin_notes for select to authenticated using (public.is_admin_or_above());
-- ad_metric_dedupe / ad_rate_limits: RLS on, no policies, no grants.

-- ════════════════════════════════════════════════════════════════════
--  Grants (Supabase grants everything in public to anon/authenticated by
--  default -- revoke first, then grant only what each role needs)
-- ════════════════════════════════════════════════════════════════════

revoke all on public.ad_settings, public.ad_uk_holidays, public.ad_inventory_units, public.ad_products,
  public.ad_product_units, public.ad_advertisers, public.ad_bookings, public.ad_booking_inventory_days,
  public.ad_purchase_snapshots, public.ad_campaigns, public.ad_creative_versions, public.ad_payments,
  public.ad_payment_events, public.ad_audit_log, public.ad_admin_notes, public.ad_metrics_daily,
  public.ad_metric_dedupe, public.ad_rate_limits
  from anon, authenticated;

grant select on public.ad_uk_holidays to anon, authenticated;
grant insert, update, delete on public.ad_uk_holidays to authenticated;
grant select on public.ad_settings, public.ad_inventory_units, public.ad_products, public.ad_product_units,
  public.ad_advertisers, public.ad_bookings, public.ad_booking_inventory_days, public.ad_purchase_snapshots,
  public.ad_campaigns, public.ad_creative_versions, public.ad_payments, public.ad_payment_events,
  public.ad_audit_log, public.ad_admin_notes, public.ad_metrics_daily
  to authenticated;
grant insert (display_name, contact_email) on public.ad_advertisers to authenticated;
grant update (display_name, contact_email) on public.ad_advertisers to authenticated;
grant update (name, rotation_capacity, active) on public.ad_inventory_units to authenticated;
grant update (name, description, price_per_day_pence, min_days, max_days, active) on public.ad_products to authenticated;

-- Functions: revoke the default PUBLIC/anon/authenticated EXECUTE, then
-- grant precisely.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname like 'ad\_%') or n.nspname = 'ads_internal' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;

-- RLS/storage policy helpers must be executable by the querying role.
grant execute on function ads_internal.setting_bool(text), ads_internal.owns_advertiser(uuid),
  ads_internal.owns_booking(uuid), ads_internal.owns_campaign(uuid),
  ads_internal.creative_path_owner_ok(text, boolean) to authenticated;

grant execute on function public.ad_public_flags(), public.ad_public_delivery(text) to anon, authenticated, service_role;
grant execute on function public.ad_quote(uuid, date, date), public.ad_create_hold(uuid, date, date),
  public.ad_cancel_hold(uuid), public.ad_prepare_checkout(uuid), public.ad_report(uuid, date, date),
  public.ad_expire_stale_holds(),
  public.ad_admin_review(uuid, text, text), public.ad_admin_set_paused(uuid, boolean, text),
  public.ad_admin_cancel_booking(uuid, text), public.ad_admin_set_setting(text, boolean, integer),
  public.ad_admin_add_note(uuid, text)
  to authenticated;
grant execute on function public.ad_record_checkout_session(uuid, text, integer, text, boolean, timestamptz),
  public.ad_apply_stripe_event(jsonb), public.ad_submit_creative_version(uuid, uuid, jsonb, jsonb, text, text),
  public.ad_serving_lookup(uuid, text), public.ad_record_metric(text, uuid, text, text),
  public.ad_purge_tracking_state(), public.ad_expire_stale_holds()
  to service_role;

-- ════════════════════════════════════════════════════════════════════
--  Private storage for draft + approved creative (never public)
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-creatives-private', 'ad-creatives-private', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Advertisers may only INSERT new objects under their own
-- <advertiser>/<open campaign>/ prefix. No UPDATE/DELETE policy exists, so
-- an uploaded (and possibly approved) file can never be overwritten.
create policy ads_creatives_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ad-creatives-private' and ads_internal.creative_path_owner_ok(name, true));
create policy ads_creatives_owner_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'ad-creatives-private'
         and (ads_internal.creative_path_owner_ok(name, false) or public.is_admin_or_above()));
