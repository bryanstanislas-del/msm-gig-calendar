/**
 * Pure presentation helpers for the advertiser portal / admin (tested in
 * adsPresentation.test.js). Status wording is deliberately explicit that
 * payment does not mean approval or publication.
 */
import { formatDeadline } from "./londonTime.js";
import { formatLondonWithOffset } from "./ukWorkingTime.js";

export function formatPence(pence, currency = "gbp") {
  const n = Number(pence) || 0;
  const sym = currency === "gbp" ? "£" : `${String(currency).toUpperCase()} `;
  return `${sym}${(n / 100).toFixed(2)}`;
}

const BOOKING_LABELS = {
  held: "Held - awaiting payment",
  confirmed: "Paid",
  expired: "Hold expired",
  cancelled: "Cancelled",
  refunded: "Refunded",
  payment_conflict: "Payment received after hold expired - refund due",
};

/**
 * One advertiser-facing status line for a booking + its campaign.
 * `now` is injectable for tests.
 */
export function describeBooking(booking, campaign, currentVersion, now = new Date()) {
  if (!booking) return { label: "", tone: "neutral" };
  if (booking.status === "held" && new Date(booking.hold_expires_at) <= now) {
    return { label: BOOKING_LABELS.expired, tone: "neutral" };
  }
  if (booking.status !== "confirmed") {
    return { label: BOOKING_LABELS[booking.status] || booking.status, tone: booking.status === "held" ? "warn" : "neutral" };
  }
  const rs = campaign?.review_status;
  if (rs === "awaiting_creative") return { label: "Paid - upload artwork and link to start review", tone: "warn" };
  if (rs === "under_review") {
    const due = currentVersion?.review_due_before ? ` - decision due by ${formatDeadline(currentVersion.review_due_before)}` : "";
    return { label: `Under review${due}`, tone: "warn" };
  }
  if (rs === "correction_requested") {
    return { label: "Correction requested - see MSM's reasons and your response deadline below", tone: "bad" };
  }
  if (rs === "rejected") {
    return { label: campaign?.approved_version_id ? "Replacement rejected - previous approved advert still running" : "Changes needed - see reviewer note", tone: "bad" };
  }
  if (rs === "approved") {
    if (campaign?.paused) return { label: "Approved - paused by MSM", tone: "neutral" };
    return { label: "Approved - runs on your booked dates", tone: "good" };
  }
  return { label: BOOKING_LABELS.confirmed, tone: "neutral" };
}

/** Picker floor/default: the server's earliest standard start, never earlier. */
export function clampToEarliest(isoDate, earliest) {
  if (!earliest) return isoDate;
  return !isoDate || isoDate < earliest ? earliest : isoDate;
}

/**
 * Honest explanation of the earliest standard start. It assumes payment AND
 * complete artwork/link happen now, and says what happens if they come later.
 * It never promises approval.
 */
export function earliestStartExplanation(info, priorityAvailable = false) {
  if (!info?.earliest_start) return "";
  const due = info.review_due_before_if_ready_now ? formatDeadline(info.review_due_before_if_ready_now) : "the end of the next UK working day";
  return `Earliest standard start: ${info.earliest_start}. This assumes you pay and submit complete artwork and link now: MSM's standard review is by ${due}. ` +
    "If payment or artwork arrive later, the review finishes later. If that is after your first booked day, the advert only runs on the remaining booked days " +
    "(dates are not moved or refunded automatically). Approval is not guaranteed." +
    (priorityAvailable ? " Optional priority review is offered for this booking (see the price check)." : " Priority review is not available.");
}

/**
 * Exact review promise shown BEFORE payment for the option chosen in the
 * quote (ad_quote 4-arg). Deadlines carry an explicit UTC offset.
 */
export function reviewPromiseText(q) {
  if (!q) return "";
  const due = q.review_due_if_ready_now ? formatLondonWithOffset(q.review_due_if_ready_now) : null;
  if (q.priority_review) {
    return `Priority review (${formatPence(q.priority_fee_pence, q.currency)}): MSM's first review decision within 12 elapsed hours (nights and weekends included) ` +
      `after payment has cleared AND complete artwork, link and info are received${due ? ` - if both happen now, by ${due}` : ""}. ` +
      "A decision is an approval, a reasoned rejection or a necessary correction request. No extra fee for corrections.";
  }
  return "Standard review: MSM's first review decision by 23:59:59 UK time on the next working day (Mon-Fri, excluding England & Wales bank holidays) " +
    `after payment has cleared AND complete artwork, link and info are received${due ? ` - if both happen now, before ${due}` : ""}.`;
}

/** Advertiser-facing correction request (reasons, exact version, response deadline). */
export function correctionText(c) {
  if (!c) return "";
  const reasons = (c.reasons || []).join("; ");
  const head = `MSM asked for a correction to version ${c.version_no ?? "?"}: ${reasons}.`;
  if (c.status === "responded") return `${head} You responded ${c.responded_at ? formatLondonWithOffset(c.responded_at) : ""}${c.timely === false ? " (after the deadline)" : ""}.`;
  if (c.status === "withdrawn") return `${head} Withdrawn by MSM.`;
  if (!c.response_due_at) return `${head} Your 3-working-hour response window starts when our notice reaches you.`;
  return `${head} Please submit a corrected version by ${formatLondonWithOffset(c.response_due_at)} (3 UK working hours, 09:00-17:00 Mon-Fri).`;
}

/** Durable order confirmation summary (written once when payment is verified). */
export function confirmationText(conf) {
  if (!conf) return "";
  const parts = [`Placement ${formatPence(conf.placement_pence, conf.currency)}`];
  if (conf.priority_review) parts.push(`priority review ${formatPence(conf.priority_fee_pence, conf.currency)}`);
  return `Order confirmed ${formatLondonWithOffset(conf.confirmed_at)}: ${parts.join(" + ")} = ${formatPence(conf.total_pence, conf.currency)}. ` +
    `Runs ${formatLondonWithOffset(conf.booked_from)} until ${formatLondonWithOffset(conf.booked_until)} (end not included) once approved. ` +
    `Review: ${conf.review_rule}. Terms version: ${conf.terms_version || "not recorded"}.`;
}

export function holdMinutesLeft(booking, now = new Date()) {
  if (!booking || booking.status !== "held") return 0;
  return Math.max(0, Math.floor((new Date(booking.hold_expires_at) - now) / 60000));
}

/** Checkout needs >= 31 minutes left on the hold (Stripe minimum session life is 30). */
export function canStartCheckout(booking, now = new Date()) {
  return holdMinutesLeft(booking, now) >= 31;
}

const ERROR_TEXT = {
  ADS_CAPACITY_UNAVAILABLE: "Those dates are already booked for this position. Try other dates.",
  ADS_INVALID_DATES: "Those dates can't be booked.",
  ADS_TOO_MANY_HOLDS: "You already have the maximum number of unpaid holds. Pay for or cancel one first.",
  ADS_NO_ADVERTISER: "Create your advertiser profile first.",
  ADS_DISABLED: "Advertising is not open yet.",
  ADS_HOLD_TOO_SHORT: "Less than 31 minutes are left on this hold. Cancel it and make a new one to pay.",
  ADS_CHECKOUT_IN_PROGRESS: "A checkout is already open for this hold. Wait for it to finish or expire.",
  ADS_NOT_CONFIGURED: "Payments are not configured on this environment yet.",
  ADS_STRIPE_TEST_KEY_REQUIRED: "Payments are not configured on this environment yet.",
  ADS_INVALID_DESTINATION: "The destination link is not allowed.",
  ADS_INVALID_CREATIVE: "The artwork could not be accepted.",
  ADS_PRODUCT_UNAVAILABLE: "That package is not available.",
  ADS_PRIORITY_UNAVAILABLE: "Priority review is not offered at the moment.",
  ADS_NOT_FUNDED: "The payment for this booking has been refunded, so it cannot be approved or shown.",
};

export function friendlyAdsError(err) {
  const raw = String(err?.message || err?.error || err || "");
  const code = (/ADS_[A-Z0-9_]+/.exec(raw) || [])[0];
  const detail = (/^ADS_[A-Z0-9_]+:\s*(.+)$/.exec(raw) || [])[1];
  if (code && ERROR_TEXT[code]) return detail && code !== "ADS_CAPACITY_UNAVAILABLE" ? `${ERROR_TEXT[code]} ${detail}` : ERROR_TEXT[code];
  return "Something went wrong. Please try again.";
}

/**
 * Admin input for MSM-fault lost intervals, one per line:
 *   <from ISO instant> | <until ISO instant> | <evidence>
 * Instants MUST carry an explicit offset (Z or +01:00) so a wall-clock time
 * is never guessed across the DST change. The server re-validates, clips to
 * the booked run and removes already-assessed time.
 */
export function parseLostIntervals(text) {
  const out = [];
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const [from, until, ...ev] = line.split("|").map((x) => x.trim());
    const evidence = ev.join(" | ");
    const withOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    if (!withOffset.test(from || "") || !withOffset.test(until || "")) throw new Error(`Line ${i + 1}: use ISO times with an explicit offset, e.g. 2026-11-02T10:00Z`);
    if (new Date(until) <= new Date(from)) throw new Error(`Line ${i + 1}: end must be after start`);
    if (evidence.length < 10) throw new Error(`Line ${i + 1}: evidence (at least 10 characters) is required`);
    out.push({ from: new Date(from).toISOString(), until: new Date(until).toISOString(), evidence });
  });
  return out;
}

/**
 * Stable key so a repeated click records the same processor event once.
 * `attempt` = number of processor events already recorded, so a genuine
 * second failure (after a reload) is a new event, not a duplicate.
 */
export function refundProcessingKey(assessmentId, status, providerRefundId, attempt = 0) {
  return `refund-${assessmentId}-${attempt}-${status}-${providerRefundId || "none"}`;
}
