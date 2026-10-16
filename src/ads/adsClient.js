/**
 * Browser-side calls for the advertising portal/admin. Uses ONLY the
 * public anon Supabase client (RLS + SECURITY DEFINER RPCs enforce every
 * rule) and same-origin /api/ads endpoints with the user's own access
 * token. No secret of any kind is referenced here.
 */
import { supabase } from "../supabaseClient";
import { extensionForMime } from "./validation.js";

export const CREATIVE_BUCKET = "ad-creatives-private";

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  const t = data?.session?.access_token;
  if (!t) throw new Error("Please sign in again.");
  return t;
}

async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(`/api/ads/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error([j.error, j.message].filter(Boolean).join(": ") || `HTTP ${r.status}`);
  }
  return r;
}

export const getFlags = () => rpc("ad_public_flags").catch(() => ({ portal: false, checkout: false, delivery: false }));

export async function getMyAdvertiser(userId) {
  const { data, error } = await supabase.from("ad_advertisers").select("id, display_name, contact_email, status").eq("owner_user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createAdvertiser(displayName, contactEmail) {
  const { data, error } = await supabase.from("ad_advertisers").insert({ display_name: displayName, contact_email: contactEmail })
    .select("id, display_name, contact_email, status").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listProducts() {
  const { data, error } = await supabase.from("ad_products")
    .select("id, code, name, description, price_per_day_pence, min_days, max_days, currency, is_test, active, ad_product_units(ad_inventory_units(code, name, desktop_width, desktop_height, mobile_width, mobile_height, max_bytes))")
    .order("code");
  if (error) throw new Error(error.message);
  return data || [];
}

/** Quote incl. the optional priority review (ad_quote 4-arg: fee, exact deadline if ready now, terms version). */
export const quote = (productId, start, end, priority = false) => rpc("ad_quote", { p_product_id: productId, p_start: start, p_end: end, p_priority: Boolean(priority) });
/** Server-derived earliest STANDARD start date (review window); see ads_internal.earliest_standard_start. */
export const getEarliestStart = () => rpc("ad_earliest_start");
export const createHold = (productId, start, end, priority = false) => rpc("ad_create_hold", { p_product_id: productId, p_start: start, p_end: end, p_priority: Boolean(priority) });
/** Review deadlines + correction requests for one booking (owner or admin; internal cause only for admin). */
export const reviewSla = (bookingId) => rpc("ad_review_sla", { p_booking_id: bookingId });
export async function listConfirmations(bookingIds) {
  if (!bookingIds.length) return {};
  const { data, error } = await supabase.from("ad_booking_confirmations")
    .select("booking_id, confirmed_at, total_pence, placement_pence, priority_fee_pence, priority_review, currency, terms_version, review_rule, booked_from, booked_until")
    .in("booking_id", bookingIds);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((c) => [c.booking_id, c]));
}
export const cancelHold = (bookingId) => rpc("ad_cancel_hold", { p_booking_id: bookingId });

const BOOKING_SELECT = `id, advertiser_id, start_date, end_date, serve_from, serve_until, amended_at, status, status_reason, hold_expires_at, is_test, created_at, confirmed_at,
  ad_purchase_snapshots(product_name, unit_codes, billable_days, price_per_day_pence, total_pence, currency, is_test),
  ad_payments(status, amount_pence, currency, requires_refund, created_at, paid_at),
  ad_campaigns(id, review_status, current_version_id, approved_version_id, paused,
    ad_creative_versions!ad_creative_versions_campaign_id_fkey(id, version_no, status, destination_url, alt_text, submitted_at,
      review_clock_started_at, review_due_before, reviewed_at, rejection_reason, desktop_object_path, mobile_object_path))`;

export async function listBookings() {
  const { data, error } = await supabase.from("ad_bookings").select(BOOKING_SELECT).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function readImageSize(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("Not a readable image")); img.src = url; });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadCreative(file, advertiserId, campaignId, side) {
  const ext = extensionForMime(file.type);
  if (!ext) throw new Error("Unsupported image type");
  const path = `${advertiserId}/${campaignId}/${crypto.randomUUID()}-${side}.${ext}`;
  const { error } = await supabase.storage.from(CREATIVE_BUCKET).upload(path, file, { upsert: false, contentType: file.type, cacheControl: "60" });
  if (error) throw new Error(error.message);
  return path;
}

export async function previewUrl(path) {
  const { data, error } = await supabase.storage.from(CREATIVE_BUCKET).createSignedUrl(path, 300);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function submitCreative(payload) {
  const r = await api("submit-creative", { method: "POST", body: payload });
  return r.json();
}

/** Starts Stripe TEST Checkout. The return to this site is NOT proof of payment. */
export async function startCheckout(bookingId) {
  const r = await api("checkout", { method: "POST", body: { booking_id: bookingId } });
  const { url } = await r.json();
  if (typeof url !== "string" || !url.startsWith("https://checkout.stripe.com/")) throw new Error("Unexpected checkout URL");
  window.location.assign(url);
}

export async function downloadReport(bookingId, from, to, format) {
  const qs = new URLSearchParams({ booking_id: bookingId, format });
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const r = await api(`report?${qs}`);
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `msm-ad-report-${bookingId}.${format}`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ── Admin ────────────────────────────────────────────────────────────
export async function adminListSettings() {
  const { data, error } = await supabase.from("ad_settings").select("key, bool_value, int_value, description, updated_at").order("key");
  if (error) throw new Error(error.message);
  return data || [];
}
export const adminSetSetting = (key, bool, int) => rpc("ad_admin_set_setting", { p_key: key, p_bool: bool ?? null, p_int: int ?? null });
export const adminReview = (versionId, decision, reason) => rpc("ad_admin_review", { p_version_id: versionId, p_decision: decision, p_reason: reason || null });
export const adminSetPaused = (campaignId, paused, reason) => rpc("ad_admin_set_paused", { p_campaign_id: campaignId, p_paused: paused, p_reason: reason || null });
/** Removal only (no automatic refund). partyType: business | undetermined (consumer disabled server-side); initiatedBy: advertiser | msm. */
export const adminCancelBooking = (bookingId, reason, partyType, initiatedBy) =>
  rpc("ad_admin_cancel_booking", { p_booking_id: bookingId, p_reason: reason, p_party_type: partyType, p_initiated_by: initiatedBy });
export async function adminGetCancellationCase(bookingId) {
  const { data, error } = await supabase.from("ad_cancellation_cases").select("initiated_by, party_type, removed_at, reason").eq("booking_id", bookingId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
export const adminRequestCorrection = (versionId, cause, reasons) =>
  rpc("ad_admin_request_correction", { p_version_id: versionId, p_cause: cause, p_reasons: reasons });
/** Admin fallback when the mailer cannot report delivery (e.g. phoned/confirmed in account). */
export const adminRecordCorrectionNotice = (requestId, status, note) =>
  rpc("ad_admin_record_correction_notice", { p_request_id: requestId, p_status: status, p_note: note });
/** lost: [{ from, until, evidence }] ISO instants; the server recomputes and clips everything. */
export const adminProposeRefund = (bookingId, includePriorityFee, lost, note) =>
  rpc("ad_admin_propose_refund", { p_booking_id: bookingId, p_include_priority_fee: Boolean(includePriorityFee), p_lost: lost || [], p_note: note });
export const adminProposeCancellationRefund = (bookingId, deliveredPence, netLossPence, evidence, note) =>
  rpc("ad_admin_propose_cancellation_refund", { p_booking_id: bookingId, p_delivered_value_pence: deliveredPence, p_net_loss_pence: netLossPence, p_evidence: evidence, p_note: note });
export const adminDecideRefund = (assessmentId, decision, note) => rpc("ad_admin_decide_refund", { p_assessment_id: assessmentId, p_decision: decision, p_note: note });
/** Records what happened in Stripe AFTER a manual refund there. Never moves money. */
export const adminRecordRefundProcessing = (assessmentId, status, providerRefundId, idempotencyKey, note) =>
  rpc("ad_admin_record_refund_processing", { p_assessment_id: assessmentId, p_status: status, p_provider_refund_id: providerRefundId || null, p_idempotency_key: idempotencyKey, p_note: note || null });
export async function adminListRefunds() {
  const { data, error } = await supabase.from("ad_refund_assessments")
    .select("id, booking_id, kind, status, total_pence, gates, note, proposed_at, decided_at, decision_note, target_pay_by, ad_refund_lines(kind, pence, lost_seconds, purchased_seconds, details), ad_refund_processing_events(status, provider_refund_id, occurred_at, note)")
    .order("proposed_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
export const adminExpireHolds = () => rpc("ad_expire_stale_holds");

export async function adminListInventory() {
  const [{ data: units, error: e1 }, { data: products, error: e2 }] = await Promise.all([
    supabase.from("ad_inventory_units").select("id, code, name, rotation_capacity, active, is_test").order("code"),
    supabase.from("ad_products").select("id, code, name, price_per_day_pence, min_days, max_days, active, is_test").order("code"),
  ]);
  if (e1 || e2) throw new Error((e1 || e2).message);
  return { units: units || [], products: products || [] };
}
export async function adminSetActive(table, id, active) {
  if (!["ad_inventory_units", "ad_products"].includes(table)) throw new Error("bad table");
  const { error } = await supabase.from(table).update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function adminAdvertiserNames() {
  const { data } = await supabase.from("ad_advertisers").select("id, display_name");
  return Object.fromEntries((data || []).map((a) => [a.id, a.display_name]));
}

// ── Notification outbox (admin visibility; sending happens only in the server worker) ──
export async function adminListNotifications() {
  const { data, error } = await supabase.from("ad_notification_outbox")
    .select("id, kind, status, attempts, recipient_role, booking_id, created_at, accepted_at, delivered_at, failed_at, next_attempt_at, last_error")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data || [];
}
export const adminRetryNotification = (id, note) => rpc("ad_admin_retry_notification", { p_id: id, p_note: note });
export const adminCancelNotification = (id, note) => rpc("ad_admin_cancel_notification", { p_id: id, p_note: note });

// ── Booking amendments (owner accepts/rejects; admin proposes/withdraws) ──
export async function listAmendments(bookingIds) {
  if (!bookingIds.length) return {};
  const { data, error } = await supabase.from("ad_booking_amendments")
    .select("id, booking_id, reason, status, approved_at, original_from, original_until, proposed_from, proposed_until, purchased_seconds, preserves_duration, shortened_seconds, proposed_at, expires_at, decided_at")
    .in("booking_id", bookingIds).order("proposed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const out = {};
  for (const a of data || []) (out[a.booking_id] ||= []).push(a);
  return out;
}
export const respondAmendment = (amendmentId, decision) => rpc("ad_respond_amendment", { p_amendment_id: amendmentId, p_decision: decision });
export const adminProposeAmendment = (bookingId, note) => rpc("ad_admin_propose_amendment", { p_booking_id: bookingId, p_note: note });
export const adminWithdrawAmendment = (amendmentId, note) => rpc("ad_admin_withdraw_amendment", { p_amendment_id: amendmentId, p_note: note });
