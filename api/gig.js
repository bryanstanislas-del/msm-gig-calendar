// api/gig.js
// Handles /gig/:slug
// - Facebook/Twitter crawlers get server-rendered OG HTML
// - Real users get redirected to the SPA

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

function buildHtml(title, desc, url, image) {
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

  // Bot/crawler — fetch gig from Supabase and return OG HTML
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
    const { data, error } = await supabase
      .from("gigs")
      .select("band_name,venue,city,date,time,genre,notes,poster_url,slug")
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

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).send(buildHtml(title, desc, canonicalUrl, image));

  } catch(e) {
    // Fallback OG
    const title = "Music Scene Magazine — Gig Calendar";
    const desc  = "Find live music events across the South Coast UK.";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(buildHtml(title, desc, canonicalUrl, FALLBACK_IMAGE));
  }
};
