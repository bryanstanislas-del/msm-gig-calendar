// Resend webhooks are signed with Svix: headers svix-id, svix-timestamp,
// svix-signature ("v1,<base64>" entries, space separated); signed content is
// `${id}.${timestamp}.${rawBody}`; key = base64 of the secret after "whsec_".
import crypto from "node:crypto";

export const SVIX_TOLERANCE_SECONDS = 300;
export class SvixSignatureError extends Error {}

export function svixSign(secret, id, timestamp, rawBody) {
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  return crypto.createHmac("sha256", key).update(`${id}.${timestamp}.`).update(rawBody).digest("base64");
}

export function verifySvix(rawBody, headers, secret, { nowSeconds = Math.floor(Date.now() / 1000), tolerance = SVIX_TOLERANCE_SECONDS } = {}) {
  if (!/^whsec_[A-Za-z0-9+/=]{16,}$/.test(secret || "")) throw new SvixSignatureError("bad secret");
  if (!Buffer.isBuffer(rawBody)) throw new SvixSignatureError("raw body required");
  const h = (k) => { const v = headers?.[k]; return Array.isArray(v) ? null : v; };
  const id = h("svix-id"), ts = h("svix-timestamp"), sigs = h("svix-signature");
  if (!id || !/^[A-Za-z0-9_-]{6,200}$/.test(id) || !/^\d{1,12}$/.test(ts || "") || !sigs) throw new SvixSignatureError("missing headers");
  if (Math.abs(nowSeconds - Number(ts)) > tolerance) throw new SvixSignatureError("timestamp outside tolerance");
  const expected = Buffer.from(svixSign(secret, id, ts, rawBody));
  const ok = String(sigs).split(" ").some((entry) => {
    const [ver, sig] = entry.split(",");
    if (ver !== "v1" || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
  if (!ok) throw new SvixSignatureError("signature mismatch");
  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); } catch { throw new SvixSignatureError("bad json"); }
  return { id, event };
}
