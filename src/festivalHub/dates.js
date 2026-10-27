// Festival Hub -- date helpers. All calendar dates are DATE-ONLY strings
// ("YYYY-MM-DD") read as days in Europe/London; times are "HH:MM" UK local
// time (GMT or BST, whichever applies on that date).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Strict "YYYY-MM-DD" check, including real calendar days.
export function isValidDateOnly(value) {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const isValidTime = (value) => typeof value === "string" && TIME_RE.test(value);

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function partsOf(instant) {
  const out = {};
  for (const p of londonParts.formatToParts(instant)) out[p.type] = p.value;
  return out;
}

// Calendar date in Europe/London for an instant, as "YYYY-MM-DD".
export function londonDateOf(instant = new Date()) {
  const p = partsOf(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

// The instant of a UK wall-clock time on a date ("2026-12-01", "21:00").
export function londonInstant(dateOnly, time) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = partsOf(new Date(guess));
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    guess = wall - (shown - guess);
  }
  return new Date(guess);
}

const dayNumber = (dateOnly) => {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// Whole days from `fromDate` to `toDate` (both date-only, valid).
export const daysBetween = (fromDate, toDate) => dayNumber(toDate) - dayNumber(fromDate);

const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// "28 March 2027" for a valid date-only string, otherwise null.
export function formatDateOnly(value) {
  if (!isValidDateOnly(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return longDate.format(new Date(Date.UTC(y, m - 1, d)));
}
