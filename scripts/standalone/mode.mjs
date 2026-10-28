// Festival Hub build mode -- shared by the standalone Vite config (to build)
// and verify-output.mjs (to check), so both always agree.
//
// "launch" (public site) only when BOTH:
//   HUB_RELEASE=1 (set only by `npm run build:hub-release`) and
//   VERCEL_ENV=production (set by Vercel only for a project's production branch),
// or HUB_LAUNCH=1 (explicit override, for local tests and the reviewed
// launch-check preview branch). Everything else -- every preview, the
// standalone branch, the feature branch, local builds -- is "staging".

export const PUBLIC_ORIGIN = "https://festivals.musicscenemagazine.co.uk";
export const CANONICAL_URL = `${PUBLIC_ORIGIN}/`;
// Exact host allowed to be indexed (anchored, escaped regex for vercel.json `missing`).
export const INDEXABLE_HOST = "festivals.musicscenemagazine.co.uk";
export const INDEXABLE_HOST_REGEX = "^festivals\\.musicscenemagazine\\.co\\.uk$";

export const isLaunchBuild = (env = process.env) =>
  env.HUB_LAUNCH === "1" || (env.HUB_RELEASE === "1" && env.VERCEL_ENV === "production");

export const LAUNCH_TITLE = "MSM Festival Hub 2027 – UK festival applications for grassroots bands";
export const LAUNCH_DESCRIPTION =
  "UK festival application windows for 2027, checked against each festival's own site. Shortlist and track your applications – from Music Scene Magazine.";

export const ROBOTS_TXT = `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`;
export const SITEMAP_XML =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${CANONICAL_URL}</loc></url>\n</urlset>\n`;

// Head tags replaced in festival-hub/index.html for launch builds. Each `from`
// must exist exactly once (the build fails otherwise).
export const LAUNCH_HTML_REPLACEMENTS = [
  ["    <!-- Staging: keep out of search engines. -->\n", ""],
  ['<meta name="robots" content="noindex, nofollow" />', '<meta name="robots" content="index, follow" />'],
  [
    '<meta name="description" content="MSM Festival Hub (staging): 2027 UK festival application windows for grassroots bands, checked against official festival sources." />',
    `<meta name="description" content="${LAUNCH_DESCRIPTION}" />\n` +
      `    <link rel="canonical" href="${CANONICAL_URL}" />\n` +
      `    <meta property="og:type" content="website" />\n` +
      `    <meta property="og:site_name" content="Music Scene Magazine" />\n` +
      `    <meta property="og:title" content="${LAUNCH_TITLE}" />\n` +
      `    <meta property="og:description" content="${LAUNCH_DESCRIPTION}" />\n` +
      `    <meta property="og:url" content="${CANONICAL_URL}" />`,
  ],
  ["<title>MSM Festival Hub (Staging)</title>", `<title>${LAUNCH_TITLE}</title>`],
];

export function applyLaunchHtml(html) {
  let out = html;
  for (const [from, to] of LAUNCH_HTML_REPLACEMENTS) {
    const count = out.split(from).length - 1;
    if (count !== 1) throw new Error(`launch HTML: expected exactly one ${JSON.stringify(from.slice(0, 60))}, found ${count}`);
    out = out.replace(from, to);
  }
  return out;
}
