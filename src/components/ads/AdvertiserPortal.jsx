/**
 * AdvertiserPortal.jsx -- MSM shared advertising platform, phase 1.
 *
 * Minimal, mobile-first advertiser flow for ONE position (WordPress
 * homepage top): profile -> dates/availability -> hold -> artwork + link
 * -> Stripe TEST checkout -> status (Under Review deadline) -> reports.
 *
 * Hidden unless the `ads_portal_enabled` toggle is on (see App.jsx). All
 * rules are enforced server-side (RLS/RPCs/api/ads); this UI only gives
 * early feedback. Returning from Stripe is never treated as payment: the
 * page just re-reads the booking until the verified webhook has updated it.
 *
 * Testing note: same convention as PromoSlot.jsx -- no jsdom in this repo,
 * so decision logic lives in src/ads/*.js (unit-tested) and this file is a
 * thin wrapper verified by review + build.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as ads from "../../ads/adsClient.js";
import { describeBooking, formatPence, holdMinutesLeft, canStartCheckout, friendlyAdsError, clampToEarliest, earliestStartExplanation, reviewPromiseText, correctionText, confirmationText, amendmentText, servingIntervalText } from "../../ads/adsPresentation.js";
import { destinationUrlProblem, altTextProblem, creativeFileProblem } from "../../ads/validation.js";
import { addDays, formatDeadline, londonDayStart } from "../../ads/londonTime.js";
import { REPORT_LIMITATIONS } from "../../ads/reportLimitations.js";

// alert: lighter MSM red for TEXT on the dark panels (brand #e8203a text is 4.1:1, under WCAG AA 4.5:1).
const K = { bg: "#0d0d0d", panel: "#151515", field: "#0a0a0a", text: "#ffffff", muted: "#a6a6a6", line: "rgba(255,255,255,0.14)", red: "#e8203a", alert: "#ff6b7d" };
const TONE = { good: K.text, warn: K.text, bad: K.red, neutral: K.muted };

const css = `
.msm-adp { background:${K.bg}; color:${K.text}; min-height:100%; padding:24px 16px 64px; font-family:'Barlow',sans-serif; }
.msm-adp__wrap { max-width:760px; margin:0 auto; }
.msm-adp h1 { font-family:'Bebas Neue',sans-serif; letter-spacing:2px; font-size:34px; margin:12px 0 4px; }
.msm-adp h2 { font-family:'Bebas Neue',sans-serif; letter-spacing:1.5px; font-size:24px; margin:0 0 12px; }
.msm-adp__card { background:${K.panel}; border:1px solid ${K.line}; border-radius:10px; padding:18px; margin:16px 0; }
.msm-adp label { display:block; font-size:13px; font-weight:700; letter-spacing:.5px; margin:12px 0 6px; }
.msm-adp input, .msm-adp select { width:100%; box-sizing:border-box; min-height:44px; padding:10px 12px; background:${K.field}; color:${K.text}; border:1px solid ${K.line}; border-radius:6px; font-size:16px; }
.msm-adp input[type=file] { padding:8px; }
.msm-adp button { min-height:44px; padding:10px 18px; border-radius:6px; border:1px solid ${K.text}; background:transparent; color:${K.text}; font-weight:700; font-size:15px; cursor:pointer; margin:12px 8px 0 0; }
.msm-adp button.primary { background:${K.red}; border-color:${K.red}; }
.msm-adp button:disabled { opacity:.45; cursor:not-allowed; }
.msm-adp :focus-visible { outline:3px solid ${K.red}; outline-offset:2px; }
.msm-adp__help { color:${K.muted}; font-size:13px; line-height:1.5; margin:6px 0 0; }
.msm-adp__test { border:2px solid ${K.red}; color:${K.text}; padding:10px 14px; border-radius:8px; font-weight:700; margin:12px 0; }
.msm-adp__err { color:${K.alert}; font-weight:700; margin-top:10px; }
.msm-adp__row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.msm-adp dl { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; margin:8px 0; font-size:14px; }
.msm-adp dt { color:${K.muted}; }
@media (max-width:600px) { .msm-adp__row { grid-template-columns:1fr; } .msm-adp h1 { font-size:28px; } }
`;

function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError("");
    try { return await fn(); } catch (e) { setError(friendlyAdsError(e)); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}

function ProfileForm({ onCreated }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { busy, error, run } = useAsync();
  return (
    <section className="msm-adp__card" aria-labelledby="adp-profile">
      <h2 id="adp-profile">Your advertiser profile</h2>
      <p className="msm-adp__help">Private to you and MSM. Never shown with your advert.</p>
      <label htmlFor="adp-name">Business or band name</label>
      <input id="adp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="organization" />
      <label htmlFor="adp-email">Contact email</label>
      <input id="adp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" />
      <button className="primary" disabled={busy || name.trim().length < 2 || !email.includes("@")}
        onClick={() => run(async () => onCreated(await ads.createAdvertiser(name.trim(), email.trim())))}>Save profile</button>
      {error && <p className="msm-adp__err" role="alert">{error}</p>}
    </section>
  );
}

function NewBooking({ products, onHeld }) {
  const [productId, setProductId] = useState(products[0]?.id || "");
  // Earliest STANDARD start comes from the server (review window: end of the
  // next UK working day after payment + complete artwork/link). The DB
  // re-checks it on quote and hold, so this is only the picker floor/default.
  const [earliest, setEarliest] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [q, setQ] = useState(null);
  const [priority, setPriority] = useState(false);
  const [priorityOffered, setPriorityOffered] = useState(false);
  const { busy, error, run } = useAsync();
  const product = products.find((p) => p.id === productId);
  useEffect(() => { setQ(null); }, [productId, start, end, priority]);
  useEffect(() => {
    run(async () => {
      const info = await ads.getEarliestStart();
      setEarliest(info);
      setStart((s) => clampToEarliest(s, info.earliest_start));
      setEnd((x) => clampToEarliest(x, info.earliest_start));
    });
  }, [run]);
  const minStart = earliest?.earliest_start || "";

  return (
    <section className="msm-adp__card" aria-labelledby="adp-new">
      <h2 id="adp-new">Book dates</h2>
      <label htmlFor="adp-product">Position / package</label>
      <select id="adp-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name} - {formatPence(p.price_per_day_pence)}/day{p.is_test ? " (TEST)" : ""}</option>)}
      </select>
      {product?.description && <p className="msm-adp__help">{product.description}</p>}
      <div className="msm-adp__row">
        <div>
          <label htmlFor="adp-start">First day (UK date)</label>
          <input id="adp-start" type="date" value={start} min={minStart} disabled={!minStart}
            onChange={(e) => { const v = clampToEarliest(e.target.value, minStart); setStart(v); if (end < v) setEnd(v); }} />
        </div>
        <div>
          <label htmlFor="adp-end">Last day (UK date, included)</label>
          <input id="adp-end" type="date" value={end} min={start || minStart} disabled={!minStart} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {earliest && <p className="msm-adp__help">{earliestStartExplanation(earliest, priorityOffered)}</p>}
      {priorityOffered && (
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400 }}>
          <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} style={{ width: 22, minHeight: 22, marginTop: 2 }} />
          <span>Add optional priority review (first review decision within 12 elapsed hours). The exact price and deadline are shown when you check the price.</span>
        </label>
      )}
      <p className="msm-adp__help">Your advert can run from 00:00 UK time on the first day until the end of the last day (UK time), once MSM has approved it. Payment does not approve or publish an advert.</p>
      <button disabled={busy || !productId || !start || !end} onClick={() => run(async () => {
        const r = await ads.quote(productId, start, end, priority && priorityOffered);
        setPriorityOffered(Boolean(r.priority_available));
        if (!r.priority_available && priority) setPriority(false);
        setQ(r);
      })}>Check availability & price</button>
      {q && (
        <div aria-live="polite">
          <dl>
            <dt>Available</dt><dd>{q.available ? "Yes" : `No - booked on ${q.unavailable_days.join(", ")}`}</dd>
            <dt>Days</dt><dd>{q.billable_days}</dd>
            {q.priority_review && <><dt>Placement</dt><dd>{formatPence(q.placement_pence, q.currency)}</dd>
              <dt>Priority review</dt><dd>{formatPence(q.priority_fee_pence, q.currency)}</dd></>}
            <dt>Total</dt><dd>{formatPence(q.total_pence, q.currency)}{q.is_test ? " (TEST price - not a real charge)" : ""}</dd>
            <dt>Runs</dt><dd>{new Date(q.live_from).toLocaleString("en-GB", { timeZone: "Europe/London" })} to end of {end} (UK time)</dd>
          </dl>
          <p className="msm-adp__help">{reviewPromiseText(q)}</p>
          {q.terms_version && <p className="msm-adp__help">Order terms version: {q.terms_version}{/^DRAFT/.test(q.terms_version) ? " (draft - not final terms)" : ""}</p>}
          <button className="primary" disabled={busy || !q.available}
            onClick={() => run(async () => { await ads.createHold(productId, start, end, Boolean(q.priority_review)); onHeld(); })}>Hold these dates</button>
          <p className="msm-adp__help">Holds are kept for a short time while you pay. The price is fixed by MSM's system when you hold.</p>
        </div>
      )}
      {error && <p className="msm-adp__err" role="alert">{error}</p>}
    </section>
  );
}

function CreativeForm({ booking, campaign, advertiserId, spec, onSubmitted }) {
  const [files, setFiles] = useState({ desktop: null, mobile: null });
  const [sizes, setSizes] = useState({});
  const [dest, setDest] = useState("");
  const [alt, setAlt] = useState("");
  const { busy, error, setError, run } = useAsync();
  const pick = async (side, file) => {
    setFiles((f) => ({ ...f, [side]: file }));
    if (file) {
      try { const s = await ads.readImageSize(file); setSizes((x) => ({ ...x, [side]: s })); } catch { setSizes((x) => ({ ...x, [side]: {} })); }
    }
  };
  const problems = [
    creativeFileProblem(files.desktop, sizes.desktop, spec && { width: spec.desktop_width, height: spec.desktop_height }),
    creativeFileProblem(files.mobile, sizes.mobile, spec && { width: spec.mobile_width, height: spec.mobile_height }),
    dest ? destinationUrlProblem(dest) : "Enter a destination URL.",
    altTextProblem(alt),
  ];
  const submit = () => run(async () => {
    const desktop_path = await ads.uploadCreative(files.desktop, advertiserId, campaign.id, "desktop");
    const mobile_path = await ads.uploadCreative(files.mobile, advertiserId, campaign.id, "mobile");
    await ads.submitCreative({ campaign_id: campaign.id, desktop_path, mobile_path, destination_url: dest.trim(), alt_text: alt.trim() });
    onSubmitted();
  });
  const firstProblem = problems.find(Boolean);
  return (
    <div>
      <h3 style={{ margin: "16px 0 4px" }}>{campaign.current_version_id ? "Replace artwork / link" : "Artwork and link"}</h3>
      {campaign.approved_version_id && <p className="msm-adp__help">Replacements need a fresh MSM review. Your approved advert keeps running until the replacement is approved.</p>}
      <label htmlFor={`adp-d-${booking.id}`}>Desktop image ({spec ? `${spec.desktop_width}x${spec.desktop_height}` : "exact size"} px, PNG/JPEG/WebP, max 1 MB)</label>
      <input id={`adp-d-${booking.id}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick("desktop", e.target.files?.[0] || null)} />
      <label htmlFor={`adp-m-${booking.id}`}>Mobile image ({spec ? `${spec.mobile_width}x${spec.mobile_height}` : "exact size"} px)</label>
      <input id={`adp-m-${booking.id}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick("mobile", e.target.files?.[0] || null)} />
      <label htmlFor={`adp-u-${booking.id}`}>Destination link (https://)</label>
      <input id={`adp-u-${booking.id}`} type="url" inputMode="url" value={dest} onChange={(e) => { setDest(e.target.value); setError(""); }} placeholder="https://" />
      <label htmlFor={`adp-a-${booking.id}`}>Alt text (describes the advert for screen readers)</label>
      <input id={`adp-a-${booking.id}`} value={alt} maxLength={250} onChange={(e) => setAlt(e.target.value)} />
      {firstProblem && (files.desktop || files.mobile || dest || alt) && <p className="msm-adp__help" aria-live="polite">{firstProblem}</p>}
      <button className="primary" disabled={busy || Boolean(firstProblem)} onClick={submit}>{busy ? "Uploading..." : "Submit for review"}</button>
      {error && <p className="msm-adp__err" role="alert">{error}</p>}
    </div>
  );
}

function ReportBox({ booking }) {
  const [from, setFrom] = useState(booking.start_date);
  const [to, setTo] = useState(booking.end_date);
  const { busy, error, run } = useAsync();
  return (
    <details style={{ marginTop: 14 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Performance report</summary>
      <div className="msm-adp__row">
        <div><label htmlFor={`rf-${booking.id}`}>From (UK date)</label><input id={`rf-${booking.id}`} type="date" value={from} min={booking.start_date} max={booking.end_date} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label htmlFor={`rt-${booking.id}`}>To (UK date)</label><input id={`rt-${booking.id}`} type="date" value={to} min={booking.start_date} max={booking.end_date} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <button disabled={busy} onClick={() => run(() => ads.downloadReport(booking.id, from, to, "csv"))}>Download CSV</button>
      <button disabled={busy} onClick={() => run(() => ads.downloadReport(booking.id, from, to, "pdf"))}>Download PDF</button>
      <ul className="msm-adp__help">{REPORT_LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
      {error && <p className="msm-adp__err" role="alert">{error}</p>}
    </details>
  );
}

function BookingCard({ booking, advertiserId, flags, specByCode, sla, confirmation, amendments, onChange }) {
  const snap = booking.ad_purchase_snapshots;
  const campaign = Array.isArray(booking.ad_campaigns) ? booking.ad_campaigns[0] : booking.ad_campaigns;
  const versions = (campaign?.ad_creative_versions || []).slice().sort((a, b) => b.version_no - a.version_no);
  const current = versions.find((v) => v.id === campaign?.current_version_id);
  const status = describeBooking(booking, campaign, current);
  const { busy, error, run } = useAsync();
  const isHeld = booking.status === "held" && holdMinutesLeft(booking) > 0;
  const open = isHeld || booking.status === "confirmed";
  const ended = new Date() >= (booking.serve_until ? new Date(booking.serve_until) : londonDayStart(addDays(booking.end_date, 1)));
  const spec = specByCode[snap?.unit_codes?.[0]];

  return (
    <article className="msm-adp__card" aria-labelledby={`b-${booking.id}`}>
      <h2 id={`b-${booking.id}`} style={{ fontSize: 20 }}>{snap?.product_name}</h2>
      {booking.is_test && <p className="msm-adp__help"><strong>TEST booking</strong> - not a real advert purchase.</p>}
      <p style={{ color: TONE[status.tone], fontWeight: 700 }} aria-live="polite">{status.label}</p>
      <dl>
        <dt>Booked (UK)</dt><dd>{booking.start_date} to {booking.end_date} (inclusive)</dd>
        {booking.serve_from && <><dt>Runs</dt><dd>{servingIntervalText(booking)}</dd></>}
        <dt>Total</dt><dd>{snap ? formatPence(snap.total_pence, snap.currency) : "-"}</dd>
        <dt>Reference</dt><dd style={{ wordBreak: "break-all" }}>{booking.id}</dd>
        {isHeld && <><dt>Hold</dt><dd>{holdMinutesLeft(booking)} minutes left</dd></>}
      </dl>
      {isHeld && (
        <>
          <button className="primary" disabled={busy || !flags.checkout || !canStartCheckout(booking)} onClick={() => run(() => ads.startCheckout(booking.id))}>
            Pay with Stripe (TEST mode)
          </button>
          <button disabled={busy} onClick={() => run(async () => { await ads.cancelHold(booking.id); onChange(); })}>Cancel hold</button>
          {!flags.checkout && <p className="msm-adp__help">Payments are switched off at the moment.</p>}
          {flags.checkout && !canStartCheckout(booking) && <p className="msm-adp__help">Less than 31 minutes left on this hold - cancel it and hold the dates again to pay.</p>}
        </>
      )}
      {confirmation && <p className="msm-adp__help" role="note">{confirmationText(confirmation)}</p>}
      {(amendments || []).slice(0, 3).map((a) => (
        <div key={a.id} className="msm-adp__help" role={a.status === "proposed" ? "alert" : undefined}>
          <p>{amendmentText(a)}</p>
          {a.status === "proposed" && new Date(a.expires_at) > new Date() && (
            <>
              <button className="primary" disabled={busy} onClick={() => run(async () => { await ads.respondAmendment(a.id, "accept"); onChange(); })}>Accept this change</button>
              <button disabled={busy} onClick={() => run(async () => { await ads.respondAmendment(a.id, "reject"); onChange(); })}>Keep my original booking</button>
            </>
          )}
        </div>
      ))}
      {(sla?.corrections || []).filter((c) => c.status !== "withdrawn").map((c) => (
        <p key={c.id} className={c.status === "responded" ? "msm-adp__help" : "msm-adp__err"} role={c.status === "responded" ? undefined : "alert"}>{correctionText(c)}</p>
      ))}
      {versions.length > 0 && (
        <ul className="msm-adp__help">
          {versions.map((v) => (
            <li key={v.id}>Version {v.version_no}: {v.status}{v.status === "submitted" && v.review_due_before ? ` - review due by ${formatDeadline(v.review_due_before)}` : ""}
              {v.rejection_reason ? ` - MSM note: ${v.rejection_reason}` : ""}</li>
          ))}
        </ul>
      )}
      {open && !ended && campaign && <CreativeForm booking={booking} campaign={campaign} advertiserId={advertiserId} spec={spec} onSubmitted={onChange} />}
      {booking.status === "confirmed" && <ReportBox booking={booking} />}
      {error && <p className="msm-adp__err" role="alert">{error}</p>}
    </article>
  );
}

export default function AdvertiserPortal({ user, logo }) {
  const [flags, setFlags] = useState(null);
  const [advertiser, setAdvertiser] = useState(undefined);
  const [products, setProducts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [slaById, setSlaById] = useState({});
  const [confirmations, setConfirmations] = useState({});
  const [amendmentsById, setAmendmentsById] = useState({});
  const [loadError, setLoadError] = useState("");
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const returned = params.get("checkout") === "returned";

  const refresh = useCallback(async () => {
    try {
      const f = await ads.getFlags();
      setFlags(f);
      if (!f.portal || !user?.id) return;
      const adv = await ads.getMyAdvertiser(user.id);
      setAdvertiser(adv);
      setProducts((await ads.listProducts()).filter((p) => p.active));
      if (adv) {
        const list = await ads.listBookings();
        setBookings(list);
        const paid = list.filter((b) => b.status === "confirmed").map((b) => b.id);
        setConfirmations(await ads.listConfirmations(paid));
        setAmendmentsById(await ads.listAmendments(paid).catch(() => ({})));
        const slas = await Promise.all(paid.map((id) => ads.reviewSla(id).catch(() => null)));
        setSlaById(Object.fromEntries(paid.map((id, i) => [id, slas[i]])));
      }
    } catch (e) {
      setLoadError(friendlyAdsError(e));
    }
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // After returning from Stripe, re-read for up to 2 minutes; only the
  // verified webhook can move the booking to Paid.
  useEffect(() => {
    if (!returned) return undefined;
    let n = 0;
    const t = setInterval(() => { n += 1; refresh(); if (n >= 24) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [returned, refresh]);

  const specByCode = useMemo(() => {
    const m = {};
    for (const p of products) for (const pu of p.ad_product_units || []) if (pu.ad_inventory_units) m[pu.ad_inventory_units.code] = pu.ad_inventory_units;
    return m;
  }, [products]);
  const anyTest = products.some((p) => p.is_test) || bookings.some((b) => b.is_test);

  return (
    <div className="msm-adp">
      <style>{css}</style>
      <div className="msm-adp__wrap">
        {logo}
        <h1>Advertise with Music Scene Magazine</h1>
        {flags && !flags.portal && <p>Advertising bookings are not open yet.</p>}
        {flags?.portal && (
          <>
            {anyTest && <p className="msm-adp__test" role="note">TEST MODE: prices are placeholders and payments use Stripe test mode. No real money is taken.</p>}
            {returned && <p className="msm-adp__card" role="status">Thanks. We are waiting for Stripe to confirm your payment - this page updates automatically. Returning here is not itself a payment confirmation.</p>}
            {loadError && <p className="msm-adp__err" role="alert">{loadError}</p>}
            {advertiser === null && <ProfileForm onCreated={(a) => { setAdvertiser(a); refresh(); }} />}
            {advertiser && products.length > 0 && <NewBooking products={products} onHeld={refresh} />}
            {advertiser && products.length === 0 && <p className="msm-adp__help">No positions are on sale right now.</p>}
            {advertiser && bookings.map((b) => (
              <BookingCard key={b.id} booking={b} advertiserId={advertiser.id} flags={flags} specByCode={specByCode}
                sla={slaById[b.id]} confirmation={confirmations[b.id]} amendments={amendmentsById[b.id]} onChange={refresh} />
            ))}
            <p className="msm-adp__help">Every advert is reviewed by MSM before it appears. Standard review: by the end of the next UK working day after payment has cleared and complete artwork/link are received (optional priority review, when offered: within 12 elapsed hours). Approval is not guaranteed.</p>
          </>
        )}
      </div>
    </div>
  );
}
