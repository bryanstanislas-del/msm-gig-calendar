// api/robots.js — robots.txt, served dynamically (not a static file) so
// its Sitemap: line always uses the same BASE_URL source of truth as
// every other SEO step, rather than a second hardcoded copy of the
// domain that could drift out of sync.
//
// This does not act as a security boundary -- it's a crawling hint only.
// Anything genuinely private stays protected by Supabase RLS/auth, not by
// what's listed here.

const BASE_URL = process.env.VITE_BASE_URL || "https://calendar.musicscenemagazine.co.uk";

module.exports = function handler(req, res) {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Allow: /artist/",
    "Allow: /venue/",
    "Allow: /festival/",
    "Allow: /gig/",
    "Disallow: /api/",
    "",
    `Sitemap: ${BASE_URL}/sitemap.xml`,
    "",
  ].join("\n");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).send(body);
};
