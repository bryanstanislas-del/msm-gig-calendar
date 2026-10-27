// Handler tests use LABELLED MOCKS for Supabase and Stripe
// (MOCK_supabase / MOCK_stripe below). They verify our request handling,
// security checks and wiring only -- they are NOT evidence that real Stripe
// or Supabase integrations are configured or working. The database side of
// the same flows is exercised for real in supabase/tests/ads (local
// Postgres) and api/_ads/dbIntegration.test.js.
import { describe, it, expect, vi } from "vitest";
import { handlers } from "./handlers.js";
import { computeSignature } from "./stripeSignature.js";
import { signServeToken } from "./tokens.js";
import { fakePng } from "./testFixtures.js";

const V = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADV = "99999999-8888-4777-8666-555555555555";
const NOW = new Date("2026-10-20T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.LOCAL_FAKE_SIGNATURE";

const cfg = (over = {}) => ({
  apiEnabled: true,
  baseUrl: "https://calendar.example.test",
  supabaseUrl: "https://LOCAL-MOCK.supabase.invalid",
  anonKey: "MOCK_ANON",
  serviceKey: "MOCK_SERVICE_ROLE_never_returned",
  stripeSecretKey: "sk_test_MOCK_never_returned",
  stripeMode: "test",
  stripeWebhookSecret: "whsec_LOCAL_FAKE_SECRET",
  trackingSecret: "LOCAL-FAKE-tracking-secret-0123456789abcdef",
  clickFallbackUrl: "https://musicscenemagazine.example.test/",
  ...over,
});

function MOCK_supabase(over = {}) {
  return {
    rpcAsUser: vi.fn(async () => { throw new Error("unexpected"); }),
    rpcAsAnon: vi.fn(async () => []),
    rpcAsService: vi.fn(async () => null),
    getUser: vi.fn(async () => ({ id: "user-1" })),
    downloadObject: vi.fn(async () => null),
    signedUrl: vi.fn(async () => "https://LOCAL-MOCK.supabase.invalid/storage/v1/object/sign/x?token=t"),
    ...over,
  };
}
const MOCK_stripe = (session) => ({ createCheckoutSession: vi.fn(async () => session) });

function req({ method = "GET", query = {}, headers = {}, body } = {}) {
  return { method, query, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36", ...headers }, body };
}
function res() {
  const r = { headers: {}, statusCode: null, payload: undefined };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((p) => { r.payload = p; return r; });
  r.send = vi.fn((p) => { r.payload = p; return r; });
  r.end = vi.fn(() => r);
  r.setHeader = vi.fn((k, v) => { r.headers[k.toLowerCase()] = v; });
  return r;
}
const deps = (over = {}) => ({ cfg: cfg(over.cfg), supabase: over.supabase || MOCK_supabase(), stripe: over.stripe || MOCK_stripe(null), now: () => NOW });
const noSecrets = (r) => {
  const s = JSON.stringify({ p: r.payload, h: r.headers });
  for (const secret of ["MOCK_SERVICE_ROLE", "sk_test_MOCK", "whsec_LOCAL", "LOCAL-FAKE-tracking"]) expect(s).not.toContain(secret);
};

describe("checkout (server-priced, test mode only)", () => {
  const quote = { booking_id: B, total_pence: 3000, currency: "gbp", is_test: true, product_name: "TEST", start_date: "2026-10-24", end_date: "2026-10-26", hold_expires_at: "2026-10-20T13:00:00Z" };
  const session = { id: "cs_test_abc", url: "https://checkout.stripe.com/c/pay/cs_test_abc", amount_total: 3000, currency: "gbp", livemode: false, expires_at: NOW_S + 3600 };

  it("ignores any client-supplied amount and uses the DB snapshot", async () => {
    const supabase = MOCK_supabase({ rpcAsUser: vi.fn(async () => quote), rpcAsService: vi.fn(async () => null) });
    const stripe = MOCK_stripe(session);
    const r = res();
    await handlers.checkout(req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: { booking_id: B, amount: 1, total_pence: 1 } }), r, deps({ supabase, stripe }));
    expect(r.statusCode).toBe(200);
    expect(r.payload).toEqual({ url: session.url, test_mode: true });
    expect(supabase.rpcAsUser).toHaveBeenCalledWith(JWT, "ad_prepare_checkout", { p_booking_id: B });
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(quote);
    expect(supabase.rpcAsService).toHaveBeenCalledWith("ad_record_checkout_session", expect.objectContaining({ p_amount_pence: 3000, p_livemode: false }));
    noSecrets(r);
  });
  it("refuses live/mismatched sessions and non-test keys", async () => {
    for (const bad of [{ ...session, livemode: true }, { ...session, amount_total: 2999 }, { ...session, id: "cs_live_x" }, { ...session, url: "https://evil.example/" }]) {
      const r = res();
      await handlers.checkout(req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: { booking_id: B } }),
        r, deps({ supabase: MOCK_supabase({ rpcAsUser: vi.fn(async () => quote) }), stripe: MOCK_stripe(bad) }));
      expect(r.statusCode).toBe(502);
    }
    const r = res();
    await handlers.checkout(req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: { booking_id: B } }), r, deps({ cfg: { stripeMode: "refused-non-test", stripeSecretKey: "" } }));
    expect(r.payload.error).toBe("ADS_STRIPE_TEST_KEY_REQUIRED");
  });
  it("requires auth, reports missing config by NAME only, and passes DB refusals through", async () => {
    let r = res();
    await handlers.checkout(req({ method: "POST", body: { booking_id: B } }), r, deps());
    expect(r.statusCode).toBe(401);
    r = res();
    await handlers.checkout(req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: { booking_id: B } }), r, deps({ cfg: { serviceKey: "" } }));
    expect(r.statusCode).toBe(503);
    expect(r.payload.missing).toContain("SUPABASE_SERVICE_ROLE_KEY");
    r = res();
    await handlers.checkout(req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: { booking_id: B } }), r,
      deps({ supabase: MOCK_supabase({ rpcAsUser: vi.fn(async () => { throw new Error("ADS_NOT_FOUND"); }) }) }));
    expect(r.statusCode).toBe(404);
    r = res();
    await handlers.checkout(req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: { booking_id: B } }), r, deps({ cfg: { apiEnabled: false } }));
    expect(r.payload.error).toBe("ADS_DISABLED");
  });
});

describe("webhook (signed raw body)", () => {
  const event = { id: "evt_local_1", type: "checkout.session.completed", livemode: false, created: NOW_S,
    data: { object: { id: "cs_test_abc", payment_intent: "pi_1", metadata: { booking_id: B }, amount_total: 3000, currency: "gbp", payment_status: "paid" } } };
  const raw = JSON.stringify(event);
  const sig = (t = NOW_S, body = raw) => `t=${t},v1=${computeSignature("whsec_LOCAL_FAKE_SECRET", t, body)}`;

  it("applies a verified event exactly as normalised (payment only, never approval)", async () => {
    const supabase = MOCK_supabase({ rpcAsService: vi.fn(async () => ({ outcome: "confirmed" })) });
    const r = res();
    await handlers.webhook(req({ method: "POST", headers: { "stripe-signature": sig() }, body: Buffer.from(raw) }), r, deps({ supabase }));
    expect(r.statusCode).toBe(200);
    expect(supabase.rpcAsService).toHaveBeenCalledTimes(1);
    expect(supabase.rpcAsService.mock.calls[0][0]).toBe("ad_apply_stripe_event");
    expect(supabase.rpcAsService.mock.calls.flat().join(" ")).not.toMatch(/review|approve/);
  });
  it("rejects bad signatures and parsed (non-raw) bodies without touching the DB", async () => {
    const supabase = MOCK_supabase();
    for (const h of [sig(NOW_S - 1000), "t=1,v1=" + "0".repeat(64), undefined]) {
      const r = res();
      await handlers.webhook(req({ method: "POST", headers: { "stripe-signature": h }, body: Buffer.from(raw) }), r, deps({ supabase }));
      expect(r.statusCode).toBe(400);
    }
    const r = res();
    await handlers.webhook(req({ method: "POST", headers: { "stripe-signature": sig() }, body: event }), r, deps({ supabase }));
    expect(r.payload.error).toBe("RAW_BODY_UNAVAILABLE");
    expect(supabase.rpcAsService).not.toHaveBeenCalled();
  });
  it("returns 503 so Stripe retries when the DB defers an out-of-order event, 500 on other failures", async () => {
    let r = res();
    await handlers.webhook(req({ method: "POST", headers: { "stripe-signature": sig() }, body: Buffer.from(raw) }), r,
      deps({ supabase: MOCK_supabase({ rpcAsService: vi.fn(async () => { throw new Error("ADS_RETRY_LATER: unknown payment intent"); }) }) }));
    expect(r.statusCode).toBe(503);
    r = res();
    await handlers.webhook(req({ method: "POST", headers: { "stripe-signature": sig() }, body: Buffer.from(raw) }), r,
      deps({ supabase: MOCK_supabase({ rpcAsService: vi.fn(async () => { throw new Error("connection reset"); }) }) }));
    expect(r.statusCode).toBe(500);
    noSecrets(r);
  });
});

describe("delivery", () => {
  const row = { creative_version_id: V, placement: "wordpress-home-top", alt_text: "Band tour", desktop: { width: 1200, height: 250 }, mobile: { width: 600, height: 250 }, serve_until: "2026-10-26T00:00:00+00:00" };
  it("returns only safe fields + signed URLs on our own domain", async () => {
    const r = res();
    await handlers.delivery(req({ query: { placement: "wordpress-home-top" } }), r, deps({ supabase: MOCK_supabase({ rpcAsAnon: vi.fn(async () => [row]) }) }));
    expect(r.statusCode).toBe(200);
    const ad = r.payload.ads[0];
    expect(Object.keys(ad).sort()).toEqual(["alt", "click_url", "creative_id", "desktop", "impression_token", "impression_url", "mobile", "serve_until"]);
    expect(ad.click_url.startsWith("https://calendar.example.test/api/ads/click?t=")).toBe(true);
    expect(ad.desktop.url).toBe(`https://calendar.example.test/api/ads/creative?v=${V}&p=wordpress-home-top&s=desktop`);
    expect(r.headers["cache-control"]).toMatch(/max-age=60/);
    noSecrets(r);
  });
  it("falls back to house ads (empty list) when disabled, misconfigured or failing; rejects unknown placements", async () => {
    for (const d of [deps({ cfg: { apiEnabled: false } }), deps({ cfg: { trackingSecret: "" } }),
      deps({ supabase: MOCK_supabase({ rpcAsAnon: vi.fn(async () => { throw new Error("down"); }) }) })]) {
      const r = res();
      await handlers.delivery(req({ query: { placement: "wordpress-home-top" } }), r, d);
      expect(r.statusCode).toBe(200);
      expect(r.payload.ads).toEqual([]);
    }
    const r = res();
    await handlers.delivery(req({ query: { placement: "../../etc" } }), r, deps());
    expect(r.statusCode).toBe(400);
  });
});

describe("click redirect safety", () => {
  const token = signServeToken(cfg().trackingSecret, { versionId: V, placement: "wordpress-home-top", issuedAt: NOW_S - 60 });
  it("redirects only to the approved destination stored in the DB and counts eligible clicks", async () => {
    const supabase = MOCK_supabase({ rpcAsService: vi.fn(async (fn) => fn === "ad_serving_lookup"
      ? { approved: true, eligible: true, destination_url: "https://band.example.com/tickets" } : "counted") });
    const r = res();
    await handlers.click(req({ query: { t: token, url: "https://evil.example/" } }), r, deps({ supabase }));
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("https://band.example.com/tickets");
    expect(supabase.rpcAsService).toHaveBeenCalledWith("ad_record_metric", expect.objectContaining({ p_kind: "click", p_version_id: V }));
    const key = supabase.rpcAsService.mock.calls[1][1].p_client_key;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
  it("never redirects to drafts/rejected/unsafe destinations or for forged tokens", async () => {
    const cases = [
      { approved: false, eligible: false, destination_url: null },
      { approved: true, eligible: true, destination_url: "javascript:alert(1)" },
      { approved: true, eligible: true, destination_url: "http://insecure.example.com" },
    ];
    for (const look of cases) {
      const r = res();
      await handlers.click(req({ query: { t: token } }), r, deps({ supabase: MOCK_supabase({ rpcAsService: vi.fn(async () => look) }) }));
      expect(r.headers.location).toBe("https://musicscenemagazine.example.test/");
    }
    const supabase = MOCK_supabase();
    const r = res();
    await handlers.click(req({ query: { t: token.slice(0, -2) + "xx" } }), r, deps({ supabase }));
    expect(r.headers.location).toBe("https://musicscenemagazine.example.test/");
    expect(supabase.rpcAsService).not.toHaveBeenCalled();
  });
  it("still redirects (without counting) once a campaign has ended, and skips bots", async () => {
    const supabase = MOCK_supabase({ rpcAsService: vi.fn(async () => ({ approved: true, eligible: false, destination_url: "https://band.example.com/" })) });
    const r = res();
    await handlers.click(req({ query: { t: token } }), r, deps({ supabase }));
    expect(r.headers.location).toBe("https://band.example.com/");
    expect(supabase.rpcAsService).toHaveBeenCalledTimes(1);
    const s2 = MOCK_supabase({ rpcAsService: vi.fn(async () => ({ approved: true, eligible: true, destination_url: "https://band.example.com/" })) });
    await handlers.click(req({ query: { t: token }, headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } }), res(), deps({ supabase: s2 }));
    expect(s2.rpcAsService).toHaveBeenCalledTimes(1);
  });
});

describe("impression beacon", () => {
  const token = signServeToken(cfg().trackingSecret, { versionId: V, placement: "wordpress-home-top", issuedAt: NOW_S - 60 });
  it("records via the service RPC for a valid token and a real browser; always 204", async () => {
    const supabase = MOCK_supabase({ rpcAsService: vi.fn(async () => "counted") });
    const r = res();
    await handlers.impression(req({ method: "POST", body: JSON.stringify({ t: token }) }), r, deps({ supabase }));
    expect(r.statusCode).toBe(204);
    expect(supabase.rpcAsService).toHaveBeenCalledWith("ad_record_metric", expect.objectContaining({ p_kind: "impression", p_placement: "wordpress-home-top" }));
  });
  it("ignores forged/arbitrary attribution, stale tokens and bots", async () => {
    const supabase = MOCK_supabase();
    const stale = signServeToken(cfg().trackingSecret, { versionId: V, placement: "wordpress-home-top", issuedAt: NOW_S - 25 * 3600 });
    for (const [body, ua] of [[JSON.stringify({ t: "forged" }), undefined], [JSON.stringify({ creative_version_id: V, placement: "wordpress-home-top" }), undefined],
      [JSON.stringify({ t: stale }), undefined], [JSON.stringify({ t: token }), "curl/8.4"], ["not json", undefined]]) {
      const r = res();
      await handlers.impression(req({ method: "POST", body, headers: ua ? { "user-agent": ua } : {} }), r, deps({ supabase }));
      expect(r.statusCode).toBe(204);
    }
    expect(supabase.rpcAsService).not.toHaveBeenCalled();
  });
});

describe("creative image endpoint lifetime is capped at the booked end", () => {
  const path = `${ADV}/${B}/${V}-desktop.png`;
  it("caps signed URL TTL and redirect cache at serve_until", async () => {
    const signedUrl = vi.fn(async () => "https://LOCAL-MOCK.supabase.invalid/signed");
    const serveUntil = new Date(NOW.getTime() + 120 * 1000).toISOString();
    const r = res();
    await handlers.creative(req({ query: { v: V, p: "wordpress-home-top", s: "desktop" } }), r,
      deps({ supabase: MOCK_supabase({ signedUrl, rpcAsService: vi.fn(async () => ({ eligible: true, desktop_object_path: path, serve_until: serveUntil })) }) }));
    expect(r.statusCode).toBe(302);
    expect(signedUrl).toHaveBeenCalledWith("ad-creatives-private", path, 120);
    expect(r.headers["cache-control"]).toBe("public, max-age=120, s-maxage=120");
  });
  it("uses the 600s/300s ceilings when the booking ends later, and 404s once ended", async () => {
    const signedUrl = vi.fn(async () => "https://LOCAL-MOCK.supabase.invalid/signed");
    let r = res();
    await handlers.creative(req({ query: { v: V, p: "wordpress-home-top", s: "desktop" } }), r,
      deps({ supabase: MOCK_supabase({ signedUrl, rpcAsService: vi.fn(async () => ({ eligible: true, desktop_object_path: path, serve_until: "2026-10-30T00:00:00Z" })) }) }));
    expect(signedUrl).toHaveBeenCalledWith("ad-creatives-private", path, 600);
    expect(r.headers["cache-control"]).toBe("public, max-age=300, s-maxage=300");
    r = res();
    await handlers.creative(req({ query: { v: V, p: "wordpress-home-top", s: "desktop" } }), r,
      deps({ supabase: MOCK_supabase({ signedUrl, rpcAsService: vi.fn(async () => ({ eligible: true, desktop_object_path: path, serve_until: NOW.toISOString() })) }) }));
    expect(r.statusCode).toBe(404);
  });
  it("delivery cache never extends past the soonest serve_until", async () => {
    const row = { creative_version_id: V, alt_text: "x", desktop: { width: 1200, height: 250 }, mobile: { width: 600, height: 250 }, serve_until: new Date(NOW.getTime() + 20e3).toISOString() };
    const r = res();
    await handlers.delivery(req({ query: { placement: "wordpress-home-top" } }), r, deps({ supabase: MOCK_supabase({ rpcAsAnon: vi.fn(async () => [row]) }) }));
    expect(r.headers["cache-control"]).toBe("public, max-age=20, s-maxage=20");
  });
});

describe("creative image endpoint (approved + live only)", () => {
  it("redirects to a short-lived signed URL only when eligible", async () => {
    const path = `${ADV}/${B}/${V}-desktop.png`;
    let r = res();
    await handlers.creative(req({ query: { v: V, p: "wordpress-home-top", s: "desktop" } }), r,
      deps({ supabase: MOCK_supabase({ rpcAsService: vi.fn(async () => ({ eligible: true, desktop_object_path: path, serve_until: "2026-10-30T00:00:00Z" })) }) }));
    expect(r.statusCode).toBe(302);
    r = res();
    await handlers.creative(req({ query: { v: V, p: "wordpress-home-top", s: "desktop" } }), r,
      deps({ supabase: MOCK_supabase({ rpcAsService: vi.fn(async () => ({ eligible: false, desktop_object_path: null })) }) }));
    expect(r.statusCode).toBe(404);
  });
});

describe("submit-creative (server-verified bytes)", () => {
  const C = B;
  const body = (over = {}) => ({ campaign_id: C, desktop_path: `${ADV}/${C}/${V}-desktop.png`, mobile_path: `${ADV}/${C}/${V}-mobile.png`,
    destination_url: "https://band.example.com/", alt_text: "Band tour banner", ...over });
  const download = (map) => vi.fn(async (_b, path) => (map[path.endsWith("desktop.png") ? "d" : "m"]));

  it("probes real dimensions and passes verified metadata to the service RPC", async () => {
    const supabase = MOCK_supabase({ downloadObject: download({ d: { buffer: fakePng(1200, 250) }, m: { buffer: fakePng(600, 250) } }),
      rpcAsService: vi.fn(async () => V) });
    const r = res();
    await handlers["submit-creative"](req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: JSON.stringify(body()) }), r, deps({ supabase }));
    expect(r.statusCode).toBe(200);
    const args = supabase.rpcAsService.mock.calls[0][1];
    expect(args.p_actor_user_id).toBe("user-1");
    expect(args.p_desktop).toMatchObject({ mime: "image/png", width: 1200, height: 250 });
    expect(args.p_desktop.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects disguised files, unsafe URLs, foreign paths and unauthenticated calls", async () => {
    const svg = { buffer: Buffer.from("<svg onload=alert(1)>") };
    const cases = [
      [body(), { d: svg, m: svg }, /not a valid/],
      [body({ destination_url: "javascript:alert(1)" }), {}, /ADS_INVALID_DESTINATION/],
      [body({ desktop_path: `${ADV}/${V}/${V}-desktop.png` }), {}, /path/],
      [body({ desktop_path: `${ADV}/${C}/${V}-desktop.webp` }), { d: { buffer: fakePng(1200, 250) }, m: { buffer: fakePng(600, 250) } }, /do not match/],
      [body(), { d: { tooLarge: true } }, /1 MB/],
    ];
    for (const [b, files, re] of cases) {
      const supabase = MOCK_supabase({ downloadObject: download(files) });
      const r = res();
      await handlers["submit-creative"](req({ method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: JSON.stringify(b) }), r, deps({ supabase }));
      expect(r.statusCode).toBe(400);
      expect(JSON.stringify(r.payload)).toMatch(re);
      expect(supabase.rpcAsService).not.toHaveBeenCalled();
    }
    const r = res();
    await handlers["submit-creative"](req({ method: "POST", body: JSON.stringify(body()) }), r, deps());
    expect(r.statusCode).toBe(401);
  });
});

describe("report download", () => {
  const report = { booking_id: B, status: "confirmed", product_name: "TEST", placements: ["wordpress-home-top"], booked_start: "2026-10-24",
    booked_end: "2026-10-26", from: "2026-10-24", to: "2026-10-25", is_test: true, generated_at: "x", rows: [{ day: "2026-10-24", impressions: 10, clicks: 1 }] };
  it("serves CSV/PDF for the caller's own booking via their JWT", async () => {
    for (const format of ["csv", "pdf"]) {
      const supabase = MOCK_supabase({ rpcAsUser: vi.fn(async () => report) });
      const r = res();
      await handlers.report(req({ headers: { authorization: `Bearer ${JWT}` }, query: { booking_id: B, from: "2026-10-24", to: "2026-10-25", format } }), r, deps({ supabase }));
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-disposition"]).toContain(`msm-ad-report-${B}`);
      expect(supabase.rpcAsUser).toHaveBeenCalledWith(JWT, "ad_report", { p_booking_id: B, p_from: "2026-10-24", p_to: "2026-10-25" });
    }
  });
  it("rejects bad input and maps other users' bookings to 404", async () => {
    let r = res();
    await handlers.report(req({ headers: { authorization: `Bearer ${JWT}` }, query: { booking_id: B, from: "24/10/2026" } }), r, deps());
    expect(r.statusCode).toBe(400);
    r = res();
    await handlers.report(req({ headers: { authorization: `Bearer ${JWT}` }, query: { booking_id: B } }), r,
      deps({ supabase: MOCK_supabase({ rpcAsUser: vi.fn(async () => { throw new Error("ADS_NOT_FOUND"); }) }) }));
    expect(r.statusCode).toBe(404);
  });
});
