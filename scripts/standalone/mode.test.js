// Build-mode rules and the release deploy template.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CANONICAL_URL, INDEXABLE_HOST, INDEXABLE_HOST_REGEX, LAUNCH_DESCRIPTION, LAUNCH_TITLE,
  PUBLIC_ORIGIN, ROBOTS_TXT, SITEMAP_XML, applyLaunchHtml, isLaunchBuild,
} from "./mode.mjs";

const json = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const HUB_HTML = readFileSync(new URL("../../festival-hub/index.html", import.meta.url), "utf8");
const pkg = json("../../package.json");

describe("isLaunchBuild", () => {
  const cases = [
    [{}, false],
    [{ VERCEL_ENV: "production" }, false], // standalone template on a production deploy stays staging
    [{ HUB_RELEASE: "1" }, false],
    [{ HUB_RELEASE: "1", VERCEL_ENV: "preview" }, false],
    [{ HUB_RELEASE: "1", VERCEL_ENV: "development" }, false],
    [{ HUB_RELEASE: "true", VERCEL_ENV: "production" }, false],
    [{ HUB_RELEASE: "1", VERCEL_ENV: "production" }, true],
    [{ HUB_LAUNCH: "1" }, true],
    [{ HUB_LAUNCH: "1", VERCEL_ENV: "preview" }, true],
    [{ HUB_LAUNCH: "0", VERCEL_ENV: "preview" }, false],
  ];
  for (const [env, want] of cases) it(`${JSON.stringify(env)} -> ${want ? "launch" : "staging"}`, () => expect(isLaunchBuild(env)).toBe(want));
});

describe("launch HTML", () => {
  const html = applyLaunchHtml(HUB_HTML);
  it("is indexable with the approved canonical, title and social tags", () => {
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).not.toMatch(/noindex|staging/i);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL_URL}" />`);
    expect(html).toContain(`<meta property="og:url" content="${CANONICAL_URL}" />`);
    expect(html).toContain(`<title>${LAUNCH_TITLE}</title>`);
    expect(html).toContain(`<meta name="description" content="${LAUNCH_DESCRIPTION}" />`);
  });
  it("leaves the rest of the page unchanged", () => {
    for (const keep of ['<html lang="en-GB">', '<meta name="theme-color" content="#0a0a0a" />', '<link rel="icon" type="image/x-icon" href="/favicon.ico" />', '<script type="module" src="/src/festivalHub/main.jsx"></script>'])
      expect(html).toContain(keep);
  });
  it("fails loudly if the staging head it replaces has changed", () => {
    expect(() => applyLaunchHtml(HUB_HTML.replace("<title>MSM Festival Hub (Staging)</title>", "<title>x</title>"))).toThrow(/expected exactly one/);
    expect(() => applyLaunchHtml(html)).toThrow(/expected exactly one/);
  });
  it("robots.txt allows all and points at the sitemap; the sitemap lists only the canonical URL", () => {
    expect(PUBLIC_ORIGIN).toBe("https://festivals.musicscenemagazine.co.uk");
    expect(ROBOTS_TXT).toBe("User-agent: *\nAllow: /\nSitemap: https://festivals.musicscenemagazine.co.uk/sitemap.xml\n");
    expect(SITEMAP_XML.match(/<loc>/g)).toHaveLength(1);
    expect(SITEMAP_XML).toContain("<loc>https://festivals.musicscenemagazine.co.uk/</loc>");
  });
});

describe("indexable host regex", () => {
  const re = new RegExp(INDEXABLE_HOST_REGEX);
  it("matches only the exact approved hostname", () => {
    expect(re.test(INDEXABLE_HOST)).toBe(true);
    for (const host of [
      "www.festivals.musicscenemagazine.co.uk", "festivals.musicscenemagazine.co.uk.evil.example",
      "festivalsXmusicscenemagazine.co.uk", "festivals.musicscenemagazineXcoXuk", "evil-festivals.musicscenemagazine.co.uk",
      "musicscenemagazine.co.uk", "msm-festival-hub.vercel.app", "msm-festival-hub-git-release-festival-hub.vercel.app",
      "localhost", "",
    ]) expect(re.test(host), host).toBe(false);
  });
});

describe("release deploy template", () => {
  const release = json("./vercel.release.json");
  const standalone = json("./vercel.json");

  it("builds with build:hub-release, which only adds HUB_RELEASE=1 to the verified standalone build", () => {
    expect(release.buildCommand).toBe("npm run build:hub-release");
    expect(pkg.scripts["build:hub-release"]).toBe("HUB_RELEASE=1 npm run build:hub-standalone");
    expect(pkg.scripts["build:hub-standalone"]).toMatch(/verify-output\.mjs$/);
  });
  it("matches the standalone template apart from the build command and the robots header", () => {
    const { buildCommand: _a, headers: relHeaders, ...rel } = release;
    const { buildCommand: _b, headers: stdHeaders, ...std } = standalone;
    expect(rel).toEqual(std);
    expect(relHeaders[0]).toEqual({ ...stdHeaders[0], headers: stdHeaders[0].headers.filter((h) => h.key !== "X-Robots-Tag") });
    expect(relHeaders).toHaveLength(2);
  });
  it("sends noindex on every host except the approved one (Vercel `missing` host condition)", () => {
    expect(release.headers[1]).toEqual({
      source: "/(.*)",
      missing: [{ type: "host", value: INDEXABLE_HOST_REGEX }],
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    });
    expect(release.headers[0].headers.some((h) => h.key === "X-Robots-Tag")).toBe(false);
  });
  it("adds no HSTS, redirects or catch-all", () => {
    const keys = release.headers.flatMap((r) => r.headers.map((h) => h.key));
    expect(keys).not.toContain("Strict-Transport-Security");
    expect(release.redirects).toBeUndefined();
    expect(release.rewrites.map((r) => r.source)).toEqual(["/", "/festival-hub", "/festival-hub/"]);
  });
});
