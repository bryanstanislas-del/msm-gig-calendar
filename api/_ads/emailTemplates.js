// Advertising email templates (server only). Every value comes from the
// outbox row's PERSISTED payload (copied from the database at enqueue time)
// and is HTML-escaped; links are built only from the configured base URL.
// Deadlines are shown in Europe/London with an explicit UTC offset.
import { formatLondonWithOffset } from "../../src/ads/ukWorkingTime.js";
import { formatPence } from "../../src/ads/adsPresentation.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const at = (x) => (x ? formatLondonWithOffset(x) : "not recorded");
const STRIP_CTRL = /[\u0000-\u001f\u007f]/g;
const oneLine = (s) => String(s ?? "").replace(STRIP_CTRL, " ").slice(0, 150);

function layout(title, paragraphs, link, linkLabel) {
  const body = paragraphs.map((p) => (Array.isArray(p)
    ? `<ul>${p.map((li) => `<li>${escapeHtml(li)}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(p)}</p>`)).join("\n");
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0d0d;color:#fff;padding:24px;border-radius:8px;">
<h1 style="font-size:20px;border-top:3px solid #e8203a;padding-top:16px;">${escapeHtml(title)}</h1>
${body}
<p><a href="${escapeHtml(link)}" style="color:#e8203a;">${escapeHtml(linkLabel)}</a></p>
<p style="color:#888;font-size:11px;">Music Scene Magazine advertising. Automated message.</p></div>`;
  const text = [title, "", ...paragraphs.map((p) => (Array.isArray(p) ? p.map((li) => `- ${li}`).join("\n") : p)), "", `${linkLabel}: ${link}`].join("\n");
  return { html, text };
}

const RENDERERS = {
  initial_priority_admin_alert(p, base) {
    const subject = oneLine(`Priority review due ${at(p.due_at)}`);
    return { subject, ...layout("Priority advert review started", [
      `Advertiser: ${p.advertiser}`, `Booking: ${p.booking_id}`, `Creative version: ${p.version_no}`,
      `Clock started: ${at(p.starts_at)}`,
      `First review decision due by: ${at(p.due_at)} (12 elapsed hours; approval, reasoned rejection or necessary correction request).`,
    ], `${base}/`, "Open the admin ADS tab") };
  },
  correction_request(p, base) {
    return { subject: oneLine(`Correction needed for your advert (version ${p.version_no})`), ...layout("MSM needs a correction to your advert", [
      `Hello ${p.advertiser},`,
      `MSM reviewed version ${p.version_no} of your advert and needs these corrections:`,
      (p.reasons || []).map(String),
      `Response time: ${p.response_rule}. The exact deadline is shown in your account and sent in a follow-up email once delivery of this notice is recorded.`,
      "No extra fee is charged for corrections.",
    ], `${base}/`, "Open your advertiser account") };
  },
  correction_deadline(p, base) {
    return { subject: oneLine(`Correction deadline: ${at(p.response_due_at)}`), ...layout("Your correction deadline", [
      `Hello ${p.advertiser},`,
      `Delivery of MSM's correction request for version ${p.version_no} was recorded at ${at(p.notice_delivered_at)}.`,
      `Please submit a corrected version by ${at(p.response_due_at)}.`,
      "Requested corrections:", (p.reasons || []).map(String),
    ], `${base}/`, "Open your advertiser account") };
  },
  review_outcome(p, base) {
    const approved = p.outcome === "approved";
    const lines = approved
      ? [`Version ${p.version_no} of your advert was approved at ${at(p.decided_at)}.`,
         p.booked_from ? `It runs from ${at(p.booked_from)} until ${at(p.booked_until)} (end not included), while the booking stays paid and active.` : ""]
      : [`Version ${p.version_no} of your advert was not approved (${at(p.decided_at)}).`, `Reason: ${p.reason || "see your account"}`];
    return { subject: oneLine(approved ? `Advert approved (version ${p.version_no})` : `Advert not approved (version ${p.version_no})`),
      ...layout(approved ? "Your advert was approved" : "Your advert was not approved", [`Hello ${p.advertiser},`, ...lines.filter(Boolean)], `${base}/`, "Open your advertiser account") };
  },
  booking_confirmation(p, base) {
    const parts = [`Placement ${formatPence(p.placement_pence, p.currency)}`];
    if (p.priority_review) parts.push(`priority review ${formatPence(p.priority_fee_pence, p.currency)}`);
    const draft = /^DRAFT/.test(p.terms_version || "");
    return { subject: oneLine(`Advertising order confirmed: ${formatPence(p.total_pence, p.currency)}`), ...layout("Advertising order confirmation", [
      `Hello ${p.advertiser},`,
      `Payment confirmed ${at(p.confirmed_at)}: ${parts.join(" + ")} = ${formatPence(p.total_pence, p.currency)}.`,
      `Booked: ${at(p.booked_from)} until ${at(p.booked_until)} (end not included). The advert only runs once MSM approves it.`,
      `Review: ${p.review_rule}.`,
      `Order terms version: ${p.terms_version || "not recorded"}${draft ? " (DRAFT - not final terms)" : ""}.`,
      `Reference: ${p.booking_id}`,
    ], `${base}/`, "Open your advertiser account") };
  },
};

const hours = (sec) => Math.round(Number(sec) / 360) / 10;
const runText = (from, until) => `${at(from)} until ${at(until)} (end not included)`;
function amendment(kind, title, subjectWord, lines) {
  RENDERERS[kind] = (p, base) => ({
    subject: oneLine(`Booking change ${subjectWord}: ${at(p.proposed_from)}`),
    ...layout(title, [`Hello ${p.advertiser},`, ...lines(p).filter(Boolean), `Reference: ${p.booking_id}`], `${base}/`, "Open your advertiser account"),
  });
}
// Amendment emails never change the amendment: only the owner's response in the
// account does. The offer expiry is the configured period from the proposal
// time and is not affected by when (or whether) this email is delivered.
amendment("amendment_proposed", "Proposed change to your booking", "proposed", (p) => [
  "Because approval came after your booked run had started, MSM proposes this change:",
  `New run: ${runText(p.proposed_from, p.proposed_until)}, ${hours((new Date(p.proposed_until) - new Date(p.proposed_from)) / 1000)} h.`,
  `Current run: ${runText(p.original_from, p.original_until)}.`,
  p.preserves_duration ? `Your purchased ${hours(p.purchased_seconds)} h are kept.`
    : `This is ${hours(p.shortened_seconds)} h shorter than your purchased ${hours(p.purchased_seconds)} h because another booking follows. Accepting does not waive any refund you may be owed.`,
  `Nothing changes unless you accept in your account by ${at(p.expires_at)}. Acceptance re-checks availability. This offer replaces any earlier offer for this booking.`,
]);
amendment("amendment_accepted", "Booking change accepted", "accepted", (p) => [
  `You accepted the change at ${at(p.decided_at)}. Your advert now runs ${runText(p.proposed_from, p.proposed_until)}.`,
  `Previously: ${runText(p.original_from, p.original_until)}.`,
]);
amendment("amendment_rejected", "Booking change declined", "declined", (p) => [
  `You declined the proposed change at ${at(p.decided_at)}. Your booking stays ${runText(p.original_from, p.original_until)}.`,
]);
amendment("amendment_withdrawn", "Booking change withdrawn", "withdrawn", (p) => [
  `MSM withdrew the proposed change (${runText(p.proposed_from, p.proposed_until)}) at ${at(p.decided_at)}. Your booking stays ${runText(p.original_from, p.original_until)}.`,
]);
amendment("amendment_expired", "Booking change offer expired", "expired", (p) => [
  `The offer to run ${runText(p.proposed_from, p.proposed_until)} expired at ${at(p.expires_at)} without acceptance. Your booking stays ${runText(p.original_from, p.original_until)}.`,
]);

/** { subject, html, text } for one claimed outbox row; throws for unknown kinds. */
export function renderNotification(row, baseUrl) {
  const r = RENDERERS[row?.kind];
  if (!r) throw new Error(`unknown notification kind: ${row?.kind}`);
  return r(row.payload || {}, String(baseUrl || "").replace(/\/+$/, ""));
}
export const NOTIFICATION_KINDS = Object.freeze(Object.keys(RENDERERS));
