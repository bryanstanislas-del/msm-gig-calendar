# Agreed advertising terms (2026-10-16): implementation status

**Scope of this document.** It maps the terms Bryan agreed on 2026-10-16 to what this branch implements. It covers review, corrections, priority, booking intervals, refunds and business cancellation.

**Status.** This is a **staging build**, not authority to take paid bookings.

- None of the migrations below has been applied to any hosted database. They have been applied only to disposable local Postgres 16.
- No hosted API, Stripe, WordPress or email call was made, and none of those integrations is verified.
- Every switch stays OFF.

Legend: **Done** = implemented and covered by local tests. **Partial** = core built, named pieces missing. **Gated** = deliberately blocked until a policy decision. **Not built** = nothing yet.

## 1. Gap matrix

### 1.1 Initial review

| Agreed term | Status | Where |
|---|---|---|
| Clock starts only when payment has cleared **and** complete artwork/link/info is received (whichever is later) | Done | `ads_internal.refresh_review_state`; `initialClockStart` (`src/ads/ukWorkingTime.js`); SQL suite `20_` (both arrival orders, duplicates) |
| Standard: by 23:59:59 Europe/London on the next Mon–Fri working day, excluding England & Wales bank holidays (stored as exclusive 00:00 next day) | Done | `ads_internal.review_due_before`; `ad_uk_holidays` maintained to the end of 2028; Friday/holiday tests |
| Earliest-start rule kept | Done | `20261016090000` (unchanged) |
| Priority: optional £150, actively selected, only when MSM enables cover; 12 **elapsed** hours including nights and weekends | Done | `ads_priority_review_enabled` (admin can enable; default OFF); `priority_fee_pence` = 15000; `ad_quote/ad_create_hold(..., p_priority)`; overnight test |
| Exact deadline and price shown before payment | Done | `ad_quote` → `review_due_if_ready_now`, `priority_fee_pence`, `terms_version`; portal `reviewPromiseText` (explicit UTC offset) |
| Durable confirmation | Done (email disabled) | `ad_booking_confirmations` written once on verified payment, shown in the portal, and enqueued as a `booking_confirmation` email (outbox, §1.8) |
| A review is an approval, a reasoned rejection or a necessary correction request; a holding acknowledgement does not count | Done | `ad_review_sla.initial_review_met` counts only approve/reject/`advertiser_material` correction events |
| No priority fee for corrections | Done | One snapshot and one payment per booking (test asserted) |
| Creative versions immutable; a destination change needs review | Done | Immutability triggers; a new version is reviewed and never replaces the approved version until approved |

### 1.2 Corrections

| Agreed term | Status | Where |
|---|---|---|
| Necessary reasons, the exact version and the response deadline, in the account | Done | `ad_correction_requests` (advertiser sees reasons/version/deadline; internal `cause` hidden by column grant); portal `correctionText` |
| …and by email | Built, **disabled**, not hosted-verified | Outbox `correction_request` + `correction_deadline` (exact persisted deadline once delivery is recorded); provider delivery events feed `apply_correction_notice` (§1.8). Admin fallback unchanged. |
| Three working hours (09:00–17:00 UK, Mon–Fri, excl. E&W holidays); Friday 16:00 → Monday 11:00 | Done | `ads_internal.add_uk_working_hours` + JS parity |
| A known failed email starts no window; retry, fallback and late-bounce exceptions audited | Done | `ad_correction_notices` (append-only, idempotent key); late bounce → `notice_exception` (window unchanged pending MSM decision: **gate**) |
| Timely complete priority correction → new 3-working-hour review | Done | `correction_review_priority` deadline; at-deadline vs 1 s late tests |
| Late priority corrections and all standard corrections → end of next working day | Done | `correction_review_standard` |
| No added fee for a missed response deadline | Done | Nothing charges |
| Further requests repeat the cycle | Done | Each request links to its response version |
| MSM error cannot be relabelled as advertiser delay | Done | `cause = msm_error` does not satisfy the initial review and is excluded as advertiser waiting |

### 1.3 Booking intervals

| Agreed term | Status | Where |
|---|---|---|
| Precise UTC `[start, end)` intervals, displayed in Europe/London with explicit offsets | Done (amendments); new orders still calendar dates | `ad_bookings.serve_from/serve_until` (null = legacy dates) + `ads_internal.effective_range`; delivery, `serve_until`, impressions/clicks, reports and refund clipping use it; UI/PDF show offsets. Original dates, snapshot and confirmation are never rewritten. |
| 24-hour packages (30 days = 720 elapsed hours) | **Gated** | `ad_quote_elapsed` (behind `ads_hourly_packages_enabled`, OFF): exact elapsed interval, touched days, interval-level availability, **price withheld**. `ad_create_hold_elapsed` always refuses (`ADS_POLICY_GATE`) until Bryan confirms they replace calendar dates and pricing is agreed. |
| Never publish before an accepted booking, payment, an approved served version and the start; enforce the end in the serving path even if a job is delayed | Done (phase 1) | `ad_public_delivery` + WordPress `serve_until`; funding invariant |
| Correction-delay amendment: next whole UK hour, preserve duration where capacity permits, shorten at a confirmed following booking, keep the original interval and history, recorded advertiser agreement plus an atomic capacity recheck/reservation, no silent move | Done, **gated OFF** (§1.9) | `ad_admin_propose_amendment` → `ad_respond_amendment` (owner only) with `ad_booking_amendments` + append-only `ad_booking_interval_history`; acceptance re-checks interval capacity under unit locks |
| No negative or already-expired runs | Done | Refused at proposal (`ADS_NO_CAPACITY`) and acceptance (`ADS_STALE_AMENDMENT … already ended`) |
| Multi-placement capacity atomic | Done (day granularity) | `ads_internal.lock_units`; concurrency test |
| Gates: exact-hour rounding, DST repeated/skipped hour, pending-amendment hold expiry, earlier approved creative during replacement review | **Gated** | Current behaviour: the earlier approved creative keeps serving. The replacement review duration is marked `replacement_review_provisional`. |

### 1.4 Refunds

| Agreed term | Status | Where |
|---|---|---|
| Full £150 if MSM misses the initial paid priority deadline through its own fault, even if the campaign starts on time | Done | `ad_review_sla.priority_fee_refund_assessment_needed` → priority line in `ad_admin_propose_refund`, once per booking |
| A timely genuine correction request meets the initial review; a late correction review does not refund the fee automatically | Done | SLA rules; test at 11h59m |
| Lost time: placement charge (excluding priority) ÷ purchased elapsed hours × lost elapsed hours | Done | `ads_internal.lost_time_refund_pence`; JS `lostTimeRefund` (parity tested) |
| Integer money, exact fractions, round only the final penny, cap at the placement charge, no double counting | Done | Multirange subtraction of earlier assessed time; earlier lost-time pence deducted from the cap. Rounding is half-up (**gate**: rule to confirm). |
| £300/720 h × 6 h = £2.50; with a missed priority deadline = £152.50 | Done | JS tests; SQL `30_` (£280/672 h × 6 h = £2.50 + £150) |
| Separate advertiser waiting from MSM delay, with evidence | Partial | Evidence (≥10 chars) is required per interval. The admin enters the MSM-fault intervals, and `msmLostIntervals` (JS) computes them. **Not derived automatically from DB outage/approval records.** |
| An extension cannot be forced instead of a refund owed | Done | No extension path exists |
| Manual audited proposal → approval; processor state distinct; idempotent; failure handling; no automatic live refunds | Done | `ad_refund_assessments` / `_lines` / `_processing_events`. Money is moved only manually in Stripe. |
| Contractual target: 14 days after entitlement/amount confirmation | Done | `target_pay_by = approval + 14 days` |
| Statutory cancellation separate | Done (separate path; consumer disabled) | |
| Manual gates: defeated purpose, whole run lost, rejection, completed-review treatment, tax/discount/multi-slot allocations | Partial | Auto-gated: `whole_run_lost`, `multi_slot_allocation`. **Defeated purpose, rejection, completed-review treatment and tax/discount** need the admin to recognise them (no flags yet). |
| Advertiser-visible refund status | **Not built** | Admin-only RLS |

### 1.5 Business cancellation

| Agreed term | Status | Where |
|---|---|---|
| Not an automatic unused-hours refund, and not a blanket no-refund; removal distinct from the assessment | Done | `ad_admin_cancel_booking(id, reason, party_type)` no longer sets `requires_refund`; `ad_cancellation_cases` |
| Retained = delivered service + evidenced reasonable net loss after mitigation, saved costs and resale; no double recovery; maximum is the price | Done | `ad_admin_propose_cancellation_refund` (retained ≤ price; earlier assessments deducted; one live cancellation assessment) |
| Consumer status decided on the facts, not by a checkbox; a separate reviewed consumer path with express, unticked early-start consent | **Gated / not built** | `consumer` → `ADS_CONSUMER_CANCELLATION_PATH_DISABLED`; `undetermined` → assessment gated |
| Unsupported or unreviewed paths disabled; no auto renewal | Done | No renewal exists |
| Store the agreed order/terms version and confirmation; no draft terms published as final | Done | `order_terms_version = 'DRAFT-NOT-APPROVED-2026-10-16'` in snapshot/confirmation, labelled draft in the UI |
| Advertiser-initiated cancellation request | **Not built** | Admin records `initiated_by = msm` only |

### 1.6 Engineering rules

| Rule | How it is met |
|---|---|
| Forward migrations only | Three new forward migrations; the earlier ones are unchanged |
| Deterministic injected clock | `ads_internal.clock_now()` honours `ads.test_now` only when `session_user <> 'authenticator'`. API traffic always gets `now()`. JS functions take `now`. |
| Maintained E&W holidays | `ad_uk_holidays` (2026–2028) and `EW_BANK_HOLIDAYS` (JS). **Must be extended before 2029.** |
| Immutable deadline/event audit | `block_mutation` triggers on deadlines, events, notices, refund lines/events, cancellation cases; assessments never deleted |
| Server-side ownership/admin checks; private moderation storage | All RPCs are `SECURITY DEFINER` with `is_admin_or_above()` / `owns_*`; storage unchanged (private bucket) |
| Secrets | None added; no new env vars |
| Idempotent duplicates | Webhooks (existing), mailer notices (`idempotency_key`), processor events (`idempotency_key`), deadline creation (once per version) |
| RLS not widened | New tables admin-only except the advertiser's own corrections (cause hidden), deadlines and confirmations |

### 1.7 Review fixes on `9fc02d8` (migration `20261016180000`)

| Concern | Fix | Evidence |
|---|---|---|
| Cross-kind ceiling/order: a cancellation balance and a service-failure assessment could together exceed the amount paid; approval did not re-validate | Every propose/decide locks the **booking row first**. Proposals keep the separate caps (fee once ≤ fee; lost time ≤ placement minus earlier lost time). A proposal facing an open/approved assessment of the other kind is recorded with its **full** computed entitlement but gated `cross_kind_allocation`; one that would take non-rejected assessments over the paid total is gated `exceeds_booking_total`. Approval refuses gates, refuses while another kind is open/approved, and re-checks booking-wide and per-kind ceilings against **approved** rows. | `30_`: both proposal orders, rejection + re-proposal, rogue rows over the ceiling/fee cap. Runner: 6 parallel proposals → 1 assessed (6 h, no double counting); 4 parallel approvals of one assessment → 1; two approvals that each fit but together exceed the payment → 1 approved, 1 `ADS_REFUND_CEILING`. **Mutation check:** without the booking lock in `ad_admin_decide_refund` that race approved both (approved > paid), and the test failed. |
| Cancellation initiator was always `msm` while advertiser-cancellation retention applied | `ad_admin_cancel_booking(id, reason, party_type, initiated_by)` records `advertiser` or `msm` (legacy 2-arg = `undetermined`, assessment gated). Retention of delivered value + evidenced net loss applies only to an advertiser-initiated business cancellation. An MSM-initiated removal cannot retain any loss (refused) and its assessment (price − delivered value) is always gated `msm_initiated_cancellation` for a manual decision, so other lawful remedies are not pre-empted. | `30_` both initiators; `adsPresentation.test.js` wording (`removalMessage`, `cancellationGuidance`); admin must pick the initiator before removing; the loss field is hidden for MSM removals |
| JS treated "no delivered notice" as late; SQL as timely | `correctionResponseTimely`: no notice → cannot be late (server parity); priority keeps the 3-working-hour review | `ukWorkingTime.test.js`; `20_` (response before any notice → `correction_review_priority`, due +3 wh) |
| Standard deadlines stored as exclusive midnight but compared with `<=` | `ads_internal.deadline_met(kind, at, due)` / JS `deadlineMet`: end-of-day kinds (`initial_standard`, `correction_review_standard`, `replacement_review_provisional`) are met only **strictly before** the stored instant; exact kinds (`initial_priority`, `correction_review_priority`, `correction_response`) are inclusive. `ad_review_sla` uses it and exposes `initial_due_exclusive`. Unknown kinds throw in JS. | `20_`: standard approval exactly at the stored midnight → not met; boundary checks for every kind; JS boundary tests |
| Stale partial-refund note "delivery suspended" | `ad_apply_stripe_event` (copied forward, only that branch changed): within approved assessments → "…delivery and approval continue", outcome `partially_refunded_within_approved`; beyond → "…suspended…", outcome `partially_refunded_flagged` | `30_` both notes; `10_` regression unchanged and passing |

### 1.8 Advertising email outbox (migration `20261016210000`, increment A)

| Piece | What it does |
|---|---|
| Enqueue | AFTER INSERT triggers on persisted facts only: `ad_review_deadlines` (`initial_priority` → admin alert with the exact due instant and version; `correction_response` → advertiser deadline email), `ad_correction_requests` (reasons + exact version), `ad_review_events` (approved/rejected + reason), `ad_booking_confirmations`. One row per fact (`dedupe_key` unique). Rows are enqueued even while sending is off. |
| Disabled by default | DB switch `ads_email_enabled` = OFF (claim returns nothing) **and** server `ADS_EMAIL_ENABLED` unset (worker answers 503). Neither was changed. |
| Worker | `POST /api/ads/notify-worker`, `Authorization: Bearer ADS_WORKER_SECRET` (≥32 chars, constant-time compare); service-role `ad_notify_claim` (row lease, `skip locked`, expired leases reclaimed) → render → Resend with `Idempotency-Key = msm-ads-notify-<row id>` → `ad_notify_result` (attempt-checked: a crashed/duplicate worker's late result is `stale`). Backoff 5 min × 2ⁿ (cap 6 h), `dead` after 6 attempts, `failed` on permanent errors; admin retry/cancel (audited). No cron is configured. |
| Templates | `api/_ads/emailTemplates.js`: every value HTML-escaped, subjects stripped of control characters, links only from the configured base URL, instants with explicit UTC offset, draft terms labelled. |
| Provider adapter | `api/_ads/resendClient.js`: same endpoint and `RESEND_API_KEY` name as `api/notify.js`, but **not** its public unauthenticated route, its `onboarding@resend.dev` default sender or its recipient. `ADS_EMAIL_FROM` has no default. |
| Delivery events | `POST /api/ads/email-events`: Svix-signed raw body (`ADS_RESEND_WEBHOOK_SECRET`, 5-minute tolerance), idempotent on `svix-id`; unknown message → 503 so the provider retries. |
| Semantics | **accepted** = provider accepted (not delivered, not read). **delivered** = provider-reported delivery to the recipient's mail server (not proof of reading); for a correction request this, or the admin fallback, starts the 3-working-hour window at the reported time. **bounced/failed/suppressed** before delivery = known failure, no window; after delivery = `notice_exception` (late-bounce gate, MSM decides). An email failure after a fallback-started window is history only. Opens and clicks are ignored. |
| Admin | "Email notifications" section: status in plain words, attempts, times, last error, retry/cancel. Outbox and events are admin-only (RLS); workers use the service role only. |
| Gates / not done | Whether provider *acceptance* (rather than delivery) should start a window is a policy gate; the conservative choice (delivery) is implemented. No sender domain, DNS, Resend webhook endpoint, env var or cron was created, and **no email was sent**. All provider calls in tests are mocks. |

### 1.9 Booking amendments + exact intervals (migration `20261016230000`, increment B)

| Piece | What it does |
|---|---|
| Model | `ad_bookings.serve_from/serve_until/amended_at` (both null = legacy calendar dates); `ad_booking_amendments` (immutable intervals; one open per booking; status proposed/accepted/rejected/expired/withdrawn/superseded); `ad_booking_interval_history` (append-only: `original` then each `amended`). Start date, end date, purchase snapshot and order confirmation keep the original order. |
| Propose (admin) | Needs `ads_amendments_enabled` (OFF) **and** `amendment_offer_minutes` (unset → `ADS_POLICY_GATE`, expiry undecided). Paid, funded, approved after the run started (else `ADS_NO_AMENDMENT_NEEDED`). Start = next whole UK hour strictly after the approval instant. Duration = original purchased elapsed seconds (DST-correct). The run is shortened at the start of any other active booking (confirmed or unexpired hold), never displacing it; zero/negative/already-ended runs refused. A proposal holds **no** capacity; a new proposal supersedes the open one. `basis` records the provisional rules. |
| Accept / reject (owner only) | Owner of the booking only; admins get `ADS_NOT_FOUND` (cannot agree for the advertiser). Expired offers return `expired`. Acceptance locks the booking, then the unit rows, refuses stale proposals (booking changed, no longer confirmed/funded, run already ended) and re-checks **interval-level** capacity against every active booking's effective interval. It then writes history, sets the interval and moves inventory day rows to the London days touched (conservative for day-based holds). |
| Serving path | `eligible_creatives` checks `now() <@ effective_range` (start inclusive, end exclusive), so the end holds even if no job runs; `serve_until` (WordPress hard expiry) is the exact end; impressions/clicks after the end are `not_eligible`. Reports return original + served interval, exact served seconds and the touched days; the PDF prints both. |
| Refunds | Lost time is clipped to the served interval; the denominator stays the **original purchased** elapsed hours. |
| Gates (support built, defaults unchanged) | `replacement_pauses_previous_creative` (OFF = earlier approved creative keeps running during a replacement review); exact-hour rounding and DST handling recorded as PROVISIONAL in each proposal; pending-offer expiry undecided (setting required); 24 h packages quote-only and gated. |
| Tests | `50_booking_amendments.sql`: gates, shortened at a following booking, preserved duration, later holds refused, report and refund denominator, ownership (other advertiser, admin), immutability, supersede after a refused acceptance, expiry exactly at `expires_at`, run ended exactly at the proposed end, no capacity, approved before start, cancelled booking, DST (47 elapsed hours, 11:00 GMT Sat → 11:00 BST Mon), 24 h gates, delivery boundaries (start inclusive, end exclusive, never before start), metrics after the end, replacement gate. Runner: acceptance vs a competing hold for the freed hours, in both orders → exactly one wins, no day over capacity. **Mutation check:** without the unit lock in `ad_respond_amendment` the hold-first order double-booked a day and the test failed. |
| Not done | No amendment email (could reuse the outbox later); the portal accept/reject UI is build-checked only; new bookings are still sold as calendar dates. |

## 2. Forward migrations and rollback

Apply **in filename order**, only after review, **on staging only**:

1. `supabase/migrations/20261016090000_ads_standard_earliest_start.sql` (earlier commit, not yet applied on staging)
2. `supabase/migrations/20261016120000_ads_review_corrections_priority.sql`
3. `supabase/migrations/20261016150000_ads_refund_cancellation_assessment.sql`
4. `supabase/migrations/20261016180000_ads_refund_invariants_initiator_deadlines.sql` (review fixes on `9fc02d8`, see §1.7)
5. `supabase/migrations/20261016210000_ads_notification_outbox.sql` (§1.8)
6. `supabase/migrations/20261016230000_ads_booking_amendments.sql` (§1.9)

Each file is a plain forward migration on top of the previous one. They are not wrapped in a transaction, so run each with `psql -v ON_ERROR_STOP=1 -1 -f <file>`, or through the Supabase SQL editor in one run. Then run `supabase/staging/03_postflight_readonly.sql`. The local proof is `npm run test:ads-staging`, which applies all four ads migrations on a bootstrapped empty platform DB and runs every suite there.

**Behaviour changes on apply** (review before applying):

- `ad_admin_set_setting` now allows `ads_priority_review_enabled = true` (the default stays OFF).
- `ad_admin_cancel_booking` (2-arg) records an `undetermined` cancellation case and **no longer flags `requires_refund`**; the admin UI uses the 4-arg form with the actual initiator.
- Standard review deadlines become exclusive of the stored midnight in `ad_review_sla`.
- `booking_funded` treats a refund that does not exceed **approved** assessments as still funded.

**Rollback:**

- Switches first (delivery off / `ADS_API_ENABLED` unset).
- Then the guarded full rollback `supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql`. It drops every `public.ad_%` table, all ads functions and `ads_internal`. It refuses while any non-test booking, live payment or stored file exists.
- There is no partial down-migration per file: forward-fix instead. The rollback test (`npm run test:ads-db`) shows 0 ads objects left and the non-ads relations untouched.

## 3. Staging manual test script (advertiser + admin + Stripe sandbox)

**Preconditions:**

- Migrations above applied to **staging** (`oyakrgdmplmxmlhjfqcd`) by MSM.
- Preview env as in `README.md` §Verification.
- The routing/raw-body checks there pass.
- Synthetic accounts only. Stripe **sandbox**, test cards only.
- Browser security policy currently blocks hosted API checks from this agent; a human must run this.

**A. Setup (admin).** Activate the TEST unit and the daily package. Enable portal, checkout and delivery. Leave priority **off**.

**B. Advertiser, standard booking.**

- Pick dates. Check the price: the deadline text names the standard rule and the price shows no priority line.
- Hold, then pay with `4242 4242 4242 4242`.
- Wait for the webhook: the booking shows Paid with the durable confirmation (draft terms version).
- Upload artwork and link: the admin SLA shows `initial_standard` due at 00:00 after the next working day.

**C. Admin enables priority.** Toggle `ads_priority_review_enabled`. After a first price check the advertiser sees the checkbox. The quote shows £150, placement and total, and the exact 12-hour deadline with UTC offset. Hold and pay. Confirm the Stripe Checkout shows **two line items** (placement + priority review) summing to the total.

**D. Corrections.**

- Admin: Request correction (advertiser material, two reasons). Before any notice, the advertiser sees "window starts when our notice reaches you".
- Admin: Record fallback notice delivered (no mailer exists). The response deadline appears (3 working hours, offset shown).
- Advertiser: submit a corrected version. The SLA shows `correction_review_priority` (timely) or `_standard` (late).
- Repeat with cause `msm_error` and confirm the SLA does not count it as the initial review.

**E. Missed priority deadline.** On a fresh priority booking, approve more than 12 h after material arrives. You can wait, or check it locally in the SQL suite. The SLA shows "Priority deadline missed".

**F. Refund assessment.**

- Propose a refund with the priority fee and one lost interval (`ISO | ISO | evidence`). Amounts are recomputed server-side.
- Approve with a note: the pay-by date is +14 days.
- In the **Stripe sandbox dashboard**, refund that amount on the payment manually.
- Record "submitted"/"succeeded" with the `re_…` id. A double click shows "Already recorded".
- Confirm `charge.refunded` arrives. The booking stays Paid and the advert keeps delivering (approved partial refund).
- Then refund 1p more in Stripe: delivery stops (beyond approved assessments).

**G. Removal + business cancellation.**

- Remove a paid booking with party type **Business**. It stops delivering, and no REFUND REQUIRED flag appears.
- Propose a cancellation assessment (delivered value + net loss + evidence): refund = price − retained.
- "Consumer" is not offered (the server refuses it as well). The legacy/undetermined removal shows the assessment as gated.

**H. Unauthorised.** As the advertiser, call any `ad_admin_*` RPC from the browser console: `ADS_FORBIDDEN`. Reading `ad_refund_assessments` returns nothing.

**Record:** booking ids, Stripe event ids and screenshots, in the PR. No card data or secrets.

## 4. Release blockers (paid bookings must not launch until resolved)

1. Hosted verification never performed: preview routing/raw body, Stripe Checkout + webhooks, staging RLS/storage, WordPress plugin.
2. **Email built but never run against Resend**: needs a verified sender domain, `ADS_EMAIL_FROM`, `ADS_WORKER_SECRET`, `ADS_ADMIN_ALERT_EMAIL`, a Resend webhook endpoint + `ADS_RESEND_WEBHOOK_SECRET`, a scheduler for the worker, then a staging send to a synthetic mailbox. Until then the response window still depends on the admin fallback.
3. **Booking amendments** are built but gated OFF and unverified on hosted services. The offer-expiry period, exact-hour rounding and DST policy must be confirmed before enabling. Sales are still calendar dates: timestamp rescheduling exists only through amendments.
4. **24-hour packages** gated pending Bryan; bookings are still calendar days.
5. **Consumer cancellation path** (reviewed flow, express unticked early-start consent) not built; consumer status cannot be processed.
6. Decision gates: final-penny rounding; replacement review duration; late-bounce effect on the window; whether an account-only notice counts; earlier creative during replacement review; DST/hour rounding; pending-amendment hold expiry; defeated purpose/rejection/completed-review/tax/discount/multi-slot treatment; dual control for refund approval; advertiser-visible refund status.
7. Terms are DRAFT (`DRAFT-NOT-APPROVED-2026-10-16`); real prices, VAT and invoices undecided; Stripe live mode not built.
8. (Fixed in `20261016180000`: the partial-refund status note.) Cross-kind refund allocation (service failure + cancellation on one booking) and MSM-initiated cancellation refunds are **manual gates**: they record the entitlement but cannot be approved until a policy exists.
9. Bank holidays maintained only to 2028.

## 5. Commits (branch `claude/quirky-bohr-2dmbus`, draft PR #46)

| Commit | Content |
|---|---|
| `b885c09` | UK review clocks, review/correction event model, optional priority review (migration `20261016120000`) |
| `e431873` | Refund assessment maths + manual audited refunds + business cancellation (migration `20261016150000`), SQL suite `30_` |
| `9fc02d8` | Portal/admin UI for priority, corrections, confirmation, SLA and refunds |
| `fd97927` | This document and README updates |
| `97ed361` | Review fixes on `9fc02d8`: cross-kind refund invariant, cancellation initiator, deadline boundaries, partial-refund note (migration `20261016180000`) |
| `c65d4e2` | Increment A: notification outbox, worker, templates, Resend adapter, signed delivery events (migration `20261016210000`) |
| (this commit) | Increment B: booking amendments + exact intervals (migration `20261016230000`) |
