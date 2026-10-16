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

export const quote = (productId, start, end) => rpc("ad_quote", { p_product_id: productId, p_start: start, p_end: end });
/** Server-derived earliest STANDARD start date (review window); see ads_internal.earliest_standard_start. */
export const getEarliestStart = () => rpc("ad_earliest_start");
export const createHold = (productId, start, end) => rpc("ad_create_hold", { p_product_id: productId, p_start: start, p_end: end });
export const cancelHold = (bookingId) => rpc("ad_cancel_hold", { p_booking_id: bookingId });

const BOOKING_SELECT = `id, advertiser_id, start_date, end_date, status, status_reason, hold_expires_at, is_test, created_at, confirmed_at,
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
export const adminCancelBooking = (bookingId, reason) => rpc("ad_admin_cancel_booking", { p_booking_id: bookingId, p_reason: reason });
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
