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
| Server API (one Vercel function) | `api/ads/[action].js`, `api/_ads/*.js` |
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

- **RLS/state machine suite** (160+ checks): owner, other user, anon, admin (role- and profile-based) permissions; self-pay/approve/price/date tampering; shared inventory; webhook duplicates, mode mismatch, tampered amounts, out-of-order expiry/refund, late payment with and without capacity, double payment, partial/full refunds; payment-vs-approval separation; creative immutability and replacement review; draft/rejected never served or redirected; pause/kill switch; booked-date window; metrics dedupe, eligibility, rate limit; report clamping; DST and UK holiday deadlines.
- **Concurrency**: 12 parallel sessions race for one capacity-1 day across both packages (exactly 1 succeeds), and 8 parallel deliveries of the same webhook (exactly 1 applies).
- **End-to-end**: real API handlers + real DB functions (only Stripe session creation and storage bytes are mocked).
- **Rollback**: guard refuses with files present, then removes every ads object and nothing else.

Results at time of writing: 985 Vitest tests passed (the DB end-to-end file is skipped without a local DB), 38 PHP checks passed, all DB suites passed, and `vite build` succeeded.

## Deploy steps (for MSM, later; staging first)

1. Review and merge this PR. Merging deploys only code that is inert without env vars and toggles.
2. On a **staging/branch** Supabase database first, apply `20261015120000_ads_platform_phase1.sql` (e.g. `supabase db push` or the SQL editor). Check that `ad-creatives-private` exists and is private.
3. In Stripe **test mode**, create a webhook endpoint `https://<calendar host>/api/ads/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` and `charge.refunded`.
4. Set the server env vars above on the Vercel **preview** environment and redeploy.
5. **Verify raw-body handling on Vercel**: `stripe listen --forward-to <preview>/api/ads/webhook` then `stripe trigger checkout.session.completed`. Expect `200` with outcome `ignored_unknown_session` (or an outcome for a real test booking), **not** `400 INVALID_SIGNATURE` / `RAW_BODY_UNAVAILABLE`. This is the one integration point that cannot be proven locally.
6. As an admin, open **ADS**: activate the TEST unit and a TEST package, then enable the portal, checkout and delivery toggles. Book, pay with a Stripe test card, upload, approve, and confirm delivery JSON at `/api/ads/delivery?placement=wordpress-home-top`.
7. Install the WordPress plugin on a **staging** WordPress per `wordpress/msm-ads/INSTALL.md`.
8. Schedule maintenance (not configured in this PR): `ad_expire_stale_holds()` (holds also expire lazily on each new reservation) and `ad_purge_tracking_state()` every ~15 min. Use pg_cron, or a Vercel cron calling a small authenticated endpoint (not built).

## Rollback

- Fastest: turn `ads_delivery_enabled` off (adverts disappear and house ads return within the 60 s cache), or set `ADS_API_ENABLED` to anything but `true`, or set `MSM_ADS_ENABLED` to false in WordPress / deactivate the plugin.
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
