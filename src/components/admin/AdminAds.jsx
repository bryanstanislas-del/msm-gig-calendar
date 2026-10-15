/**
 * AdminAds.jsx -- MSM shared advertising platform, phase 1 admin.
 *
 * Feature toggles, TEST inventory activation, the review queue
 * (approve/reject bound to one creative version), bookings with payment
 * flags, pause/cancel, and report downloads. Every action is an
 * is_admin_or_above()-checked RPC or RLS-protected write; this panel holds
 * no extra privilege. Refunds are NEVER issued from here: a "refund
 * required" flag tells MSM to refund in the Stripe dashboard (test mode in
 * phase 1); the charge.refunded webhook then records it.
 */
import { useCallback, useEffect, useState } from "react";
import * as ads from "../../ads/adsClient.js";
import { formatPence, friendlyAdsError } from "../../ads/adsPresentation.js";
import { formatDeadline, formatLondonDateTime } from "../../ads/londonTime.js";
import {
  AdminPage, AdminHeader, SystemNotice, AdminCard, FormSection, ToggleSetting, SmallActionButton,
  Pill, TableShell, Th, Td, Tr, EmptyState, Textarea, TextInput, Toast, TEXT_MUTED,
} from "./adminUI";

const ACCENT = "#e8203a"; // MSM red
const PHASE2 = new Set(["ads_priority_review_enabled", "ads_venue_gig_targeting_enabled", "stripe_livemode"]);

function ReviewItem({ v, booking, onDone, setToast }) {
  const [urls, setUrls] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([ads.previewUrl(v.desktop_object_path), ads.previewUrl(v.mobile_object_path)])
      .then(([d, m]) => live && setUrls({ d, m }));
    return () => { live = false; };
  }, [v.desktop_object_path, v.mobile_object_path]);
  const overdue = v.review_due_before && new Date(v.review_due_before) < new Date();
  const act = async (decision) => {
    setBusy(true);
    try {
      await ads.adminReview(v.id, decision, reason.trim());
      setToast({ type: "success", msg: decision === "approve" ? "Approved this version" : "Rejected with note" });
      onDone();
    } catch (e) {
      setToast({ type: "error", msg: friendlyAdsError(e) + " " + String(e.message || "").slice(0, 120) });
    } finally { setBusy(false); }
  };
  const paid = booking?.status === "confirmed";
  return (
    <AdminCard accent={ACCENT}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <strong>{booking?.ad_purchase_snapshots?.product_name}</strong>
        <Pill color={paid ? undefined : ACCENT}>{paid ? "Paid" : `Booking: ${booking?.status}`}</Pill>
        <Pill color={overdue ? ACCENT : undefined}>{v.review_due_before ? `Due by ${formatDeadline(v.review_due_before)}` : "Clock not started"}</Pill>
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>Version {v.version_no} - {booking?.start_date} to {booking?.end_date}</span>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {urls.d ? <img src={urls.d} alt={`Desktop artwork: ${v.alt_text}`} style={{ width: "100%", maxWidth: 600, border: "1px solid #333" }} /> : <span>Loading desktop preview...</span>}
        {urls.m ? <img src={urls.m} alt={`Mobile artwork: ${v.alt_text}`} style={{ width: "100%", maxWidth: 300, border: "1px solid #333" }} /> : <span>Loading mobile preview...</span>}
      </div>
      <p style={{ fontSize: 14 }}>Destination: <a href={v.destination_url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "#fff", wordBreak: "break-all" }}>{v.destination_url}</a></p>
      <p style={{ fontSize: 14 }}>Alt text: {v.alt_text}</p>
      <Textarea accent={ACCENT} rows={2} placeholder="Reason (required to reject; shown to the advertiser)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <SmallActionButton tone="accent" accent={ACCENT} disabled={busy || !paid} onClick={() => act("approve")}>Approve this version</SmallActionButton>
        <SmallActionButton disabled={busy || reason.trim().length < 5} onClick={() => act("reject")}>Reject</SmallActionButton>
      </div>
      {!paid && <p style={{ color: TEXT_MUTED, fontSize: 12 }}>Approval is only possible once payment is verified by the Stripe webhook.</p>}
    </AdminCard>
  );
}

export default function AdminAds() {
  const [settings, setSettings] = useState([]);
  const [inv, setInv] = useState({ units: [], products: [] });
  const [bookings, setBookings] = useState([]);
  const [names, setNames] = useState({});
  const [toast, setToast] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, i, b, n] = await Promise.all([ads.adminListSettings(), ads.adminListInventory(), ads.listBookings(), ads.adminAdvertiserNames()]);
      setSettings(s); setInv(i); setBookings(b); setNames(n);
    } catch (e) {
      setToast({ type: "error", msg: friendlyAdsError(e) });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const wrap = (fn, ok) => async () => {
    try { await fn(); setToast({ type: "success", msg: ok }); load(); } catch (e) { setToast({ type: "error", msg: friendlyAdsError(e) }); }
  };

  const queue = [];
  for (const b of bookings) {
    const c = Array.isArray(b.ad_campaigns) ? b.ad_campaigns[0] : b.ad_campaigns;
    for (const v of c?.ad_creative_versions || []) if (v.status === "submitted" && v.id === c.current_version_id) queue.push({ v, b });
  }
  queue.sort((x, y) => String(x.v.review_due_before || "9").localeCompare(String(y.v.review_due_before || "9")));

  return (
    <AdminPage>
      <Toast toast={toast} />
      <AdminHeader title="ADVERTISING (PHASE 1)" subtitle="One position: WordPress homepage top. Payment never approves or publishes." />
      <SystemNotice accent={ACCENT}>
        TEST inventory and TEST prices only; Stripe is test mode only. Commercial prices, rotation capacity, VAT, refund policy and
        terms are not decided yet. Venue/gig advertising and priority review are off (phase 2).
      </SystemNotice>

      <FormSection title="Feature toggles" first>
        {settings.filter((s) => s.bool_value !== null).map((s) => (
          <ToggleSetting key={s.key} accent={ACCENT} checked={!!s.bool_value} label={`${s.key}${PHASE2.has(s.key) ? " (phase 2 - locked)" : ""}`} hint={s.description}
            onChange={PHASE2.has(s.key) ? () => setToast({ type: "error", msg: "Not available in phase 1" }) : (val) => wrap(() => ads.adminSetSetting(s.key, val), "Saved")()} />
        ))}
        {settings.filter((s) => s.int_value !== null).map((s) => (
          <div key={s.key} style={{ margin: "10px 0" }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>{s.key} <span style={{ color: TEXT_MUTED, fontWeight: 400 }}>- {s.description}</span>
              <TextInput accent={ACCENT} type="number" defaultValue={s.int_value} style={{ maxWidth: 140, display: "block", marginTop: 6 }}
                onBlur={(e) => Number(e.target.value) !== s.int_value && wrap(() => ads.adminSetSetting(s.key, null, Number(e.target.value)), "Saved")()} />
            </label>
          </div>
        ))}
      </FormSection>

      <FormSection title="TEST inventory and packages">
        {[...inv.units.map((u) => ({ ...u, table: "ad_inventory_units", extra: `capacity ${u.rotation_capacity}/day` })),
          ...inv.products.map((p) => ({ ...p, table: "ad_products", extra: `${formatPence(p.price_per_day_pence)}/day, ${p.min_days}-${p.max_days} days` }))].map((r) => (
          <ToggleSetting key={r.id} accent={ACCENT} checked={r.active} label={`${r.name}`} hint={`${r.code} - ${r.extra}${r.is_test ? " - TEST" : ""}`}
            onChange={(val) => wrap(() => ads.adminSetActive(r.table, r.id, val), "Saved")()} />
        ))}
      </FormSection>

      <FormSection title={`Review queue (${queue.length})`}>
        {queue.length === 0 ? <EmptyState>Nothing waiting for review.</EmptyState> : queue.map(({ v, b }) => (
          <ReviewItem key={v.id} v={v} booking={b} onDone={load} setToast={setToast} />
        ))}
      </FormSection>

      <FormSection title="Bookings">
        <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SmallActionButton onClick={wrap(ads.adminExpireHolds, "Expired lapsed holds")}>Expire lapsed holds now</SmallActionButton>
          <TextInput accent={ACCENT} placeholder="Reason for pause/cancel (required to cancel)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ maxWidth: 360 }} />
        </div>
        {bookings.length === 0 ? <EmptyState>No bookings yet.</EmptyState> : (
          <TableShell minWidth={900}>
            <thead><tr><Th>Advertiser</Th><Th>Dates (UK)</Th><Th>Status</Th><Th>Review</Th><Th>Payment</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {bookings.map((b) => {
                const c = Array.isArray(b.ad_campaigns) ? b.ad_campaigns[0] : b.ad_campaigns;
                const refundDue = (b.ad_payments || []).some((p) => p.requires_refund);
                return (
                  <Tr key={b.id}>
                    <Td>{names[b.advertiser_id] || "-"}{b.is_test ? " (TEST)" : ""}<div style={{ color: TEXT_MUTED, fontSize: 11 }}>{b.id}</div></Td>
                    <Td>{b.start_date} to {b.end_date}</Td>
                    <Td>{b.status}{b.status === "held" ? ` until ${formatLondonDateTime(b.hold_expires_at)}` : ""}<div style={{ color: TEXT_MUTED, fontSize: 11 }}>{b.status_reason}</div></Td>
                    <Td>{c?.review_status}{c?.paused ? " (paused)" : ""}</Td>
                    <Td>{(b.ad_payments || []).map((p, i) => <div key={i}>{p.status} {formatPence(p.amount_pence, p.currency)}</div>)}
                      {refundDue && <Pill color={ACCENT}>REFUND REQUIRED - issue in Stripe dashboard</Pill>}</Td>
                    <Td>
                      {c && b.status === "confirmed" && (
                        <SmallActionButton onClick={wrap(() => ads.adminSetPaused(c.id, !c.paused, cancelReason), c.paused ? "Unpaused" : "Paused")}>{c.paused ? "Unpause" : "Pause"}</SmallActionButton>
                      )}
                      {["held", "confirmed", "payment_conflict"].includes(b.status) && (
                        <SmallActionButton tone="accent" accent={ACCENT} disabled={cancelReason.trim().length < 5}
                          onClick={wrap(() => ads.adminCancelBooking(b.id, cancelReason.trim()), "Cancelled (refund in Stripe if paid)")}>Cancel</SmallActionButton>
                      )}
                      {b.status === "confirmed" && <SmallActionButton onClick={wrap(() => ads.downloadReport(b.id, null, null, "csv"), "Report downloaded")}>CSV</SmallActionButton>}
                      {b.status === "confirmed" && <SmallActionButton onClick={wrap(() => ads.downloadReport(b.id, null, null, "pdf"), "Report downloaded")}>PDF</SmallActionButton>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </FormSection>
    </AdminPage>
  );
}
