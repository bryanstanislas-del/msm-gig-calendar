# MSM advertising — launch checklist

**Purpose.** This page lists everything still required before paid bookings can open. It covers exact configuration (variable **names** only, never values), the staged migration sequence, and what has and has not been verified.

**Boundaries.**
- No hosted migration, deployment, configuration change, live Stripe action or external email was performed **by Claude**.
- The staging applies recorded in §1 were performed by the independent reviewer. Facts marked as reviewer observations come from the reviewer's checks; Claude did not re-verify them, because it does not call hosted services.

## 0. Hosted staging observations, 2026-10-18 (reviewer, HOSTED — not local test results)

Everything in this section was observed on hosted services by the reviewer. None of it comes from the local suites in §2, and Claude made no hosted call. **Production was untouched.**

| Item | Observation |
|---|---|
| Vercel team/project | Browser session verified the correct team **msm-gig-calendar-s-projects** and project **msm-gig-calendar**. |
| Code | Commit **`af6a7de`** on `claude/quirky-bohr-2dmbus`. |
| Preview deployment | Redeploy **`BaXeggfhb4ZuMWSxba6THETax4qh`** is **Ready** on Preview. |
| Preview configuration | `ADS_API_ENABLED=true` added as a configuration variable **only for Preview + `claude/quirky-bohr-2dmbus`**. No other environment changed. |
| Ads API routing | `GET /api/ads/delivery?placement=wordpress-home-top` returned `{"placement":"wordpress-home-top","label":"Advertisement","ads":[]}`: JSON from the ads function, not the Calendar HTML. |
| Calendar shell | Still shows **0 gigs / 0 venues** (staging, not the production catalogue). |
| Advertiser portal | The authenticated synthetic advertiser sees the **TEST-only £10/day** product. |
| Staging switches (`oyakrgdmplmxmlhjfqcd` only) | `ads_checkout_enabled` was **enabled** for the sandbox journey. `stripe_livemode` and every other ads switch remain **false**. |
| Test holds | The earlier test hold `3a6a9ed9-1561-41a9-aba7-e4a830dacdc9` was **cancelled**, because the portal requires more than 31 minutes left on a hold before checkout. A fresh **held** TEST booking `18edcf3f-9273-4016-bed8-d88984f7f1a4` for **20 Oct 2026** at the **£10 TEST price** has a **60-minute** hold. |
| Stripe | Stripe **TEST (sandbox)** Checkout opened for that booking, in **GBP**. |
| Staging database after checkout opened (fresh read) | **2 bookings** (the old one cancelled, the new one held). **1 `ad_payments` row** for the new booking: `status = open`, `livemode = false`, `amount_pence = 1000`, `currency = gbp`, `paid_at = null`. So a sandbox Checkout Session and its open payment row exist, but **no payment is paid or webhook-confirmed**. Also 0 creative versions, 0 `ad_notification_outbox` rows, 0 stored ad-creatives objects. (Checkout session id deliberately not recorded.) |
| Not done | **No payment submitted.** No artwork uploaded, no moderation or approval, no delivery of an advert, no email. |
| **Stopped at payment: decision needed** | Stripe's sandbox Checkout displayed **"By paying, you agree to Link's Terms and Privacy"**. **Bryan must decide** whether accepting Link's terms is acceptable, or Link should be disabled for this account, **before any payment is submitted**, including a sandbox one. |

Not recorded here, on purpose: checkout URLs, session ids or tokens, card details, keys and secrets.

## 1. Status facts (reviewer observations, 2026-10-17)

| Item | State |
|---|---|
| Vercel plan | Team is on **Hobby**. Vercel's fair-use guidelines (updated 14 Sep 2026, https://vercel.com/docs/limits/fair-use-guidelines) require **Pro or Enterprise for commercial usage**, including paid advertising and payment processing. **Not upgraded; nothing purchased.** |
| Preview environment variables | Visually confirmed scoped to **Preview + this branch**. On 2026-10-17 `ADS_API_ENABLED` and all email variables were absent; on **2026-10-18** `ADS_API_ENABLED=true` was added for Preview + this branch only (§0). Email variables are **still absent**. |
| Preview history | `eaafbab` preview (`LCcY5MHDqxjuTv2aC7VXEuGyvye5`) showed **1,615 production gigs**, because `src/App.jsx` built its own production client; fixed in `367d29a`. The `367d29a` branch alias then stayed on "Loading gigs" (staging had no Calendar shell tables); fixed by `05_calendar_shell_fixture.sql`. |
| **Preview now (branch alias)** | **Fully loads against staging, showing 0 gigs / 0 venues**: not the production catalogue, and no loading spinner. No login, payment or email has been exercised on it. |
| **Staging Supabase (`msm-ads-staging`, `oyakrgdmplmxmlhjfqcd` only)** | Applied by the reviewer, in order, unchanged: all **eight** reviewed forward migrations `20261016090000` … `20261017120000` (§3), then `supabase/staging/05_calendar_shell_fixture.sql` with its exact opt-in phrase. The "STATUS: NOT APPLIED" header comments inside those files are historical; the files were left byte-for-byte unchanged. |
| **Hosted admin login (reviewer)** | Secure staging admin login **succeeded** (header STAGING ADMIN, ADMINISTRATOR). Authenticated staging selects verified: admin = true, 17 settings, 3 units, 2 products, 0 bookings, 0 advertisers, all switches off. **But the ADS panel never showed settings or inventory, and no error stayed visible.** |
| ADS panel cause (found locally, fix not yet hosted-verified) | Reproduced with a **real PostgREST 12.2.3** against the full local schema: `listBookings` embeds `ad_payments(...)` while `ad_bookings` ↔ `ad_payments` are linked twice (`ad_payments_booking_id_fkey` and `ad_bookings_funding_payment_id_fkey`), so PostgREST answers **300 PGRST201**. `AdminAds` loaded everything with one `Promise.all`, so that failure blanked settings and inventory; the only signal was a 4-second toast. The same real-app check, run on the old code, shows blank settings and inventory and "No bookings yet." despite the failed request. Fix: the hinted embed `ad_payments!ad_payments_booking_id_fkey` (all payments of the booking, so duplicate/refund-required payments stay visible); every admin section loads independently with a persistent loading, error or retry state. **Needs a preview redeploy and a hosted re-check.** |
| Auth callback | `onAuthStateChange(async …)` awaiting Supabase calls did **not** deadlock with the locked supabase-js/auth-js **2.111.0**, in Node or in real Chromium. The old-code browser run restored the session and requested settings. It was hardened anyway, per Supabase guidance: a synchronous callback with deferred profile loading. It also fixed a real stale-result race: a late profile load could restore the previous user after sign-out or an account switch. |
| Staging postflight (reviewer) | All switches **0**; bookings, payments, outbox and amendments **0**; creative bucket private; RLS enabled on every public table; anon dispatch and authenticated worker claim **denied**; clients cannot write the shell tables; auth users remain exactly **2 synthetic** users. |
| Production Supabase | Nothing ads-related applied. |
| Merge state | The branch (through `801b61d`) merges cleanly with `main` `0bf53dc`, which carries the gig-submission ownership fix in `src/App.jsx`. This branch changes only the client set-up lines of `App.jsx`; the gig-submission code is untouched. Any merge must keep `main`'s change. |
| Reviewer test runs | `c4ed732`: 1,159 unit tests passed + 1 skipped (UK timezone), and **all** browser checks passed, including 0 px mobile overflow. The stalled-body reproduction now times out correctly. |

## 2. Verification: local-only vs hosted

| Area | Local (this container) | Hosted |
|---|---|---|
| Database rules, triggers, RLS, races | `npm run test:ads-db` (disposable Postgres 16): suites 10–60, refund and amendment races, rollback | Migrations applied on staging; postflight and denial checks passed (§1, reviewer). Booking, refund, outbox and amendment **flows not exercised** on staging (all counts 0) |
| Staging bootstrap path | `npm run test:ads-staging` (empty platform DB, incl. Calendar shell section 8) | Bootstrap, all nine ads migrations and the Calendar shell applied on staging (§1, reviewer) |
| API handlers / Stripe / Resend | vitest with labelled mocks; signature checks with synthetic secrets | 2026-10-18 (§0): `/api/ads/delivery` routing verified, and Stripe **TEST** Checkout **opened** (open payment row). **Not verified:** payment submission, webhook delivery and confirmation, Resend send, Resend webhook |
| PostgREST API layer | `npm run test:ads-postgrest`: real PostgREST 12.2.3 (checksum-pinned, loopback only) replays **every** `adsClient.js` select as admin, owner and other advertiser (36 calls), plus payment-history semantics (funding + duplicate) and the unhinted embed's PGRST201. Fails on the old client | Hosted ADS load failed before the fix (§1); re-check after redeploy |
| Browser: project isolation | `npm run test:browser` A: real app built three ways; all traffic intercepted on loopback | Preview loads against staging with 0 gigs / 0 venues, not production (§1, reviewer). A per-request network-tab audit of every screen while signed in is still to do (§5 step 3) |
| Browser: real app, admin ADS tab | `npm run test:browser` C: real app build, stored synthetic admin session, Supabase answered locally (PGRST201 emulated for an unhinted embed). Settings, inventory and bookings render; a forced settings failure stays visible with its code while other sections load. Fails on the old code | Login passed; ADS load blocked before the fix; not re-checked |
| Browser: advertiser/admin screens | `npm run test:browser` B: real components, synthetic fixtures, fake client emulating RLS/ownership; desktop and mobile screenshots in `docs/ads/verification/local-browser/` | **Not verified** with a real staging login |
| WordPress adapter | `npm run test:wp` (stubbed WP) | Plugin not installed anywhere |

**Harness fidelity and legibility.**
- The harness wraps the screens in the app's own tab baseline (`#0d0d0d` background, `#fff` text, `'Barlow',sans-serif`). `tests/browserHarnessTheme.test.js` keeps these values equal to `App.jsx`.
- Web fonts are blocked in the local run, so the system sans-serif is used.
- A computed-contrast sentinel fails any visible text under 3:1 or in a serif font. It lists, rather than fails, elements between 3:1 and WCAG AA 4.5:1. Current list, an **accessibility follow-up**: brand-red primary buttons (white on `#e8203a`, 4.47:1) and existing shared admin components (4.12–4.35:1).

**Browser tooling.** `playwright` is pinned as a devDependency at 1.56.1 in `package.json` and the lockfile.
- Elsewhere: run `npm ci`, then `npx playwright install chromium` once, then `npm run test:browser`.
- The run builds locally, serves on 127.0.0.1 only, and **aborts every non-loopback request**. Supabase calls are answered locally and recorded.

## 3. Staging migration record (STAGING ONLY) and the sequence for any rebuild

**Applied on `oyakrgdmplmxmlhjfqcd` by the reviewer, 2026-10-17:**
- earlier: bootstrap `01`, `20261015120000_ads_platform_phase1.sql` and the admin grant `04`;
- now: the eight migrations below, in this order and unchanged;
- then `supabase/staging/05_calendar_shell_fixture.sql` (empty read-only Calendar shell; guarded; not a migration);
- then postflight (§1).

**Nothing in this section remains to apply on staging.** For a rebuild of a fresh staging project, use the same order: `00` preflight → `01` → `20261015120000` → the eight below → `05` → `03` postflight → synthetic accounts via the dashboard → `04`. Apply one file at a time with `psql -v ON_ERROR_STOP=1 -1 -f <file>`, or one SQL-editor run per file.

1. `20261016090000_ads_standard_earliest_start.sql`
2. `20261016120000_ads_review_corrections_priority.sql`
3. `20261016150000_ads_refund_cancellation_assessment.sql`
4. `20261016180000_ads_refund_invariants_initiator_deadlines.sql`
5. `20261016210000_ads_notification_outbox.sql`
6. `20261016230000_ads_booking_amendments.sql`
7. `20261017090000_ads_outbox_dispatch_amendment_notices.sql`
8. `20261017120000_ads_begin_dispatch_null_guard.sql`

Every switch stayed OFF after these (postflight: switches = 0): `ads_*_enabled`, `ads_email_enabled`, `ads_amendments_enabled`, `ads_hourly_packages_enabled`. `amendment_offer_minutes` remains unset.
- The ads rollback is `supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql`: guarded, full, all ads objects.
- The Calendar shell is removed with the staging teardown in `supabase/staging/README.md`.
- **Production is untouched**; applying anything there is a separate, later decision after staging passes §5.

## 4. Launch fixes (`367d29a`, `c4ed732`, `801b61d`)

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
  - Provider calls have a 10-second timeout covering the request and reading the response body (a provider that sends headers then stalls the body is cut off and treated as an unknown outcome).
- **Amendment notifications** to the booking owner: proposed, accepted, rejected, withdrawn, expired. They carry exact persisted intervals and are deduplicated durably. Email delivery never changes the offer or its configured expiry. `ad_expire_amendments()` is called by the worker and by an admin button.
- **Review fixes:**
  - The outcome email now shows the amended run.
  - The amendment start now uses the first approval, not a later replacement approval.
  - Advertisers can no longer read internal amendment notes or admin user ids.
  - Admin selects no longer overflow on mobile.

## 5. Remaining before paid bookings (in order)

1. **Hosting plan.** Approve and upgrade the Vercel team to Pro or Enterprise before any commercial use (Bryan to decide; not done).
2. **Review and merge readiness** of this draft PR (merge with `main` preserving its `App.jsx` gig-submission fix); keep the PR draft until steps 3–8 pass.
3. **Hosted login check on the preview** (staging migrations and shell are done; the preview loads with 0 gigs / 0 venues; **admin login passed**):
   - redeploy the preview from the fix commit, open **ADS**, and confirm settings (17), inventory (3 units, 2 products) and "No bookings yet." render with **no** persistent "Could not load" notice;
   - sign in with the synthetic advertiser as well;
   - confirm in the network tab that the root, ADVERTISE, ADS and admin screens call **only** the staging Supabase host;
   - confirm that the advertiser cannot reach admin data.
4. **Ads API on the preview:** *(2026-10-18, §0: done; `ADS_API_ENABLED=true` set for Preview + branch only, and `/api/ads/delivery` returns JSON.)* Still to do: the Stripe webhook raw-body check from `docs/ads/README.md` deploy step 5.
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
7. **Synthetic hosted journey on staging.** Started 2026-10-18 (§0): hold → sandbox Checkout opened, then **stopped before payment** pending Bryan's decision on Link's terms. Nothing paid, approved, delivered or emailed yet. follow the staging script in `agreed-terms-implementation.md` §3. That covers hold → Stripe sandbox payment → review/correction → approval → delivery → refund assessment → removal. Add:
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
10. **WordPress:** the plugin is not installed anywhere. Install it on staging WordPress first (`wordpress/msm-ads/INSTALL.md`).
11. **Production:** apply migrations, add Production-scoped variables, install the WordPress plugin, then switch on toggles. Each is a separate approved step. Production is untouched today.
