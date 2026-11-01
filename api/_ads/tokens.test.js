import { describe, it, expect } from "vitest";
import { signServeToken, verifyServeToken, clientKey, isLikelyBot } from "./tokens.js";

const SECRET = "LOCAL-FAKE-tracking-secret-0123456789abcdef";
const V = "11111111-2222-4333-8444-555555555555";
const NOW = 1_790_000_000;

describe("serve tokens", () => {
  it("round-trips", () => {
    const t = signServeToken(SECRET, { versionId: V, placement: "wordpress-home-top", issuedAt: NOW });
    expect(verifyServeToken(SECRET, t, { nowSeconds: NOW + 60 })).toEqual({ versionId: V, placement: "wordpress-home-top", issuedAt: NOW });
  });
  it("rejects forged, re-targeted, expired and garbage tokens", () => {
    const t = signServeToken(SECRET, { versionId: V, placement: "wordpress-home-top", issuedAt: NOW });
    const [p, s] = t.split(".");
    const forgedPayload = Buffer.from(`1.${V}.wordpress-home-middle.${NOW}`).toString("base64url");
    expect(verifyServeToken(SECRET, `${forgedPayload}.${s}`, { nowSeconds: NOW })).toBeNull();
    expect(verifyServeToken("another-secret-another-secret-123456", t, { nowSeconds: NOW })).toBeNull();
    expect(verifyServeToken(SECRET, t, { nowSeconds: NOW + 49 * 3600 })).toBeNull();
    expect(verifyServeToken(SECRET, t, { nowSeconds: NOW - 3600 })).toBeNull();
    expect(verifyServeToken(SECRET, `${p}.`, { nowSeconds: NOW })).toBeNull();
    expect(verifyServeToken(SECRET, "x".repeat(500), { nowSeconds: NOW })).toBeNull();
    expect(verifyServeToken(SECRET, undefined, { nowSeconds: NOW })).toBeNull();
  });
  it("refuses to sign with a short secret or bad fields", () => {
    expect(() => signServeToken("short", { versionId: V, placement: "wordpress-home-top" })).toThrow();
    expect(() => signServeToken(SECRET, { versionId: "nope", placement: "wordpress-home-top" })).toThrow();
  });
});

describe("privacy-minimised client key", () => {
  it("is a keyed hash that rotates daily and never contains the IP", () => {
    const a = clientKey(SECRET, { ip: "203.0.113.9", userAgent: "UA", day: "2026-10-15" });
    const b = clientKey(SECRET, { ip: "203.0.113.9", userAgent: "UA", day: "2026-10-16" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("203");
  });
  it("bot heuristics", () => {
    expect(isLikelyBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isLikelyBot("curl/8.0")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120")).toBe(true);
    expect(isLikelyBot("")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});
