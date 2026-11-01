// ── Input hardening ─────────────────────────────────────────────────────
// This endpoint is public (the Submit Your Gig form and Gig Parse call it
// from the browser), so every request is untrusted: the body must be a
// plain JSON object of a known type, each field we use is type- and
// length-bounded, counts are bounded integers, and every value is
// HTML-escaped before it reaches the email. Unknown extra fields (the
// submit form spreads its whole state) are ignored, never rendered.
const MAX_BODY_BYTES = 32 * 1024;
const SHORT = 200, EMAIL_LEN = 254, URL_LEN = 2048, LONG = 5000;
const MAX_COUNT = 100000, MAX_VENUES = 1000;

const SCHEMAS = {
  registration: {
    required: ["band_name", "email"],
    text: { band_name: SHORT, email: EMAIL_LEN, city: SHORT, genre: SHORT, phone: SHORT, instagram: URL_LEN, facebook: URL_LEN, bio: LONG },
    urls: { website: URL_LEN, spotify: URL_LEN },
  },
  gig_submission: {
    required: ["band_name", "venue", "city", "date"],
    text: { band_name: SHORT, venue: SHORT, city: SHORT, date: 32, time: 32, genre: SHORT, notes: LONG, submitter_email: EMAIL_LEN },
    urls: { tickets: URL_LEN },
  },
  gig_import_batch: { required: [], text: {}, urls: {} },
};

class BadRequest extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A URL field is rendered as a link only if it is an absolute http(s) URL.
// Any other explicit scheme (javascript:, data:, vbscript:, file:, ...) --
// including ones disguised with embedded whitespace/control characters --
// rejects the request. Scheme-less text ("www.band.com", "//host") is kept
// as escaped plain text with no href, so a hand-typed website still shows.
function safeHttpUrl(value) {
  const compact = value.replace(/[\u0000-\u0020\u007f]/g, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(compact)) {
    let url;
    try { url = new URL(value.trim()); } catch { throw new BadRequest("invalid url"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequest("unsafe url");
    return url.href;
  }
  return null;
}

function boundedString(data, key, max) {
  const v = data[key];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new BadRequest(`${key} must be a string`);
  if (v.length > max) throw new BadRequest(`${key} too long`);
  return v.trim();
}

function boundedCount(data, key, { min = 0, fallback } = {}) {
  const v = data[key] === undefined ? fallback : data[key];
  if (!Number.isInteger(v) || v < min || v > MAX_COUNT) throw new BadRequest(`${key} must be an integer ${min}-${MAX_COUNT}`);
  return v;
}

// Vercel's req.body getter parses lazily and throws on malformed JSON, so it
// is read exactly once here. The declared Content-Length is checked first;
// the parsed value is measured too in case the header is absent (chunked)
// or wrong.
function readBody(req) {
  const declared = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BadRequest("payload too large", 413);
  let body;
  try { body = req.body; } catch { throw new BadRequest("malformed body"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("body must be a JSON object");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) throw new BadRequest("payload too large", 413);
  return body;
}

// Returns { type, fields } with every value validated; throws BadRequest.
export function parseNotifyRequest(req) {
  const body = readBody(req);
  const { type } = body;
  if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(SCHEMAS, type)) throw new BadRequest("unknown type");
  const schema = SCHEMAS[type];
  const fields = {};
  for (const [key, max] of Object.entries(schema.text)) fields[key] = boundedString(body, key, max);
  for (const [key, max] of Object.entries(schema.urls)) {
    const text = boundedString(body, key, max);
    fields[key] = text ? { text, href: safeHttpUrl(text) } : null;
  }
  for (const key of schema.required) if (!fields[key]) throw new BadRequest(`${key} is required`);
  if (type === "gig_import_batch") {
    fields.created = boundedCount(body, "created", { min: 1 });
    fields.duplicatesSkipped = boundedCount(body, "duplicatesSkipped", { fallback: 0 });
    fields.otherExcluded = boundedCount(body, "otherExcluded", { fallback: 0 });
    const venues = body.venues === undefined ? [] : body.venues;
    if (!Array.isArray(venues) || venues.length > MAX_VENUES) throw new BadRequest("venues must be an array");
    fields.venues = venues.map((v) => {
      if (typeof v !== "string" || v.length > SHORT) throw new BadRequest("venue names must be short strings");
      return v.trim();
    }).filter(Boolean);
  }
  return { type, fields };
}

// Subject is plain text (not HTML), but must never carry header-breaking
// control characters.
function plainSubject(text) {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

function link(url, color) {
  if (!url) return "";
  const label = escapeHtml(url.text);
  return url.href ? `<a href="${escapeHtml(url.href)}" style="color:${color};">${label}</a>` : label;
}

function pluralGigs(count) {
  return `${count} new gig${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} awaiting moderation in the MSM Gig Calendar.`;
}

function row(label, value) {
  return value ? `<tr><td style="padding:8px 0;color:#888;width:140px;">${escapeHtml(label)}</td><td style="padding:8px 0;color:#fff;">${escapeHtml(value)}</td></tr>` : "";
}

// Overridable via env so a Resend sender-domain/recipient fix (e.g.
// verifying a custom domain, or pointing at a different mailbox) is a
// config change, not a redeploy -- defaults are exactly the values this
// endpoint has always used, so behaviour is unchanged unless these are set.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "MSM Gig Calendar <onboarding@resend.dev>";
const TO_EMAIL = process.env.MODERATION_NOTIFY_EMAIL || "submissions@musicscenemagazine.co.uk";

// CORS, scoped to this endpoint only: it's called directly from the browser
// (SubmitGigForm, ConfirmationSummary in App.jsx), and the app is legitimately
// served from more than one origin (the custom domain, and the underlying
// Vercel deployment URL vercel.json redirects from). A cross-origin POST with
// a JSON body always triggers a browser preflight (OPTIONS) first -- this
// endpoint previously had no OPTIONS handling at all and fell straight into
// the "reject unsupported method" branch below, returning 405 to the
// preflight itself. A failed preflight means the browser never sends the
// real POST, which is exactly what Vercel's logs showed (OPTIONS 405, "No
// outgoing requests" -- Resend was never even contacted). No other route
// needs or gets CORS headers, and this never touches RESEND_API_KEY or moves
// sending client-side -- only which origins may call this one endpoint.
const ALLOWED_ORIGINS = new Set(
  ["https://calendar.musicscenemagazine.co.uk", "https://msm-gig-calendar.vercel.app", process.env.VITE_BASE_URL].filter(Boolean)
);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  let type, data;
  try {
    ({ type, fields: data } = parseNotifyRequest(req));
  } catch (err) {
    if (!(err instanceof BadRequest)) throw err;
    return res.status(err.status).json({ error: err.status === 413 ? "payload too large" : "invalid request" });
  }
  const esc = escapeHtml;

  let subject, html;

  if (type === "registration") {
    const { band_name, email, city, genre, website, instagram, facebook, spotify, bio, phone } = data;
    subject = plainSubject(`🎸 New Band Registration: ${band_name}`);
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;border-radius:8px;">
        <div style="border-top:3px solid #e8203a;padding-top:20px;margin-bottom:24px;">
          <h1 style="font-size:28px;margin:0;color:#fff;">New Band Registration</h1>
          <p style="color:#e8203a;margin:4px 0 0;">Music Scene Magazine — Gig Calendar</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#888;width:140px;">Band Name</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${esc(band_name)}</td></tr>
          <tr style="background:rgba(232,32,58,0.1)"><td style="padding:8px 0;color:#888;">📧 Email</td><td style="padding:8px 0;color:#e8203a;font-weight:bold;">${esc(email)}</td></tr>
          ${row("City", city)}
          ${row("Genre", genre)}
          ${row("Phone", phone)}
          ${website  ? `<tr><td style="padding:8px 0;color:#888;">Website</td><td style="padding:8px 0;color:#fff;">${link(website, "#e8203a")}</td></tr>` : ""}
          ${spotify  ? `<tr><td style="padding:8px 0;color:#888;">Spotify</td><td style="padding:8px 0;color:#fff;">${link(spotify, "#1DB954")}</td></tr>` : ""}
          ${row("Instagram", instagram)}
          ${row("Facebook", facebook)}
          ${bio      ? `<tr><td style="padding:8px 0;color:#888;vertical-align:top;">Bio</td><td style="padding:8px 0;color:#fff;">${esc(bio)}</td></tr>` : ""}
        </table>
        <div style="margin-top:24px;padding:16px;background:rgba(232,32,58,0.1);border-radius:6px;">
          <p style="margin:0;color:#888;font-size:12px;">📋 Add to newsletter list:</p>
          <p style="margin:4px 0 0;color:#fff;font-size:16px;font-weight:bold;">${esc(email)}</p>
        </div>
        <div style="margin-top:24px;">
          <a href="https://calendar.musicscenemagazine.co.uk" style="background:#e8203a;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:bold;">
            VIEW BAND DIRECTORY →
          </a>
        </div>
      </div>
    `;
  } else if (type === "gig_import_batch") {
    // Sent once per completed Gig Parse batch, never once per row --
    // ConfirmationSummary (App.jsx) is the sole caller, and only when at
    // least one row actually reached `pending` (see its `summary.created > 0`
    // gate) -- duplicates skipped, invalid/excluded rows and failed rows
    // never trigger this on their own.
    const { created, venues, duplicatesSkipped, otherExcluded } = data;
    subject = "Calendar Moderation";
    const venueList = venues.length ? venues.slice(0, 10).join(", ") + (venues.length > 10 ? `, and ${venues.length - 10} more` : "") : "";
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;border-radius:8px;">
        <div style="border-top:3px solid #e8203a;padding-top:20px;margin-bottom:24px;">
          <h1 style="font-size:22px;margin:0;color:#fff;">${pluralGigs(created)}</h1>
          <p style="color:#e8203a;margin:4px 0 0;">Music Scene Magazine — Gig Calendar</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#888;width:140px;">Source</td><td style="padding:8px 0;color:#fff;font-weight:bold;">Gig Parse Import</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Added to Pending</td><td style="padding:8px 0;color:#fff;">${created}</td></tr>
          ${row("Venue(s)", venueList)}
          ${duplicatesSkipped ? `<tr><td style="padding:8px 0;color:#888;">Duplicates skipped</td><td style="padding:8px 0;color:#fff;">${duplicatesSkipped}</td></tr>` : ""}
          ${otherExcluded ? `<tr><td style="padding:8px 0;color:#888;">Invalid/excluded rows</td><td style="padding:8px 0;color:#fff;">${otherExcluded}</td></tr>` : ""}
        </table>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #333;">
          <a href="https://calendar.musicscenemagazine.co.uk" style="background:#e8203a;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:bold;">
            GO TO ADMIN PANEL →
          </a>
        </div>
      </div>
    `;
  } else {
    // Public "Submit Your Gig" form -- the only other caller besides
    // gig_import_batch above, and only fires after the gig has actually been
    // written to gigs as `pending` (see SubmitGigForm.submit() in App.jsx).
    const { band_name, venue, city, date, time, genre, notes, tickets, submitter_email } = data;
    subject = "Calendar Moderation";
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;border-radius:8px;">
        <div style="border-top:3px solid #e8203a;padding-top:20px;margin-bottom:24px;">
          <span style="display:inline-block;background:#f4a261;color:#0d0d0d;font-weight:bold;font-size:11px;letter-spacing:1px;padding:3px 10px;border-radius:3px;margin-bottom:10px;">PENDING APPROVAL</span>
          <h1 style="font-size:22px;margin:0;color:#fff;">A new gig submission is awaiting moderation in the MSM Gig Calendar.</h1>
          <p style="color:#e8203a;margin:4px 0 0;">Music Scene Magazine — Gig Calendar</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#888;width:140px;">Source</td><td style="padding:8px 0;color:#fff;font-weight:bold;">Public Submission</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Artist / Band</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${esc(band_name)}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Venue</td><td style="padding:8px 0;color:#fff;">${esc(venue)}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">City</td><td style="padding:8px 0;color:#fff;">${esc(city)}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Date</td><td style="padding:8px 0;color:#fff;">${esc(date)}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Time</td><td style="padding:8px 0;color:#fff;">${esc(time)}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Genre</td><td style="padding:8px 0;color:#fff;">${esc(genre || "–")}</td></tr>
          ${tickets ? `<tr><td style="padding:8px 0;color:#888;">Tickets</td><td style="padding:8px 0;color:#fff;">${link(tickets, "#e8203a")}</td></tr>` : ""}
          ${notes   ? `<tr><td style="padding:8px 0;color:#888;">Notes</td><td style="padding:8px 0;color:#fff;">${esc(notes)}</td></tr>` : ""}
          ${row("Submitter contact", submitter_email)}
        </table>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #333;">
          <a href="https://calendar.musicscenemagazine.co.uk" style="background:#e8203a;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:bold;">
            GO TO ADMIN PANEL →
          </a>
          <p style="color:#888;font-size:11px;margin-top:10px;">Sign in and open the Moderation tab to review Pending gigs.</p>
        </div>
      </div>
    `;
  }

  // Fail fast and loud rather than letting a doomed fetch produce a vaguer
  // 401 further down -- a missing key is one of the two most likely reasons
  // moderation emails silently stop arriving (the other is FROM_EMAIL's
  // sender domain not being verified with the recipient below; see the
  // Resend-specific hint in the catch branch).
  if (!process.env.RESEND_API_KEY) {
    console.error("notify: RESEND_API_KEY is not configured -- cannot send", { type });
    return res.status(500).json({ error: "RESEND_API_KEY is not configured" });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: TO_EMAIL,
        subject,
        html,
      }),
    });

    if (response.ok) {
      res.status(200).json({ success: true });
    } else {
      const error = await response.json();
      // Visible in Vercel's function logs -- a failed send must never be
      // silent, even though (per the caller's own try/catch) it never blocks
      // or rolls back the gig submission/import that triggered it. Resend's
      // onboarding@resend.dev test sender can only deliver to the account's
      // own verified email -- if that's the actual cause, its error message
      // says so explicitly ("own email address" / "verify a domain"), which
      // is flagged here so it isn't confused with an auth/key problem.
      const message = typeof error?.message === "string" ? error.message : "";
      const looksLikeSenderDomainRestriction = /own email address|verify a domain/i.test(message);
      console.error("notify: Resend send failed", {
        type, status: response.status, from: FROM_EMAIL, to: TO_EMAIL, error,
        ...(looksLikeSenderDomainRestriction ? { hint: "FROM_EMAIL's sender domain is likely not verified with Resend for this recipient -- verify a domain and set RESEND_FROM_EMAIL, or send from that domain." } : {}),
      });
      res.status(500).json({ error });
    }
  } catch (err) {
    console.error("notify: Resend request threw", { type, error: err.message || String(err) });
    res.status(500).json({ error: err.message || String(err) });
  }
}
