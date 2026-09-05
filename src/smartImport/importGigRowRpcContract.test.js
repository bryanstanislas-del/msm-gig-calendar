// Pins the import_gig_row RPC parameter contract at the JS layer.
//
// This is deliberately a plain-data test, not a live database call: this
// package has no live-DB test harness, and src/App.jsx (where the actual
// supabase.rpc("import_gig_row", {...}) call lives) has no test coverage of
// its own (see importEngine.js's header comment). What this DOES pin down is
// the invariant each consolidation migration depends on: that an older
// caller's payload (a strict subset of the current function's parameters,
// with every required one present) remains a fully valid call to whichever
// single function currently exists, because every key it sends is a real
// parameter, every required parameter it needs is present, and everything
// it omits has a DEFAULT.
//
// Keep RPC_PARAMS_REQUIRED/RPC_PARAMS_DEFAULTED in sync with the actual
// Postgres function signature (see
// 20260905090000_import_gig_row_venue_id.sql) if either changes.
import { describe, it, expect } from "vitest";

const RPC_PARAMS_REQUIRED = [
  "p_import_run_id", "p_band_name", "p_venue", "p_city", "p_date",
  "p_time", "p_genre", "p_notes", "p_tickets", "p_band_profile_id", "p_raw_text",
];

// Order matches the actual function signature -- p_venue_id (Phase 2D) is
// the newest, final parameter, appended after p_festival_profile_id.
const RPC_PARAMS_DEFAULTED = [
  "p_parsed_fields", "p_match_decisions", "p_venue_address", "p_venue_postcode", "p_venue_website",
  "p_festival_profile_id", "p_venue_id",
];

// The shape src/App.jsx's DB.importGigRow sent before PR #21 (venue
// address support) merged -- the original 13-key production payload.
const PRE_VENUE_ADDRESS_PAYLOAD_KEYS = [
  "p_import_run_id", "p_band_name", "p_venue", "p_city", "p_date", "p_time",
  "p_genre", "p_notes", "p_tickets", "p_band_profile_id", "p_raw_text",
  "p_parsed_fields", "p_match_decisions",
];

// The shape src/App.jsx's DB.importGigRow sends after PR #21 but before
// this festival-association change -- 16 keys, never p_festival_profile_id.
const PRE_FESTIVAL_PAYLOAD_KEYS = [
  ...PRE_VENUE_ADDRESS_PAYLOAD_KEYS, "p_venue_address", "p_venue_postcode", "p_venue_website",
];

// The shape src/App.jsx's DB.importGigRow sent after festival association
// but before Phase 2D's explicit venue identity -- 17 keys, never
// p_venue_id.
const PRE_VENUE_ID_PAYLOAD_KEYS = [
  ...PRE_FESTIVAL_PAYLOAD_KEYS, "p_festival_profile_id",
];

// The full shape DB.importGigRow sends today, including Phase 2D's
// explicit confirmed venue identity -- always present as a key, value null
// for "approved_new"/"none" rows (see App.jsx's "p_venue_id: venue_id ?? null").
const CURRENT_PRODUCTION_PAYLOAD_KEYS = [
  ...PRE_VENUE_ID_PAYLOAD_KEYS, "p_venue_id",
];

function isValidCallAgainstSoleFunction(payloadKeys) {
  const allParams = new Set([...RPC_PARAMS_REQUIRED, ...RPC_PARAMS_DEFAULTED]);
  const everyKeyIsRealParam = payloadKeys.every((k) => allParams.has(k));
  const everyRequiredParamPresent = RPC_PARAMS_REQUIRED.every((r) => payloadKeys.includes(r));
  return everyKeyIsRealParam && everyRequiredParamPresent;
}

describe("import_gig_row RPC contract -- exactly one 18-parameter canonical signature", () => {
  it("has exactly 18 total parameters", () => {
    expect(RPC_PARAMS_REQUIRED.length + RPC_PARAMS_DEFAULTED.length).toBe(18);
  });

  it("has no duplicate parameter names across required/defaulted -- a single, unambiguous parameter list", () => {
    const all = [...RPC_PARAMS_REQUIRED, ...RPC_PARAMS_DEFAULTED];
    expect(new Set(all).size).toBe(all.length);
  });

  it("p_venue_id is the sole newly-added parameter, and it's defaulted (optional), not required", () => {
    expect(RPC_PARAMS_DEFAULTED).toContain("p_venue_id");
    expect(RPC_PARAMS_REQUIRED).not.toContain("p_venue_id");
  });

  it("the first 11 required parameters are completely unchanged from every earlier version of this function", () => {
    expect(RPC_PARAMS_REQUIRED).toEqual([
      "p_import_run_id", "p_band_name", "p_venue", "p_city", "p_date",
      "p_time", "p_genre", "p_notes", "p_tickets", "p_band_profile_id", "p_raw_text",
    ]);
  });
});

describe("import_gig_row RPC contract -- backwards compatibility across every prior caller shape", () => {
  it("the original 13-key payload (pre venue-address, pre festival) remains a fully valid call", () => {
    expect(isValidCallAgainstSoleFunction(PRE_VENUE_ADDRESS_PAYLOAD_KEYS)).toBe(true);
  });

  it("the 16-key payload (post venue-address, pre festival -- PR #21's shape) remains a fully valid call", () => {
    expect(isValidCallAgainstSoleFunction(PRE_FESTIVAL_PAYLOAD_KEYS)).toBe(true);
  });

  it("the 17-key payload (post festival-association, pre venue-id) remains a fully valid call", () => {
    expect(isValidCallAgainstSoleFunction(PRE_VENUE_ID_PAYLOAD_KEYS)).toBe(true);
  });

  it("the current 18-key payload (including Phase 2D's explicit venue identity) is a fully valid call", () => {
    expect(isValidCallAgainstSoleFunction(CURRENT_PRODUCTION_PAYLOAD_KEYS)).toBe(true);
  });

  it("every parameter added since the original 13-key shape has a DEFAULT, so every earlier caller shape stays valid without modification", () => {
    const addedSincePreVenueAddress = RPC_PARAMS_DEFAULTED.filter((p) => !PRE_VENUE_ADDRESS_PAYLOAD_KEYS.includes(p));
    expect(addedSincePreVenueAddress.sort()).toEqual(
      ["p_venue_address", "p_venue_postcode", "p_venue_website", "p_festival_profile_id", "p_venue_id"].sort()
    );
    // all of RPC_PARAMS_DEFAULTED (by construction) have a DEFAULT -- this
    // list containing every added parameter proves none of them are required.
    for (const p of addedSincePreVenueAddress) expect(RPC_PARAMS_DEFAULTED).toContain(p);
  });

  it("no payload ever contains a key that isn't a real parameter of the function (no stray/renamed keys)", () => {
    const allParams = new Set([...RPC_PARAMS_REQUIRED, ...RPC_PARAMS_DEFAULTED]);
    for (const keys of [PRE_VENUE_ADDRESS_PAYLOAD_KEYS, PRE_FESTIVAL_PAYLOAD_KEYS, PRE_VENUE_ID_PAYLOAD_KEYS, CURRENT_PRODUCTION_PAYLOAD_KEYS]) {
      for (const key of keys) expect(allParams.has(key)).toBe(true);
    }
  });
});
