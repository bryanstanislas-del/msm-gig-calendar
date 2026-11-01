// Single source of truth for WHICH Supabase project the browser app uses.
// Pure (no import.meta) so it can be unit-tested; src/supabaseClient.js is the
// ONLY place that creates the browser client from it, and every screen
// (Calendar, auth/session, admin, advertising) imports that one client.
//
// Production values are the public project URL and its public anon key (RLS
// protects all data). An isolated PREVIEW may override BOTH via build-time
// VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. A partial or malformed override
// is REFUSED (throws) instead of silently mixing projects.

export const PRODUCTION_SUPABASE_URL = "https://fmlaaiolqwknowhtdeue.supabase.co";
export const PRODUCTION_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtbGFhaW9scXdrbm93aHRkZXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTk2MTUsImV4cCI6MjA5NjMzNTYxNX0.0RyMAC4JVxGSErcAzTZaaWkWtzSpGpz8laaFye7r2Go";

const HOSTED_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/;

export class SupabaseConfigError extends Error {}

/** { url, anonKey, source: "production" | "override", ref } from build-time env. */
export function resolveBrowserSupabase(env = {}) {
  const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === "string" ? env.VITE_SUPABASE_ANON_KEY.trim() : "";
  if (!url && !anonKey) {
    return { url: PRODUCTION_SUPABASE_URL, anonKey: PRODUCTION_SUPABASE_ANON_KEY, source: "production", ref: HOSTED_URL.exec(PRODUCTION_SUPABASE_URL)[1] };
  }
  if (!url || !anonKey) {
    throw new SupabaseConfigError(`Partial Supabase override: ${url ? "VITE_SUPABASE_ANON_KEY" : "VITE_SUPABASE_URL"} is missing. Set both or neither (refusing to mix projects).`);
  }
  const hosted = HOSTED_URL.exec(url);
  if (!hosted && !LOCAL_URL.test(url)) throw new SupabaseConfigError("VITE_SUPABASE_URL must be https://<project-ref>.supabase.co (or a local http://localhost URL)");
  if (url === PRODUCTION_SUPABASE_URL && anonKey !== PRODUCTION_SUPABASE_ANON_KEY) {
    throw new SupabaseConfigError("VITE_SUPABASE_ANON_KEY does not belong to the production URL it is paired with (refusing to mix projects).");
  }
  return { url, anonKey, source: url === PRODUCTION_SUPABASE_URL ? "production" : "override", ref: hosted ? hosted[1] : "local" };
}
