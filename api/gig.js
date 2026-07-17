// api/gig.js
// Handles /gig/:slug
// - Facebook/Twitter crawlers get server-rendered OG HTML (+ JSON-LD)
// - Real users get the SPA directly

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL   = process.env.SUPABASE_URL   || "https://fmlaaiolqwknowhtdeue.supabase.co";
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY || "";
const BASE_URL       = process.env.VITE_BASE_URL || "https://calendar.musicscenemagazine.co.uk";
const FALLBACK_IMAGE = "https://musicscenemagazine.co.uk/wp-content/uploads/2026/06/msm-share.jpg";

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

function fmtDate(s) {
  if (!s) return "";
  const [y,m,d] = s.split("-");
  return `${parseInt(d)} ${MONTHS[parseInt(m)-1]} ${y}`;
}

function esc(s) {
  return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function isCrawler(ua) {
  return /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|Slackbot|TelegramBot|Discordbot|Pinterest|Googlebot|bingbot/i.test(ua||"");
}

// Only true HH:MM values become a real ISO datetime -- anything else
// (blank, free text) falls back to a date-only ISO value rather than
// fabricating a time. No timezone is stored anywhere in the database for
// gigs, so none is invented here either.
function toIsoDateTime(date, time) {
  if (date && time && /^\d{2}:\d{2}$/.test(time)) return `${date}T${time}:00`;
  return date || undefined;
}

// JSON.stringify handles all escaping of the data itself; the extra
// </script> -> \u003c/script> style escape here guards specifically
// against a data value prematurely closing the surrounding <script> tag
// once this is embedded in an HTML string (JSON.stringify alone does not
// protect against that, since it's an HTML-parsing hazard, not a JSON one).
function jsonLdScriptTag(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

function buildHtml(title, desc, url, image, jsonLd) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta property="og:type"        content="website">
<meta property="og:site_name"   content="Music Scene Magazine">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url"         content="${esc(url)}">
<meta property="og:image"       content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image"       content="${esc(image)}">
<link rel="canonical" href="${esc(url)}">
${jsonLd || ""}
</head>
<body><p><a href="${esc(url)}">${esc(title)}</a></p></body>
</html>`;
}

module.exports = async function(req, res) {
  // Extract slug from URL path e.g. /gig/my-band-venue-2026-01-01
  const slug = req.url.replace(/^\/gig\//, "").split("?")[0];
  const ua   = req.headers["user-agent"] || "";
  const canonicalUrl = `${BASE_URL}/gig/${slug}`;

  // Real user — send the SPA index.html
  if (!isCrawler(ua)) {
    // Read and return index.html
    const fs   = require("fs");
    const path = require("path");
    const indexPath = path.join(process.cwd(), "dist", "index.html");
    try {
      const html = fs.readFileSync(indexPath, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch(e) {
      // fallback redirect
      res.setHeader("Location", canonicalUrl);
      return res.status(302).end();
    }
  }

  // Bot/crawler — fetch gig from Supabase and return OG HTML + JSON-LD
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
    const { data, error } = await supabase
      .from("gigs")
      .select("band_name,venue,city,date,time,end_date,genre,notes,description,tickets,poster_url,slug,band_profile_id,venue_id")
      .eq("slug", slug)
      .eq("status", "approved")
      .single();

    if (error || !data) throw new Error("not found");

    const title = `${data.band_name} at ${data.venue}, ${data.city} | ${fmtDate(data.date)} | Music Scene Magazine`;
    const desc  = [
      `${data.band_name} live at ${data.venue}, ${data.city} on ${fmtDate(data.date)}.`,
      data.notes || "",
      "Find gig details and tickets on Music Scene Magazine.",
    ].filter(Boolean).join(" ");
    const image = data.poster_url || FALLBACK_IMAGE;

    // One small, proportionate extra lookup each, only when the gig
    // actually links to a profile/venue -- mirrors the exact pattern
    // GigDetailPage already uses client-side. Needed to build performer/
    // location "url" (Step 4 asks for these "where available"); omitted
    // entirely, not fabricated, when there's no linked profile/venue.
    const [artistRow, venueRow] = await Promise.all([
      data.band_profile_id
        ? supabase.from("profiles").select("band_slug").eq("id", data.band_profile_id).single().then(r => r.data).catch(() => null)
        : Promise.resolve(null),
      data.venue_id
        ? supabase.from("venues").select("slug").eq("id", data.venue_id).single().then(r => r.data).catch(() => null)
        : Promise.resolve(null),
    ]);

    // MusicGroup is schema.org's own recommendation for "a musical
    // group... can also be a solo musician" -- correct for performer
    // here regardless of band vs solo_artist, without needing an extra
    // lookup just to distinguish the two for this sub-object.
    const jsonLdData = {
      "@context": "https://schema.org",
      "@type": "MusicEvent",
      name: `${data.band_name} at ${data.venue}`,
      startDate: toIsoDateTime(data.date, data.time),
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      url: canonicalUrl,
      location: {
        "@type": "MusicVenue",
        name: data.venue,
        ...(venueRow ? { url: `${BASE_URL}/venue/${venueRow.slug}` } : {}),
        ...(data.city ? { address: { "@type": "PostalAddress", addressLocality: data.city } } : {}),
      },
      performer: {
        "@type": "MusicGroup",
        name: data.band_name,
        ...(artistRow ? { url: `${BASE_URL}/artist/${artistRow.band_slug}` } : {}),
      },
    };
    if (data.description || data.notes) jsonLdData.description = data.description || data.notes;
    if (data.end_date) {
      const endIso = toIsoDateTime(data.end_date, null);
      if (endIso) jsonLdData.endDate = endIso;
    }
    if (data.poster_url) jsonLdData.image = data.poster_url;
    if (data.tickets && /^https?:\/\//i.test(data.tickets)) {
      jsonLdData.offers = { "@type": "Offer", url: data.tickets };
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).send(buildHtml(title, desc, canonicalUrl, image, jsonLdScriptTag(jsonLdData)));

  } catch(e) {
    // Fallback OG (no JSON-LD -- nothing genuine to describe here)
    const title = "Music Scene Magazine — Gig Calendar";
    const desc  = "Find live music events across the South Coast UK.";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(buildHtml(title, desc, canonicalUrl, FALLBACK_IMAGE));
  }
};
