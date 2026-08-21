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

function fakeReq(body) {
  return { method: "POST", body };
}
function fakeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
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

  it("rejects non-POST requests without calling Resend", async () => {
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(fetchMock).not.toHaveBeenCalled();
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
});
