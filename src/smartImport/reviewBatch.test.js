import { describe, it, expect } from "vitest";
import {
  ROW_STATES,
  EXCLUDED_MANUALLY,
  DUPLICATE_STATES,
  ERROR_STATES,
  DEFAULT_INCLUDED_STATES,
  LOCKED_STATES,
  isLocked,
  deriveRowState,
  resolveDisplayState,
  explainRowState,
} from "./reviewBatch.js";

const exact = { tier: "exact" };
const fuzzy = { tier: "fuzzy" };
const none = { tier: "none" };
const notApplicable = { tier: "not_applicable" };
const noDuplicate = { tier: "none" };
const okFields = { date: "2026-09-01", isCancelled: false, isPostponed: false, isRescheduled: false };

function baseArgs(overrides = {}) {
  return {
    parserStatus: "ok",
    fields: okFields,
    duplicate: noDuplicate,
    venueMatch: exact,
    artistMatch: exact,
    ...overrides,
  };
}

describe("deriveRowState", () => {
  it("returns 'exact_duplicate' for exact_in_batch or exact_existing, above everything else", () => {
    expect(deriveRowState(baseArgs({ duplicate: { tier: "exact_in_batch" } }))).toBe(ROW_STATES.EXACT_DUPLICATE);
    expect(deriveRowState(baseArgs({ duplicate: { tier: "exact_existing" } }))).toBe(ROW_STATES.EXACT_DUPLICATE);
  });

  it("returns 'invalid_date' when the date is missing, even with clean matches", () => {
    expect(deriveRowState(baseArgs({ fields: { ...okFields, date: null } }))).toBe(ROW_STATES.INVALID_DATE);
  });

  it("prefers 'exact_duplicate' over 'invalid_date' when both apply", () => {
    const status = deriveRowState(baseArgs({ fields: { ...okFields, date: null }, duplicate: { tier: "exact_in_batch" } }));
    expect(status).toBe(ROW_STATES.EXACT_DUPLICATE);
  });

  it("returns 'cancelled'/'postponed'/'rescheduled' from the structured event-status flags, before matching states", () => {
    expect(deriveRowState(baseArgs({ fields: { ...okFields, isCancelled: true }, venueMatch: none }))).toBe(ROW_STATES.CANCELLED);
    expect(deriveRowState(baseArgs({ fields: { ...okFields, isPostponed: true }, venueMatch: none }))).toBe(ROW_STATES.POSTPONED);
    expect(deriveRowState(baseArgs({ fields: { ...okFields, isRescheduled: true }, venueMatch: none }))).toBe(ROW_STATES.RESCHEDULED);
  });

  it("returns 'probable_duplicate' for a near-match against a live gig", () => {
    expect(deriveRowState(baseArgs({ duplicate: { tier: "near_existing" } }))).toBe(ROW_STATES.PROBABLE_DUPLICATE);
  });

  it("returns 'possible_duplicate' for a near-match within the same paste", () => {
    expect(deriveRowState(baseArgs({ duplicate: { tier: "near_in_batch" } }))).toBe(ROW_STATES.POSSIBLE_DUPLICATE);
  });

  it("prefers 'probable_duplicate' over 'possible_duplicate' naming-wise (distinct tiers, both checked)", () => {
    // near_existing and near_in_batch are mutually exclusive tiers coming
    // out of duplicateDetection.js, so this just pins the precedence order.
    expect(deriveRowState(baseArgs({ duplicate: { tier: "near_existing" } }))).not.toBe(ROW_STATES.POSSIBLE_DUPLICATE);
  });

  it("returns 'needs_review' when the Sprint 5A parser status is not 'ok'", () => {
    expect(deriveRowState(baseArgs({ parserStatus: "needs_review" }))).toBe(ROW_STATES.NEEDS_REVIEW);
  });

  it("returns 'needs_review' when either match is only fuzzy", () => {
    expect(deriveRowState(baseArgs({ venueMatch: fuzzy }))).toBe(ROW_STATES.NEEDS_REVIEW);
    expect(deriveRowState(baseArgs({ artistMatch: fuzzy }))).toBe(ROW_STATES.NEEDS_REVIEW);
  });

  it("returns 'missing_venue' when the venue has no match at all", () => {
    expect(deriveRowState(baseArgs({ venueMatch: none }))).toBe(ROW_STATES.MISSING_VENUE);
  });

  it("returns 'missing_artist' when the artist has no match at all (and venue did resolve)", () => {
    expect(deriveRowState(baseArgs({ artistMatch: none }))).toBe(ROW_STATES.MISSING_ARTIST);
  });

  it("prefers 'missing_venue' over 'missing_artist' when both have no match", () => {
    expect(deriveRowState(baseArgs({ venueMatch: none, artistMatch: none }))).toBe(ROW_STATES.MISSING_VENUE);
  });

  it("returns 'ready' when everything is clean, including when artist is not_applicable", () => {
    expect(deriveRowState(baseArgs())).toBe(ROW_STATES.READY);
    expect(deriveRowState(baseArgs({ artistMatch: notApplicable }))).toBe(ROW_STATES.READY);
  });
});

describe("isLocked", () => {
  it("is true only for exact_duplicate and invalid_date", () => {
    expect(LOCKED_STATES).toEqual([ROW_STATES.EXACT_DUPLICATE, ROW_STATES.INVALID_DATE]);
    for (const state of Object.values(ROW_STATES)) {
      expect(isLocked(state)).toBe(state === ROW_STATES.EXACT_DUPLICATE || state === ROW_STATES.INVALID_DATE);
    }
  });
});

describe("DEFAULT_INCLUDED_STATES / grouping constants", () => {
  it("only 'ready' is included by default", () => {
    expect(DEFAULT_INCLUDED_STATES).toEqual([ROW_STATES.READY]);
  });

  it("DUPLICATE_STATES and ERROR_STATES are disjoint and don't include cancelled/postponed/rescheduled", () => {
    for (const s of DUPLICATE_STATES) expect(ERROR_STATES).not.toContain(s);
    for (const s of [ROW_STATES.CANCELLED, ROW_STATES.POSTPONED, ROW_STATES.RESCHEDULED]) {
      expect(DUPLICATE_STATES).not.toContain(s);
      expect(ERROR_STATES).not.toContain(s);
    }
  });
});

describe("resolveDisplayState", () => {
  it("shows 'excluded_manually' when a default-included ('ready') row is unchecked", () => {
    expect(resolveDisplayState(ROW_STATES.READY, false)).toBe(EXCLUDED_MANUALLY);
  });

  it("shows the row's own state when a 'ready' row is checked", () => {
    expect(resolveDisplayState(ROW_STATES.READY, true)).toBe(ROW_STATES.READY);
  });

  it("keeps a row's own state (not 'excluded_manually') when an already-default-excluded row is unchecked", () => {
    expect(resolveDisplayState(ROW_STATES.CANCELLED, false)).toBe(ROW_STATES.CANCELLED);
    expect(resolveDisplayState(ROW_STATES.POSSIBLE_DUPLICATE, false)).toBe(ROW_STATES.POSSIBLE_DUPLICATE);
  });

  it("keeps a row's own state when a default-excluded row is checked (admin manually included it)", () => {
    expect(resolveDisplayState(ROW_STATES.MISSING_VENUE, true)).toBe(ROW_STATES.MISSING_VENUE);
  });
});

describe("explainRowState", () => {
  const baseItem = () => ({
    fields: { date: "2026-09-01", isCancelled: false, isPostponed: false, isRescheduled: false },
    issues: [],
    duplicate: { tier: "none" },
    venueMatch: { tier: "exact" },
    artistMatch: { tier: "exact" },
  });

  it("returns an empty list for a fully clean row", () => {
    expect(explainRowState(baseItem())).toEqual([]);
  });

  it("explains an exact-existing duplicate", () => {
    const item = { ...baseItem(), duplicate: { tier: "exact_existing" } };
    expect(explainRowState(item)[0]).toMatch(/already in the calendar/i);
  });

  it("explains a missing date", () => {
    const item = { ...baseItem(), fields: { ...baseItem().fields, date: null } };
    expect(explainRowState(item)).toContain("No valid date could be parsed from this row.");
  });

  it("explains cancelled/postponed/rescheduled flags", () => {
    expect(explainRowState({ ...baseItem(), fields: { ...baseItem().fields, isCancelled: true } })).toContain(
      "Marked as cancelled in the source text."
    );
  });

  it("includes parser-level issues verbatim", () => {
    const item = { ...baseItem(), issues: ["Date unclear"] };
    expect(explainRowState(item)).toContain("Date unclear");
  });

  it("explains a missing venue with the attempted query", () => {
    const item = { ...baseItem(), venueMatch: { tier: "none", query: "The Nonexistent Club" } };
    expect(explainRowState(item)[0]).toContain("The Nonexistent Club");
  });

  it("explains a fuzzy venue match with the top candidate and score", () => {
    const item = {
      ...baseItem(),
      venueMatch: { tier: "fuzzy", candidates: [{ name: "The Brook", similarity_score: 0.6 }] },
    };
    const explanation = explainRowState(item)[0];
    expect(explanation).toContain("The Brook");
    expect(explanation).toContain("60%");
  });

  it("explains a missing/fuzzy artist the same way", () => {
    const missing = explainRowState({ ...baseItem(), artistMatch: { tier: "none", query: "Unknown Act" } });
    expect(missing[0]).toContain("Unknown Act");
    const fuzzyItem = explainRowState({
      ...baseItem(),
      artistMatch: { tier: "fuzzy", candidates: [{ name: "The Mafia", similarity_score: 0.5 }] },
    });
    expect(fuzzyItem[0]).toContain("The Mafia");
    expect(fuzzyItem[0]).toContain("50%");
  });
});
