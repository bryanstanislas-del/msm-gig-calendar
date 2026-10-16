/**
 * Pure presentation helpers for the advertiser portal / admin (tested in
 * adsPresentation.test.js). Status wording is deliberately explicit that
 * payment does not mean approval or publication.
 */
import { formatDeadline } from "./londonTime.js";

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
export function earliestStartExplanation(info) {
  if (!info?.earliest_start) return "";
  const due = info.review_due_before_if_ready_now ? formatDeadline(info.review_due_before_if_ready_now) : "the end of the next UK working day";
  return `Earliest standard start: ${info.earliest_start}. This assumes you pay and submit complete artwork and link now: MSM's standard review is by ${due}. ` +
    "If payment or artwork arrive later, the review finishes later. If that is after your first booked day, the advert only runs on the remaining booked days " +
    "(dates are not moved or refunded automatically). Approval is not guaranteed. Priority review is not available.";
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
  ADS_NOT_FUNDED: "The payment for this booking has been refunded, so it cannot be approved or shown.",
};

export function friendlyAdsError(err) {
  const raw = String(err?.message || err?.error || err || "");
  const code = (/ADS_[A-Z0-9_]+/.exec(raw) || [])[0];
  const detail = (/^ADS_[A-Z0-9_]+:\s*(.+)$/.exec(raw) || [])[1];
  if (code && ERROR_TEXT[code]) return detail && code !== "ADS_CAPACITY_UNAVAILABLE" ? `${ERROR_TEXT[code]} ${detail}` : ERROR_TEXT[code];
  return "Something went wrong. Please try again.";
}
