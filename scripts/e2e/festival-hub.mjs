// Festival Hub browser checks (Playwright, Chromium).
//
//   npm run build && npm run test:e2e:hub
//
// Serves dist/ locally with the same routing as vercel.json and blocks ALL
// outbound network: every request to a non-local host is aborted, except
// requests to *.supabase.co, which are answered by a local stub (so the
// calendar regression checks can render) and recorded. Nothing ever
// reaches a live backend.
//
// Optional: OLD_DIST=/path/to/dist-built-from-main measures the "stale
// calendar service worker" case (a browser that still has the pre-hub
// service worker installed). E2E_OUT=dir for screenshots.
import http from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

// Playwright is not a project dependency: use the machine's installed copy
// (resolved via require so NODE_PATH / global installs work).
const { chromium } = createRequire(import.meta.url)("playwright");

const DIST = resolve(process.env.DIST || "dist");
const OLD_DIST = process.env.OLD_DIST ? resolve(process.env.OLD_DIST) : null;
const OUT = resolve(process.env.E2E_OUT || join(tmpdir(), "festival-hub-e2e"));
await mkdir(OUT, { recursive: true });

// ── Local server mirroring vercel.json ──────────────────────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".md": "text/plain" };
const server = { root: DIST, misrouteHub: false };

async function isFile(p) { try { return (await stat(p)).isFile(); } catch { return false; } }

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = decodeURIComponent(url.pathname);
  const filePath = normalize(join(server.root, path));
  let target;
  if (filePath.startsWith(server.root) && await isFile(filePath)) target = filePath;           // filesystem first
  else if (!server.misrouteHub && (path === "/festival-hub" || path === "/festival-hub/")) target = join(server.root, "festival-hub/index.html");
  else if (path.startsWith("/api/")) { res.writeHead(404); return res.end("no api locally"); }
  else target = join(server.root, "index.html");                                                 // "/(.*)" catch-all
  const body = await readFile(target);
  res.writeHead(200, { "content-type": TYPES[extname(target)] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(body);
});
await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${httpServer.address().port}`;

// ── Harness ─────────────────────────────────────────────────────────
const browser = await chromium.launch();
const results = [];
let failed = 0;

async function check(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note }); console.log(`  ✓ ${name}${note ? ` — ${note}` : ""}`); }
  catch (e) { failed++; results.push({ name, ok: false, error: e.message }); console.log(`  ✗ ${name}\n      ${e.message.split("\n").join("\n      ")}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const isLocal = (u) => u.startsWith(ORIGIN);
const isSupabase = (u) => /^https?:\/\/[^/]*supabase\.co\//.test(u);
const isFont = (u) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
// The calendar app bundle lives at /assets/index-*.js; the hub's own bundle is under /festival-hub/assets/.
const isCalendarBundle = (u) => /^\/assets\/index-[^/]+\.js$/.test(new URL(u).pathname);

async function newContext(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "allow", ...opts });
  const log = { requests: [], supabase: [], external: [], pageErrors: [] };
  ctx.on("request", (r) => {
    const u = r.url();
    log.requests.push(u);
    let from = "?";
    try { from = new URL(r.frame().url()).pathname; } catch { /* worker or detached frame */ }
    if (isSupabase(u)) log.supabase.push(`${r.method()} ${u} (from ${from})`);
    else if (!isLocal(u) && !u.startsWith("data:") && !u.startsWith("blob:")) log.external.push(u);
  });
  await ctx.route("**/*", async (route) => {
    const u = route.request().url();
    if (isLocal(u)) return route.continue();
    if (isSupabase(u)) {
      // Local stub: never forwarded. Empty results so the calendar can render.
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "content-range": "*/0" }, body: u.includes("/auth/") ? "{}" : "[]" });
    }
    return route.abort("blockedbyclient");
  });
  ctx.on("page", (p) => p.on("pageerror", (e) => log.pageErrors.push(e.message)));
  return { ctx, log, reset() { for (const k of Object.keys(log)) log[k].length = 0; } };
}

const banner = (page) => page.getByRole("note").filter({ hasText: "Demo data" });
const countText = (page) => page.getByRole("status").first().textContent();
const activeInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el?.tagName, type: el?.type, label: el?.labels?.[0]?.textContent || el?.textContent?.trim(), href: el?.getAttribute?.("href") };
});
async function tabTo(page, predicate, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const info = await activeInfo(page);
    if (predicate(info)) return info;
  }
  throw new Error("could not reach element by keyboard");
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

function assertHubNetworkClean(log, label) {
  assert(log.supabase.length === 0, `${label}: backend requests: ${log.supabase.join(", ")}`);
  const nonFont = log.external.filter((u) => !isFont(u));
  assert(nonFont.length === 0, `${label}: external requests: ${nonFont.join(", ")}`);
  const cal = log.requests.filter((u) => isLocal(u) && isCalendarBundle(u));
  assert(cal.length === 0, `${label}: calendar bundle requested: ${cal.join(", ")}`);
  assert(log.pageErrors.length === 0, `${label}: page errors: ${log.pageErrors.join(" | ")}`);
  return `${log.requests.filter(isLocal).length} local requests, 0 backend, ${log.external.length} font requests (blocked)`;
}

// ── Hub: desktop keyboard flow ─────────────────────────────────────
console.log(`Festival Hub e2e against ${DIST} at ${ORIGIN}`);
console.log("Hub — desktop, keyboard only");
{
  const { ctx, log } = await newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub`);

  await check("renders hub with demo banner, noindex and no calendar", async () => {
    await banner(page).waitFor();
    assert(await page.getByRole("heading", { level: 1 }).textContent().then((t) => t.includes("Festival Hub")), "missing h1");
    assert(await page.locator('meta[name="robots"]').getAttribute("content") === "noindex, nofollow", "noindex missing");
    assert(/8 demo listings/.test(await countText(page)), "expected 8 listings");
    assert(new URL(page.url()).pathname === "/festival-hub", `url changed: ${page.url()}`);
    await page.screenshot({ path: join(OUT, "desktop-list.png"), fullPage: true });
  });

  await check("search reachable and usable by keyboard", async () => {
    await tabTo(page, (i) => i.tag === "INPUT" && i.type === "search");
    await page.keyboard.type("highland");
    assert(/^1 demo listing/.test(await countText(page)), await countText(page));
    await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
    assert(/8 demo listings/.test(await countText(page)), "search not cleared");
  });

  await check("region/status filters, empty state and reset", async () => {
    await page.getByLabel("Region").focus(); await page.getByLabel("Region").selectOption("Wales");
    await page.getByLabel("Status").selectOption("open");
    await page.getByText("No demo listings match these filters.").waitFor();
    await page.screenshot({ path: join(OUT, "desktop-empty.png") });
    await page.locator(".fh-empty button").focus();
    await page.keyboard.press("Enter");
    assert(/8 demo listings/.test(await countText(page)), "reset failed");
    assert(await page.getByLabel("Region").inputValue() === "all", "region not reset");
    assert(await page.getByRole("button", { name: "Reset filters" }).isDisabled(), "reset should be disabled at defaults");
  });

  await check("genre + deadline filters", async () => {
    await page.getByLabel("Genre").selectOption("Indie");
    assert(/3 demo listings/.test(await countText(page)), await countText(page));
    await page.getByLabel("Genre").selectOption("all");
    await page.getByLabel("Deadline").selectOption("90");
    const n = await page.locator(".fh-card").count();
    assert(n >= 1, "deadline filter returned nothing");
    await page.getByRole("button", { name: "Reset filters" }).click();
  });

  await check("open detail with Enter, close with Escape, focus returns", async () => {
    await page.locator(".fh-card").first().focus();
    const href = await page.locator(".fh-card").first().getAttribute("href");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    assert(page.url().endsWith(href), `hash not set: ${page.url()}`);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const a = await activeInfo(page);
    assert(a.href === href, `focus not returned (on ${JSON.stringify(a)})`);
    assert(!page.url().includes("#"), "hash not cleared");
  });

  await check("detail shows labelled example links, never auto-submits", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=demo-highland`);
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    const apply = dlg.getByRole("link", { name: /Example application link \(demo\)/ });
    assert(await apply.getAttribute("href") === "https://example.org/festival-hub-demo/highland/apply", "apply href");
    assert(await apply.getAttribute("target") === "_blank" && /noopener/.test(await apply.getAttribute("rel")), "apply link target/rel");
    assert(await dlg.getByRole("link", { name: /Example source link \(demo, not a real page\)/ }).count() === 1, "source label");
    assert(await dlg.locator("form[action], [type=submit]").count() === 0, "dialog contains a submit control");
    for (const t of ["Festival dates", "Location", "Eligibility", "Fees", "Last checked", "28 March 2027"]) {
      assert((await dlg.textContent()).includes(t), `detail missing ${t}`);
    }
    await page.screenshot({ path: join(OUT, "desktop-detail.png") });
  });

  await check("save, progress and checklist by keyboard; persists across reload", async () => {
    const dlg = page.getByRole("dialog");
    await tabTo(page, (i) => i.tag === "BUTTON" && /Save to shortlist/.test(i.label));
    await page.keyboard.press("Enter");
    await dlg.getByRole("button", { name: /Remove from shortlist/ }).waitFor();
    await dlg.getByLabel("Stage", { exact: true }).focus();
    await dlg.getByLabel("Stage", { exact: true }).selectOption("outcome");
    await dlg.getByLabel("Outcome").selectOption("offered");
    await tabTo(page, (i) => i.tag === "INPUT" && i.type === "checkbox" && /EPK/.test(i.label));
    await page.keyboard.press("Space");
    assert(/1 of 7 ready/.test(await dlg.textContent()), "checklist count");
    const stored = await page.evaluate(() => localStorage.getItem("msm.festivalHub.v1"));
    assert(stored === JSON.stringify({ version: 1, items: { "demo-highland": { stage: "outcome", outcome: "offered", checklist: { epk: true } } } }), `stored: ${stored}`);
    await page.reload();
    await dlg.waitFor();
    assert(await dlg.getByLabel("Stage", { exact: true }).inputValue() === "outcome", "stage lost on reload");
    assert(await dlg.getByLabel(/EPK/).isChecked(), "checklist lost on reload");
    await page.keyboard.press("Escape");
    assert(/1 on your shortlist/.test(await countText(page)), "shortlist count");
    await page.getByLabel("Shortlist only").check();
    assert(/^1 demo listing/.test(await countText(page)), "shortlist filter");
    await page.getByLabel("Shortlist only").uncheck();
  });

  await check("unknown listing link shows not-found, not a crash", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=does-not-exist`);
    await page.getByRole("dialog").getByText("Listing not found").waitFor();
    await page.goto(`${ORIGIN}/festival-hub#festival=%E0%A4%A`);
    await page.getByRole("dialog").getByText("Listing not found").waitFor();
  });

  await check("network: no backend, no external (fonts blocked), no calendar code", async () => assertHubNetworkClean(log, "desktop"));
  await ctx.close();
}

// ── Hub: mobile ────────────────────────────────────────────────────
console.log("Hub — mobile 375px");
{
  const { ctx, log } = await newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub/`);
  await check("mobile list has no horizontal scroll; detail fits", async () => {
    await banner(page).waitFor();
    assert(await noHorizontalScroll(page), "horizontal overflow on list");
    await page.screenshot({ path: join(OUT, "mobile-list.png"), fullPage: true });
    await page.locator(".fh-card").first().tap();
    await page.getByRole("dialog").waitFor();
    const box = await page.getByRole("dialog").boundingBox();
    assert(box.width <= 375 && box.x >= 0, `dialog box ${JSON.stringify(box)}`);
    await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).tap();
    await page.getByRole("dialog").getByLabel("Stage", { exact: true }).waitFor();
    await page.screenshot({ path: join(OUT, "mobile-detail.png") });
    await page.getByRole("dialog").getByRole("button", { name: /Close/ }).tap();
    await page.getByRole("dialog").waitFor({ state: "detached" });
  });
  await check("mobile network clean", async () => assertHubNetworkClean(log, "mobile"));
  await ctx.close();
}

// ── Hub: storage failures ──────────────────────────────────────────
console.log("Hub — storage failures");
{
  const { ctx, log } = await newContext();
  await ctx.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); }; });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub#festival=demo-northfields`);
  await check("write failure shows a visible notice", async () => {
    await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).click();
    await page.getByRole("alert").filter({ hasText: "couldn't be saved" }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: /Remove from shortlist/ }).waitFor(); // still works in-page
  });
  await ctx.close();
  assertHubNetworkClean(log, "storage-fail");
}
{
  const { ctx } = await newContext();
  await ctx.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } }); });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub`);
  await check("blocked storage shows notice on load and page still works", async () => {
    await page.getByRole("alert").filter({ hasText: "Saving isn't available" }).waitFor();
    assert(/8 demo listings/.test(await countText(page)), "list missing");
  });
  await ctx.close();
}
{
  const { ctx } = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub`);
  await page.evaluate(() => localStorage.setItem("msm.festivalHub.v1", JSON.stringify({ version: 1, items: { "demo-valleys": { stage: "applied", email: "x@example.com" }, "<script>": {} } })));
  await page.reload();
  await check("invalid stored data is ignored with a notice; no contact details survive a save", async () => {
    await page.getByRole("alert").filter({ hasText: "couldn't be read" }).waitFor();
    assert(/1 on your shortlist/.test(await countText(page)), "valid entry should survive");
    await page.goto(`${ORIGIN}/festival-hub#festival=demo-valleys`);
    await page.getByRole("dialog").getByLabel("Stage", { exact: true }).selectOption("outcome");
    const stored = await page.evaluate(() => localStorage.getItem("msm.festivalHub.v1"));
    assert(!/example\.com|script/.test(stored), `stored: ${stored}`);
  });
  await page.goto(`${ORIGIN}/festival-hub`);
  await page.evaluate(() => localStorage.setItem("msm.festivalHub.v1", "{corrupt"));
  await page.reload();
  await check("corrupt JSON shows notice and empty shortlist", async () => {
    await page.getByRole("alert").filter({ hasText: "couldn't be read" }).waitFor();
    assert(!/on your shortlist/.test(await countText(page)), "should be empty");
  });
  await ctx.close();
}

// ── Calendar shell served on hub paths (guard) ─────────────────────
console.log("Guard — calendar shell on hub paths");
{
  const { ctx, log } = await newContext();
  const page = await ctx.newPage();
  await check("unknown /festival-hub/* path (Vercel catch-all) redirects to hub without starting the calendar", async () => {
    await page.goto(`${ORIGIN}/festival-hub/some/deep/path?x=1#festival=demo-highland`);
    await banner(page).waitFor();
    assert(new URL(page.url()).pathname === "/festival-hub/index.html", page.url());
    assert(page.url().endsWith("?x=1#festival=demo-highland"), `query/hash lost: ${page.url()}`);
    await page.getByRole("dialog").waitFor();
    assert(log.supabase.length === 0, `backend requests: ${log.supabase}`);
    const guardErr = log.pageErrors.filter((e) => !/MSM calendar not started on a Festival Hub path/.test(e));
    assert(guardErr.length === 0, guardErr.join(" | "));
    return "calendar bundle downloaded but halted by the guard before any client was created";
  });
  server.misrouteHub = true;
  log.supabase.length = 0;
  await check("rewrite missing entirely: /festival-hub still ends on the hub, zero backend calls", async () => {
    await page.goto(`${ORIGIN}/festival-hub`);
    await banner(page).waitFor();
    assert(new URL(page.url()).pathname === "/festival-hub/index.html", page.url());
    assert(log.supabase.length === 0, `backend requests: ${log.supabase}`);
  });
  server.misrouteHub = false;
  await ctx.close();
}

// ── Warm service worker (current calendar build) ───────────────────
console.log("Warm service worker — current build");
{
  const { ctx, log, reset } = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForLoadState("networkidle"); // let the calendar's own (stubbed) loads finish before measuring the hub
  await check("calendar SW is installed and controlling this origin", async () => {
    assert(await page.evaluate(() => !!navigator.serviceWorker.controller), "no controller");
  });
  reset();
  const swServed = [];
  page.on("response", (r) => { if (r.request().isNavigationRequest() && r.fromServiceWorker()) swServed.push(r.url()); });
  await check("hub navigation with warm SW: not served from SW cache, calendar never starts", async () => {
    await page.goto(`${ORIGIN}/festival-hub`);
    await banner(page).waitFor();
    await page.reload();
    await banner(page).waitFor();
    await page.goto(`${ORIGIN}/festival-hub#festival=demo-coastline`);
    await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).click();
    await page.goto(`${ORIGIN}/festival-hub/`);
    await banner(page).waitFor();
    assert(swServed.length === 0, `served by SW: ${swServed}`);
    assert(new URL(page.url()).pathname === "/festival-hub/", page.url());
    return assertHubNetworkClean(log, "warm-sw");
  });
  await ctx.close();
}

// ── Stale (pre-hub) calendar service worker ────────────────────────
// KNOWN FAILURE of the production-isolation requirement, recorded rather
// than passed: a browser still controlled by a calendar service worker
// built before the hub existed answers the first /festival-hub navigation
// with its cached calendar shell, so the OLD calendar code runs (and calls
// its backend) until the worker auto-updates and reloads into the hub.
// Nothing in this branch can change code already cached in that worker.
// Staging must therefore use a fresh deployment origin (no old worker).
const knownFailures = [];
if (OLD_DIST) {
  console.log(`Stale service worker — calendar SW from ${OLD_DIST}`);
  const { ctx, log, reset } = await newContext();
  const page = await ctx.newPage();
  server.root = OLD_DIST;
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForLoadState("networkidle");
  server.root = DIST; // "deploy" the hub build
  reset();
  await page.goto(`${ORIGIN}/festival-hub`);
  await banner(page).waitFor({ timeout: 30000 });
  const firstVisit = [...log.supabase];
  reset();
  await page.reload();
  await banner(page).waitFor();
  const afterUpdate = log.supabase.length;
  const msg = `stale pre-hub SW: first /festival-hub visit ran the cached calendar — ${firstVisit.length} backend request(s) (stubbed locally, from ${[...new Set(firstVisit.map((x) => x.split("(from ")[1].replace(/\)$/, "")))].join(", ")}); ${afterUpdate} after the SW updated`;
  if (firstVisit.length > 0) { knownFailures.push(msg); console.log(`  ✗ KNOWN FAILURE (not counted as passing): ${msg}`); }
  else { results.push({ name: "stale SW", ok: true }); console.log(`  ✓ ${msg}`); }
  await ctx.close();
}

// ── Calendar regression (backend stubbed) ──────────────────────────
console.log("Calendar regression — backend stubbed, outbound blocked");
{
  const { ctx, log } = await newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  for (const path of ["/", "/claim", "/artist/demo-band", "/festival/demo-fest", "/festival-hubs"]) {
    await check(`calendar ${path} boots normally (guard inactive)`, async () => {
      log.supabase.length = 0; log.pageErrors.length = 0;
      await page.goto(`${ORIGIN}${path}`);
      // Home/claim show the MSM header; profile pages with the empty stub show "... NOT FOUND".
      await page.locator("#root").getByText(/MUSIC SCENE|NOT FOUND|Claim/i).first().waitFor({ timeout: 15000 }).catch(async () => {
        await page.getByAltText("Music Scene Magazine").first().waitFor({ timeout: 5000 });
      });
      assert(new URL(page.url()).pathname === path, `redirected to ${page.url()}`);
      assert(!(await page.content()).includes("Demo data:"), "hub rendered on calendar path");
      await page.waitForTimeout(300);
      assert(log.pageErrors.length === 0, `page errors: ${log.pageErrors.join(" | ")}`);
      return `${log.supabase.length} backend calls answered by local stub`;
    });
  }
  await page.goto(`${ORIGIN}/`);
  await page.screenshot({ path: join(OUT, "calendar-home.png") });
  const leaked = log.external.filter((u) => !isFont(u));
  await check("calendar: no request left the machine", async () => { assert(leaked.length === 0, leaked.join(", ")); });
  await ctx.close();
}

await browser.close();
httpServer.close();
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${OUT}`);
if (knownFailures.length) console.log(`KNOWN FAILURES (production isolation, not covered by the passing checks):\n  - ${knownFailures.join("\n  - ")}`);
else if (!OLD_DIST) console.log("Stale pre-hub service worker case NOT measured (set OLD_DIST).");
process.exit(failed ? 1 : 0);
