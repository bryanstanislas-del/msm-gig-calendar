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
// false exact match. haveEqualMeaningfulTime() (below) is false whenever
// either side's time isn't meaningful, so a timeless row can never enter
// an exact match, on its own or paired with anything else. Two performances
// of the same act at the same venue on the same date but MORE than
// TIME_TOLERANCE_MINUTES apart are treated
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
//
// PHASE 2F: venue/artist identity comparison now also trusts a
// human-CONFIRMED match, not just a strict local exact hit, and applies
// the same rule to artist identity, which previously had no UUID
// dimension in this module at all. This affects the EXACT tier's own
// venue+artist comparison (rewritten as direct pairwise predicates -- see
// isExactMatch()/isExactMatchAgainstGig() and the identity() helpers just
// above them for the full rule) and, for venue only, the "same venue"
// GATE that near-tier matching also depends on (near's own artist-variant
// and time-ambiguity logic -- isNearDuplicateArtist, isAmbiguousOrClose-
// Time, isTimeAmbiguousDuplicate, TIME_TOLERANCE_MINUTES -- are completely
// untouched, still text-only, exactly as before this phase).
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

// Still used by isUsableKey() below (a pure "is there any venue signal at
// all" pre-filter for the exact-tier gate, not part of any identity
// comparison itself) -- every actual venue/artist EQUALITY decision in
// this module (exact tier, and the near tier's own same-venue gate) goes
// through venueIdentity()/sameIdentity() below instead, as of Phase 2F.
function venueKeyFor(fields, venueMatch) {
  if (venueMatch && venueMatch.tier === "exact") return `id:${venueMatch.match.id}`;
  const { query } = deriveVenueQuery(fields);
  return `name:${normaliseName(query)}`;
}

function artistKeyFor(fields) {
  return normaliseName(fields.artistName || "");
}

// PHASE 2F: an incoming row's venue/artist tier is "identity-bearing" --
// its match.id is a real, database-authoritative row id, never a
// still-unconfirmed suggestion -- only for "exact" (venueMatching.js's/
// artistMatching.js's own strict local match) and "confirmed" (Sprint
// 5D's human-confirmed tier, produced by groupResolution.js after an
// admin explicitly accepts/links a candidate). Deliberately excludes
// "fuzzy" (an unconfirmed suggestion -- the whole point of Phases 2A-2D's
// safety principles is that a fuzzy candidate never becomes identity on
// its own), "none", "approved_new" (a brand-new venue has no existing
// row to be identical to) and "not_applicable". Mirrors
// venueSearch/ranking.js's own isAutoResolvableMatchType() contract,
// extended to also trust "confirmed" since that tier didn't exist yet
// when this module was first written (see this phase's own audit for the
// history of why "confirmed" was never wired in before now).
function isIdentityBearingTier(tier) {
  return tier === "exact" || tier === "confirmed";
}

// {uuid, text} identity descriptor for one incoming row's venue, used by
// both the EXACT-tier comparison and the near tier's own same-venue gate
// below. `uuid` is set (and authoritative) only for an identity-bearing
// tier; `text` mirrors venueKeyFor's own pre-Phase-2F fallback exactly
// (the row's raw parsed
// query) for every other tier, but uses the matched venue's own
// canonical name for an identity-bearing tier instead -- the same
// distinction resolveVenueFields() (importEngine.js, Phase 2D) already
// draws for the same row, and for the same reason: once a row is
// confirmed, its own canonical name is the correct text representation,
// not the possibly-quite-different raw string that was fuzzy-matched
// against it. This `text` is what powers the fallback comparison against
// a historical gig that has no venue_id of its own -- see sameIdentity's
// own comment for why this must never be compared against a `uuid`.
function venueIdentity(fields, venueMatch) {
  if (venueMatch && isIdentityBearingTier(venueMatch.tier) && venueMatch.match && venueMatch.match.id) {
    return { uuid: venueMatch.match.id, text: normaliseName(venueMatch.match.name) };
  }
  const { query } = deriveVenueQuery(fields);
  return { uuid: null, text: normaliseName(query) };
}

// Same shape for an existing database gig -- gig.venue_id is exactly as
// authoritative as an incoming row's confirmed match.id (both are real
// venues.id foreign keys); a historical gig with no venue_id at all
// (pre-dates venue linking, or was never resolved) correctly gets
// uuid: null here, falling through to the text comparison.
function venueIdentityForGig(gig) {
  return { uuid: gig.venue_id || null, text: normaliseName(gig.venue) };
}

// Same idea for artist identity -- this module had no UUID dimension for
// artist identity at all before Phase 2F (artistKeyFor above, still used
// unchanged by near-tier matching, is and remains text-only). `text` uses
// the matched artist profile's own canonical band_name for an
// identity-bearing tier, mirroring venueIdentity's own reasoning above.
function artistIdentity(fields, artistMatch) {
  if (artistMatch && isIdentityBearingTier(artistMatch.tier) && artistMatch.match && artistMatch.match.id) {
    return { uuid: artistMatch.match.id, text: normaliseName(artistMatch.match.name) };
  }
  return { uuid: null, text: normaliseName(fields.artistName || "") };
}

function artistIdentityForGig(gig) {
  return { uuid: gig.band_profile_id || null, text: normaliseName(gig.band_name) };
}

// THE rule this whole phase exists to implement correctly: UUID vs UUID
// ONLY when BOTH sides carry an authoritative one (text is irrelevant to
// that comparison, even if it happens to also match -- two different real
// venues/artists that happen to share a display name must stay distinct);
// text vs text whenever EITHER side lacks one. Deliberately never compares
// one side's `uuid` against the other side's `text` as though those could
// ever be equal -- an incoming row's confirmed `id:<uuid>` and a
// historical gig's unlinked `text:<name>` are simply two different kinds
// of value, and treating a lookup miss between them as "not a duplicate"
// (rather than trying to force a comparison) is exactly what falling
// through to the text/text branch below already achieves correctly.
function sameIdentity(a, b) {
  if (a.uuid && b.uuid) return a.uuid === b.uuid;
  return Boolean(a.text) && a.text === b.text;
}

// Exact identity requires a MEANINGFUL, present performance time on BOTH
// sides -- unchanged from before Phase 2F. Previously expressed as "does
// buildExactKey return null", now a direct boolean predicate since the
// overall exact-match test below is pairwise rather than Map-keyed, but
// the underlying rule and its normaliseTime() call are byte-identical.
function haveEqualMeaningfulTime(timeA, timeB) {
  const t1 = normaliseTime(timeA);
  const t2 = normaliseTime(timeB);
  return t1 !== null && t2 !== null && t1 === t2;
}

// PHASE 2F: the exact-identity test as a direct pairwise predicate rather
// than the pre-Phase-2F Map-grouped string key -- required because
// sameIdentity's UUID-vs-UUID/text-vs-text fallback is asymmetric and
// context-dependent (whether to compare by UUID or by text depends on
// BOTH sides together, not on either row alone), which cannot be
// expressed as a single string key per side without either (a) missing a
// resolved-row-vs-historical-unlinked-gig match (an incoming row's
// `id:<uuid>` key would never equal an unlinked gig's `name:<text>` key,
// even though the correct answer is "compare by text" -- exactly the
// regression this phase's own design correction identified and required
// fixing), or (b) a subtler false-positive risk: naively unioning by text
// first would incorrectly merge two DIFFERENT confirmed entities that
// happen to share a display name, via a shared third row/gig that lacks
// a uuid of its own. A direct pairwise check has neither failure mode --
// mirrors this file's own pre-existing near-duplicate checks below,
// which have always been pairwise for exactly this kind of reason.
function isExactMatch(a, b) {
  if (!a.fields.date || a.fields.date !== b.fields.date) return false;
  if (!haveEqualMeaningfulTime(a.fields.time, b.fields.time)) return false;
  if (!sameIdentity(artistIdentity(a.fields, a.artistMatch), artistIdentity(b.fields, b.artistMatch))) return false;
  return sameIdentity(venueIdentity(a.fields, a.venueMatch), venueIdentity(b.fields, b.venueMatch));
}

function isExactMatchAgainstGig(row, gig) {
  if (!row.fields.date || row.fields.date !== gig.date) return false;
  if (!haveEqualMeaningfulTime(row.fields.time, gig.time)) return false;
  if (!sameIdentity(artistIdentity(row.fields, row.artistMatch), artistIdentityForGig(gig))) return false;
  return sameIdentity(venueIdentity(row.fields, row.venueMatch), venueIdentityForGig(gig));
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
// haveEqualMeaningfulTime's job, not this) or meaningful and more than
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

  // -- within-batch: exact -- (PHASE 2F: direct pairwise comparison -- see
  // isExactMatch's own comment for why a Map-keyed grouping can no longer
  // correctly express this rule once identity may be UUID- or text-based
  // depending on both sides together)
  const usableForExact = rows.filter((row) => isUsableKey(row.fields, row.venueMatch));
  const exactInBatchLinks = new Map(); // rowId -> Set<rowId>
  for (let i = 0; i < usableForExact.length; i++) {
    for (let j = i + 1; j < usableForExact.length; j++) {
      const a = usableForExact[i];
      const b = usableForExact[j];
      if (!isExactMatch(a, b)) continue;
      if (!exactInBatchLinks.has(a.id)) exactInBatchLinks.set(a.id, new Set());
      if (!exactInBatchLinks.has(b.id)) exactInBatchLinks.set(b.id, new Set());
      exactInBatchLinks.get(a.id).add(b.id);
      exactInBatchLinks.get(b.id).add(a.id);
    }
  }
  for (const [id, linkedIds] of exactInBatchLinks) {
    results.set(id, { tier: DUPLICATE_TIERS.EXACT_IN_BATCH, withRowIds: [...linkedIds], existingGigId: null });
  }

  // -- within-batch: near -- (PHASE 2F: the same-venue GATE below now also
  // trusts a confirmed match, via the same venueIdentity()/sameIdentity()
  // used by the exact-tier blocks -- otherwise a row that can already
  // exact-match another row/gig via its confirmed UUID would be unable to
  // near-match a THIRD, only-artist-variant-different row at all, purely
  // because near-tier's own venue check never learned about the
  // confirmed tier. This is ordering/gating only -- isNearDuplicateArtist,
  // isTimeAmbiguousDuplicate and every time-related function below remain
  // completely untouched.)
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (!a.fields.date || a.fields.date !== b.fields.date) continue;
      const venueIdentityA = venueIdentity(a.fields, a.venueMatch);
      if (!venueIdentityA.uuid && !venueIdentityA.text) continue;
      if (!sameIdentity(venueIdentityA, venueIdentity(b.fields, b.venueMatch))) continue;
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

  // -- against existing gigs: near -- (upgrades "none"/"near_in_batch",
  // never downgrades "exact_in_batch". PHASE 2F: same-venue GATE extended
  // to trust a confirmed match too, same reasoning as the within-batch
  // block above.)
  for (const row of rows) {
    if (!row.fields.date || !row.fields.artistName) continue;
    const current = results.get(row.id).tier;
    if (current === DUPLICATE_TIERS.EXACT_IN_BATCH) continue;
    const rowArtistKey = artistKeyFor(row.fields);
    const rowVenueIdentity = venueIdentity(row.fields, row.venueMatch);
    if (!rowVenueIdentity.uuid && !rowVenueIdentity.text) continue;

    for (const gig of existingGigs) {
      if (gig.date !== row.fields.date) continue;
      if (!sameIdentity(rowVenueIdentity, venueIdentityForGig(gig))) continue;
      const gigArtistKey = normaliseName(gig.band_name);
      const nearArtist = isNearDuplicateArtist(rowArtistKey, gigArtistKey);
      const timeAmbiguous = !nearArtist && rowArtistKey && rowArtistKey === gigArtistKey && isAmbiguousOrCloseTime(row.fields.time, gig.time);
      if (!nearArtist && !timeAmbiguous) continue;
      results.set(row.id, { tier: DUPLICATE_TIERS.NEAR_EXISTING, withRowIds: [], existingGigId: gig.id });
      break;
    }
  }

  // -- against existing gigs: exact -- (highest precedence: a live gig
  // already exists. PHASE 2F: direct pairwise comparison, same reasoning
  // as the within-batch block above; takes the first matching gig, same
  // as the "near" block above it already does.)
  for (const row of rows) {
    if (!isUsableKey(row.fields, row.venueMatch)) continue;
    for (const gig of existingGigs) {
      if (!isExactMatchAgainstGig(row, gig)) continue;
      results.set(row.id, { tier: DUPLICATE_TIERS.EXACT_EXISTING, withRowIds: [], existingGigId: gig.id });
      break;
    }
  }

  return results;
}
