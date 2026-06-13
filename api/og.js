// api/og.js — Server-rendered Open Graph tags for social sharing
// Deployed as a Vercel serverless function.
// Facebook/Twitter crawlers hit this endpoint and receive a full HTML page
// with correct OG meta tags, then follow the canonical URL to the SPA.
//
// Usage: /api/og?type=gig&slug=band-name-venue-2026-01-01
//        /api/og?type=band&slug=band-slug
//        /api/og?type=venue&slug=venue-slug

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      || "https://fmlaaiolqwknowhtdeue.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const BASE_URL          = process.env.VITE_BASE_URL           || "https://msm-gig-calendar.vercel.app";
const FALLBACK_IMAGE    = "https://musicscenemagazine.co.uk/wp-content/uploads/msm-share.jpg";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml({ title, description, url, image, canonicalUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">

  <!-- Open Graph -->
  <meta property="og:type"        content="website">
  <meta property="og:site_name"   content="Music Scene Magazine">
  <meta property="og:title"       content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url"         content="${escapeHtml(url)}">
  <meta property="og:image"       content="${escapeHtml(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image"       content="${escapeHtml(image)}">

  <!-- Redirect non-crawlers to the SPA immediately -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(canonicalUrl)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(title)}</a>...</p>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  const { type, slug } = req.query || {};

  // Default / fallback response
  const defaultMeta = {
    title:        "Music Scene Magazine — Gig Calendar",
    description:  "Find live music events across the South Coast UK. Discover gigs, bands and venues.",
    url:          BASE_URL,
    image:        FALLBACK_IMAGE,
    canonicalUrl: BASE_URL,
  };

  if (!slug || !type) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).send(buildHtml(defaultMeta));
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ── GIG ──
    if (type === "gig") {
      const { data, error } = await supabase
        .from("gigs")
        .select("band_name, venue, city, date, time, genre, notes, poster_url, slug")
        .eq("slug", slug)
        .eq("status", "approved")
        .single();

      if (error || !data) throw new Error("Gig not found");

      const canonicalUrl = `${BASE_URL}/gig/${data.slug}`;
      const title        = `${data.band_name} at ${data.venue}, ${data.city} | ${fmtDate(data.date)}`;
      const description  = [
        `${data.band_name} live at ${data.venue}, ${data.city} on ${fmtDate(data.date)}.`,
        data.notes ? data.notes : "",
        `Find gig details, band info and tickets on Music Scene Magazine.`,
      ].filter(Boolean).join(" ");

      return res.status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate")
        .send(buildHtml({
          title,
          description,
          url:          canonicalUrl,
          image:        data.poster_url || FALLBACK_IMAGE,
          canonicalUrl,
        }));
    }

    // ── BAND ──
    if (type === "band") {
      const { data, error } = await supabase
        .from("profiles")
        .select("band_name, city, primary_genre, bio, photo_url, band_slug")
        .eq("band_slug", slug)
        .eq("role", "band")
        .single();

      if (error || !data) throw new Error("Band not found");

      const canonicalUrl = `${BASE_URL}/artist/${data.band_slug}`;
      const title        = `${data.band_name} | Music Scene Magazine`;
      const description  = data.bio
        ? data.bio.slice(0, 200) + (data.bio.length > 200 ? "…" : "")
        : `${data.band_name}${data.city ? ` from ${data.city}` : ""}. Find upcoming gigs and more on Music Scene Magazine.`;

      return res.status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate")
        .send(buildHtml({
          title,
          description,
          url:          canonicalUrl,
          image:        data.photo_url || FALLBACK_IMAGE,
          canonicalUrl,
        }));
    }

    // ── VENUE ──
    if (type === "venue") {
      const { data, error } = await supabase
        .from("venues")
        .select("name, city, description, photo_url, slug")
        .eq("slug", slug)
        .single();

      if (error || !data) throw new Error("Venue not found");

      const canonicalUrl = `${BASE_URL}/venue/${data.slug}`;
      const title        = `${data.name}, ${data.city} | Music Scene Magazine`;
      const description  = data.description
        ? data.description.slice(0, 200)
        : `${data.name} in ${data.city}. See upcoming gigs and events on Music Scene Magazine.`;

      return res.status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate")
        .send(buildHtml({
          title,
          description,
          url:          canonicalUrl,
          image:        data.photo_url || FALLBACK_IMAGE,
          canonicalUrl,
        }));
    }

    // Unknown type
    throw new Error("Unknown type");

  } catch (err) {
    console.error("OG handler error:", err.message);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buildHtml(defaultMeta));
  }
};
