import { describe, it, expect } from "vitest";
import {
  ENRICHMENT_FIELDS,
  isBlank,
  isCapacityMissing,
  isFieldMissing,
  getMissingFields,
  hasMissingFields,
  buildVenueResearchInput,
  buildResearchInputBatch,
} from "./researchExport.js";

const baseVenue = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "The Platform Tavern",
  city: "Southampton",
  slug: "the-platform-tavern-southampton",
  user_id: "22222222-2222-4222-8222-222222222222",
  claimed: false,
  claim_status: "unclaimed",
  postcode: null,
  address: null,
  capacity: null,
  contact_email: null,
  phone: null,
  description: null,
  website: null,
  facebook: null,
  instagram: null,
  twitter: null,
  photo_url: null,
  seo_title: null,
  seo_description: null,
  seo_search_phrases: null,
  ...overrides,
});

describe("blank normalisation -- A/B/C/D", () => {
  it("A: NULL is recognised as missing", () => {
    expect(isBlank(null)).toBe(true);
    expect(isFieldMissing("postcode", null)).toBe(true);
  });
  it("B: empty string is recognised as missing", () => {
    expect(isBlank("")).toBe(true);
    expect(isFieldMissing("website", "")).toBe(true);
  });
  it("C: whitespace-only string is recognised as missing", () => {
    expect(isBlank("   ")).toBe(true);
    expect(isFieldMissing("description", "  \t \n ")).toBe(true);
  });
  it("D: a populated field is not included as missing, and is not blank", () => {
    expect(isBlank("SO14 3AB")).toBe(false);
    expect(isFieldMissing("postcode", "SO14 3AB")).toBe(false);
    const venue = baseVenue({ postcode: "SO14 3AB" });
    expect(getMissingFields(venue)).not.toContain("postcode");
    expect(buildVenueResearchInput(venue).current_values.postcode).toBe("SO14 3AB");
  });
  it("undefined behaves the same as null", () => {
    expect(isBlank(undefined)).toBe(true);
  });
});

describe("J: capacity 0 is a real value, never treated as missing", () => {
  it("isCapacityMissing distinguishes 0 from null/undefined", () => {
    expect(isCapacityMissing(0)).toBe(false);
    expect(isCapacityMissing(null)).toBe(true);
    expect(isCapacityMissing(undefined)).toBe(true);
  });
  it("a venue with capacity=0 does not list capacity as missing, and reports it in current_values", () => {
    const venue = baseVenue({ capacity: 0 });
    expect(getMissingFields(venue)).not.toContain("capacity");
    const input = buildVenueResearchInput(venue);
    expect(input.current_values.capacity).toBe(0);
    expect(input.missing_fields).not.toContain("capacity");
  });
  it("a venue with capacity=null DOES list capacity as missing", () => {
    const venue = baseVenue({ capacity: null });
    expect(getMissingFields(venue)).toContain("capacity");
  });
});

describe("E/F: venue identity is preserved exactly", () => {
  it("E: venue_id is passed through byte-for-byte, never regenerated", () => {
    const venue = baseVenue({ id: "33333333-3333-4333-8333-333333333333" });
    expect(buildVenueResearchInput(venue).venue_id).toBe("33333333-3333-4333-8333-333333333333");
  });
  it("F: name and city are preserved exactly", () => {
    const venue = baseVenue({ name: "O2 Academy Bournemouth", city: "Bournemouth" });
    const input = buildVenueResearchInput(venue);
    expect(input.name).toBe("O2 Academy Bournemouth");
    expect(input.city).toBe("Bournemouth");
  });
});

describe("G: no user/auth identity is ever exported", () => {
  it("the research input object never carries user_id or any other unlisted column", () => {
    const venue = baseVenue({ user_id: "22222222-2222-4222-8222-222222222222" });
    const input = buildVenueResearchInput(venue);
    expect(input).not.toHaveProperty("user_id");
    expect(input.current_values).not.toHaveProperty("user_id");
    // Exact key set -- nothing extra ever leaks through.
    expect(Object.keys(input).sort()).toEqual(
      ["claim_status", "claimed", "city", "current_values", "missing_fields", "name", "venue_id"].sort()
    );
  });
  it("an unexpected extra column on the venue record (e.g. a future contact-details field) is never emitted", () => {
    const venue = baseVenue({ internal_notes: "sensitive ops note", stripe_customer_id: "cus_123" });
    const input = buildVenueResearchInput(venue);
    expect(JSON.stringify(input)).not.toContain("sensitive ops note");
    expect(JSON.stringify(input)).not.toContain("cus_123");
  });
});

describe("H: claimed venue state is represented", () => {
  it("reports claimed=true / claim_status='claimed' for a claimed venue", () => {
    const venue = baseVenue({ claimed: true, claim_status: "claimed" });
    const input = buildVenueResearchInput(venue);
    expect(input.claimed).toBe(true);
    expect(input.claim_status).toBe("claimed");
  });
  it("defaults claim_status to 'unclaimed' if somehow absent, never throws", () => {
    const venue = baseVenue();
    delete venue.claim_status;
    expect(buildVenueResearchInput(venue).claim_status).toBe("unclaimed");
  });
});

describe("I: only the allowed enrichment fields are ever emitted", () => {
  it("current_values and missing_fields keys are always a subset of ENRICHMENT_FIELDS", () => {
    const venue = baseVenue({ postcode: "SO14 3AB", website: "https://example.com" });
    const input = buildVenueResearchInput(venue);
    for (const key of Object.keys(input.current_values)) expect(ENRICHMENT_FIELDS).toContain(key);
    for (const field of input.missing_fields) expect(ENRICHMENT_FIELDS).toContain(field);
  });
  it("name/city/slug are identity fields, never treated as enrichment fields", () => {
    expect(ENRICHMENT_FIELDS).not.toContain("name");
    expect(ENRICHMENT_FIELDS).not.toContain("city");
    expect(ENRICHMENT_FIELDS).not.toContain("slug");
    expect(ENRICHMENT_FIELDS).not.toContain("id");
    expect(ENRICHMENT_FIELDS).not.toContain("user_id");
    expect(ENRICHMENT_FIELDS).not.toContain("claim_status");
  });
});

describe("hasMissingFields / buildResearchInputBatch -- K: canonical format stability", () => {
  it("a fully complete venue has no missing fields and is excluded from a batch", () => {
    const complete = baseVenue(
      Object.fromEntries(ENRICHMENT_FIELDS.map((f) => [f, f === "capacity" ? 250 : `value for ${f}`]))
    );
    expect(hasMissingFields(complete)).toBe(false);
    const batch = buildResearchInputBatch("VENUE-ENRICH-001", [complete]);
    expect(batch.venues).toHaveLength(0);
  });
  it("an incomplete venue is included, with the batch/venues shape documented in RESEARCH_CONTRACT.md", () => {
    const venue = baseVenue();
    const batch = buildResearchInputBatch("VENUE-ENRICH-001", [venue]);
    expect(batch).toEqual({
      batch: "VENUE-ENRICH-001",
      venues: [buildVenueResearchInput(venue)],
    });
  });
  it("batch id is passed through unchanged, whatever format the caller uses", () => {
    expect(buildResearchInputBatch("VENUE-ENRICH-001", []).batch).toBe("VENUE-ENRICH-001");
    expect(buildResearchInputBatch("a3f1c2e0-...-uuid", []).batch).toBe("a3f1c2e0-...-uuid");
  });
  it("handles an empty/undefined venue list without throwing", () => {
    expect(buildResearchInputBatch("VENUE-ENRICH-001", []).venues).toEqual([]);
    expect(buildResearchInputBatch("VENUE-ENRICH-001", undefined).venues).toEqual([]);
  });
});
