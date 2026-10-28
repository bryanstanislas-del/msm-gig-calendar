// The standalone verifier must reject anything other than the hub.
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_URL, ROBOTS_TXT, SITEMAP_XML, applyLaunchHtml } from "./mode.mjs";

const VERIFY = fileURLToPath(new URL("./verify-output.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HTML = '<!DOCTYPE html><html><head><meta name="robots" content="noindex, nofollow" /><title>MSM Festival Hub (Staging)</title></head><body><div id="root"></div><script type="module" crossorigin src="/festival-hub/assets/index-abc.js"></script></body></html>';
const GOOD_GRAPH = { "festival-hub/assets/index-abc.js": { modules: ["festival-hub/index.html", "src/festivalHub/main.jsx", "src/festivalHub/FestivalHubApp.jsx", "src/festivalHub/assets/msm-logo-hub.webp", "node_modules/react/index.js", "virtual:commonjsHelpers.js"], imports: [], dynamicImports: [] } };
// Minimal lossless WebP header ("RIFF" size "WEBP" "VP8L" ...), padded to `size` bytes.
const webp = (size = 64, kind = "VP8L") => { const b = Buffer.alloc(size); b.write("RIFF", 0, "latin1"); b.writeUInt32LE(size - 8, 4); b.write("WEBP", 8, "latin1"); b.write(kind, 12, "latin1"); return b; };
const LOGO = "festival-hub/assets/msm-logo-hub-abc123.webp";

// Launch HTML: the real festival-hub/index.html through the launch transform,
// with the dev entry swapped for a built bundle as Vite does.
const LAUNCH_HTML = applyLaunchHtml(readFileSync(join(ROOT, "festival-hub/index.html"), "utf8"))
  .replace('<script type="module" src="/src/festivalHub/main.jsx"></script>', '<script type="module" crossorigin src="/festival-hub/assets/index-abc.js"></script>');
const LAUNCH_FILES = { "festival-hub/index.html": LAUNCH_HTML, "robots.txt": ROBOTS_TXT, "sitemap.xml": SITEMAP_XML };

let dir;
function fixture({ files = {}, graph = GOOD_GRAPH } = {}) {
  const out = join(dir, "out");
  const all = { "festival-hub/index.html": HTML, "festival-hub/assets/index-abc.js": "console.log('hub')", "favicon.ico": "x", [LOGO]: webp(), ...files };
  for (const [name, body] of Object.entries(all)) {
    if (body === null) continue;
    mkdirSync(join(out, name, ".."), { recursive: true });
    writeFileSync(join(out, name), body);
  }
  writeFileSync(join(dir, "graph.json"), JSON.stringify(graph));
  return [out, join(dir, "graph.json")];
}
function verify(args, env = {}) {
  // Never inherit a build mode from the shell running the tests.
  const rest = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "VERCEL" && k !== "VERCEL_ENV" && !k.startsWith("HUB_")));
  return spawnSync(process.execPath, [VERIFY, ...args], { cwd: ROOT, env: { ...rest, ...env }, encoding: "utf8" });
}

describe("standalone output verifier", () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hub-verify-")); return () => rmSync(dir, { recursive: true, force: true }); });

  it("accepts a clean hub-only output", () => {
    const r = verify(fixture());
    expect(r.status, r.stderr).toBe(0);
  });
  it("accepts a logo exactly at the 350,000 B budget", () => {
    expect(verify(fixture({ files: { [LOGO]: webp(350000) } })).status).toBe(0);
  });
  it("staging mode reports itself and expects exactly 4 files", () => {
    const r = verify(fixture());
    expect(r.stdout).toMatch(/verified \(staging mode\): 4 files/);
  });

  const rejects = {
    "service worker file": { files: { "sw.js": "x" } },
    "workbox file": { files: { "workbox-123.js": "x" } },
    "manifest": { files: { "manifest.webmanifest": "{}" } },
    "source map": { files: { "festival-hub/assets/index-abc.js.map": "{}" } },
    "calendar bundle": { files: { "assets/index-xyz.js": "x" } },
    "api file": { files: { "api/og.js": "x" } },
    "public directory copy": { files: { "icons/icon-192.png": "x" } },
    "a CSS asset (the hub has none; the file count is exact)": { files: { "festival-hub/assets/index-abc.css": "body{}" } },
    "robots.txt in a staging build": { files: { "robots.txt": ROBOTS_TXT } },
    "sitemap.xml in a staging build": { files: { "sitemap.xml": SITEMAP_XML } },
    "a staging build with launch head tags": { files: { "festival-hub/index.html": LAUNCH_HTML } },
    "a staging build with a canonical URL": { files: { "festival-hub/index.html": HTML.replace("</head>", `<link rel="canonical" href="${CANONICAL_URL}" /></head>`) } },
    "a staging build without the staging title": { files: { "festival-hub/index.html": HTML.replace(/<title>.*<\/title>/, "<title>MSM Festival Hub</title>") } },
    "the shared master PNG": { files: { "brand/MSM-Logo-Master.png": "x" } },
    "a PNG in the hub assets": { files: { "festival-hub/assets/logo-abc.png": "x" } },
    "a second WebP": { files: { "festival-hub/assets/msm-logo-hub-def456.webp": webp() } },
    "a missing logo": { files: { [LOGO]: null } },
    "a logo over the 350,000 B budget": { files: { [LOGO]: webp(350001) } },
    "a lossy WebP logo": { files: { [LOGO]: webp(64, "VP8 ") } },
    "an extended-format WebP logo": { files: { [LOGO]: webp(64, "VP8X") } },
    "an unexpected image module in the graph": { graph: { "festival-hub/assets/index-abc.js": { ...GOOD_GRAPH["festival-hub/assets/index-abc.js"], modules: [...GOOD_GRAPH["festival-hub/assets/index-abc.js"].modules, "public/brand/MSM-Logo-Master.png"] } } },
    "backend host in bundle": { files: { "festival-hub/assets/index-abc.js": "fetch('https://abc.supabase.co')" } },
    "JWT in bundle": { files: { "festival-hub/assets/index-abc.js": "const k='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig'" } },
    "service worker registration": { files: { "festival-hub/assets/index-abc.js": "navigator.serviceWorker.register('/sw.js')" } },
    "source map comment": { files: { "festival-hub/assets/index-abc.js": "x\n//# sourceMappingURL=index.js.map" } },
    "API path": { files: { "festival-hub/assets/index-abc.js": "fetch('/api/og')" } },
    "inline script": { files: { "festival-hub/index.html": HTML.replace("</body>", "<script>alert(1)</script></body>") } },
    "missing noindex": { files: { "festival-hub/index.html": HTML.replace(/<meta name="robots"[^>]*>/, "") } },
    "calendar App in graph": { graph: { "festival-hub/assets/index-abc.js": { ...GOOD_GRAPH["festival-hub/assets/index-abc.js"], modules: [...GOOD_GRAPH["festival-hub/assets/index-abc.js"].modules, "src/App.jsx"] } } },
    "backend client in graph": { graph: { "festival-hub/assets/index-abc.js": { ...GOOD_GRAPH["festival-hub/assets/index-abc.js"], modules: [...GOOD_GRAPH["festival-hub/assets/index-abc.js"].modules, "node_modules/@supabase/supabase-js/dist/main/index.js"] } } },
    "PWA register in graph": { graph: { "festival-hub/assets/index-abc.js": { ...GOOD_GRAPH["festival-hub/assets/index-abc.js"], modules: [...GOOD_GRAPH["festival-hub/assets/index-abc.js"].modules, "virtual:pwa-register"] } } },
    "test file in graph": { graph: { "festival-hub/assets/index-abc.js": { ...GOOD_GRAPH["festival-hub/assets/index-abc.js"], modules: [...GOOD_GRAPH["festival-hub/assets/index-abc.js"].modules, "src/festivalHub/status.test.js"] } } },
    "second chunk": { graph: { ...GOOD_GRAPH, "festival-hub/assets/other.js": { modules: [], imports: [], dynamicImports: [] } } },
  };
  for (const [name, spec] of Object.entries(rejects)) {
    it(`rejects ${name}`, () => {
      const r = verify(fixture(spec));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/FAILED verification/);
    });
  }

  describe("launch mode (HUB_LAUNCH=1, or HUB_RELEASE=1 with VERCEL_ENV=production)", () => {
    const launch = (spec = {}) => verify(fixture({ ...spec, files: { ...LAUNCH_FILES, ...spec.files } }), { HUB_LAUNCH: "1" });

    it("accepts the 6-file launch output", () => {
      const r = launch();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/verified \(LAUNCH mode\): 6 files/);
    });
    it("uses launch mode for a release build on a production deployment only", () => {
      const out = fixture({ files: LAUNCH_FILES });
      expect(verify(out, { HUB_RELEASE: "1", VERCEL_ENV: "production" }).status).toBe(0);
      expect(verify(out, { HUB_RELEASE: "1", VERCEL_ENV: "preview" }).status).toBe(1);
      expect(verify(out, { VERCEL_ENV: "production" }).status).toBe(1);
    });

    const launchRejects = {
      "missing robots.txt": { files: { "robots.txt": null } },
      "missing sitemap.xml": { files: { "sitemap.xml": null } },
      "edited robots.txt": { files: { "robots.txt": ROBOTS_TXT.replace("Allow: /", "Disallow: /") } },
      "edited sitemap.xml": { files: { "sitemap.xml": SITEMAP_XML.replace(CANONICAL_URL, "https://example.com/") } },
      "an extra file": { files: { "humans.txt": "x" } },
      "staging HTML": { files: { "festival-hub/index.html": HTML } },
      "a noindex meta": { files: { "festival-hub/index.html": LAUNCH_HTML.replace("index, follow", "noindex, nofollow") } },
      "a wrong canonical": { files: { "festival-hub/index.html": LAUNCH_HTML.replace(`<link rel="canonical" href="${CANONICAL_URL}"`, '<link rel="canonical" href="https://www.festivals.musicscenemagazine.co.uk/"') } },
      "two canonicals": { files: { "festival-hub/index.html": LAUNCH_HTML.replace("</head>", `<link rel="canonical" href="${CANONICAL_URL}" /></head>`) } },
      "a wrong og:url": { files: { "festival-hub/index.html": LAUNCH_HTML.replace(`<meta property="og:url" content="${CANONICAL_URL}"`, '<meta property="og:url" content="https://example.com/"') } },
      "staging text in the HTML": { files: { "festival-hub/index.html": LAUNCH_HTML.replace("</body>", "<p>Staging</p></body>") } },
      "demo fixture links in the JS": { files: { "festival-hub/assets/index-abc.js": "const u='/festival-hub-demo/'" } },
      "demo listing ids in the JS": { files: { "festival-hub/assets/index-abc.js": 'const id="demo-coastline"' } },
      "the demo notice in the JS": { files: { "festival-hub/assets/index-abc.js": "'Demo data: fictional'" } },
      "the demo link in the JS": { files: { "festival-hub/assets/index-abc.js": "'View the demo'" } },
      "the staging banner in the JS": { files: { "festival-hub/assets/index-abc.js": "'Staging preview'" } },
    };
    for (const [name, spec] of Object.entries(launchRejects)) {
      it(`rejects ${name}`, () => {
        const r = launch(spec);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/FAILED verification/);
      });
    }
  });

  it("on Vercel, fails if api/ is present in the checkout (.vercelignore not applied)", () => {
    const r = verify(fixture(), { VERCEL: "1" }); // this repo checkout has api/
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/api\/ is present in the Vercel build checkout/);
  });
});

describe("standalone deploy templates", () => {
  const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"));
  const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  const directives = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));

  it("builds only the hub and serves it at / and /festival-hub(/) with no catch-all", () => {
    expect(vercel.buildCommand).toBe("npm run build:hub-standalone");
    expect(vercel.outputDirectory).toBe("dist-hub-standalone");
    expect(vercel.rewrites.map((r) => r.source)).toEqual(["/", "/festival-hub", "/festival-hub/"]);
    expect(new Set(vercel.rewrites.map((r) => r.destination))).toEqual(new Set(["/festival-hub/index.html"]));
    expect(vercel.redirects).toBeUndefined();
  });
  it("CSP blocks network, workers, forms and plugins; allows only required style/font hosts", () => {
    expect(directives).toMatchObject({
      "default-src": "'none'", "script-src": "'self'", "connect-src": "'none'", "worker-src": "'none'",
      "form-action": "'none'", "base-uri": "'self'", "object-src": "'none'", "manifest-src": "'none'",
      "style-src": "'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src": "https://fonts.gstatic.com", "img-src": "'self'",
    });
  });
  it("sends noindex on every response", () => {
    expect(vercel.headers[0].source).toBe("/(.*)");
    expect(vercel.headers[0].headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  });
  it(".vercelignore ignores everything, re-includes only build inputs, never api/ or supabase/", () => {
    const lines = readFileSync(new URL("./.vercelignore", import.meta.url), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
    expect(lines[0]).toBe("/*");
    const included = lines.filter((l) => l.startsWith("!"));
    expect(included.some((l) => /api|supabase|brand/.test(l))).toBe(false);
    expect(included).toContain("!/src/festivalHub/");
    // gitignore syntax: re-include src/, re-ignore its contents, then allow only src/festivalHub/.
    expect(lines.indexOf("/src/*")).toBe(lines.indexOf("!/src/") + 1);
    expect(lines.indexOf("!/src/festivalHub/")).toBeGreaterThan(lines.indexOf("/src/*"));
    expect(lines).toContain("/src/festivalHub/*.test.js");
  });
});
