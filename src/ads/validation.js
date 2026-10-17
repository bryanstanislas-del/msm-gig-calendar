/**
 * Advertising phase 1 -- shared, dependency-free validation rules.
 *
 * Imported by both the browser portal (early, friendly feedback) and the
 * server endpoints in api/ads (authoritative together with the database,
 * which re-checks the same rules in ads_internal.is_safe_destination and
 * ad_submit_creative_version). Never import secrets into this file.
 */

export const PLACEMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Placements that exist in phase 1. Only wordpress-home-top is sold; the
// others are mapped so the WordPress adapter can ask and get a house fallback.
export const KNOWN_PLACEMENTS = Object.freeze([
  "wordpress-home-top",
  "wordpress-home-middle",
  "wordpress-home-bottom",
]);

export const ALLOWED_CREATIVE_MIME = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
export const MAX_CREATIVE_BYTES = 1048576;

function isIpLiteral(host) {
  if (/^\[.*\]$/.test(host)) return true; // IPv6 literal
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host);
}

/**
 * Destination ("click-through") URL rule. Returns null when valid, or a
 * human-readable reason. https only; no credentials; no whitespace/control
 * characters; a dotted public-looking hostname (no IP literal, no
 * localhost); max 2048 characters.
 */
export function destinationUrlProblem(value) {
  if (typeof value !== "string" || value.length === 0) return "Enter a destination URL.";
  if (value.length > 2048) return "Destination URL is too long (max 2048 characters).";
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f<>"\\]/.test(value)) return "Destination URL contains invalid characters.";
  if (!/^https:\/\//i.test(value)) return "Destination URL must start with https://";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "Destination URL is not a valid URL.";
  }
  if (url.protocol !== "https:") return "Destination URL must use https.";
  if (url.username || url.password) return "Destination URL must not contain a username or password.";
  const host = url.hostname.toLowerCase();
  if (!host || isIpLiteral(host)) return "Destination URL must use a domain name, not an IP address.";
  if (host === "localhost" || host.endsWith(".localhost")) return "Destination URL must be a public website.";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/.test(host)) {
    return "Destination URL must use a normal public domain name.";
  }
  return null;
}

export function isSafeDestinationUrl(value) {
  return destinationUrlProblem(value) === null;
}

export function altTextProblem(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < 3) return "Describe the advert in at least 3 characters (read aloud by screen readers).";
  if (v.length > 250) return "Alt text must be 250 characters or fewer.";
  return null;
}

export function isKnownPlacement(value) {
  return typeof value === "string" && KNOWN_PLACEMENTS.includes(value);
}

/** Client-side pre-check of a File before upload (server re-verifies bytes). */
export function creativeFileProblem(file, { width, height } = {}, expected) {
  if (!file) return "Choose an image.";
  if (!ALLOWED_CREATIVE_MIME.includes(file.type)) return "Use a PNG, JPEG or WebP image (no SVG/GIF).";
  if (file.size > MAX_CREATIVE_BYTES) return "Image must be 1 MB or smaller.";
  if (expected && (width !== expected.width || height !== expected.height)) {
    return `Image must be exactly ${expected.width}x${expected.height} pixels (this one is ${width}x${height}).`;
  }
  return null;
}

export function extensionForMime(mime) {
  return { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime] || null;
}
