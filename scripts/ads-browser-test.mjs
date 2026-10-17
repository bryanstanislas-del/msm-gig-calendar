#!/usr/bin/env node
// LOCAL BROWSER VERIFICATION (synthetic fixtures only; no hosted API, no
// real provider, no credentials). Playwright is a pinned devDependency
// (playwright 1.56.1 in package.json/package-lock.json). Setup elsewhere:
//   npm ci && npx playwright install chromium   (once)
// In the Claude Code container the matching Chromium is pre-installed
// (PLAYWRIGHT_BROWSERS_PATH), so no download happens.
// Every request leaving 127.0.0.1 is intercepted:
// Supabase calls are answered locally with [] and recorded, anything else is
// aborted -- nothing reaches the network.
//
//   npm run test:browser
//
// A. Supabase project isolation: the REAL app built with no override, a
//    complete synthetic override and a partial override.
// B. Critical advertiser/admin screens rendered from the real components
//    against tests/browser/fakeSupabase.js (RLS/ownership emulated).
import { build, preview } from "vite";
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.ADS_BROWSER_SCREENSHOTS || path.join(ROOT, "docs/ads/verification/local-browser");
fs.mkdirSync(SHOTS, { recursive: true });
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "msm-ads-browser-"));
const NOW = "2026-11-02T12:00:00Z";
const STAGING = "https://stagingsynthetic000a.supabase.co";    // synthetic 20-char ref, never contacted
let failures = 0;
const check = (ok, label) => { console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failures += 1; };

async function buildApp(dir, env) {
  const saved = { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY };
  delete process.env.VITE_SUPABASE_URL; delete process.env.VITE_SUPABASE_ANON_KEY;
  Object.assign(process.env, env);
  try {
    await build({ root: ROOT, logLevel: "error", build: { outDir: dir, emptyOutDir: true } });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

async function serve(dir, port, configFile = false) {
  return preview({ root: ROOT, configFile, logLevel: "error", build: { outDir: dir }, preview: { port, strictPort: true, host: "127.0.0.1" } });
}

async function isolatedPage(browser, record, viewport = VIEWPORTS.desktop) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname.endsWith(".supabase.co")) {
      record.supabase.push(u.hostname);
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" });
    }
    record.other.push(u.hostname);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => record.errors.push(String(e.message || e)));
  return { ctx, page };
}

async function projectIsolation(browser) {
  console.log("== A. Supabase project isolation (real app build; all requests intercepted locally)");
  const cases = [
    { name: "no override (production fallback)", env: {}, port: 4801 },
    { name: "complete synthetic override", env: { VITE_SUPABASE_URL: STAGING, VITE_SUPABASE_ANON_KEY: "LOCAL-FAKE-anon-key" }, port: 4802 },
    { name: "partial override (URL only)", env: { VITE_SUPABASE_URL: STAGING }, port: 4803 },
  ];
  for (const c of cases) {
    const dir = path.join(OUT, `app-${c.port}`);
    await buildApp(dir, c.env);
    const server = await serve(dir, c.port);
    const record = { supabase: [], other: [], errors: [] };
    const { ctx, page } = await isolatedPage(browser, record);
    await page.goto(`http://127.0.0.1:${c.port}/`, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const hosts = [...new Set(record.supabase)];
    if (c.name.startsWith("no override")) {
      check(hosts.length === 1 && hosts[0] !== new URL(STAGING).hostname, `${c.name}: one project for the whole app (${hosts.join(",") || "none"})`);
    } else if (c.name.startsWith("complete")) {
      check(record.supabase.length > 0 && hosts.length === 1 && hosts[0] === new URL(STAGING).hostname,
        `${c.name}: every Supabase request (${record.supabase.length}) goes to the override project only`);
    } else {
      check(record.supabase.length === 0, `${c.name}: no Supabase request at all`);
      check(record.errors.some((e) => /Partial Supabase override/.test(e)), `${c.name}: refused loudly ("Partial Supabase override")`);
    }
    await ctx.close();
    await new Promise((r) => server.httpServer.close(r));
  }
}

async function screens(browser) {
  console.log("== B. Advertiser / admin screens (synthetic fixtures, fake client)");
  const dir = path.join(OUT, "harness");
  await build({ configFile: path.join(ROOT, "tests/browser/vite.harness.config.js"), build: { outDir: dir } });
  const server = await serve(dir, 4810);
  const open = async (qs, viewport) => {
    const record = { supabase: [], other: [], errors: [] };
    const { ctx, page } = await isolatedPage(browser, record, viewport);
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto(`http://127.0.0.1:4810/harness.html?${qs}`);
    await page.waitForLoadState("networkidle");
    return { ctx, page, record };
  };
  const text = (page) => page.locator("body").innerText();

  // Owner: review/correction deadlines, confirmation, priority price + deadline, amendment acceptance.
  let { ctx, page, record } = await open("screen=portal&user=owner");
  let t = await text(page);
  check(t.includes("MSM asked for a correction to version 1: Logo <script>x</script> cropped; Link returns 404.")
    && (await page.locator("script", { hasText: "x" }).count()) === 0, "correction reasons shown as text (not markup), exact version");
  check(t.includes("Please submit a corrected version by Mon 2 Nov 2026 14:00 GMT (UTC+00:00)"), "correction response deadline with explicit offset");
  check(!/advertiser_material/.test(t), "internal correction cause not shown to the advertiser");
  check(t.includes("Placement £20.00 + priority review £150.00 = £170.00") && t.includes("DRAFT-NOT-APPROVED-2026-10-16"), "durable confirmation: price split + draft terms");
  await page.getByRole("button", { name: "Check availability & price" }).click();
  await page.getByText("Add optional priority review").click();
  await page.getByRole("button", { name: "Check availability & price" }).click();
  t = await text(page);
  check(t.includes("Priority review (£150.00)") && t.includes("by Tue 3 Nov 2026 00:00 GMT (UTC+00:00)"), "priority price and exact deadline shown before payment");
  check(t.includes("run Mon 2 Nov 2026 11:00 GMT (UTC+00:00) until Wed 4 Nov 2026 00:00 GMT (UTC+00:00) (end not included), 37 h")
    && t.includes("11 h shorter than your purchased 48 h") && t.includes("does not waive any refund"), "amendment: exact intervals, shortfall, refund not waived");
  check(t.includes("This offer has expired."), "lapsed offer shown as expired");
  check((await page.getByRole("button", { name: "Accept this change" }).count()) === 1, "accept button only for the one open, unexpired offer");
  check(!t.includes("2026-11-08"), "another advertiser's booking/offer is invisible");
  await page.getByRole("button", { name: "Accept this change" }).click();
  await page.waitForTimeout(400);
  t = await text(page);
  const calls = await page.evaluate(() => window.__rpcCalls.filter((c) => c.name === "ad_respond_amendment"));
  check(calls.length === 1 && calls[0].args.p_amendment_id === "am-open" && calls[0].args.p_decision === "accept" && calls[0].user === "u-owner", "owner acceptance sent once, for the right offer");
  check(t.includes("Status: accepted") && t.includes("Mon 2 Nov 2026 11:00 GMT (UTC+00:00) until Wed 4 Nov 2026 00:00 GMT (UTC+00:00) (end not included; changed by agreement)"),
    "after acceptance: accepted status and the new serving interval");
  check(record.other.length === 0 && record.supabase.length === 0, "harness made no external request");
  await ctx.close();

  // Other advertiser: sees only their own offer.
  ({ ctx, page } = await open("screen=portal&user=other"));
  t = await text(page);
  check(!t.includes("Mon 2 Nov 2026 11:00 GMT") && t.includes("Sun 8 Nov 2026 10:00 GMT"), "other advertiser sees only their own offer");
  await ctx.close();

  // Admin: SLA, refund gates, cancellation initiator, reconciliation, no acceptance on the owner's behalf.
  ({ ctx, page } = await open("screen=admin&user=admin"));
  t = await text(page);
  check(/Review queue \(1\)/i.test(t) && /Due by end of Mon 2 Nov 2026/.test(t), "review queue with due date");
  check(t.includes("manual_gate: cross_kind_allocation, exceeds_booking_total") && t.includes("cannot be approved here"), "refund manual gates visible");
  const gatedCard = page.locator("div", { hasText: "manual_gate: cross_kind_allocation" }).last();
  await page.getByPlaceholder("Decision / processing note").first().fill("Reviewed, policy pending");
  check(await page.getByRole("button", { name: "Approve", exact: true }).first().isDisabled(), "approve disabled for a manual-gate assessment");
  check(t.includes("May already have been sent - check the provider dashboard") && t.includes("provider idempotency window elapsed"), "notification needing reconciliation explained");
  check((await page.getByRole("button", { name: "Retry" }).count()) === 0, "no blind retry for a possibly-sent email");
  check((await page.getByRole("button", { name: "Accept this change" }).count()) === 0, "admin has no way to accept an amendment for the advertiser");
  await page.getByPlaceholder("Reason for pause/removal (required to remove)").fill("Advertiser asked by email");
  check(await page.getByRole("button", { name: "Remove" }).first().isDisabled(), "removal blocked until the initiator is chosen");
  await page.getByLabel("Who initiated the cancellation").selectOption("advertiser");
  check(!(await page.getByRole("button", { name: "Remove" }).first().isDisabled()), "removal enabled once the initiator is recorded");
  const summaries = page.locator("summary", { hasText: "Review SLA / corrections / refunds" });
  await summaries.first().click();
  await page.waitForTimeout(300);
  t = await text(page);
  check(t.includes("correction_response: Mon 2 Nov 2026 11:00 GMT (UTC+00:00) -> Mon 2 Nov 2026 14:00 GMT (UTC+00:00)")
    && t.includes("(advertiser_material)"), "admin SLA: deadlines with offsets and the internal cause");
  const removedRow = page.locator("tr", { hasText: "b-removed" });
  await removedRow.locator("summary").click();
  await page.waitForTimeout(300);
  t = await text(page);
  check(t.includes("MSM-initiated removal: no loss can be retained") && (await page.getByPlaceholder("Net loss after mitigation (pence)").count()) === 0,
    "MSM removal: no loss-retention field");
  void gatedCard;
  await ctx.close();

  // Screenshots (desktop + mobile) of the critical screens, synthetic data only.
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    for (const [name, qs] of [["advertiser", "screen=portal&user=owner"], ["admin", "screen=admin&user=admin"]]) {
      const o = await open(qs, size);
      await o.page.screenshot({ path: path.join(SHOTS, `${name}-${vp}.png`), fullPage: true });
      const overflow = await o.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 1, `${name} ${vp}: no horizontal page scroll (${overflow}px)`);
      check(o.record.other.length === 0, `${name} ${vp}: no external request`);
      await o.ctx.close();
    }
  }
  console.log(`  screenshots: ${path.relative(ROOT, SHOTS)}/{advertiser,admin}-{desktop,mobile}.png`);
  await new Promise((r) => server.httpServer.close(r));
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
try {
  await projectIsolation(browser);
  await screens(browser);
} finally {
  await browser.close();
  fs.rmSync(OUT, { recursive: true, force: true });
}
console.log(failures ? `BROWSER CHECKS FAILED (${failures})` : "ALL BROWSER CHECKS PASSED");
process.exit(failures ? 1 : 0);
