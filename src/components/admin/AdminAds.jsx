/**
 * AdminAds.jsx -- MSM shared advertising platform, phase 1 admin.
 *
 * Feature toggles, TEST inventory activation, the review queue
 * (approve/reject bound to one creative version), bookings with payment
 * flags, pause/cancel, and report downloads. Every action is an
 * is_admin_or_above()-checked RPC or RLS-protected write; this panel holds
 * no extra privilege. Refunds are NEVER issued from here. Refund
 * assessments are proposed and approved here (server recomputes every
 * amount); MSM then refunds manually in the Stripe dashboard (test mode)
 * and records the processor outcome here; charge.refunded updates payments.
 * Removing a campaign is separate from any financial assessment.
 */
import { useCallback, useEffect, useState } from "react";
import * as ads from "../../ads/adsClient.js";
import { formatPence, friendlyAdsError, parseLostIntervals, refundProcessingKey, removalMessage, cancellationGuidance, CANCELLATION_INITIATORS, notificationStatusText, loadErrorText, loadingText } from "../../ads/adsPresentation.js";
import { formatLondonWithOffset } from "../../ads/ukWorkingTime.js";
import { formatDeadline, formatLondonDateTime } from "../../ads/londonTime.js";
import {
  AdminPage, AdminHeader, SystemNotice, AdminCard, FormSection, ToggleSetting, SmallActionButton,
  Pill, TableShell, Th, Td, Tr, EmptyState, Textarea, TextInput, Toast, TEXT_MUTED,
} from "./adminUI";

const ACCENT = "#e8203a"; // MSM red
// Priority review may be switched on only when MSM can actually cover 12-hour reviews.
const PHASE2 = new Set(["ads_venue_gig_targeting_enabled", "stripe_livemode"]);
const at = (x) => (x ? formatLondonWithOffset(x) : "-");

function ReviewItem({ v, booking, onDone, setToast }) {
  const [urls, setUrls] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [cause, setCause] = useState("advertiser_material");
  useEffect(() => {
    let live = true;
    Promise.all([ads.previewUrl(v.desktop_object_path), ads.previewUrl(v.mobile_object_path)])
      .then(([d, m]) => live && setUrls({ d, m }));
    return () => { live = false; };
  }, [v.desktop_object_path, v.mobile_object_path]);
  const overdue = v.review_due_before && new Date(v.review_due_before) < new Date(); // display hint only; SLA view applies kind-specific boundaries
  const act = async (decision) => {
    setBusy(true);
    try {
      if (decision === "correction") {
        const reasons = reason.split("\n").map((r) => r.trim()).filter(Boolean);
        await ads.adminRequestCorrection(v.id, cause, reasons);
        setToast({ type: "success", msg: "Correction requested - the response window starts when the notice is delivered" });
      } else {
        await ads.adminReview(v.id, decision, reason.trim());
        setToast({ type: "success", msg: decision === "approve" ? "Approved this version" : "Rejected with note" });
      }
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
      <Textarea accent={ACCENT} rows={2} placeholder="Reason (required to reject; shown to the advertiser). For a correction request: one necessary reason per line." value={reason} onChange={(e) => setReason(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <SmallActionButton tone="accent" accent={ACCENT} disabled={busy || !paid} onClick={() => act("approve")}>Approve this version</SmallActionButton>
        <SmallActionButton disabled={busy || reason.trim().length < 5} onClick={() => act("reject")}>Reject</SmallActionButton>
        <select value={cause} onChange={(e) => setCause(e.target.value)} aria-label="Correction cause" style={{ minHeight: 36, maxWidth: "100%" }}>
          <option value="advertiser_material">Advertiser material needs a correction</option>
          <option value="msm_error">MSM error (not advertiser delay; does not count as the review)</option>
        </select>
        <SmallActionButton disabled={busy || !paid || reason.trim().length < 5} onClick={() => act("correction")}>Request correction</SmallActionButton>
      </div>
      {!paid && <p style={{ color: TEXT_MUTED, fontSize: 12 }}>Approval is only possible once payment is verified by the Stripe webhook.</p>}
    </AdminCard>
  );
}

function BookingTools({ booking, onDone, setToast }) {
  const [sla, setSla] = useState(null);
  const [feeLine, setFeeLine] = useState(false);
  const [lostText, setLostText] = useState("");
  const [note, setNote] = useState("");
  const [noticeNote, setNoticeNote] = useState("");
  const [cx, setCx] = useState({ delivered: "", loss: "", evidence: "" });
  const [kase, setKase] = useState(null);
  const loadSla = useCallback(() => {
    ads.reviewSla(booking.id).then(setSla).catch((e) => setToast({ type: "error", msg: friendlyAdsError(e) }));
    if (booking.status === "cancelled") ads.adminGetCancellationCase(booking.id).then(setKase).catch(() => setKase(null));
  }, [booking.id, booking.status, setToast]);
  const guide = cancellationGuidance(kase);
  const run = (fn, ok) => async () => {
    try { await fn(); setToast({ type: "success", msg: ok }); loadSla(); onDone(); } catch (e) { setToast({ type: "error", msg: friendlyAdsError(e) + " " + String(e.message || "").slice(0, 160) }); }
  };
  return (
    <details onToggle={(e) => e.currentTarget.open && !sla && loadSla()} style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 12 }}>Review SLA / corrections / refunds</summary>
      {sla && (
        <div style={{ fontSize: 12, display: "grid", gap: 6, marginTop: 6, minWidth: 320 }}>
          <div>Initial: {sla.initial_kind || "clock not started"} - due {at(sla.initial_due_at)} - first outcome {sla.first_review_outcome || "-"} {at(sla.first_review_outcome_at)}
            {" "}- met: {sla.initial_review_met === null ? "pending" : String(sla.initial_review_met)}</div>
          {sla.priority_fee_refund_assessment_needed && <Pill color={ACCENT}>Priority deadline missed - assess the £ fee refund</Pill>}
          {(sla.deadlines || []).map((d, i) => <div key={i} style={{ color: TEXT_MUTED }}>{d.kind}: {at(d.starts_at)} {"->"} {at(d.due_at)}</div>)}
          {(sla.corrections || []).map((c) => (
            <div key={c.id}>Correction v{c.version_no} ({c.cause}): {(c.reasons || []).join("; ")} - {c.status}
              {c.response_due_at ? `, respond by ${at(c.response_due_at)}` : ", window not started (notice not delivered)"}
              {c.notice_exception && <Pill color={ACCENT}>Late bounce/exception - decide</Pill>}
              {c.status === "awaiting_notice" && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <TextInput accent={ACCENT} placeholder="Fallback contact made (who/how/when)" value={noticeNote} onChange={(e) => setNoticeNote(e.target.value)} style={{ maxWidth: 260 }} />
                  <SmallActionButton disabled={noticeNote.trim().length < 5} onClick={run(() => ads.adminRecordCorrectionNotice(c.id, "sent", noticeNote.trim()), "Fallback notice recorded")}>Record fallback notice delivered</SmallActionButton>
                </div>
              )}
            </div>
          ))}
          <strong>Propose service-failure refund (manual; nothing is paid from here)</strong>
          <label><input type="checkbox" checked={feeLine} onChange={(e) => setFeeLine(e.target.checked)} /> Include the priority fee (only if MSM missed the initial priority deadline)</label>
          <Textarea accent={ACCENT} rows={2} placeholder="MSM-fault lost time, one per line: 2026-11-02T10:00Z | 2026-11-02T16:00Z | evidence" value={lostText} onChange={(e) => setLostText(e.target.value)} />
          <TextInput accent={ACCENT} placeholder="Assessment note" value={note} onChange={(e) => setNote(e.target.value)} />
          <SmallActionButton disabled={note.trim().length < 5} onClick={run(() => ads.adminProposeRefund(booking.id, feeLine, parseLostIntervals(lostText), note.trim()), "Refund assessment proposed")}>Propose refund assessment</SmallActionButton>
          {booking.status === "confirmed" && <>
            <strong>Correction-delay amendment (advertiser must accept; gated: ads_amendments_enabled + amendment_offer_minutes)</strong>
            <SmallActionButton disabled={note.trim().length < 5} onClick={run(() => ads.adminProposeAmendment(booking.id, note.trim()), "Amendment proposed - waiting for the advertiser")}>Propose next-whole-hour amendment</SmallActionButton>
          </>}
          {booking.status === "cancelled" && (
            <>
              <strong>Cancellation assessment{kase ? ` (initiated by ${kase.initiated_by}, ${kase.party_type})` : ""}</strong>
              <span style={{ color: TEXT_MUTED }}>{guide.text}</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <TextInput accent={ACCENT} type="number" placeholder="Delivered value (pence)" value={cx.delivered} onChange={(e) => setCx({ ...cx, delivered: e.target.value })} style={{ maxWidth: 170 }} />
                {guide.allowNetLoss && <TextInput accent={ACCENT} type="number" placeholder="Net loss after mitigation (pence)" value={cx.loss} onChange={(e) => setCx({ ...cx, loss: e.target.value })} style={{ maxWidth: 220 }} />}
              </div>
              <TextInput accent={ACCENT} placeholder="Evidence (delivery, saved costs, resale)" value={cx.evidence} onChange={(e) => setCx({ ...cx, evidence: e.target.value })} />
              <SmallActionButton disabled={!guide.canAssess || note.trim().length < 5 || cx.evidence.trim().length < 10}
                onClick={run(() => ads.adminProposeCancellationRefund(booking.id, Number(cx.delivered || 0), guide.allowNetLoss ? Number(cx.loss || 0) : 0, cx.evidence.trim(), note.trim()), "Cancellation assessment proposed")}>Propose cancellation assessment</SmallActionButton>
            </>
          )}
        </div>
      )}
    </details>
  );
}

function RefundRow({ a, onDone, setToast }) {
  const [note, setNote] = useState("");
  const [re, setRe] = useState("");
  const events = a.ad_refund_processing_events || [];
  const run = (fn, ok) => async () => {
    try { const r = await fn(); setToast({ type: "success", msg: r === "duplicate" ? "Already recorded" : ok }); onDone(); } catch (e) { setToast({ type: "error", msg: friendlyAdsError(e) + " " + String(e.message || "").slice(0, 160) }); }
  };
  const record = (status) => run(() => ads.adminRecordRefundProcessing(a.id, status, re.trim() || null, refundProcessingKey(a.id, status, re.trim(), events.length), note.trim()), `Recorded ${status}`);
  return (
    <AdminCard accent={ACCENT}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <strong>{a.kind} - {formatPence(a.total_pence)}</strong>
        <Pill color={a.status === "manual_gate" ? ACCENT : undefined}>{a.status}</Pill>
        {a.gates?.length > 0 && <span style={{ fontSize: 12, overflowWrap: "anywhere" }}>gates: {a.gates.join(", ")}</span>}
        <span style={{ color: TEXT_MUTED, fontSize: 12 }}>booking {a.booking_id} - proposed {at(a.proposed_at)}{a.target_pay_by ? ` - pay by ${at(a.target_pay_by)}` : ""}</span>
      </div>
      <ul style={{ fontSize: 12 }}>{(a.ad_refund_lines || []).map((l, i) => (
        <li key={i}>{l.kind}: {formatPence(l.pence)}{l.lost_seconds ? ` (${l.lost_seconds / 3600} h of ${l.purchased_seconds / 3600} h)` : ""}</li>))}
        {events.map((e, i) => <li key={`e${i}`}>Processor: {e.status} {e.provider_refund_id || ""} {at(e.occurred_at)} {e.note || ""}</li>)}
      </ul>
      <TextInput accent={ACCENT} placeholder="Decision / processing note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {["proposed", "manual_gate"].includes(a.status) && <>
          <SmallActionButton tone="accent" accent={ACCENT} disabled={a.status === "manual_gate" || note.trim().length < 5} onClick={run(() => ads.adminDecideRefund(a.id, "approve", note.trim()), "Approved - refund manually in Stripe within 14 days")}>Approve</SmallActionButton>
          <SmallActionButton disabled={note.trim().length < 5} onClick={run(() => ads.adminDecideRefund(a.id, "reject", note.trim()), "Rejected")}>Reject</SmallActionButton>
        </>}
        {a.status === "approved" && !events.some((e) => e.status === "succeeded") && <>
          <TextInput accent={ACCENT} placeholder="Stripe refund id (re_...)" value={re} onChange={(e) => setRe(e.target.value)} style={{ maxWidth: 220 }} />
          <SmallActionButton disabled={!/^re_[A-Za-z0-9]+$/.test(re.trim())} onClick={record("submitted")}>Record submitted</SmallActionButton>
          <SmallActionButton disabled={!/^re_[A-Za-z0-9]+$/.test(re.trim())} onClick={record("succeeded")}>Record succeeded</SmallActionButton>
          <SmallActionButton disabled={note.trim().length < 5} onClick={record("failed")}>Record failed</SmallActionButton>
        </>}
      </div>
      {a.status === "manual_gate" && <p style={{ color: TEXT_MUTED, fontSize: 12 }}>Manual gate: no agreed policy yet for this case, so it cannot be approved here.</p>}
    </AdminCard>
  );
}

// Each section loads on its own and keeps a VISIBLE state: a failed or stuck
// request can never look like "no settings" / "no bookings".
const SECTIONS = {
  settings: { label: "settings", fetch: () => ads.adminListSettings() },
  inventory: { label: "inventory and packages", fetch: () => ads.adminListInventory() },
  bookings: { label: "bookings", fetch: () => ads.listBookings() },
  names: { label: "advertiser names", fetch: () => ads.adminAdvertiserNames() },
  refunds: { label: "refund assessments", fetch: () => ads.adminListRefunds() },
  notifications: { label: "email notifications", fetch: () => ads.adminListNotifications() },
};

function LoadNotice({ st, label, onRetry, now }) {
  if (!st || st.state === "ok") return null;
  if (st.state === "loading") {
    return <p role="status" style={{ color: TEXT_MUTED, fontSize: 13 }}>{loadingText(label, Math.floor((now - st.since) / 1000))}</p>;
  }
  return (
    <div role="alert" style={{ border: `1px solid ${ACCENT}`, borderRadius: 6, padding: "8px 10px", margin: "6px 0", fontSize: 13, overflowWrap: "anywhere" }}>
      {loadErrorText(label, st.error)} <SmallActionButton onClick={onRetry}>Retry</SmallActionButton>
    </div>
  );
}

export default function AdminAds() {
  const [settings, setSettings] = useState([]);
  const [inv, setInv] = useState({ units: [], products: [] });
  const [bookings, setBookings] = useState([]);
  const [names, setNames] = useState({});
  const [toast, setToast] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [partyType, setPartyType] = useState("undetermined");
  const [initiatedBy, setInitiatedBy] = useState("");
  const [refunds, setRefunds] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");

  const [status, setStatus] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const setters = { settings: setSettings, inventory: setInv, bookings: setBookings, names: setNames, refunds: setRefunds, notifications: setNotes };
  const loadOne = useCallback(async (key) => {
    setStatus((m) => ({ ...m, [key]: { state: "loading", since: Date.now() } }));
    try {
      const data = await SECTIONS[key].fetch();
      setters[key](data);
      setStatus((m) => ({ ...m, [key]: { state: "ok" } }));
    } catch (e) {
      setStatus((m) => ({ ...m, [key]: { state: "error", error: e } }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- setters are stable state setters
  const load = useCallback(() => Promise.allSettled(Object.keys(SECTIONS).map(loadOne)), [loadOne]);
  useEffect(() => { load(); }, [load]);
  const anyLoading = Object.values(status).some((x) => x.state === "loading");
  useEffect(() => { if (!anyLoading) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [anyLoading]);
  const ok = (k) => status[k]?.state === "ok";
  const notice = (k) => <LoadNotice st={status[k]} label={SECTIONS[k].label} onRetry={() => loadOne(k)} now={now} />;
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
        terms are not decided yet (order terms are a DRAFT version). Venue/gig advertising is off (phase 2). Only switch priority review on
        when MSM can really cover 12-hour reviews; the GBP fee is the priority_fee_pence setting. Advertising emails are sent only by the server
        email worker, which stays OFF until both ads_email_enabled and the server's ADS_EMAIL_ENABLED are on. While it is off, record a fallback
        contact on the correction to start the advertiser's response window.
      </SystemNotice>

      <FormSection title="Feature toggles" first>
        {notice("settings")}
        {ok("settings") && settings.length === 0 && <EmptyState>No settings rows were returned.</EmptyState>}
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
        {notice("inventory")}
        {ok("inventory") && inv.units.length + inv.products.length === 0 && <EmptyState>No inventory or packages were returned.</EmptyState>}
        {[...inv.units.map((u) => ({ ...u, table: "ad_inventory_units", extra: `capacity ${u.rotation_capacity}/day` })),
          ...inv.products.map((p) => ({ ...p, table: "ad_products", extra: `${formatPence(p.price_per_day_pence)}/day, ${p.min_days}-${p.max_days} days` }))].map((r) => (
          <ToggleSetting key={r.id} accent={ACCENT} checked={r.active} label={`${r.name}`} hint={`${r.code} - ${r.extra}${r.is_test ? " - TEST" : ""}`}
            onChange={(val) => wrap(() => ads.adminSetActive(r.table, r.id, val), "Saved")()} />
        ))}
      </FormSection>

      <FormSection title={ok("bookings") ? `Review queue (${queue.length})` : "Review queue"}>
        {notice("bookings")}
        {!ok("bookings") ? null : queue.length === 0 ? <EmptyState>Nothing waiting for review.</EmptyState> : queue.map(({ v, b }) => (
          <ReviewItem key={v.id} v={v} booking={b} onDone={load} setToast={setToast} />
        ))}
      </FormSection>

      <FormSection title="Bookings">
        <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SmallActionButton onClick={wrap(ads.adminExpireHolds, "Expired lapsed holds")}>Expire lapsed holds now</SmallActionButton>
          <SmallActionButton onClick={wrap(ads.adminExpireAmendments, "Expired lapsed amendment offers")}>Expire lapsed amendment offers</SmallActionButton>
          <TextInput accent={ACCENT} placeholder="Reason for pause/removal (required to remove)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ maxWidth: 360 }} />
          <select value={partyType} onChange={(e) => setPartyType(e.target.value)} aria-label="Advertiser status for removal" style={{ minHeight: 36, maxWidth: "100%" }}>
            <option value="undetermined">Business/consumer status not yet determined (assessment gated)</option>
            <option value="business">Business (determined on the facts)</option>
          </select>
          <select value={initiatedBy} onChange={(e) => setInitiatedBy(e.target.value)} aria-label="Who initiated the cancellation" style={{ minHeight: 36, maxWidth: "100%" }}>
            <option value="">Who initiated it? (required to remove)</option>
            {Object.entries(CANCELLATION_INITIATORS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        {notice("bookings")}
        {notice("names")}
        {!ok("bookings") ? null : bookings.length === 0 ? <EmptyState>No bookings yet.</EmptyState> : (
          <TableShell minWidth={900}>
            <thead><tr><Th>Advertiser</Th><Th>Dates (UK)</Th><Th>Status</Th><Th>Review</Th><Th>Payment</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {bookings.map((b) => {
                const c = Array.isArray(b.ad_campaigns) ? b.ad_campaigns[0] : b.ad_campaigns;
                const refundDue = (b.ad_payments || []).some((p) => p.requires_refund);
                return (
                  <Tr key={b.id}>
                    <Td>{names[b.advertiser_id] || "-"}{b.is_test ? " (TEST)" : ""}<div style={{ color: TEXT_MUTED, fontSize: 11 }}>{b.id}</div></Td>
                    <Td>{b.start_date} to {b.end_date}{b.serve_from && <div style={{ color: TEXT_MUTED, fontSize: 11 }}>runs {at(b.serve_from)} - {at(b.serve_until)}</div>}</Td>
                    <Td>{b.status}{b.status === "held" ? ` until ${formatLondonDateTime(b.hold_expires_at)}` : ""}<div style={{ color: TEXT_MUTED, fontSize: 11 }}>{b.status_reason}</div></Td>
                    <Td>{c?.review_status}{c?.paused ? " (paused)" : ""}</Td>
                    <Td>{(b.ad_payments || []).map((p, i) => <div key={i}>{p.status} {formatPence(p.amount_pence, p.currency)}</div>)}
                      {refundDue && <Pill color={ACCENT}>REFUND REQUIRED - issue in Stripe dashboard</Pill>}</Td>
                    <Td>
                      {c && b.status === "confirmed" && (
                        <SmallActionButton onClick={wrap(() => ads.adminSetPaused(c.id, !c.paused, cancelReason), c.paused ? "Unpaused" : "Paused")}>{c.paused ? "Unpause" : "Pause"}</SmallActionButton>
                      )}
                      {["held", "confirmed", "payment_conflict"].includes(b.status) && (
                        <SmallActionButton tone="accent" accent={ACCENT} disabled={cancelReason.trim().length < 5 || !initiatedBy}
                          onClick={wrap(() => ads.adminCancelBooking(b.id, cancelReason.trim(), partyType, initiatedBy), removalMessage(initiatedBy))}>Remove</SmallActionButton>
                      )}
                      {b.status === "confirmed" && <SmallActionButton onClick={wrap(() => ads.downloadReport(b.id, null, null, "csv"), "Report downloaded")}>CSV</SmallActionButton>}
                      {b.status === "confirmed" && <SmallActionButton onClick={wrap(() => ads.downloadReport(b.id, null, null, "pdf"), "Report downloaded")}>PDF</SmallActionButton>}
                      {["confirmed", "cancelled", "refunded"].includes(b.status) && <BookingTools booking={b} onDone={load} setToast={setToast} />}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </FormSection>

      <FormSection title={ok("notifications") ? `Email notifications (${notes.length})` : "Email notifications"}>
        {notice("notifications")}
        <p style={{ color: TEXT_MUTED, fontSize: 12 }}>Sent only by the server worker when ads_email_enabled AND the server's ADS_EMAIL_ENABLED are on. Correction response windows start only on provider-reported delivery or a recorded fallback contact.</p>
        <TextInput accent={ACCENT} placeholder="Note for retry/cancel" value={noteText} onChange={(e) => setNoteText(e.target.value)} style={{ maxWidth: 360 }} />
        {!ok("notifications") ? null : notes.length === 0 ? <EmptyState>No notifications queued.</EmptyState> : (
          <TableShell minWidth={800}>
            <thead><tr><Th>Kind</Th><Th>Status</Th><Th>Attempts</Th><Th>Times</Th><Th>Last error</Th><Th>Actions</Th></tr></thead>
            <tbody>{notes.map((n) => (
              <Tr key={n.id}>
                <Td>{n.kind}<div style={{ color: TEXT_MUTED, fontSize: 11 }}>{n.recipient_role} - booking {n.booking_id || "-"}</div></Td>
                <Td>{notificationStatusText(n)}</Td>
                <Td>{n.attempts}</Td>
                <Td style={{ fontSize: 11 }}>queued {at(n.created_at)}{n.accepted_at ? ` - accepted ${at(n.accepted_at)}` : ""}{n.delivered_at ? ` - delivered ${at(n.delivered_at)}` : ""}{n.status === "pending" ? ` - next ${at(n.next_attempt_at)}` : ""}</Td>
                <Td style={{ fontSize: 11 }}>{n.reconciliation_reason ? `${n.reconciliation_reason}. ` : ""}{n.last_error || "-"}{n.first_dispatched_at ? ` (first dispatch ${at(n.first_dispatched_at)}, generation ${n.dispatch_generation})` : ""}</Td>
                <Td>
                  {["dead", "failed"].includes(n.status) && <SmallActionButton disabled={noteText.trim().length < 5} onClick={wrap(() => ads.adminRetryNotification(n.id, noteText.trim()), "Queued for retry")}>Retry</SmallActionButton>}
                  {n.status === "needs_reconciliation" && <>
                    <SmallActionButton disabled={noteText.trim().length < 10} onClick={wrap(() => ads.adminReconcileNotification(n.id, "confirmed_sent", null, noteText.trim()), "Recorded as sent")}>Provider shows it was sent</SmallActionButton>
                    <SmallActionButton disabled={noteText.trim().length < 10} onClick={wrap(() => ads.adminReconcileNotification(n.id, "confirmed_not_sent", null, noteText.trim()), "Re-queued under a new idempotency key")}>Provider shows it was NOT sent</SmallActionButton>
                  </>}
                  {["pending", "dead", "failed", "needs_reconciliation"].includes(n.status) && <SmallActionButton disabled={noteText.trim().length < 5} onClick={wrap(() => ads.adminCancelNotification(n.id, noteText.trim()), "Cancelled")}>Cancel</SmallActionButton>}
                </Td>
              </Tr>))}
            </tbody>
          </TableShell>
        )}
      </FormSection>

      <FormSection title={ok("refunds") ? `Refund assessments (${refunds.length})` : "Refund assessments"}>
        {notice("refunds")}
        {!ok("refunds") ? null : refunds.length === 0 ? <EmptyState>No refund assessments.</EmptyState> : refunds.map((a) => <RefundRow key={a.id} a={a} onDone={load} setToast={setToast} />)}
      </FormSection>
    </AdminPage>
  );
}
