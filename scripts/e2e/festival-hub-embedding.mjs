// Festival Hub embedding (CSP frame-ancestors) regression checks, in Chromium.
//
// Live set-up being guarded: the WordPress page
// https://musicscenemagazine.co.uk/gig-calendar/ frames the calendar in
// iframe#msm-calendar (src https://msm-gig-calendar.vercel.app). The calendar's
// FESTIVAL HUB tab is a plain same-tab link, so clicking it REPLACES the
// calendar inside that same frame: the Hub's only ancestor is the WordPress
// page. The release CSP therefore allows exactly the two WordPress origins.
//
// Every host is real HTTPS on port 443 (CSP host-sources without a port only
// match the default port), mapped to 127.0.0.1 with --host-resolver-rules and
// a throwaway self-signed certificate. The WordPress and calendar pages are
// minimal stubs reproducing that markup; the Hub is the real launch build
// served with the template's headers. Must run as a user that can bind :443.
//
//   node scripts/e2e/festival-hub-embedding.mjs
//   HUB_EMBED_DIST=<dir>  skip the build and serve an existing launch output
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const WP = "musicscenemagazine.co.uk";
const WP_WWW = "www.musicscenemagazine.co.uk";
const HUB = "festivals.musicscenemagazine.co.uk";
const CALENDAR_EMBED = "msm-gig-calendar.vercel.app"; // the iframe's src host on the live WordPress page
const CALENDAR = "calendar.musicscenemagazine.co.uk";
const EVIL = "evil.example";
const LOOKALIKE = "musicscenemagazine.co.uk.evil.example";
const HOSTS = [WP, WP_WWW, HUB, CALENDAR_EMBED, CALENDAR, EVIL, LOOKALIKE];
const TEMPLATES = { release: "scripts/standalone/vercel.release.json", standalone: "scripts/standalone/vercel.json" };
const ALLOWED_ANCESTORS = `https://${WP} https://${WP_WWW}`;

// Launch build of the Hub.
let DIST = process.env.HUB_EMBED_DIST && resolve(process.env.HUB_EMBED_DIST);
if (!DIST) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "VERCEL_ENV" && !k.startsWith("HUB_")));
  execFileSync("npm", ["run", "build:hub-standalone"], { cwd: ROOT, env: { ...env, HUB_LAUNCH: "1" }, stdio: ["ignore", "ignore", "inherit"] });
  DIST = join(ROOT, "dist-hub-standalone");
}
if (!readFileSync(join(DIST, "festival-hub/index.html"), "utf8").includes('content="index, follow"')) throw new Error(`${DIST} is not a launch build`);

// Throwaway certificate for every host.
const certDir = mkdtempSync(join(tmpdir(), "hub-embed-cert-"));
writeFileSync(join(certDir, "san.cnf"), `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${HUB}\n[ext]\nsubjectAltName=${HOSTS.map((h) => `DNS:${h}`).join(",")}\n`);
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"), "-config", join(certDir, "san.cnf")], { stdio: "ignore" });

// Header rules from a vercel.json template, with Vercel's `has`/`missing` host regex semantics.
let template;
const headersFor = (host) => {
  const out = {};
  for (const rule of template.headers) {
    const hostOk = (conds, want) => (conds || []).every((c) => c.type !== "host" || new RegExp(c.value).test(host) === want);
    if (hostOk(rule.has, true) && hostOk(rule.missing, false)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml" };
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>stub</title></head><body>${body}</body></html>`;
const CAL_LINK = `<nav><a href="https://${HUB}/">FESTIVAL HUB</a></nav>`;
const STUBS = {
  // WordPress / other top-level pages
  "/gig-calendar/": page(`<iframe id="msm-calendar" src="https://${CALENDAR_EMBED}/" width="1000" height="700"></iframe>`),
  "/embed-hub/": page(`<iframe id="hub" src="https://${HUB}/" width="1000" height="700"></iframe>`),
  "/embed-nested/": page(`<iframe id="msm-calendar" src="https://${CALENDAR_EMBED}/nested/" width="1000" height="700"></iframe>`),
  // Calendar stubs: the plain same-tab nav link, or (hypothetical) a Hub iframe inside the calendar
  "/": page(CAL_LINK),
  "/nested/": page(`<iframe id="hub" src="https://${HUB}/" width="900" height="600"></iframe>`),
};

const server = createServer({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, (req, res) => {
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  const path = req.url.split("?")[0];
  if (host === HUB) {
    const rel = ["/", "/festival-hub", "/festival-hub/"].includes(path) ? "festival-hub/index.html" : normalize(path).replace(/^\/+/, "");
    const file = join(DIST, rel);
    const headers = headersFor(host);
    if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404, headers); return res.end(); }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    return res.end(readFileSync(file));
  }
  const body = STUBS[path];
  res.writeHead(body ? 200 : 404, { "Content-Type": "text/html" });
  res.end(body || "");
});
await new Promise((ok, fail) => server.once("error", fail).listen(443, "127.0.0.1", ok));

// The test hosts resolve to 127.0.0.1 and skip any configured proxy; every other
// host is aborted (see offline()), so nothing leaves this machine.
const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  args: [`--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(", ")}`],
  ...(proxyServer ? { proxy: { server: proxyServer, bypass: HOSTS.join(",") } } : {}),
});
const offline = (ctx) => ctx.route((url) => !HOSTS.includes(url.hostname), (r) => r.abort());
const results = [];
async function check(name, fn) {
  try { const note = await fn(); results.push(true); console.log(`  ✓ ${name}${note ? ` — ${note}` : ""}`); }
  catch (e) { results.push(false); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// Opens `url` top-level, optionally clicks FESTIVAL HUB inside iframe#msm-calendar,
// and reports whether the Hub rendered inside the frame and any frame-ancestors refusals.
async function visit(url, { click = false, frameSel = "#msm-calendar", hubFrameSel } = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  await offline(ctx);
  const p = await ctx.newPage();
  const refused = [];
  p.on("console", (m) => { if (/frame-ancestors/.test(m.text())) refused.push(m.text()); });
  await p.goto(url);
  let frame = p.frameLocator(frameSel);
  if (click) {
    await frame.getByRole("link", { name: "FESTIVAL HUB" }).click();
    await p.waitForTimeout(300);
  }
  if (hubFrameSel) frame = frame.frameLocator(hubFrameSel);
  const heading = frame.getByRole("heading", { name: "Festival Hub 2027", exact: true });
  const rendered = await heading.waitFor({ timeout: 4000 }).then(() => true, () => false);
  const frameUrls = p.frames().map((f) => f.url());
  await ctx.close();
  return { rendered, refused, frameUrls };
}
const loads = (r) => { assert(r.rendered && !r.refused.length, `expected the Hub to render: ${JSON.stringify(r)}`); return "rendered, no frame-ancestors errors"; };
const blocked = (r) => {
  assert(!r.rendered, `expected the Hub to be refused: ${JSON.stringify(r)}`);
  assert(r.refused.some((t) => t.includes(HUB)), `no frame-ancestors refusal of ${HUB} logged: ${JSON.stringify(r)}`);
  return "refused by frame-ancestors";
};

console.log(`Release template (${TEMPLATES.release})`);
template = JSON.parse(readFileSync(join(ROOT, TEMPLATES.release), "utf8"));
await check("Hub CSP: frame-ancestors is exactly the two WordPress origins; every other directive unchanged from the standalone template", async () => {
  const csp = headersFor(HUB)["Content-Security-Policy"];
  const std = JSON.parse(readFileSync(join(ROOT, TEMPLATES.standalone), "utf8")).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert(csp === std.replace("frame-ancestors 'none'", `frame-ancestors ${ALLOWED_ANCESTORS}`), csp);
});
await check(`WordPress ${WP}/gig-calendar/ → calendar iframe → FESTIVAL HUB click: Hub loads in the same frame`, async () => loads(await visit(`https://${WP}/gig-calendar/`, { click: true })));
await check(`WordPress ${WP_WWW}/gig-calendar/ → calendar iframe → FESTIVAL HUB click: Hub loads`, async () => loads(await visit(`https://${WP_WWW}/gig-calendar/`, { click: true })));
await check(`WordPress ${WP} frames the Hub directly: loads`, async () => loads(await visit(`https://${WP}/embed-hub/`, { frameSel: "#hub" })));
await check(`${EVIL} frames the Hub directly: refused`, async () => blocked(await visit(`https://${EVIL}/embed-hub/`, { frameSel: "#hub" })));
await check(`${EVIL} frames the calendar → FESTIVAL HUB click: refused`, async () => blocked(await visit(`https://${EVIL}/gig-calendar/`, { click: true })));
await check(`look-alike ${LOOKALIKE} frames the Hub: refused`, async () => blocked(await visit(`https://${LOOKALIKE}/embed-hub/`, { frameSel: "#hub" })));
await check(`${CALENDAR} (not an allowed ancestor) frames the Hub: refused`, async () => blocked(await visit(`https://${CALENDAR}/embed-hub/`, { frameSel: "#hub" })));
await check("a Hub iframe nested INSIDE the framed calendar (not used live): refused, since the calendar origin isn't allowed", async () =>
  blocked(await visit(`https://${WP}/embed-nested/`, { hubFrameSel: "#hub" })));
await check("top-level visit to the Hub is unaffected", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  await offline(ctx);
  const p = await ctx.newPage();
  await p.goto(`https://${HUB}/`);
  await p.getByRole("heading", { name: "Festival Hub 2027", exact: true }).waitFor({ timeout: 4000 });
  await ctx.close();
});

console.log(`Standalone (staging) template (${TEMPLATES.standalone})`);
template = JSON.parse(readFileSync(join(ROOT, TEMPLATES.standalone), "utf8"));
await check(`staging keeps frame-ancestors 'none': WordPress ${WP} → calendar → FESTIVAL HUB click is refused`, async () => blocked(await visit(`https://${WP}/gig-calendar/`, { click: true })));

await browser.close();
server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} embedding checks passed.`);
process.exit(failed ? 1 : 0);
