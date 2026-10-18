// Exercises the real api/ads.js router (no mocks) as Vercel invokes it after
// the "/api/ads/:action" -> "/api/ads?action=:action" rewrite. With no ads
// env vars set (the state of every current preview/production deployment)
// it must answer JSON -- never HTML -- and fail closed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, { resolveAction } from "../api/ads.js";

function res() {
  const r = { headers: {} };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((p) => { r.payload = p; return r; });
  r.send = vi.fn((p) => { r.payload = p; return r; });
  r.end = vi.fn(() => r);
  r.setHeader = vi.fn((k, v) => { r.headers[k.toLowerCase()] = v; });
  return r;
}

beforeEach(() => {
  for (const k of ["ADS_API_ENABLED", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ADS_TRACKING_SECRET"]) delete process.env[k];
});

describe("api/ads.js action resolution", () => {
  it("uses the rewrite's ?action= and falls back to the /api/ads/<action> path", () => {
    expect(resolveAction({ query: { action: "delivery" }, url: "/api/ads?action=delivery" })).toBe("delivery");
    expect(resolveAction({ query: {}, url: "/api/ads/submit-creative?x=1" })).toBe("submit-creative");
  });
  it("rejects duplicated/array action params and odd paths", () => {
    expect(resolveAction({ query: { action: ["delivery", "webhook"] }, url: "/api/ads?action=delivery&action=webhook" })).toBeNull();
    expect(resolveAction({ query: {}, url: "/api/ads/../gig" })).toBeNull();
    expect(resolveAction({ query: {}, url: "/api/ads" })).toBeNull();
  });
});

describe("api/ads.js answers JSON with ads disabled (current deployments)", () => {
  it("delivery -> 200 JSON house fallback (empty ads list)", async () => {
    const r = res();
    await handler({ method: "GET", query: { action: "delivery", placement: "wordpress-home-top" }, url: "/api/ads?action=delivery&placement=wordpress-home-top", headers: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.json).toHaveBeenCalledWith({ placement: "wordpress-home-top", label: "Advertisement", ads: [] });
  });
  it("checkout -> 503 ADS_DISABLED JSON", async () => {
    const r = res();
    await handler({ method: "POST", query: { action: "checkout" }, url: "/api/ads?action=checkout", headers: {}, body: "{}" }, r);
    expect(r.statusCode).toBe(503);
    expect(r.payload).toEqual({ error: "ADS_DISABLED" });
  });
  it("unknown or ambiguous action -> 404 JSON", async () => {
    for (const q of [{ action: "nope" }, { action: ["delivery", "webhook"] }, {}]) {
      const r = res();
      await handler({ method: "GET", query: q, url: "/api/ads", headers: {} }, r);
      expect(r.statusCode).toBe(404);
      expect(r.payload).toEqual({ error: "NOT_FOUND" });
    }
  });
});
