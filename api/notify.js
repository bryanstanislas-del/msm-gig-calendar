function pluralGigs(count) {
  return `${count} new gig${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} awaiting moderation in the MSM Gig Calendar.`;
}

function row(label, value) {
  return value ? `<tr><td style="padding:8px 0;color:#888;width:140px;">${label}</td><td style="padding:8px 0;color:#fff;">${value}</td></tr>` : "";
}

export default async function handler(req, res) {
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
    const { band_name, venue, city, date, time, genre, notes, tickets } = data;
    subject = "Calendar Moderation";
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;border-radius:8px;">
        <div style="border-top:3px solid #e8203a;padding-top:20px;margin-bottom:24px;">
          <h1 style="font-size:22px;margin:0;color:#fff;">A new gig submission is awaiting moderation in the MSM Gig Calendar.</h1>
          <p style="color:#e8203a;margin:4px 0 0;">Music Scene Magazine — Gig Calendar</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#888;width:140px;">Source</td><td style="padding:8px 0;color:#fff;font-weight:bold;">Public Submission</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Band</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${band_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Venue</td><td style="padding:8px 0;color:#fff;">${venue}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">City</td><td style="padding:8px 0;color:#fff;">${city}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Date</td><td style="padding:8px 0;color:#fff;">${date}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Time</td><td style="padding:8px 0;color:#fff;">${time}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Genre</td><td style="padding:8px 0;color:#fff;">${genre || "–"}</td></tr>
          ${tickets ? `<tr><td style="padding:8px 0;color:#888;">Tickets</td><td style="padding:8px 0;"><a href="${tickets}" style="color:#e8203a;">${tickets}</a></td></tr>` : ""}
          ${notes   ? `<tr><td style="padding:8px 0;color:#888;">Notes</td><td style="padding:8px 0;color:#fff;">${notes}</td></tr>` : ""}
        </table>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #333;">
          <a href="https://calendar.musicscenemagazine.co.uk" style="background:#e8203a;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:bold;">
            GO TO ADMIN PANEL →
          </a>
        </div>
      </div>
    `;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "MSM Gig Calendar <onboarding@resend.dev>",
        to: "submissions@musicscenemagazine.co.uk",
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
      // or rolls back the gig submission/import that triggered it.
      console.error("notify: Resend send failed", { type, status: response.status, error });
      res.status(500).json({ error });
    }
  } catch (err) {
    console.error("notify: Resend request threw", { type, error: err.message || String(err) });
    res.status(500).json({ error: err.message || String(err) });
  }
}
