// Sprint 5A: parseImportText() -- the single entry point that ties format
// sniffing, page-furniture filtering, source-profile detection/extraction
// and confidence scoring together into one ParseResult. No Supabase
// import, no network calls, nothing React-specific: this module is pure
// and framework-free by design (same posture as notificationHelpers.js in
// Sprint 4), so it can be unit tested in total isolation.

import { sniffDelimitedFormat, parseDelimited } from "./csvTsv.js";
import { filterPageFurniture } from "./furniture.js";
import { detectSourceProfile, parseDateWithConfidence, formatDateISO, detectFestivalOrTribute, detectCancelled, detectPostponed, detectRescheduled, detectSoldOut } from "./sourceProfiles.js";
import { DATE_CONFIDENCE, TEXT_FIELD_CONFIDENCE, assembleEventRow } from "./confidence.js";
import { normalizeGenre } from "../genres.js";

function emptyResult() {
  return {
    rows: [],
    detectedFormat: "text",
    sourceProfile: null,
    stats: { totalInputLines: 0, parsedRows: 0, skippedFurniture: 0, malformed: 0 },
  };
}

function eventRowFromDelimitedRecord(record) {
  const dateResult = record.date ? parseDateWithConfidence(record.date, null) : { parsed: null, confidenceTier: "UNPARSEABLE" };

  const fieldConfidence = {
    date: record.date ? DATE_CONFIDENCE[dateResult.confidenceTier] : DATE_CONFIDENCE.UNPARSEABLE,
    venueName: record.venueName ? TEXT_FIELD_CONFIDENCE.EXPLICIT : TEXT_FIELD_CONFIDENCE.MISSING,
    city: record.city ? TEXT_FIELD_CONFIDENCE.EXPLICIT : TEXT_FIELD_CONFIDENCE.MISSING,
    // Unlike generic-dash-list, a delimited row's artist column IS
    // attempted (it's a real mapped column, even when the cell is blank),
    // so a missing value here is a genuine 0, not "not applicable".
    artistName: record.artistName ? TEXT_FIELD_CONFIDENCE.EXPLICIT : TEXT_FIELD_CONFIDENCE.MISSING,
  };

  // A genre cell that doesn't match the canonical taxonomy (see
  // src/genres.js) is treated the same as no genre at all -- never
  // silently defaulted to a specific genre -- but it's still surfaced as
  // an issue so an admin reviewing the batch knows why a supplied value
  // didn't take.
  const normalizedGenre = normalizeGenre(record.genre);
  const genreUnrecognized = !!record.genre && !normalizedGenre;

  const issues = [];
  if (!dateResult.parsed) issues.push("Date unclear");
  if (!record.venueName) issues.push("No venue");
  if (!record.city) issues.push("No city");
  if (!record.artistName) issues.push("No artist");
  if (record.columnCountMismatch) issues.push("Row has fewer columns than the header row");
  if (genreUnrecognized) issues.push(`Unrecognized genre "${record.genre}" -- no genre assigned`);

  const fields = {
    artistName: record.artistName || null,
    venueName: record.venueName || null,
    venueBlock: null,
    city: record.city || null,
    date: dateResult.parsed ? formatDateISO(dateResult.parsed) : null,
    dateRaw: record.date || "",
    time: record.time || null,
    genre: normalizedGenre,
    ticketUrl: record.ticketUrl || null,
    notes: record.notes || null,
    isFestivalOrTribute: detectFestivalOrTribute(`${record.artistName || ""} ${record.notes || ""}`),
    isCancelled: detectCancelled(`${record.artistName || ""} ${record.notes || ""}`),
    isPostponed: detectPostponed(`${record.artistName || ""} ${record.notes || ""}`),
    isRescheduled: detectRescheduled(`${record.artistName || ""} ${record.notes || ""}`),
    isSoldOut: detectSoldOut(`${record.artistName || ""} ${record.notes || ""}`),
  };

  return assembleEventRow({ raw: record.raw, fields, fieldConfidence, issues });
}

function parseDelimitedInput(rawText, detectedFormat) {
  const delimiter = detectedFormat === "tsv" ? "\t" : ",";
  const { records, usedPositionalFallback } = parseDelimited(rawText, delimiter);

  const rows = records.map((record, i) => {
    const row = eventRowFromDelimitedRecord(record);
    row.id = `row-${i}`;
    if (usedPositionalFallback) {
      row.issues = [
        ...row.issues,
        "No header row detected -- columns mapped positionally (Artist, Venue, City, Date, Time, and Genre if a 6th column is present). Please verify.",
      ];
    }
    return row;
  });

  return {
    rows,
    detectedFormat,
    sourceProfile: {
      id: detectedFormat === "tsv" ? "tsv-delimited" : "csv-delimited",
      version: "1.0.0",
      matchConfidence: 1.0,
      matchReason: usedPositionalFallback
        ? "consistent delimited rows detected; no header row recognized, columns mapped positionally"
        : "consistent delimited rows detected with a recognized header row",
    },
    stats: {
      totalInputLines: records.length,
      parsedRows: rows.filter((r) => r.status !== "unparseable").length,
      skippedFurniture: 0, // furniture filtering only applies to free-text paste, not structured rows
      malformed: rows.filter((r) => r.status === "unparseable").length,
    },
  };
}

function parseTextInput(rawText, { contextYear, defaultTime } = {}) {
  const lines = rawText.split("\n");

  // Detection always runs against the raw, unfiltered text: a
  // marker-anchored profile like msm-gig-guide relies on structural
  // signature lines (e.g. "View Details") that furniture.js's generic
  // >2x-repeated-line heuristic would otherwise strip out as junk before
  // detection ever saw them.
  const profile = detectSourceProfile(rawText);

  let textForExtraction = rawText;
  let discardedCount = 0;
  if (profile.filtersFurniture) {
    const filtered = filterPageFurniture(lines);
    textForExtraction = filtered.keptLines.join("\n");
    discardedCount = filtered.discardedCount;
  }

  const extractedRows = profile.extract(textForExtraction, { contextYear, defaultTime });
  const rows = extractedRows.map((row, i) => ({ ...row, id: `row-${i}` }));

  return {
    rows,
    detectedFormat: "text",
    sourceProfile: {
      id: profile.id,
      version: profile.version,
      matchConfidence: profile.matchConfidence,
      matchReason: profile.matchReason,
    },
    stats: {
      totalInputLines: lines.filter((l) => l.trim()).length,
      parsedRows: rows.filter((r) => r.status !== "unparseable").length,
      skippedFurniture: discardedCount,
      malformed: rows.filter((r) => r.status === "unparseable").length,
    },
  };
}

/**
 * The single Sprint 5A entry point. Never throws -- a bad or empty paste
 * produces a ParseResult with an empty or partially-flagged `rows` array,
 * never an exception, so one malformed input can't take down the caller.
 *
 * @param {string} rawText
 * @param {{ sourceName?: string, sourceUrl?: string, contextYear?: number, defaultTime?: string, format?: 'auto'|'text'|'csv'|'tsv' }} [options]
 * @returns {{
 *   rows: object[],           // EventRow[] -- see sourceProfiles.js/csvTsv.js for shape
 *   detectedFormat: 'text'|'csv'|'tsv',
 *   sourceProfile: { id: string, version: string, matchConfidence: number, matchReason: string } | null,
 *   stats: { totalInputLines: number, parsedRows: number, skippedFurniture: number, malformed: number },
 * }}
 */
export function parseImportText(rawText, options = {}) {
  if (!rawText || !rawText.trim()) return emptyResult();

  const { format = "auto", contextYear, defaultTime } = options;
  const detectedFormat = format === "auto" ? sniffDelimitedFormat(rawText) : format;

  if (detectedFormat === "csv" || detectedFormat === "tsv") {
    return parseDelimitedInput(rawText, detectedFormat);
  }
  return parseTextInput(rawText, { contextYear, defaultTime });
}
