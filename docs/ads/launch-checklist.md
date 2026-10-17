# MSM advertising — launch checklist

**Purpose.** This page lists everything still required before paid bookings can open. It covers exact configuration (variable **names** only, never values), the staged migration sequence, and what has and has not been verified.

**Boundaries.**
- No hosted migration, deployment, configuration change, live Stripe action or external email was performed by Claude for this checklist.
- Facts marked *observed* were reported by the independent reviewer from read-only checks; Claude did not re-verify them, because it does not call hosted services.

## 1. Status facts (observed by the reviewer, 2026-10-17)

| Item | State |
|---|---|
| Vercel plan | Team is on **Hobby**. Vercel's fair-use guidelines (updated 14 Sep 2026, https://vercel.com/docs/limits/fair-use-guidelines) require **Pro or Enterprise for commercial usage**, including paid advertising and payment processing. **Not upgraded; nothing purchased.** |
| Preview environment variables | Visually confirmed scoped to **Preview + this branch**. `ADS_API_ENABLED` and all email variables are **absent**. |
| Preview deployment of `eaafbab` | Ready, ID `LCcY5MHDqxjuTv2aC7VXEuGyvye5`. Its root displayed **1,615 live gigs (production catalogue)** despite the staging overrides. Root cause: `src/App.jsx` built its own hard-coded production client. **Fixed in code by this commit (§4), but not redeployed or re-verified on the preview.** |
| Staging Supabase (`msm-ads-staging`) | Zero bookings and payments; no active or non-test inventory/products; private creative bucket. Only `20261015120000` is applied; all later ads migrations, including outbox and amendments, are **not applied**. |
| Production Supabase | Nothing ads-related applied. |
| Merge state | `eaafbab` merges cleanly with `main` `0bf53dc`, which carries the gig-submission ownership fix in `src/App.jsx`. This commit changes only the client set-up lines of `App.jsx`; the gig-submission code is untouched. Any merge must keep `main`'s change. |

## 2. Verification: local-only vs hosted

| Area | Local (this container) | Hosted |
|---|---|---|
| Database rules, triggers, RLS, races | `npm run test:ads-db` (disposable Postgres 16): suites 10–60, refund and amendment races, rollback | **Not verified** on staging (migrations not applied) |
| Staging bootstrap path | `npm run test:ads-staging` (empty platform DB) | Bootstrap and `20261015120000` applied by MSM; later migrations not applied |
| API handlers / Stripe / Resend | vitest with labelled mocks; signature checks with synthetic secrets | **Not verified**. No Stripe Checkout, webhook delivery, Resend send or Resend webhook was ever exercised |
| Browser: project isolation | `npm run test:browser` A: real app built three ways; all traffic intercepted on loopback | **Not verified**: the preview must be redeployed and re-checked (§5 step 3) |
| Browser: advertiser/admin screens | `npm run test:browser` B: real components, synthetic fixtures, fake client emulating RLS/ownership; desktop and mobile screenshots in `docs/ads/verification/local-browser/` | **Not verified** with a real staging login |
| WordPress adapter | `npm run test:wp` (stubbed WP) | Plugin not installed anywhere |

**Browser tooling.** `playwright` is pinned as a devDependency at 1.56.1 in `package.json` and the lockfile.
- Elsewhere: run `npm ci`, then `npx playwright install chromium` once, then `npm run test:browser`.
- The run builds locally, serves on 127.0.0.1 only, and **aborts every non-loopback request**. Supabase calls are answered locally and recorded.

## 3. Staged migration sequence (STAGING ONLY, after review, in this order)

Already applied on staging: `20261015120000_ads_platform_phase1.sql`. Apply the rest **unchanged**, one file at a time, with `psql -v ON_ERROR_STOP=1 -1 -f <file>` or one SQL-editor run per file, then run `supabase/staging/03_postflight_readonly.sql`:

1. `20261016090000_ads_standard_earliest_start.sql`
2. `20261016120000_ads_review_corrections_priority.sql`
3. `20261016150000_ads_refund_cancellation_assessment.sql`
4. `20261016180000_ads_refund_invariants_initiator_deadlines.sql`
5. `20261016210000_ads_notification_outbox.sql`
6. `20261016230000_ads_booking_amendments.sql`
7. `20261017090000_ads_outbox_dispatch_amendment_notices.sql`

Every switch stays OFF after these: `ads_*_enabled`, `ads_email_enabled`, `ads_amendments_enabled`, `ads_hourly_packages_enabled`. `amendment_offer_minutes` stays unset. The rollback is `supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql`: guarded, full, all ads objects. Production is a separate, later decision after staging passes §5.

## 4. Fixed in this commit (launch fixes)

- **Single Supabase project for the whole browser app.**
  - `src/supabaseConfig.js` resolves the project. `src/supabaseClient.js` is the only client, and `App.jsx` (Calendar, auth/session), admin and ads all import it.
  - With no override, the production values are unchanged.
  - A complete `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` pair selects that project for everything.
  - A partial or malformed override, or a non-production key paired with the production URL, **throws** instead of mixing projects.
  - The server routes `api/gig.js`, `api/og.js`, `api/sitemap.js` and the ads API use the same pairing rule via `api/_supabaseProject.js`. Their production fallback is unchanged, and they refuse mismatched pairs.
  - Tests: `src/supabaseConfig.test.js`, `api/_supabaseProject.test.js`, `tests/supabaseSingleClient.test.js` (all 3 fail on the old code), browser check A.
- **Email dispatch safety.** Resend keeps idempotency keys for 24 hours (https://resend.com/changelog/idempotency-keys).
  - First-dispatch identity (recipient plus content SHA-256) is stored before any provider call. Payload and recipient are frozen.
  - At most 6 attempts, including expired leases. No provider call later than 23 hours after the first dispatch.
  - Anything that may have been sent and can no longer be retried safely goes to `needs_reconciliation`. It is never re-sent blindly; MSM confirms sent or not sent, and only "not sent" re-queues it under a new key generation.
  - Provider calls have a 10-second timeout.
- **Amendment notifications** to the booking owner: proposed, accepted, rejected, withdrawn, expired. They carry exact persisted intervals and are deduplicated durably. Email delivery never changes the offer or its configured expiry. `ad_expire_amendments()` is called by the worker and by an admin button.
- **Review fixes:**
  - The outcome email now shows the amended run.
  - The amendment start now uses the first approval, not a later replacement approval.
  - Advertisers can no longer read internal amendment notes or admin user ids.
  - Admin selects no longer overflow on mobile.

## 5. Remaining before paid bookings (in order)

1. **Hosting plan.** Approve and upgrade the Vercel team to Pro or Enterprise before any commercial use (Bryan to decide; not done).
2. **Review and merge readiness** of this draft PR (merge with `main` preserving its `App.jsx` gig-submission fix); keep the PR draft until steps 3–8 pass.
3. **Redeploy the preview** from this branch and confirm in the browser network tab that the root and every screen call **only** the staging Supabase host. Gig counts must match staging, not production.
4. **Apply §3 on staging**, then postflight.
5. **Preview environment variables still missing** (Preview + this branch only, never Production):
   - `ADS_API_ENABLED=true` when ready to test;
   - `ADS_WORKER_SECRET` (≥32 chars);
   - `ADS_EMAIL_FROM` (a Resend-verified sender domain);
   - `ADS_ADMIN_ALERT_EMAIL`;
   - `ADS_RESEND_WEBHOOK_SECRET` (`whsec_…`, from a Resend webhook pointing at `/api/ads/email-events`);
   - a `RESEND_API_KEY` usable by the preview;
   - `ADS_EMAIL_ENABLED=true` only for the synthetic-mailbox test.

   Already present per §1: the staging Supabase variables, a Stripe sandbox key, the webhook secret, the tracking secret and the base URL.
6. **Scheduler (not configured):** the notify worker (`POST /api/ads/notify-worker` with the bearer secret, about every 5 minutes), `ad_expire_stale_holds()` and `ad_purge_tracking_state()` (about 15 minutes).
7. **Synthetic hosted journey on staging:** follow the staging script in `agreed-terms-implementation.md` §3, plus:
   - one email to a synthetic mailbox with a delivery event, and a correction window started by delivery;
   - an amendment propose and accept;
   - a forced lost acknowledgement checked in the admin reconciliation view.
8. **Policy gates Bryan must decide:**
   - amendment offer expiry, exact-hour rounding and DST handling;
   - 24-hour packages;
   - final-penny rounding;
   - replacement review duration and whether the old creative pauses during it;
   - late-bounce handling;
   - whether provider acceptance (rather than delivery) may start a correction window;
   - the consumer cancellation path;
   - cross-kind and MSM-initiated refund policy;
   - dual control for refund approval.
9. **Commercial/legal:** final terms (currently `DRAFT-NOT-APPROVED-2026-10-16`), real prices, VAT and invoices, Stripe live mode (not built), bank holidays after 2028.
10. **Production:** apply migrations, add Production-scoped variables, install the WordPress plugin, then switch on toggles. Each is a separate approved step.
