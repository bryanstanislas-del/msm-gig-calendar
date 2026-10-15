// Stripe client tests. Nothing here reaches Stripe: the "real SDK" test runs
// the official stripe-node client over a LABELLED FAKE HTTP transport
// (MOCK_fetch) and a fake, local-only test key, so it proves what our code
// would send -- not that any Stripe account/key works.
import { describe, it, expect, vi } from "vitest";
import Stripe from "stripe";
import { buildCheckoutParams, createStripeClient, STRIPE_API_VERSION, INTEGRATION_IDENTIFIER, checkoutIdempotencyKey } from "./stripeClient.js";

const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const quote = { booking_id: B, total_pence: 3000, currency: "gbp", is_test: true, product_name: "TEST ONLY - Homepage top banner (per day)",
  start_date: "2026-10-24", end_date: "2026-10-26", hold_expires_at: "2026-10-20T13:00:00Z" };
const cfg = { stripeMode: "test", stripeSecretKey: "sk_test_LOCAL_FAKE_not_a_real_key", baseUrl: "https://preview.example.test" };

describe("checkout session params", () => {
  const p = buildCheckoutParams({ quote, baseUrl: cfg.baseUrl });
  it("uses dynamic payment methods (no allowlist) and the integration identifier", () => {
    expect(p).not.toHaveProperty("payment_method_types");
    expect(p).not.toHaveProperty("allowed_payment_method_types");
    expect(p.integration_identifier).toBe(INTEGRATION_IDENTIFIER);
  });
  it("prices only from the server snapshot and binds the booking", () => {
    expect(p.line_items).toEqual([{ quantity: 1, price_data: { currency: "gbp", unit_amount: 3000,
      product_data: { name: "TEST - TEST ONLY - Homepage top banner (per day) (2026-10-24 to 2026-10-26, UK dates)" } } }]);
    expect(p.client_reference_id).toBe(B);
    expect(p.metadata).toEqual({ booking_id: B });
    expect(p.payment_intent_data).toEqual({ metadata: { booking_id: B } });
    expect(p.expires_at).toBe(Date.parse("2026-10-20T13:00:00Z") / 1000);
    expect(p.mode).toBe("payment");
    expect(p.success_url).toBe(`${cfg.baseUrl}/?view=advertise&booking=${B}&checkout=returned`);
  });
});

describe("SDK client construction (MOCK constructor)", () => {
  function MOCK_Stripe() {
    const create = vi.fn(async () => ({ id: "cs_test_x" }));
    const Ctor = vi.fn(function (key, opts) { this.key = key; this.opts = opts; this.checkout = { sessions: { create } }; });
    return { Ctor, create };
  }
  it("creates ONE lazily-constructed instance with the pinned API version and an idempotency key", async () => {
    const { Ctor, create } = MOCK_Stripe();
    const s = createStripeClient(cfg, { StripeCtor: Ctor });
    expect(Ctor).not.toHaveBeenCalled(); // lazy: no key needed at import/build time
    await s.createCheckoutSession(quote);
    await s.createCheckoutSession(quote);
    expect(Ctor).toHaveBeenCalledTimes(1);
    expect(Ctor.mock.calls[0][0]).toBe(cfg.stripeSecretKey);
    expect(Ctor.mock.calls[0][1]).toMatchObject({ apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 });
    expect(create).toHaveBeenCalledWith(buildCheckoutParams({ quote, baseUrl: cfg.baseUrl }), { idempotencyKey: checkoutIdempotencyKey(B) });
  });
  it("refuses anything but a TEST key without constructing a client", async () => {
    for (const bad of [{ stripeMode: "refused-non-test", stripeSecretKey: "" }, { stripeMode: "test", stripeSecretKey: "sk_live_x" }, { stripeMode: "missing", stripeSecretKey: "" }]) {
      const { Ctor } = MOCK_Stripe();
      await expect(createStripeClient({ ...cfg, ...bad }, { StripeCtor: Ctor }).createCheckoutSession(quote)).rejects.toThrow(/test key/);
      expect(Ctor).not.toHaveBeenCalled();
    }
  });
});

describe("real stripe-node SDK over a fake transport (MOCK_fetch, no network)", () => {
  it("sends POST /v1/checkout/sessions with the pinned Stripe-Version, idempotency key and no payment_method_types", async () => {
    const MOCK_fetch = vi.fn(async () => new Response(JSON.stringify({ object: "checkout.session", id: "cs_test_fake", livemode: false,
      amount_total: 3000, currency: "gbp", url: "https://checkout.stripe.com/c/pay/cs_test_fake" }), { status: 200, headers: { "Content-Type": "application/json", "Request-Id": "req_fake" } }));
    const s = createStripeClient(cfg, { httpClient: Stripe.createFetchHttpClient(MOCK_fetch) });
    const session = await s.createCheckoutSession(quote);
    expect(session.id).toBe("cs_test_fake");
    expect(MOCK_fetch).toHaveBeenCalledTimes(1);
    const [url, init] = MOCK_fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
    expect(headers.get("idempotency-key")).toBe(`msm-ads-checkout-${B}`);
    expect(headers.get("authorization")).toBe(`Bearer ${cfg.stripeSecretKey}`);
    const body = new URLSearchParams(init.body);
    expect([...body.keys()].some((k) => k.startsWith("payment_method_types"))).toBe(false);
    expect(body.get("integration_identifier")).toBe(INTEGRATION_IDENTIFIER);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("3000");
    expect(body.get("metadata[booking_id]")).toBe(B);
    expect(body.get("payment_intent_data[metadata][booking_id]")).toBe(B);
  });
  it("pinned API version equals the installed SDK's own default (types/shapes line up)", () => {
    expect(new Stripe("sk_test_LOCAL_FAKE").getApiField("version")).toBe(STRIPE_API_VERSION);
  });
});
