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
// Date is frozen at 27 Oct 2026 12:00 UK time in every context (FROZEN_NOW).
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
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".md": "text/plain" };
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

// Every browser context runs with Date frozen at the research check time
// (27 Oct 2026, 12:00 UK time = 11:00 UTC, BST), so the 13-open count,
// deadline windows and "checked N days ago" don't change as real time
// passes. Expiry, freshness and DST boundaries are unit-tested separately
// (status.test.js, curated.test.js) with explicit instants.
const FROZEN_NOW = new Date("2026-10-27T11:00:00Z");

async function newContext(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "allow", ...opts });
  await ctx.clock.setFixedTime(FROZEN_NOW);
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

const banner = (page) => page.getByRole("note").filter({ hasText: "Staging preview" });
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

// ── Hub: real directory (default), desktop, keyboard ───────────────
console.log(`Festival Hub e2e against ${DIST} at ${ORIGIN}`);
console.log("Hub — real directory, desktop, keyboard only");
const REAL_KEY = "msm.festivalHub.real.v1";
const DEMO_KEY = "msm.festivalHub.demo.v1";
{
  const { ctx, log } = await newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub`);

  await check("real directory is the default: 26 listings, 13 open, staging + noindex, no demo data", async () => {
    await banner(page).waitFor();
    assert(/26 listings · 13 open now/.test(await countText(page)), await countText(page));
    assert(await page.locator('meta[name="robots"]').getAttribute("content") === "noindex, nofollow", "noindex missing");
    assert(await page.locator(".fh-badge-demo").count() === 0, "demo badge in real mode");
    assert(!(await page.content()).includes("Example Festival"), "demo listing in real mode");
    assert(new URL(page.url()).pathname === "/festival-hub", `url changed: ${page.url()}`);
    await page.screenshot({ path: join(OUT, "real-list.png"), fullPage: true });
  });

  await check("calendar links are labelled live and point at the live calendar in a new tab", async () => {
    const links = page.getByRole("link", { name: /live site/ });
    assert(await links.count() >= 3, "live links missing");
    for (const href of await links.evaluateAll((els) => els.map((e) => `${e.getAttribute("href")}|${e.target}`))) {
      assert(/^https:\/\/calendar\.musicscenemagazine\.co\.uk\/(claim)?\|_blank$/.test(href), href);
    }
    assert(await page.locator('a[href="/"], a[href="/claim"]').count() === 0, "relative calendar link (would hit the preview's production-connected calendar)");
    assert(await page.locator('a[href^="mailto:"]').count() === 0, "mailto link present");
  });

  await check("search and filters by keyboard; empty state and reset", async () => {
    await tabTo(page, (i) => i.tag === "INPUT" && i.type === "search");
    await page.keyboard.type("dorset");
    assert(/Showing 2 of 26 listings/.test(await countText(page)), await countText(page));
    await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
    await page.getByLabel("Region").selectOption("Wales");
    await page.getByLabel("Status").selectOption("closed");
    await page.getByText("No listings match these filters.").waitFor();
    await page.locator(".fh-empty button").focus();
    await page.keyboard.press("Enter");
    assert(/26 listings/.test(await countText(page)), "reset failed");
    await page.getByLabel("Genre").selectOption("Jazz");
    assert(/Showing 4 of 26/.test(await countText(page)), `genre: ${await countText(page)}`);
    await page.getByRole("button", { name: "Reset filters" }).click();
    await page.getByLabel("Deadline").selectOption("90");
    assert(/Showing 3 of 26/.test(await countText(page)), `deadline: ${await countText(page)}`);
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
    assert((await activeInfo(page)).href === href, "focus not returned");
  });

  await check("open listing (Hanwell): exact 21:00 deadline, source wording, recheck note, apply page, sources", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=hanwell-hootie`);
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    const t = await dlg.textContent();
    for (const s of ["1 December 2026 (year inferred), 21:00 UK time", "“before 9pm Tuesday 1 December”", "Open as checked on 27 October 2026",
      "MSM hasn't tested external application forms", "Paid — Official post says musicians are paid.", "source page dated 21 October 2026",
      "MSM has not tested that form"]) assert(t.includes(s), `missing: ${s}`);
    const apply = dlg.getByRole("link", { name: /^Official application page/ });
    assert(await apply.getAttribute("href") === "https://www.hanwellhootie.co.uk/", "apply href");
    assert(await apply.getAttribute("target") === "_blank" && /noopener/.test(await apply.getAttribute("rel")), "target/rel");
    assert(await dlg.locator("form[action], [type=submit]").count() === 0, "submit control in dialog");
    await page.screenshot({ path: join(OUT, "real-detail-open.png") });
  });

  await check("date-only deadline says time not stated; no-deadline listing says so", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=kelburn-garden-party`);
    assert((await page.getByRole("dialog").textContent()).includes("15 December 2026 (year inferred) (time not stated — apply earlier)"), "kelburn deadline");
    await page.goto(`${ORIGIN}/festival-hub#festival=boho-festival`);
    const t = await page.getByRole("dialog").textContent();
    assert(t.includes("No deadline published") && t.includes("Not announced / not known"), "boho unknowns");
  });

  await check("unpaid slot warning appears before the outbound link; email shown as text only", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=twyfest`);
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    const order = await dlg.evaluate((d) => {
      const warn = [...d.querySelectorAll(".fh-notice")].find((n) => n.textContent.includes("Unpaid performance"));
      const link = d.querySelector(".fh-actions a");
      return warn && link ? !!(warn.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    });
    assert(order === true, "unpaid warning not before link");
    assert((await dlg.textContent()).includes("bands@twyfest.uk"), "email missing");
    assert(await dlg.locator('a[href^="mailto:"]').count() === 0, "mailto link");
    await page.screenshot({ path: join(OUT, "real-detail-unpaid.png") });
  });

  await check("non-open listings: no apply button, official info + sources shown", async () => {
    for (const id of ["donnyfest", "hastings-fat-tuesday", "manorfest", "wychwood", "milford-on-sea-music-festival"]) {
      await page.goto(`${ORIGIN}/festival-hub#festival=${id}`);
      const dlg = page.getByRole("dialog");
      await dlg.waitFor();
      assert(await dlg.getByRole("link", { name: /^Official application page/ }).count() === 0, `${id}: apply button`);
      assert(await dlg.getByRole("link", { name: /View official information/ }).count() === 1, `${id}: official info link`);
      assert(/application window — checked 27 October 2026/.test(await dlg.textContent()), `${id}: window source`);
    }
    await page.goto(`${ORIGIN}/festival-hub#festival=donnyfest`);
    assert(/disagree/.test(await page.getByRole("dialog").textContent()), "donnyfest reason");
    await page.screenshot({ path: join(OUT, "real-detail-unverified.png") });
  });

  await check("save/progress/checklist by keyboard persist in the REAL store only", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=teddy-rocks`);
    const dlg = page.getByRole("dialog");
    await tabTo(page, (i) => i.tag === "BUTTON" && /Save to shortlist/.test(i.label));
    await page.keyboard.press("Enter");
    await dlg.getByLabel("Stage", { exact: true }).selectOption("applied");
    await tabTo(page, (i) => i.tag === "INPUT" && i.type === "checkbox" && /EPK/.test(i.label));
    await page.keyboard.press("Space");
    const stores = await page.evaluate(([r, d]) => [localStorage.getItem(r), localStorage.getItem(d)], [REAL_KEY, DEMO_KEY]);
    assert(stores[0] === JSON.stringify({ version: 1, items: { "teddy-rocks": { stage: "applied", outcome: "pending", checklist: { epk: true } } } }), `real: ${stores[0]}`);
    assert(stores[1] === null, "demo store written from real mode");
    await page.reload();
    await dlg.waitFor();
    assert(await dlg.getByLabel("Stage", { exact: true }).inputValue() === "applied", "lost on reload");
    await page.keyboard.press("Escape");
    assert(/1 on your shortlist/.test(await countText(page)), "shortlist count");
  });

  await check("unknown listing link shows not-found; demo ids don't resolve in real mode", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=demo-highland`);
    await page.getByRole("dialog").getByText("Listing not found").waitFor();
    await page.goto(`${ORIGIN}/festival-hub#festival=%E0%A4%A`);
    await page.getByRole("dialog").getByText("Listing not found").waitFor();
  });

  await check("real-mode network: no backend, no external (fonts blocked), no calendar code", async () => assertHubNetworkClean(log, "real"));
  await ctx.close();
}

// ── Hub: demo mode (explicit toggle) ───────────────────────────────
console.log("Hub — demo mode");
{
  const { ctx, log } = await newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub`);
  await check("demo only via explicit toggle; clearly labelled; never mixed with real listings", async () => {
    await page.getByRole("link", { name: /View the demo/ }).click();
    await page.waitForURL(/\?demo=1$/);
    await page.getByRole("note").filter({ hasText: "Demo data" }).waitFor();
    assert(/10 demo listings/.test(await countText(page)), await countText(page));
    assert(await page.locator(".fh-card").count() === await page.locator(".fh-card .fh-badge-demo").count(), "card without DEMO badge");
    assert(!(await page.content()).includes("Hanwell Hootie"), "real listing in demo mode");
    await page.screenshot({ path: join(OUT, "demo-list.png"), fullPage: true });
  });
  await check("demo links are labelled demo examples; historical form labelled", async () => {
    await page.goto(`${ORIGIN}/festival-hub?demo=1#festival=demo-harbour`);
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    assert(await dlg.getByRole("link", { name: /2026 application page \(historical — not for 2027\) \(demo example\)/ }).count() === 1, "historical label");
    assert(await dlg.getByRole("link", { name: /^Official application page/ }).count() === 0, "apply on not-yet-announced");
  });
  await check("demo saves go to the demo store only", async () => {
    await page.goto(`${ORIGIN}/festival-hub?demo=1#festival=demo-coastline`);
    await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).click();
    const stores = await page.evaluate(([r, d]) => [localStorage.getItem(r), localStorage.getItem(d)], [REAL_KEY, DEMO_KEY]);
    assert(stores[0] === null && /demo-coastline/.test(stores[1]), JSON.stringify(stores));
    await page.goto(`${ORIGIN}/festival-hub`);
    await banner(page).waitFor();
    assert(!/on your shortlist/.test(await countText(page)), "demo save visible in real mode");
  });
  await check("demo-mode network clean", async () => assertHubNetworkClean(log, "demo"));
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
  await page.goto(`${ORIGIN}/festival-hub#festival=twyfest`);
  await check("write failure shows a visible notice", async () => {
    await page.getByRole("dialog").getByRole("button", { name: /Save to shortlist/ }).click();
    // While the modal is open the warning is announced inside it (the page behind is inert).
    await page.getByRole("dialog").getByRole("alert").filter({ hasText: "Not saved" }).waitFor();
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
    assert(/26 listings/.test(await countText(page)), "list missing");
  });
  await ctx.close();
}
{
  const { ctx } = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/festival-hub`);
  await page.evaluate(() => localStorage.setItem("msm.festivalHub.real.v1", JSON.stringify({ version: 1, items: { "dorsetfest": { stage: "applied", email: "x@example.com" }, "<script>": {}, "demo-valleys": {} } })));
  await page.reload();
  await check("invalid stored data is ignored with a notice; no contact details survive a save", async () => {
    await page.getByRole("alert").filter({ hasText: "couldn't be read" }).waitFor();
    assert(/1 on your shortlist/.test(await countText(page)), "valid entry should survive");
    await page.goto(`${ORIGIN}/festival-hub#festival=dorsetfest`);
    await page.getByRole("dialog").getByLabel("Stage", { exact: true }).selectOption("outcome");
    const stored = await page.evaluate(() => localStorage.getItem("msm.festivalHub.real.v1"));
    assert(!/example\.com|script|demo-/.test(stored), `stored: ${stored}`);
  });
  await page.goto(`${ORIGIN}/festival-hub`);
  await page.evaluate(() => localStorage.setItem("msm.festivalHub.real.v1", "{corrupt"));
  await page.reload();
  await check("corrupt JSON shows notice and empty shortlist", async () => {
    await page.getByRole("alert").filter({ hasText: "couldn't be read" }).waitFor();
    assert(!/on your shortlist/.test(await countText(page)), "should be empty");
  });
  await ctx.close();
}

// ── QA regressions: storage feedback, empty-state reset, contrast, headings ──
console.log("QA regressions — storage feedback, keyboard reset, contrast, headings");
// Contrast of the text as rendered: colour composited over the real backgrounds.
const renderedContrast = (locator) => locator.evaluate((el, pseudo) => {
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
  let bg = { r: 255, g: 255, b: 255 };
  for (const e of chain) { const c = rgba(getComputedStyle(e).backgroundColor); if (c.a > 0) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) }; }
  const fg = rgba(getComputedStyle(el, pseudo).color);
  const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
  const lum = ({ r, g, b }) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}, null);
const placeholderContrast = (locator) => locator.evaluate((el) => {
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
  let bg = { r: 255, g: 255, b: 255 };
  for (const e of chain) { const c = rgba(getComputedStyle(e).backgroundColor); if (c.a > 0) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) }; }
  const fg = rgba(getComputedStyle(el, "::placeholder").color);
  const lum = ({ r, g, b }) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
});
const alertsInDom = (page) => page.evaluate(() => [...document.querySelectorAll("[role=alert]")].map((a) => ({ inDialog: !!a.closest("dialog"), text: a.textContent })));

for (const viewport of [{ width: 375, height: 760 }, { width: 1280, height: 900 }]) {
  const { ctx, log } = await newContext({ viewport });
  await ctx.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError"); }; });
  const page = await ctx.newPage();
  await check(`${viewport.width}px: failed save shows a visible, announced warning INSIDE the dialog and never says "saved"`, async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=twyfest`);
    const dlg = page.getByRole("dialog");
    await tabTo(page, (i) => i.tag === "BUTTON" && /Save to shortlist/.test(i.label));
    await page.keyboard.press("Enter");
    const warning = dlg.getByRole("alert");
    await warning.waitFor();
    assert(/Not saved/.test(await warning.textContent()) && /lost when you reload/.test(await warning.textContent()), await warning.textContent());
    await warning.scrollIntoViewIfNeeded();
    const visibleOnTop = await warning.evaluate((w) => { const r = w.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 8, r.top + 8); return w.contains(top); });
    assert(visibleOnTop, "warning is covered");
    const alerts = await alertsInDom(page);
    assert(alerts.length === 1 && alerts[0].inDialog, `expected exactly one alert, in the dialog: ${JSON.stringify(alerts)}`);
    const status = await dlg.getByRole("status").textContent();
    assert(!/Saved to your shortlist/.test(status), `status claims success: ${status}`);
    // In-memory only: the listing shows as shortlisted on this page, and a second change says so.
    await dlg.getByRole("button", { name: /Remove from shortlist/ }).click();
    assert(/Removed on this page only — not saved/.test(await dlg.getByRole("status").textContent()), await dlg.getByRole("status").textContent());
    await dlg.getByRole("button", { name: /Save to shortlist/ }).click();
    assert(/Added on this page only — not saved, so it will be lost when you reload/.test(await dlg.getByRole("status").textContent()), "re-add status");
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached" });
    const after = await alertsInDom(page);
    assert(after.length === 1 && !after[0].inDialog && /couldn't be saved/.test(after[0].text), `page warning after close: ${JSON.stringify(after)}`);
    if (viewport.width === 375) await page.screenshot({ path: join(OUT, "qa-storage-fail-375.png") });
    return assertHubNetworkClean(log, `storage-${viewport.width}`);
  });
  await ctx.close();
}
{
  const { ctx } = await newContext({ viewport: { width: 375, height: 760 } });
  const page = await ctx.newPage();
  await check("375px: successful save/remove are announced as saved/removed in THIS browser, with no warning", async () => {
    await page.goto(`${ORIGIN}/festival-hub#festival=dorsetfest`);
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: /Save to shortlist/ }).click();
    assert(await dlg.getByRole("status").textContent() === "Saved to your shortlist in this browser.", await dlg.getByRole("status").textContent());
    await dlg.getByRole("button", { name: /Remove from shortlist/ }).click();
    assert(await dlg.getByRole("status").textContent() === "Removed from your shortlist in this browser.", "remove status");
    assert((await alertsInDom(page)).length === 0, "unexpected alert");
  });
  await check("375px: keyboard reset from the empty state focuses the results; next Tab reaches the first card", async () => {
    await page.goto(`${ORIGIN}/festival-hub`);
    await page.getByLabel("Region").focus();
    await page.getByLabel("Region").selectOption("Wales");
    await page.getByLabel("Status").selectOption("closed");
    await tabTo(page, (i) => i.tag === "BUTTON" && /Reset filters/.test(i.label) && i.label.length < 20 && true, 30);
    // the filter-bar reset comes first; continue to the empty-state one
    if (!(await page.evaluate(() => !!document.activeElement.closest(".fh-empty")))) await tabTo(page, (i) => i.tag === "BUTTON" && /Reset filters/.test(i.label), 30);
    assert(await page.evaluate(() => !!document.activeElement.closest(".fh-empty")), "not on the empty-state reset");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "fh-results");
    assert(/26 listings/.test(await countText(page)), "results not restored");
    await page.keyboard.press("Tab");
    const first = await page.locator(".fh-card").first().getAttribute("href");
    assert((await activeInfo(page)).href === first, `next Tab went to ${JSON.stringify(await activeInfo(page))}`);
  });
  await check("listings have a level-2 heading before the level-3 card titles", async () => {
    const levels = await page.locator("h1, h2, h3").evaluateAll((hs) => hs.map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 20)}`));
    const h2 = levels.indexOf("H2:Festival listings");
    const firstCard = levels.findIndex((l) => l.startsWith("H3:"));
    assert(h2 > levels.indexOf("H1:Festival Hub 2027") && h2 < firstCard, levels.slice(0, 5).join(", "));
  });
  await check("375px: changed text colours meet WCAG AA (≥4.5:1) as rendered", async () => {
    const results = {};
    results.openBadge = await renderedContrast(page.locator(".fh-st-open").first());
    results.primaryButton = await renderedContrast(page.locator(".fh-btn-primary").first());
    results.liveSiteSmall = await renderedContrast(page.locator(".fh-btn-primary small").first());
    results.placeholder = await placeholderContrast(page.getByLabel("Search"));
    await page.keyboard.press("Home");
    await page.locator(".fh-skip").focus();
    results.skipLink = await renderedContrast(page.locator(".fh-skip"));
    await page.goto(`${ORIGIN}/festival-hub?demo=1`);
    results.demoBanner = await renderedContrast(page.locator(".fh-banner").first());
    results.demoBadge = await renderedContrast(page.locator(".fh-badge-demo").first());
    await page.goto(`${ORIGIN}/festival-hub#festival=hanwell-hootie`);
    results.dialogApplyButton = await renderedContrast(page.getByRole("dialog").locator(".fh-btn-primary").first());
    const low = Object.entries(results).filter(([, r]) => r < 4.5);
    assert(low.length === 0, `below 4.5:1: ${JSON.stringify(low)}`);
    return JSON.stringify(results);
  });
  await ctx.close();
}

// ── Hub logo: derived lossless WebP vs the shared master ────────────
// The calendar still serves /brand/MSM-Logo-Master.png; the Hub must load only
// its own derived WebP, whose decoded pixels -- and therefore the rendered
// logo -- are identical to the master at every pixel density.
console.log("Hub logo — derived lossless WebP vs shared master");
for (const dpr of [1, 2, 3]) {
  const { ctx, log } = await newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await check(`DPR ${dpr}: Hub loads only the WebP logo; decoded pixels and rendered logo identical to the master`, async () => {
    await page.goto(`${ORIGIN}/festival-hub`);
    const img = page.getByAltText("Music Scene Magazine");
    await img.evaluate((i) => i.decode());
    const src = await img.evaluate((i) => new URL(i.src).pathname);
    assert(/^\/festival-hub\/assets\/msm-logo-hub-[\w-]+\.webp$/.test(src), `logo src ${src}`);
    assert(!log.requests.some((u) => u.includes("MSM-Logo-Master")), "Hub requested the master PNG");
    const pixels = await page.evaluate(async (hubSrc) => {
      const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
      const [a, b] = await Promise.all([load(hubSrc), load("/brand/MSM-Logo-Master.png")]);
      const data = (i) => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const da = data(a), db = data(b);
      let diff = 0; for (let k = 0; k < da.length; k++) if (da[k] !== db[k]) diff++;
      return { size: [a.naturalWidth, a.naturalHeight, b.naturalWidth, b.naturalHeight], diff, length: da.length };
    }, src);
    assert(pixels.size.join() === "1254,1254,1254,1254" && pixels.diff === 0, JSON.stringify(pixels));
    const box = page.locator(".fh-brand > span").first();
    const hubShot = await box.screenshot();
    await img.evaluate((i) => new Promise((res) => { i.onload = res; i.src = "/brand/MSM-Logo-Master.png"; }));
    const masterShot = await box.screenshot();
    assert(hubShot.equals(masterShot), "rendered logo differs from the master rendering");
    return `${pixels.length / 4} pixels identical; ${dpr}× render byte-identical`;
  });
  await ctx.close();
}

// ── Calendar shell served on hub paths (guard) ─────────────────────
console.log("Guard — calendar shell on hub paths");
{
  const { ctx, log } = await newContext();
  const page = await ctx.newPage();
  await check("unknown /festival-hub/* path (Vercel catch-all) redirects to hub without starting the calendar", async () => {
    await page.goto(`${ORIGIN}/festival-hub/some/deep/path?x=1#festival=twyfest`);
    await banner(page).waitFor();
    assert(new URL(page.url()).pathname === "/festival-hub/index.html", page.url());
    assert(page.url().endsWith("?x=1#festival=twyfest"), `query/hash lost: ${page.url()}`);
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
    await page.goto(`${ORIGIN}/festival-hub#festival=dart-music-festival`);
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
