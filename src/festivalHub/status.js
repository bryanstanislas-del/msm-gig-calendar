// Festival Hub -- application-window status.
//
// All application dates are DATE-ONLY strings ("YYYY-MM-DD") and are read
// as calendar days in Europe/London, never as instants:
//   - opens  "2027-01-10" -> applications open from the START of 10 Jan
//     (London time)
//   - closes "2027-03-28" -> the 28th is the LAST day you can apply; the
//     listing turns "closed" from the start of the next London day.
// "Today" is therefore the current calendar date in Europe/London, which
// takes care of the BST/GMT changeovers (e.g. 28 March / 31 October 2027)
// without any hour arithmetic.
//
// A listing is only ever "open" / "not-yet-open" / "closed" when its
// dates are valid and it has been checked; anything else is "unverified"
// with a reason, so a missing or malformed date can never show as open.

export const STATUS = Object.freeze({
  OPEN: "open",
  NOT_YET_OPEN: "not-yet-open",
  CLOSED: "closed",
  UNVERIFIED: "unverified",
});

export const STATUS_LABEL = Object.freeze({
  [STATUS.OPEN]: "Open",
  [STATUS.NOT_YET_OPEN]: "Not yet open",
  [STATUS.CLOSED]: "Closed",
  [STATUS.UNVERIFIED]: "Unverified",
});

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Strict "YYYY-MM-DD" check, including real calendar days (rejects
// 2027-02-30, 2027-13-01, "2027-1-5", non-strings).
export function isValidDateOnly(value) {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const londonDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Calendar date in Europe/London for an instant, as "YYYY-MM-DD".
export function londonDateOf(instant = new Date()) {
  const parts = londonDateFormat.formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const dayNumber = (dateOnly) => {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// Whole days from `fromDate` to `toDate` (both date-only, valid).
export function daysBetween(fromDate, toDate) {
  return dayNumber(toDate) - dayNumber(fromDate);
}

// Returns { status, reason, daysLeft, daysUntilOpen }.
// `today` is a London date-only string (defaults to now).
export function applicationStatus(listing, today = londonDateOf()) {
  const result = (status, reason, extra = {}) => ({ status, reason, daysLeft: null, daysUntilOpen: null, ...extra });

  if (!listing || listing.verified !== true) {
    return result(STATUS.UNVERIFIED, "Details have not been checked against an official source.");
  }
  const { opens, closes } = listing.application || {};
  if (closes == null || closes === "") {
    return result(STATUS.UNVERIFIED, "Deadline not known.");
  }
  if (!isValidDateOnly(closes)) {
    return result(STATUS.UNVERIFIED, "Deadline date is invalid.");
  }
  if (opens != null && opens !== "" && !isValidDateOnly(opens)) {
    return result(STATUS.UNVERIFIED, "Opening date is invalid.");
  }
  const hasOpens = opens != null && opens !== "";
  if (hasOpens && opens > closes) {
    return result(STATUS.UNVERIFIED, "Opening date is after the deadline.");
  }
  if (hasOpens && today < opens) {
    return result(STATUS.NOT_YET_OPEN, "Applications have not opened yet.", { daysUntilOpen: daysBetween(today, opens) });
  }
  if (today > closes) {
    return result(STATUS.CLOSED, "The application deadline has passed.");
  }
  return result(STATUS.OPEN, "Applications are open.", { daysLeft: daysBetween(today, closes) });
}

const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// "28 March 2027" for a valid date-only string, otherwise null.
export function formatDateOnly(value) {
  if (!isValidDateOnly(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return longDate.format(new Date(Date.UTC(y, m - 1, d)));
}

// One-line deadline summary for cards.
export function deadlineSummary(info, listing) {
  const closes = formatDateOnly(listing?.application?.closes);
  switch (info.status) {
    case STATUS.OPEN:
      if (info.daysLeft === 0) return `Closes today (${closes})`;
      if (info.daysLeft === 1) return `Closes tomorrow (${closes})`;
      return `Closes ${closes} · ${info.daysLeft} days left`;
    case STATUS.NOT_YET_OPEN:
      return `Opens ${formatDateOnly(listing.application.opens)}`;
    case STATUS.CLOSED:
      return `Closed ${closes}`;
    default:
      return info.reason;
  }
}
