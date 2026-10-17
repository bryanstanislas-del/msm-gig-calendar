// Advertising notification tests. The email provider (Resend) and Supabase
// are LABELLED MOCKS (MOCK_fetch / MOCK_supabase): no network call, no email
// is sent and no real key is used. They test rendering, escaping, signature
// checks and worker wiring only -- not that Resend delivers anything.
import { describe, it, expect, vi } from "vitest";
import { renderNotification, escapeHtml, NOTIFICATION_KINDS } from "./emailTemplates.js";
import { sendViaResend, classifyResendFailure, RESEND_ENDPOINT } from "./resendClient.js";
import { verifySvix, svixSign, SvixSignatureError } from "./svixSignature.js";
import { handlers } from "./handlers.js";
import { loadAdsConfig, missingConfig } from "./config.js";

const NOW = new Date("2026-10-27T10:10:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const WORKER = "LOCAL-FAKE-worker-secret-0123456789abcdef";
const HOOK = "whsec_" + Buffer.from("LOCAL-FAKE-svix-secret-0123456789").toString("base64");
const cfg = (over = {}) => ({
  apiEnabled: true, baseUrl: "https://calendar.example.test", supabaseUrl: "https://LOCAL-MOCK.supabase.invalid",
  anonKey: "MOCK_ANON", serviceKey: "MOCK_SERVICE_ROLE_never_returned", emailEnabled: true, workerSecret: WORKER,
  resendApiKey: "re_MOCK_never_returned", emailFrom: "MSM Ads <ads@example.test>", adminAlertEmail: "alerts@example.test",
  resendWebhookSecret: HOOK, ...over,
});
function res() {
  const r = { headers: {}, statusCode: null, payload: undefined };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((p) => { r.payload = p; return r; });
  r.end = vi.fn(() => r);
  r.setHeader = vi.fn((k, v) => { r.headers[k.toLowerCase()] = v; });
  return r;
}
const MOCK_fetch = (impl) => vi.fn(impl || (async () => ({ ok: true, status: 200, json: async () => ({ id: "re_msg_MOCK_1" }) })));

const correctionRow = {
  id: "o-1", kind: "correction_request", attempt: 1, recipient_role: "advertiser", recipient_email: "adv@example.test",
  idempotency_key: "msm-ads-notify-o-1",
  payload: { advertiser: 'ZZ <b>Co</b> & "Sons"', version_no: 2, reasons: ["Logo <script>alert(1)</script> cropped", "Link 404"],
             response_rule: "3 UK working hours (09:00-17:00 Mon-Fri, excluding England & Wales bank holidays) from delivery of this notice" },
};

describe("templates: escaped, persisted facts only, explicit offsets", () => {
  it("escapes every interpolated value", () => {
    const m = renderNotification(correctionRow, "https://calendar.example.test/");
    expect(m.html).not.toMatch(/<script>|<b>Co<\/b>/);
    expect(m.html).toContain("Logo &lt;script&gt;alert(1)&lt;/script&gt; cropped");
    expect(m.html).toContain("ZZ &lt;b&gt;Co&lt;/b&gt; &amp; &quot;Sons&quot;");
    expect(m.text).toContain("- Link 404");
    expect(m.subject).toBe("Correction needed for your advert (version 2)");
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });
  it("correction notice states the rule; the exact deadline follows once delivery is recorded", () => {
    const m = renderNotification(correctionRow, "https://x.test");
    expect(m.text).toMatch(/3 UK working hours .* from delivery of this notice/);
    expect(m.text).toMatch(/exact deadline is shown in your account/);
    const d = renderNotification({ kind: "correction_deadline", payload: { advertiser: "A", version_no: 2, reasons: ["Link 404"],
      notice_delivered_at: "2026-10-27T10:05:00Z", response_due_at: "2026-10-27T13:05:00Z" } }, "https://x.test");
    expect(d.text).toContain("by Tue 27 Oct 2026 13:05 GMT (UTC+00:00)");
    expect(d.subject).toBe("Correction deadline: Tue 27 Oct 2026 13:05 GMT (UTC+00:00)");
  });
  it("priority admin alert, outcomes and confirmation use the persisted values", () => {
    const a = renderNotification({ kind: "initial_priority_admin_alert", payload: { advertiser: "A", booking_id: "b-1", version_no: 1,
      starts_at: "2026-10-26T09:00:00Z", due_at: "2026-10-26T21:00:00Z" } }, "https://x.test");
    expect(a.subject).toBe("Priority review due Mon 26 Oct 2026 21:00 GMT (UTC+00:00)");
    const r = renderNotification({ kind: "review_outcome", payload: { advertiser: "A", version_no: 3, outcome: "rejected", reason: "Text <i>unreadable</i>", decided_at: "2026-10-27T12:00:00Z" } }, "https://x.test");
    expect(r.html).toContain("Text &lt;i&gt;unreadable&lt;/i&gt;");
    const c = renderNotification({ kind: "booking_confirmation", payload: { advertiser: "A", booking_id: "b-1", confirmed_at: "2026-10-26T09:00:00Z",
      total_pence: 17000, placement_pence: 2000, priority_fee_pence: 15000, priority_review: true, currency: "gbp",
      terms_version: "DRAFT-NOT-APPROVED-2026-10-16", review_rule: "Initial review within 12 elapsed hours",
      booked_from: "2026-11-15T00:00:00Z", booked_until: "2026-11-17T00:00:00Z" } }, "https://x.test");
    expect(c.text).toContain("Placement £20.00 + priority review £150.00 = £170.00");
    expect(c.text).toContain("Sun 15 Nov 2026 00:00 GMT (UTC+00:00) until Tue 17 Nov 2026 00:00 GMT (UTC+00:00) (end not included)");
    expect(c.text).toContain("(DRAFT - not final terms)");
  });
  it("subjects cannot carry header-injection characters; unknown kinds throw", () => {
    const m = renderNotification({ kind: "review_outcome", payload: { version_no: "1\r\nBcc: x@y", outcome: "approved" } }, "https://x.test");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(() => renderNotification({ kind: "nope", payload: {} }, "https://x.test")).toThrow();
    expect(NOTIFICATION_KINDS.slice(0, 5)).toEqual(["initial_priority_admin_alert", "correction_request", "correction_deadline", "review_outcome", "booking_confirmation"]);
  });
});

describe("Resend adapter (MOCK_fetch)", () => {
  it("sends one idempotent request and returns the provider id", async () => {
    const f = MOCK_fetch();
    const r = await sendViaResend({ apiKey: "re_MOCK", from: "f@example.test", to: "t@example.test", subject: "s", html: "<p>h</p>", text: "h", idempotencyKey: "msm-ads-notify-o-1" }, f);
    expect(r).toEqual({ outcome: "accepted", id: "re_msg_MOCK_1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.headers["Idempotency-Key"]).toBe("msm-ads-notify-o-1");
    expect(JSON.parse(init.body)).toEqual({ from: "f@example.test", to: ["t@example.test"], subject: "s", html: "<p>h</p>", text: "h" });
  });
  it("classifies failures and never echoes the key", async () => {
    expect(classifyResendFailure(429, {})).toBe("retryable_error");
    expect(classifyResendFailure(503, {})).toBe("retryable_error");
    expect(classifyResendFailure(409, { name: "concurrent_idempotent_requests" })).toBe("retryable_error");
    expect(classifyResendFailure(422, { name: "validation_error" })).toBe("permanent_error");
    const r = await sendViaResend({ apiKey: "re_SECRET_MOCK", from: "f", to: "t", subject: "s", html: "h", text: "h", idempotencyKey: "k-12345678" },
      MOCK_fetch(async () => ({ ok: false, status: 403, json: async () => ({ name: "validation_error", message: "domain not verified" }) })));
    expect(r).toEqual({ outcome: "permanent_error", error: "HTTP 403 validation_error: domain not verified" });
    const n = await sendViaResend({ apiKey: "re_SECRET_MOCK", from: "f", to: "t", subject: "s", html: "h", text: "h", idempotencyKey: "k-12345678" },
      MOCK_fetch(async () => { throw new Error("ECONNRESET"); }));
    expect(n.outcome).toBe("retryable_error");
    expect(JSON.stringify([r, n])).not.toContain("re_SECRET_MOCK");
  });
});

const signed = (body, { id = "msg_svix_0001", ts = NOW_S, secret = HOOK } = {}) => {
  const raw = Buffer.from(JSON.stringify(body));
  return { raw, headers: { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${svixSign(secret, id, String(ts), raw)}` } };
};

describe("Svix verification for Resend webhooks", () => {
  const ev = { type: "email.delivered", created_at: "2026-10-27T10:05:00Z", data: { email_id: "re_msg_MOCK_1" } };
  it("accepts a valid signature (also among several)", () => {
    const { raw, headers } = signed(ev);
    expect(verifySvix(raw, headers, HOOK, { nowSeconds: NOW_S }).event.type).toBe("email.delivered");
    expect(verifySvix(raw, { ...headers, "svix-signature": `v1,AAAA ${headers["svix-signature"]}` }, HOOK, { nowSeconds: NOW_S }).id).toBe("msg_svix_0001");
  });
  it("rejects tampering, wrong secret, stale or future timestamps, missing headers", () => {
    const { raw, headers } = signed(ev);
    expect(() => verifySvix(Buffer.from(raw.toString().replace("delivered", "bounced")), headers, HOOK, { nowSeconds: NOW_S })).toThrow(SvixSignatureError);
    expect(() => verifySvix(raw, headers, "whsec_" + Buffer.from("another-secret-0123456789").toString("base64"), { nowSeconds: NOW_S })).toThrow(SvixSignatureError);
    expect(() => verifySvix(raw, headers, HOOK, { nowSeconds: NOW_S + 301 })).toThrow(/tolerance/);
    expect(() => verifySvix(raw, headers, HOOK, { nowSeconds: NOW_S - 301 })).toThrow(/tolerance/);
    expect(() => verifySvix(raw, { ...headers, "svix-id": undefined }, HOOK, { nowSeconds: NOW_S })).toThrow(/missing/);
    expect(() => verifySvix(JSON.stringify(ev), headers, HOOK, { nowSeconds: NOW_S })).toThrow(/raw body/);
  });
});

describe("notify-worker handler (MOCK_supabase + MOCK_fetch)", () => {
  const MOCK_supabase = (rows, gate = "proceed") => {
    const calls = [];
    return { calls, byName: (n) => calls.filter((c) => c[0] === n), rpcAsService: vi.fn(async (fn, args) => {
      calls.push([fn, args]);
      if (fn === "ad_expire_amendments") return 0;
      if (fn === "ad_notify_claim") return rows;
      if (fn === "ad_notify_begin_dispatch") return gate;
      if (fn === "ad_notify_result") return args.p_outcome === "accepted" ? "accepted" : args.p_outcome === "retryable_error" ? "retry_scheduled" : "failed";
      return null;
    }) };
  };
  const call = async (over = {}, rows = [correctionRow], fetchImpl = MOCK_fetch(), headers = { authorization: `Bearer ${WORKER}` }, gate = "proceed", providerTimeoutMs) => {
    const sb = MOCK_supabase(rows, gate);
    const r = res();
    await handlers["notify-worker"]({ method: "POST", headers }, r, { cfg: cfg(over), supabase: sb, fetchImpl, now: () => NOW, ...(providerTimeoutMs ? { providerTimeoutMs } : {}) });
    return { r, sb, fetchImpl };
  };
  it("requires the worker secret (never browser-callable)", async () => {
    for (const headers of [{}, { authorization: "Bearer wrong-wrong-wrong-wrong-wrong-wrong-1" }, { authorization: `Basic ${WORKER}` }]) {
      const { r, sb, fetchImpl } = await call({}, [correctionRow], MOCK_fetch(), headers);
      expect(r.statusCode).toBe(401);
      expect(sb.rpcAsService).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    const { r } = await call({ workerSecret: "" });
    expect(r.statusCode).toBe(503);
    expect(r.payload.missing).toEqual(["ADS_WORKER_SECRET (>= 32 chars)"]);
  });
  it("disabled by default: ADS_EMAIL_ENABLED off -> no claim, no send", async () => {
    const { r, sb, fetchImpl } = await call({ emailEnabled: false });
    expect(r.statusCode).toBe(503);
    expect(r.payload.error).toBe("ADS_EMAIL_DISABLED");
    expect(sb.rpcAsService).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadAdsConfig({}).emailEnabled).toBe(false);
    expect(loadAdsConfig({}).emailFrom).toBe(""); // no default sender
    expect(missingConfig(loadAdsConfig({ ADS_WORKER_SECRET: WORKER }), ["email"])).toEqual(["RESEND_API_KEY", "ADS_EMAIL_FROM"]);
  });
  it("DB switch off -> claim returns nothing -> no provider call", async () => {
    const { r, fetchImpl } = await call({}, []);
    expect(r.payload).toEqual({ claimed: 0, accepted: 0, retry: 0, failed: 0, stale: 0, blocked: 0, expired_amendments: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("sends with the row's idempotency key and records the provider id", async () => {
    const { r, sb, fetchImpl } = await call();
    expect(fetchImpl.mock.calls[0][1].headers["Idempotency-Key"]).toBe("msm-ads-notify-o-1");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).to).toEqual(["adv@example.test"]);
    expect(sb.calls.map((c) => c[0])).toEqual(["ad_expire_amendments", "ad_notify_claim", "ad_notify_begin_dispatch", "ad_notify_result"]);
    expect(sb.byName("ad_notify_begin_dispatch")[0][1]).toMatchObject({ p_id: "o-1", p_attempt: 1, p_recipient: "adv@example.test" });
    expect(sb.byName("ad_notify_begin_dispatch")[0][1].p_content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sb.byName("ad_notify_result")[0][1]).toEqual({ p_id: "o-1", p_attempt: 1, p_outcome: "accepted", p_provider_message_id: "re_msg_MOCK_1", p_error: null });
    expect(r.payload.accepted).toBe(1);
    expect(JSON.stringify(r.payload)).not.toMatch(/MOCK_SERVICE|re_MOCK_never|LOCAL-FAKE/);
  });
  it("admin alerts go to ADS_ADMIN_ALERT_EMAIL; missing alert address is a visible permanent failure", async () => {
    const alert = { id: "o-2", kind: "initial_priority_admin_alert", attempt: 1, recipient_role: "admin", recipient_email: null, idempotency_key: "msm-ads-notify-o-2",
      payload: { advertiser: "A", booking_id: "b", version_no: 1, starts_at: "2026-10-26T09:00:00Z", due_at: "2026-10-26T21:00:00Z" } };
    const ok = await call({}, [alert]);
    expect(JSON.parse(ok.fetchImpl.mock.calls[0][1].body).to).toEqual(["alerts@example.test"]);
    const missing = await call({ adminAlertEmail: "" }, [alert]);
    expect(missing.fetchImpl).not.toHaveBeenCalled();
    expect(missing.sb.byName("ad_notify_result")[0][1]).toMatchObject({ p_outcome: "permanent_error", p_error: "ADS_ADMIN_ALERT_EMAIL not configured" });
    expect(missing.sb.byName("ad_notify_begin_dispatch")).toEqual([]);
  });
  it("provider errors are reported for retry/failure", async () => {
    const { sb, r } = await call({}, [correctionRow], MOCK_fetch(async () => ({ ok: false, status: 503, json: async () => ({ message: "down" }) })));
    expect(sb.byName("ad_notify_result")[0][1]).toMatchObject({ p_outcome: "retryable_error", p_error: "HTTP 503 down" });
    expect(r.payload.retry).toBe(1);
  });
});

describe("email-events handler (Resend webhook)", () => {
  const ev = { type: "email.delivered", created_at: "2026-10-27T10:05:00Z", data: { email_id: "re_msg_MOCK_1" } };
  const post = async (raw, headers, sbImpl) => {
    const sb = { rpcAsService: vi.fn(sbImpl || (async () => "delivered:response_window_started")) };
    const r = res();
    await handlers["email-events"]({ method: "POST", headers, rawBody: raw }, r, { cfg: cfg(), supabase: sb, now: () => NOW });
    return { r, sb };
  };
  it("verified event -> provider event RPC with svix id as idempotency key", async () => {
    const { raw, headers } = signed(ev);
    const { r, sb } = await post(raw, headers);
    expect(r.statusCode).toBe(200);
    expect(sb.rpcAsService).toHaveBeenCalledWith("ad_notify_provider_event", { p_provider_event_id: "msg_svix_0001", p_type: "email.delivered",
      p_message_id: "re_msg_MOCK_1", p_occurred_at: "2026-10-27T10:05:00Z", p_details: { provider: "resend" } });
  });
  it("unsigned/forged -> 400 and the DB is never touched", async () => {
    const { raw, headers } = signed(ev, { secret: "whsec_" + Buffer.from("forged-secret-0123456789").toString("base64") });
    const { r, sb } = await post(raw, headers);
    expect(r.statusCode).toBe(400);
    expect(sb.rpcAsService).not.toHaveBeenCalled();
  });
  it("event before the send result is recorded -> 503 so the provider retries", async () => {
    const { raw, headers } = signed(ev);
    const { r } = await post(raw, headers, async () => { throw new Error("ADS_RETRY_LATER: unknown provider message"); });
    expect(r.statusCode).toBe(503);
  });
  it("needs its own webhook secret", async () => {
    const r = res();
    await handlers["email-events"]({ method: "POST", headers: {}, rawBody: Buffer.from("{}") }, r, { cfg: cfg({ resendWebhookSecret: "" }), supabase: {}, now: () => NOW });
    expect(r.statusCode).toBe(503);
    expect(r.payload.missing).toEqual(["ADS_RESEND_WEBHOOK_SECRET (whsec_...)"]);
  });
});

describe("dispatch safety in the worker (MOCK_supabase + MOCK_fetch)", () => {
  const sbFor = (rows, gate) => {
    const calls = [];
    return { calls, rpcAsService: vi.fn(async (fn, args) => {
      calls.push([fn, args]);
      if (fn === "ad_notify_claim") return rows;
      if (fn === "ad_notify_begin_dispatch") return gate;
      if (fn === "ad_notify_result") return args.p_outcome === "retryable_error" ? "retry_scheduled" : "accepted";
      return 0;
    }) };
  };
  const run = async ({ gate = "proceed", fetchImpl = MOCK_fetch(), over = {}, timeout } = {}) => {
    const sb = sbFor([correctionRow], gate);
    const r = res();
    await handlers["notify-worker"]({ method: "POST", headers: { authorization: `Bearer ${WORKER}` } }, r,
      { cfg: cfg(over), supabase: sb, fetchImpl, now: () => NOW, ...(timeout ? { providerTimeoutMs: timeout } : {}) });
    return { sb, r, fetchImpl, hash: sb.calls.find((c) => c[0] === "ad_notify_begin_dispatch")?.[1].p_content_sha256 };
  };
  it("blocked (changed recipient/content or window elapsed) or stale -> no provider call, no result", async () => {
    for (const gate of ["blocked", "stale"]) {
      const { fetchImpl, sb, r } = await run({ gate });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(sb.calls.some((c) => c[0] === "ad_notify_result")).toBe(false);
      expect(r.payload[gate === "blocked" ? "blocked" : "stale"]).toBe(1);
    }
  });
  it("content hash covers sender and rendered content: a changed sender is detected", async () => {
    const a = await run(); const b = await run(); const c = await run({ over: { emailFrom: "Other <other@example.test>" } });
    expect(a.hash).toBe(b.hash);
    expect(c.hash).not.toBe(a.hash);
  });
  it("a hung provider call times out (bounded) and is reported as retryable, unknown outcome", async () => {
    const hung = vi.fn(() => new Promise(() => {}));
    const t0 = Date.now();
    const { sb } = await run({ fetchImpl: hung, timeout: 50 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(hung.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(hung.mock.calls[0][1].signal.aborted).toBe(true);
    expect(sb.calls.find((c) => c[0] === "ad_notify_result")[1]).toMatchObject({ p_outcome: "retryable_error", p_error: "network: timeout after 50 ms" });
  });
  it("lost acknowledgement: the retry reuses the same idempotency key from the claim", async () => {
    const f = MOCK_fetch();
    await run({ fetchImpl: f }); await run({ fetchImpl: f });
    expect(f.mock.calls.map((c) => c[1].headers["Idempotency-Key"])).toEqual(["msm-ads-notify-o-1", "msm-ads-notify-o-1"]);
  });
});

describe("amendment emails", () => {
  const p = { advertiser: "ZZ <b>Co</b>", booking_id: "b-1", original_from: "2026-11-02T00:00:00Z", original_until: "2026-11-04T00:00:00Z",
    proposed_from: "2026-11-02T11:00:00Z", proposed_until: "2026-11-04T00:00:00Z", purchased_seconds: 172800, preserves_duration: false,
    shortened_seconds: 39600, expires_at: "2026-11-03T10:30:00Z", decided_at: "2026-11-02T12:00:00Z" };
  it("proposal: exact intervals with offsets, shortfall, refund not waived, nothing changes without acceptance; escaped", () => {
    const m = renderNotification({ kind: "amendment_proposed", payload: p }, "https://x.test");
    expect(m.text).toContain("New run: Mon 2 Nov 2026 11:00 GMT (UTC+00:00) until Wed 4 Nov 2026 00:00 GMT (UTC+00:00) (end not included), 37 h.");
    expect(m.text).toContain("11 h shorter than your purchased 48 h");
    expect(m.text).toContain("Accepting does not waive any refund");
    expect(m.text).toContain("Nothing changes unless you accept in your account by Tue 3 Nov 2026 10:30 GMT (UTC+00:00)");
    expect(m.html).toContain("ZZ &lt;b&gt;Co&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Co</b>");
  });
  it("accepted / rejected / withdrawn / expired state the resulting run", () => {
    expect(renderNotification({ kind: "amendment_accepted", payload: p }, "https://x.test").text).toContain("now runs Mon 2 Nov 2026 11:00 GMT");
    for (const k of ["amendment_rejected", "amendment_withdrawn", "amendment_expired"]) {
      expect(renderNotification({ kind: k, payload: p }, "https://x.test").text).toContain("stays Mon 2 Nov 2026 00:00 GMT (UTC+00:00) until Wed 4 Nov 2026 00:00 GMT");
    }
  });
  it("every outbox kind allowed by the latest migration has a template", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync(new URL("../../supabase/migrations/20261017090000_ads_outbox_dispatch_amendment_notices.sql", import.meta.url), "utf8");
    const m = /ad_notification_outbox_kind_check\s+check \(kind in \(([^)]+)\)\)/.exec(sql);
    const kinds = m[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1));
    expect([...kinds].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});
