// api/sitemap.js — Dynamic XML sitemap, generated fresh on each request
// (cached briefly at the edge) directly from Supabase, so it always
// reflects current data with no separate build/publish step.
//
// Reached via a vercel.json rewrite for /sitemap.xml, ahead of the SPA
// catch-all, exactly like the existing /gig/:slug, /artist/:slug,
// /venue/:slug and /festival/:slug crawler routes.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      || "https://fmlaaiolqwknowhtdeue.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const BASE_URL          = process.env.VITE_BASE_URL          || "https://calendar.musicscenemagazine.co.uk";

function escapeXml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// <lastmod> uses only the date portion of a real updated_at timestamp --
// never a fabricated value. Omitted entirely when no timestamp exists.
function lastmodFrom(timestamp) {
  if (!timestamp) return null;
  const d = String(timestamp).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function urlEntry(loc, lastmod) {
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </url>`;
}

function buildXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

module.exports = async function handler(req, res) {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Same eligibility condition as the live "Public can view active
    // profiles" RLS policy on profiles (profile_type in the public set
    // AND disabled = false) -- kept deliberately identical, not broader
    // or narrower, so this sitemap can never claim a URL is public when
    // RLS itself would actually hide it (or vice versa).
    const [artists, festivals, venues, gigs] = await Promise.all([
      supabase.from("profiles")
        .select("band_slug, updated_at")
        .in("profile_type", ["band", "solo_artist"])
        .eq("disabled", false)
        .not("band_slug", "is", null),
      supabase.from("profiles")
        .select("band_slug, updated_at")
        .eq("profile_type", "festival")
        .eq("disabled", false)
        .not("band_slug", "is", null),
      supabase.from("venues")
        .select("slug, updated_at")
        .not("slug", "is", null),
      supabase.from("gigs")
        .select("slug, updated_at")
        .eq("status", "approved")
        .not("slug", "is", null),
    ]);

    const seen = new Set(); // belt-and-braces de-dupe, in addition to each query's own natural uniqueness
    const urls = [];
    const add = (loc, lastmod) => {
      if (!loc || seen.has(loc)) return;
      seen.add(loc);
      urls.push(urlEntry(loc, lastmod));
    };

    add(`${BASE_URL}/`, null);

    (artists.data || []).forEach(r => add(`${BASE_URL}/artist/${r.band_slug}`, lastmodFrom(r.updated_at)));
    (festivals.data || []).forEach(r => add(`${BASE_URL}/festival/${r.band_slug}`, lastmodFrom(r.updated_at)));
    (venues.data || []).forEach(r => add(`${BASE_URL}/venue/${r.slug}`, lastmodFrom(r.updated_at)));
    (gigs.data || []).forEach(r => add(`${BASE_URL}/gig/${r.slug}`, lastmodFrom(r.updated_at)));

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(buildXml(urls));

  } catch (err) {
    console.error("Sitemap generation error:", err.message);
    // A minimal but always-valid sitemap -- never a broken or empty
    // response, even if Supabase is briefly unreachable.
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buildXml([urlEntry(`${BASE_URL}/`, null)]));
  }
};
