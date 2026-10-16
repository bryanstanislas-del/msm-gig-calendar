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
| Durable confirmation | Partial | `ad_booking_confirmations` is written once on verified payment and shown in the portal. **No confirmation email** (no mailer exists). |
| A review is an approval, a reasoned rejection or a necessary correction request; a holding acknowledgement does not count | Done | `ad_review_sla.initial_review_met` counts only approve/reject/`advertiser_material` correction events |
| No priority fee for corrections | Done | One snapshot and one payment per booking (test asserted) |
| Creative versions immutable; a destination change needs review | Done | Immutability triggers; a new version is reviewed and never replaces the approved version until approved |

### 1.2 Corrections

| Agreed term | Status | Where |
|---|---|---|
| Necessary reasons, the exact version and the response deadline, in the account | Done | `ad_correction_requests` (advertiser sees reasons/version/deadline; internal `cause` hidden by column grant); portal `correctionText` |
| …and by email | **Not built** | No mailer. `ad_record_correction_notice` (service_role) is the hook a mailer must call. Admin fallback: `ad_admin_record_correction_notice`. |
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
| Precise UTC `[start, end)` intervals, displayed in Europe/London with explicit offsets | Partial | Bookings are still whole UK calendar days, stored as dates and converted with `ads_internal.london_day_start`. Confirmations store `booked_from`/`booked_until` instants. The UI shows offsets (`formatLondonWithOffset`). |
| 24-hour packages (30 days = 720 elapsed hours) | **Gated** | `elapsedPackageInterval` (JS, DST-tested) only. Not sold until Bryan confirms they replace inclusive calendar dates. |
| Never publish before an accepted booking, payment, an approved served version and the start; enforce the end in the serving path even if a job is delayed | Done (phase 1) | `ad_public_delivery` + WordPress `serve_until`; funding invariant |
| Correction-delay amendment: next whole UK hour, preserve duration where capacity permits, shorten at a confirmed following booking, keep the original interval and history, recorded advertiser agreement plus an atomic capacity recheck/reservation, no silent move | Partial | Proposal maths only: `proposeCorrectionAmendment` (JS, tested). **No amendment table, agreement RPC or hourly capacity in the DB yet.** Bookings never move silently today. |
| No negative or already-expired runs | Done (proposal maths) | `viable: false` |
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

## 2. Forward migrations and rollback

Apply **in filename order**, only after review, **on staging only**:

1. `supabase/migrations/20261016090000_ads_standard_earliest_start.sql` (earlier commit, not yet applied on staging)
2. `supabase/migrations/20261016120000_ads_review_corrections_priority.sql`
3. `supabase/migrations/20261016150000_ads_refund_cancellation_assessment.sql`

Each file is a plain forward migration on top of the previous one. They are not wrapped in a transaction, so run each with `psql -v ON_ERROR_STOP=1 -1 -f <file>`, or through the Supabase SQL editor in one run. Then run `supabase/staging/03_postflight_readonly.sql`. The local proof is `npm run test:ads-staging`, which applies all four ads migrations on a bootstrapped empty platform DB and runs every suite there.

**Behaviour changes on apply** (review before applying):

- `ad_admin_set_setting` now allows `ads_priority_review_enabled = true` (the default stays OFF).
- `ad_admin_cancel_booking` (2-arg) records an `undetermined` cancellation case and **no longer flags `requires_refund`**.
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
2. **No email**: correction notices, confirmations, review outcomes. The response window depends on a recorded delivery.
3. **Booking amendments** after correction delay (agreement + atomic hourly capacity) not built. The earlier "date revision with the advertiser" requirement is therefore still unmet.
4. **24-hour packages** gated pending Bryan; bookings are still calendar days.
5. **Consumer cancellation path** (reviewed flow, express unticked early-start consent) not built; consumer status cannot be processed.
6. Decision gates: final-penny rounding; replacement review duration; late-bounce effect on the window; whether an account-only notice counts; earlier creative during replacement review; DST/hour rounding; pending-amendment hold expiry; defeated purpose/rejection/completed-review/tax/discount/multi-slot treatment; dual control for refund approval; advertiser-visible refund status.
7. Terms are DRAFT (`DRAFT-NOT-APPROVED-2026-10-16`); real prices, VAT and invoices undecided; Stripe live mode not built.
8. A known wording issue: after a partial refund of the funding payment, `ad_apply_stripe_event` sets `status_reason` to "delivery and approval suspended". This is inaccurate when the refund is within approved assessments; delivery continues correctly.
9. Bank holidays maintained only to 2028.

## 5. Commits (branch `claude/quirky-bohr-2dmbus`, draft PR #46)

| Commit | Content |
|---|---|
| `b885c09` | UK review clocks, review/correction event model, optional priority review (migration `20261016120000`) |
| `e431873` | Refund assessment maths + manual audited refunds + business cancellation (migration `20261016150000`), SQL suite `30_` |
| `9fc02d8` | Portal/admin UI for priority, corrections, confirmation, SLA and refunds |
| (this commit) | This document and README updates |
