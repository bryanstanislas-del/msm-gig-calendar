// Stripe webhook signature verification (server only).
//
// Implements Stripe's documented scheme without the SDK: the
// `Stripe-Signature` header carries `t=<unix>` and one or more `v1=<hex>`
// entries; v1 = HMAC-SHA256(endpointSecret, `${t}.${rawBody}`). Verification
// MUST use the exact raw request bytes -- a re-serialised JSON body will not
// match. Timestamps outside the tolerance window are rejected (replay guard).
import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_TOLERANCE_SECONDS = 300;

export class SignatureError extends Error {}

export function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  if (typeof header !== "string") return out;
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) out.t = Number(v);
    if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) out.v1.push(v.toLowerCase());
  }
  return out;
}

export function computeSignature(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

/**
 * Returns the parsed event when the signature is valid, else throws
 * SignatureError. `rawBody` must be a Buffer or string of the exact bytes.
 */
export function verifyStripeEvent(rawBody, header, secret, { nowSeconds = Math.floor(Date.now() / 1000), tolerance = DEFAULT_TOLERANCE_SECONDS } = {}) {
  if (!secret || !secret.startsWith("whsec_")) throw new SignatureError("webhook secret not configured");
  if (rawBody == null || (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody))) throw new SignatureError("raw body unavailable");
  const { t, v1 } = parseSignatureHeader(header);
  if (t == null || v1.length === 0) throw new SignatureError("malformed signature header");
  if (Math.abs(nowSeconds - t) > tolerance) throw new SignatureError("timestamp outside tolerance");
  const expected = Buffer.from(computeSignature(secret, t, rawBody), "hex");
  const match = v1.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!match) throw new SignatureError("signature mismatch");
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  try {
    return JSON.parse(text);
  } catch {
    throw new SignatureError("body is not JSON");
  }
}

/** Reduce a verified Stripe event to the minimal fields the DB RPC needs (no card/customer data). */
export function normaliseStripeEvent(event) {
  const obj = event?.data?.object || {};
  const base = {
    id: event?.id,
    type: event?.type,
    livemode: event?.livemode === true,
    created: event?.created ?? null,
  };
  if (typeof event?.type === "string" && event.type.startsWith("checkout.session.")) {
    return {
      ...base,
      session_id: obj.id ?? null,
      payment_intent_id: typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id ?? null,
      booking_id: obj.metadata?.booking_id ?? obj.client_reference_id ?? null,
      amount_total: obj.amount_total ?? null,
      currency: obj.currency ?? null,
      payment_status: obj.payment_status ?? null,
    };
  }
  if (event?.type === "charge.refunded") {
    return {
      ...base,
      payment_intent_id: typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id ?? null,
      charge_amount: obj.amount ?? null,
      amount_refunded: obj.amount_refunded ?? null,
    };
  }
  return base;
}
