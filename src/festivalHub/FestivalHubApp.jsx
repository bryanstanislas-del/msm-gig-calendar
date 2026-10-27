// Festival Hub UI.
//
// Self-contained: imports only React and modules in this folder. It must
// never import the calendar (App.jsx) or any backend client -- see
// isolation.test.js. Listings come from git-curated data (curatedListings.js)
// or, only behind the explicit ?demo=1 toggle, from demoFixtures.js; the two
// are never shown together (listings.js). The shortlist and progress live in
// this browser only, with a separate store per mode (storage.js).
//
// The open listing is kept in the URL hash (#festival=<id>) so it can be
// linked and the back button closes it; no server routing is involved.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { C, F, LOGO_SRC, LOGO_CROP } from "./theme.js";
import { DEMO_DATA_NOTICE } from "./demoFixtures.js";
import { MODES, getDirectory, modeFromSearch } from "./listings.js";
import { HUB_EDITION_YEAR, PERFORMER_PAY, ALL_GENRES } from "./constants.js";
import { STATUS, STATUS_LABEL, applicationStatus, deadlineOf, deadlineSummary, formatDeadline, formatDateOnly } from "./status.js";
import { ALL, DEFAULT_FILTERS, DEADLINE_OPTIONS, applyFilters, genresOf, isDefaultFilters, regionsOf } from "./filters.js";
import { CHECKLIST, OUTCOMES, STAGES, STORAGE_KEYS, checklistProgress, emptyEntry, isValidId, loadSaved, persistSaved } from "./storage.js";
import { ctaLinks } from "./cta.js";
import { CALENDAR_LINKS, LIVE_LINK_NOTE, MSM_BENEFITS, NO_AUTO_SUBMIT, NO_GUARANTEE, OPEN_RECHECK_NOTE, PREP_TIPS, STORAGE_NOTE } from "./copy.js";

const HASH_PREFIX = "#festival=";

function readHashId() {
  const h = window.location.hash;
  if (!h.startsWith(HASH_PREFIX)) return null;
  let id;
  try { id = decodeURIComponent(h.slice(HASH_PREFIX.length)); } catch { return ""; }
  return isValidId(id) ? id : "";
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px}
body{background:${C.bg};color:${C.white};font-family:${F.body};line-height:1.5;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
a{color:${C.white}}
:focus-visible{outline:3px solid ${C.red};outline-offset:2px}
.fh-skip{position:absolute;left:-9999px;top:8px;background:${C.redFill};color:#fff;padding:8px 14px;z-index:20;border-radius:4px}
.fh-skip:focus{left:8px}
.fh-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 24px;border-bottom:1px solid ${C.borderStrong};background:#0a0a0a;flex-wrap:wrap}
.fh-brand{display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit}
.fh-title{font-family:${F.display};letter-spacing:3px;font-size:28px;line-height:1}
.fh-title span{color:${C.red}}
.fh-nav{display:flex;gap:10px;flex-wrap:wrap}
.fh-staging{background:#fff;color:#000;padding:6px 24px;font-weight:600;font-size:13px}
.fh-banner{background:${C.redFill};color:#fff;padding:10px 24px;font-weight:600;font-size:14px}
.fh-banner-real{background:${C.surfaceHigh};color:#fff;border-bottom:1px solid ${C.borderStrong};font-weight:500}
.fh-banner a{color:#fff}
.fh-main{max-width:1200px;margin:0 auto;padding:24px}
.fh-intro h1{font-family:${F.display};letter-spacing:2px;font-size:clamp(32px,6vw,52px);line-height:1;margin-bottom:10px}
.fh-intro p{color:${C.muted};max-width:760px}
.fh-section{margin-top:28px}
.fh-section h2{font-family:${F.display};letter-spacing:2px;font-weight:400;font-size:28px;margin-bottom:8px}
.fh-benefits{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:16px 0 8px}
.fh-benefit{border:1px solid ${C.borderStrong};border-radius:8px;padding:14px 16px;background:${C.surface}}
.fh-benefit h3{font-family:${F.display};letter-spacing:1.5px;font-size:20px;font-weight:400}
.fh-benefit p{color:${C.muted};font-size:14px}
.fh-small{color:${C.muted};font-size:13px}
.fh-btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:10px 18px;border-radius:5px;border:1px solid ${C.borderStrong};background:transparent;color:${C.white};font-family:${F.display};letter-spacing:2px;font-size:16px;cursor:pointer;text-decoration:none;text-align:center}
.fh-btn:hover{border-color:${C.red}}
.fh-btn-primary{background:${C.redFill};border-color:${C.redFill};color:#fff}
.fh-btn-primary:hover{background:#c91a31}
.fh-btn small{font-family:${F.body};letter-spacing:0;font-size:12px;opacity:.85}
.fh-filters{display:grid;grid-template-columns:2fr repeat(4,1fr);gap:12px;align-items:end;margin:28px 0 12px;padding:16px;border:1px solid ${C.borderStrong};border-radius:8px;background:${C.surface}}
.fh-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.fh-field label,.fh-legend{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted}}
.fh-input{width:100%;min-height:44px;padding:10px 12px;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.2);border-radius:5px;color:#fff;font-size:16px;font-family:${F.body}}
select.fh-input option{background:#111;color:#fff}
.fh-input::placeholder{color:${C.placeholder};opacity:1}
.fh-filter-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;grid-column:1/-1}
.fh-check{display:inline-flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.fh-check input{width:20px;height:20px;accent-color:${C.red}}
.fh-count{margin:8px 0 16px;color:${C.muted}}
.fh-grid{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.fh-card{display:flex;flex-direction:column;gap:8px;height:100%;padding:16px;border:1px solid ${C.borderStrong};border-radius:8px;background:${C.surface};color:inherit;text-decoration:none}
.fh-card:hover{border-color:${C.red}}
.fh-card h3{font-family:${F.display};font-weight:400;letter-spacing:1.5px;font-size:24px;line-height:1.1}
.fh-meta{color:${C.muted};font-size:14px}
.fh-badges{display:flex;gap:6px;flex-wrap:wrap}
.fh-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;border:1px solid ${C.borderStrong};color:${C.white}}
.fh-badge-demo{border-color:${C.red};color:${C.redTextOnDark}}
.fh-badge-unpaid{border-color:#fff;background:#fff;color:#000}
.fh-st-open{background:${C.redFill};border-color:${C.redFill};color:#fff}
.fh-st-not-yet-open,.fh-st-not-yet-announced{border-color:#fff}
.fh-st-closed{color:${C.dim}}
.fh-st-unverified{border-style:dashed;border-color:#fff}
.fh-chip{font-size:12px;color:${C.muted};border:1px solid ${C.border};border-radius:12px;padding:1px 8px}
.fh-saved{font-size:13px;color:#fff}
.fh-empty{padding:32px;text-align:center;border:1px dashed ${C.borderStrong};border-radius:8px}
.fh-empty p{margin-bottom:12px;color:${C.muted}}
.fh-notice{margin:12px 0;padding:10px 14px;border:1px solid ${C.red};border-left-width:6px;border-radius:5px;background:rgba(232,32,58,0.12)}
.fh-note{margin:12px 0;padding:10px 14px;border:1px solid ${C.borderStrong};border-left:6px solid #fff;border-radius:5px;font-size:14px}
.fh-dialog{width:min(780px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:0;border:1px solid ${C.borderStrong};border-radius:10px;background:${C.surface};color:${C.white}}
.fh-dialog::backdrop{background:rgba(0,0,0,0.75)}
.fh-dialog-inner{padding:20px 22px 24px}
.fh-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.fh-dialog h2{font-family:${F.display};font-weight:400;letter-spacing:2px;font-size:32px;line-height:1.05}
.fh-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:16px 0}
.fh-dl dt{color:${C.muted};font-size:13px;text-transform:uppercase;letter-spacing:1px;padding-top:2px}
.fh-unknown{color:${C.muted};font-style:italic}
.fh-quote{display:block;color:${C.muted};font-size:14px}
.fh-actions{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.fh-panel{margin-top:18px;padding-top:16px;border-top:1px solid ${C.borderStrong}}
.fh-panel h3{font-family:${F.display};letter-spacing:2px;font-weight:400;font-size:22px;margin-bottom:8px}
.fh-sources{list-style:none;display:flex;flex-direction:column;gap:10px;font-size:14px}
.fh-sources a{word-break:break-word}
.fh-tips{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px}
.fh-tips li{border:1px solid ${C.borderStrong};border-radius:8px;padding:12px 14px;background:${C.surface}}
.fh-tips strong{display:block;font-family:${F.display};font-weight:400;letter-spacing:1.5px;font-size:19px}
.fh-tips span{color:${C.muted};font-size:14px}
.fh-checklist{list-style:none;display:flex;flex-direction:column;gap:6px}
.fh-checklist label{display:flex;gap:10px;align-items:flex-start;cursor:pointer;min-height:44px;padding-top:8px}
.fh-checklist input{width:20px;height:20px;margin-top:2px;flex-shrink:0;accent-color:${C.red}}
.fh-checklist span span{display:block;color:${C.muted};font-size:13px}
.fh-footer{max-width:1200px;margin:24px auto 0;padding:24px;border-top:1px solid ${C.borderStrong};color:${C.muted};font-size:13px}
.fh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:860px){.fh-filters{grid-template-columns:1fr 1fr}.fh-field-search{grid-column:1/-1}}
@media (max-width:600px){
  .fh-header{padding:10px 16px}.fh-banner,.fh-staging{padding-left:16px;padding-right:16px}.fh-main{padding:16px}
  .fh-filters{grid-template-columns:1fr;padding:12px}
  .fh-dialog{width:100vw;max-width:100vw;max-height:100dvh;height:100dvh;border-radius:0}
  .fh-dl{grid-template-columns:1fr}.fh-dl dd{margin-bottom:6px}
}
`;

function Logo({ height = 44 }) {
  const scaled = height / LOGO_CROP.height;
  return (
    <span style={{ display: "block", height, width: scaled, overflow: "hidden", position: "relative", flexShrink: 0 }}>
      <img src={LOGO_SRC} alt="Music Scene Magazine" width={scaled} height={scaled}
        style={{ position: "absolute", top: -(LOGO_CROP.top * scaled), left: 0, display: "block" }} />
    </span>
  );
}

const Unknown = ({ children = "Not known" }) => <span className="fh-unknown">{children}</span>;
const NewTab = () => <span className="fh-sr"> (opens in a new tab)</span>;

function StatusBadge({ status }) {
  return <span className={`fh-badge fh-st-${status}`}>{STATUS_LABEL[status]}</span>;
}

const DemoBadge = () => <span className="fh-badge fh-badge-demo">Demo</span>;

function festivalDatesText(listing) {
  const s = formatDateOnly(listing.festivalDates?.start);
  const e = formatDateOnly(listing.festivalDates?.end);
  if (s) return e && e !== s ? `${s} – ${e}` : s;
  return listing.festivalDatesText || null;
}

const PAY_LABEL = {
  [PERFORMER_PAY.PAID]: "Paid",
  [PERFORMER_PAY.UNPAID]: "Unpaid",
  [PERFORMER_PAY.NEGOTIATED]: "Negotiated",
  [PERFORMER_PAY.NOT_STATED]: "Not stated",
};

function genresText(listing) {
  const g = listing.genres || [];
  if (!g.length) return null;
  return g.includes(ALL_GENRES) ? "All genres (per the festival)" : g.join(", ");
}

function Filters({ filters, setFilter, regions, genres, onReset }) {
  const id = useId();
  return (
    <form className="fh-filters" role="search" aria-label="Filter festival listings" onSubmit={(e) => e.preventDefault()}>
      <div className="fh-field fh-field-search">
        <label htmlFor={`${id}-q`}>Search</label>
        <input id={`${id}-q`} className="fh-input" type="search" value={filters.search} placeholder="Festival, place or genre"
          onChange={(e) => setFilter("search", e.target.value)} />
      </div>
      <div className="fh-field">
        <label htmlFor={`${id}-region`}>Region</label>
        <select id={`${id}-region`} className="fh-input" value={filters.region} onChange={(e) => setFilter("region", e.target.value)}>
          <option value={ALL}>All regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="fh-field">
        <label htmlFor={`${id}-genre`}>Genre</label>
        <select id={`${id}-genre`} className="fh-input" value={filters.genre} onChange={(e) => setFilter("genre", e.target.value)}>
          <option value={ALL}>Any genre</option>
          {genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="fh-field">
        <label htmlFor={`${id}-deadline`}>Deadline</label>
        <select id={`${id}-deadline`} className="fh-input" value={filters.deadline} onChange={(e) => setFilter("deadline", e.target.value)}>
          {DEADLINE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="fh-field">
        <label htmlFor={`${id}-status`}>Status</label>
        <select id={`${id}-status`} className="fh-input" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value={ALL}>Any status</option>
          {Object.values(STATUS).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="fh-filter-row">
        <label className="fh-check">
          <input type="checkbox" checked={filters.savedOnly} onChange={(e) => setFilter("savedOnly", e.target.checked)} />
          Shortlist only
        </label>
        <button type="button" className="fh-btn" onClick={onReset} disabled={isDefaultFilters(filters)}>Reset filters</button>
      </div>
      <p className="fh-small" style={{ gridColumn: "1/-1" }}>Genre filters also include festivals that say they welcome all genres. Deadline filters only match open listings with a published deadline.</p>
    </form>
  );
}

function ListingCard({ listing, info, entry, demo }) {
  const dates = festivalDatesText(listing);
  const genres = genresText(listing);
  return (
    <a className="fh-card" href={`${HASH_PREFIX}${encodeURIComponent(listing.id)}`}>
      <div className="fh-badges">
        {demo && <DemoBadge />}
        <StatusBadge status={info.status} />
        {listing.performerPay?.status === PERFORMER_PAY.UNPAID && <span className="fh-badge fh-badge-unpaid">Unpaid slot</span>}
      </div>
      <h3>{listing.name}</h3>
      <div className="fh-meta">{[listing.region, listing.location].filter(Boolean).join(" · ")}</div>
      <div className="fh-meta">{dates ? `${HUB_EDITION_YEAR}: ${dates}` : `${HUB_EDITION_YEAR} dates not confirmed`}</div>
      <div>{deadlineSummary(info, listing)}</div>
      <div className="fh-badges">
        {genres ? (listing.genres || []).map((g) => <span key={g} className="fh-chip">{g}</span>) : <span className="fh-chip">Genres not specified</span>}
      </div>
      {entry && (
        <div className="fh-saved">★ On your shortlist · {STAGES.find((s) => s.value === entry.stage)?.label}</div>
      )}
    </a>
  );
}

function SourceItem({ label, v }) {
  if (!v || !v.sourceUrl) return <li><strong>{label}:</strong> <Unknown>not checked yet</Unknown></li>;
  return (
    <li>
      <strong>{label}</strong> — checked {formatDateOnly(v.checkedDate)}
      {v.sourcePublishedDate && <> (source page dated {formatDateOnly(v.sourcePublishedDate)})</>}
      <span className="fh-quote">{v.evidence}</span>
      <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer">{v.sourceUrl}<NewTab /></a>
      {(v.extraSourceUrls || []).map((u) => (
        <span key={u} style={{ display: "block" }}>Also: <a href={u} target="_blank" rel="noopener noreferrer">{u}<NewTab /></a></span>
      ))}
    </li>
  );
}

function DetailDialog({ listing, missing, info, entry, demo, storageProblem, saveStatus, onClose, onToggleSave, onUpdate }) {
  const ref = useRef(null);
  // A storage warning already present when the dialog opened is shown as
  // plain text; one that appears while it is open is announced (role=alert).
  const [problemAtOpen] = useState(storageProblem);
  const writeProblem = storageProblem === "failed" || storageProblem === "unavailable" ? storageProblem : null;
  const headingId = useId();
  const stageId = useId();
  const outcomeId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  const progress = entry ? checklistProgress(entry) : null;
  const ap = listing?.application || {};
  const lv = listing?.listingVerification || {};
  const deadline = listing ? deadlineOf(listing) : null;
  const pay = listing?.performerPay;

  return (
    <dialog ref={ref} className="fh-dialog" aria-labelledby={headingId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="fh-dialog-inner">
        <div className="fh-dialog-head">
          <h2 id={headingId}>{missing ? "Listing not found" : listing.name}</h2>
          <button type="button" className="fh-btn" onClick={onClose} autoFocus>Close<span className="fh-sr"> details</span></button>
        </div>
        {missing ? (
          <p className="fh-small" style={{ marginTop: 12 }}>That link doesn't match any listing in this {demo ? "demo" : "directory"}.</p>
        ) : (
          <>
            <div className="fh-badges" style={{ marginTop: 10 }}>{demo && <DemoBadge />}<StatusBadge status={info.status} /></div>
            <p style={{ marginTop: 8 }}>{info.reason}</p>
            {demo && <p className="fh-small">{DEMO_DATA_NOTICE}</p>}
            {info.status === STATUS.OPEN && (
              <div className="fh-note" role="note">
                Open as checked on {formatDateOnly(ap.checkedDate)}. {OPEN_RECHECK_NOTE}
              </div>
            )}
            <dl className="fh-dl">
              <dt>Edition</dt>
              <dd>{HUB_EDITION_YEAR} — {lv.editionConfirmed ? "confirmed on an official source" : <Unknown>not yet confirmed</Unknown>}</dd>
              <dt>Festival dates</dt><dd>{festivalDatesText(listing) || <Unknown>Not announced / not known</Unknown>}</dd>
              <dt>Location</dt><dd>{listing.location ? `${listing.location}, ${listing.region}` : <>{listing.region} · <Unknown>exact location not known</Unknown></>}</dd>
              <dt>Genres</dt><dd>{genresText(listing) || <Unknown>Not specified</Unknown>}</dd>
              <dt>Applications open</dt>
              <dd>{formatDateOnly(ap.opens) ? `${formatDateOnly(ap.opens)}${ap.yearInferred ? " (year inferred)" : ""}` : <Unknown>Not published</Unknown>}</dd>
              <dt>Deadline</dt>
              <dd>
                {deadline ? formatDeadline(deadline) : ap.noPublishedDeadline ? "No deadline published — the festival could close applications at any time." : <Unknown>Not known</Unknown>}
                {ap.closesText && <span className="fh-quote">Source wording: “{ap.closesText}”</span>}
                {deadline?.yearInferred && <span className="fh-quote">The source doesn't state the year; MSM inferred it from the page context.</span>}
              </dd>
              <dt>Eligibility</dt><dd>{listing.eligibility || <Unknown />}</dd>
              <dt>Application fee</dt><dd>{listing.applicationFee || <Unknown />}</dd>
              <dt>Performer pay</dt>
              <dd>{pay ? <>{PAY_LABEL[pay.status]}{pay.note ? ` — ${pay.note}` : ""}</> : <Unknown />}</dd>
              {(ap.instructions || ap.email) && <>
                <dt>How to apply</dt>
                <dd>
                  {ap.instructions}
                  {ap.email && <span className="fh-quote">Published address (copy it into your own email — the hub sends nothing): <strong style={{ color: "#fff" }}>{ap.email}</strong></span>}
                </dd>
              </>}
            </dl>

            {pay?.status === PERFORMER_PAY.UNPAID && (
              <div className="fh-notice" role="note"><strong>Unpaid performance.</strong> {pay.note || "This festival does not pay performers."} This is not an application fee.</div>
            )}
            <div className="fh-actions">
              {ctaLinks(listing, info, demo).map((l) => (
                <a key={l.href + l.label} className={`fh-btn${l.primary ? " fh-btn-primary" : ""}`} href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.label} ↗<NewTab />
                </a>
              ))}
              <button type="button" className="fh-btn" onClick={onToggleSave}>
                {entry ? "★ Remove from shortlist" : "☆ Save to shortlist"}
              </button>
            </div>
            {writeProblem && (
              <div className="fh-notice" role={writeProblem !== problemAtOpen ? "alert" : undefined}>{DIALOG_STORAGE_WARNINGS[writeProblem]}</div>
            )}
            <p className="fh-small" role="status" aria-live="polite">{saveStatus}</p>
            <p className="fh-small">{NO_AUTO_SUBMIT}</p>

            <section className="fh-panel" aria-label="Sources">
              <h3>Sources</h3>
              <ul className="fh-sources">
                <SourceItem label="Festival & edition" v={lv.status === "verified" ? lv : null} />
                <SourceItem label={`${HUB_EDITION_YEAR} application window`} v={ap.sourceUrl ? ap : null} />
              </ul>
            </section>

            {entry && (
              <section className="fh-panel" aria-label="Your application progress">
                <h3>Your progress</h3>
                <div className="fh-filters" style={{ margin: "0 0 12px", gridTemplateColumns: "1fr 1fr" }}>
                  <div className="fh-field">
                    <label htmlFor={stageId}>Stage</label>
                    <select id={stageId} className="fh-input" value={entry.stage} onChange={(e) => onUpdate({ stage: e.target.value })}>
                      {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  {entry.stage === "outcome" && (
                    <div className="fh-field">
                      <label htmlFor={outcomeId}>Outcome</label>
                      <select id={outcomeId} className="fh-input" value={entry.outcome} onChange={(e) => onUpdate({ outcome: e.target.value })}>
                        {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <fieldset style={{ border: 0 }}>
                  <legend className="fh-legend">Application checklist · {progress.done} of {progress.total} ready</legend>
                  <ul className="fh-checklist">
                    {CHECKLIST.map((c) => (
                      <li key={c.key}>
                        <label>
                          <input type="checkbox" checked={!!entry.checklist[c.key]}
                            onChange={(e) => onUpdate({ checklist: { ...entry.checklist, [c.key]: e.target.checked } })} />
                          <span>{c.label}<span>{c.hint}</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              </section>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}

// Shown inside the detail dialog (the page behind a modal dialog is hidden
// from view and from screen readers). Never claims the change was saved.
const DIALOG_STORAGE_WARNINGS = {
  failed: "Not saved. This browser couldn't store your shortlist, so this change is kept on this page only and will be lost when you reload or leave.",
  unavailable: "Saving isn't available in this browser. Shortlist changes are kept on this page only and will be lost when you reload or leave.",
};

const STORAGE_MESSAGES = {
  unavailable: "Saving isn't available in this browser (storage is blocked or full). Your shortlist will only last until you leave this page.",
  failed: "Your last change couldn't be saved in this browser (storage is blocked or full). It will be lost when you leave this page.",
  corrupt: "Some saved shortlist data in this browser couldn't be read and was ignored.",
};

function LiveLink({ href, children, primary }) {
  return (
    <a className={`fh-btn${primary ? " fh-btn-primary" : ""}`} href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗ <small>(live site)</small><span className="fh-sr"> — {LIVE_LINK_NOTE}, in a new tab</span>
    </a>
  );
}

export default function FestivalHubApp({ now: nowProp } = {}) {
  const now = useMemo(() => nowProp || new Date(), [nowProp]);
  const mode = useMemo(() => modeFromSearch(window.location.search), []);
  const demo = mode === MODES.DEMO;
  const { listings } = useMemo(() => getDirectory(mode), [mode]);
  const storageKey = STORAGE_KEYS[mode];
  const knownIds = useMemo(() => new Set(listings.map((l) => l.id)), [listings]);
  const [{ items: initialSaved, problem: initialProblem }] = useState(() => loadSaved(window, knownIds, storageKey));
  const [saved, setSaved] = useState(initialSaved);
  const [storageProblem, setStorageProblem] = useState(initialProblem);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [openId, setOpenId] = useState(() => readHashId());
  const [saveStatus, setSaveStatus] = useState("");
  const lastTrigger = useRef(null);
  const focusResultsAfterReset = useRef(false);

  useEffect(() => {
    const onHash = () => setOpenId(readHashId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value })), []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);
  // The empty state's reset button disappears once results return, so move
  // focus to the results region after that render (next Tab: first card).
  const resetFromEmptyState = useCallback(() => { focusResultsAfterReset.current = true; resetFilters(); }, [resetFilters]);
  useEffect(() => {
    if (!focusResultsAfterReset.current) return;
    focusResultsAfterReset.current = false;
    document.getElementById("fh-results")?.focus();
  }, [filters]);

  const regions = useMemo(() => regionsOf(listings), [listings]);
  const genres = useMemo(() => genresOf(listings), [listings]);
  const savedIds = useMemo(() => new Set(Object.keys(saved)), [saved]);
  const results = useMemo(() => applyFilters(listings, filters, { now, savedIds }), [listings, filters, now, savedIds]);
  const openCount = useMemo(() => listings.filter((l) => applicationStatus(l, now).status === STATUS.OPEN).length, [listings, now]);

  // Returns whether the change was written to this browser's storage.
  const commit = useCallback((next) => {
    setSaved(next);
    const ok = persistSaved(next, window, storageKey);
    setStorageProblem((p) => (ok ? (p === "corrupt" ? "corrupt" : null) : (p === "unavailable" ? "unavailable" : "failed")));
    return ok;
  }, [storageKey]);

  useEffect(() => { setSaveStatus(""); }, [openId]);

  const openListing = openId ? listings.find((l) => l.id === openId) : null;

  const closeDetail = useCallback(() => {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setOpenId(null);
  }, []);

  // Return focus once the modal has actually gone (focusing outside an open
  // modal dialog is ignored), whether it was closed by a button, Escape or
  // the browser's back button.
  const wasOpen = useRef(openId !== null);
  useEffect(() => {
    if (openId !== null) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = lastTrigger.current;
    if (el && document.contains(el)) el.focus();
    else document.getElementById("fh-results")?.focus();
  }, [openId]);

  const toggleSave = () => {
    if (!openListing) return;
    const removing = !!saved[openListing.id];
    const next = { ...saved };
    if (removing) delete next[openListing.id];
    else next[openListing.id] = emptyEntry();
    const warningAlreadyShown = storageProblem === "failed" || storageProblem === "unavailable";
    const ok = commit(next);
    // Polite status for the outcome. On a NEW write failure the dialog's
    // role=alert warning announces it instead, so nothing is said twice.
    if (ok) setSaveStatus(removing ? "Removed from your shortlist in this browser." : "Saved to your shortlist in this browser.");
    else if (warningAlreadyShown) setSaveStatus(removing ? "Removed on this page only — not saved, so it may reappear when you reload." : "Added on this page only — not saved, so it will be lost when you reload.");
    else setSaveStatus("");
  };
  const updateEntry = (patch) => {
    if (!openListing || !saved[openListing.id]) return;
    commit({ ...saved, [openListing.id]: { ...saved[openListing.id], ...patch } });
  };

  const path = window.location.pathname;
  const otherModeHref = demo ? path : `${path}?demo=1`;
  const noun = demo ? "demo listing" : "listing";

  return (
    <>
      <style>{CSS}</style>
      <a className="fh-skip" href="#fh-results">Skip to listings</a>
      <header className="fh-header">
        <span className="fh-brand">
          <Logo />
          <span className="fh-title">Festival <span>Hub</span></span>
        </span>
        <nav className="fh-nav" aria-label="MSM live calendar">
          <LiveLink href={CALENDAR_LINKS.calendar}>Gig calendar</LiveLink>
          <LiveLink href={CALENDAR_LINKS.claim}>Claim a profile</LiveLink>
        </nav>
      </header>
      <div className="fh-staging" role="note">Staging preview — not public and not indexed. Calendar links open the live MSM site.</div>
      {demo ? (
        <div className="fh-banner" role="note">
          {DEMO_DATA_NOTICE} <a href={otherModeHref}>Back to the real directory</a>
        </div>
      ) : (
        <div className="fh-banner fh-banner-real" role="note">
          Listings are checked against official festival sources on the dates shown. Statuses can change at any time — always confirm on the festival's own site.
        </div>
      )}

      <main className="fh-main" onClickCapture={(e) => {
        const a = e.target.closest && e.target.closest("a.fh-card");
        if (a) lastTrigger.current = a;
      }} onKeyDownCapture={(e) => {
        const a = e.target.closest && e.target.closest("a.fh-card");
        if (a) lastTrigger.current = a;
      }}>
        <section className="fh-intro" aria-labelledby="fh-h1">
          <h1 id="fh-h1">Festival Hub {HUB_EDITION_YEAR}{demo && <span style={{ color: C.red }}> · Demo</span>}</h1>
          <p>UK festival application windows for grassroots bands, checked against each festival's own site. Shortlist the ones that fit and track your applications — you always apply directly to the festival.</p>
        </section>

        {storageProblem && (
          // Announced only while no modal is open; the dialog carries its own warning.
          <div className="fh-notice" role={openId === null ? "alert" : undefined}>{STORAGE_MESSAGES[storageProblem]}</div>
        )}

        <h2 className="fh-sr">Festival listings</h2>
        {listings.length === 0 ? (
          <div className="fh-empty" id="fh-results" tabIndex={-1} style={{ marginTop: 24 }}>
            <p><strong style={{ color: "#fff" }}>No verified listings yet.</strong> MSM is checking 2027 festival application windows against official sources. Listings appear here only once checked.</p>
            {!demo && <a className="fh-btn" href={otherModeHref}>Preview the hub with demo data</a>}
          </div>
        ) : (
          <>
            <Filters filters={filters} setFilter={setFilter} regions={regions} genres={genres} onReset={resetFilters} />
            <p className="fh-count" role="status" aria-live="polite">
              {isDefaultFilters(filters)
                ? `${listings.length} ${noun}s · ${openCount} open now`
                : `Showing ${results.length} of ${listings.length} ${noun}s`}
              {savedIds.size ? ` · ${savedIds.size} on your shortlist` : ""}
            </p>
            <div id="fh-results" tabIndex={-1}>
              {results.length === 0 ? (
                <div className="fh-empty">
                  <p>{filters.savedOnly && savedIds.size === 0 ? "Your shortlist is empty. Open a listing and choose “Save to shortlist”." : `No ${noun}s match these filters.`}</p>
                  <button type="button" className="fh-btn fh-btn-primary" onClick={resetFromEmptyState}>Reset filters</button>
                </div>
              ) : (
                <ul className="fh-grid" aria-label="Festival listings">
                  {results.map(({ listing, info }) => (
                    <li key={listing.id}><ListingCard listing={listing} info={info} entry={saved[listing.id]} demo={demo} /></li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <section className="fh-section" aria-labelledby="fh-prep">
          <h2 id="fh-prep">Before you apply</h2>
          <ul className="fh-tips">
            {PREP_TIPS.map((t) => <li key={t.title}><strong>{t.title}</strong><span>{t.body}</span></li>)}
          </ul>
          <p className="fh-small" style={{ marginTop: 10 }}>Save a listing to track your stage and tick off: {CHECKLIST.map((c) => c.label).join(", ")}.</p>
        </section>

        <section className="fh-section" aria-labelledby="fh-msm">
          <h2 id="fh-msm">Get your act on the MSM Gig Calendar</h2>
          <div className="fh-benefits">
            {MSM_BENEFITS.map((b) => (
              <div className="fh-benefit" key={b.title}><h3>{b.title}</h3><p>{b.body}</p></div>
            ))}
          </div>
          <div className="fh-actions">
            <LiveLink href={CALENDAR_LINKS.calendar} primary>Register or add gigs</LiveLink>
            <LiveLink href={CALENDAR_LINKS.claim}>Claim your artist profile</LiveLink>
          </div>
          <p className="fh-small">These buttons open the existing live MSM Gig Calendar. There, use “Login / Register” to create a free artist account, then “Submit gig” to add dates. {NO_GUARANTEE}</p>
        </section>
      </main>

      <footer className="fh-footer">
        <p>{STORAGE_NOTE} {demo ? "Demo progress is stored separately from the real directory." : ""}</p>
        <p style={{ marginTop: 6 }}>Deadlines are shown in UK time. Where a festival gives only a date, the closing time isn't known — apply earlier.</p>
        <p style={{ marginTop: 6 }}>
          {demo ? <a href={otherModeHref}>Back to the real directory</a> : <a href={otherModeHref}>View the demo (fictional example listings)</a>}
        </p>
      </footer>

      {openId !== null && (
        <DetailDialog
          key={openId}
          listing={openListing}
          missing={!openListing}
          info={openListing ? applicationStatus(openListing, now) : null}
          entry={openListing ? saved[openListing.id] : null}
          demo={demo}
          storageProblem={storageProblem}
          saveStatus={saveStatus}
          onClose={closeDetail}
          onToggleSave={toggleSave}
          onUpdate={updateEntry}
        />
      )}
    </>
  );
}
