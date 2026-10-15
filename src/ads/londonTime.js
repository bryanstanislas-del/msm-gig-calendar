/**
 * Europe/London date helpers for advertising (phase 1).
 *
 * The database is the source of truth for every deadline and delivery
 * window (see ads_internal.london_day_start / review_due_before). These
 * mirrors exist so the portal can show the same values before a round
 * trip, and are tested against the same DST/holiday cases as the SQL.
 *
 * Date semantics: booking start/end are INCLUSIVE London calendar dates
 * ("YYYY-MM-DD"). A booking is live from 00:00 London on the start date
 * until, exclusive, 00:00 London on the day after the end date.
 */

const TZ = "Europe/London";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function londonParts(date) {
  const out = {};
  for (const p of partsFmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** London calendar date ("YYYY-MM-DD") of an instant. */
export function londonDate(instant = new Date()) {
  const p = londonParts(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

function offsetMinutes(instant) {
  const p = londonParts(instant);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

export function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) throw new Error(`Invalid date: ${s}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function addDays(isoDate, n) {
  const { y, m, d } = parseIsoDate(isoDate);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 00:00 Europe/London on isoDate, as a Date (DST-aware). */
export function londonDayStart(isoDate) {
  const { y, m, d } = parseIsoDate(isoDate);
  const guess = Date.UTC(y, m - 1, d);
  let instant = new Date(guess - offsetMinutes(new Date(guess)) * 60000);
  // Re-check at the candidate instant (offset can differ across a change).
  instant = new Date(guess - offsetMinutes(instant) * 60000);
  return instant;
}

export function daysInclusive(startIso, endIso) {
  const a = parseIsoDate(startIso), b = parseIsoDate(endIso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000) + 1;
}

export function isWorkingDay(isoDate, holidays = []) {
  const { y, m, d } = parseIsoDate(isoDate);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun .. 6 Sat
  return dow !== 0 && dow !== 6 && !holidays.includes(isoDate);
}

export function nextWorkingDayAfter(isoDate, holidays = []) {
  let d = addDays(isoDate, 1);
  while (!isWorkingDay(d, holidays)) d = addDays(d, 1);
  return d;
}

/**
 * Review deadline for a submission that became "ready" (fully paid AND
 * complete artwork/links) at `readyAt`: the end of the next UK working day,
 * returned as the EXCLUSIVE instant 00:00 London on the following day.
 */
export function reviewDueBefore(readyAt, holidays = []) {
  const working = nextWorkingDayAfter(londonDate(readyAt), holidays);
  return londonDayStart(addDays(working, 1));
}

/** Human label for an exclusive deadline, e.g. "end of Mon 19 Oct 2026 (UK time)". */
export function formatDeadline(exclusiveEnd) {
  if (!exclusiveEnd) return "";
  const last = new Date(new Date(exclusiveEnd).getTime() - 1);
  const p = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).formatToParts(last)) p[part.type] = part.value;
  return `end of ${p.weekday} ${p.day} ${p.month} ${p.year} (UK time)`;
}

export function formatLondonDateTime(instant) {
  if (!instant) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(instant)) + " UK time";
}

/** Is `now` inside the inclusive [start, end] London-date window? */
export function isWithinBookedDates(startIso, endIso, now = new Date()) {
  return now >= londonDayStart(startIso) && now < londonDayStart(addDays(endIso, 1));
}
