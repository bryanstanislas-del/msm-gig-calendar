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

// Event status becomes structured data (one boolean per status) rather than
// a single merged flag or, worse, silently discarded text -- an admin
// reviewing the preview needs to know *which* of these applies, since they
// aren't interchangeable (a cancelled show and a rescheduled one need very
// different follow-up). Same "simple keyword heuristic, not a classifier"
// posture as detectFestivalOrTribute above.
const CANCELLED_RE = /\bcancell?ed\b/i;
const POSTPONED_RE = /\bpostponed\b/i;
const RESCHEDULED_RE = /\brescheduled\b/i;
const SOLD_OUT_RE = /\bsold[\s-]?out\b/i;
export function detectCancelled(text) { return CANCELLED_RE.test(text); }
export function detectPostponed(text) { return POSTPONED_RE.test(text); }
export function detectRescheduled(text) { return RESCHEDULED_RE.test(text); }
export function detectSoldOut(text) { return SOLD_OUT_RE.test(text); }

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
        fields: {
          artistName: null, venueName: null, venueBlock: null, city: null, date: null, dateRaw: "", time: extractedTime || defaultTime || null, genre: null, ticketUrl: null, notes: null,
          isFestivalOrTribute: detectFestivalOrTribute(line),
          isCancelled: detectCancelled(line), isPostponed: detectPostponed(line), isRescheduled: detectRescheduled(line), isSoldOut: detectSoldOut(line),
        },
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
    venueBlock: null,
    city: city || null,
    date: parsed ? formatDateISO(parsed) : null,
    dateRaw: datePart,
    time: extractedTime || defaultTime || null,
    genre: null,
    ticketUrl: null,
    notes: notes || null,
    isFestivalOrTribute: detectFestivalOrTribute(line),
    isCancelled: detectCancelled(line),
    isPostponed: detectPostponed(line),
    isRescheduled: detectRescheduled(line),
    isSoldOut: detectSoldOut(line),
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

// -- msm-gig-guide: repeating "Title / Date / VenueBlock / View Details" ---
// Anchoring extraction on the literal "View Details" marker line (rather
// than classifying every line) is what lets this profile ignore all page
// furniture -- the "Search Listings" header/search-form text, the mid-list
// "Promote Your Event"/"Add Your Event" block, "Load More" -- without
// needing furniture.js at all: none of that furniture is ever immediately
// followed by a "View Details" line, so it's never harvested.
//
// Per the revised Sprint 5A architecture, this profile does NOT attempt to
// split the source's squashed "VenueAddress" text (e.g. "O2 Academy
// Bournemouth570 Christchurch Rd") into venueName/address/city. That split
// is fundamentally a guess -- there's no reliable signal distinguishing "the
// digits belong to the venue's own name" (e.g. "Southampton 1865") from "the
// digits start the street address" (e.g. "The Brook466 Portswood Road").
// Sprint 5A's job is accurate, non-lossy parsing, not venue resolution -- so
// venueName/city are always left null (unresolved, excluded from the
// confidence average, never scored as a failure) and the untouched text is
// kept verbatim as fields.venueBlock for the pipeline's later Venue Match
// stage (Paste -> Parse -> Review -> Venue Match -> Deduplicate -> Import).
const VIEW_DETAILS_RE = /^view details$/i;

// A repeated "View Details" phrase alone is not a trustworthy signature --
// plenty of unrelated pages repeat a "View Details" button/link with no gig
// data anywhere nearby (e.g. a product listing page). What actually
// distinguishes this source's Title/Date/Venue/View-Details structure is
// that a recognizable date sits two lines above the marker, exactly where
// extractMsmGigGuide expects one -- so detection re-checks that instead of
// just counting the marker, to keep false-matches on unrelated pasted text
// rare. Operates on the same blank-line-compacted view extraction uses, so
// "two lines above" means the same thing in both places.
const MIN_DATE_BACKED_RATIO = 0.6;

function detectMsmGigGuideProfile(text) {
  const compact = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const viewDetailsIdx = [];
  compact.forEach((line, i) => { if (VIEW_DETAILS_RE.test(line)) viewDetailsIdx.push(i); });

  if (viewDetailsIdx.length < 2) {
    return { matched: false, confidence: 0, reason: "fewer than 2 'View Details' marker lines found" };
  }

  const dateBackedCount = viewDetailsIdx.filter(
    (i) => i >= 2 && parseDateWithConfidence(compact[i - 2], null).parsed !== null
  ).length;
  const total = viewDetailsIdx.length;

  if (dateBackedCount / total < MIN_DATE_BACKED_RATIO) {
    return {
      matched: false,
      confidence: 0,
      reason: `found ${total} "View Details" marker lines, but only ${dateBackedCount} had a recognizable date two lines above -- too weak a signature to trust`,
    };
  }

  const confidence = Math.min(0.5 + dateBackedCount * 0.02, 0.98);
  return {
    matched: true,
    confidence,
    reason: `found ${total} "View Details" marker lines, ${dateBackedCount} backed by a recognizable date two lines above -- this source's repeating Title/Date/Venue/View-Details structure`,
  };
}

function extractMsmGigGuideRow(titleLine, dateLine, venueBlockLine, contextYear, defaultTime) {
  const cleanTitle = titleLine.replace(/^\*\s*/, "").trim();
  const venueBlock = venueBlockLine.trim();
  const { parsed, confidenceTier } = parseDateWithConfidence(dateLine, contextYear);

  const issues = [];
  if (!cleanTitle) issues.push("No event title");
  if (!parsed) issues.push("Date unclear");
  if (!venueBlock) issues.push("No venue information");

  const fieldConfidence = {
    date: parsed ? DATE_CONFIDENCE[confidenceTier] : DATE_CONFIDENCE.UNPARSEABLE,
    artistName: cleanTitle ? TEXT_FIELD_CONFIDENCE.EXPLICIT : TEXT_FIELD_CONFIDENCE.MISSING,
    // Not attempted: this profile deliberately never decomposes the squashed
    // venue+address block (see comment above) -- "not applicable" (null),
    // not "attempted and failed" (0). See confidence.js.
    venueName: null,
    city: null,
  };

  const fields = {
    artistName: cleanTitle || null,
    venueName: null,
    venueBlock: venueBlock || null,
    city: null,
    date: parsed ? formatDateISO(parsed) : null,
    dateRaw: dateLine.trim(),
    time: defaultTime || null,
    genre: null,
    ticketUrl: null,
    notes: null,
    isFestivalOrTribute: detectFestivalOrTribute(cleanTitle),
    isCancelled: detectCancelled(cleanTitle),
    isPostponed: detectPostponed(cleanTitle),
    isRescheduled: detectRescheduled(cleanTitle),
    isSoldOut: detectSoldOut(cleanTitle),
  };

  // "View Details" is this profile's own record-boundary marker (see
  // extractMsmGigGuide below) -- it's real to the *parser*, but it's page
  // furniture to the *editor*: it carries no event information, so it's
  // deliberately left out of `raw`, which is what the preview displays.
  // Internal boundary detection has already happened by this point (the
  // caller found this triplet by scanning for the marker in `compact`), so
  // dropping it here doesn't affect parsing at all -- only what's shown.
  const raw = [titleLine.trim(), dateLine.trim(), venueBlockLine.trim()].join("\n");

  return assembleEventRow({ raw, fields, fieldConfidence, issues });
}

export function extractMsmGigGuide(text, { contextYear, defaultTime } = {}) {
  const compact = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (let i = 0; i < compact.length; i++) {
    if (!VIEW_DETAILS_RE.test(compact[i])) continue;
    if (i < 3) continue; // not enough preceding lines for a full triplet
    const [titleLine, dateLine, venueBlockLine] = [compact[i - 3], compact[i - 2], compact[i - 1]];
    // A genuine title line always carries the "* " bullet in this source;
    // if it doesn't, the 3 lines above this "View Details" aren't a real
    // title/date/venue triplet -- skip rather than fabricate a row from
    // unrelated furniture.
    if (!/^\*\s*\S/.test(titleLine)) continue;
    rows.push(extractMsmGigGuideRow(titleLine, dateLine, venueBlockLine, contextYear, defaultTime));
  }
  return rows;
}

// -- Profile registry -----------------------------------------------------
// `version` is stored on every ParseResult (see parser.js) so that if this
// profile's rules change later, historical import batches remain traceable
// to the exact rule version that produced them. msm-gig-guide is listed
// before generic-dash-list: generic-dash-list's detect() always matches (it's
// the catch-all fallback), so anything more specific must be tried first.
const PROFILES = [
  {
    id: "msm-gig-guide",
    version: "1.0.0",
    detect: detectMsmGigGuideProfile,
    extract: extractMsmGigGuide,
  },
  {
    id: "generic-dash-list",
    version: "1.0.0",
    detect: () => ({ matched: true, confidence: 0.5, reason: "fallback: no more specific structural profile matched" }),
    extract: extractGenericDashList,
    filtersFurniture: true,
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
        // Whether parser.js should run the generic furniture.js filter
        // before calling extract(). msm-gig-guide (and any other
        // marker-anchored profile) ignores furniture by construction --
        // running the generic filter first would actively hurt it, since
        // furniture.js's >2x-repeated-line heuristic would strip out the
        // very "View Details" marker lines the extractor anchors on.
        filtersFurniture: !!profile.filtersFurniture,
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
