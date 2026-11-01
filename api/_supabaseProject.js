// Server-side Supabase project selection shared by the public routes
// (api/gig.js, api/og.js, api/sitemap.js) and the ads API config. CommonJS so
// the require()-based routes can use it. Mirrors src/supabaseConfig.js: a
// URL and its anon key must come from the SAME variable pair, and
// VITE_SUPABASE_URL / SUPABASE_URL must agree when both are set -- otherwise
// an error is returned instead of silently mixing projects. With no URL at
// all, the public routes keep their existing production fallback unchanged.
const PRODUCTION_SUPABASE_URL = "https://fmlaaiolqwknowhtdeue.supabase.co";

const clean = (v) => (typeof v === "string" ? v.trim() : "");

function resolveServerSupabase(env = {}, { fallbackToProduction = true } = {}) {
  const viteUrl = clean(env.VITE_SUPABASE_URL), plainUrl = clean(env.SUPABASE_URL);
  const viteKey = clean(env.VITE_SUPABASE_ANON_KEY), plainKey = clean(env.SUPABASE_ANON_KEY);
  if (viteUrl && plainUrl && viteUrl !== plainUrl) {
    return { error: "VITE_SUPABASE_URL and SUPABASE_URL point at different Supabase projects" };
  }
  if (viteUrl && plainUrl && viteKey && plainKey && viteKey !== plainKey) {
    return { error: "VITE_SUPABASE_ANON_KEY and SUPABASE_ANON_KEY differ for the same project" };
  }
  const url = viteUrl || plainUrl;
  if (!url) {
    return fallbackToProduction
      ? { url: PRODUCTION_SUPABASE_URL, anonKey: viteKey || plainKey, source: "production" }
      : { url: "", anonKey: "", source: "missing" };
  }
  let anonKey;
  if (viteUrl && viteKey) anonKey = viteKey;
  else if (plainUrl && plainKey) anonKey = plainKey;
  else if (url === PRODUCTION_SUPABASE_URL) anonKey = viteKey || plainKey;         // production: unchanged behaviour
  else return { error: "Supabase override URL has no anon key from the same variable pair (refusing to mix projects)" };
  return { url, anonKey, source: url === PRODUCTION_SUPABASE_URL ? "production" : "override" };
}

module.exports = { resolveServerSupabase, PRODUCTION_SUPABASE_URL };
