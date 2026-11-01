// Global security headers in vercel.json (anti-clickjacking + safe
// defaults). Uses Vercel's own @vercel/routing-utils transform of the REAL
// vercel.json, like vercelRouting.test.js, and checks the header route
// applies to every path class (SPA, API, ads API, OG rewrites, static
// assets) before the filesystem/rewrite phase, without ending routing.
//
// Deliberately NOT a script/style CSP: the app is not tested under one, so
// only frame-ancestors is set; a test fails if a broader directive slips in.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getTransformedRoutes } from "@vercel/routing-utils";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const { routes, error } = getTransformedRoutes(config);

const EXPECTED = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

const fsIndex = routes.findIndex((r) => r.handle === "filesystem");
const headerRoutes = routes.slice(0, fsIndex).filter((r) => r.headers && r.continue && !r.status);

function headersFor(path) {
  const out = {};
  for (const r of headerRoutes) if (new RegExp(r.src).test(path)) Object.assign(out, r.headers);
  return out;
}

describe("vercel.json global security headers", () => {
  it("transforms without error and adds one non-terminal header route before the filesystem phase", () => {
    expect(error).toBeFalsy();
    expect(headerRoutes).toHaveLength(1);
  });

  it.each([
    "/", "/index.html", "/gig/some-gig", "/artist/a", "/venue/v", "/festival/f", "/promoter/p",
    "/api/notify", "/api/ads/delivery", "/api/ads/creative", "/api/sitemap", "/sitemap.xml", "/robots.txt",
    "/assets/index-abc123.js", "/sw.js", "/admin/ads", "/a/deeply/nested/path",
  ])("%s gets every security header", (path) => {
    expect(headersFor(path)).toEqual(EXPECTED);
  });

  it("CSP is frame-ancestors only (no script/style policy that could break the app)", () => {
    const csp = EXPECTED["Content-Security-Policy"];
    expect(headerRoutes[0].headers["Content-Security-Policy"]).toBe(csp);
    expect(csp.split(";").map((d) => d.trim().split(/\s+/)[0])).toEqual(["frame-ancestors"]);
  });

  it("Permissions-Policy leaves clipboard alone (the app's COPY buttons use navigator.clipboard)", () => {
    expect(EXPECTED["Permissions-Policy"]).not.toMatch(/clipboard/);
  });

  it("the host redirect is still the first route and is unaffected", () => {
    expect(routes[0].status).toBe(308);
    expect(routes[0].has).toEqual([{ type: "host", value: "msm-gig-calendar.vercel.app" }]);
  });
});
