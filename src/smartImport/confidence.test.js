import { describe, it, expect } from "vitest";
import { DATE_CONFIDENCE, TEXT_FIELD_CONFIDENCE, computeOverallConfidence, deriveRowStatus, STATUS_THRESHOLDS } from "./confidence.js";

describe("computeOverallConfidence", () => {
  it("weights date highest, then venueName, then artistName, then city", () => {
    const perfect = computeOverallConfidence({ date: 1, venueName: 1, city: 1, artistName: 1 });
    expect(perfect).toBe(1);

    const dateOnly = computeOverallConfidence({ date: 1, venueName: 0, city: 0, artistName: 0 });
    const venueOnly = computeOverallConfidence({ date: 0, venueName: 1, city: 0, artistName: 0 });
    expect(dateOnly).toBeGreaterThan(venueOnly);
  });

  it("excludes null/undefined fields from the weighted average entirely, rather than scoring them as 0", () => {
    // generic-dash-list rows never attempt artistName (see sourceProfiles.js) --
    // null must not drag the score down the way a genuine failure (0) would.
    const withNullArtist = computeOverallConfidence({ date: 1, venueName: 1, city: 1, artistName: null });
    expect(withNullArtist).toBe(1);

    const withFailedArtist = computeOverallConfidence({ date: 1, venueName: 1, city: 1, artistName: 0 });
    expect(withFailedArtist).toBeLessThan(1);
  });

  it("returns 0 when every field is null/undefined (nothing to score)", () => {
    expect(computeOverallConfidence({})).toBe(0);
    expect(computeOverallConfidence({ date: null, venueName: undefined })).toBe(0);
  });
});

describe("deriveRowStatus", () => {
  const baseArgs = () => ({
    fields: { date: "2026-06-12", venueName: "The Obelisk", city: "Woolston" },
    fieldConfidence: { date: DATE_CONFIDENCE.EXPLICIT, venueName: TEXT_FIELD_CONFIDENCE.EXPLICIT, city: TEXT_FIELD_CONFIDENCE.EXPLICIT, artistName: null },
    issues: [],
  });

  it("returns 'unparseable' when both date and venueName are missing, regardless of other fields", () => {
    const args = baseArgs();
    args.fields = { ...args.fields, date: null, venueName: null };
    expect(deriveRowStatus(args)).toBe("unparseable");
  });

  it("returns 'ok' for a fully explicit, issue-free row", () => {
    expect(deriveRowStatus(baseArgs())).toBe("ok");
  });

  it("returns 'needs_review' when overall confidence is below the threshold even with no issues", () => {
    const args = baseArgs();
    args.fieldConfidence = { date: 0.5, venueName: 0.5, city: 0.5, artistName: null };
    expect(computeOverallConfidence(args.fieldConfidence)).toBeLessThan(STATUS_THRESHOLDS.MIN_OVERALL_FOR_OK);
    expect(deriveRowStatus(args)).toBe("needs_review");
  });

  it("returns 'needs_review' when any hard field is below MIN_FIELD_FOR_OK even if overall is high", () => {
    const args = baseArgs();
    // date very high, but venueName just below the per-field floor
    args.fieldConfidence = { date: 1, venueName: STATUS_THRESHOLDS.MIN_FIELD_FOR_OK - 0.01, city: 1, artistName: null };
    expect(deriveRowStatus(args)).toBe("needs_review");
  });

  it("returns 'needs_review' when issues are present even if scores are high", () => {
    const args = baseArgs();
    args.issues = ["No city"];
    expect(deriveRowStatus(args)).toBe("needs_review");
  });

  it("treats a field score exactly at MIN_FIELD_FOR_OK as passing (boundary is inclusive)", () => {
    const args = baseArgs();
    args.fieldConfidence = { date: STATUS_THRESHOLDS.MIN_FIELD_FOR_OK, venueName: 1, city: 1, artistName: null };
    // overall must also clear MIN_OVERALL_FOR_OK for this to actually resolve "ok" --
    // this case specifically checks the per-field boundary doesn't itself downgrade the row.
    const overall = computeOverallConfidence(args.fieldConfidence);
    const status = deriveRowStatus(args);
    expect(status).toBe(overall >= STATUS_THRESHOLDS.MIN_OVERALL_FOR_OK ? "ok" : "needs_review");
  });
});
