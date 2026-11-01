import { describe, it, expect } from "vitest";
import { resolveBrowserSupabase, PRODUCTION_SUPABASE_URL, PRODUCTION_SUPABASE_ANON_KEY, SupabaseConfigError } from "./supabaseConfig.js";

// Synthetic values only -- no real staging project or key is used here.
const STAGING = "https://abcdefghijklmnopqrst.supabase.co";
const FAKE_KEY = "LOCAL-FAKE-anon-key";

describe("browser Supabase project selection", () => {
  it("no override -> production, exactly as before", () => {
    expect(resolveBrowserSupabase({})).toMatchObject({ url: PRODUCTION_SUPABASE_URL, anonKey: PRODUCTION_SUPABASE_ANON_KEY, source: "production" });
    expect(resolveBrowserSupabase({ VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "  " }).source).toBe("production");
  });
  it("complete override -> that project for everything", () => {
    expect(resolveBrowserSupabase({ VITE_SUPABASE_URL: STAGING, VITE_SUPABASE_ANON_KEY: FAKE_KEY }))
      .toEqual({ url: STAGING, anonKey: FAKE_KEY, source: "override", ref: "abcdefghijklmnopqrst" });
  });
  it("partial override is refused, never mixed with production", () => {
    expect(() => resolveBrowserSupabase({ VITE_SUPABASE_URL: STAGING })).toThrow(/Partial Supabase override: VITE_SUPABASE_ANON_KEY is missing/);
    expect(() => resolveBrowserSupabase({ VITE_SUPABASE_ANON_KEY: FAKE_KEY })).toThrow(/Partial Supabase override: VITE_SUPABASE_URL is missing/);
    expect(() => resolveBrowserSupabase({ VITE_SUPABASE_URL: STAGING })).toThrow(SupabaseConfigError);
  });
  it("malformed URL or a foreign key on the production URL is refused", () => {
    expect(() => resolveBrowserSupabase({ VITE_SUPABASE_URL: "https://evil.example.com", VITE_SUPABASE_ANON_KEY: FAKE_KEY })).toThrow(/must be https/);
    expect(() => resolveBrowserSupabase({ VITE_SUPABASE_URL: PRODUCTION_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: FAKE_KEY })).toThrow(/does not belong to the production URL/);
    expect(resolveBrowserSupabase({ VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: FAKE_KEY }).ref).toBe("local");
  });
});
