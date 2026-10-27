// Festival Hub STANDALONE preview checks (Playwright, Chromium).
//
//   npm run test:e2e:hub-standalone
//
// 1. Simulates the deploy-branch upload (scripts/standalone/.vercelignore),
//    builds the hub from ONLY those files with VERCEL=1 (so the output
//    verifier also enforces that api/ and supabase/ are absent).
// 2. Serves that output with the routing and headers read from
//    scripts/standalone/vercel.json: filesystem first, then the exact
//    rewrites, otherwise 404 -- the same order Vercel uses.
// 3. Checks routing, 404s, headers/CSP, rendering at / and /festival-hub(/),
//    no service worker, no backend/API/calendar requests, local saves and
//    real/demo separation, in fresh browser contexts.
//
// All non-local requests are aborted. Google Fonts requests are answered by
// a local stub so the CSP font/style allowances are exercised without
// leaving the machine. Date is frozen at 27 Oct 2026 12:00 UK time.
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = resolve(process.env.E2E_OUT || join(tmpdir(), "festival-hub-standalone-e2e"));
mkdirSync(OUT, { recursive: true });
const VERCEL_JSON = JSON.parse(readFileSync(join(ROOT, "scripts/standalone/vercel.json"), "utf8"));
const FROZEN_NOW = new Date("2026-10-27T11:00:00Z");

const results = [];
let failed = 0;
async function check(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}${note ? ` — ${note}` : ""}`); }
  catch (e) { failed++; results.push({ name, ok: false }); console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── 1. Build exactly what the deploy branch would upload ────────────
console.log("Standalone — simulated Vercel upload and build");
const work = mkdtempSync(join(tmpdir(), "hub-standalone-"));
const upload = JSON.parse(execFileSync(process.execPath, [join(ROOT, "scripts/standalone/simulate-vercel-upload.mjs"), join(work, "src")], { encoding: "utf8" }));
const SRC = upload.dest;
await check("upload allowlist excludes api/, supabase/ and all calendar code", async () => {
  const bad = upload.files.filter((f) => /^(api|supabase)\/|^src\/(?!festivalHub\/)|^vite\.config\.js$|^vite\.festival-hub\.config\.js$|^index\.html$|\.test\.js$/.test(f));
  assert(bad.length === 0, `unexpected upload files: ${bad.join(", ")}`);
  assert(upload.files.includes("vercel.json") && upload.files.includes("src/festivalHub/main.jsx"), "build inputs missing");
  return `${upload.files.length} files uploaded`;
});
cpSync(join(ROOT, "node_modules"), join(SRC, "node_modules"), { recursive: true, verbatimSymlinks: true });
let buildLog = "";
await check("standalone build + output verifier pass with VERCEL=1", async () => {
  buildLog = execFileSync("npm", ["run", "build:hub-standalone"], { cwd: SRC, env: { ...process.env, VERCEL: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert(/standalone output verified/.test(buildLog), buildLog.slice(-500));
  return buildLog.match(/verified: .*$/m)[0];
});
const DIST = join(SRC, VERCEL_JSON.outputDirectory);
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)).map((x) => `${n}/${x}`) : [n]));
const distFiles = walk(DIST).sort();
const hubJs = distFiles.find((f) => /^festival-hub\/assets\/.+\.js$/.test(f));

// ── 2. Server mirroring scripts/standalone/vercel.json ──────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon" };
const HEADERS = Object.fromEntries(VERCEL_JSON.headers[0].headers.map((h) => [h.key, h.value]));
const REWRITES = new Map(VERCEL_JSON.rewrites.map((r) => [r.source, r.destination]));
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const fsPath = normalize(join(DIST, path));
  let target = null;
  if (fsPath.startsWith(DIST) && isFile(fsPath)) target = fsPath;
  else if (REWRITES.has(path)) target = join(DIST, REWRITES.get(path));
  if (!target) { res.writeHead(404, { ...HEADERS, "content-type": "text/plain" }); return res.end("404"); }
  res.writeHead(200, { ...HEADERS, "content-type": TYPES[extname(target)] || "application/octet-stream" });
  res.end(readFileSync(target));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ── 3a. HTTP routing and headers ─────────────────────────────────────
console.log(`Standalone — routing and headers at ${ORIGIN}`);
const get = (p) => fetch(ORIGIN + p, { redirect: "manual" });
await check("output contains only hub files", async () => {
  assert(JSON.stringify(distFiles) === JSON.stringify(["brand/MSM-Logo-Master.png", "favicon.ico", hubJs, "festival-hub/index.html"].sort()), distFiles.join(", "));
  return distFiles.join(", ");
});
await check("hub HTML at /, /festival-hub, /festival-hub/, /festival-hub/index.html, /?demo=1", async () => {
  for (const p of ["/", "/festival-hub", "/festival-hub/", "/festival-hub/index.html", "/?demo=1"]) {
    const r = await get(p);
    const body = await r.text();
    assert(r.status === 200 && /<title>MSM Festival Hub \(Staging\)<\/title>/.test(body), `${p}: ${r.status}`);
  }
});
await check("assets served with correct types", async () => {
  for (const [p, type] of [[`/${hubJs}`, "text/javascript"], ["/brand/MSM-Logo-Master.png", "image/png"], ["/favicon.ico", "image/x-icon"]]) {
    const r = await get(p);
    assert(r.status === 200 && r.headers.get("content-type").startsWith(type), `${p}: ${r.status} ${r.headers.get("content-type")}`);
  }
});
const NOT_FOUND = ["/api/og", "/api/gig", "/api/notify", "/api/sitemap", "/api/robots", "/sw.js", "/manifest.webmanifest", "/workbox-9c191d2f.js",
  "/assets/index-yiBhUoVF.js", "/index.html", "/gig/x", "/artist/x", "/venue/x", "/festival/x", "/promoter/x", "/claim", "/sitemap.xml",
  "/robots.txt", "/icons/icon-192.png", "/google9ef7fb7e9cd22e56.html", "/brand/README.md", "/festival-hub/x", "/festival-hubs", "/random"];
await check(`404 for unknown, calendar, API, SW and manifest paths (${NOT_FOUND.length})`, async () => {
  const wrong = [];
  for (const p of NOT_FOUND) { const r = await get(p); if (r.status !== 404) wrong.push(`${p}=${r.status}`); }
  assert(!wrong.length, wrong.join(", "));
});
await check("CSP, noindex and security headers on every response (200 and 404)", async () => {
  for (const p of ["/", `/${hubJs}`, "/api/og", "/random"]) {
    const r = await get(p);
    assert(r.headers.get("content-security-policy") === HEADERS["Content-Security-Policy"], `${p}: CSP`);
    assert(r.headers.get("x-robots-tag") === "noindex, nofollow", `${p}: X-Robots-Tag`);
    assert(r.headers.get("x-content-type-options") === "nosniff", `${p}: nosniff`);
  }
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
const staging = (page) => page.getByRole("note").filter({ hasText: "Staging preview" });
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
  await check(`fresh visit to ${path}: hub renders with real data and MSM styling, no SW, no CSP violations`, async () => {
    const resp = await page.goto(ORIGIN + path);
    assert(resp.status() === 200, `status ${resp.status()}`);
    await staging(page).waitFor();
    assert(/26 listings · 13 open now/.test(await countText(page)), await countText(page));
    const style = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily, banner: getComputedStyle(document.querySelector(".fh-staging")).backgroundColor }));
    assert(style.bg === "rgb(13, 13, 13)" && /Barlow/.test(style.font) && style.banner === "rgb(255, 255, 255)", JSON.stringify(style));
    assert(await page.getByAltText("Music Scene Magazine").evaluate((img) => img.complete && img.naturalWidth > 0), "logo not loaded");
    assert(log.fonts.some((u) => u.includes("fonts.googleapis.com")) && log.fonts.some((u) => u.includes("fonts.gstatic.com")), `fonts not requested: ${log.fonts}`);
    await page.locator(".fh-card").first().click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    const v = await cspViolations(page);
    assert(v.length === 0, `CSP violations during normal use: ${v.join(", ")}`);
    const sw = await swState(page);
    assert(sw.registrations === 0 && !sw.controller, JSON.stringify(sw));
    if (path === "/") await page.screenshot({ path: join(OUT, "standalone-root.png"), fullPage: true });
    return assertClean(log, path);
  });
  await ctx.close();
}

{
  const { ctx, log } = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`);
  await staging(page).waitFor();
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
  await check("local saves persist at / and real/demo stay separate", async () => {
    await page.goto(`${ORIGIN}/#festival=twyfest`);
    await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).click();
    await page.getByRole("dialog").getByLabel("Stage", { exact: true }).selectOption("preparing");
    await page.reload();
    await page.getByRole("dialog").getByLabel("Stage", { exact: true }).waitFor();
    assert(await page.getByRole("dialog").getByLabel("Stage", { exact: true }).inputValue() === "preparing", "real save lost");
    await page.keyboard.press("Escape");
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
    await page.goto(`${ORIGIN}/festival-hub/`);
    assert(/1 on your shortlist/.test(await countText(page)), "real shortlist count at /festival-hub/");
    const sw = await swState(page);
    assert(sw.registrations === 0 && !sw.controller, JSON.stringify(sw));
    return assertClean(log, "saves");
  });
  await check("calendar links leave for the live site; no relative calendar routes", async () => {
    const hrefs = await page.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const calendar = hrefs.filter((h) => /calendar\.musicscenemagazine/.test(h));
    assert(calendar.length >= 4 && calendar.every((h) => /^https:\/\/calendar\.musicscenemagazine\.co\.uk\/(claim)?$/.test(h)), calendar.join(", "));
    assert(!hrefs.some((h) => /^\/(claim|gig|artist|venue|api)\b/.test(h)), "relative calendar route link");
  });
  await ctx.close();
}

{
  const { ctx, log } = await newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await check("mobile 375px at /: no horizontal scroll, detail fits", async () => {
    await page.goto(`${ORIGIN}/`);
    await staging(page).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "horizontal overflow");
    await page.locator(".fh-card").first().tap();
    const box = await page.getByRole("dialog").boundingBox();
    assert(box.width <= 375 && box.x >= 0, JSON.stringify(box));
    await page.screenshot({ path: join(OUT, "standalone-mobile-detail.png") });
    return assertClean(log, "mobile");
  });
  await ctx.close();
}

await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
console.log(`\n${results.length - failed}/${results.length} standalone checks passed. Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
