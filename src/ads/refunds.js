/**
 * Refund assessment maths (agreed terms 2026-10-16). Pure functions; the
 * database recomputes and stores the authoritative amounts
 * (ads_internal.lost_time_refund_pence, migration 20261016150000).
 *
 *  - Priority fee: the full fee if MSM missed the initial paid priority
 *    deadline through its own fault (even if the campaign starts on time).
 *    A timely genuine correction request meets the initial review; a late
 *    CORRECTION review does not by itself refund the initial fee.
 *  - Lost advertising time through MSM fault: placement charge (EXCLUDING
 *    the priority fee) / purchased elapsed seconds x lost elapsed seconds.
 *    Integer pence; exact rational arithmetic; only the final result is
 *    rounded to a penny; capped at the placement charge; overlapping fault
 *    intervals are merged so nothing is counted twice.
 *    Example: GBP 300 / 720 h x 6 h = GBP 2.50; with a missed priority
 *    deadline: GBP 152.50.
 *  - Advertiser waiting (e.g. correction response time) is never MSM fault.
 *
 * GATE: the rounding rule for the final penny is not yet agreed. Half-up is
 * implemented and exposed explicitly (`rounding`) so it can be changed in
 * one place; the exact fraction is always returned alongside.
 */

/** Normalise to sorted, merged [start, end) intervals of epoch ms. */
export function mergeIntervals(intervals) {
  const xs = (intervals || [])
    .map(([s, e]) => [new Date(s).getTime(), new Date(e).getTime()])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of xs) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}

export function clipIntervals(intervals, [from, to]) {
  const f = new Date(from).getTime(), t = new Date(to).getTime();
  return mergeIntervals(intervals).map(([s, e]) => [Math.max(s, f), Math.min(e, t)]).filter(([s, e]) => e > s);
}

export function subtractIntervals(intervals, remove) {
  let cur = mergeIntervals(intervals);
  for (const [rs, re] of mergeIntervals(remove)) {
    cur = cur.flatMap(([s, e]) => {
      if (re <= s || rs >= e) return [[s, e]];
      const parts = [];
      if (rs > s) parts.push([s, rs]);
      if (re < e) parts.push([re, e]);
      return parts;
    });
  }
  return cur;
}

export function totalSeconds(intervals) {
  return mergeIntervals(intervals).reduce((a, [s, e]) => a + Math.floor((e - s) / 1000), 0);
}

/**
 * MSM-fault lost display time within the booked interval:
 *  - review delay: from max(booked start, review due) to first approval,
 *    only if approval came after the review deadline;
 *  - recorded MSM serving outages;
 * minus any advertiser waiting (correction response time etc.).
 * A late review that still finished before the booked start loses nothing.
 */
export function msmLostIntervals({ bookedFrom, bookedUntil, reviewDueAt, approvedAt, outages = [], advertiserWaiting = [] }) {
  const fault = [...outages];
  if (reviewDueAt && approvedAt && new Date(approvedAt) > new Date(reviewDueAt)) {
    fault.push([new Date(Math.max(new Date(bookedFrom), new Date(reviewDueAt))), new Date(approvedAt)]);
  }
  return subtractIntervals(clipIntervals(fault, [bookedFrom, bookedUntil]), advertiserWaiting);
}

/** Exact fraction + rounded integer pence for lost placement time. */
export function lostTimeRefund({ placementPence, purchasedSeconds, lostSeconds, rounding = "half_up" }) {
  for (const [k, v] of Object.entries({ placementPence, purchasedSeconds, lostSeconds })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a non-negative integer`);
  }
  if (purchasedSeconds === 0) throw new Error("purchasedSeconds must be > 0");
  const lost = Math.min(lostSeconds, purchasedSeconds);
  const num = BigInt(placementPence) * BigInt(lost);
  const den = BigInt(purchasedSeconds);
  let pence;
  if (rounding === "half_up") pence = (num * 2n + den) / (den * 2n);
  else if (rounding === "down") pence = num / den;
  else if (rounding === "up") pence = (num + den - 1n) / den;
  else throw new Error("unknown rounding");
  const capped = pence > BigInt(placementPence) ? BigInt(placementPence) : pence;
  return { exact: { numerator: num.toString(), denominator: den.toString() }, pence: Number(capped), lostSeconds: lost, rounding };
}

/**
 * Whole assessment. Returns lines + total and any manual GATES (whole run
 * lost, defeated purpose, rejection, tax/discount/multi-slot allocation)
 * that require a human decision before anything can be approved.
 */
export function assessRefund({
  placementPence, priorityFeePence = 0, priorityMissedByMsm = false, purchasedSeconds, lostIntervals = [],
  multiPlacement = false, discounted = false, rounding = "half_up",
}) {
  const lines = [];
  const gates = [];
  if (priorityMissedByMsm && priorityFeePence > 0) lines.push({ kind: "priority_fee", pence: priorityFeePence });
  const lostSeconds = totalSeconds(lostIntervals);
  if (lostSeconds > 0) {
    const r = lostTimeRefund({ placementPence, purchasedSeconds, lostSeconds, rounding });
    lines.push({ kind: "lost_time", pence: r.pence, lostSeconds: r.lostSeconds, purchasedSeconds, exact: r.exact });
    if (r.lostSeconds >= purchasedSeconds) gates.push("whole_run_lost");
  }
  if (multiPlacement) gates.push("multi_slot_allocation");
  if (discounted) gates.push("tax_or_discount_allocation");
  return { lines, totalPence: lines.reduce((a, l) => a + l.pence, 0), gates };
}

/**
 * Correction-delay amendment PROPOSAL (never applied without recorded
 * advertiser agreement + an atomic capacity re-check in the database).
 * Start: next whole UK hour after approval. Keep the purchased duration
 * where capacity permits; never displace a confirmed following booking --
 * shorten at its boundary instead. Returns null when no positive,
 * not-yet-expired run is possible.
 */
export function proposeCorrectionAmendment({ approvedAt, bookedFrom, bookedUntil, followingBookingFrom = null, now }) {
  const HOUR = 3600 * 1000;
  const approved = new Date(approvedAt).getTime();
  const from = new Date(bookedFrom).getTime(), until = new Date(bookedUntil).getTime();
  if (approved < from) return { needed: false };
  const duration = until - from;
  const start = Math.floor(approved / HOUR) * HOUR + HOUR;
  let end = start + duration;
  let shortenedSeconds = 0;
  if (followingBookingFrom) {
    const cap = new Date(followingBookingFrom).getTime();
    if (end > cap) { shortenedSeconds = Math.floor((end - cap) / 1000); end = cap; }
  }
  const nowMs = now ? new Date(now).getTime() : start;
  if (end <= start || end <= nowMs) return { needed: true, viable: false };
  return { needed: true, viable: true, start: new Date(start), end: new Date(end), preservesDuration: shortenedSeconds === 0, shortenedSeconds };
}

/** Proposed 24-hour packages: exact elapsed [start, start + n*24h). GATED until Bryan confirms. */
export function elapsedPackageInterval(startAt, hours) {
  if (!Number.isInteger(hours) || hours <= 0) throw new Error("hours must be a positive integer");
  const s = new Date(startAt).getTime();
  if (s % (3600 * 1000) !== 0) throw new Error("packages start on a whole hour");
  return { start: new Date(s), end: new Date(s + hours * 3600 * 1000) };
}
