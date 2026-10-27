// Festival Hub -- displayed application status.
//
// The status shown is derived from the editor-recorded evidence
// (schema.js) and the current time. Dates alone never make a listing
// "Open": it is Open only when an official source explicitly said the 2027
// window was open (application.status "open"), that check is recent, and
// the deadline (if any) has not passed.
//
// Order of rules (first match wins):
//   1. festival listing not verified                  -> Unverified
//   2. official sources conflict on year/edition      -> Unverified
//   3. 2027 edition not confirmed                     -> Unverified
//   4. application window not verified, or evidence
//      not for the 2027 edition                       -> Unverified
//   5. a recorded deadline has passed                 -> Closed  (expiry always wins)
//   6. source says applications closed                -> Closed
//   7. application check older than FRESHNESS_DAYS    -> Unverified ("needs re-check")
//   8. source checked, nothing announced for 2027     -> Not yet announced
//   9. announced future opening date                  -> Not yet open
//      (opening date reached but not re-confirmed     -> Unverified)
//  10. source says open: needs a deadline or explicit
//      "no published deadline" evidence               -> Open, else Unverified
//
// Deadlines: with a stated time (closesTime, UK local) the window closes at
// that instant. With a date only, it closes after that London calendar day
// for status purposes, but the UI says the time is not stated and to apply
// earlier -- it never claims the organiser accepts until 23:59.

import { HUB_EDITION_YEAR, APPLICATION_STATES as A, LISTING_VERIFICATION } from "./constants.js";
import { daysBetween, formatDateOnly, isValidDateOnly, isValidTime, londonDateOf, londonInstant } from "./dates.js";

export { isValidDateOnly, londonDateOf, daysBetween, formatDateOnly } from "./dates.js";

// An "open", "announced" or "not yet announced" observation older than this
// is shown as Unverified until re-checked. Explicit expiry still wins.
export const FRESHNESS_DAYS = 30;

export const STATUS = Object.freeze({
  OPEN: "open",
  NOT_YET_OPEN: "not-yet-open",
  NOT_YET_ANNOUNCED: "not-yet-announced",
  CLOSED: "closed",
  UNVERIFIED: "unverified",
});

export const STATUS_LABEL = Object.freeze({
  [STATUS.OPEN]: "Open",
  [STATUS.NOT_YET_OPEN]: "Not yet open",
  [STATUS.NOT_YET_ANNOUNCED]: "Not yet announced",
  [STATUS.CLOSED]: "Closed",
  [STATUS.UNVERIFIED]: "Unverified",
});

// Deadline as recorded, for display and comparison.
export function deadlineOf(listing) {
  const ap = listing?.application || {};
  if (!isValidDateOnly(ap.closes)) return null;
  const timeStated = isValidTime(ap.closesTime);
  return {
    date: ap.closes,
    time: timeStated ? ap.closesTime : null,
    timeStated,
    instant: timeStated ? londonInstant(ap.closes, ap.closesTime) : null,
    text: typeof ap.closesText === "string" ? ap.closesText : null,
    yearInferred: ap.yearInferred === true,
  };
}

function deadlinePassed(deadline, now, today) {
  if (!deadline) return false;
  return deadline.instant ? now.getTime() >= deadline.instant.getTime() : today > deadline.date;
}

// Returns { status, reason, daysLeft, daysUntilOpen, stale, noDeadline, checkedDaysAgo }.
export function applicationStatus(listing, now = new Date()) {
  const today = londonDateOf(now);
  const ap = listing?.application || {};
  const base = { daysLeft: null, daysUntilOpen: null, stale: false, noDeadline: false, checkedDaysAgo: null };
  const out = (status, reason, extra = {}) => ({ ...base, status, reason, ...extra });

  if (listing?.listingVerification?.status !== LISTING_VERIFICATION.VERIFIED) {
    return out(STATUS.UNVERIFIED, "Festival details have not been checked against an official source yet.");
  }
  if (ap.yearConflict === true) {
    return out(STATUS.UNVERIFIED, "Official pages disagree about the year or edition, so the 2027 application window can't be confirmed.");
  }
  if (listing.listingVerification.editionConfirmed !== true) {
    return out(STATUS.UNVERIFIED, `The ${HUB_EDITION_YEAR} edition hasn't been confirmed on an official source yet.`);
  }
  if (!Object.values(A).includes(ap.status) || ap.status === A.UNVERIFIED) {
    return out(STATUS.UNVERIFIED, `No clear official ${HUB_EDITION_YEAR} call for artists was found, so the application window is unconfirmed.`);
  }
  if (ap.editionYear !== HUB_EDITION_YEAR || listing.editionYear !== HUB_EDITION_YEAR) {
    return out(STATUS.UNVERIFIED, `The application evidence is not for the ${HUB_EDITION_YEAR} edition.`);
  }
  if (!isValidDateOnly(ap.checkedDate) || ap.checkedDate > today) {
    return out(STATUS.UNVERIFIED, "The application check date is missing or invalid.");
  }
  const checkedDaysAgo = daysBetween(ap.checkedDate, today);
  const deadline = deadlineOf(listing);

  if (deadlinePassed(deadline, now, today)) {
    return out(STATUS.CLOSED, "The application deadline has passed.", { checkedDaysAgo });
  }
  if (ap.status === A.CLOSED) {
    return out(STATUS.CLOSED, "The festival says 2027 applications have closed.", { checkedDaysAgo });
  }
  if (checkedDaysAgo > FRESHNESS_DAYS) {
    return out(STATUS.UNVERIFIED, `Last checked ${checkedDaysAgo} days ago — needs re-checking before it can be shown as current.`, { stale: true, checkedDaysAgo });
  }
  if (ap.status === A.NOT_YET_ANNOUNCED) {
    return out(STATUS.NOT_YET_ANNOUNCED, "No 2027 application details had been published when this was checked.", { checkedDaysAgo });
  }
  if (ap.status === A.ANNOUNCED) {
    if (isValidDateOnly(ap.opens) && today < ap.opens) {
      return out(STATUS.NOT_YET_OPEN, "The festival has announced when 2027 applications open.", { checkedDaysAgo, daysUntilOpen: daysBetween(today, ap.opens) });
    }
    return out(STATUS.UNVERIFIED, "The announced opening date has arrived but hasn't been re-confirmed as open yet.", { checkedDaysAgo });
  }
  // ap.status === open
  if (deadline) {
    return out(STATUS.OPEN, "The festival's own site said 2027 applications were open when checked.", { checkedDaysAgo, daysLeft: daysBetween(today, deadline.date) });
  }
  if (ap.noPublishedDeadline === true) {
    return out(STATUS.OPEN, "The festival's own site said 2027 applications were open, with no published deadline.", { checkedDaysAgo, noDeadline: true });
  }
  return out(STATUS.UNVERIFIED, "Applications were reported open but the deadline hasn't been confirmed.", { checkedDaysAgo });
}

// "1 December 2026, 21:00 UK time" / "1 December 2026 (time not stated — apply earlier)".
export function formatDeadline(deadline) {
  if (!deadline) return null;
  const day = formatDateOnly(deadline.date) + (deadline.yearInferred ? " (year inferred)" : "");
  return deadline.timeStated ? `${day}, ${deadline.time} UK time` : `${day} (time not stated — apply earlier)`;
}

// One-line summary for cards.
export function deadlineSummary(info, listing) {
  const deadline = deadlineOf(listing);
  const short = deadline ? formatDateOnly(deadline.date) + (deadline.timeStated ? `, ${deadline.time}` : "") : null;
  switch (info.status) {
    case STATUS.OPEN:
      if (info.noDeadline) return "Open · no deadline published";
      if (info.daysLeft === 0) return `Closes today${deadline.timeStated ? ` at ${deadline.time} UK time` : " (time not stated)"}`;
      if (info.daysLeft === 1) return `Closes tomorrow (${short})`;
      return `Closes ${short} · ${info.daysLeft} days left`;
    case STATUS.NOT_YET_OPEN:
      return `Opens ${formatDateOnly(listing.application.opens)}`;
    case STATUS.CLOSED:
      return short ? `Closed ${short}` : "Applications closed";
    default:
      return info.reason;
  }
}
