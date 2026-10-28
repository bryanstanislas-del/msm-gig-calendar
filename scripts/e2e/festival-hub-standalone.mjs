// Festival Hub STANDALONE / RELEASE build checks (Playwright, Chromium).
//
//   npm run test:e2e:hub-standalone
//
// 1. Default: simulates the deploy-branch upload (scripts/standalone/.vercelignore)
//    and builds the hub from ONLY those files with VERCEL=1 (so the output
//    verifier also enforces that api/ and supabase/ are absent).
//    STANDALONE_CHECKOUT=<dir>: instead uses an actual git checkout of a
//    deploy/release branch (with node_modules installed, e.g. `npm ci`),
//    checks its TRACKED tree is hub-only, and uses that checkout's own
//    vercel.json -- what Vercel's Git integration does.
//    STANDALONE_TEMPLATE=<path>: which template becomes vercel.json in the
//    simulated upload (default scripts/standalone/vercel.json; the release
//    template is scripts/standalone/vercel.release.json).
//    The build runs the vercel.json `buildCommand` with VERCEL=1 and
//    VERCEL_ENV=preview (override VERCEL_ENV, or HUB_LAUNCH=1, to exercise a
//    launch build locally).
//    HUB_EXPECT=staging|launch (default staging): the build mode that must result.
// 2. Serves that output with the routing and headers read from vercel.json:
//    filesystem first, then the exact rewrites, otherwise 404 -- the same
//    order Vercel uses -- applying header rules with their `has`/`missing`
//    host conditions (string values are regexes, as in Vercel's schema).
// 3. Checks routing, 404s, headers/CSP/indexing per host, rendering at / and
//    /festival-hub(/), the build mode (staging banner + demo, or launch head
//    tags + no demo), no service worker, no backend/API/calendar requests,
//    local saves, and that mode links stay on this site.
//
// All non-local requests are aborted. Google Fonts requests are answered by
// a local stub so the CSP font/style allowances are exercised without
// leaving the machine. Date is frozen at 27 Oct 2026 12:00 UK time.
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CANONICAL_URL, INDEXABLE_HOST, LAUNCH_TITLE, ROBOTS_TXT, SITEMAP_XML } from "../standalone/mode.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = resolve(process.env.E2E_OUT || join(tmpdir(), "festival-hub-standalone-e2e"));
mkdirSync(OUT, { recursive: true });
const CHECKOUT = process.env.STANDALONE_CHECKOUT ? resolve(process.env.STANDALONE_CHECKOUT) : null;
const TEMPLATE = process.env.STANDALONE_TEMPLATE || "scripts/standalone/vercel.json";
const VERCEL_JSON = JSON.parse(readFileSync(CHECKOUT ? join(CHECKOUT, "vercel.json") : join(ROOT, TEMPLATE), "utf8"));
const EXPECT = process.env.HUB_EXPECT || "staging";
const LAUNCH = EXPECT === "launch";
const RELEASE_CONFIG = /build:hub-release/.test(VERCEL_JSON.buildCommand || "");
const FROZEN_NOW = new Date("2026-10-27T11:00:00Z");

const results = [];
let failed = 0;
async function check(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}${note ? ` — ${note}` : ""}`); }
  catch (e) { failed++; results.push({ name, ok: false }); console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
console.log(`Expecting a ${EXPECT.toUpperCase()} build from ${CHECKOUT ? `checkout ${CHECKOUT}` : TEMPLATE} (buildCommand: ${VERCEL_JSON.buildCommand})`);

// ── 1. Build exactly what the deploy branch would upload ────────────
// Anything outside the hub build inputs: API, database, calendar code/config/HTML, calendar public files, tests.
const NOT_HUB = /^(api|supabase)\/|^src\/(?!festivalHub\/)|^vite\.config\.js$|^vite\.festival-hub\.config\.js$|^index\.html$|^public\/(?!favicon\.ico$)|\.test\.js$|(^|\/)sw\.js$|manifest/;
const work = mkdtempSync(join(tmpdir(), "hub-standalone-"));
let SRC;
if (CHECKOUT) {
  console.log(`Standalone — actual git checkout ${CHECKOUT}`);
  SRC = CHECKOUT;
  const tracked = execFileSync("git", ["ls-files"], { cwd: SRC, encoding: "utf8" }).split("\n").filter(Boolean);
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: SRC, encoding: "utf8" }).trim();
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: SRC, encoding: "utf8" }).trim();
  await check("tracked tree of the deploy checkout is hub-only (no api/, supabase/, calendar App/client/entry/public/SW)", async () => {
    const bad = tracked.filter((f) => NOT_HUB.test(f));
    assert(bad.length === 0, `non-hub tracked files: ${bad.join(", ")}`);
    for (const dir of ["api", "supabase"]) assert(!existsSync(join(SRC, dir)), `${dir}/ exists in checkout`);
    assert(tracked.includes("vercel.json") && tracked.includes("src/festivalHub/main.jsx"), "build inputs missing");
    return `${branch} @ ${sha.slice(0, 7)}: ${tracked.length} tracked files`;
  });
} else {
  console.log(`Standalone — simulated Vercel upload and build (template ${TEMPLATE})`);
  const upload = JSON.parse(execFileSync(process.execPath, [join(ROOT, "scripts/standalone/simulate-vercel-upload.mjs"), join(work, "src")], { encoding: "utf8", env: { ...process.env, STANDALONE_TEMPLATE: TEMPLATE } }));
  SRC = upload.dest;
  await check("upload allowlist excludes api/, supabase/ and all calendar code", async () => {
    const bad = upload.files.filter((f) => NOT_HUB.test(f));
    assert(bad.length === 0, `unexpected upload files: ${bad.join(", ")}`);
    assert(upload.files.includes("vercel.json") && upload.files.includes("src/festivalHub/main.jsx"), "build inputs missing");
    return `${upload.files.length} files uploaded`;
  });
  cpSync(join(ROOT, "node_modules"), join(SRC, "node_modules"), { recursive: true, verbatimSymlinks: true });
}
let buildLog = "";
await check(`vercel.json buildCommand + output verifier pass with VERCEL=1 (${EXPECT} mode)`, async () => {
  const env = { ...process.env, VERCEL: "1", VERCEL_ENV: process.env.VERCEL_ENV || "preview" };
  buildLog = execFileSync("sh", ["-c", VERCEL_JSON.buildCommand], { cwd: SRC, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const m = buildLog.match(/output verified \((\w+) mode\): .*$/m);
  assert(m, buildLog.slice(-500));
  assert(m[1].toLowerCase() === EXPECT, `built in ${m[1]} mode, expected ${EXPECT}`);
  return m[0];
});
const DIST = join(SRC, VERCEL_JSON.outputDirectory);
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)).map((x) => `${n}/${x}`) : [n]));
const distFiles = walk(DIST).sort();
const hubJs = distFiles.find((f) => /^festival-hub\/assets\/.+\.js$/.test(f));
const hubLogo = distFiles.find((f) => /^festival-hub\/assets\/msm-logo-hub-[\w-]+\.webp$/.test(f));

// ── 2. Server mirroring vercel.json ──────────────────────────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
const REWRITES = new Map(VERCEL_JSON.rewrites.map((r) => [r.source, r.destination]));
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
// Header rules: every rule here uses source "/(.*)"; conditions are host-only.
function conditionMet(cond, host) {
  assert(cond.type === "host" && typeof cond.value === "string", `harness supports host conditions only: ${JSON.stringify(cond)}`);
  return new RegExp(cond.value).test(host);
}
function headersFor(host) {
  const out = {};
  for (const rule of VERCEL_JSON.headers) {
    assert(rule.source === "/(.*)", `harness supports source "/(.*)" only: ${rule.source}`);
    if ((rule.has || []).some((c) => !conditionMet(c, host))) continue;
    if ((rule.missing || []).some((c) => conditionMet(c, host))) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}
const hostOf = (req) => (req.headers.host || "").replace(/:\d+$/, "");
function serve(dist, req, res, fallbackToHub) {
  // Raw request path, matched exactly like Vercel's rewrites. (No URL
  // re-parsing: new URL("//host/", base) would read it as protocol-relative.)
  let path;
  try { path = decodeURIComponent(req.url.split("?")[0]); } catch { path = ""; }
  const fsPath = normalize(join(dist, path));
  let target = null;
  if (fsPath.startsWith(dist + "/") && isFile(fsPath)) target = fsPath;
  else if (REWRITES.has(path)) target = join(dist, REWRITES.get(path));
  else if (fallbackToHub) target = join(dist, "festival-hub/index.html");
  const headers = headersFor(hostOf(req));
  if (!target) { res.writeHead(404, { ...headers, "content-type": "text/plain" }); return res.end("404"); }
  res.writeHead(200, { ...headers, "content-type": TYPES[extname(target)] || "application/octet-stream" });
  res.end(readFileSync(target));
}
const server = http.createServer((req, res) => serve(DIST, req, res, false));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const rawGet = (path, host) => new Promise((done, fail) => {
  const req = http.request({ host: "127.0.0.1", port: server.address().port, path, method: "GET", headers: host ? { Host: host } : {} }, (res) => {
    let body = ""; res.setEncoding("utf8"); res.on("data", (c) => { body += c; }); res.on("end", () => done({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on("error", fail); req.end();
});

// ── 3a. HTTP routing and headers ─────────────────────────────────────
console.log(`Standalone — routing and headers at ${ORIGIN}`);
const get = (p) => fetch(ORIGIN + p, { redirect: "manual" });
const EXTRA_FILES = LAUNCH ? ["robots.txt", "sitemap.xml"] : [];
await check(`output contains only hub files (${LAUNCH ? 6 : 4})`, async () => {
  assert(JSON.stringify(distFiles) === JSON.stringify(["favicon.ico", hubJs, hubLogo, "festival-hub/index.html", ...EXTRA_FILES].sort()), distFiles.join(", "));
  assert(statSync(join(DIST, hubLogo)).size === 342906, "hub logo size");
  return distFiles.join(", ");
});
await check(`hub HTML (${EXPECT} head) at /, /festival-hub, /festival-hub/, /festival-hub/index.html, /?demo=1`, async () => {
  for (const p of ["/", "/festival-hub", "/festival-hub/", "/festival-hub/index.html", "/?demo=1"]) {
    const r = await get(p);
    const body = await r.text();
    assert(r.status === 200, `${p}: ${r.status}`);
    if (LAUNCH) {
      assert(body.includes(`<title>${LAUNCH_TITLE}</title>`) && body.includes(`<link rel="canonical" href="${CANONICAL_URL}" />`) && body.includes('<meta name="robots" content="index, follow" />') && !/staging/i.test(body), `${p}: launch head`);
    } else {
      assert(/<title>MSM Festival Hub \(Staging\)<\/title>/.test(body) && body.includes('<meta name="robots" content="noindex, nofollow" />') && !body.includes('rel="canonical"'), `${p}: staging head`);
    }
  }
});
await check("assets served with correct types", async () => {
  const assets = [[`/${hubJs}`, "text/javascript"], [`/${hubLogo}`, "image/webp"], ["/favicon.ico", "image/x-icon"]];
  if (LAUNCH) assets.push(["/robots.txt", "text/plain"], ["/sitemap.xml", "application/xml"]);
  for (const [p, type] of assets) {
    const r = await get(p);
    assert(r.status === 200 && r.headers.get("content-type").startsWith(type), `${p}: ${r.status} ${r.headers.get("content-type")}`);
  }
  if (LAUNCH) {
    assert(await (await get("/robots.txt")).text() === ROBOTS_TXT, "robots.txt content");
    assert(await (await get("/sitemap.xml")).text() === SITEMAP_XML, "sitemap.xml content");
  }
});
const NOT_FOUND = ["/api/og", "/api/gig", "/api/notify", "/api/sitemap", "/api/robots", "/sw.js", "/manifest.webmanifest", "/workbox-9c191d2f.js",
  "/assets/index-yiBhUoVF.js", "/index.html", "/gig/x", "/artist/x", "/venue/x", "/festival/x", "/promoter/x", "/claim",
  "/icons/icon-192.png", "/google9ef7fb7e9cd22e56.html", "/brand/README.md", "/brand/MSM-Logo-Master.png", "/festival-hub/x", "/festival-hubs", "/random",
  "//evil.example/", "//evil.example", "/\\evil.example/", "/festival-hub//evil.example/", ...(LAUNCH ? [] : ["/robots.txt", "/sitemap.xml"])];
await check(`404 for unknown, calendar, API, SW and manifest paths (${NOT_FOUND.length})`, async () => {
  const wrong = [];
  for (const p of NOT_FOUND) { const r = await get(p); if (r.status !== 404) wrong.push(`${p}=${r.status}`); }
  assert(!wrong.length, wrong.join(", "));
});
await check("CSP and security headers on every response (200 and 404), for every host", async () => {
  const csp = VERCEL_JSON.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  for (const host of [null, INDEXABLE_HOST, "www.festivals.musicscenemagazine.co.uk"]) {
    for (const p of ["/", `/${hubJs}`, "/api/og", "/random"]) {
      const r = await rawGet(p, host);
      assert(r.headers["content-security-policy"] === csp, `${host || "default"} ${p}: CSP`);
      assert(r.headers["x-content-type-options"] === "nosniff", `${host || "default"} ${p}: nosniff`);
      assert(!r.headers["strict-transport-security"], `${host || "default"} ${p}: unexpected HSTS`);
    }
  }
});
const NOINDEX_HOSTS = ["127.0.0.1", "msm-festival-hub.vercel.app", "msm-gig-calendar-abc123-msm-gig-calendar-s-projects.vercel.app", "www.festivals.musicscenemagazine.co.uk",
  "festivals.musicscenemagazine.co.uk.evil.example", "festivalsXmusicscenemagazine.co.uk", "calendar.musicscenemagazine.co.uk"];
await check(RELEASE_CONFIG
  ? `X-Robots-Tag noindex on every host except ${INDEXABLE_HOST} (${NOINDEX_HOSTS.length} hosts checked)`
  : "X-Robots-Tag noindex on every host, including the public hostname (staging config never indexable)", async () => {
  for (const host of NOINDEX_HOSTS) {
    for (const p of ["/", "/robots.txt", "/random"]) {
      const r = await rawGet(p, host);
      assert(r.headers["x-robots-tag"] === "noindex, nofollow", `${host} ${p}: X-Robots-Tag ${r.headers["x-robots-tag"]}`);
    }
  }
  for (const p of ["/", "/robots.txt", "/random"]) {
    const r = await rawGet(p, INDEXABLE_HOST);
    if (RELEASE_CONFIG) assert(r.headers["x-robots-tag"] === undefined, `${INDEXABLE_HOST} ${p}: X-Robots-Tag ${r.headers["x-robots-tag"]}`);
    else assert(r.headers["x-robots-tag"] === "noindex, nofollow", `${INDEXABLE_HOST} ${p}: staging config must stay noindex`);
  }
  assert(RELEASE_CONFIG === VERCEL_JSON.headers.some((h) => h.missing), "only release configs may carry the host-conditional rule");
});

// ── 3b. Browser ──────────────────────────────────────────────────────
const browser = await chromium.launch();
const FONT_CSS = "@font-face{font-family:'Barlow';src:url(https://fonts.gstatic.com/s/barlow/stub.woff2) format('woff2');}";
async function newContext(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "allow", ...opts });
  await ctx.clock.setFixedTime(FROZEN_NOW);
  const log = { requests: [], external: [], fonts: [], csp: [], pageErrors: [], console: [] };
  ctx.on("request", (r) => {
    const u = r.url();
    log.requests.push(u);
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) log.fonts.push(u);
    else if (!u.startsWith(ORIGIN) && !u.startsWith("data:")) log.external.push(u);
  });
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(ORIGIN)) return route.continue();
    if (u.startsWith("https://fonts.googleapis.com/")) return route.fulfill({ status: 200, contentType: "text/css", body: FONT_CSS });
    if (u.startsWith("https://fonts.gstatic.com/")) return route.fulfill({ status: 200, contentType: "font/woff2", body: "" });
    return route.abort("blockedbyclient");
  });
  await ctx.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window.__cspViolations ||= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => log.pageErrors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") log.console.push(m.text()); });
  });
  return { ctx, log };
}
const countText = (page) => page.getByRole("status").first().textContent();
const ready = (page) => page.getByRole("heading", { level: 1, name: /Festival Hub 2027/ }).waitFor();
const stagingBanner = (page) => page.getByRole("note").filter({ hasText: "Staging preview" });
const demoLinks = (page) => page.getByRole("link", { name: /View the demo|Back to the real directory|Preview the hub with demo data/ });
const cspViolations = (page) => page.evaluate(() => window.__cspViolations || []);
const swState = (page) => page.evaluate(async () => ({
  registrations: (await navigator.serviceWorker.getRegistrations()).length,
  controller: !!navigator.serviceWorker.controller,
}));
function assertClean(log, label) {
  assert(log.external.length === 0, `${label}: external requests ${log.external.join(", ")}`);
  const bad = log.requests.filter((u) => u.startsWith(ORIGIN) && /\/(api|assets)\/|sw\.js|manifest|workbox/.test(new URL(u).pathname) && !new URL(u).pathname.startsWith("/festival-hub/assets/"));
  assert(bad.length === 0, `${label}: calendar/API/SW requests ${bad.join(", ")}`);
  assert(log.pageErrors.length === 0, `${label}: page errors ${log.pageErrors.join(" | ")}`);
  return `${log.requests.filter((u) => u.startsWith(ORIGIN)).length} local requests, ${log.fonts.length} font requests (stubbed), 0 backend/API/SW`;
}

console.log("Standalone — browser (fresh contexts, clock frozen 27 Oct 2026 12:00 UK)");
for (const path of ["/", "/festival-hub", "/festival-hub/"]) {
  const { ctx, log } = await newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await check(`fresh visit to ${path}: hub renders with real data and MSM styling (${EXPECT} chrome), no SW, no CSP violations`, async () => {
    const resp = await page.goto(ORIGIN + path);
    assert(resp.status() === 200, `status ${resp.status()}`);
    await ready(page);
    assert(/26 listings · 13 open now/.test(await countText(page)), await countText(page));
    const style = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily }));
    assert(style.bg === "rgb(13, 13, 13)" && /Barlow/.test(style.font), JSON.stringify(style));
    if (LAUNCH) {
      assert(await stagingBanner(page).count() === 0, "staging banner shown in a launch build");
      assert(await demoLinks(page).count() === 0, "demo links shown in a launch build");
      assert(await page.title() === LAUNCH_TITLE, `title ${await page.title()}`);
    } else {
      assert(await stagingBanner(page).count() === 1, "staging banner missing");
      assert(await page.evaluate(() => getComputedStyle(document.querySelector(".fh-staging")).backgroundColor) === "rgb(255, 255, 255)", "staging banner style");
      assert(await page.getByRole("link", { name: /View the demo/ }).count() === 1, "demo link missing in staging");
    }
    assert(await page.getByAltText("Music Scene Magazine").evaluate((img) => img.complete && img.naturalWidth > 0), "logo not loaded");
    assert(await page.getByAltText("Music Scene Magazine").evaluate((img) => new URL(img.src).pathname.startsWith("/festival-hub/assets/msm-logo-hub-") && img.naturalWidth === 1254), "hub logo is not the derived WebP");
    assert(log.fonts.some((u) => u.includes("fonts.googleapis.com")) && log.fonts.some((u) => u.includes("fonts.gstatic.com")), `fonts not requested: ${log.fonts}`);
    await page.locator(".fh-card").first().click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    const v = await cspViolations(page);
    assert(v.length === 0, `CSP violations during normal use: ${v.join(", ")}`);
    const sw = await swState(page);
    assert(sw.registrations === 0 && !sw.controller, JSON.stringify(sw));
    if (path === "/") await page.screenshot({ path: join(OUT, `standalone-root-${EXPECT}.png`), fullPage: true });
    return assertClean(log, path);
  });
  await ctx.close();
}

{
  const { ctx, log } = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`);
  await ready(page);
  await check("forced service-worker registration is blocked by CSP (worker-src 'none')", async () => {
    const res = await page.evaluate((js) => navigator.serviceWorker.register(js).then(() => "registered", (e) => `rejected: ${e.message}`), `/${hubJs}`);
    assert(res.startsWith("rejected"), res);
    const sw = await swState(page);
    assert(sw.registrations === 0, "a registration exists");
    const v = await cspViolations(page);
    assert(v.some((x) => x.startsWith("worker-src")), `no worker-src violation: ${v}`);
    return res.slice(0, 120);
  });
  await check("forced backend and API fetches are blocked by CSP (connect-src 'none') before any request", async () => {
    const before = log.requests.length;
    const res = await page.evaluate(async () => Promise.all([
      "https://fmlaaiolqwknowhtdeue.supabase.co/rest/v1/public_gigs", "/api/og", "/festival-hub/index.html",
    ].map((u) => fetch(u).then(() => `${u}: fetched`, () => `${u}: blocked`))));
    assert(res.every((r) => r.endsWith("blocked")), res.join(", "));
    assert(log.requests.length === before, `requests were sent: ${log.requests.slice(before)}`);
    const v = await cspViolations(page);
    assert(v.filter((x) => x.startsWith("connect-src")).length >= 3, `connect-src violations: ${v}`);
  });
  await ctx.close();
}

{
  const { ctx, log } = await newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await check(LAUNCH ? "local saves persist; the demo is disabled (?demo=1 and demo ids show the real directory only)" : "local saves persist at / and real/demo stay separate", async () => {
    await page.goto(`${ORIGIN}/#festival=twyfest`);
    await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).click();
    await page.getByRole("dialog").getByLabel("Stage", { exact: true }).selectOption("preparing");
    await page.reload();
    await page.getByRole("dialog").getByLabel("Stage", { exact: true }).waitFor();
    assert(await page.getByRole("dialog").getByLabel("Stage", { exact: true }).inputValue() === "preparing", "real save lost");
    await page.keyboard.press("Escape");
    if (LAUNCH) {
      assert(await demoLinks(page).count() === 0, "demo link in launch build");
      await page.goto(`${ORIGIN}/?demo=1`);
      await ready(page);
      assert(/26 listings · 13 open now · 1 on your shortlist/.test(await countText(page)), `?demo=1 count: ${await countText(page)}`);
      assert(await page.getByRole("note").filter({ hasText: "Demo data" }).count() === 0 && await page.locator(".fh-badge-demo").count() === 0, "demo UI in launch build");
      await page.goto(`${ORIGIN}/?demo=1#festival=demo-coastline`);
      await page.getByRole("dialog").getByText("Listing not found").waitFor();
      const stores = await page.evaluate(() => [localStorage.getItem("msm.festivalHub.real.v1"), localStorage.getItem("msm.festivalHub.demo.v1")]);
      assert(/"twyfest"/.test(stores[0]) && stores[1] === null, `stores: ${JSON.stringify(stores)}`);
    } else {
      const demoHref = await page.getByRole("link", { name: /View the demo/ }).getAttribute("href");
      assert(demoHref === "/?demo=1", `demo toggle href ${demoHref}`);
      await page.getByRole("link", { name: /View the demo/ }).click();
      await page.getByRole("note").filter({ hasText: "Demo data" }).waitFor();
      assert(/10 demo listings/.test(await countText(page)) && !/shortlist/.test(await countText(page)), await countText(page));
      await page.goto(`${ORIGIN}/?demo=1#festival=demo-coastline`);
      await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).click();
      const stores = await page.evaluate(() => [localStorage.getItem("msm.festivalHub.real.v1"), localStorage.getItem("msm.festivalHub.demo.v1")]);
      assert(/"twyfest"/.test(stores[0]) && !/demo-/.test(stores[0]), `real store: ${stores[0]}`);
      assert(/"demo-coastline"/.test(stores[1]) && !/twyfest/.test(stores[1]), `demo store: ${stores[1]}`);
    }
    await page.goto(`${ORIGIN}/festival-hub/`);
    assert(/1 on your shortlist/.test(await countText(page)), "real shortlist count at /festival-hub/");
    const sw = await swState(page);
    assert(sw.registrations === 0 && !sw.controller, JSON.stringify(sw));
    return assertClean(log, "saves");
  });
  await check("calendar links leave for the live site; no relative calendar routes", async () => {
    const hrefs = await page.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const calendar = hrefs.filter((h) => /calendar\.musicscenemagazine/.test(h));
    assert(calendar.length >= 3 && calendar.every((h) => /^https:\/\/calendar\.musicscenemagazine\.co\.uk\/(claim)?$/.test(h)), calendar.join(", "));
    assert(!hrefs.some((h) => /^\/(claim|gig|artist|venue|api)\b/.test(h)), "relative calendar route link");
  });
  await check(`site navigation: "Gig Calendar" and "About Festival Hub" (${LAUNCH ? "same tab, no live-site suffix" : "staging: calendar links marked live, new tab"})`, async () => {
    const nav = page.getByRole("navigation", { name: "Music Scene Magazine" });
    const links = await nav.locator("a").evaluateAll((as) => as.map((a) => ({ text: a.textContent, href: a.getAttribute("href"), target: a.getAttribute("target") })));
    assert(links.length === 2, JSON.stringify(links));
    assert(links[1].text === "About Festival Hub" && links[1].href === "https://musicscenemagazine.co.uk/festival-hub/" && links[1].target === null, JSON.stringify(links[1]));
    if (LAUNCH) {
      assert(links[0].text === "Gig Calendar" && links[0].href === "https://calendar.musicscenemagazine.co.uk/" && links[0].target === null, JSON.stringify(links[0]));
      const all = await page.locator("a").evaluateAll((as) => as.map((a) => ({ text: a.textContent, href: a.getAttribute("href"), target: a.getAttribute("target") })));
      const msm = all.filter((a) => /^https:\/\/(calendar\.)?musicscenemagazine\.co\.uk\//.test(a.href));
      assert(msm.length >= 4 && msm.every((a) => a.target === null && !/live site|↗/.test(a.text)), JSON.stringify(msm));
      assert(!(await page.content()).includes("(live site)"), "live-site suffix in the launch page");
    } else {
      assert(/^Gig Calendar ↗ \(live site\)/.test(links[0].text) && links[0].target === "_blank", JSON.stringify(links[0]));
    }
  });
  await ctx.close();
}

{
  const { ctx, log } = await newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await check("mobile 375px at /: no horizontal scroll, detail fits", async () => {
    await page.goto(`${ORIGIN}/`);
    await ready(page);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "horizontal overflow");
    await page.locator(".fh-card").first().tap();
    const box = await page.getByRole("dialog").boundingBox();
    assert(box.width <= 375 && box.x >= 0, JSON.stringify(box));
    await page.screenshot({ path: join(OUT, `standalone-mobile-detail-${EXPECT}.png`) });
    return assertClean(log, "mobile");
  });
  await ctx.close();
}

{
  // Narrowest real embed: a 320px phone showing the Hub in a WordPress column with
  // 20px side padding gives a 280px frame. Width-safe grids and a wrapping dialog
  // head keep everything inside it (no overflow:hidden masking).
  const { ctx, log } = await newContext({ viewport: { width: 280, height: 700 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await check("280px (320px phone, WordPress frame): no horizontal overflow; cards, footer and all detail dialogs fit with 16px+ gutters", async () => {
    await page.goto(`${ORIGIN}/`);
    await ready(page);
    const edges = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const box = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).reduce((m, r) => ({ l: Math.min(m.l, r.left), r: Math.min(m.r, vw - r.right) }), { l: Infinity, r: Infinity });
      return { overflow: document.documentElement.scrollWidth - vw, cards: box(".fh-card"), footer: (() => { const e = document.querySelector(".fh-footer"), s = getComputedStyle(e); return parseFloat(s.paddingLeft); })() };
    });
    assert(edges.overflow <= 0 && edges.cards.l >= 16 && edges.cards.r >= 16 && edges.footer === 16, JSON.stringify(edges));
    const n = await page.locator(".fh-card").count();
    for (let i = 0; i < n; i++) {
      await page.locator(".fh-card").nth(i).click();
      await page.waitForSelector(".fh-dialog[open]");
      const d = await page.evaluate(() => { const dlg = document.querySelector(".fh-dialog[open]"); const vw = document.documentElement.clientWidth;
        const close = [...dlg.querySelectorAll("button")].find((b) => /Close/.test(b.textContent)).getBoundingClientRect();
        return { title: dlg.querySelector("h2").textContent, overflow: dlg.scrollWidth - dlg.clientWidth, closeRight: Math.round(vw - close.right) }; });
      assert(d.overflow <= 0 && d.closeRight >= 16, JSON.stringify(d));
      await page.keyboard.press("Escape");
      await page.waitForSelector(".fh-dialog[open]", { state: "detached" });
    }
    await page.screenshot({ path: join(OUT, `standalone-280-${EXPECT}.png`) });
    return assertClean(log, "280px") || `${n} dialogs fit`;
  });
  await ctx.close();
}

// ── 3c. Mode links stay on this site even at unexpected paths ───────
// A deliberately MISROUTING local server serves the hub page for any path,
// to exercise the in-app fallback (the exact-path server above 404s these).
console.log("Standalone — mode links at known and unexpected paths (misrouting local server)");
const anyPathServer = http.createServer((req, res) => serve(DIST, req, res, true));
await new Promise((r) => anyPathServer.listen(0, "127.0.0.1", r));
const ANY = `http://127.0.0.1:${anyPathServer.address().port}`;
{
  const ctx = await browser.newContext();
  await ctx.clock.setFixedTime(FROZEN_NOW);
  const offSite = [];
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(ANY + "/")) return route.continue();
    if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) offSite.push(u);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  const CASES = [
    ["/", "/"], ["/festival-hub", "/festival-hub"], ["/festival-hub/", "/festival-hub/"], ["/festival-hub/index.html", "/festival-hub/index.html"],
    ["//evil.example/", "/festival-hub/"], ["//evil.example", "/festival-hub/"], ["/\\evil.example/", "/festival-hub/"],
    ["/festival-hub//evil.example/", "/festival-hub/"], ["/unexpected/path", "/festival-hub/"], ["/festival-hub/extra", "/festival-hub/"],
  ];
  await check(LAUNCH
    ? `launch build shows no mode links and ignores ?demo=1 at ${CASES.length} known/unexpected paths; no off-site navigation`
    : `toggles resolve on this site to the expected path for ${CASES.length} known/unexpected paths; no off-site navigation`, async () => {
    const seen = [];
    for (const [p, expected] of CASES) {
      if (LAUNCH) {
        for (const q of ["", "?demo=1"]) {
          await page.goto(ANY + p + q);
          await ready(page);
          assert(await demoLinks(page).count() === 0, `${p}${q}: mode link shown`);
          assert(/26 listings/.test(await countText(page)) && await page.getByRole("note").filter({ hasText: "Demo data" }).count() === 0, `${p}${q}: not the real directory`);
        }
        seen.push(p);
        continue;
      }
      await page.goto(ANY + p);
      await ready(page);
      const toDemo = new URL(await page.getByRole("link", { name: /View the demo/ }).evaluate((a) => a.href));
      assert(toDemo.origin === ANY && toDemo.pathname === expected && toDemo.search === "?demo=1", `${p}: demo toggle → ${toDemo.href}`);
      await page.getByRole("link", { name: /View the demo/ }).click();
      await page.getByRole("note").filter({ hasText: "Demo data" }).waitFor();
      const inDemo = new URL(page.url());
      assert(inDemo.origin === ANY && inDemo.pathname === expected && inDemo.search === "?demo=1", `${p}: landed on ${page.url()}`);
      const backs = await page.getByRole("link", { name: /Back to the real directory/ }).evaluateAll((as) => as.map((a) => a.href));
      assert(backs.length >= 1 && backs.every((h) => { const u = new URL(h); return u.origin === ANY && u.pathname === expected && u.search === ""; }), `${p}: back links ${backs}`);
      seen.push(`${p} → ${expected}`);
    }
    assert(offSite.length === 0, `off-site requests: ${offSite.join(", ")}`);
    return seen.join("; ");
  });
  await ctx.close();
}
anyPathServer.close();

await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
console.log(`\n${results.length - failed}/${results.length} standalone checks passed (${EXPECT} mode). Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
