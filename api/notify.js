export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { band_name, venue, city, date, time, genre, notes, tickets } = req.body;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MSM Gig Calendar <onboarding@resend.dev>",
      to: "submissions@musicscenemagazine.co.uk",
      subject: `🎸 New Gig Submission: ${band_name}`,
      html: `
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
            ${notes ? `<tr><td style="padding:8px 0;color:#888;">Notes</td><td style="padding:8px 0;color:#fff;">${notes}</td></tr>` : ""}
          </table>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #333;">
            <a href="https://msm-gig-calendar.vercel.app" style="background:#e8203a;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;font-weight:bold;">
              GO TO ADMIN PANEL →
            </a>
          </div>
        </div>
      `,
    }),
  });

  if (response.ok) {
    res.status(200).json({ success: true });
  } else {
    const error = await response.json();
    res.status(500).json({ error });
  }
}
