// Sprint 5A: CSV/TSV format sniffing and column mapping, built on papaparse
// (a proven, RFC4180-aware tokenizer -- quoted fields, embedded delimiters/
// newlines, escaped quotes are all its problem, not ours) rather than a
// hand-rolled parser.

import Papa from "papaparse";

// field -> accepted header names, lowercase/whitespace-normalized
export const COLUMN_ALIASES = {
  artistName: ["artist", "band", "act", "performer", "headliner"],
  venueName: ["venue", "venue name", "location name"],
  city: ["city", "town", "location"],
  date: ["date", "gig date", "event date"],
  time: ["time", "doors", "start time", "start"],
  ticketUrl: ["tickets", "ticket link", "ticket url", "tickets url"],
  notes: ["notes", "description", "info"],
};

// Positional fallback order when no header row is detected, matching the
// most common "Artist, Venue, City, Date, Time" export shape.
const POSITIONAL_FALLBACK_ORDER = ["artistName", "venueName", "city", "date", "time"];

function normalizeHeaderCell(cell) {
  return String(cell ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

function isKnownHeaderCell(normalizedCell) {
  return Object.values(COLUMN_ALIASES).some((aliases) => aliases.includes(normalizedCell));
}

// A row "looks like a header" if at least one cell matches a known column
// alias -- a data row occasionally containing e.g. the word "venue" inside
// a note is not enough to trigger this, since it requires a whole-cell match.
function looksLikeHeaderRow(row) {
  return row.some((cell) => isKnownHeaderCell(normalizeHeaderCell(cell)));
}

function detectHeaderMapping(headerRow) {
  const normalized = headerRow.map(normalizeHeaderCell);
  const mapping = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex((cell) => aliases.includes(cell));
    if (idx !== -1) mapping[field] = idx;
  }
  return mapping;
}

function mostCommonLength(rows) {
  const freq = new Map();
  for (const r of rows) {
    if (!r || r.length === 0) continue;
    freq.set(r.length, (freq.get(r.length) || 0) + 1);
  }
  let bestLength = null;
  let bestCount = 0;
  for (const [length, count] of freq) {
    if (count > bestCount) {
      bestLength = length;
      bestCount = count;
    }
  }
  return { length: bestLength, matchingRows: bestCount, totalRows: rows.length };
}

function isConsistentlyDelimited(stats, minColumns) {
  if (!stats.length || stats.length < minColumns || stats.totalRows === 0) return false;
  return stats.matchingRows / stats.totalRows >= 0.8;
}

// Tab is a near-unambiguous signal (a plain free-text gig paste essentially
// never contains a literal tab character) -- even a 2-column TSV shape is
// trustworthy, so tab only requires >=2 columns. A comma is not: an
// ordinary gig-list line like "Saturday 6th June - The Obelisk, Woolston"
// contains exactly one comma, so several such lines look identical in
// shape to genuine 2-column CSV. Comma-based detection therefore requires
// >=3 modal columns -- a real gig-data CSV/TSV virtually always has at
// least artist/venue/date, so this doesn't cost real CSVs anything, while
// it stops single-comma prose from being misdetected as delimited data.
// Tab is checked, and preferred, before comma.
export function sniffDelimitedFormat(text) {
  const trimmed = text.trim();
  if (!trimmed) return "text";

  const tabRows = Papa.parse(trimmed, { delimiter: "\t", skipEmptyLines: true }).data;
  const tabStats = mostCommonLength(tabRows);
  if (isConsistentlyDelimited(tabStats, 2)) return "tsv";

  const commaRows = Papa.parse(trimmed, { delimiter: ",", skipEmptyLines: true }).data;
  const commaStats = mostCommonLength(commaRows);
  if (isConsistentlyDelimited(commaStats, 3)) return "csv";

  return "text";
}

// Parses already-confirmed-delimited text (delimiter: "," or "\t") into
// structured records. Never throws -- a short/malformed row still produces
// a record, flagged via `columnCountMismatch`, per Sprint 5A's
// never-drop-a-row-silently rule (see parser.js).
export function parseDelimited(text, delimiter) {
  const parsed = Papa.parse(text.trim(), { delimiter, skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows.length) {
    return { records: [], usedPositionalFallback: false, mapping: {}, headerRow: null };
  }

  const hasHeader = looksLikeHeaderRow(rows[0]);
  const mapping = hasHeader ? detectHeaderMapping(rows[0]) : Object.fromEntries(POSITIONAL_FALLBACK_ORDER.map((f, i) => [f, i]));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const expectedColumnCount = hasHeader ? rows[0].length : POSITIONAL_FALLBACK_ORDER.length;

  const records = dataRows.map((row) => {
    const get = (field) => {
      const idx = mapping[field];
      return idx !== undefined ? String(row[idx] ?? "").trim() : "";
    };
    return {
      raw: row.join(delimiter === "\t" ? "\t" : ", "),
      artistName: get("artistName") || null,
      venueName: get("venueName") || null,
      city: get("city") || null,
      date: get("date") || null,
      time: get("time") || null,
      ticketUrl: get("ticketUrl") || null,
      notes: get("notes") || null,
      columnCountMismatch: row.length < expectedColumnCount,
    };
  });

  return { records, usedPositionalFallback: !hasHeader, mapping, headerRow: hasHeader ? rows[0] : null };
}
