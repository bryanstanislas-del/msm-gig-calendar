// Verifies the Festival Hub STANDALONE build (dist-hub-standalone/) and
// exits non-zero -- failing "npm run build:hub-standalone", and therefore
// the deployment -- if anything other than the hub is present.
//
// Checks:
//   1. files: only the hub HTML, its JS/CSS assets, exactly one image -- the
//      Hub logo, a lossless WebP of at most LOGO_BUDGET bytes -- and the
//      favicon (no source maps, service worker, workbox, manifest, calendar
//      bundle, API, robots/sitemap, master PNG or other public/ files)
//   2. module graph (recorded by vite.festival-hub-standalone.config.js):
//      only src/festivalHub/*, the hub HTML, React/ReactDOM/scheduler and
//      Vite/Rollup helpers -- no App.jsx, calendar entry, backend client,
//      PWA register or test files
//   3. content: no backend hosts/keys/JWTs, service-worker or manifest
//      references, calendar code markers, API paths or source-map comments
//   4. HTML: noindex, one module script from festival-hub/assets, no inline
//      scripts, no manifest link
//   5. on Vercel (VERCEL=1): the api/ and supabase/ directories must not
//      exist in the build checkout (.vercelignore keeps them out), so
//      serverless functions cannot be detected and deployed.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = resolve(ROOT, process.argv[2] || "dist-hub-standalone");
const GRAPH = resolve(ROOT, process.argv[3] || "dist-hub-standalone.modules.json");
const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [relative(OUT, p).split("\\").join("/")];
  });
}

// 1. Files
const ALLOWED_FILES = [
  /^festival-hub\/index\.html$/,
  /^festival-hub\/assets\/[\w-]+\.(js|css)$/,
  /^festival-hub\/assets\/msm-logo-hub-[\w-]+\.webp$/,
  /^favicon\.ico$/,
];
// Hub logo: derived lossless WebP (see src/festivalHub/theme.js); 342,906 B today.
export const LOGO_BUDGET = 350000;
if (!existsSync(OUT)) fail(`output directory missing: ${OUT}`);
const files = existsSync(OUT) ? walk(OUT) : [];
for (const f of files) if (!ALLOWED_FILES.some((re) => re.test(f))) fail(`unexpected file in output: ${f}`);
if (!files.includes("festival-hub/index.html")) fail("festival-hub/index.html missing");
if (!files.some((f) => /^festival-hub\/assets\/.+\.js$/.test(f))) fail("hub JS bundle missing");
const logos = files.filter((f) => /\.webp$/.test(f));
if (logos.length !== 1) fail(`expected exactly one Hub logo .webp, found ${logos.length}`);
for (const f of logos) {
  const buf = readFileSync(join(OUT, f));
  if (buf.length > LOGO_BUDGET) fail(`${f}: ${buf.length} B exceeds the ${LOGO_BUDGET} B logo budget`);
  // RIFF....WEBPVP8L = lossless WebP (a lossy "VP8 " or extended "VP8X" file is rejected).
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP" || buf.toString("latin1", 12, 16) !== "VP8L") fail(`${f}: not a simple lossless WebP (RIFF/WEBP/VP8L)`);
}

// 2. Module graph
const ALLOWED_MODULES = [
  /^festival-hub\/index\.html$/,
  /^src\/festivalHub\/(?!.*\.test\.)[\w-]+\.(js|jsx)$/,
  /^src\/festivalHub\/assets\/msm-logo-hub\.webp$/,
  /^node_modules\/(react|react-dom|scheduler)\/[\w./-]+\.js$/,
  /^virtual:node_modules\/(react|react-dom|scheduler)\/[\w./-]+\.js\?commonjs-(module|exports|proxy|es-import)$/,
  /^virtual:(vite\/modulepreload-polyfill\.js|commonjsHelpers\.js)$/,
];
if (!existsSync(GRAPH)) fail(`module graph missing: ${GRAPH}`);
else {
  const graph = JSON.parse(readFileSync(GRAPH, "utf8"));
  const chunks = Object.entries(graph);
  if (chunks.length !== 1) fail(`expected exactly one JS chunk, got ${chunks.length}`);
  for (const [name, chunk] of chunks) {
    if (chunk.dynamicImports.length) fail(`${name}: unexpected dynamic imports ${chunk.dynamicImports}`);
    for (const m of chunk.modules) if (!ALLOWED_MODULES.some((re) => re.test(m))) fail(`${name}: module not allowed in standalone build: ${m}`);
    if (!chunk.modules.includes("src/festivalHub/main.jsx")) fail(`${name}: hub entry not in graph`);
  }
}

// 3. Content
const BANNED_CONTENT = [
  [/supabase/i, "backend client / host"],
  [/fmlaaiolqwknowhtdeue|oyakrgdmplmxmlhjfqcd/, "backend project ref"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT-like key"],
  [/service_role|SUPABASE_|VERCEL_|sk_live|sk_test/i, "secret / env name"],
  [/serviceWorker|registerSW|workbox/i, "service worker"],
  [/manifest\.webmanifest/, "web app manifest"],
  [/sourceMappingURL/, "source map reference"],
  [/["'`]\/api\//, "API route"],
  [/MSM calendar not started|fetchAllPages|public_gigs|import_gig_row/, "calendar code"],
];
for (const f of files.filter((x) => /\.(js|css|html)$/.test(x))) {
  const text = readFileSync(join(OUT, f), "utf8");
  for (const [re, what] of BANNED_CONTENT) if (re.test(text)) fail(`${f}: contains ${what} (${re})`);
}

// 4. HTML
const htmlPath = join(OUT, "festival-hub/index.html");
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, "utf8");
  if (!/<meta name="robots" content="noindex, nofollow"/.test(html)) fail("hub HTML missing noindex meta");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) fail(`expected one script tag, found ${scripts.length}`);
  for (const [, attrs, body] of scripts) {
    if (body.trim()) fail("inline script content in hub HTML");
    if (!/type="module"/.test(attrs) || !/src="\/festival-hub\/assets\/[\w-]+\.js"/.test(attrs)) fail(`unexpected script tag: ${attrs}`);
  }
  if (/rel="manifest"/.test(html)) fail("manifest link in hub HTML");
}

// 5. Deployment checkout
if (process.env.VERCEL === "1") {
  for (const dir of ["api", "supabase"]) if (existsSync(resolve(ROOT, dir))) fail(`${dir}/ is present in the Vercel build checkout (.vercelignore not applied)`);
}

if (problems.length) {
  console.error(`Festival Hub standalone output FAILED verification (${problems.length}):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`Festival Hub standalone output verified: ${files.length} files (${files.join(", ")}); module graph and content clean.`);
