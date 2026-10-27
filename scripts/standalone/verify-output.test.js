// The standalone verifier must reject anything other than the hub.
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERIFY = fileURLToPath(new URL("./verify-output.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HTML = '<!DOCTYPE html><html><head><meta name="robots" content="noindex, nofollow" /></head><body><div id="root"></div><script type="module" crossorigin src="/festival-hub/assets/index-abc.js"></script></body></html>';
const GOOD_GRAPH = { "festival-hub/assets/index-abc.js": { modules: ["festival-hub/index.html", "src/festivalHub/main.jsx", "src/festivalHub/FestivalHubApp.jsx", "node_modules/react/index.js", "virtual:commonjsHelpers.js"], imports: [], dynamicImports: [] } };

let dir;
function fixture({ files = {}, graph = GOOD_GRAPH } = {}) {
  const out = join(dir, "out");
  const all = { "festival-hub/index.html": HTML, "festival-hub/assets/index-abc.js": "console.log('hub')", "favicon.ico": "x", "brand/MSM-Logo-Master.png": "x", ...files };
  for (const [name, body] of Object.entries(all)) {
    if (body === null) continue;
    mkdirSync(join(out, name, ".."), { recursive: true });
    writeFileSync(join(out, name), body);
  }
  writeFileSync(join(dir, "graph.json"), JSON.stringify(graph));
  return [out, join(dir, "graph.json")];
}
function verify(args, env = {}) {
  const { VERCEL, ...rest } = process.env;
  return spawnSync(process.execPath, [VERIFY, ...args], { cwd: ROOT, env: { ...rest, ...env }, encoding: "utf8" });
}

describe("standalone output verifier", () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hub-verify-")); return () => rmSync(dir, { recursive: true, force: true }); });

  it("accepts a clean hub-only output", () => {
    const r = verify(fixture());
    expect(r.status, r.stderr).toBe(0);
  });
  it("accepts CSS assets", () => {
    expect(verify(fixture({ files: { "festival-hub/assets/index-abc.css": "body{}" } })).status).toBe(0);
  });

  const rejects = {
    "service worker file": { files: { "sw.js": "x" } },
    "workbox file": { files: { "workbox-123.js": "x" } },
    "manifest": { files: { "manifest.webmanifest": "{}" } },
    "source map": { files: { "festival-hub/assets/index-abc.js.map": "{}" } },
    "calendar bundle": { files: { "assets/index-xyz.js": "x" } },
    "api file": { files: { "api/og.js": "x" } },
    "public directory copy": { files: { "robots.txt": "x", "icons/icon-192.png": "x" } },
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
    expect(included.some((l) => /api|supabase/.test(l))).toBe(false);
    expect(included).toContain("!/src/festivalHub/");
    // gitignore syntax: re-include src/, re-ignore its contents, then allow only src/festivalHub/.
    expect(lines.indexOf("/src/*")).toBe(lines.indexOf("!/src/") + 1);
    expect(lines.indexOf("!/src/festivalHub/")).toBeGreaterThan(lines.indexOf("/src/*"));
    expect(lines).toContain("/src/festivalHub/*.test.js");
  });
});
