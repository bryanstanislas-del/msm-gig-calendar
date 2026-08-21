function pluralGigs(count) {
  return `${count} new gig${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} awaiting moderation in the MSM Gig Calendar.`;
}

function row(label, value) {
  return value ? `<tr><td style="padding:8px 0;color:#888;width:140px;">${label}</td><td style="padding:8px 0;color:#fff;">${value}</td></tr>` : "";
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

  const { type, ...data } = req.body;

  let subject, html;

  if (type === "registration") {
    const { band_name, email, city, genre, website, instagram, facebook, spotify, bio, phone } = data;
    subject = `🎸 New Band Registration: ${band_name}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;border-radius:8px;">
        <div style="border-top:3px solid #e8203a;padding-top:20px;margin-bottom:24px;">
          <h1 style="font-size:28px;margin:0;color:#fff;">New Band Registration</h1>
          <p style="color:#e8203a;margin:4px 0 0;">Music Scene Magazine — Gig Calendar</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#888;width:140px;">Band Name</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${band_name}</td></tr>
          <tr style="background:rgba(232,32,58,0.1)"><td style="padding:8px 0;color:#888;">📧 Email</td><td style="padding:8px 0;color:#e8203a;font-weight:bold;">${email}</td></tr>
          ${row("City", city)}
          ${row("Genre", genre)}
          ${row("Phone", phone)}
          ${website  ? `<tr><td style="padding:8px 0;color:#888;">Website</td><td style="padding:8px 0;"><a href="${website}" style="color:#e8203a;">${website}</a></td></tr>` : ""}
          ${spotify  ? `<tr><td style="padding:8px 0;color:#888;">Spotify</td><td style="padding:8px 0;"><a href="${spotify}" style="color:#1DB954;">${spotify}</a></td></tr>` : ""}
          ${row("Instagram", instagram)}
          ${row("Facebook", facebook)}
          ${bio      ? `<tr><td style="padding:8px 0;color:#888;vertical-align:top;">Bio</td><td style="padding:8px 0;color:#fff;">${bio}</td></tr>` : ""}
        </table>
        <div style="margin-top:24px;padding:16px;background:rgba(232,32,58,0.1);border-radius:6px;">
          <p style="margin:0;color:#888;font-size:12px;">📋 Add to newsletter list:</p>
          <p style="margin:4px 0 0;color:#fff;font-size:16px;font-weight:bold;">${email}</p>
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
    const { created, venues = [], duplicatesSkipped = 0, otherExcluded = 0 } = data;
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
          <tr><td style="padding:8px 0;color:#888;">Artist / Band</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${band_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Venue</td><td style="padding:8px 0;color:#fff;">${venue}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">City</td><td style="padding:8px 0;color:#fff;">${city}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Date</td><td style="padding:8px 0;color:#fff;">${date}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Time</td><td style="padding:8px 0;color:#fff;">${time}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Genre</td><td style="padding:8px 0;color:#fff;">${genre || "–"}</td></tr>
          ${tickets ? `<tr><td style="padding:8px 0;color:#888;">Tickets</td><td style="padding:8px 0;"><a href="${tickets}" style="color:#e8203a;">${tickets}</a></td></tr>` : ""}
          ${notes   ? `<tr><td style="padding:8px 0;color:#888;">Notes</td><td style="padding:8px 0;color:#fff;">${notes}</td></tr>` : ""}
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
