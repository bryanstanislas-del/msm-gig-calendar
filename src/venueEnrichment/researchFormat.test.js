import { describe, it, expect } from "vitest";
import {
  SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  CANDIDATE_STATUSES,
  SEO_TITLE_MAX_LENGTH,
  SEO_DESCRIPTION_MAX_LENGTH,
  outcomeToInitialStatus,
  validateCandidate,
  requiresManualReview,
  validateVenueIdsPreserved,
  validateResearchOutputBatch,
} from "./researchFormat.js";
import { buildResearchInputBatch } from "./researchExport.js";

const VENUE_ID = "11111111-1111-4111-8111-111111111111";

const foundCandidate = (overrides = {}) => ({
  field: "postcode",
  outcome: "found",
  existing_value: null,
  suggested_value: "SO14 3AB",
  source_url: "https://theplatformtavern.example/contact",
  source_type: "official_site",
  confidence: "HIGH",
  notes: "Stated on the venue's own Contact page.",
  ...overrides,
});

const skippedCandidate = (overrides = {}) => ({
  field: "capacity",
  outcome: "skipped_ambiguous",
  existing_value: null,
  suggested_value: null,
  source_url: null,
  source_type: null,
  confidence: null,
  notes: "Source states 450 standing / 280 seated with no single figure.",
  ...overrides,
});

const generatedCandidate = (overrides = {}) => ({
  field: "seo_title",
  outcome: "found",
  existing_value: null,
  suggested_value: "The Platform Tavern, Southampton | Music Scene Magazine",
  source_url: null,
  source_type: "generated",
  confidence: "HIGH",
  notes: "Built from the verified postcode and address candidates in this same batch.",
  ...overrides,
});

describe("L: staging design rejects unsupported/arbitrary fields", () => {
  it("rejects a field outside the enrichment allow-list", () => {
    const { valid, errors } = validateCandidate(foundCandidate({ field: "user_id" }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("user_id"))).toBe(true);
  });
  it("rejects id/name/city/claim_status -- identity/moderation columns are never candidates", () => {
    for (const field of ["id", "name", "city", "slug", "claim_status", "claimed", "admin_created"]) {
      expect(validateCandidate(foundCandidate({ field })).valid).toBe(false);
    }
  });
  it("accepts every field in the real allow-list", () => {
    for (const field of ["postcode", "address", "capacity", "contact_email", "phone", "website", "facebook", "instagram", "twitter", "photo_url"]) {
      expect(validateCandidate(foundCandidate({ field })).valid).toBe(true);
    }
  });
});

describe("factual candidate validation", () => {
  it("valid HIGH-confidence factual candidate passes", () => {
    expect(validateCandidate(foundCandidate()).valid).toBe(true);
  });
  it("rejects a 'found' factual candidate missing source_url -- no source, no factual candidate", () => {
    const { valid, errors } = validateCandidate(foundCandidate({ source_url: null }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("source_url"))).toBe(true);
  });
  it("rejects a factual candidate with source_type='generated'", () => {
    expect(validateCandidate(foundCandidate({ source_type: "generated" })).valid).toBe(false);
  });
  it("rejects an invalid source_type", () => {
    expect(validateCandidate(foundCandidate({ source_type: "random_blog" })).valid).toBe(false);
  });
  it("rejects a 'found' candidate with no confidence", () => {
    expect(validateCandidate(foundCandidate({ confidence: null })).valid).toBe(false);
  });
  it("rejects an invalid confidence value", () => {
    expect(validateCandidate(foundCandidate({ confidence: "VERY_HIGH" })).valid).toBe(false);
  });
  it("rejects a 'found' candidate with a blank suggested_value", () => {
    expect(validateCandidate(foundCandidate({ suggested_value: "" })).valid).toBe(false);
    expect(validateCandidate(foundCandidate({ suggested_value: "   " })).valid).toBe(false);
  });
});

describe("skip outcomes -- 'no source = no factual candidate'", () => {
  it("a valid skipped_ambiguous candidate carries no suggested_value/source/confidence", () => {
    expect(validateCandidate(skippedCandidate()).valid).toBe(true);
  });
  it("a valid skipped_no_source candidate passes the same way", () => {
    expect(validateCandidate(skippedCandidate({ outcome: "skipped_no_source" })).valid).toBe(true);
  });
  it("rejects a skip outcome that still carries a suggested_value", () => {
    const { valid, errors } = validateCandidate(skippedCandidate({ suggested_value: "450" }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("suggested_value must be null"))).toBe(true);
  });
});

describe("generated editorial/SEO fields", () => {
  it("a valid generated candidate passes", () => {
    expect(validateCandidate(generatedCandidate()).valid).toBe(true);
  });
  it("rejects a generated field without notes explaining its factual basis", () => {
    const { valid, errors } = validateCandidate(generatedCandidate({ notes: "" }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("verified factual candidates"))).toBe(true);
  });
  it("rejects a generated field whose source_type isn't 'generated'", () => {
    expect(validateCandidate(generatedCandidate({ source_type: "official_site" })).valid).toBe(false);
  });
  it("all four generated fields are accepted with source_type=generated", () => {
    for (const field of ["description", "seo_title", "seo_description", "seo_search_phrases"]) {
      expect(validateCandidate(generatedCandidate({ field })).valid).toBe(true);
    }
  });
});

describe("SEO length limits -- rejected, never silently truncated", () => {
  it("SEO_TITLE_MAX_LENGTH / SEO_DESCRIPTION_MAX_LENGTH match RESEARCH_CONTRACT.md's 60/160", () => {
    expect(SEO_TITLE_MAX_LENGTH).toBe(60);
    expect(SEO_DESCRIPTION_MAX_LENGTH).toBe(160);
  });
  it("accepts an seo_title of exactly 60 characters", () => {
    const value = "A".repeat(60);
    const result = validateCandidate(generatedCandidate({ field: "seo_title", suggested_value: value }));
    expect(result.valid).toBe(true);
  });
  it("rejects an seo_title of 61 characters -- one over the limit", () => {
    const value = "A".repeat(61);
    const { valid, errors } = validateCandidate(generatedCandidate({ field: "seo_title", suggested_value: value }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("seo_title") && e.includes("60"))).toBe(true);
  });
  it("accepts an seo_description of exactly 160 characters", () => {
    const value = "A".repeat(160);
    const result = validateCandidate(generatedCandidate({ field: "seo_description", suggested_value: value }));
    expect(result.valid).toBe(true);
  });
  it("rejects an seo_description of 161 characters -- one over the limit", () => {
    const value = "A".repeat(161);
    const { valid, errors } = validateCandidate(generatedCandidate({ field: "seo_description", suggested_value: value }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("seo_description") && e.includes("160"))).toBe(true);
  });
  it("never truncates -- an over-length value is rejected outright, the candidate is not silently shortened", () => {
    const value = "A".repeat(61);
    const { errors } = validateCandidate(generatedCandidate({ field: "seo_title", suggested_value: value }));
    // The rejected value itself is untouched by validation -- nothing in
    // validateCandidate() mutates or returns a shortened suggested_value.
    expect(value).toHaveLength(61);
    expect(errors.length).toBeGreaterThan(0);
  });
  it("length limits do not apply to non-SEO generated fields (description/seo_search_phrases)", () => {
    const longValue = "A".repeat(500);
    expect(validateCandidate(generatedCandidate({ field: "description", suggested_value: longValue })).valid).toBe(true);
    expect(validateCandidate(generatedCandidate({ field: "seo_search_phrases", suggested_value: longValue })).valid).toBe(true);
  });
  it("length limits do not apply to factual (non-generated) fields", () => {
    const longValue = "A".repeat(500);
    expect(validateCandidate(foundCandidate({ field: "address", suggested_value: longValue })).valid).toBe(true);
  });
});

describe("requiresManualReview -- photo/LOW/MEDIUM/claimed policy", () => {
  it("photo_url always requires manual review, even at HIGH confidence", () => {
    expect(requiresManualReview(foundCandidate({ field: "photo_url", confidence: "HIGH" }))).toBe(true);
  });
  it("LOW confidence always requires manual review", () => {
    expect(requiresManualReview(foundCandidate({ confidence: "LOW" }))).toBe(true);
  });
  it("MEDIUM confidence always requires manual review", () => {
    expect(requiresManualReview(foundCandidate({ confidence: "MEDIUM" }))).toBe(true);
  });
  it("a skipped outcome always requires manual review (nothing to auto-apply)", () => {
    expect(requiresManualReview(skippedCandidate())).toBe(true);
  });
  it("a HIGH-confidence, non-photo, found factual candidate is the only case NOT flagged", () => {
    expect(requiresManualReview(foundCandidate({ field: "postcode", confidence: "HIGH" }))).toBe(false);
  });
});

describe("outcomeToInitialStatus", () => {
  it("'found' always starts life as 'pending', never approved/applied", () => {
    expect(outcomeToInitialStatus("found")).toBe("pending");
  });
  it("skip outcomes map straight through to their matching status", () => {
    expect(outcomeToInitialStatus("skipped_no_source")).toBe("skipped_no_source");
    expect(outcomeToInitialStatus("skipped_ambiguous")).toBe("skipped_ambiguous");
  });
  it("every mapped status is a legal CANDIDATE_STATUSES value", () => {
    for (const outcome of ["found", "skipped_no_source", "skipped_ambiguous"]) {
      expect(CANDIDATE_STATUSES).toContain(outcomeToInitialStatus(outcome));
    }
  });
});

describe("E: venue identity preservation across the research round-trip", () => {
  const venue = { id: VENUE_ID, name: "The Platform Tavern", city: "Southampton", postcode: null, claimed: false, claim_status: "unclaimed" };
  const inputBatch = buildResearchInputBatch("VENUE-ENRICH-001", [venue]);

  it("an output batch referencing only supplied venue_ids is valid", () => {
    const outputBatch = { batch: "VENUE-ENRICH-001", venues: [{ venue_id: VENUE_ID, candidates: [foundCandidate()] }] };
    expect(validateVenueIdsPreserved(inputBatch, outputBatch)).toEqual({ valid: true, invented: [] });
  });
  it("an output batch inventing a venue_id never supplied is rejected", () => {
    const invented = "99999999-9999-4999-8999-999999999999";
    const outputBatch = { batch: "VENUE-ENRICH-001", venues: [{ venue_id: invented, candidates: [] }] };
    const result = validateVenueIdsPreserved(inputBatch, outputBatch);
    expect(result.valid).toBe(false);
    expect(result.invented).toContain(invented);
  });
});

describe("K: canonical research output format -- validateResearchOutputBatch", () => {
  const venue = { id: VENUE_ID, name: "The Platform Tavern", city: "Southampton", postcode: null, capacity: null, claimed: false, claim_status: "unclaimed" };
  const inputBatch = buildResearchInputBatch("VENUE-ENRICH-001", [venue]);

  it("accepts the RESEARCH_CONTRACT.md example shape end to end", () => {
    const outputBatch = {
      batch: "VENUE-ENRICH-001",
      venues: [{ venue_id: VENUE_ID, candidates: [foundCandidate(), skippedCandidate()] }],
    };
    const result = validateResearchOutputBatch(inputBatch, outputBatch);
    expect(result).toEqual({ valid: true, errors: [] });
  });
  it("rejects a batch missing its own batch label", () => {
    const outputBatch = { venues: [{ venue_id: VENUE_ID, candidates: [foundCandidate()] }] };
    expect(validateResearchOutputBatch(inputBatch, outputBatch).valid).toBe(false);
  });
  it("rejects a batch with an invented venue_id", () => {
    const outputBatch = { batch: "VENUE-ENRICH-001", venues: [{ venue_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", candidates: [] }] };
    expect(validateResearchOutputBatch(inputBatch, outputBatch).valid).toBe(false);
  });
  it("rejects a batch containing one bad candidate among otherwise-good ones, and reports it", () => {
    const outputBatch = {
      batch: "VENUE-ENRICH-001",
      venues: [{ venue_id: VENUE_ID, candidates: [foundCandidate(), foundCandidate({ field: "user_id" })] }],
    };
    const result = validateResearchOutputBatch(inputBatch, outputBatch);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("user_id"))).toBe(true);
  });
});

describe("format constants", () => {
  it("SOURCE_TYPES includes exactly the seven controlled values", () => {
    expect(SOURCE_TYPES).toEqual(["official_site", "official_social", "operator_site", "ticketing_platform", "press", "other", "generated"]);
  });
  it("CONFIDENCE_LEVELS is exactly HIGH/MEDIUM/LOW, no numeric score", () => {
    expect(CONFIDENCE_LEVELS).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });
  it("CANDIDATE_STATUSES includes 'applied' as a legal value, but nothing in this module can produce it", () => {
    expect(CANDIDATE_STATUSES).toContain("applied");
    expect(["found", "skipped_no_source", "skipped_ambiguous"].map(outcomeToInitialStatus)).not.toContain("applied");
  });
});
