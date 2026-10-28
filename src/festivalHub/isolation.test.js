// The Festival Hub must not load the calendar app, any backend client, the
// service worker registration, or make any network request of its own.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HUB_DIR = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HUB_DIR, "main.jsx");
const ALLOWED_PACKAGES = new Set(["react", "react-dom/client"]);
const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|export\s[^'"]*?from\s*)['"]([^'"]+)['"]/g;

function walk(file, seen = new Set(), packages = new Set()) {
  if (seen.has(file)) return { seen, packages };
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const [, spec] of src.matchAll(IMPORT_RE)) {
    if (spec.startsWith(".")) {
      const target = resolve(dirname(file), spec);
      expect(existsSync(target), `${spec} from ${relative(HUB_DIR, file)}`).toBe(true);
      walk(target, seen, packages);
    } else {
      packages.add(spec);
    }
  }
  return { seen, packages };
}

describe("festival hub isolation", () => {
  const { seen, packages } = walk(ENTRY);

  it("only reaches files inside src/festivalHub", () => {
    for (const f of seen) expect(relative(HUB_DIR, f).startsWith(".."), f).toBe(false);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("only imports React packages", () => {
    for (const p of packages) expect(ALLOWED_PACKAGES.has(p), p).toBe(true);
  });

  it("contains no network, backend or service-worker code", () => {
    const banned = [/supabase/i, /fmlaaiolqwknowhtdeue/, /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /serviceWorker/, /registerSW/, /\.\.\/App/];
    const files = readdirSync(HUB_DIR).filter((f) => /\.(jsx?|mjs)$/.test(f) && !f.endsWith(".test.js"));
    for (const f of files) {
      const src = readFileSync(resolve(HUB_DIR, f), "utf8");
      for (const re of banned) expect(re.test(src), `${f} matches ${re}`).toBe(false);
    }
  });

  it("hub HTML is noindex and loads only the hub entry", () => {
    const html = readFileSync(resolve(HUB_DIR, "../../festival-hub/index.html"), "utf8");
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(["/src/festivalHub/main.jsx"]);
  });
});

describe("routing config", () => {
  const root = resolve(HUB_DIR, "../..");
  it("vercel rewrites send exactly /festival-hub and /festival-hub/ to the hub document, before the catch-all", () => {
    const { rewrites } = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
    const hub = rewrites.filter((r) => r.source.startsWith("/festival-hub"));
    expect(hub).toEqual([
      { source: "/festival-hub", destination: "/festival-hub/index.html" },
      { source: "/festival-hub/", destination: "/festival-hub/index.html" },
    ]);
    const catchAll = rewrites.findIndex((r) => r.source === "/(.*)");
    expect(rewrites.indexOf(hub[1])).toBeLessThan(catchAll);
  });
  it("calendar service worker never answers hub navigations with the calendar shell", () => {
    const cfg = readFileSync(resolve(root, "vite.config.js"), "utf8");
    expect(cfg).toContain("navigateFallbackDenylist: [/^\\/api\\//, /^\\/festival-hub(\\/|$)/]");
  });
  it("no database migration or SQL files are part of the hub", () => {
    const sqlish = (dir) => existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => /festival.?hub/i.test(String(f))) : [];
    expect(sqlish(resolve(root, "supabase"))).toEqual([]);
  });
});
