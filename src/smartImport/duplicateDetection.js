// Sprint 5B/5B.5: duplicate detection -- flags rows that look like the same
// real-world gig as another row in the same paste, or as a gig that
// already exists in the database. Four tiers, checked in this precedence
// (highest first):
//
//   - "exact_existing" -- a row's normalised artist + date + venue +
//     performance-time key matches a row already present in the live
//     `gigs` table. Unconditional: always wins, since importing this row
//     would create a literal duplicate database record.
//   - "exact_in_batch" -- rows sharing the same normalised artist + date +
//     venue + performance-time key with another row in the *same paste*.
//     Sprint 5A deliberately keeps every row visible rather than merging
//     them (see msm-gig-guide-sample.expected.json's duplicate-cluster
//     notes, e.g. the two identical "Jamie Webster" rows) -- this module
//     keeps that behaviour: it flags, it never removes or merges a row.
//   - "near_existing" -- same date + venue as an already-live gig, and
//     either (a) one normalised artist name is a near-match (trailing-words
//     variant, see isNearDuplicateArtist below) of the live gig's
//     band_name, or (b) the artist name is an EXACT match but the
//     performance time is missing/unparseable on either side or the two
//     times are close but not identical (see isAmbiguousOrCloseTime below).
//     A near-match against confirmed live data is a stronger signal than
//     one against another still-unconfirmed line in the same paste, so this
//     outranks "near_in_batch" -- but never downgrades an already-
//     "exact_in_batch" row (that's still the more certain classification).
//   - "near_in_batch" -- the same (a)/(b) relationship as above, but
//     against another row in the same paste instead of a live gig, e.g.
//     "Day Fever" vs "Day Fever - Bournemouth" (see the same fixture), or
//     "Freya Golding" at 12:35 vs 12:40 (same act, same venue/date, a
//     5-minute discrepancy too close to call two separate performances).
//
// TIME AND EXACT IDENTITY: a real festival programme can legitimately list
// the same act at the same venue on the same date more than once (a matinee
// and an evening set, back-to-back slots, etc) -- see the Freya Golding /
// Marlands Shopping Centre / 12/09/2026 regression case (12:35 and 15:35,
// two genuine performances) that motivated adding time to exact identity.
// Exact identity therefore requires a MEANINGFUL, EQUAL, normalised
// performance time on BOTH sides -- never merely "both sides normalise the
// same way", which would make two rows with no time at all collide into a
// false exact match. buildExactKey()/buildExactKeyForGig() return null
// (never a key) whenever their own row/gig's time isn't meaningful, so a
// timeless row can never enter an exact-match bucket, on its own or paired
// with anything else. Two performances of the same act at the same venue
// on the same date but MORE than TIME_TOLERANCE_MINUTES apart are treated
// as genuinely different performances (tier "none"), not flagged at all --
// see isAmbiguousOrCloseTime()'s own header comment for the full reasoning
// on why 10 minutes is the boundary and what happens on each side of it.
//
// Venue identity for the key prefers a resolved *exact* venueMatch (the
// same venue row id the database itself would use) over raw text, so "The
// Brook" and "the brook, southampton" -- worded differently but resolved to
// the same venue row by venueMatching.js -- are correctly treated as the
// same venue. Rows are expected to already carry a `.venueMatch` (see
// runMatching.js, which runs venue matching before duplicate detection --
// the same priority order this sprint was built in).
import { normaliseName, normaliseTime } from "./textNormalize.js";
import { deriveVenueQuery } from "./venueMatching.js";

// Two performances of the same act, same venue, same date, whose times
// differ by more than this are treated as genuinely separate performances
// (not flagged as any kind of duplicate) rather than a data-entry variance
// of one single performance. Chosen as a deliberately small window: large
// enough to absorb a door-time/stage-time mismatch or a retyping slip
// (1-10 minutes), small enough that a real second slot in a packed festival
// programme (typically 15-45+ minutes apart) is never mistaken for one.
export const TIME_TOLERANCE_MINUTES = 10;

export const DUPLICATE_TIERS = {
  NONE: "none",
  EXACT_IN_BATCH: "exact_in_batch",
  NEAR_IN_BATCH: "near_in_batch",
  NEAR_EXISTING: "near_existing",
  EXACT_EXISTING: "exact_existing",
};

function venueKeyFor(fields, venueMatch) {
  if (venueMatch && venueMatch.tier === "exact") return `id:${venueMatch.match.id}`;
  const { query } = deriveVenueQuery(fields);
  return `name:${normaliseName(query)}`;
}

function venueKeyForGig(gig) {
  return gig.venue_id ? `id:${gig.venue_id}` : `name:${normaliseName(gig.venue)}`;
}

function artistKeyFor(fields) {
  return normaliseName(fields.artistName || "");
}

// Exact identity requires a MEANINGFUL, present performance time -- returns
// null (never a usable key) whenever this row's own time doesn't
// normalise to one, so a timeless row can never enter an exact-match
// bucket on its own or paired with another timeless row. This is what
// stops "two missing times" from becoming a false Exact match merely
// because both sides normalise to nothing.
function buildExactKey(fields, venueMatch) {
  const time = normaliseTime(fields.time);
  if (time === null) return null;
  return `${artistKeyFor(fields)}|${fields.date || ""}|${venueKeyFor(fields, venueMatch)}|${time}`;
}

function buildExactKeyForGig(gig) {
  const time = normaliseTime(gig.time);
  if (time === null) return null;
  return `${normaliseName(gig.band_name)}|${gig.date}|${venueKeyForGig(gig)}|${time}`;
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
// the concern of buildExactKey/isAmbiguousOrCloseTime instead.
function isNearDuplicateArtist(nameA, nameB) {
  if (!nameA || !nameB || nameA === nameB) return false;
  return nameA.startsWith(nameB + " ") || nameB.startsWith(nameA + " ");
}

// True when two performance times for the SAME act at the SAME venue/date
// can't be confidently told apart as separate performances: at least one
// side is missing/unparseable (there's genuinely not enough information to
// rule out an accidental duplicate), or both are meaningful and within
// TIME_TOLERANCE_MINUTES of each other (most likely one performance,
// retyped slightly differently -- a door-time-vs-stage-time mismatch, a
// rounding slip). False when both are meaningful and identical (that's
// buildExactKey's job, not this) or meaningful and more than
// TIME_TOLERANCE_MINUTES apart -- which reads as a genuinely separate
// scheduled performance (an early matinee and an evening set, back-to-back
// festival slots) and must NOT be flagged as any kind of duplicate at all.
function isAmbiguousOrCloseTime(timeA, timeB) {
  const t1 = normaliseTime(timeA);
  const t2 = normaliseTime(timeB);
  if (t1 === null || t2 === null) return true;
  if (t1 === t2) return false;
  return Math.abs(t1 - t2) <= TIME_TOLERANCE_MINUTES;
}

// Same date+venue, exact-matching artist name, and an ambiguous/close time
// relationship -- the one additional near-duplicate path this module adds
// alongside the pre-existing artist-name-variant one. Deliberately
// separate from isNearDuplicateArtist (which explicitly excludes equal
// names): this path is about time ambiguity between two rows that already
// agree on who's performing, not about name-spelling variance.
function isTimeAmbiguousDuplicate(fieldsA, fieldsB) {
  const artistA = artistKeyFor(fieldsA);
  const artistB = artistKeyFor(fieldsB);
  if (!artistA || artistA !== artistB) return false;
  return isAmbiguousOrCloseTime(fieldsA.time, fieldsB.time);
}

export function detectDuplicates(rows, { existingGigs = [] } = {}) {
  const results = new Map();
  for (const row of rows) results.set(row.id, { tier: DUPLICATE_TIERS.NONE, withRowIds: [], existingGigId: null });

  // -- within-batch: exact --
  const byKey = new Map();
  for (const row of rows) {
    if (!isUsableKey(row.fields, row.venueMatch)) continue;
    const key = buildExactKey(row.fields, row.venueMatch);
    if (key === null) continue; // no meaningful time -- never an exact match on its own
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
      const nearArtist = isNearDuplicateArtist(artistKeyFor(a.fields), artistKeyFor(b.fields));
      if (!nearArtist && !isTimeAmbiguousDuplicate(a.fields, b.fields)) continue;

      if (results.get(a.id).tier === DUPLICATE_TIERS.NONE) {
        results.set(a.id, { tier: DUPLICATE_TIERS.NEAR_IN_BATCH, withRowIds: [b.id], existingGigId: null });
      }
      if (results.get(b.id).tier === DUPLICATE_TIERS.NONE) {
        results.set(b.id, { tier: DUPLICATE_TIERS.NEAR_IN_BATCH, withRowIds: [a.id], existingGigId: null });
      }
    }
  }

  // -- against existing gigs: near -- (upgrades "none"/"near_in_batch", never downgrades "exact_in_batch")
  for (const row of rows) {
    if (!row.fields.date || !row.fields.artistName) continue;
    const current = results.get(row.id).tier;
    if (current === DUPLICATE_TIERS.EXACT_IN_BATCH) continue;
    const rowArtistKey = artistKeyFor(row.fields);
    const rowVenueKey = venueKeyFor(row.fields, row.venueMatch);
    if (rowVenueKey === "name:") continue;

    for (const gig of existingGigs) {
      if (gig.date !== row.fields.date) continue;
      if (venueKeyForGig(gig) !== rowVenueKey) continue;
      const gigArtistKey = normaliseName(gig.band_name);
      const nearArtist = isNearDuplicateArtist(rowArtistKey, gigArtistKey);
      const timeAmbiguous = !nearArtist && rowArtistKey && rowArtistKey === gigArtistKey && isAmbiguousOrCloseTime(row.fields.time, gig.time);
      if (!nearArtist && !timeAmbiguous) continue;
      results.set(row.id, { tier: DUPLICATE_TIERS.NEAR_EXISTING, withRowIds: [], existingGigId: gig.id });
      break;
    }
  }

  // -- against existing gigs: exact -- (highest precedence: a live gig already exists)
  const existingByKey = new Map();
  for (const gig of existingGigs) {
    const key = buildExactKeyForGig(gig);
    if (key !== null) existingByKey.set(key, gig.id);
  }
  for (const row of rows) {
    if (!isUsableKey(row.fields, row.venueMatch)) continue;
    const key = buildExactKey(row.fields, row.venueMatch);
    if (key !== null && existingByKey.has(key)) {
      results.set(row.id, { tier: DUPLICATE_TIERS.EXACT_EXISTING, withRowIds: [], existingGigId: existingByKey.get(key) });
    }
  }

  return results;
}
