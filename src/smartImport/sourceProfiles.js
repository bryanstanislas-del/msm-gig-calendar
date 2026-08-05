// Sprint 5A: source-profile registry.
//
// A "profile" is a small, named, versioned pair of pure functions:
//   detect(text)  -> { matched, confidence, reason }
//   extract(text, options) -> EventRow[]
// tried in priority order by detectSourceProfile(); the first match wins.
// Detection is always structural (delimiter presence, line-count-per-record
// shape, heading regex) -- never topic/content-based -- so it stays
// explainable. This is deterministic pattern matching, not a learned or
// statistical model, and must never be described as one.
//
// `generic-dash-list` below is a near-direct port of the parser that has
// shipped in BulkImport (App.jsx) since Sprint 2: same regexes, same
// resolveYear/parseDate behaviour, same "artist supplied once for the
// whole batch, not per line" contract. It is kept as the always-available
// fallback profile, unchanged in behaviour, per the Sprint 5A brief to
// preserve the old parser as an internal fallback.

import { DATE_CONFIDENCE, TEXT_FIELD_CONFIDENCE, assembleEventRow } from "./confidence.js";

// -- Date parsing (ported from App.jsx's parseGigText/parseDate) --------
const MONTH_NAMES = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function resolveYear(day, month, explicitYear) {
  if (explicitYear) return explicitYear;
  const now = new Date();
  const thisY = now.getFullYear();
  const test = new Date(thisY, month, day);
  test.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return test >= now ? thisY : thisY + 1;
}

// Returns { parsed: {day,month,year}|null, confidenceTier } -- the tier
// records *how* the date was established, feeding directly into
// DATE_CONFIDENCE (see confidence.js) rather than parseDate silently
// picking a single trust level the way the original App.jsx version did.
export function parseDateWithConfidence(str, contextYear) {
  const cleaned = str.trim().toLowerCase().replace(/[,]/g, "").replace(/(\d+)(st|nd|rd|th)/g, "$1");

  let m = cleaned.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return { parsed: { day: +m[1], month: +m[2] - 1, year: +m[3] }, confidenceTier: "EXPLICIT" };

  m = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { parsed: { day: +m[3], month: +m[2] - 1, year: +m[1] }, confidenceTier: "EXPLICIT" };

  m = cleaned.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (m && MONTH_NAMES[m[2]] !== undefined)
    return { parsed: { day: +m[1], month: MONTH_NAMES[m[2]], year: +m[3] }, confidenceTier: "EXPLICIT" };
  m = cleaned.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m && MONTH_NAMES[m[1]] !== undefined)
    return { parsed: { day: +m[2], month: MONTH_NAMES[m[1]], year: +m[3] }, confidenceTier: "EXPLICIT" };

  m = cleaned.match(/(\d{1,2})\s+([a-z]+)/);
  if (m && MONTH_NAMES[m[2]] !== undefined) {
    const day = +m[1], month = MONTH_NAMES[m[2]];
    return { parsed: { day, month, year: resolveYear(day, month, contextYear) }, confidenceTier: contextYear ? "CONTEXT_YEAR" : "INFERRED_YEAR" };
  }
  m = cleaned.match(/([a-z]+)\s+(\d{1,2})/);
  if (m && MONTH_NAMES[m[1]] !== undefined) {
    const day = +m[2], month = MONTH_NAMES[m[1]];
    return { parsed: { day, month, year: resolveYear(day, month, contextYear) }, confidenceTier: contextYear ? "CONTEXT_YEAR" : "INFERRED_YEAR" };
  }

  const dayIdx = DAY_NAMES.indexOf(cleaned.split(/\s+/)[0]);
  if (dayIdx !== -1) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
    const d = new Date(now); d.setDate(d.getDate() + diff);
    const year = contextYear || d.getFullYear();
    return { parsed: { day: d.getDate(), month: d.getMonth(), year }, confidenceTier: "DAY_NAME_ONLY" };
  }

  return { parsed: null, confidenceTier: "UNPARSEABLE" };
}

export function formatDateISO(d) {
  return `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}
export function formatDateDisplay(d) {
  return `${String(d.day).padStart(2, "0")} ${MONTHS[d.month]} ${d.year}`;
}

// Section heading that sets a year context for subsequent dateless lines,
// e.g. "June 2026" or "July 2026 Dates" -- unchanged from App.jsx.
export function detectContextYear(line) {
  const l = line.toLowerCase();
  for (const name of Object.keys(MONTH_NAMES)) {
    const m = l.match(new RegExp(name + "\\s+(\\d{4})"));
    if (m) return +m[1];
  }
  const m = l.match(/\b(20\d{2})\b/);
  if (m) return +m[1];
  return null;
}

// Deliberately a simple keyword heuristic, not a classifier -- flags a row
// for admin attention in 5B's review step; never silently changes behaviour.
const FESTIVAL_TRIBUTE_RE = /\b(festival|tribute|all-?stars)\b/i;
export function detectFestivalOrTribute(text) {
  return FESTIVAL_TRIBUTE_RE.test(text);
}

// -- generic-dash-list: "date - venue, city[ - notes]" ------------------
const TIME_RE = /\b(\d{1,2}):(\d{2})\s*([ap]m)?\b|\b(\d{1,2})\s*([ap]m)\b/gi;

function extractTime(line) {
  const matches = [...line.matchAll(TIME_RE)];
  if (matches.length === 0) return { time: null, remaining: line };
  const tm = matches[matches.length - 1];
  const raw = tm[0];
  let h, min = "00";
  if (tm[1]) { h = +tm[1]; min = tm[2]; const ampm = tm[3]?.toLowerCase(); if (ampm === "pm" && h < 12) h += 12; if (ampm === "am" && h === 12) h = 0; }
  else { h = +tm[4]; const ampm = tm[5]?.toLowerCase(); if (ampm === "pm" && h < 12) h += 12; if (ampm === "am" && h === 12) h = 0; }
  const time = `${String(h).padStart(2, "0")}:${min}`;
  const remaining = line.replace(raw, "").replace(/\s*-\s*$/, "").trim();
  return { time, remaining };
}

function extractGenericDashListLine(rawLine, contextYear, defaultTime) {
  const line = rawLine.trim();
  if (!line) return null;

  const { time: extractedTime, remaining } = extractTime(line);

  const sepMatch = remaining.match(/^(.+?)\s+[-–|]\s+(.+)$/);
  let datePart, remainder;
  if (sepMatch) {
    datePart = sepMatch[1].trim();
    remainder = sepMatch[2].trim();
  } else {
    const simpleSep = remaining.match(/^(.+?)[-–|](.+)$/);
    if (!simpleSep) {
      return assembleEventRow({
        raw: line,
        fields: { artistName: null, venueName: null, city: null, date: null, dateRaw: "", time: extractedTime || defaultTime || null, genre: null, ticketUrl: null, notes: null, isFestivalOrTribute: detectFestivalOrTribute(line) },
        fieldConfidence: { date: DATE_CONFIDENCE.UNPARSEABLE, venueName: TEXT_FIELD_CONFIDENCE.MISSING, city: TEXT_FIELD_CONFIDENCE.MISSING, artistName: null },
        issues: ["Can't find separator"],
      });
    }
    datePart = simpleSep[1].trim();
    remainder = simpleSep[2].trim();
  }

  const { parsed, confidenceTier } = parseDateWithConfidence(datePart, contextYear);

  let venueCity = remainder;
  let notes = "";
  const descSep = remainder.match(/^(.+?,\s*.+?)\s*[-–]\s*(.+)$/);
  if (descSep) {
    venueCity = descSep[1].trim();
    notes = descSep[2].trim();
  }

  const lastComma = venueCity.lastIndexOf(",");
  let venue = venueCity, city = "";
  let venueTier = "EXPLICIT";
  if (lastComma !== -1) {
    venue = venueCity.slice(0, lastComma).trim();
    city = venueCity.slice(lastComma + 1).trim();
  } else if (venueCity) {
    venueTier = "AMBIGUOUS"; // no comma at all: venue/city split couldn't be disambiguated
  }
  city = city.replace(TIME_RE, "").trim();

  const issues = [];
  if (!parsed) issues.push("Date unclear");
  if (!venue) issues.push("No venue");
  if (!city) issues.push("No city");

  const fieldConfidence = {
    date: parsed ? DATE_CONFIDENCE[confidenceTier] : DATE_CONFIDENCE.UNPARSEABLE,
    venueName: venue ? TEXT_FIELD_CONFIDENCE[venueTier] : TEXT_FIELD_CONFIDENCE.MISSING,
    city: city ? TEXT_FIELD_CONFIDENCE.EXPLICIT : TEXT_FIELD_CONFIDENCE.MISSING,
    // generic-dash-list is single-artist-per-batch by contract (same as
    // today's BulkImport): it never attempts a per-row artist name, so this
    // is "not applicable" (null), not "attempted and failed" (0). See
    // confidence.js's computeOverallConfidence for why that distinction matters.
    artistName: null,
  };

  const fields = {
    artistName: null,
    venueName: venue || null,
    city: city || null,
    date: parsed ? formatDateISO(parsed) : null,
    dateRaw: datePart,
    time: extractedTime || defaultTime || null,
    genre: null,
    ticketUrl: null,
    notes: notes || null,
    isFestivalOrTribute: detectFestivalOrTribute(line),
  };

  return assembleEventRow({ raw: line, fields, fieldConfidence, issues });
}

export function extractGenericDashList(text, { contextYear: contextYearOverride, defaultTime } = {}) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  let contextYear = contextYearOverride || null;

  for (const line of lines) {
    const detectedYear = detectContextYear(line);
    if (detectedYear) {
      if (!line.match(/[-|]/)) {
        contextYear = detectedYear;
        continue;
      }
      contextYear = detectedYear;
    }
    const row = extractGenericDashListLine(line, contextYear, defaultTime);
    if (row) rows.push(row);
  }
  return rows;
}

// -- Profile registry -----------------------------------------------------
// `version` is stored on every ParseResult (see parser.js) so that if this
// profile's rules change later, historical import batches remain traceable
// to the exact rule version that produced them.
const PROFILES = [
  // Slot reserved for an 'msm-gig-guide' profile once a real sample is
  // available to derive its structural signature from -- not fabricated.
  {
    id: "generic-dash-list",
    version: "1.0.0",
    detect: () => ({ matched: true, confidence: 0.5, reason: "fallback: no more specific structural profile matched" }),
    extract: extractGenericDashList,
  },
];

export function detectSourceProfile(text) {
  for (const profile of PROFILES) {
    const result = profile.detect(text);
    if (result.matched) {
      return {
        id: profile.id,
        version: profile.version,
        matchConfidence: result.confidence,
        matchReason: result.reason,
        extract: profile.extract,
      };
    }
  }
  // Unreachable while generic-dash-list's detect() always matches, but kept
  // explicit rather than assuming the last registry entry is always the
  // catch-all -- a future reordering mistake should fail loudly, not pick
  // an arbitrary profile.
  throw new Error("No source profile matched, including the fallback -- this should never happen");
}

export { PROFILES };
