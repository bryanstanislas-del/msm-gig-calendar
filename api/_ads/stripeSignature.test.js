// Signature tests use a locally generated FAKE secret and locally signed
// payloads. They prove our verification code; they are NOT evidence that a
// real Stripe account/webhook is configured or working.
import { describe, it, expect } from "vitest";
import { verifyStripeEvent, computeSignature, normaliseStripeEvent, SignatureError } from "./stripeSignature.js";

const SECRET = "whsec_LOCAL_FAKE_TEST_SECRET_not_a_real_stripe_secret";
const body = JSON.stringify({ id: "evt_local_1", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_abc", metadata: { booking_id: "b" } } } });
const now = 1_790_000_000;
const header = (t, sig) => `t=${t},v1=${sig}`;

describe("Stripe signature verification (local fixtures)", () => {
  it("accepts a valid signature on the exact raw bytes", () => {
    const ev = verifyStripeEvent(Buffer.from(body), header(now, computeSignature(SECRET, now, body)), SECRET, { nowSeconds: now });
    expect(ev.id).toBe("evt_local_1");
  });
  it("accepts when any of several v1 signatures matches (secret rotation)", () => {
    const h = `t=${now},v1=${"0".repeat(64)},v1=${computeSignature(SECRET, now, body)}`;
    expect(verifyStripeEvent(body, h, SECRET, { nowSeconds: now }).id).toBe("evt_local_1");
  });
  it("rejects a re-serialised (non-raw) body", () => {
    const sig = computeSignature(SECRET, now, body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(() => verifyStripeEvent(reserialised, header(now, sig), SECRET, { nowSeconds: now })).toThrow(SignatureError);
  });
  it("rejects tampering, wrong secret, stale or future timestamps, malformed header", () => {
    const sig = computeSignature(SECRET, now, body);
    expect(() => verifyStripeEvent(body.replace("false", "true"), header(now, sig), SECRET, { nowSeconds: now })).toThrow(/mismatch/);
    expect(() => verifyStripeEvent(body, header(now, computeSignature("whsec_other", now, body)), SECRET, { nowSeconds: now })).toThrow(/mismatch/);
    expect(() => verifyStripeEvent(body, header(now - 301, computeSignature(SECRET, now - 301, body)), SECRET, { nowSeconds: now })).toThrow(/tolerance/);
    expect(() => verifyStripeEvent(body, header(now + 301, computeSignature(SECRET, now + 301, body)), SECRET, { nowSeconds: now })).toThrow(/tolerance/);
    expect(() => verifyStripeEvent(body, "v1=abc", SECRET, { nowSeconds: now })).toThrow(/malformed/);
    expect(() => verifyStripeEvent(body, header(now, sig), "", { nowSeconds: now })).toThrow(/not configured/);
    expect(() => verifyStripeEvent({ parsed: true }, header(now, sig), SECRET, { nowSeconds: now })).toThrow(/raw body/);
  });
});

describe("event normalisation keeps only the minimal fields", () => {
  it("checkout session", () => {
    const n = normaliseStripeEvent({ id: "evt_1", type: "checkout.session.completed", livemode: false, created: 1,
      data: { object: { id: "cs_test_1", payment_intent: "pi_1", metadata: { booking_id: "B" }, amount_total: 3000, currency: "gbp",
        payment_status: "paid", customer_details: { email: "private@example.invalid" } } } });
    expect(n).toEqual({ id: "evt_1", type: "checkout.session.completed", livemode: false, created: 1, session_id: "cs_test_1",
      payment_intent_id: "pi_1", booking_id: "B", amount_total: 3000, currency: "gbp", payment_status: "paid" });
    expect(JSON.stringify(n)).not.toContain("private@");
  });
  it("charge.refunded", () => {
    const n = normaliseStripeEvent({ id: "evt_2", type: "charge.refunded", livemode: false, data: { object: { payment_intent: "pi_1", amount: 3000, amount_refunded: 3000, billing_details: { name: "X" } } } });
    expect(n).toMatchObject({ payment_intent_id: "pi_1", amount_refunded: 3000, charge_amount: 3000 });
    expect(JSON.stringify(n)).not.toContain("billing");
  });
});
