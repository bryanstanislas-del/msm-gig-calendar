// Stripe Checkout Session creation (server only, TEST MODE ONLY in phase 1)
// via the official stripe-node SDK: one lazily created client INSTANCE per
// key (`new Stripe(key, { apiVersion })` -- stripe-node's StripeClient), with
// an explicitly pinned API version so an SDK upgrade can never silently move
// the request/webhook shapes this code relies on.
//
// Payment methods are DYNAMIC: no payment_method_types allowlist (removed
// from Checkout.SessionCreateParams in API 2026-09-30.endive). Stripe offers
// whatever is enabled in the Dashboard for GBP. Delayed-notification methods
// stay gated server-side: only a verified `checkout.session.completed` with
// payment_status = "paid" or `checkout.session.async_payment_succeeded`
// confirms a booking (see ad_apply_stripe_event); "unpaid" completions are
// recorded as awaiting_async_payment and never confirm, approve or publish.
//
// The amount always comes from the database's immutable purchase snapshot,
// never from the browser.
import Stripe from "stripe";

/** Pinned Stripe API version (the version stripe-node 23.0.0 was built for). */
export const STRIPE_API_VERSION = "2026-09-30.endive";
/** Groups every Checkout Session this integration creates (Dashboard/API filtering). */
export const INTEGRATION_IDENTIFIER = "msm-ads-phase1";

export function checkoutIdempotencyKey(bookingId) {
  return `msm-ads-checkout-${bookingId}`;
}

export function buildCheckoutParams({ quote, baseUrl }) {
  const id = quote.booking_id;
  return {
    mode: "payment",
    integration_identifier: INTEGRATION_IDENTIFIER,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: quote.currency,
        unit_amount: quote.total_pence,
        product_data: {
          name: `${quote.is_test ? "TEST - " : ""}${quote.product_name} (${quote.start_date} to ${quote.end_date}, UK dates)`.slice(0, 250),
        },
      },
    }],
    client_reference_id: id,
    metadata: { booking_id: id },
    payment_intent_data: { metadata: { booking_id: id } },
    expires_at: Math.floor(new Date(quote.hold_expires_at).getTime() / 1000),
    success_url: `${baseUrl}/?view=advertise&booking=${id}&checkout=returned`,
    cancel_url: `${baseUrl}/?view=advertise&booking=${id}&checkout=cancelled`,
  };
}

/**
 * `sdk` lets tests inject a labelled fake constructor or a fake HTTP client;
 * production uses the real SDK with its default Node HTTP client.
 */
export function createStripeClient(cfg, { StripeCtor = Stripe, httpClient } = {}) {
  let client = null;
  const getClient = () => {
    if (cfg.stripeMode !== "test" || !/^(sk|rk)_test_/.test(cfg.stripeSecretKey || "")) {
      throw new Error("Stripe test key not configured");
    }
    if (!client) {
      client = new StripeCtor(cfg.stripeSecretKey, {
        apiVersion: STRIPE_API_VERSION,
        maxNetworkRetries: 2, // retries reuse the same idempotency key
        timeout: 15000,
        appInfo: { name: "msm-ads", version: "phase1" },
        ...(httpClient ? { httpClient } : {}),
      });
    }
    return client;
  };
  return {
    async createCheckoutSession(quote) {
      return getClient().checkout.sessions.create(
        buildCheckoutParams({ quote, baseUrl: cfg.baseUrl }),
        { idempotencyKey: checkoutIdempotencyKey(quote.booking_id) },
      );
    },
  };
}
