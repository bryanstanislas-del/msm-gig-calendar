// Minimal Resend adapter for advertising email (server only). Same provider
// endpoint and RESEND_API_KEY as api/notify.js, but NOT its public route,
// default sender or recipient: the ads sender is ADS_EMAIL_FROM (required,
// no default). Uses Resend's Idempotency-Key so a retried send of the same
// outbox row is accepted at most once by the provider. Acceptance is not
// delivery and not reading.
export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Classify a Resend HTTP failure: retryable (rate limit, server error, concurrent idempotent request) vs permanent. */
export function classifyResendFailure(status, body) {
  const name = String(body?.name || "");
  if (status === 429 || status >= 500 || name === "concurrent_idempotent_requests") return "retryable_error";
  return "permanent_error";
}

/** A hung provider call must not hold the batch (or its leases) indefinitely. */
export const RESEND_TIMEOUT_MS = 10000;

export async function sendViaResend({ apiKey, from, to, subject, html, text, idempotencyKey }, fetchImpl = globalThis.fetch, { timeoutMs = RESEND_TIMEOUT_MS } = {}) {
  // ONE deadline and ONE AbortController cover the request AND reading/parsing
  // the response body: a provider that sends headers and then stalls the body
  // cannot hold the worker either.
  const ctl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new Error(`timeout after ${timeoutMs} ms`)); }, timeoutMs); });
  const exchange = async () => {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: ctl.signal,
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { parsed = null; }        // malformed / rejected body
    return { res, parsed };
  };
  let r, body;
  try {
    ({ res: r, parsed: body } = await Promise.race([exchange(), timeout]));
  } catch (err) {
    // Outcome unknown (the provider may have accepted it): retried under the SAME
    // idempotency key only inside the dispatch window, else reconciliation.
    return { outcome: "retryable_error", error: `network: ${String(err?.message || err).slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
  if (r.ok && typeof body?.id === "string" && body.id.length >= 6) return { outcome: "accepted", id: body.id };
  if (r.ok) return { outcome: "retryable_error", error: "provider accepted without an id" };
  // Error text from the provider only (name/message) -- never request headers or the key.
  const msg = [body?.name, body?.message].filter(Boolean).join(": ").slice(0, 200);
  return { outcome: classifyResendFailure(r.status, body), error: `HTTP ${r.status}${msg ? ` ${msg}` : ""}` };
}
