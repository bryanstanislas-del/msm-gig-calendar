// Deployment route-resolution regression tests.
//
// Uses Vercel's own @vercel/routing-utils getTransformedRoutes() to turn the
// REAL vercel.json into the platform route table, then resolves request
// paths against the REAL build output (dist/ from `vite build`) and the
// REAL api/ function files, following the documented Build Output API
// semantics: pre-filesystem routes (redirects) -> {handle:"filesystem"} ->
// rewrites in order, where `check: true` means "if the rewritten path is
// not an existing static file or function, keep matching later routes".
//
// This is a local model, not the Vercel edge. It is validated by replaying
// the PREVIOUS layout (dynamic api/ads/[action].js + no ads rewrite), which
// reproduces exactly what the live preview returned for 96cc773: the SPA
// index.html for /api/ads/delivery. Dynamic [param] function files are
// modelled as NOT matched before the SPA fallback, as observed live.
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getTransformedRoutes } from "@vercel/routing-utils";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const ADS_ACTIONS = ["checkout", "webhook", "delivery", "creative", "click", "impression", "submit-creative", "report"];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Function paths per Vercel zero-config: api/**\/*.js, skipping _-prefixed files/dirs. */
function functionFiles(apiFiles) {
  return apiFiles
    .map((f) => "/" + relative(ROOT, f).split(sep).join("/"))
    .filter((p) => p.endsWith(".js") && !p.split("/").some((seg) => seg.startsWith("_")));
}

function makeResolver({ vercelConfig, staticPaths, functionPaths }) {
  const { routes, error } = getTransformedRoutes(vercelConfig);
  if (error) throw new Error(JSON.stringify(error));
  const fns = new Map();
  for (const f of functionPaths) {
    if (/\[[^\]]+\]/.test(f)) continue; // dynamic: not matched before the SPA fallback (observed live)
    fns.set(f.replace(/\.js$/, ""), f);
  }
  const fsHit = (path) => (staticPaths.has(path) ? { kind: "static", file: path } : fns.has(path) ? { kind: "function", file: fns.get(path) } : null);

  return function resolve(url, { host = "preview.example.vercel.app" } = {}) {
    let [path, qs = ""] = url.split("?");
    const query = new URLSearchParams(qs);
    const fsIndex = routes.findIndex((r) => r.handle === "filesystem");
    for (const r of routes.slice(0, fsIndex)) {
      if (r.has && !r.has.every((h) => h.type === "host" && h.value === host)) continue;
      if (new RegExp(r.src).test(path) && r.status) return { kind: "redirect", status: r.status };
    }
    let hit = fsHit(path);
    if (hit) return { ...hit, query: Object.fromEntries(query) };
    for (const r of routes.slice(fsIndex + 1)) {
      const m = new RegExp(r.src).exec(path);
      if (!m) continue;
      const dest = r.dest.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? "");
      const [dPath, dQs = ""] = dest.split("?");
      path = dPath;
      for (const [k, v] of new URLSearchParams(dQs)) query.set(k, v);
      if (r.check) {
        hit = fsHit(path);
        if (hit) return { ...hit, query: Object.fromEntries(query) };
        continue;
      }
      return { kind: "unresolved", file: path };
    }
    return { kind: "404" };
  };
}

let current, previous, staticPaths, swSource;

beforeAll(() => {
  if (!existsSync(join(DIST, "index.html"))) execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });
  staticPaths = new Set(walk(DIST).map((f) => "/" + relative(DIST, f).split(sep).join("/")));
  swSource = readFileSync(join(DIST, "sw.js"), "utf8");
  const vercelConfig = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const fnFiles = functionFiles(walk(join(ROOT, "api")));
  current = makeResolver({ vercelConfig, staticPaths, functionPaths: fnFiles });

  // The layout deployed at 96cc773: dynamic router file, no ads rewrite.
  const prevConfig = { ...vercelConfig, rewrites: vercelConfig.rewrites.filter((r) => !r.source.startsWith("/api/ads")) };
  const prevFns = fnFiles.filter((f) => f !== "/api/ads.js").concat("/api/ads/[action].js");
  previous = makeResolver({ vercelConfig: prevConfig, staticPaths, functionPaths: prevFns });
}, 120000);

describe("route resolution model is faithful to the observed live failure", () => {
  it("previous layout reproduces the preview bug: /api/ads/delivery served the SPA index.html", () => {
    expect(previous("/api/ads/delivery?placement=wordpress-home-top")).toMatchObject({ kind: "static", file: "/index.html" });
  });
});

describe("advertising API routes resolve to the ads function, never the SPA", () => {
  it.each(ADS_ACTIONS)("/api/ads/%s -> api/ads.js with action, original query preserved", (action) => {
    const r = current(`/api/ads/${action}?placement=wordpress-home-top&t=abc.def`);
    expect(r.kind).toBe("function");
    expect(r.file).toBe("/api/ads.js");
    expect(r.query).toMatchObject({ action, placement: "wordpress-home-top", t: "abc.def" });
  });
  it("unknown single-segment actions still reach the function (which answers JSON 404)", () => {
    expect(current("/api/ads/nope")).toMatchObject({ kind: "function", file: "/api/ads.js", query: { action: "nope" } });
  });
  it("no dynamic [param] function files exist under api/ (they were shadowed live)", () => {
    const dynamic = functionFiles(walk(join(ROOT, "api"))).filter((f) => /\[[^\]]+\]/.test(f));
    expect(dynamic).toEqual([]);
  });
});

describe("existing routes are preserved", () => {
  it.each([
    ["/api/gig", "/api/gig.js", {}],
    ["/api/og?type=band&slug=x", "/api/og.js", { type: "band", slug: "x" }],
    ["/api/notify", "/api/notify.js", {}],
    ["/api/sitemap", "/api/sitemap.js", {}],
    ["/api/robots", "/api/robots.js", {}],
    ["/sitemap.xml", "/api/sitemap.js", {}],
    ["/robots.txt", "/api/robots.js", {}],
    ["/gig/some-gig-slug", "/api/gig.js", { slug: "some-gig-slug" }],
    ["/artist/some-band", "/api/og.js", { type: "band", slug: "some-band" }],
    ["/venue/some-venue", "/api/og.js", { type: "venue", slug: "some-venue" }],
    ["/festival/some-fest", "/api/og.js", { type: "festival", slug: "some-fest" }],
  ])("%s -> %s", (url, file, query) => {
    const r = current(url);
    expect(r).toMatchObject({ kind: "function", file });
    expect(r.query).toMatchObject(query);
  });
  it.each(["/", "/claim", "/promoter/some-promoter", "/some/deep/spa/path"])("SPA path %s -> index.html", (url) => {
    expect(current(url)).toMatchObject({ kind: "static", file: "/index.html" });
  });
  it("built static assets are served from the filesystem", () => {
    const asset = [...staticPaths].find((p) => p.startsWith("/assets/") && p.endsWith(".js"));
    expect(asset).toBeTruthy();
    expect(current(asset)).toMatchObject({ kind: "static", file: asset });
    expect(current("/sw.js")).toMatchObject({ kind: "static", file: "/sw.js" });
    expect(current("/brand/MSM-Logo-Master.png")).toMatchObject({ kind: "static" });
  });
  it("vercel.app host redirect still applies before everything", () => {
    expect(current("/api/ads/delivery", { host: "msm-gig-calendar.vercel.app" })).toMatchObject({ kind: "redirect", status: 308 });
  });
});

describe("built service worker never answers /api navigations with the SPA shell", () => {
  it("navigation fallback denylist excludes /api/", () => {
    expect(swSource).toMatch(/NavigationRoute/);
    expect(swSource).toMatch(/denylist:\s*\[\s*\/\^\\\/api\\\/\//);
  });
});
