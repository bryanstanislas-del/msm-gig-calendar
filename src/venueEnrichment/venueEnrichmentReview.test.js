import { describe, it, expect } from "vitest";
import { ENRICHMENT_FIELDS } from "./researchExport.js";
import {
  ALL_STATUSES,
  FIELD_REVIEW_ORDER,
  STATUS_LABELS,
  getStatusLabel,
  isSkippedOutcome,
  isProposedCandidate,
  isGeneratedCandidate,
  orderCandidatesByField,
  splitProposedAndSkipped,
  groupCandidatesByBatch,
  groupCandidatesByVenue,
  attachVenueInfo,
  normalizeCompareValue,
  isStaleCandidate,
  isValidHttpUrl,
  fieldReviewOrderMatchesEnrichmentFields,
} from "./venueEnrichmentReview.js";

const row = (overrides = {}) => ({
  id: "row-1",
  venue_id: "venue-1",
  batch_id: "VENUE-ENRICH-PILOT-001-REV1",
  field: "postcode",
  existing_value: null,
  suggested_value: "SO14 2NY",
  source_url: "https://example.com",
  source_type: "official_site",
  retrieved_at: "2026-09-10T00:00:00Z",
  confidence: "MEDIUM",
  notes: null,
  status: "pending",
  created_at: "2026-09-10T00:00:00Z",
  ...overrides,
});

describe("field review order", () => {
  it("is exactly a reordering of ENRICHMENT_FIELDS -- no field invented or dropped", () => {
    expect(fieldReviewOrderMatchesEnrichmentFields()).toBe(true);
    expect(FIELD_REVIEW_ORDER.length).toBe(ENRICHMENT_FIELDS.length);
  });

  it("orders candidates by the reviewer-facing field order, not insertion order", () => {
    const candidates = [
      row({ field: "seo_title" }),
      row({ field: "address" }),
      row({ field: "capacity" }),
    ];
    const ordered = orderCandidatesByField(candidates);
    expect(ordered.map((c) => c.field)).toEqual(["address", "capacity", "seo_title"]);
  });

  it("sorts an unknown field after every known field instead of crashing", () => {
    const candidates = [row({ field: "some_future_field" }), row({ field: "postcode" })];
    const ordered = orderCandidatesByField(candidates);
    expect(ordered.map((c) => c.field)).toEqual(["postcode", "some_future_field"]);
  });
});

describe("status labels", () => {
  it("has a safe label for every known DB status", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy();
      expect(getStatusLabel(status)).toBe(STATUS_LABELS[status]);
    }
  });

  it("falls back to an upper-cased echo for an unrecognised status rather than throwing", () => {
    expect(getStatusLabel("some_future_status")).toBe("SOME_FUTURE_STATUS");
  });

  it("never crashes on a missing/blank status", () => {
    expect(getStatusLabel(undefined)).toBe("UNKNOWN STATUS");
    expect(getStatusLabel("")).toBe("UNKNOWN STATUS");
  });
});

describe("outcome classification", () => {
  it("identifies skipped outcomes", () => {
    expect(isSkippedOutcome(row({ status: "skipped_no_source" }))).toBe(true);
    expect(isSkippedOutcome(row({ status: "skipped_ambiguous" }))).toBe(true);
    expect(isSkippedOutcome(row({ status: "pending" }))).toBe(false);
  });

  it("identifies a proposed candidate by a non-null suggested_value, not by status alone", () => {
    expect(isProposedCandidate(row({ suggested_value: "value" }))).toBe(true);
    expect(isProposedCandidate(row({ suggested_value: null, status: "skipped_no_source" }))).toBe(false);
  });

  it("identifies a generated candidate by source_type", () => {
    expect(isGeneratedCandidate(row({ source_type: "generated" }))).toBe(true);
    expect(isGeneratedCandidate(row({ source_type: "official_site" }))).toBe(false);
  });

  it("splits proposed vs skipped candidates while preserving field order", () => {
    const candidates = orderCandidatesByField([
      row({ field: "address", suggested_value: "1 High St" }),
      row({ field: "capacity", suggested_value: null, status: "skipped_ambiguous" }),
      row({ field: "postcode", suggested_value: "SO14 2NY" }),
    ]);
    const { proposed, skipped } = splitProposedAndSkipped(candidates);
    expect(proposed.map((c) => c.field)).toEqual(["address", "postcode"]);
    expect(skipped.map((c) => c.field)).toEqual(["capacity"]);
  });
});

describe("groupCandidatesByBatch", () => {
  it("does not hard-code the pilot batch id -- it groups whatever batch_ids are present", () => {
    const rows = [
      row({ batch_id: "BATCH-A", venue_id: "v1", created_at: "2026-01-01T00:00:00Z" }),
      row({ batch_id: "BATCH-B", venue_id: "v2", created_at: "2026-02-01T00:00:00Z" }),
      row({ batch_id: "BATCH-B", venue_id: "v3", created_at: "2026-02-01T00:00:00Z" }),
    ];
    const batches = groupCandidatesByBatch(rows);
    expect(batches.map((b) => b.batch_id).sort()).toEqual(["BATCH-A", "BATCH-B"]);
    const batchB = batches.find((b) => b.batch_id === "BATCH-B");
    expect(batchB.venueCount).toBe(2);
    expect(batchB.candidateCount).toBe(2);
  });

  it("orders batches newest-created-first", () => {
    const rows = [
      row({ batch_id: "OLD", created_at: "2026-01-01T00:00:00Z" }),
      row({ batch_id: "NEW", created_at: "2026-06-01T00:00:00Z" }),
    ];
    const batches = groupCandidatesByBatch(rows);
    expect(batches[0].batch_id).toBe("NEW");
  });

  it("counts every known status explicitly, including ones with zero rows", () => {
    const batches = groupCandidatesByBatch([row({ status: "pending" })]);
    expect(batches[0].statusCounts).toEqual({
      pending: 1, approved: 0, rejected: 0, applied: 0,
      stale_conflict: 0, skipped_no_source: 0, skipped_ambiguous: 0,
    });
  });

  it("reproduces the real REV1 pilot batch shape read from production (46 rows, 4 venues)", () => {
    const rows = [];
    const venues = [
      ["18dfbd7c-a76b-40f7-86bb-da753745083b", 14],
      ["1f70bf31-9f99-41ce-9cb9-02b8c4cb5ee9", 14],
      ["5b6ec219-2250-457d-aa8c-bcdfe15f21f3", 14],
      ["ac294bd3-3e6d-4cf1-8304-badea14c5e40", 4],
    ];
    for (const [venueId, count] of venues) {
      for (let i = 0; i < count; i++) {
        rows.push(row({ venue_id: venueId, field: FIELD_REVIEW_ORDER[i % FIELD_REVIEW_ORDER.length], id: `${venueId}-${i}` }));
      }
    }
    const batches = groupCandidatesByBatch(rows);
    expect(batches).toHaveLength(1);
    expect(batches[0].venueCount).toBe(4);
    expect(batches[0].candidateCount).toBe(46);
  });
});

describe("groupCandidatesByVenue + attachVenueInfo", () => {
  const rows = [
    row({ batch_id: "B1", venue_id: "v1", field: "seo_title" }),
    row({ batch_id: "B1", venue_id: "v1", field: "address" }),
    row({ batch_id: "B1", venue_id: "v2", field: "postcode" }),
    row({ batch_id: "B2", venue_id: "v3", field: "postcode" }),
  ];

  it("groups only the requested batch's rows by venue", () => {
    const groups = groupCandidatesByVenue(rows, "B1");
    expect(groups.map((g) => g.venue_id).sort()).toEqual(["v1", "v2"]);
    const v1 = groups.find((g) => g.venue_id === "v1");
    expect(v1.candidateCount).toBe(2);
    expect(v1.candidates.map((c) => c.field)).toEqual(["address", "seo_title"]);
  });

  it("attaches live venue info by id, and null when a venue is missing from the map", () => {
    const groups = groupCandidatesByVenue(rows, "B1");
    const withInfo = attachVenueInfo(groups, {
      v1: { id: "v1", name: "Platform Tavern", city: "Southampton", claimed: false },
    });
    expect(withInfo.find((g) => g.venue_id === "v1").venue.name).toBe("Platform Tavern");
    expect(withInfo.find((g) => g.venue_id === "v2").venue).toBeNull();
  });
});

describe("stale comparison (display-only)", () => {
  it("null vs null is not stale", () => {
    expect(isStaleCandidate(null, null)).toBe(false);
    expect(isStaleCandidate(undefined, null)).toBe(false);
    expect(isStaleCandidate(null, undefined)).toBe(false);
  });

  it("blank-equivalent values are handled consistently", () => {
    expect(isStaleCandidate("", null)).toBe(false);
    expect(isStaleCandidate("   ", undefined)).toBe(false);
    expect(isStaleCandidate("", "   ")).toBe(false);
  });

  it("a changed value is stale", () => {
    expect(isStaleCandidate("SO14 2NY", "SO14 3AB")).toBe(true);
    expect(isStaleCandidate(null, "SO14 2NY")).toBe(true);
    expect(isStaleCandidate("SO14 2NY", null)).toBe(true);
  });

  it("compares a numeric live value against its text snapshot without a false positive", () => {
    expect(isStaleCandidate("100", 100)).toBe(false);
    expect(isStaleCandidate("100", 250)).toBe(true);
  });

  it("normalizeCompareValue treats blanks as null and trims strings", () => {
    expect(normalizeCompareValue("")).toBeNull();
    expect(normalizeCompareValue("  ")).toBeNull();
    expect(normalizeCompareValue(" SO14 2NY ")).toBe("SO14 2NY");
    expect(normalizeCompareValue(100)).toBe("100");
  });
});

describe("safe external URL (reused from PromoSlot.jsx, not reimplemented)", () => {
  it("accepts https and http URLs", () => {
    expect(isValidHttpUrl("https://example.com/venue")).toBe(true);
    expect(isValidHttpUrl("http://example.com/venue")).toBe(true);
  });

  it("rejects javascript: and data: URLs", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects malformed URLs and non-string input", () => {
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
    expect(isValidHttpUrl(undefined)).toBe(false);
  });
});
