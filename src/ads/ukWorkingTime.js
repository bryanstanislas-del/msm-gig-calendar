/**
 * Advertising review/correction clocks (agreed terms, 2026-10-16).
 *
 * Pure functions over an INJECTED clock (pass instants in; nothing here
 * reads Date.now()). The database mirrors every rule in
 * ads_internal.* (migration 20261016120000) and the same cases are tested
 * on both sides. The database is the source of truth for stored deadlines.
 *
 *  - Standard initial review: by 23:59:59 Europe/London on the next Mon-Fri
 *    working day (England & Wales bank holidays excluded) after the clock
 *    starts. Returned as the EXCLUSIVE instant 00:00 London the day after.
 *  - Priority initial review (optional, £150): within 12 ELAPSED hours of
 *    the clock start, including nights and weekends.
 *  - The initial clock starts only once payment has CLEARED and complete
 *    artwork/link/info has been received -- whichever happens last.
 *  - Correction response window: THREE WORKING HOURS (09:00-17:00 London,
 *    Mon-Fri, E&W bank holidays excluded) from successful notice delivery.
 *    Friday 16:00 -> Monday 11:00 when Monday is a working day.
 *  - Correction review: priority + timely complete correction -> 3 working
 *    hours from receipt; otherwise (late priority, or standard) -> end of
 *    the next working day after receipt.
 */
import { londonDate, addDays, londonLocalToInstant, londonOffsetLabel, nextWorkingDayAfter, reviewDueBefore, isWorkingDay } from "./londonTime.js";

/**
 * England & Wales bank holidays, 2026-2028 (incl. substitute days). Source:
 * gov.uk/bank-holidays. MUST be maintained; keep in sync with
 * public.ad_uk_holidays. Weekdays verified by script on 2026-10-16.
 */
export const EW_BANK_HOLIDAYS = Object.freeze([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  "2028-01-03", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-29", "2028-08-28", "2028-12-25", "2028-12-26",
]);

export const WORKDAY_START_HOUR = 9;
export const WORKDAY_END_HOUR = 17;
export const PRIORITY_REVIEW_HOURS = 12;
export const CORRECTION_RESPONSE_WORKING_HOURS = 3;
export const PRIORITY_CORRECTION_REVIEW_WORKING_HOURS = 3;
export const PRIORITY_FEE_PENCE = 15000;

const HOUR = 3600 * 1000;
const toDate = (x) => (x instanceof Date ? x : new Date(x));

/** Clock start = the later of "payment cleared" and "complete material received"; null until both. */
export function initialClockStart({ paymentClearedAt, materialCompleteAt }) {
  if (!paymentClearedAt || !materialCompleteAt) return null;
  const a = toDate(paymentClearedAt), b = toDate(materialCompleteAt);
  return a > b ? a : b;
}

/** End of next working day (exclusive 00:00 London of the following day). */
export function standardReviewDue(from, holidays = EW_BANK_HOLIDAYS) {
  return reviewDueBefore(toDate(from), holidays);
}

export function priorityReviewDue(from) {
  return new Date(toDate(from).getTime() + PRIORITY_REVIEW_HOURS * HOUR);
}

export function initialReviewDue({ clockStart, priority }, holidays = EW_BANK_HOLIDAYS) {
  if (!clockStart) return null;
  return priority ? priorityReviewDue(clockStart) : standardReviewDue(clockStart, holidays);
}

/** Adds working time (09:00-17:00 London, Mon-Fri, excl. holidays). */
export function addWorkingHours(from, hours, holidays = EW_BANK_HOLIDAYS) {
  let remaining = Math.round(hours * HOUR);
  let cursor = toDate(from);
  if (remaining <= 0) return cursor;
  for (let guard = 0; guard < 4000; guard++) {
    const day = londonDate(cursor);
    const open = londonLocalToInstant(day, WORKDAY_START_HOUR);
    const close = londonLocalToInstant(day, WORKDAY_END_HOUR);
    if (!isWorkingDay(day, holidays) || cursor >= close) {
      cursor = londonLocalToInstant(nextWorkingDayAfter(day, holidays), WORKDAY_START_HOUR);
      continue;
    }
    if (cursor < open) cursor = open;
    const available = close - cursor;
    if (remaining <= available) return new Date(cursor.getTime() + remaining);
    remaining -= available;
    cursor = londonLocalToInstant(nextWorkingDayAfter(day, holidays), WORKDAY_START_HOUR);
  }
  throw new Error("addWorkingHours: no working time found (holiday table?)");
}

/** Response window starts only on successful notice delivery; a known failure starts nothing. */
export function correctionResponseDue({ noticeDeliveredAt }, holidays = EW_BANK_HOLIDAYS) {
  if (!noticeDeliveredAt) return null;
  return addWorkingHours(noticeDeliveredAt, CORRECTION_RESPONSE_WORKING_HOURS, holidays);
}

/** Inclusive: a correction received exactly at the response deadline is timely. */
export function isTimely(receivedAt, dueAt) {
  return Boolean(dueAt) && toDate(receivedAt) <= toDate(dueAt);
}

export function correctionReviewDue({ receivedAt, responseDueAt, priority }, holidays = EW_BANK_HOLIDAYS) {
  if (priority && isTimely(receivedAt, responseDueAt)) {
    return addWorkingHours(receivedAt, PRIORITY_CORRECTION_REVIEW_WORKING_HOURS, holidays);
  }
  return standardReviewDue(receivedAt, holidays);
}

/** A review outcome meets a deadline if it happened at or before it. Holding acknowledgements never count. */
export const REVIEW_OUTCOMES = Object.freeze(["approved", "rejected", "correction_requested"]);
export function reviewMetDeadline({ outcome, outcomeAt, dueAt, genuine = true }) {
  if (!REVIEW_OUTCOMES.includes(outcome)) return false;
  if (outcome === "correction_requested" && !genuine) return false; // MSM's own error is not a review
  return toDate(outcomeAt) <= toDate(dueAt);
}

/** Next whole UK hour strictly after `instant` (London offsets are whole hours). */
export function nextWholeUkHour(instant) {
  const t = toDate(instant).getTime();
  return new Date(Math.floor(t / HOUR) * HOUR + HOUR);
}

/** "Mon 19 Oct 2026 11:00 BST (UTC+01:00)" -- explicit offset for every displayed instant. */
export function formatLondonWithOffset(instant) {
  const d = toDate(instant);
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).formatToParts(d)) parts[p.type] = p.value;
  const tz = parts.timeZoneName === "GMT+1" ? "BST" : parts.timeZoneName;
  const secs = parts.second === "00" ? "" : `:${parts.second}`;
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}${secs} ${tz} (UTC${londonOffsetLabel(d)})`;
}

export { addDays };
