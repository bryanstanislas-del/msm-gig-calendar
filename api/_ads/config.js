// Server-only configuration for the advertising API. Secrets are read from
// the Vercel server environment and NEVER from VITE_* variables (those are
// bundled into the browser). See docs/ads/README.md for the full list.

import supabaseProject from "../_supabaseProject.js";

export function loadAdsConfig(env = process.env) {
  // Same project-selection rule as the browser and the public routes; no
  // production fallback here (missing = not configured), and a mixed pair is
  // reported as a configuration error rather than used.
  const project = supabaseProject.resolveServerSupabase(env, { fallbackToProduction: false });
  const stripeKey = env.STRIPE_SECRET_KEY || "";
  let stripeMode = "missing";
  if (/^(sk|rk)_test_/.test(stripeKey)) stripeMode = "test";
  else if (stripeKey) stripeMode = "refused-non-test"; // phase 1 is TEST ONLY
  return {
    apiEnabled: env.ADS_API_ENABLED === "true",
    baseUrl: (env.ADS_PUBLIC_BASE_URL || env.VITE_BASE_URL || "https://calendar.musicscenemagazine.co.uk").replace(/\/+$/, ""),
    supabaseUrl: project.error ? "" : project.url.replace(/\/+$/, ""),
    anonKey: project.error ? "" : project.anonKey,
    supabaseProjectError: project.error || "",
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    stripeSecretKey: stripeMode === "test" ? stripeKey : "",
    stripeMode,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    trackingSecret: env.ADS_TRACKING_SECRET || "",
    clickFallbackUrl: env.ADS_CLICK_FALLBACK_URL || "https://musicscenemagazine.co.uk/",
    // Advertising email (outbox worker). OFF unless ADS_EMAIL_ENABLED=true AND
    // the DB switch ads_email_enabled is on. No default sender: ADS_EMAIL_FROM
    // must be set explicitly (api/notify.js's onboarding@resend.dev default is
    // deliberately NOT reused). RESEND_API_KEY is the existing provider key name.
    emailEnabled: env.ADS_EMAIL_ENABLED === "true",
    workerSecret: env.ADS_WORKER_SECRET || "",
    resendApiKey: env.RESEND_API_KEY || "",
    emailFrom: env.ADS_EMAIL_FROM || "",
    adminAlertEmail: env.ADS_ADMIN_ALERT_EMAIL || "",
    resendWebhookSecret: env.ADS_RESEND_WEBHOOK_SECRET || "",
  };
}

const REQUIREMENTS = {
  supabase: ["supabaseUrl", "anonKey"],
  service: ["supabaseUrl", "anonKey", "serviceKey"],
  stripe: ["stripeSecretKey"],
  webhook: ["stripeWebhookSecret"],
  tracking: ["trackingSecret"],
  worker: ["workerSecret"],
  email: ["resendApiKey", "emailFrom"],
  emailEvents: ["resendWebhookSecret"],
};
const ENV_NAMES = {
  supabaseUrl: "SUPABASE_URL", anonKey: "SUPABASE_ANON_KEY", serviceKey: "SUPABASE_SERVICE_ROLE_KEY",
  stripeSecretKey: "STRIPE_SECRET_KEY (sk_test_... only)", stripeWebhookSecret: "STRIPE_WEBHOOK_SECRET",
  trackingSecret: "ADS_TRACKING_SECRET (>= 32 chars)",
  workerSecret: "ADS_WORKER_SECRET (>= 32 chars)", resendApiKey: "RESEND_API_KEY", emailFrom: "ADS_EMAIL_FROM",
  resendWebhookSecret: "ADS_RESEND_WEBHOOK_SECRET (whsec_...)",
};

/** Names of missing env vars for the given capability groups (names only, never values). */
export function missingConfig(cfg, groups) {
  const missing = new Set();
  if (cfg.supabaseProjectError && groups.some((g) => (REQUIREMENTS[g] || []).includes("supabaseUrl"))) {
    missing.add(`SUPABASE_URL/VITE_SUPABASE_URL (${cfg.supabaseProjectError})`);
  }
  for (const g of groups) {
    for (const key of REQUIREMENTS[g] || []) {
      const v = cfg[key];
      if (!v || ((key === "trackingSecret" || key === "workerSecret") && v.length < 32)) missing.add(ENV_NAMES[key]);
    }
  }
  return [...missing];
}
