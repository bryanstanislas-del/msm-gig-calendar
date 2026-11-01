// Regression coverage for a production issue: public gig-submission
// moderation emails were not arriving. Root cause (see the accompanying fix
// commit) is almost certainly at the Resend delivery layer -- the sandbox
// sender onboarding@resend.dev can only deliver to the Resend account's own
// verified email, not to an arbitrary recipient like
// submissions@musicscenemagazine.co.uk -- not a bug in this handler's own
// logic. These tests can't reach the real Resend API from a sandboxed test
// run, so they verify what IS verifiable here: this handler calls Resend
// exactly once per invocation (never more, regardless of a Gig Parse
// batch's size), uses the required subject/content, and surfaces a failed
// send loudly instead of silently swallowing it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./notify.js";
import { buildModerationNotificationPayload } from "../src/smartImport/importEngine.js";
import { DUPLICATE_STATES } from "../src/smartImport/reviewBatch.js";

const ALLOWED_ORIGIN = "https://calendar.musicscenemagazine.co.uk";

function fakeReq(body, { method = "POST", origin } = {}) {
  return { method, body, headers: origin ? { origin } : {} };
}
function fakeRes() {
  const res = { headers: {} };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  res.setHeader = vi.fn((name, value) => { res.headers[name] = value; });
  return res;
}

describe("api/notify.js", () => {
  let fetchMock;
  let consoleErrorSpy;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "email_123" }) }));
    globalThis.fetch = fetchMock;
    process.env.RESEND_API_KEY = "test-key";
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.MODERATION_NOTIFY_EMAIL;
  });

  it("rejects non-POST, non-OPTIONS requests without calling Resend", async () => {
    const res = fakeRes();
    await handler(fakeReq(undefined, { method: "GET" }), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("CORS", () => {
    it("an OPTIONS preflight from an allowed origin succeeds (204) instead of the previous bare 405, and carries the required CORS headers", async () => {
      const res = fakeRes();
      await handler(fakeReq(undefined, { method: "OPTIONS", origin: ALLOWED_ORIGIN }), res);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.headers["Access-Control-Allow-Origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["Access-Control-Allow-Methods"]).toContain("POST");
      expect(res.headers["Access-Control-Allow-Methods"]).toContain("OPTIONS");
      expect(res.headers["Access-Control-Allow-Headers"]).toContain("Content-Type");
    });

    it("a POST from an allowed origin still succeeds and carries the CORS header the browser needs to accept the response", async () => {
      const res = fakeRes();
      await handler(
        fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }, { origin: ALLOWED_ORIGIN }),
        res
      );

      expect(res.headers["Access-Control-Allow-Origin"]).toBe(ALLOWED_ORIGIN);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("a request from an origin not on the allow-list gets no Access-Control-Allow-Origin header at all", async () => {
      const res = fakeRes();
      await handler(
        fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }, { origin: "https://evil.example.com" }),
        res
      );

      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("a request with no Origin header (same-origin / non-browser caller) is unaffected -- no CORS headers, normal behaviour", async () => {
      const res = fakeRes();
      await handler(fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }), res);

      expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("an unsupported method from an allowed origin is still rejected with 405, even though CORS headers are present", async () => {
      const res = fakeRes();
      await handler(fakeReq(undefined, { method: "DELETE", origin: ALLOWED_ORIGIN }), res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("a public gig_submission sends exactly one Resend call, subject 'Calendar Moderation', PENDING content, and the submitter's contact", async () => {
    const res = fakeRes();
    await handler(
      fakeReq({
        type: "gig_submission",
        band_name: "Test Blues Band 2",
        venue: "The Wedgewood Rooms",
        city: "Portsmouth",
        date: "2026-12-08",
        time: "19:30",
        genre: "Blues",
        submitter_email: "band@example.com",
      }),
      res
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent.subject).toBe("Calendar Moderation");
    expect(sent.html).toContain("PENDING APPROVAL");
    expect(sent.html).toContain("awaiting moderation");
    expect(sent.html).toContain("Public Submission");
    expect(sent.html).toContain("Test Blues Band 2");
    expect(sent.html).toContain("band@example.com");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("a Gig Parse batch of 201 gigs still sends exactly one Resend call, not one per gig", async () => {
    const res = fakeRes();
    await handler(
      fakeReq({ type: "gig_import_batch", created: 201, venues: ["The Brook"], duplicatesSkipped: 4, otherExcluded: 1 }),
      res
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent.subject).toBe("Calendar Moderation");
    expect(sent.html).toContain("201 new gigs are awaiting moderation");
    expect(sent.html).toContain("Gig Parse Import");
    expect(sent.html).not.toContain("Public Submission");
  });

  it("a registration email is unaffected by the gig-moderation changes", async () => {
    const res = fakeRes();
    await handler(fakeReq({ type: "registration", band_name: "Test Band", email: "a@b.com" }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent.subject).toContain("New Band Registration");
    expect(sent.html).not.toContain("Calendar Moderation");
  });

  it("logs and responds 500 without throwing when Resend rejects the send", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain." }) });
    const res = fakeRes();

    await handler(fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedArgs = consoleErrorSpy.mock.calls.find((c) => c[0] === "notify: Resend send failed");
    expect(loggedArgs).toBeTruthy();
    expect(loggedArgs[1].hint).toMatch(/sender domain/i);
  });

  it("fails fast with a clear log when RESEND_API_KEY is missing, without calling fetch", async () => {
    delete process.env.RESEND_API_KEY;
    const res = fakeRes();

    await handler(fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }), res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "notify: RESEND_API_KEY is not configured -- cannot send",
      expect.objectContaining({ type: "gig_submission" })
    );
  });

  it("never throws even if the Resend request itself rejects (network failure)", async () => {
    fetchMock.mockRejectedValue(new Error("network drop"));
    const res = fakeRes();

    await expect(
      handler(fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }), res)
    ).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("defaults from/to to the historical literals when no override env vars are set", async () => {
    const res = fakeRes();
    await handler(fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }), res);
    const [, opts] = fetchMock.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent.from).toBe("MSM Gig Calendar <onboarding@resend.dev>");
    expect(sent.to).toBe("submissions@musicscenemagazine.co.uk");
  });

  it("honours RESEND_FROM_EMAIL / MODERATION_NOTIFY_EMAIL overrides when set (e.g. once a custom domain is verified with Resend)", async () => {
    // FROM_EMAIL/TO_EMAIL are read once at module load, like any serverless
    // cold-start config -- vi.resetModules() + a fresh dynamic import is
    // what lets this test observe a different env without affecting the
    // `handler` import every other test in this file uses.
    vi.resetModules();
    process.env.RESEND_FROM_EMAIL = "Custom Sender <noreply@musicscenemagazine.co.uk>";
    process.env.MODERATION_NOTIFY_EMAIL = "editor@musicscenemagazine.co.uk";
    const { default: freshHandler } = await import("./notify.js");
    const res = fakeRes();

    await freshHandler(fakeReq({ type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" }), res);

    const [, opts] = fetchMock.mock.calls[0];
    const sent = JSON.parse(opts.body);
    expect(sent.from).toBe("Custom Sender <noreply@musicscenemagazine.co.uk>");
    expect(sent.to).toBe("editor@musicscenemagazine.co.uk");
  });

  describe("input hardening", () => {
    const gig = { type: "gig_submission", band_name: "X", venue: "Y", city: "Z", date: "2026-01-01", time: "20:00" };
    const sentHtml = () => JSON.parse(fetchMock.mock.calls[0][1].body).html;
    async function call(body, opts) {
      const res = fakeRes();
      await handler(fakeReq(body, opts), res);
      return res;
    }
    function expectRejected(res, status = 400) {
      expect(res.status).toHaveBeenCalledWith(status);
      expect(fetchMock).not.toHaveBeenCalled();
    }

    it("escapes HTML in every rendered gig_submission field", async () => {
      const evil = '<img src=x onerror=alert(1)>"\'&';
      await call({ ...gig, band_name: evil, venue: evil, city: evil, date: evil, time: evil, genre: evil, notes: evil, submitter_email: evil });
      const html = sentHtml();
      expect(html).not.toContain("<img");
      expect(html).not.toContain('"\'&');
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;");
    });

    it("escapes HTML in every rendered registration field and strips control characters from the subject", async () => {
      const evil = "<script>x</script>";
      await call({ type: "registration", band_name: `${evil}\r\nBcc: a@b.c`, email: evil, city: evil, genre: evil, phone: evil, instagram: evil, facebook: evil, bio: evil, website: evil, spotify: evil });
      const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sent.html).not.toContain("<script>");
      expect(sent.html).toContain("&lt;script&gt;x&lt;/script&gt;");
      expect(sent.subject).not.toMatch(/[\r\n]/);
    });

    it("escapes Gig Parse venue names", async () => {
      await call({ type: "gig_import_batch", created: 2, venues: ["<b>Brook</b>", "A & B"] });
      const html = sentHtml();
      expect(html).toContain("&lt;b&gt;Brook&lt;/b&gt;, A &amp; B");
      expect(html).not.toContain("<b>Brook");
    });

    it("links valid http(s) URLs with an escaped href", async () => {
      await call({ ...gig, tickets: 'https://tickets.example/e?a=1&b="x"' });
      const html = sentHtml();
      expect(html).toContain('href="https://tickets.example/e?a=1&amp;b=%22x%22"');
    });

    it("keeps a scheme-less website as escaped text with no link", async () => {
      await call({ type: "registration", band_name: "B", email: "a@b.com", website: "www.band.example", spotify: "//evil.example" });
      const html = sentHtml();
      expect(html).toContain("www.band.example");
      expect(html).not.toContain('href="www.band.example"');
      expect(html).not.toContain('href="//evil.example"');
    });

    it.each([
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>", "vbscript:msgbox", "file:///etc/passwd", "https://",
    ])("rejects unsafe URL %j without sending", async (url) => {
      expectRejected(await call({ ...gig, tickets: url }));
      expectRejected(await call({ type: "registration", band_name: "B", email: "a@b.com", website: url }));
    });

    it.each([
      ["missing type", { band_name: "X", venue: "Y", city: "Z", date: "2026-01-01" }],
      ["unknown type", { ...gig, type: "newsletter_blast" }],
      ["prototype-key type", { ...gig, type: "constructor" }],
      ["non-string type", { ...gig, type: ["gig_submission"] }],
      ["array body", [gig]],
      ["string body", JSON.stringify(gig)],
      ["null body", null],
      ["non-string field", { ...gig, band_name: { toString: "x" } }],
      ["missing required field", { ...gig, venue: "" }],
      ["whitespace-only required field", { ...gig, city: "   " }],
      ["over-long field", { ...gig, band_name: "x".repeat(201) }],
      ["over-long notes", { ...gig, notes: "x".repeat(5001) }],
      ["registration without email", { type: "registration", band_name: "B" }],
      ["batch with zero created", { type: "gig_import_batch", created: 0 }],
      ["batch with fractional count", { type: "gig_import_batch", created: 1.5 }],
      ["batch with string count", { type: "gig_import_batch", created: "201" }],
      ["batch with huge count", { type: "gig_import_batch", created: 100001 }],
      ["batch with negative skipped", { type: "gig_import_batch", created: 1, duplicatesSkipped: -1 }],
      ["batch with non-array venues", { type: "gig_import_batch", created: 1, venues: "Brook" }],
      ["batch with non-string venue", { type: "gig_import_batch", created: 1, venues: [{}] }],
      ["batch with too many venues", { type: "gig_import_batch", created: 1, venues: Array.from({ length: 1001 }, (_, i) => `v${i}`) }],
    ])("rejects %s with 400 without sending", async (_label, body) => {
      const res = await call(body);
      expectRejected(res);
      expect(res.json).toHaveBeenCalledWith({ error: "invalid request" });
    });

    it("rejects a body over the size bound with 413, by declared Content-Length or by parsed size", async () => {
      const declared = fakeReq(gig);
      declared.headers["content-length"] = String(32 * 1024 + 1);
      const res1 = fakeRes();
      await handler(declared, res1);
      expectRejected(res1, 413);
      // No/understated Content-Length: the parsed body is measured too.
      const res2 = await call({ ...gig, padding: "x".repeat(33 * 1024) });
      expectRejected(res2, 413);
      expect(res2.json).toHaveBeenCalledWith({ error: "payload too large" });
    });

    it("rejects a malformed JSON body (Vercel's body getter throws) with 400", async () => {
      const req = { method: "POST", headers: {}, get body() { throw new Error("Invalid JSON"); } };
      const res = fakeRes();
      await handler(req, res);
      expectRejected(res);
    });

    it("ignores unknown extra fields the submit form spreads in, and never renders them", async () => {
      await call({ ...gig, venue_id: "abc", end_date: "", is_recurring: false, recurrence: "none", spotify: "<i>x</i>", extra: "<script>" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const html = sentHtml();
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<i>x</i>");
    });

    it("accepts the real SubmitGigForm payload shape (null submitter_email, TBC time)", async () => {
      const res = await call({ ...gig, time: "TBC", genre: "", tickets: "", notes: "", submitter_email: null, venue_id: null });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("real caller payloads still send", () => {
    const send = async (body) => { const res = fakeRes(); await handler(fakeReq(body, { origin: ALLOWED_ORIGIN }), res); return res; };
    const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body);

    it("SubmitGigForm: full form state spread + type + submitter_email (App.jsx SubmitGigForm.submit)", async () => {
      // Mirrors `empty` (App.jsx) merged with venueFields, then
      // { ...submission, type: "gig_submission", submitter_email }.
      const submission = {
        band_name: "The Test Band", venue_id: "3f0c9a8e-1111-4222-8333-944455556666", venue: "The Wedgewood Rooms", city: "Portsmouth",
        date: "2026-12-08", end_date: "", time: "Time TBC", genre: "", tickets: "https://www.wedgewood-rooms.co.uk/events/test",
        notes: "Doors 7pm. Support TBA & friends.", is_recurring: false, recurrence: "none", spotify: "",
      };
      const res = await send({ ...submission, type: "gig_submission", submitter_email: "band@example.com" });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { subject, html } = sent();
      expect(subject).toBe("Calendar Moderation");
      expect(html).toContain("The Test Band");
      expect(html).toContain("Time TBC");
      expect(html).toContain('href="https://www.wedgewood-rooms.co.uk/events/test"');
      expect(html).toContain("Support TBA &amp; friends.");
    });

    it("SubmitGigForm without a signed-in email (submitter_email: null) and a new venue (venue_id: null)", async () => {
      const res = await send({ band_name: "B", venue_id: null, venue: "New Place", city: "Leeds", date: "2026-11-01", end_date: "", time: "20:00", genre: "Rock", tickets: "", notes: "", is_recurring: false, recurrence: "none", spotify: "", type: "gig_submission", submitter_email: null });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("Gig Parse: { type: 'gig_import_batch', ...buildModerationNotificationPayload(...) } (App.jsx ConfirmationSummary)", async () => {
      const created = (venueName) => ({ outcome: "created", item: { fields: { venueName } } });
      const payload = buildModerationNotificationPayload({
        results: [created("The Brook"), created("The Brook"), created("Joiners"), { outcome: "failed", item: { fields: { venueName: "X" } } }],
        groups: [{ state: DUPLICATE_STATES[0], count: 3 }, { state: "excluded_manually", count: 2 }],
        blocked: [{ item: {}, reason: "no city" }],
      });
      expect(payload).toEqual({ created: 3, venues: ["The Brook", "Joiners"], duplicatesSkipped: 3, otherExcluded: 3 });
      const res = await send({ type: "gig_import_batch", ...payload });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { subject, html } = sent();
      expect(subject).toBe("Calendar Moderation");
      expect(html).toContain("3 new gigs are awaiting moderation");
      expect(html).toContain("The Brook, Joiners");
      expect(html).toContain("Duplicates skipped");
    });

    it("Gig Parse payload with no venue names and a single gig", async () => {
      const payload = buildModerationNotificationPayload({ results: [{ outcome: "created", item: { fields: {} } }], groups: [], blocked: [] });
      const res = await send({ type: "gig_import_batch", ...payload });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(sent().html).toContain("1 new gig is awaiting moderation");
    });
  });
});
