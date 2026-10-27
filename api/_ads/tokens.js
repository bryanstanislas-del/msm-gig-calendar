// Signed serve tokens + privacy-minimised client keys (server only).
//
// A serve token binds (creative_version_id, placement, issued-at) with an
// HMAC under ADS_TRACKING_SECRET. Impression/click endpoints only accept
// server-issued tokens, so a third party cannot attribute arbitrary
// creative/placement pairs; the database additionally re-checks that the
// version is approved and currently eligible at that placement.
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLACEMENT_RE, UUID_RE } from "../../src/ads/validation.js";

export const TOKEN_MAX_AGE_SECONDS = 48 * 3600;

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function mac(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest();
}

export function signServeToken(secret, { versionId, placement, issuedAt = Math.floor(Date.now() / 1000) }) {
  if (!secret || secret.length < 32) throw new Error("ADS_TRACKING_SECRET missing or too short");
  if (!UUID_RE.test(versionId) || !PLACEMENT_RE.test(placement)) throw new Error("bad token fields");
  const payload = `1.${versionId}.${placement}.${issuedAt}`;
  return `${b64url(payload)}.${b64url(mac(secret, payload))}`;
}

/** Returns {versionId, placement, issuedAt} or null. Never throws on bad input. */
export function verifyServeToken(secret, token, { nowSeconds = Math.floor(Date.now() / 1000), maxAge = TOKEN_MAX_AGE_SECONDS } = {}) {
  if (!secret || typeof token !== "string" || token.length > 400) return null;
  const [p, s] = token.split(".");
  if (!p || !s) return null;
  let payload;
  try {
    payload = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = mac(secret, payload);
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "1") return null;
  const [, versionId, placement, iat] = parts;
  const issuedAt = Number(iat);
  if (!UUID_RE.test(versionId) || !PLACEMENT_RE.test(placement) || !Number.isInteger(issuedAt)) return null;
  if (issuedAt > nowSeconds + 300 || nowSeconds - issuedAt > maxAge) return null;
  return { versionId, placement, issuedAt };
}

/**
 * Daily-rotating, keyed hash of the requester (never stored raw). The same
 * visitor maps to a different key each London day, and the key is useless
 * without the server secret.
 */
export function clientKey(secret, { ip, userAgent, day }) {
  return createHmac("sha256", secret).update(`${day}|${ip || ""}|${userAgent || ""}`).digest("hex");
}

export function requestIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "";
}

const BOT_RE = /(bot|crawl|spider|slurp|scrape|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|httpclient|okhttp|java\/|go-http|axios|node-fetch|monitor|uptime|pingdom|phantomjs|selenium|puppeteer|playwright)/i;

export function isLikelyBot(userAgent) {
  if (typeof userAgent !== "string" || userAgent.length < 10) return true;
  return BOT_RE.test(userAgent);
}
