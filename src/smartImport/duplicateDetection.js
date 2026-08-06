// Sprint 5B: duplicate detection -- flags rows that look like the same
// real-world gig as another row in the same paste, or as a gig that
// already exists in the database. Two independent, rule-based checks:
//
//   - within-batch "exact": rows sharing the same normalised
//     artist + date + venue key. Sprint 5A deliberately keeps every row
//     visible rather than merging them (see msm-gig-guide-sample.expected
//     .json's duplicate-cluster notes, e.g. the two identical "Jamie
//     Webster" rows) -- this module keeps that behaviour: it flags, it
//     never removes or merges a row.
//   - within-batch "near": rows sharing the same date + venue where one
//     normalised artist name is the other with extra trailing words, e.g.
//     "Day Fever" vs "Day Fever - Bournemouth" (see the same fixture).
//   - "existing": a row's normalised artist + date + venue key matches a
//     row already present in the live `gigs` table.
//
// Venue identity for the key prefers a resolved *exact* venueMatch (the
// same venue row id the database itself would use) over raw text, so "The
// Brook" and "the brook, southampton" -- worded differently but resolved to
// the same venue row by venueMatching.js -- are correctly treated as the
// same venue. Rows are expected to already carry a `.venueMatch` (see
// runMatching.js, which runs venue matching before duplicate detection --
// the same priority order this sprint was built in).
import { normaliseName } from "./textNormalize.js";
import { deriveVenueQuery } from "./venueMatching.js";

export const DUPLICATE_TIERS = {
  NONE: "none",
  EXACT_IN_BATCH: "exact_in_batch",
  NEAR_IN_BATCH: "near_in_batch",
  EXACT_EXISTING: "exact_existing",
};

function venueKeyFor(fields, venueMatch) {
  if (venueMatch && venueMatch.tier === "exact") return `id:${venueMatch.match.id}`;
  const { query } = deriveVenueQuery(fields);
  return `name:${normaliseName(query)}`;
}

function artistKeyFor(fields) {
  return normaliseName(fields.artistName || "");
}

function buildKey(fields, venueMatch) {
  return `${artistKeyFor(fields)}|${fields.date || ""}|${venueKeyFor(fields, venueMatch)}`;
}

// A key with no artist, no date and no venue name carries nothing worth
// matching on -- every such row would otherwise collide into one giant
// false "duplicate" cluster.
function isUsableKey(fields, venueMatch) {
  return Boolean(fields.date) && (Boolean(fields.artistName) || venueKeyFor(fields, venueMatch) !== "name:");
}

// "near" duplicate: same date + venue, and one normalised artist name is
// the other with extra trailing word(s) appended (a city/venue suffix is
// the observed real-world case). Never true for equal names -- those are
// already caught by the exact-key pass.
function isNearDuplicateArtist(nameA, nameB) {
  if (!nameA || !nameB || nameA === nameB) return false;
  return nameA.startsWith(nameB + " ") || nameB.startsWith(nameA + " ");
}

export function detectDuplicates(rows, { existingGigs = [] } = {}) {
  const results = new Map();
  for (const row of rows) results.set(row.id, { tier: DUPLICATE_TIERS.NONE, withRowIds: [], existingGigId: null });

  // -- within-batch: exact --
  const byKey = new Map();
  for (const row of rows) {
    if (!isUsableKey(row.fields, row.venueMatch)) continue;
    const key = buildKey(row.fields, row.venueMatch);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row.id);
  }
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      results.set(id, { tier: DUPLICATE_TIERS.EXACT_IN_BATCH, withRowIds: ids.filter((x) => x !== id), existingGigId: null });
    }
  }

  // -- within-batch: near --
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (!a.fields.date || a.fields.date !== b.fields.date) continue;
      const venueA = venueKeyFor(a.fields, a.venueMatch);
      const venueB = venueKeyFor(b.fields, b.venueMatch);
      if (venueA === "name:" || venueA !== venueB) continue;
      if (!isNearDuplicateArtist(artistKeyFor(a.fields), artistKeyFor(b.fields))) continue;

      if (results.get(a.id).tier === DUPLICATE_TIERS.NONE) {
        results.set(a.id, { tier: DUPLICATE_TIERS.NEAR_IN_BATCH, withRowIds: [b.id], existingGigId: null });
      }
      if (results.get(b.id).tier === DUPLICATE_TIERS.NONE) {
        results.set(b.id, { tier: DUPLICATE_TIERS.NEAR_IN_BATCH, withRowIds: [a.id], existingGigId: null });
      }
    }
  }

  // -- against existing gigs (highest precedence: a live gig already exists) --
  const existingByKey = new Map();
  for (const gig of existingGigs) {
    const venueKey = gig.venue_id ? `id:${gig.venue_id}` : `name:${normaliseName(gig.venue)}`;
    existingByKey.set(`${normaliseName(gig.band_name)}|${gig.date}|${venueKey}`, gig.id);
  }
  for (const row of rows) {
    if (!isUsableKey(row.fields, row.venueMatch)) continue;
    const key = buildKey(row.fields, row.venueMatch);
    if (existingByKey.has(key)) {
      results.set(row.id, { tier: DUPLICATE_TIERS.EXACT_EXISTING, withRowIds: [], existingGigId: existingByKey.get(key) });
    }
  }

  return results;
}
