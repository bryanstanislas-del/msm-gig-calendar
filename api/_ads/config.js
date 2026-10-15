// Server-only configuration for the advertising API. Secrets are read from
// the Vercel server environment and NEVER from VITE_* variables (those are
// bundled into the browser). See docs/ads/README.md for the full list.

export function loadAdsConfig(env = process.env) {
  const stripeKey = env.STRIPE_SECRET_KEY || "";
  let stripeMode = "missing";
  if (/^(sk|rk)_test_/.test(stripeKey)) stripeMode = "test";
  else if (stripeKey) stripeMode = "refused-non-test"; // phase 1 is TEST ONLY
  return {
    apiEnabled: env.ADS_API_ENABLED === "true",
    baseUrl: (env.ADS_PUBLIC_BASE_URL || env.VITE_BASE_URL || "https://calendar.musicscenemagazine.co.uk").replace(/\/+$/, ""),
    supabaseUrl: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, ""),
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "",
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    stripeSecretKey: stripeMode === "test" ? stripeKey : "",
    stripeMode,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    trackingSecret: env.ADS_TRACKING_SECRET || "",
    clickFallbackUrl: env.ADS_CLICK_FALLBACK_URL || "https://musicscenemagazine.co.uk/",
  };
}

const REQUIREMENTS = {
  supabase: ["supabaseUrl", "anonKey"],
  service: ["supabaseUrl", "anonKey", "serviceKey"],
  stripe: ["stripeSecretKey"],
  webhook: ["stripeWebhookSecret"],
  tracking: ["trackingSecret"],
};
const ENV_NAMES = {
  supabaseUrl: "SUPABASE_URL", anonKey: "SUPABASE_ANON_KEY", serviceKey: "SUPABASE_SERVICE_ROLE_KEY",
  stripeSecretKey: "STRIPE_SECRET_KEY (sk_test_... only)", stripeWebhookSecret: "STRIPE_WEBHOOK_SECRET",
  trackingSecret: "ADS_TRACKING_SECRET (>= 32 chars)",
};

/** Names of missing env vars for the given capability groups (names only, never values). */
export function missingConfig(cfg, groups) {
  const missing = new Set();
  for (const g of groups) {
    for (const key of REQUIREMENTS[g] || []) {
      const v = cfg[key];
      if (!v || (key === "trackingSecret" && v.length < 32)) missing.add(ENV_NAMES[key]);
    }
  }
  return [...missing];
}
