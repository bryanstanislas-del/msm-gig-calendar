// Stripe Checkout Session creation over Stripe's REST API (server only,
// TEST MODE ONLY in phase 1). The amount always comes from the database's
// immutable purchase snapshot, never from the browser.

export function buildCheckoutParams({ quote, baseUrl }) {
  const p = new URLSearchParams();
  const id = quote.booking_id;
  p.set("mode", "payment");
  p.set("payment_method_types[0]", "card");
  p.set("line_items[0][quantity]", "1");
  p.set("line_items[0][price_data][currency]", quote.currency);
  p.set("line_items[0][price_data][unit_amount]", String(quote.total_pence));
  p.set("line_items[0][price_data][product_data][name]",
    `${quote.is_test ? "TEST - " : ""}${quote.product_name} (${quote.start_date} to ${quote.end_date}, UK dates)`.slice(0, 250));
  p.set("client_reference_id", id);
  p.set("metadata[booking_id]", id);
  p.set("payment_intent_data[metadata][booking_id]", id);
  p.set("expires_at", String(Math.floor(new Date(quote.hold_expires_at).getTime() / 1000)));
  p.set("success_url", `${baseUrl}/?view=advertise&booking=${id}&checkout=returned`);
  p.set("cancel_url", `${baseUrl}/?view=advertise&booking=${id}&checkout=cancelled`);
  return p;
}

export function createStripeClient(cfg, fetchImpl = globalThis.fetch) {
  return {
    async createCheckoutSession(quote) {
      if (cfg.stripeMode !== "test" || !cfg.stripeSecretKey) throw new Error("Stripe test key not configured");
      const r = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `msm-ads-checkout-${quote.booking_id}`,
        },
        body: buildCheckoutParams({ quote, baseUrl: cfg.baseUrl }).toString(),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(`Stripe checkout create failed (${r.status})`);
      return j;
    },
  };
}
