# MSM shared advertising platform — Phase 1

**Status: built and tested locally; NOT deployed, NOT applied to any remote database, NOT installed in WordPress, NOT connected to a real Stripe account.** Everything ships disabled by default.

Phase 1 is one vertical slice for **one position, the WordPress homepage top** (`#msm-wp-home-top`, placement `wordpress-home-top`):

placement and dates → atomic availability check and expiring hold → desktop/mobile artwork and destination → server-priced Stripe **TEST** Checkout → signature-verified webhook marks the booking paid and **Under Review** → MSM approves or rejects manually → approved creative delivered only within the booked UK dates → expiry → CSV/PDF date-range reports for the advertiser and admin.

Payment never approves or publishes anything. See [phase1-architecture.md](phase1-architecture.md) for the design and state machines.

## What is in this PR

| Area | Files |
|---|---|
| Additive migration (not applied) | `supabase/migrations/20261015120000_ads_platform_phase1.sql` |
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
| `ads_priority_review_enabled` | Priority review | **locked off** (phase 2) |
| `ads_venue_gig_targeting_enabled` | Venue/gig advertising | **locked off** |
| `stripe_livemode` | Expected Stripe mode | **locked false** |
| `hold_minutes` (60), `min_lead_days` (3), `max_advance_days` (365), `max_active_holds_per_advertiser` (3) | tunables | TEST values |

There is also a server kill switch, `ADS_API_ENABLED`. Seeded inventory (`wordpress-home-top/-middle/-bottom`) and the two TEST packages (`TEST-wp-home-top-daily`, `TEST-wp-home-top-weekly`, which share the same physical unit) are all `active = false`, `is_test = true`, and use placeholder prices.

## Environment variables

Server-only (Vercel project env, **never** `VITE_*`, never in WordPress or the browser):

| Name | Purpose | Status |
|---|---|---|
| `ADS_API_ENABLED` | `true` to enable `/api/ads/*` | not set (API returns disabled / house fallback) |
| `SUPABASE_URL` | Supabase project URL | not set for ads |
| `SUPABASE_ANON_KEY` | public anon key (user-scoped RPCs) | not set for ads |
| `SUPABASE_SERVICE_ROLE_KEY` | narrow service RPCs + private storage reads | **missing, must be added by MSM** |
| `STRIPE_SECRET_KEY` | Stripe **test** secret (`sk_test_…`/`rk_test_…`); any other key is refused | **missing** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` for the test webhook endpoint | **missing** |
| `ADS_TRACKING_SECRET` | ≥32 random chars; signs serve tokens and keys visitor hashes | **missing** |
| `ADS_PUBLIC_BASE_URL` | defaults to `https://calendar.musicscenemagazine.co.uk` | optional |
| `ADS_CLICK_FALLBACK_URL` | where invalid clicks go (default `https://musicscenemagazine.co.uk/`) | optional |

No credentials were created, changed or used while building this. When something is missing, the endpoints answer `503 ADS_NOT_CONFIGURED` and list the missing variable **names** (never values). Delivery quietly returns no adverts, so the house advert stays.

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

1. **Isolated database.** Use the separate staging project **msm-ads-staging (`oyakrgdmplmxmlhjfqcd`)**, never production. A fresh project lacks the Calendar's `profiles`/`user_roles`/role helpers, so first follow **`supabase/staging/README.md`**: read-only preflight → guarded bootstrap → this migration **unchanged** → read-only postflight → synthetic accounts via the dashboard → separately authorised admin grant.
2. **Preview-scoped env vars only.** In Vercel, add variables scoped to **Preview** and, where possible, to this git branch only (branch-specific preview variables), **never Production**:
   - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`: the **staging** project (build-time; makes the preview browser use staging instead of production).
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: staging.
   - `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET`, `ADS_TRACKING_SECRET`, `ADS_API_ENABLED=true`, and `ADS_PUBLIC_BASE_URL` = the preview URL.

   Then redeploy the preview. Confirm in the browser network tab that the preview calls the **staging** Supabase host.
3. **Stripe test webhook → preview.** In Stripe **test mode**, add an endpoint `https://<preview-url>/api/ads/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` and `charge.refunded`. If Vercel Deployment Protection is on for previews, Stripe gets a 401: use a Protection Bypass for Automation secret on the URL or test with `stripe listen --forward-to`, and do not disable protection for production.
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

## Unresolved commercial decisions (MSM to decide)

- Real prices, packages, minimum/maximum lengths, lead time and rotation capacity per position. Everything seeded is TEST.
- VAT treatment and invoices/receipts (snapshot stores `vat_treatment = 'undetermined-test'`; no invoice is produced).
- Refund/cancellation policy, including what happens if approval lands after the start date (currently the advert simply runs for the remaining booked days with no automatic partial refund).
- Advertiser terms, creative/content policy, and whether advertisers need manual vetting (anyone signed in can create an advertiser profile and up to 3 holds of 60 minutes each).
- Final WordPress artwork sizes (seeded 1200×250 desktop / 600×250 mobile, matching the Calendar promo convention) and the "Advertisement" label wording.
- Priority review (£150, 12 elapsed hours) commercial terms, see below.
- Retention period for financial/audit records.

## Incomplete / deliberately deferred

- **Not verified against real services**: Stripe (only locally signed fixtures and mocks), Supabase hosted RLS/storage (local shim reproduces the relevant pieces), Vercel raw-body behaviour, WordPress (stubbed functions; the real theme was not available to inspect).
- **Priority initial review (phase 2)**: toggle exists but is locked off; `priority_fee_pence` is pinned to 0. The planned design is in the architecture doc.
- Middle/bottom homepage positions are mapped in the adapter but not sold. Article positions keep the existing `msm_article_ad_delivery` contract untouched (the plugin does not hook it).
- Series-level targeting, bundles and venue/gig advertising: design only (architecture doc).
- No emails/notifications are sent to advertisers or MSM (review due, approval, rejection, refund-required). The admin queue shows due/overdue state.
- No automated refunds: the admin sees **REFUND REQUIRED** and refunds in the Stripe dashboard, and `charge.refunded` then updates the records.
- No scheduled jobs are configured (see deploy step 8).
- The UI is minimal and not render-tested (the repo has no jsdom). Decision logic is unit-tested and the build passes. No light theme exists in the app today, so the portal follows the existing dark tokens with MSM black/white/red and the existing logo.
- Admin tab visibility follows the existing UI convention (`profiles.role === 'admin'`). Database checks use `is_admin_or_above()`, which also accepts `user_roles` admins and super admins.

## Known limitations / residual risks

- Holds can be created by any signed-in user (rate-limited per advertiser, not per person). Consider advertiser vetting before opening publicly.
- Viewability is measured by MSM's own script (≥50% for ≥1 s, visible tab). It is unaudited, and blockers, no-JS and full-page caches reduce counts. Reports print these limitations.
- Click/impression bot filtering is heuristic (UA patterns, per-client rate limit, 30-minute dedupe). Serve tokens can be replayed within 24–48 h, but every count is deduped and re-checked against current eligibility.
- `ad_advertisers.owner_user_id` uses `ON DELETE RESTRICT`, so deleting an auth user with advertising records needs a deliberate admin process (financial records).
