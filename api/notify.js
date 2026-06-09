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
          ${city     ? `<tr><td style="padding:8px 0;color:#888;">City</td><td style="padding:8px 0;color:#fff;">${city}</td></tr>` : ""}
          ${genre    ? `<tr><td style="padding:8px 0;color:#888;">Genre</td><td style="padding:8px 0;color:#fff;">${genre}</td></tr>` : ""}
          ${phone    ? `<tr><td style="padding:8px 0;color:#888;">Phone</td><td style="padding:8px 0;color:#fff;">${phone}</td></tr>` : ""}
          ${website  ? `<tr><td style="padding:8px 0;color:#888;">Website</td><td style="padding:8px 0;"><a href="${website}" style="color:#e8203a;">${website}</a></td></tr>` : ""}
          ${spotify  ? `<tr><td style="padding:8px 0;color:#888;">Spotify</td><td style="padding:8px 0;"><a href="${spotify}" style="color:#1DB954;">${spotify}</a></td></tr>` : ""}
          ${instagram? `<tr><td style="padding:8px 0;color:#888;">Instagram</td><td style="padding:8px 0;color:#fff;">${instagram}</td></tr>` : ""}
          ${facebook ? `<tr><td style="padding:8px 0;color:#888;">Facebook</td><td style="padding:8px 0;color:#fff;">${facebook}</td></tr>` : ""}
          ${bio      ? `<tr><td style="padding:8px 0;color:#888;vertical-align:top;">Bio</td><td style="padding:8px 0;color:#fff;">${bio}</td></tr>` : ""}
        </table>
        <div style="margin-top:24px;padding:16px;background:rgba(232,32,58,0.1);border-radius:6px;">
          <p style="margin:0;color:#888;font-size:12px;">📋 Add to newsletter list:</p>
          <p style="margin:4px 0 0;color:#fff;font-size:16px;font-weight:bold;">${email}</p>
        </div>
        <div style="margin-top:24px;">
          <a href="https://msm-gig-calendar.vercel.app" style="background:#e8203a;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:bold;">
            VIEW BAND DIRECTORY →
          </a>
        </div>
      </div>
    `;
  } else {
    const { band_name, venue, city, date, time, genre, notes, tickets } = data;
    subject = `🎸 New Gig Submission: ${band_name}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;border-radius:8px;">
        <div style="border-top:3px solid #e8203a;padding-top:20px;margin-bottom:24px;">
          <h1 style="font-size:28px;margin:0;color:#fff;">New Gig Submission</h1>
          <p style="color:#e8203a;margin:4px 0 0;">Music Scene Magazine — Gig Calendar</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#888;width:120px;">Band</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${band_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Venue</td><td style="padding:8px 0;color:#fff;">${venue}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">City</td><td style="padding:8px 0;color:#fff;">${city}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Date</td><td style="padding:8px 0;color:#fff;">${date}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Time</td><td style="padding:8px 0;color:#fff;">${time}</td></tr>
          <tr><td style="padding:8px 0;color:#888;">Genre</td><td style="padding:8px 0;color:#fff;">${genre}</td></tr>
          ${tickets ? `<tr><td style="padding:8px 0;color:#888;">Tickets</td><td style="padding:8px 0;"><a href="${tickets}" style="color:#e8203a;">${tickets}</a></td></tr>` : ""}
          ${notes   ? `<tr><td style="padding:8px 0;color:#888;">Notes</td><td style="padding:8px 0;color:#fff;">${notes}</td></tr>` : ""}
        </table>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #333;">
          <a href="https://msm-gig-calendar.vercel.app" style="background:#e8203a;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:bold;">
            GO TO ADMIN PANEL →
          </a>
        </div>
      </div>
    `;
  }

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
    res.status(500).json({ error });
  }
}
