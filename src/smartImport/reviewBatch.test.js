import { describe, it, expect } from "vitest";
import { deriveReviewStatus, REVIEW_STATUSES } from "./reviewBatch.js";

const exact = { tier: "exact" };
const fuzzy = { tier: "fuzzy" };
const none = { tier: "none" };
const notApplicable = { tier: "not_applicable" };
const noDuplicate = { tier: "none" };

describe("deriveReviewStatus", () => {
  it("returns 'duplicate' whenever the duplicate check flags the row, regardless of clean matches", () => {
    const status = deriveReviewStatus({
      parserStatus: "ok",
      duplicate: { tier: "exact_in_batch" },
      venueMatch: exact,
      artistMatch: exact,
    });
    expect(status).toBe(REVIEW_STATUSES.DUPLICATE);
  });

  it("returns 'needs_review' when the Sprint 5A parser status is not 'ok', even with clean matches", () => {
    const status = deriveReviewStatus({ parserStatus: "needs_review", duplicate: noDuplicate, venueMatch: exact, artistMatch: exact });
    expect(status).toBe(REVIEW_STATUSES.NEEDS_REVIEW);
  });

  it("returns 'new_venue' when the venue has no match at all", () => {
    const status = deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: none, artistMatch: exact });
    expect(status).toBe(REVIEW_STATUSES.NEW_VENUE);
  });

  it("returns 'new_artist' when the artist has no match at all (and venue did resolve)", () => {
    const status = deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: exact, artistMatch: none });
    expect(status).toBe(REVIEW_STATUSES.NEW_ARTIST);
  });

  it("prefers 'new_venue' over 'new_artist' when both have no match", () => {
    const status = deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: none, artistMatch: none });
    expect(status).toBe(REVIEW_STATUSES.NEW_VENUE);
  });

  it("returns 'needs_review' when either match is only fuzzy", () => {
    expect(deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: fuzzy, artistMatch: exact })).toBe(
      REVIEW_STATUSES.NEEDS_REVIEW
    );
    expect(deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: exact, artistMatch: fuzzy })).toBe(
      REVIEW_STATUSES.NEEDS_REVIEW
    );
  });

  it("prefers 'needs_review' over 'new_venue'/'new_artist' when one side is fuzzy and the other has no match at all", () => {
    // Observed against the real database: a venue with only a weak fuzzy
    // candidate, paired with an artist that has no match, used to land in
    // 'new_artist' -- silently hiding the venue candidate behind a filter
    // tab that gives no hint it's there. A fuzzy candidate is a decision an
    // admin still has to make, so it now wins over "no match, will create
    // new" on the other field.
    expect(deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: fuzzy, artistMatch: none })).toBe(
      REVIEW_STATUSES.NEEDS_REVIEW
    );
    expect(deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: none, artistMatch: fuzzy })).toBe(
      REVIEW_STATUSES.NEEDS_REVIEW
    );
  });

  it("returns 'ready' when the venue is exact, the artist is exact or not_applicable, parser status is ok, and there's no duplicate", () => {
    expect(deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: exact, artistMatch: exact })).toBe(
      REVIEW_STATUSES.READY
    );
    // generic-dash-list rows never attempt an artist -- not_applicable must
    // not block "ready" the way "none" (new_artist) does.
    expect(deriveReviewStatus({ parserStatus: "ok", duplicate: noDuplicate, venueMatch: exact, artistMatch: notApplicable })).toBe(
      REVIEW_STATUSES.READY
    );
  });
});
