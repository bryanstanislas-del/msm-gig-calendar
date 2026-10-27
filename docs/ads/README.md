# MSM shared advertising platform — Phase 1

**Status: built and tested locally. All ads migrations through `20261017120000` and the Calendar shell fixture are applied ONLY to the staging Supabase project (reviewer, 2026-10-17; see `launch-checklist.md`). NOT applied to production, NOT deployed to production, NOT installed in WordPress, NOT connected to Stripe with any key.** Everything ships disabled by default.

## Current status (as REPORTED BY CODEX, 2026-10-16; not re-verified from this sandbox; no secret values recorded here)

| Area | State |
|---|---|
| **Production** Supabase `fmlaaiolqwknowhtdeue` | **Nothing ads-related applied.** No ads migration, no bootstrap. A separate production **gig-submission fix** was merged and deployed by Bryan on 2026-10-16 ([#47](https://github.com/bryanstanislas-del/msm-gig-calendar/pull/47)); that is **not** an ads deployment. |
| **Staging** Supabase msm-ads-staging `oyakrgdmplmxmlhjfqcd` | Bootstrap, `20261015120000` and (reviewer, 2026-10-17) all eight later ads migrations through `20261017120000`, plus the Calendar shell fixture: this project only. Postflight: switches 0; bookings, payments, outbox and amendments 0; bucket private; RLS on every public table; 2 synthetic users. The branch preview loads against staging (0 gigs / 0 venues). Current details: `launch-checklist.md`. |
| Staging users | Synthetic `admin+msm-staging@example.invalid` and `advertiser+msm-staging@example.invalid` created and confirmed. Admin grant separately authorised and both roles verified (`user_roles` + `profiles`). The advertiser has no privileged role. |
| Vercel | Preview env, **this branch only**: staging Supabase vars, a restricted Stripe **sandbox** key, the webhook signing secret, the tracking secret and the public base URL are saved. Preview of `12feb50` redeployed **Ready**, ID `21gAEyrkfaBW4dbGMDJcFP4VaLPP` (2026-10-16 08:46 BST). Nothing in Production env; **ads not deployed to production**. |
| `ADS_API_ENABLED` | **Unset / off.** The ads API reports disabled and delivery is empty. |
| Deployed API | **Unverified.** Browser security policy blocks direct checks of the preview's `/api/ads/*`, so the routing fix, JSON responses and webhook raw-body handling have not been observed live. |
| Stripe | Sandbox `acct_1UQvPbRhBFkeZB2o` (livemode=false). A webhook endpoint exists for the five documented events, pinned to `2026-09-30.endive`. **Zero test deliveries** observed at setup. **Checkout and webhooks are untested.** |
| WordPress | Plugin **not installed** anywhere. |

> **Launch status, exact remaining configuration and the staged migration sequence:** [`launch-checklist.md`](launch-checklist.md).
>
> **Agreed terms of 2026-10-16** (review, corrections, priority, intervals, refunds, cancellation): see **[`agreed-terms-implementation.md`](agreed-terms-implementation.md)** for the gap matrix, migration order, the staging manual test script and the release blockers. Where this README and that document differ, that document is current.

## What is in this PR

| Area | Files |
|---|---|
| Additive migration (applied on staging only) | `supabase/migrations/20261015120000_ads_platform_phase1.sql` |
| Forward migrations (applied on staging only, reviewer 2026-10-17; not on production) | `20261016090000_ads_standard_earliest_start.sql`, `20261016120000_ads_review_corrections_priority.sql`, `20261016150000_ads_refund_cancellation_assessment.sql` |
| Manual, guarded rollback | `supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql` |
| DB tests (local only) | `supabase/tests/ads/*.sql`, `scripts/ads-local-db-test.sh` |
| Server API (one Vercel function) | `api/ads.js` (reached via the `/api/ads/:action` rewrite in `vercel.json`), `api/_ads/*.js` |
| Shared rules (browser + server) | `src/ads/*.js` |
| Advertiser portal / admin UI | `src/components/ads/AdvertiserPortal.jsx`, `src/components/admin/AdminAds.jsx`, small additive edits in `src/App.jsx` |
| WordPress adapter (not installed) | `wordpress/msm-ads/` (see its `INSTALL.md`) |

Existing Calendar behaviour is unchanged: `promo_slots` / `PromoSlot.jsx` / `AdminPromoSlots.jsx`, `featured_listings` and `founding_supporters` are not touched. `founding_supporters` is recognition and is never sold. The new ADVERTISE tab only appears when `ads_portal_enabled` is on. The new admin-only ADS tab sits next to PROMO SLOTS.

## Feature toggles (table `ad_settings`, all default OFF)

| Key | Effect | Phase 1 |
|---|---|---|
| `ads_portal_enabled` | Advertiser portal, quotes, holds, uploads | can be enabled |
| `ads_checkout_enabled` | Stripe Checkout may start | can be enabled (TEST only) |
| `ads_delivery_enabled` | Public delivery kill switch | can be enabled |
| `ads_priority_review_enabled` | Optional £150 priority review (12 elapsed hours) | default OFF; admin may enable **only when MSM can cover it** (after `20261016120000`) |
| `ads_venue_gig_targeting_enabled` | Venue/gig advertising | **locked off** |
| `stripe_livemode` | Expected Stripe mode | **locked false** |
| `priority_fee_pence` (15000), `order_terms_version` (text, `DRAFT-NOT-APPROVED-2026-10-16`) | priority fee / terms version stored in snapshots | after `20261016120000` |
| `hold_minutes` (60), `min_lead_days` (0 after `20261016090000`; optional extra floor), `max_advance_days` (365), `max_active_holds_per_advertiser` (3) | tunables | TEST values |

**Earliest bookable start (standard).** This is derived server-side from the agreed review window: review by the **end of the next UK working day** after payment **and** complete artwork/link. So the earliest start is the day after that working day, computed as if the advertiser were ready **now**. For example, ready Friday 17:00 → review by end of Monday → earliest start **Tuesday**. Weekends and `ad_uk_holidays` are skipped, and the calculation is Europe/London and DST-aware. `ad_quote`/`ad_create_hold` reject earlier dates whatever the client sends, and the portal's date picker uses `ad_earliest_start()` for its min/default. **Delayed readiness (current implementation, NOT agreed policy):** if payment or artwork arrives later, the review deadline moves later. If approval lands after the first booked day, the advert runs only on the remaining booked days; dates are not moved and nothing is refunded automatically. This is an **implementation limitation**. The agreed policy is different and unbuilt: see **RELEASE BLOCKER: agreed date revision** below. Approval is never promised. `min_lead_days`, if raised, only adds a later floor (today + N).

There is also a server kill switch, `ADS_API_ENABLED`. Seeded inventory (`wordpress-home-top/-middle/-bottom`) and the two TEST packages (`TEST-wp-home-top-daily`, `TEST-wp-home-top-weekly`, which share the same physical unit) are all `active = false`, `is_test = true`, and use placeholder prices.

## Environment variables

Server-only (Vercel project env, **never** `VITE_*`, never in WordPress or the browser):

| Name | Purpose | Status |
|---|---|---|
| `ADS_API_ENABLED` | `true` to enable `/api/ads/*` | **off / not set** in every environment (API returns disabled / house fallback) |
| `SUPABASE_URL` | Supabase project URL | Preview (this branch only): **staging** URL configured, per MSM. Production: not set for ads |
| `SUPABASE_ANON_KEY` | public anon key (user-scoped RPCs) | Preview (this branch only): **staging** anon key configured, per MSM. Production: not set for ads |
| `SUPABASE_SERVICE_ROLE_KEY` | narrow service RPCs + private storage reads | Preview (this branch only): **staging** service key configured, per MSM. Production: **not set** |
| `STRIPE_SECRET_KEY` | Stripe **test** key; prefer a **restricted** `rk_test_…` key (see "Stripe integration"); any non-test key is refused | Preview (this branch only): restricted **sandbox** key saved, per Codex. Production: not set |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` for the test webhook endpoint | Preview (this branch only): sandbox endpoint signing secret saved, per Codex. Production: not set |
| `ADS_TRACKING_SECRET` | ≥32 random chars; signs serve tokens and keys visitor hashes | Preview (this branch only): saved, per Codex. Production: not set |
| `ADS_PUBLIC_BASE_URL` | defaults to `https://calendar.musicscenemagazine.co.uk` | Preview (this branch only): saved, per Codex |
| `ADS_CLICK_FALLBACK_URL` | where invalid clicks go (default `https://musicscenemagazine.co.uk/`) | optional |
| `ADS_EMAIL_ENABLED` | `true` lets the outbox worker send (DB switch `ads_email_enabled` must also be on) | **not set** anywhere |
| `ADS_WORKER_SECRET` | ≥32 chars; bearer secret for `/api/ads/notify-worker` | not set |
| `RESEND_API_KEY` | existing provider key name (shared with `api/notify.js`) | not changed |
| `ADS_EMAIL_FROM` | ads sender (no default; must be a verified Resend domain) | not set |
| `ADS_ADMIN_ALERT_EMAIL` | recipient of priority review alerts | not set |
| `ADS_RESEND_WEBHOOK_SECRET` | `whsec_…` for `/api/ads/email-events` | not set |

Claude created, changed and used no credentials; the preview values above were configured by MSM/Codex. When something is missing, the endpoints answer `503 ADS_NOT_CONFIGURED` and list the missing variable **names** (never values). Delivery quietly returns no adverts, so the house advert stays.

WordPress (`wp-config.php`): `MSM_ADS_ENABLED` (default false), `MSM_ADS_API_BASE`, `MSM_ADS_MODE` (`js` default / `server`). None of these are secrets.

## Local setup and tests

```bash
npm ci
npm test                 # all unit tests incl. ads (Stripe/Supabase MOCKED and labelled)
npm run build
npm run test:wp          # WordPress adapter, PHP with stubbed WP functions

# DB tests: a LOCAL disposable Postgres 16 only (script refuses remote hosts)
PGHOST=/path/to/socket-or-localhost PGPORT=5432 PGUSER=postgres npm run test:ads-db
#   or ADS_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:ads-db
```

`test:ads-db` builds throwaway databases from `supabase/tests/ads/00_local_supabase_shim.sql`. That shim is a minimal stand-in for the Supabase roles, `auth`, `storage`, `profiles`, `user_roles` and `is_admin_or_above()`, copied from read-only introspection of the live definitions. The script then applies the ads migration and runs:

- **RLS/state machine suite** (175+ checks, including the funding invariant): owner, other user, anon, admin (role- and profile-based) permissions; self-pay/approve/price/date tampering; shared inventory; webhook duplicates, mode mismatch, tampered amounts, out-of-order expiry/refund, late payment with and without capacity, double payment, partial/full refunds; payment-vs-approval separation; creative immutability and replacement review; draft/rejected never served or redirected; pause/kill switch; booked-date window; metrics dedupe, eligibility, rate limit; report clamping; DST and UK holiday deadlines.
- **Concurrency**: 12 parallel sessions race for one capacity-1 day across both packages (exactly 1 succeeds), and 8 parallel deliveries of the same webhook (exactly 1 applies).
- **End-to-end**: real API handlers + real DB functions (only Stripe session creation and storage bytes are mocked).
- **Review/corrections/priority suite** (`20_`) and **refunds/cancellation suite** (`30_`), driven by the test-only clock `ads.test_now` (ignored for API sessions).
- **Rollback**: guard refuses with files present, then removes every ads object and nothing else.

See the PR description for the latest exact test counts.

## Verification and deploy order (isolated preview BEFORE merge)

**Two different Vercel deployments exist and they must not be confused:**

| | Automatic PR preview (already "Ready" for PR #46) | Production |
|---|---|---|
| Created by | Vercel, on every push to this branch | merging to `main` |
| URL | a `*.vercel.app` preview URL | `calendar.musicscenemagazine.co.uk` |
| Uses | **Preview**-scoped env vars | **Production**-scoped env vars |
| Today | ads code is present but inert: no ads env vars, so `/api/ads/*` reports disabled and delivery is empty. **Caution:** the browser still uses the hard-coded *production* Supabase project unless the preview overrides below are set | unchanged until merge |

The existing Ready preview is **not** a staging verification. With no overrides it reads the production database (where no ads tables exist), so the ADVERTISE tab simply stays hidden. Everything below happens **before merge**, on isolated resources:

1. **Isolated database.** Use the separate staging project **msm-ads-staging (`oyakrgdmplmxmlhjfqcd`)**, never production. A fresh project lacks the Calendar's `profiles`/`user_roles`/role helpers, so first follow **`supabase/staging/README.md`**: read-only preflight → guarded bootstrap → the ads migrations **unchanged, in filename order** (`20261015120000_…`, `20261016090000_…`, `20261016120000_…`, `20261016150000_…`) → read-only postflight → synthetic accounts via the dashboard → separately authorised admin grant.
2. **Preview-scoped env vars only.** In Vercel, add variables scoped to **Preview** and, where possible, to this git branch only (branch-specific preview variables), **never Production**:
   - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`: the **staging** project (build-time; makes the preview browser use staging instead of production).
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: staging.
   - `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET`, `ADS_TRACKING_SECRET`, `ADS_API_ENABLED=true`, and `ADS_PUBLIC_BASE_URL` = the preview URL.

   Then redeploy the preview. Confirm in the browser network tab that the preview calls the **staging** Supabase host.
3. **Stripe test webhook → preview.** In Stripe **test mode**, add an endpoint `https://<preview-url>/api/ads/webhook`, created with API version **`2026-09-30.endive`** (the version the code pins), for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` and `charge.refunded`. If Vercel Deployment Protection is on for previews, Stripe gets a 401: use a Protection Bypass for Automation secret on the URL or test with `stripe listen --forward-to`, and do not disable protection for production.
4. **Verify API routing on the preview** (works with or without the env vars above; check it on the current preview too): open `<preview>/api/ads/delivery?placement=wordpress-home-top` directly. Expect JSON `{"placement":"wordpress-home-top","label":"Advertisement","ads":[]}` while ads are disabled, **not** the Calendar HTML. `/api/ads/<action>` reaches the static function `api/ads.js` only through the explicit `vercel.json` rewrite; a dynamic `api/ads/[action].js` was shadowed by the SPA fallback on the 96cc773 preview. Locally this is covered by `tests/vercelRouting.test.js`, which models the routes from Vercel's own transformer against the real build.
5. **Verify raw-body handling on Vercel** (cannot be proven locally): `stripe listen --forward-to <preview>/api/ads/webhook` then `stripe trigger checkout.session.completed`. Expect `200` with outcome `ignored_unknown_session`, not `400 INVALID_SIGNATURE` / `RAW_BODY_UNAVAILABLE`.
6. **Run the slice on the preview** as a staging admin. Activate the TEST unit and package, enable portal, checkout and delivery, then work through:
   - hold → pay with a test card → booking becomes Paid / Under Review (never approved by payment) → upload → approve → `/api/ads/delivery?placement=wordpress-home-top` returns the advert.
   - Pause it, refund it in Stripe (test), and turn off the kill switch, checking delivery empties each time.
   - Download CSV and PDF reports.
7. **Staging WordPress** (not production) per `wordpress/msm-ads/INSTALL.md`, with `MSM_ADS_API_BASE` = the preview URL. Check house fallback, hard expiry (book a 1-day slot), revocation within the latency below, and impressions only after the image loads.
8. Only after steps 1–7 pass: mark the PR ready, review, merge. **Merging deploys production code that stays inert**, because production has no ads env vars and the production database has no ads tables or toggles.
9. Production enablement is a separate, later decision: apply the migration to production, add Production-scoped env vars (Stripe stays test until live mode is built and approved), set up scheduled maintenance (`ad_expire_stale_holds()`, `ad_purge_tracking_state()` every ~15 min; not configured), install the plugin on the live WordPress, and only then switch on toggles.

## Removal latency (how quickly an advert disappears)

| Event | JS mode (default) | Server mode (PHP-rendered) with JS | Server mode, visitor without JS |
|---|---|---|---|
| Booked end (`serve_until`) | at the exact instant in a visible tab; immediately on resume for a suspended/background tab (`visibilitychange`/`pageshow`) | same | up to the page-cache TTL (keep ≤ 5 min) |
| Pause, refund, kill switch, rejected replacement | ≤ ~4 min while visible: 120 s refresh + 60 s WordPress transient + 60 s delivery edge cache; on resume, rechecked at once if the last check is > 30 s old | same | up to the page-cache TTL + 2 min |
| Image URL validity | signed URL ≤ 600 s and never past the booked end; its redirect is cached ≤ 300 s (also capped at the booked end) | same | same |

Hidden tabs do not poll. A CDN in front of WordPress must not cache `/wp-json/msm-ads/v1/slot` beyond 60 s, otherwise add its TTL to the figures above. A refresh that fails on the network keeps the advert (it was eligible) but never past its hard expiry. Impressions are only counted while the advert is eligible: the server re-checks eligibility on every beacon, so a revoked advert cannot be counted even during this window.

## Rollback

- Fastest: turn `ads_delivery_enabled` off (adverts disappear within the removal latency above), or set `ADS_API_ENABLED` to anything but `true`, or set `MSM_ADS_ENABLED` to false in WordPress / deactivate the plugin.
- Code: revert the PR. The Calendar does not depend on any ads object.
- Database: export the ads tables, empty the `ad-creatives-private` bucket via the dashboard or API, then run `supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql`. It refuses to run while any non-test booking, live payment or stored file exists.

## Stripe integration (TEST mode only)

- **SDK**: official `stripe` 23.0.0 (exact). One lazily created client instance per key, `new Stripe(key, { apiVersion: '2026-09-30.endive', maxNetworkRetries: 2, timeout: 15000 })`, in `api/_ads/stripeClient.js`. There is no global API key and no hand-built REST calls.
- **API version pinned to `2026-09-30.endive`**, the version stripe-node 23.0.0 targets (a test asserts they match). Create the webhook endpoint with the same version so event payloads keep the shape `normaliseStripeEvent()` reads.
- **Dynamic payment methods**: there is no `payment_method_types` allowlist; that parameter was removed from Checkout Session creation in `2026-09-30.endive`. Stripe offers whatever is enabled under Dashboard → Settings → Payment methods for GBP.
- **Delayed payment methods stay gated.** A completion with `payment_status = "unpaid"` is recorded as `awaiting_async_payment` and confirms nothing. Only a verified `paid` completion or `checkout.session.async_payment_succeeded` confirms, and nothing ever approves. If a delayed payment lands after the hold has lapsed and the dates were resold, the booking becomes `payment_conflict` (refund required). For a 60-minute hold, consider leaving only instant methods (cards and wallets) enabled in the test account's Dashboard.
- **`integration_identifier = "msm-ads-phase1-yszxhowc"`** is set on every Checkout Session, so this integration's sessions can be identified. It is a label plus a fixed suffix of 8 random letters, as Stripe's best-practice guidance requires. The suffix was generated once and committed, never per request, so params for a booking stay identical across idempotent retries. The parameter is optional in the API.
- **Idempotency**: SDK `idempotencyKey = msm-ads-checkout-<booking_id>`; SDK retries reuse it. Line items use inline `price_data`/`product_data` from the immutable server snapshot. The server re-checks the returned session (`cs_test_`, `livemode=false`, amount, currency, checkout URL) before recording it.
- **Webhook verification** uses `Stripe.webhooks.constructEvent` (no API key needed) on the raw body, plus stricter local checks: a `whsec_` secret is required, raw bytes only, and future-dated signatures are rejected.
- **Minimum restricted TEST key permission**: **Checkout Sessions → Write**. That is the only API call the code makes (`checkout.sessions.create`). There are no retrieve/list calls, refunds are issued manually in the Dashboard, and webhook verification uses the signing secret rather than the API key. Inline `price_data`/`product_data` creates no saved Products or Prices. **Unverified:** if Stripe answers a permission error naming another resource on the first real test call, grant that resource and record it here.

## Unresolved commercial decisions (MSM to decide)

- Real prices, packages, minimum/maximum lengths, lead time and rotation capacity per position. Everything seeded is TEST.
- VAT treatment and invoices/receipts (snapshot stores `vat_treatment = 'undetermined-test'`; no invoice is produced).
- Refund/cancellation: the agreed 2026-10-16 terms are implemented as **manual, audited assessments** (see `agreed-terms-implementation.md`); open gates there (rounding, consumer path, whole-run loss etc.) remain decisions. Booking amendments after correction delay are not built.
- Advertiser terms, creative/content policy, and whether advertisers need manual vetting (anyone signed in can create an advertiser profile and up to 3 holds of 60 minutes each).
- Final WordPress artwork sizes (seeded 1200×250 desktop / 600×250 mobile, matching the Calendar promo convention) and the "Advertisement" label wording.
- Priority review: built per the agreed terms (default off); the final-penny rounding rule and cover rota are still MSM decisions.
- **Review duration for replacement artwork** on an already-approved/running campaign: **undecided**. A replacement gets a deadline marked `replacement_review_provisional` (standard rule); the approved version keeps serving meanwhile.
- Retention period for financial/audit records.

## Incomplete / deliberately deferred

- **RELEASE BLOCKER / UNMET AGREED REQUIREMENT: campaigns needing changes stay on hold, and affected dates are revised WITH the advertiser.** (2026-10-16 update: the correction state `correction_requested` and the amendment proposal maths now exist; the amendment record, advertiser agreement and atomic hourly capacity re-check described below are still not built. See `agreed-terms-implementation.md`.)
  - **Agreed by Bryan:** a campaign that needs changes remains on hold, and any booked dates affected (e.g. review or approval landing on or after the first booked day, or changes requested) are revised together with the advertiser.
  - **Implemented today, a limitation only:** a rejected or changes-needed campaign simply isn't delivered while its booked dates keep elapsing. A late approval runs only the remaining booked days. A rejected replacement leaves the previously approved version serving. Dates are never moved, and there is no hold state, rescheduling or agreement flow. No refund policy exists or is implied.
  - **Implementation still needed** (design only; not built in this PR):
    1. **On-hold state**: an explicit campaign/booking state such as "changes requested / on hold" that suspends delivery and the booked-date clock, set by the admin review action with a reason, and visible to both sides. It must also decide what happens to a previously approved version (keep serving vs. pause), which is a commercial decision.
    2. **Reschedule proposal record**: an append-only table (booking id, proposed start/end UK dates, proposer, reason, status proposed/accepted/declined/expired/withdrawn, timestamps, audit). Every proposal is snapshotted, so the original booking dates are never silently overwritten.
    3. **Availability re-check**: accepting a proposal must, in one transaction under the same per-unit row locks as holds, re-check capacity for the new dates (shared inventory across packages), reserve the new days, release the old unconsumed days, and refuse on conflict. Dates must respect the earliest standard start rule and DST/holidays.
    4. **Advertiser agreement**: the change takes effect only after explicit acceptance by the booking owner (owner-only RPC). MSM may propose; the advertiser may propose and MSM accept. There is no unilateral admin date move, and no change from a client-supplied date without the server checks.
    5. **Pricing/snapshot rules**: the purchase snapshot is immutable, so a revision needs an amendment record linked to it. What happens if the revised dates change the number of days or price (top-up, credit, refund) is **undecided** and must be agreed before building. Nothing here assumes a refund.
    6. **Payment and funding invariant**: revisions must keep `booking_funded()` true for the funding payment. Any extra charge or refund path must reuse the verified-webhook flow; refunds stay manual until a policy exists.
    7. **Delivery and reporting**: delivery and the WordPress `serve_until` must follow the accepted dates only. Reports cover the delivered dates and show the revision history.
    8. **UI, notifications and tests**:
       - advertiser and admin screens;
       - messages (no email exists today);
       - concurrency tests (racing proposals and holds), tampering tests, DST/holiday tests, and accept/decline/expiry tests.

- **Not verified against real services**: Stripe (only locally signed fixtures and mocks), Supabase hosted RLS/storage (local shim reproduces the relevant pieces), Vercel raw-body behaviour, WordPress (stubbed functions; the real theme was not available to inspect).
- **Priority initial review**: now implemented in `20261016120000` (applied on staging only; not on production): optional fee in the immutable snapshot, two Checkout line items, 12-elapsed-hour clock, missed-deadline detection feeding the refund assessment, admin toggle (default off). Not hosted-verified.
- Middle/bottom homepage positions are mapped in the adapter but not sold. Article positions keep the existing `msm_article_ad_delivery` contract untouched (the plugin does not hook it).
- Series-level targeting, bundles and venue/gig advertising: design only (architecture doc).
- No emails/notifications are sent to advertisers or MSM (review due, approval, rejection, correction requests, refund-required). A correction's response window only starts once a delivery is recorded (mailer hook `ad_record_correction_notice`, or the admin fallback). The admin queue shows due/overdue state.
- No automated refunds: assessments are proposed/approved in the admin, MSM refunds manually in the Stripe dashboard and records the outcome; **REFUND REQUIRED** still flags payment conflicts/duplicates; `charge.refunded` updates the payment records.
- No scheduled jobs are configured (see deploy step 8).
- The UI is minimal and not render-tested (the repo has no jsdom). Decision logic is unit-tested and the build passes. No light theme exists in the app today, so the portal follows the existing dark tokens with MSM black/white/red and the existing logo.
- Admin tab visibility follows the existing UI convention (`profiles.role === 'admin'`). Database checks use `is_admin_or_above()`, which also accepts `user_roles` admins and super admins.

## Known limitations / residual risks

- Holds can be created by any signed-in user (rate-limited per advertiser, not per person). Consider advertiser vetting before opening publicly.
- Viewability is measured by MSM's own script (≥50% for ≥1 s, visible tab). It is unaudited, and blockers, no-JS and full-page caches reduce counts. Reports print these limitations.
- Click/impression bot filtering is heuristic (UA patterns, per-client rate limit, 30-minute dedupe). Serve tokens can be replayed within 24–48 h, but every count is deduped and re-checked against current eligibility.
- `ad_advertisers.owner_user_id` uses `ON DELETE RESTRICT`, so deleting an auth user with advertising records needs a deliberate admin process (financial records).
