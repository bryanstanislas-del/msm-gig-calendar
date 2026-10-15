// Advertising API request handlers (server only). Each handler receives
// (req, res, deps) with deps = { cfg, supabase, stripe, now } so tests can
// inject labelled mocks. Routed by api/ads/[action].js.
//
// Security rules applied here (and re-enforced in the database):
//   * No service-role key, Stripe secret or tracking secret ever leaves
//     the server; responses never echo configuration values.
//   * The browser only ever sends a booking id to checkout -- the amount
//     comes from the DB snapshot. The Stripe return URL is NOT evidence of
//     payment; only a signature-verified webhook changes payment state.
//   * Clicks redirect only to a destination stored on an approved creative
//     version (never to a URL from the request) -- no open redirect.
import { verifyStripeEvent, normaliseStripeEvent, SignatureError } from "./stripeSignature.js";
import { signServeToken, verifyServeToken, clientKey, requestIp, isLikelyBot } from "./tokens.js";
import { probeImage, sha256Hex } from "./imageProbe.js";
import { buildReportCsv, buildReportPdf } from "./report.js";
import { missingConfig } from "./config.js";
import { isKnownPlacement, isSafeDestinationUrl, destinationUrlProblem, altTextProblem, UUID_RE, MAX_CREATIVE_BYTES } from "../../src/ads/validation.js";
import { londonDate } from "../../src/ads/londonTime.js";

const BUCKET = "ad-creatives-private";
const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const PATH_RE = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f-]{36}-(desktop|mobile)\.(png|jpg|jpeg|webp)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Prefer the unconsumed request stream (exact bytes, required for Stripe
// signatures) and only fall back to a helper-populated req.body. Touching
// req.body first could trigger a platform JSON parser and lose the raw
// bytes. Returns null when only a parsed object is available.
export async function readRawBody(req, limit = 256 * 1024) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  const streamAvailable = typeof req.on === "function" && req.readable !== false && !req.readableEnded;
  if (!streamAvailable) {
    const body = req.body;
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === "string") return Buffer.from(body, "utf8");
    if (body && typeof body === "object") return null; // already parsed: raw bytes lost
    return Buffer.alloc(0);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy?.(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  res.setHeader("Cache-Control", headers["Cache-Control"] || "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [k, v] of Object.entries(headers)) if (k !== "Cache-Control") res.setHeader(k, v);
  if (body === undefined) return res.status(status).end();
  return res.status(status).json(body);
}

function redirect(res, location, cache = "no-store") {
  res.setHeader("Cache-Control", cache);
  res.setHeader("Location", location);
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(302).end();
}

function bearer(req) {
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(h);
  return m ? m[1] : null;
}

function queryParam(req, name) {
  if (req.query && typeof req.query[name] === "string") return req.query[name];
  try {
    return new URL(req.url || "", "http://x").searchParams.get(name);
  } catch {
    return null;
  }
}

function notConfigured(res, missing) {
  // Names of missing variables only -- never values.
  return send(res, 503, { error: "ADS_NOT_CONFIGURED", missing });
}

/** Map a DB error to a safe client response (ADS_* codes pass through; others are generic). */
function rpcFailure(res, err) {
  const msg = String(err?.message || "");
  const m = /^(ADS_[A-Z0-9_]+)(:\s*(.{0,200}))?/.exec(msg);
  if (m) {
    const status = m[1] === "ADS_NOT_FOUND" ? 404 : m[1] === "ADS_FORBIDDEN" ? 403 : m[1] === "ADS_DISABLED" ? 503 : 409;
    return send(res, status, { error: m[1], message: m[3] || undefined });
  }
  if (err?.status === 401 || err?.status === 403) return send(res, 401, { error: "AUTH_REQUIRED" });
  return send(res, 500, { error: "SERVER_ERROR" });
}

async function readJsonBody(req, limit) {
  const raw = await readRawBody(req, limit);
  if (raw === null) return typeof req.body === "object" ? req.body : null;
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
}

// ── POST /api/ads/checkout  { booking_id } ─────────────────────────────
export async function handleCheckout(req, res, { cfg, supabase, stripe }) {
  if (req.method !== "POST") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  if (!cfg.apiEnabled) return send(res, 503, { error: "ADS_DISABLED" });
  const missing = missingConfig(cfg, ["service", "stripe"]);
  if (cfg.stripeMode === "refused-non-test") return send(res, 503, { error: "ADS_STRIPE_TEST_KEY_REQUIRED" });
  if (missing.length) return notConfigured(res, missing);
  const jwt = bearer(req);
  if (!jwt) return send(res, 401, { error: "AUTH_REQUIRED" });
  const body = await readJsonBody(req, 4096);
  const bookingId = body?.booking_id;
  if (!UUID_RE.test(bookingId || "")) return send(res, 400, { error: "BAD_REQUEST" });

  let quote;
  try {
    quote = await supabase.rpcAsUser(jwt, "ad_prepare_checkout", { p_booking_id: bookingId });
  } catch (err) {
    return rpcFailure(res, err);
  }
  if (!quote || quote.booking_id !== bookingId || !Number.isInteger(quote.total_pence) || quote.total_pence <= 0) {
    return send(res, 500, { error: "SERVER_ERROR" });
  }
  let session;
  try {
    session = await stripe.createCheckoutSession(quote);
  } catch {
    return send(res, 502, { error: "PAYMENT_PROVIDER_UNAVAILABLE" });
  }
  if (!session?.id?.startsWith("cs_test_") || session.livemode !== false || session.amount_total !== quote.total_pence
      || String(session.currency).toLowerCase() !== quote.currency || typeof session.url !== "string"
      || !session.url.startsWith("https://checkout.stripe.com/")) {
    return send(res, 502, { error: "PAYMENT_PROVIDER_MISMATCH" });
  }
  try {
    await supabase.rpcAsService("ad_record_checkout_session", {
      p_booking_id: bookingId, p_session_id: session.id, p_amount_pence: session.amount_total,
      p_currency: session.currency, p_livemode: false,
      p_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    });
  } catch (err) {
    return rpcFailure(res, err);
  }
  return send(res, 200, { url: session.url, test_mode: true });
}

// ── POST /api/ads/webhook  (Stripe, raw body, signed) ──────────────────
export async function handleWebhook(req, res, { cfg, supabase, now }) {
  if (req.method !== "POST") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  if (!cfg.apiEnabled) return send(res, 503, { error: "ADS_DISABLED" });
  const missing = missingConfig(cfg, ["service", "webhook"]);
  if (missing.length) return notConfigured(res, missing);
  let raw;
  try {
    raw = await readRawBody(req, 512 * 1024);
  } catch {
    return send(res, 413, { error: "TOO_LARGE" });
  }
  if (raw === null) return send(res, 400, { error: "RAW_BODY_UNAVAILABLE" });
  let event;
  try {
    event = verifyStripeEvent(raw, req.headers?.["stripe-signature"], cfg.stripeWebhookSecret, {
      nowSeconds: Math.floor(now().getTime() / 1000),
    });
  } catch (err) {
    if (err instanceof SignatureError) return send(res, 400, { error: "INVALID_SIGNATURE" });
    throw err;
  }
  const normalised = normaliseStripeEvent(event);
  if (!normalised.id || !normalised.type) return send(res, 400, { error: "BAD_EVENT" });
  try {
    const result = await supabase.rpcAsService("ad_apply_stripe_event", { p_event: normalised });
    return send(res, 200, { received: true, outcome: result?.outcome });
  } catch (err) {
    // Non-2xx makes Stripe retry with backoff (deferred / transient cases).
    if (/ADS_RETRY_LATER/.test(String(err?.message))) return send(res, 503, { error: "RETRY_LATER" });
    return send(res, 500, { error: "SERVER_ERROR" });
  }
}

// ── GET /api/ads/delivery?placement=wordpress-home-top ─────────────────
export async function handleDelivery(req, res, { cfg, supabase, now }) {
  if (req.method !== "GET") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const placement = queryParam(req, "placement");
  if (!isKnownPlacement(placement)) return send(res, 400, { error: "UNKNOWN_PLACEMENT" });
  const empty = { placement, label: "Advertisement", ads: [] };
  const cache = { "Cache-Control": "public, max-age=60, s-maxage=60", "Access-Control-Allow-Origin": "*" };
  // Fail closed to the house fallback whenever anything is off/missing.
  if (!cfg.apiEnabled || missingConfig(cfg, ["supabase", "tracking"]).length) return send(res, 200, empty, cache);
  let rows;
  try {
    rows = await supabase.rpcAsAnon("ad_public_delivery", { p_placement: placement });
  } catch {
    return send(res, 200, empty, { ...cache, "Cache-Control": "public, max-age=30, s-maxage=30" });
  }
  const iat = Math.floor(now().getTime() / 1000);
  const ads = (Array.isArray(rows) ? rows : []).filter((r) => UUID_RE.test(r?.creative_version_id || "")).map((r) => {
    const token = signServeToken(cfg.trackingSecret, { versionId: r.creative_version_id, placement, issuedAt: iat });
    const img = (side) => `${cfg.baseUrl}/api/ads/creative?v=${r.creative_version_id}&p=${placement}&s=${side}`;
    return {
      creative_id: r.creative_version_id,
      alt: String(r.alt_text || "").slice(0, 250),
      desktop: { url: img("desktop"), width: r.desktop?.width, height: r.desktop?.height },
      mobile: { url: img("mobile"), width: r.mobile?.width, height: r.mobile?.height },
      click_url: `${cfg.baseUrl}/api/ads/click?t=${encodeURIComponent(token)}`,
      impression_url: `${cfg.baseUrl}/api/ads/impression`,
      impression_token: token,
      serve_until: r.serve_until,
    };
  });
  return send(res, 200, { ...empty, ads }, cache);
}

// ── GET /api/ads/creative?v=&p=&s=desktop|mobile  (approved only) ──────
export async function handleCreative(req, res, { cfg, supabase }) {
  if (req.method !== "GET") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const v = queryParam(req, "v"), p = queryParam(req, "p"), s = queryParam(req, "s");
  if (!UUID_RE.test(v || "") || !isKnownPlacement(p) || !["desktop", "mobile"].includes(s)) return send(res, 400, { error: "BAD_REQUEST" });
  if (!cfg.apiEnabled || missingConfig(cfg, ["service"]).length) return send(res, 404, { error: "NOT_FOUND" });
  let look;
  try {
    look = await supabase.rpcAsService("ad_serving_lookup", { p_version_id: v, p_placement: p });
  } catch {
    return send(res, 404, { error: "NOT_FOUND" });
  }
  const path = look?.eligible ? look[`${s}_object_path`] : null;
  if (!path || !PATH_RE.test(path)) return send(res, 404, { error: "NOT_FOUND" });
  const url = await supabase.signedUrl(BUCKET, path, 600);
  if (!url) return send(res, 404, { error: "NOT_FOUND" });
  return redirect(res, url, "public, max-age=300, s-maxage=300");
}

function trackingContext(req, cfg, now) {
  const ua = req.headers?.["user-agent"] || "";
  return {
    bot: isLikelyBot(ua),
    key: clientKey(cfg.trackingSecret, { ip: requestIp(req), userAgent: ua, day: londonDate(now()) }),
  };
}

// ── GET /api/ads/click?t=<signed token> ────────────────────────────────
export async function handleClick(req, res, { cfg, supabase, now }) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const fallback = cfg.clickFallbackUrl;
  if (!cfg.apiEnabled || missingConfig(cfg, ["service", "tracking"]).length) return redirect(res, fallback);
  const tok = verifyServeToken(cfg.trackingSecret, queryParam(req, "t"), { nowSeconds: Math.floor(now().getTime() / 1000) });
  if (!tok) return redirect(res, fallback);
  let look;
  try {
    look = await supabase.rpcAsService("ad_serving_lookup", { p_version_id: tok.versionId, p_placement: tok.placement });
  } catch {
    return redirect(res, fallback);
  }
  const dest = look?.approved ? look.destination_url : null;
  if (!dest || !isSafeDestinationUrl(dest)) return redirect(res, fallback);
  if (look.eligible && req.method === "GET") {
    const ctx = trackingContext(req, cfg, now);
    if (!ctx.bot) {
      try { await supabase.rpcAsService("ad_record_metric", { p_kind: "click", p_version_id: tok.versionId, p_placement: tok.placement, p_client_key: ctx.key }); } catch { /* never block the visitor */ }
    }
  }
  return redirect(res, dest);
}

// ── POST /api/ads/impression  body {"t": token}  (sendBeacon) ──────────
export async function handleImpression(req, res, { cfg, supabase, now }) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return send(res, 204);
  if (req.method !== "POST") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  if (!cfg.apiEnabled || missingConfig(cfg, ["service", "tracking"]).length) return send(res, 204);
  const body = await readJsonBody(req, 1024).catch(() => null);
  const tok = verifyServeToken(cfg.trackingSecret, body?.t, { nowSeconds: Math.floor(now().getTime() / 1000), maxAge: 24 * 3600 });
  if (!tok) return send(res, 204);
  const ctx = trackingContext(req, cfg, now);
  if (ctx.bot) return send(res, 204);
  try {
    await supabase.rpcAsService("ad_record_metric", { p_kind: "impression", p_version_id: tok.versionId, p_placement: tok.placement, p_client_key: ctx.key });
  } catch { /* outcome intentionally not disclosed */ }
  return send(res, 204);
}

// ── POST /api/ads/submit-creative ──────────────────────────────────────
// { campaign_id, desktop_path, mobile_path, destination_url, alt_text }
export async function handleSubmitCreative(req, res, { cfg, supabase }) {
  if (req.method !== "POST") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  if (!cfg.apiEnabled) return send(res, 503, { error: "ADS_DISABLED" });
  const missing = missingConfig(cfg, ["service"]);
  if (missing.length) return notConfigured(res, missing);
  const jwt = bearer(req);
  if (!jwt) return send(res, 401, { error: "AUTH_REQUIRED" });
  const user = await supabase.getUser(jwt).catch(() => null);
  if (!user) return send(res, 401, { error: "AUTH_REQUIRED" });
  const b = await readJsonBody(req, 8192);
  if (!b || !UUID_RE.test(b.campaign_id || "")) return send(res, 400, { error: "BAD_REQUEST" });
  const destProblem = destinationUrlProblem(b.destination_url);
  if (destProblem) return send(res, 400, { error: "ADS_INVALID_DESTINATION", message: destProblem });
  const altProblem = altTextProblem(b.alt_text);
  if (altProblem) return send(res, 400, { error: "ADS_INVALID_ALT_TEXT", message: altProblem });

  const sides = {};
  for (const side of ["desktop", "mobile"]) {
    const path = b[`${side}_path`];
    const m = PATH_RE.exec(path || "");
    if (!m || m[2] !== b.campaign_id || m[3] !== side) return send(res, 400, { error: "ADS_INVALID_CREATIVE", message: `${side} path` });
    const obj = await supabase.downloadObject(BUCKET, path, MAX_CREATIVE_BYTES);
    if (!obj) return send(res, 400, { error: "ADS_INVALID_CREATIVE", message: `${side} upload not found` });
    if (obj.tooLarge) return send(res, 400, { error: "ADS_INVALID_CREATIVE", message: `${side} image larger than 1 MB` });
    const probe = probeImage(obj.buffer);
    if (!probe) return send(res, 400, { error: "ADS_INVALID_CREATIVE", message: `${side} file is not a valid PNG, JPEG or WebP image` });
    if (probe.mime !== MIME_BY_EXT[m[4]]) return send(res, 400, { error: "ADS_INVALID_CREATIVE", message: `${side} file contents do not match its extension` });
    sides[side] = { path, mime: probe.mime, bytes: obj.buffer.length, width: probe.width, height: probe.height, sha256: sha256Hex(obj.buffer) };
  }
  try {
    const versionId = await supabase.rpcAsService("ad_submit_creative_version", {
      p_actor_user_id: user.id, p_campaign_id: b.campaign_id, p_desktop: sides.desktop, p_mobile: sides.mobile,
      p_destination_url: b.destination_url, p_alt_text: b.alt_text,
    });
    return send(res, 200, { creative_version_id: versionId });
  } catch (err) {
    return rpcFailure(res, err);
  }
}

// ── GET /api/ads/report?booking_id=&from=&to=&format=csv|pdf ───────────
export async function handleReport(req, res, { cfg, supabase }) {
  if (req.method !== "GET") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  if (!cfg.apiEnabled) return send(res, 503, { error: "ADS_DISABLED" });
  const missing = missingConfig(cfg, ["supabase"]);
  if (missing.length) return notConfigured(res, missing);
  const jwt = bearer(req);
  if (!jwt) return send(res, 401, { error: "AUTH_REQUIRED" });
  const bookingId = queryParam(req, "booking_id");
  const from = queryParam(req, "from") || null;
  const to = queryParam(req, "to") || null;
  const format = queryParam(req, "format") || "csv";
  if (!UUID_RE.test(bookingId || "") || (from && !ISO_DATE_RE.test(from)) || (to && !ISO_DATE_RE.test(to)) || !["csv", "pdf"].includes(format)) {
    return send(res, 400, { error: "BAD_REQUEST" });
  }
  let report;
  try {
    report = await supabase.rpcAsUser(jwt, "ad_report", { p_booking_id: bookingId, p_from: from, p_to: to });
  } catch (err) {
    return rpcFailure(res, err);
  }
  const name = `msm-ad-report-${bookingId}-${report.from}-to-${report.to}.${format}`;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.status(200).send(buildReportCsv(report));
  }
  res.setHeader("Content-Type", "application/pdf");
  return res.status(200).send(buildReportPdf(report));
}

export const handlers = {
  checkout: handleCheckout,
  webhook: handleWebhook,
  delivery: handleDelivery,
  creative: handleCreative,
  click: handleClick,
  impression: handleImpression,
  "submit-creative": handleSubmitCreative,
  report: handleReport,
};
