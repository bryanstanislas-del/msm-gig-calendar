import { describe, it, expect } from "vitest";
import supabaseProject from "./_supabaseProject.js";
import { loadAdsConfig, missingConfig } from "./_ads/config.js";
import { PRODUCTION_SUPABASE_URL as BROWSER_PROD } from "../src/supabaseConfig.js";

const { resolveServerSupabase, PRODUCTION_SUPABASE_URL } = supabaseProject;
const STAGING = "https://abcdefghijklmnopqrst.supabase.co";

describe("server Supabase project selection (public routes + ads API)", () => {
  it("server and browser agree on the production project", () => {
    expect(PRODUCTION_SUPABASE_URL).toBe(BROWSER_PROD);
  });
  it("production fallback unchanged for the public routes", () => {
    expect(resolveServerSupabase({ SUPABASE_ANON_KEY: "k" })).toEqual({ url: PRODUCTION_SUPABASE_URL, anonKey: "k", source: "production" });
    expect(resolveServerSupabase({ VITE_SUPABASE_URL: PRODUCTION_SUPABASE_URL, SUPABASE_ANON_KEY: "k" }).anonKey).toBe("k");
  });
  it("a complete pair (either naming) selects the override", () => {
    expect(resolveServerSupabase({ VITE_SUPABASE_URL: STAGING, VITE_SUPABASE_ANON_KEY: "s" })).toMatchObject({ url: STAGING, anonKey: "s", source: "override" });
    expect(resolveServerSupabase({ SUPABASE_URL: STAGING, SUPABASE_ANON_KEY: "s" })).toMatchObject({ url: STAGING, anonKey: "s" });
    expect(resolveServerSupabase({ SUPABASE_URL: STAGING, VITE_SUPABASE_URL: STAGING, SUPABASE_ANON_KEY: "s", VITE_SUPABASE_ANON_KEY: "s" }).url).toBe(STAGING);
  });
  it("mixed or partial overrides are refused", () => {
    expect(resolveServerSupabase({ VITE_SUPABASE_URL: STAGING, SUPABASE_URL: PRODUCTION_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: "s" }).error).toMatch(/different Supabase projects/);
    expect(resolveServerSupabase({ VITE_SUPABASE_URL: STAGING, SUPABASE_ANON_KEY: "prod-key" }).error).toMatch(/same variable pair/);
    expect(resolveServerSupabase({ SUPABASE_URL: STAGING, VITE_SUPABASE_ANON_KEY: "x" }).error).toMatch(/same variable pair/);
  });
  it("ads API reports a mixed configuration as not configured (never uses it)", () => {
    const cfg = loadAdsConfig({ VITE_SUPABASE_URL: STAGING, SUPABASE_URL: PRODUCTION_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: "s", SUPABASE_SERVICE_ROLE_KEY: "x" });
    expect(cfg.supabaseUrl).toBe("");
    expect(missingConfig(cfg, ["supabase"])[0]).toMatch(/different Supabase projects/);
    expect(loadAdsConfig({ SUPABASE_URL: STAGING, SUPABASE_ANON_KEY: "s" }).supabaseUrl).toBe(STAGING);
    expect(loadAdsConfig({}).supabaseUrl).toBe("");   // no production fallback for the ads API
  });
});
