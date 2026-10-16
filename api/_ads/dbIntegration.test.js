// End-to-end vertical slice: REAL api/_ads handlers + REAL database
// functions/RLS on a LOCAL disposable Postgres (shim + ads migration),
// with Stripe Checkout creation and storage byte downloads replaced by
// LABELLED MOCKS. This proves our wiring and database behaviour; it does
// not prove a real Stripe account or Supabase project is configured.
//
// Skipped unless ADS_INTEGRATION_DB names a prepared local database
// (scripts/ads-local-db-test.sh sets this up). Never point it at production.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { handlers } from "./handlers.js";
import { computeSignature } from "./stripeSignature.js";
import { fakePng } from "./testFixtures.js";

const DB = process.env.ADS_INTEGRATION_DB;
const DB_URL = process.env.ADS_INTEGRATION_DB_URL || "";
const host = process.env.PGHOST || "";
const isLocal = DB_URL ? /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL) : (!host || host.startsWith("/") || host === "localhost" || host === "127.0.0.1");
const run = (DB || DB_URL) && isLocal ? describe : describe.skip;

const NOW = () => new Date();
const cfg = {
  apiEnabled: true, baseUrl: "https://calendar.example.test", supabaseUrl: "local-pg", anonKey: "LOCAL", serviceKey: "LOCAL_SERVICE",
  stripeSecretKey: "sk_test_MOCK", stripeMode: "test", stripeWebhookSecret: "whsec_LOCAL_FAKE_SECRET",
  trackingSecret: "LOCAL-FAKE-tracking-secret-0123456789abcdef", clickFallbackUrl: "https://fallback.example.test/",
};

run("ads vertical slice against local Postgres (Stripe + storage bytes MOCKED)", () => {
  let pg, pool;
  const ids = {};

  async function asRole(role, claims, sql, params = []) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await c.query(`set local role ${role}`);
      const r = await c.query(sql, params);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  const callFn = (role, claims) => async (fn, args = {}) => {
    const keys = Object.keys(args);
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    const vals = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    const r = await asRole(role, claims, sql, vals);
    return r.rows[0].r;
  };
  // Supabase-shaped adapter over local Postgres. "JWT" here is just the user id.
  const supabase = {
    rpcAsUser: (jwt, fn, args) => callFn("authenticated", { sub: jwt, role: "authenticated" })(fn, args),
    rpcAsAnon: (fn, args) => callFn("anon", { role: "anon" })(fn, args),
    rpcAsService: (fn, args) => callFn("service_role", { role: "service_role" })(fn, args),
    getUser: async (jwt) => ({ id: jwt }),
    // MOCK storage bytes (the storage.objects rows themselves are real).
    downloadObject: vi.fn(async (_b, path) => ({ buffer: path.includes("-desktop") ? fakePng(1200, 250) : fakePng(600, 250) })),
    signedUrl: async () => "https://storage.example.test/signed",
  };
  const res = () => {
    const r = { headers: {} };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (p) => { r.payload = p; return r; };
    r.send = (p) => { r.payload = p; return r; };
    r.end = () => r;
    r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
    return r;
  };
  const browserUA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", "x-forwarded-for": "198.51.100.7" };
  const signed = (event) => {
    const raw = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    return { raw, header: `t=${t},v1=${computeSignature(cfg.stripeWebhookSecret, t, raw)}` };
  };
  const deps = (stripe) => ({ cfg, supabase, stripe, now: NOW });

  beforeAll(async () => {
    pg = (await import("pg")).default;
    pool = new pg.Pool(DB_URL ? { connectionString: DB_URL, max: 4 } : { database: DB, max: 4 });
    const q = (s, p) => pool.query(s, p);
    await q("update public.ad_settings set bool_value = true where key in ('ads_portal_enabled','ads_checkout_enabled','ads_delivery_enabled')");
    await q("update public.ad_settings set int_value = 0 where key = 'min_lead_days'");
    await q("update public.ad_inventory_units set active = true where code = 'wordpress-home-top'");
    await q("update public.ad_products set active = true");
    ids.owner = (await q("insert into auth.users (email) values ('zz-int-owner@example.invalid') returning id")).rows[0].id;
    ids.admin = (await q("insert into auth.users (email) values ('zz-int-admin@example.invalid') returning id")).rows[0].id;
    ids.other = (await q("insert into auth.users (email) values ('zz-int-other@example.invalid') returning id")).rows[0].id;
    await q("insert into public.user_roles (user_id, role) values ($1, 'admin')", [ids.admin]);
    await asRole("authenticated", { sub: ids.owner, role: "authenticated" },
      "insert into public.ad_advertisers (display_name, contact_email) values ('ZZ Int Co', 'zz-int-owner@example.invalid')");
    ids.daily = (await q("select id from public.ad_products where code = 'TEST-wp-home-top-daily'")).rows[0].id;
  });
  afterAll(async () => { await pool?.end(); });

  it("hold -> checkout -> verified webhook -> creative -> review -> delivery -> click/impression -> report -> refund", async () => {
    const today = (await pool.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
    // Standard rule: today is never bookable; the earliest date comes from the server.
    await expect(supabase.rpcAsUser(ids.owner, "ad_create_hold", { p_product_id: ids.daily, p_start: today, p_end: today })).rejects.toThrow(/too soon/);
    const earliest = (await supabase.rpcAsUser(ids.owner, "ad_earliest_start", {})).earliest_start;
    ids.booking = await supabase.rpcAsUser(ids.owner, "ad_create_hold", { p_product_id: ids.daily, p_start: earliest, p_end: earliest });
    // LOCAL TEST ONLY: move the booking to today so delivery can be exercised now.
    await pool.query("update public.ad_booking_inventory_days set day = $2 where booking_id = $1", [ids.booking, today]);
    await pool.query("update public.ad_bookings set start_date = $2, end_date = $2 where id = $1", [ids.booking, today]);

    // Checkout: amount comes from the DB snapshot (1000), not the client.
    const MOCK_stripe = { createCheckoutSession: vi.fn(async (quote) => ({
      id: "cs_test_int1", url: "https://checkout.stripe.com/c/pay/cs_test_int1", amount_total: quote.total_pence,
      currency: quote.currency, livemode: false, expires_at: Math.floor(Date.now() / 1000) + 3000 })) };
    let r = res();
    await handlers.checkout({ method: "POST", headers: { authorization: `Bearer ${ids.owner}-padding-to-20` }, body: JSON.stringify({ booking_id: ids.booking, amount: 1 }) }, r, {
      ...deps(MOCK_stripe), supabase: { ...supabase, rpcAsUser: (_j, fn, a) => supabase.rpcAsUser(ids.owner, fn, a) } });
    expect(r.statusCode).toBe(200);
    expect(MOCK_stripe.createCheckoutSession.mock.calls[0][0].total_pence).toBe(1000);

    // The browser "returning" from Stripe proves nothing: still held.
    expect((await pool.query("select status from public.ad_bookings where id = $1", [ids.booking])).rows[0].status).toBe("held");

    // Verified webhook (locally signed) confirms payment; a retry is a no-op.
    const ev = { id: "evt_int_paid", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cs_test_int1", payment_intent: "pi_test_int1", metadata: { booking_id: ids.booking }, amount_total: 1000, currency: "gbp", payment_status: "paid" } } };
    for (const expected of ["confirmed", "duplicate"]) {
      const { raw, header } = signed(ev);
      r = res();
      await handlers.webhook({ method: "POST", headers: { "stripe-signature": header }, body: Buffer.from(raw) }, r, deps());
      expect(r.statusCode).toBe(200);
      expect(r.payload.outcome).toBe(expected);
    }
    let camp = (await pool.query("select * from public.ad_campaigns where booking_id = $1", [ids.booking])).rows[0];
    expect(camp.review_status).toBe("awaiting_creative");
    expect(camp.approved_version_id).toBeNull();

    // Upload rows (real storage.objects RLS as the owner) + server-verified submit.
    const adv = (await pool.query("select id from public.ad_advertisers where owner_user_id = $1", [ids.owner])).rows[0].id;
    const dPath = `${adv}/${camp.id}/${crypto.randomUUID()}-desktop.png`;
    const mPath = `${adv}/${camp.id}/${crypto.randomUUID()}-mobile.png`;
    for (const p of [dPath, mPath]) {
      await asRole("authenticated", { sub: ids.owner, role: "authenticated" }, "insert into storage.objects (bucket_id, name) values ('ad-creatives-private', $1)", [p]);
    }
    r = res();
    await handlers["submit-creative"]({ method: "POST", headers: { authorization: `Bearer ${ids.owner}` },
      body: JSON.stringify({ campaign_id: camp.id, desktop_path: dPath, mobile_path: mPath, destination_url: "https://band.example.com/tour", alt_text: "ZZ tour banner" }) }, r, deps());
    expect(r.statusCode).toBe(200);
    const versionId = r.payload.creative_version_id;
    camp = (await pool.query("select * from public.ad_campaigns where booking_id = $1", [ids.booking])).rows[0];
    expect(camp.review_status).toBe("under_review");

    // Paid + under review is NOT delivered.
    r = res();
    await handlers.delivery({ method: "GET", query: { placement: "wordpress-home-top" }, headers: {} }, r, deps());
    expect(r.payload.ads).toEqual([]);

    // Other user cannot approve; admin can.
    await expect(supabase.rpcAsUser(ids.other, "ad_admin_review", { p_version_id: versionId, p_decision: "approve" })).rejects.toThrow(/ADS_FORBIDDEN/);
    await supabase.rpcAsUser(ids.admin, "ad_admin_review", { p_version_id: versionId, p_decision: "approve" });

    r = res();
    await handlers.delivery({ method: "GET", query: { placement: "wordpress-home-top" }, headers: {} }, r, deps());
    expect(r.payload.ads).toHaveLength(1);
    const ad = r.payload.ads[0];
    expect(ad.creative_id).toBe(versionId);
    expect(JSON.stringify(r.payload)).not.toMatch(/zz-int-owner|ZZ Int Co|band\.example\.com/);

    // Impression + click through the real metric RPC; click goes to the stored destination.
    r = res();
    await handlers.impression({ method: "POST", headers: browserUA, body: JSON.stringify({ t: ad.impression_token }) }, r, deps());
    expect(r.statusCode).toBe(204);
    r = res();
    await handlers.click({ method: "GET", query: { t: new URL(ad.click_url).searchParams.get("t") }, headers: browserUA }, r, deps());
    expect(r.headers.location).toBe("https://band.example.com/tour");

    r = res();
    await handlers.report({ method: "GET", headers: { authorization: `Bearer ${ids.owner}-padding-to-20` }, query: { booking_id: ids.booking, format: "csv" } }, r, {
      ...deps(), supabase: { ...supabase, rpcAsUser: (_j, fn, a) => supabase.rpcAsUser(ids.owner, fn, a) } });
    expect(r.statusCode).toBe(200);
    expect(r.payload).toContain(`${ids.booking},${today},wordpress-home-top,1,1,100.00,yes`);
    await expect(supabase.rpcAsUser(ids.other, "ad_report", { p_booking_id: ids.booking, p_from: null, p_to: null })).rejects.toThrow(/ADS_NOT_FOUND/);

    // Out-of-order: expiry after payment changes nothing; full refund stops delivery.
    for (const e of [
      { id: "evt_int_exp", type: "checkout.session.expired", livemode: false, data: { object: { id: "cs_test_int1", metadata: { booking_id: ids.booking } } } },
      { id: "evt_int_refund", type: "charge.refunded", livemode: false, data: { object: { payment_intent: "pi_test_int1", amount: 1000, amount_refunded: 1000 } } },
    ]) {
      const { raw, header } = signed(e);
      r = res();
      await handlers.webhook({ method: "POST", headers: { "stripe-signature": header }, body: Buffer.from(raw) }, r, deps());
      expect(r.statusCode).toBe(200);
    }
    expect((await pool.query("select status from public.ad_bookings where id = $1", [ids.booking])).rows[0].status).toBe("refunded");
    r = res();
    await handlers.delivery({ method: "GET", query: { placement: "wordpress-home-top" }, headers: {} }, r, deps());
    expect(r.payload.ads).toEqual([]);
  });
});
