# Advertising phase 1 — architecture

## Data model (all additive, stable UUID ids)

| Table | Role | Who can read | Who can write |
|---|---|---|---|
| `ad_settings` | toggles/tunables | admin | `ad_admin_set_setting()` (audited) |
| `ad_uk_holidays` | non-working days for deadlines | everyone | admin |
| `ad_inventory_units` | **physical** positions + per-day `rotation_capacity` + artwork spec | signed-in (active) / admin | admin (name, capacity, active) |
| `ad_products` | sellable packages (price per day, min/max days) | signed-in when portal on / admin | admin (price, limits, active) |
| `ad_product_units` | package → physical units (many-to-many) | signed-in | migration/admin SQL |
| `ad_advertisers` | one per auth user; private contact | owner, admin | owner (name, email only) |
| `ad_bookings` | reservation: dates, status, hold expiry | owner, admin | RPCs only |
| `ad_booking_inventory_days` | one row per unit per London day reserved | owner, admin | RPCs only |
| `ad_purchase_snapshots` | **immutable** server-computed price | owner, admin | `ad_create_hold()` only |
| `ad_campaigns` | 1:1 with booking; review state, current/approved version, paused | owner, admin | RPCs only |
| `ad_creative_versions` | **immutable** artwork+link versions | owner, admin | service RPC only |
| `ad_payments` | Stripe checkout sessions/payment state | owner, admin | service RPCs only |
| `ad_payment_events` | verified Stripe event ids (idempotency) | admin | service RPC only |
| `ad_audit_log` | append-only audit | admin | definer functions |
| `ad_admin_notes` | private MSM notes | admin | admin RPC |
| `ad_metrics_daily` | per version/unit/London day impressions + clicks | owner, admin | service RPC only |
| `ad_metric_dedupe`, `ad_rate_limits` | short-lived HMAC keys | nobody (no grants) | service RPC only |

Storage: private bucket `ad-creatives-private` (1 MB, PNG/JPEG/WebP). Advertisers may only **insert** under `<advertiser_id>/<campaign_id>/<uuid>-(desktop|mobile).<ext>` for their own open booking. There is no update/delete policy, so an uploaded file can never be overwritten after approval. Approved images are served through `/api/ads/creative`, which only issues a short-lived signed URL while that version is approved **and** currently eligible. Drafts are never public, and the public `band-photos` bucket is not used.

## Inventory and concurrency

Capacity is counted per **physical unit per London day**, across every product mapped to the unit. Two packages that share a unit can never oversell it. `ad_create_hold()` and the payment-confirmation path take `FOR UPDATE` locks on the unit rows in id order, then count `confirmed` bookings plus `held` bookings whose `hold_expires_at > now()`. Concurrent reservations for the same unit therefore serialise without deadlocks. This is proven by the 12-session race in `scripts/ads-local-db-test.sh`.

## Booking state machine

```
held ──(verified payment, hold valid)──────────────▶ confirmed ──(full refund)──▶ refunded
 │  └─(verified payment after lapse, capacity free)─▶ confirmed
 │  └─(verified payment after lapse, resold)───────▶ payment_conflict (refund required) ──(refund)──▶ refunded
 ├─(time passes; lazy sweep / ad_expire_stale_holds)▶ expired ─(late payment)─▶ confirmed | payment_conflict
 ├─(advertiser cancels; not during open checkout)───▶ cancelled
 └─(admin removes)──────────────────────────────────▶ cancelled (after 20261016150000: cancellation case recorded,
                                                        NO automatic refund flag; financial assessment separate)
```

Stripe Checkout sessions expire at `hold_expires_at`, and checkout may only start with ≥31 minutes left (Stripe's minimum session life is 30), so late payments are rare but handled.

## Payment events (`ad_apply_stripe_event`)

Signature verified on the raw body (`api/_ads/stripeSignature.js`, 300 s tolerance), then normalised to minimal fields. The event row is inserted with `ON CONFLICT DO NOTHING`, so duplicates return `duplicate` and parallel duplicates apply once.

| Event | Effect |
|---|---|
| livemode ≠ configured (test) | recorded, `ignored_mode_mismatch` |
| `checkout.session.completed` / `async_payment_succeeded`, `payment_status=paid` | amount and currency must equal the session row (= snapshot); booking id must match metadata; payment → `paid`; booking confirmed / confirmed_late / payment_conflict as above; review clock may start. **Never approves.** |
| same, already paid / already refunded | no-op (`already_applied` / `ignored_already_refunded`) |
| unknown session but known booking | payment row recreated at the **snapshot** amount |
| `checkout.session.expired` / `async_payment_failed` | only an `open` payment changes (an expiry arriving after payment is ignored) |
| `charge.refunded` | updates the refunded amount. Only a refund of the booking's **funding payment** changes the booking: full → `refunded`, partial → still `confirmed` but unfunded, so delivery and approval stop pending an MSM decision. Refunding a duplicate or conflicting payment never touches a funded booking (`non_funding_payment_refunded`). An unfunded booking (`payment_conflict`/`held`/`expired`/`cancelled`) closes as `refunded`. If the payment intent is not known yet, it raises `ADS_RETRY_LATER` (rolled back, HTTP 503) so Stripe retries after the completion event |

The return URL is never treated as evidence. The portal only re-reads the booking.

### Funding invariant

`ad_bookings.funding_payment_id` is set exactly once: to the payment whose verified event confirmed the booking. Duplicate, late-conflicting or post-cancellation payments are flagged `requires_refund` and never become the funding payment.

`ads_internal.booking_funded(booking)` is true iff the booking is `confirmed` **and** its funding payment is `paid` (or `partially_refunded`), matches the snapshot amount and currency, and has refunded **no more than the total of APPROVED refund assessments** (and less than the full amount). Before `20261016150000` the condition was `amount_refunded_pence = 0`. The **same function** gates public delivery (`eligible_creatives`) and approval (`ad_admin_review`). So:

- refunding duplicate payment B leaves A funding the booking, and original or replacement approval still succeeds;
- any refund of A beyond approved assessments (partial or full) immediately stops delivery and blocks approval; an approved partial refund (e.g. a missed priority fee) does not;
- no code path can deliver or approve an unfunded booking.

Regression: `supabase/tests/ads/10_ads_phase1_regression.sql` (booking b5 and the b1 replacement/partial-refund sequence).

## Review and approval

- A creative version is created only when **complete** (both images verified server-side for magic bytes, exact pixel size and ≤1 MB, plus an https destination and alt text). Content columns are immutable by trigger.
- **Earliest standard start date** (`ads_internal.earliest_standard_start`, migration `20261016090000`): the London date on which the standard review window ends if the advertiser were ready now, i.e. the day after the next UK working day. Optionally it is pushed later by `today + min_lead_days`. Enforced in `validate_booking_dates` for quote and hold; exposed to the portal by `ad_earliest_start()`. It assumes readiness at hold time and promises nothing; later readiness moves the review later. **Current implementation:** only the remaining booked days run. That is a limitation, **not** the agreed policy (next point).
- The **review clock** starts once per version, at the moment "booking confirmed (fully paid)" and "complete version" first coincide. Deadline: `review_due_before` = 00:00 Europe/London after the **next UK working day** (weekends and the `ad_uk_holidays` table skipped; DST-aware). The portal shows "Under review — decision due by end of Mon 19 Oct 2026 (UK time)".
- `ad_admin_review(version, approve|reject, reason)` is admin-only and bound to one version id. It only accepts the latest submitted version of a **funded** booking (see the funding invariant). A refunded duplicate payment does not block it. A rejection needs a reason (shown to the advertiser).
- Replacement: a new version goes back to review. The previously approved version keeps serving until the replacement is approved, then becomes `superseded`. A pending unreviewed version is superseded by a newer submission.

## Delivery, clicks and impressions

- `ad_public_delivery(placement)` (anon) returns only `creative_version_id`, placement, alt text, dimensions and `serve_until` for: delivery toggle on, unit active, booking `confirmed` and **funded**, campaign not paused, approved version, and now inside `[00:00 London start_date, 00:00 London end_date+1)`. There is no advertiser, booking, billing, contact or note data.
- `/api/ads/delivery` adds image URLs on the calendar domain and an HMAC **serve token** binding (version, placement, issued-at). Cache: 60 s, capped at the soonest `serve_until`. `/api/ads/creative` signs image URLs for ≤ 600 s and caches its redirect ≤ 300 s, both capped at `serve_until`.
- The WordPress script enforces hard expiry, resume rechecks and a bounded 2-minute eligibility refresh in both rendering modes (see "Removal latency" in README.md).
- `/api/ads/click?t=` verifies the token, then redirects only to the destination stored on a version that is, or was, approved. Anything else goes to `ADS_CLICK_FALLBACK_URL`. Clicks count only while eligible, non-bot and deduped. There is no open redirect: the destination never comes from the request.
- `/api/ads/impression` (sendBeacon, text/plain) counts only a valid, ≤24 h token for a currently eligible version at that placement. The browser script sends it after **≥50% of pixels are visible for ≥1 continuous second while the tab is visible**, at most once per page view.
- Privacy: the visitor key = HMAC(secret, London day | IP | UA), held for 30 minutes for dedupe, plus hourly rate buckets (120 events/hour). Only daily aggregates are kept. No IPs, cookies or personal data are stored.

## Reports

`ad_report(booking, from, to)` (owner or admin) clamps the range to the booked dates and returns one row per London day. `/api/ads/report` renders CSV (formula-injection safe) or a dependency-free PDF, and prints the measurement limitations.

## Later extensions (design only, not built)

**RELEASE BLOCKER: agreed date revision (not implemented).** The agreed policy is that a campaign needing changes remains **on hold** and affected dates are revised **with the advertiser**. The current behaviour is that rejected campaigns aren't delivered while booked dates elapse, late approval runs only the remaining days, a rejected replacement keeps the old approved version serving, and dates never move. That is an implementation limitation, not policy. Required design:
- an on-hold state that suspends delivery;
- an append-only `ad_reschedule_proposals` record, with proposals from either side;
- acceptance only by the booking owner via an owner-only RPC;
- acceptance that atomically re-checks and re-reserves capacity under the per-unit locks and releases the old unconsumed days;
- an immutable snapshot plus an amendment record;
- unchanged funding-invariant and webhook rules;
- delivery and reports that follow accepted dates;
- UI, notifications and tests.

Price, top-up and refund consequences of changed dates are **undecided**, and no refund policy is assumed. Full list in README ("Incomplete / deliberately deferred").


**Priority initial review, corrections, refunds and cancellation (agreed 2026-10-16)**: implemented in `20261016120000` and `20261016150000` (applied on staging only, reviewer 2026-10-17; not on production). Model: `ad_review_deadlines` (immutable, one row per clock), `ad_review_events` (append-only), `ad_correction_requests` + `ad_correction_notices` (mailer/fallback delivery, idempotent), `ad_booking_confirmations` (written once), `ad_refund_assessments` → `ad_refund_lines` → `ad_refund_processing_events`, `ad_cancellation_cases`. Time: `ads_internal.clock_now()` (test clock only outside API sessions), `ads_internal.add_uk_working_hours`. Status per agreed term: `agreed-terms-implementation.md`.

**Series-level targeting** (e.g. `start-a-band` episodes, existing and future). Add `ad_targeting_rules(id, product_id, kind, value)` with `kind in ('placement','series','format')`. A series product maps to logical units such as `wordpress-article-series-start-a-band-top`, and the WordPress article filter already passes `series_id`, `format`, `position` and `placement`. Delivery would resolve the article context to the series unit **at request time**, so newly published qualifying episodes are covered automatically. Capacity stays on the physical unit, so series packages and run-of-site packages that share a slot still cannot oversell it. The plugin's `msm_ads_article_placement()` already produces the canonical codes. The `msm_article_ad_delivery` semantics (false hides, '' = house fallback) must stay.

**Bundles**: a product mapped to several units in `ad_product_units`. Holds already lock and check every mapped unit atomically, so bundles need only pricing and UI.

**Venue/gig advertising**: OFF (`ads_venue_gig_targeting_enabled` locked false). It would add Calendar-surface units and entity targeting rules. It must not reuse `featured_listings` or `founding_supporters`.
