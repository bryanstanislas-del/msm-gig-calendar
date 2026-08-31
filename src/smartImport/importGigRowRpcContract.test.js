// Pins the import_gig_row RPC parameter contract at the JS layer.
//
// This is deliberately a plain-data test, not a live database call: this
// package has no live-DB test harness, and src/App.jsx (where the actual
// supabase.rpc("import_gig_row", {...}) call lives) has no test coverage
// of its own (see importEngine.js's header comment). What this DOES pin
// down is the invariant the consolidation migration
// (20260831130000_import_gig_row_drop_obsolete_overloads.sql) depends on:
// that the CURRENT production frontend's existing 13-key RPC payload
// (main, before PR #21 merges -- it never sends the three new venue_*
// keys at all) is still a fully valid call to the single, consolidated
// public.import_gig_row function, because every key it sends is a real
// parameter of that function, every one of that function's required
// (non-default) parameters is present, and the parameters it omits are
// exactly the ones with a DEFAULT NULL.
//
// Keep RPC_PARAMS_REQUIRED/RPC_PARAMS_DEFAULTED in sync with the actual
// Postgres function signature (see the migration file) if either changes.
import { describe, it, expect } from "vitest";

const RPC_PARAMS_REQUIRED = [
  "p_import_run_id", "p_band_name", "p_venue", "p_city", "p_date",
  "p_time", "p_genre", "p_notes", "p_tickets", "p_band_profile_id", "p_raw_text",
];

const RPC_PARAMS_DEFAULTED = [
  "p_parsed_fields", "p_match_decisions", "p_venue_address", "p_venue_postcode", "p_venue_website",
];

// Exactly the keys src/App.jsx's DB.importGigRow sends today, on main,
// before PR #21 merges -- see the "async importGigRow(...)" RPC call.
const CURRENT_PRODUCTION_PAYLOAD_KEYS = [
  "p_import_run_id", "p_band_name", "p_venue", "p_city", "p_date", "p_time",
  "p_genre", "p_notes", "p_tickets", "p_band_profile_id", "p_raw_text",
  "p_parsed_fields", "p_match_decisions",
];

describe("import_gig_row RPC contract -- backwards compatibility with the current 13-key production payload", () => {
  it("every key the current production frontend sends is a real parameter of the consolidated function", () => {
    const allParams = [...RPC_PARAMS_REQUIRED, ...RPC_PARAMS_DEFAULTED];
    for (const key of CURRENT_PRODUCTION_PAYLOAD_KEYS) {
      expect(allParams).toContain(key);
    }
  });

  it("every required (non-default) parameter is present in the current production payload -- nothing mandatory is missing", () => {
    for (const required of RPC_PARAMS_REQUIRED) {
      expect(CURRENT_PRODUCTION_PAYLOAD_KEYS).toContain(required);
    }
  });

  it("the three new venue_* parameters are exactly the ones the current production payload omits, and all three have a DEFAULT", () => {
    const omitted = RPC_PARAMS_DEFAULTED.filter((p) => !CURRENT_PRODUCTION_PAYLOAD_KEYS.includes(p));
    expect(omitted.sort()).toEqual(["p_venue_address", "p_venue_postcode", "p_venue_website"].sort());
  });

  it("the payload never contains a key that isn't a real parameter of the function (no stray/renamed keys)", () => {
    const allParams = new Set([...RPC_PARAMS_REQUIRED, ...RPC_PARAMS_DEFAULTED]);
    for (const key of CURRENT_PRODUCTION_PAYLOAD_KEYS) {
      expect(allParams.has(key)).toBe(true);
    }
  });
});
