// api/og.js — Server-rendered SEO/Open Graph metadata for crawlers,
// real SPA served directly to human visitors.
// Deployed as a Vercel serverless function, reached via vercel.json
// rewrites for /artist/:slug, /venue/:slug and /festival/:slug.
//
// IMPORTANT: this file's canonical URL for each type is the SAME path the
// request arrived on (e.g. /artist/:slug rewrites here, and this file's
// canonical for that band is also /artist/:slug). That means a
// meta-refresh redirect back to the canonical URL would create an
// infinite loop -- so, like api/gig.js, real human visitors are served
// the actual built index.html directly (no redirect at all), and only
// detected crawlers get the metadata-only HTML below (no refresh tag).
//
// Usage (via vercel.json rewrites):
//   /artist/:slug   -> /api/og?type=band&slug=:slug
//   /venue/:slug    -> /api/og?type=venue&slug=:slug
//   /festival/:slug -> /api/og?type=festival&slug=:slug

const { createClient } = require("@supabase/supabase-js");
const fs   = require("fs");
const path = require("path");

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      || "https://fmlaaiolqwknowhtdeue.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const BASE_URL          = process.env.VITE_BASE_URL           || "https://calendar.musicscenemagazine.co.uk";
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

// Same crawler allow-list api/gig.js already uses -- kept identical on
// purpose so both files agree on what counts as a crawler.
function isCrawler(ua) {
  return /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|Slackbot|TelegramBot|Discordbot|Pinterest|Googlebot|bingbot/i.test(ua || "");
}

// JSON.stringify handles all escaping of the data itself; the extra
// </script> -> \u003c/script> style escape here guards specifically
// against a data value prematurely closing the surrounding <script> tag
// once this is embedded in an HTML string (an HTML-parsing hazard, not a
// JSON one -- JSON.stringify alone doesn't protect against it).
function jsonLdScriptTag(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// Crawler-facing HTML only -- deliberately NO <meta http-equiv="refresh">
// here (unlike the old version of this file). A refresh back to the
// canonical URL would loop, since the canonical URL for band/venue/
// festival is the exact path this handler is reached from.
function buildHtml({ title, description, url, image, jsonLd }) {
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

  <link rel="canonical" href="${escapeHtml(url)}">
  ${jsonLd || ""}
</head>
<body>
  <p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>
</body>
</html>`;
}

// Serves the real built SPA shell directly -- no redirect at all, so
// React Router renders the correct page client-side from the URL already
// in the browser. Identical technique to api/gig.js's human path.
function serveSpaShell(res, fallbackCanonicalUrl) {
  try {
    const indexPath = path.join(process.cwd(), "dist", "index.html");
    const html = fs.readFileSync(indexPath, "utf8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    // If the built file can't be found for any reason, a plain redirect
    // is still safe here -- it's a genuine fallback path, not the normal
    // route, so no loop risk in practice.
    res.setHeader("Location", fallbackCanonicalUrl);
    return res.status(302).end();
  }
}

module.exports = async function handler(req, res) {
  const { type, slug } = req.query || {};
  const ua = req.headers["user-agent"] || "";

  const canonicalFallback = (!type || !slug)
    ? BASE_URL
    : `${BASE_URL}/${ type === "band" ? "artist" : type }/${slug}`;

  // Real human visitor: serve the actual SPA directly, every type,
  // including when type/slug are missing -- no redirect needed or issued.
  if (!isCrawler(ua)) {
    return serveSpaShell(res, canonicalFallback);
  }

  // From here on: a detected crawler only.
  const defaultMeta = {
    title:       "Music Scene Magazine — Gig Calendar",
    description: "Find live music events across the South Coast UK. Discover gigs, bands and venues.",
    url:         BASE_URL,
    image:       FALLBACK_IMAGE,
  };

  if (!slug || !type) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).send(buildHtml(defaultMeta));
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ── GIG (kept for completeness / direct query-string use; /gig/:slug
    //    itself continues to be routed to api/gig.js, unchanged) ──
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
      const image = data.poster_url || FALLBACK_IMAGE;

      const jsonLdData = {
        "@context": "https://schema.org",
        "@type": "MusicEvent",
        name: `${data.band_name} at ${data.venue}`,
        startDate: (data.time && /^\d{2}:\d{2}$/.test(data.time)) ? `${data.date}T${data.time}:00` : data.date,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        url: canonicalUrl,
        location: {
          "@type": "MusicVenue",
          name: data.venue,
          ...(data.city ? { address: { "@type": "PostalAddress", addressLocality: data.city } } : {}),
        },
        performer: { "@type": "MusicGroup", name: data.band_name },
      };
      if (data.notes) jsonLdData.description = data.notes;
      if (data.poster_url) jsonLdData.image = data.poster_url;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
      return res.status(200).send(buildHtml({
        title, description, url: canonicalUrl, image, jsonLd: jsonLdScriptTag(jsonLdData),
      }));
    }

    // ── BAND / SOLO ARTIST ──
    // Fixed: previously filtered on role = 'band', which is a different
    // column to profile_type and doesn't cover solo_artist profiles at
    // all. /artist/:slug must serve both.
    if (type === "band") {
      const { data, error } = await supabase
        .from("profiles")
        .select("band_name, city, bio, photo_url, band_slug, profile_type, primary_genre, genre, website, facebook, instagram, twitter, tiktok_url")
        .eq("band_slug", slug)
        .in("profile_type", ["band", "solo_artist"])
        .single();

      if (error || !data) throw new Error("Artist not found");

      const canonicalUrl = `${BASE_URL}/artist/${data.band_slug}`;
      const title        = `${data.band_name} | Music Scene Magazine`;
      const description  = data.bio
        ? data.bio.slice(0, 200) + (data.bio.length > 200 ? "…" : "")
        : `${data.band_name}${data.city ? ` from ${data.city}` : ""}. Find upcoming gigs and more on Music Scene Magazine.`;
      const image = data.photo_url || FALLBACK_IMAGE;

      // Person for a genuine solo artist, MusicGroup otherwise -- never
      // decided by the old `role` column.
      const sameAs = [data.website, data.facebook, data.instagram, data.twitter, data.tiktok_url].filter(Boolean);
      const jsonLdData = {
        "@context": "https://schema.org",
        "@type": data.profile_type === "solo_artist" ? "Person" : "MusicGroup",
        name: data.band_name,
        url: canonicalUrl,
      };
      if (data.bio) jsonLdData.description = data.bio;
      if (data.photo_url) jsonLdData.image = data.photo_url;
      const genre = data.primary_genre || data.genre;
      if (genre) jsonLdData.genre = genre;
      if (sameAs.length) jsonLdData.sameAs = sameAs;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
      return res.status(200).send(buildHtml({
        title, description, url: canonicalUrl, image, jsonLd: jsonLdScriptTag(jsonLdData),
      }));
    }

    // ── VENUE ──
    if (type === "venue") {
      const { data, error } = await supabase
        .from("venues")
        .select("name, city, description, photo_url, slug, address, postcode, website, facebook, instagram, twitter")
        .eq("slug", slug)
        .single();

      if (error || !data) throw new Error("Venue not found");

      const canonicalUrl = `${BASE_URL}/venue/${data.slug}`;
      const title        = `${data.name}, ${data.city} | Music Scene Magazine`;
      const description  = data.description
        ? data.description.slice(0, 200)
        : `${data.name} in ${data.city}. See upcoming gigs and events on Music Scene Magazine.`;
      const image = data.photo_url || FALLBACK_IMAGE;

      // MusicVenue is a genuine, current schema.org type (Thing > Place >
      // CivicStructure > MusicVenue), verified before use.
      const sameAs = [data.website, data.facebook, data.instagram, data.twitter].filter(Boolean);
      const jsonLdData = {
        "@context": "https://schema.org",
        "@type": "MusicVenue",
        name: data.name,
        url: canonicalUrl,
      };
      if (data.description) jsonLdData.description = data.description;
      if (data.photo_url) jsonLdData.image = data.photo_url;
      // Address built only from fields that actually exist -- never
      // invented (e.g. no country is stored anywhere, so none is added).
      if (data.address || data.city || data.postcode) {
        jsonLdData.address = {
          "@type": "PostalAddress",
          ...(data.address  ? { streetAddress:   data.address }  : {}),
          ...(data.city     ? { addressLocality: data.city }     : {}),
          ...(data.postcode ? { postalCode:      data.postcode } : {}),
        };
      }
      if (sameAs.length) jsonLdData.sameAs = sameAs;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
      return res.status(200).send(buildHtml({
        title, description, url: canonicalUrl, image, jsonLd: jsonLdScriptTag(jsonLdData),
      }));
    }

    // ── FESTIVAL ──
    if (type === "festival") {
      const { data, error } = await supabase
        .from("profiles")
        .select("band_name, city, postcode, bio, photo_url, band_slug, festival_start_date, festival_end_date, website, facebook, instagram, twitter, tiktok_url")
        .eq("band_slug", slug)
        .eq("profile_type", "festival")
        .single();

      if (error || !data) throw new Error("Festival not found");

      const canonicalUrl = `${BASE_URL}/festival/${data.band_slug}`;
      const dateRange = data.festival_start_date
        ? (data.festival_end_date && data.festival_end_date !== data.festival_start_date
            ? `${fmtDate(data.festival_start_date)} \u2013 ${fmtDate(data.festival_end_date)}`
            : fmtDate(data.festival_start_date))
        : "";
      const locationBits = [data.city, data.postcode].filter(Boolean).join(", ");
      const title = dateRange
        ? `${data.band_name} | ${dateRange} | Music Scene Magazine`
        : `${data.band_name} | Music Scene Magazine`;
      const description = data.bio
        ? data.bio.slice(0, 200) + (data.bio.length > 200 ? "…" : "")
        : `${data.band_name}${dateRange ? `, ${dateRange}` : ""}${locationBits ? ` at ${locationBits}` : ""}. Find festival details and line-up on Music Scene Magazine.`;
      const image = data.photo_url || FALLBACK_IMAGE;

      // Festival is a genuine, current schema.org type (subtype of
      // Event), verified before use -- not assumed.
      const sameAs = [data.website, data.facebook, data.instagram, data.twitter, data.tiktok_url].filter(Boolean);
      const jsonLdData = {
        "@context": "https://schema.org",
        "@type": "Festival",
        name: data.band_name,
        url: canonicalUrl,
      };
      if (data.festival_start_date) jsonLdData.startDate = data.festival_start_date;
      if (data.festival_end_date)   jsonLdData.endDate   = data.festival_end_date;
      if (data.bio) jsonLdData.description = data.bio;
      if (data.photo_url) jsonLdData.image = data.photo_url;
      if (data.city || data.postcode) {
        jsonLdData.location = {
          "@type": "Place",
          name: data.band_name,
          address: {
            "@type": "PostalAddress",
            ...(data.city     ? { addressLocality: data.city }     : {}),
            ...(data.postcode ? { postalCode:      data.postcode } : {}),
          },
        };
      }
      if (sameAs.length) jsonLdData.sameAs = sameAs;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
      return res.status(200).send(buildHtml({
        title, description, url: canonicalUrl, image, jsonLd: jsonLdScriptTag(jsonLdData),
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
