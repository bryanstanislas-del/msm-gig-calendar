// Advertising API router -- ONE Vercel function for every ads endpoint
// (keeps the project's function count low). Server-only: every secret is
// read from the server environment inside api/_ads/config.js.
//
// ROUTING: this is deliberately a STATIC function file (api/ads.js), reached
// via the explicit vercel.json rewrite "/api/ads/:action" ->
// "/api/ads?action=:action" -- the same pattern as /gig/:slug -> /api/gig.
// A dynamic api/ads/[action].js was shadowed on a live preview by the
// "/api/(.*)" self-rewrite + "/(.*)" -> /index.html SPA fallback (both
// check:true), returning the Calendar HTML. See tests/vercelRouting.test.js.
//
//   POST /api/ads/checkout         start Stripe TEST Checkout for own hold
//   POST /api/ads/webhook          Stripe webhook (raw body, signed)
//   GET  /api/ads/delivery         public: approved creative for a placement
//   GET  /api/ads/creative         public: image of an approved, live creative
//   GET  /api/ads/click            public: signed click redirect
//   POST /api/ads/impression       public: viewable-impression beacon
//   POST /api/ads/submit-creative  advertiser: register uploaded creative
//   GET  /api/ads/report           advertiser/admin: CSV/PDF report
import { loadAdsConfig } from "./_ads/config.js";
import { createSupabaseRest } from "./_ads/supabaseRest.js";
import { createStripeClient } from "./_ads/stripeClient.js";
import { handlers } from "./_ads/handlers.js";

// Raw body is needed for Stripe signature verification.
export const config = { api: { bodyParser: false } };

/** Action from the rewrite's ?action= (or the /api/ads/<action> path); arrays/odd values rejected. */
export function resolveAction(req) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return null;
  if (typeof fromQuery === "string" && fromQuery) return fromQuery;
  const m = /^\/api\/ads\/([a-z-]+)\/?$/.exec((req.url || "").split("?")[0]);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  const action = resolveAction(req);
  const h = action && Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
  if (!h) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const cfg = loadAdsConfig(process.env);
  const deps = {
    cfg,
    supabase: createSupabaseRest(cfg, fetch),
    stripe: createStripeClient(cfg),
    now: () => new Date(),
  };
  try {
    return await h(req, res, deps);
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
}
