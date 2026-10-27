// Festival Hub -- demo MVP UI.
//
// Self-contained: imports only React and modules in this folder. It must
// never import the calendar (App.jsx) or any backend client -- see
// isolation.test.js. Data comes from demoFixtures.js; the shortlist and
// progress live in this browser only (storage.js).
//
// The open listing is kept in the URL hash (#festival=<id>) so it can be
// linked and the back button closes it; no server routing is involved.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { C, F, LOGO_SRC, LOGO_CROP } from "./theme.js";
import { DEMO_LISTINGS, DEMO_DATA_NOTICE } from "./demoFixtures.js";
import { STATUS, STATUS_LABEL, applicationStatus, deadlineSummary, formatDateOnly, londonDateOf } from "./status.js";
import { ALL, DEFAULT_FILTERS, DEADLINE_OPTIONS, applyFilters, genresOf, isDefaultFilters, regionsOf } from "./filters.js";
import { CHECKLIST, OUTCOMES, STAGES, checklistProgress, emptyEntry, isValidId, loadSaved, persistSaved } from "./storage.js";
import { CALENDAR_LINKS, MSM_BENEFITS, NO_AUTO_SUBMIT, NO_GUARANTEE, STORAGE_NOTE } from "./copy.js";

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
.fh-skip{position:absolute;left:-9999px;top:8px;background:${C.red};color:#fff;padding:8px 14px;z-index:20;border-radius:4px}
.fh-skip:focus{left:8px}
.fh-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 24px;border-bottom:1px solid ${C.borderStrong};background:#0a0a0a;flex-wrap:wrap}
.fh-brand{display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit}
.fh-title{font-family:${F.display};letter-spacing:3px;font-size:28px;line-height:1}
.fh-title span{color:${C.red}}
.fh-nav{display:flex;gap:10px;flex-wrap:wrap}
.fh-banner{background:${C.red};color:#fff;padding:10px 24px;font-weight:600;font-size:14px}
.fh-main{max-width:1200px;margin:0 auto;padding:24px}
.fh-intro h1{font-family:${F.display};letter-spacing:2px;font-size:clamp(32px,6vw,52px);line-height:1;margin-bottom:10px}
.fh-intro p{color:${C.muted};max-width:760px}
.fh-section-label{font-family:${F.display};letter-spacing:3px;color:${C.red};font-size:18px;margin-bottom:12px}
.fh-benefits{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:20px 0 8px}
.fh-benefit{border:1px solid ${C.borderStrong};border-radius:8px;padding:14px 16px;background:${C.surface}}
.fh-benefit h3{font-family:${F.display};letter-spacing:1.5px;font-size:20px;font-weight:400}
.fh-benefit p{color:${C.muted};font-size:14px}
.fh-small{color:${C.muted};font-size:13px}
.fh-btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:10px 18px;border-radius:5px;border:1px solid ${C.borderStrong};background:transparent;color:${C.white};font-family:${F.display};letter-spacing:2px;font-size:16px;cursor:pointer;text-decoration:none}
.fh-btn:hover{border-color:${C.red}}
.fh-btn-primary{background:${C.red};border-color:${C.red};color:#fff}
.fh-btn-primary:hover{background:#c91a31}
.fh-filters{display:grid;grid-template-columns:2fr repeat(4,1fr);gap:12px;align-items:end;margin:28px 0 12px;padding:16px;border:1px solid ${C.borderStrong};border-radius:8px;background:${C.surface}}
.fh-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.fh-field label,.fh-legend{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted}}
.fh-input{width:100%;min-height:44px;padding:10px 12px;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.2);border-radius:5px;color:#fff;font-size:16px;font-family:${F.body}}
select.fh-input option{background:#111;color:#fff}
.fh-filter-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;grid-column:1/-1}
.fh-check{display:inline-flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.fh-check input{width:20px;height:20px;accent-color:${C.red}}
.fh-count{margin:8px 0 16px;color:${C.muted}}
.fh-grid{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.fh-card{display:flex;flex-direction:column;gap:8px;height:100%;padding:16px;border:1px solid ${C.borderStrong};border-radius:8px;background:${C.surface};color:inherit;text-decoration:none}
.fh-card:hover{border-color:${C.red}}
.fh-card h2{font-family:${F.display};font-weight:400;letter-spacing:1.5px;font-size:24px;line-height:1.1}
.fh-meta{color:${C.muted};font-size:14px}
.fh-badges{display:flex;gap:6px;flex-wrap:wrap}
.fh-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;border:1px solid ${C.borderStrong};color:${C.white}}
.fh-badge-demo{border-color:${C.red};color:${C.red}}
.fh-st-open{background:${C.red};border-color:${C.red};color:#fff}
.fh-st-not-yet-open{border-color:#fff}
.fh-st-closed{color:${C.dim}}
.fh-st-unverified{border-style:dashed;border-color:#fff}
.fh-chip{font-size:12px;color:${C.muted};border:1px solid ${C.border};border-radius:12px;padding:1px 8px}
.fh-saved{font-size:13px;color:#fff}
.fh-empty{padding:32px;text-align:center;border:1px dashed ${C.borderStrong};border-radius:8px}
.fh-empty p{margin-bottom:12px;color:${C.muted}}
.fh-notice{margin:12px 0;padding:10px 14px;border:1px solid ${C.red};border-left-width:6px;border-radius:5px;background:rgba(232,32,58,0.12)}
.fh-dialog{width:min(760px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:0;border:1px solid ${C.borderStrong};border-radius:10px;background:${C.surface};color:${C.white}}
.fh-dialog::backdrop{background:rgba(0,0,0,0.75)}
.fh-dialog-inner{padding:20px 22px 24px}
.fh-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.fh-dialog h2{font-family:${F.display};font-weight:400;letter-spacing:2px;font-size:32px;line-height:1.05}
.fh-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:16px 0}
.fh-dl dt{color:${C.muted};font-size:13px;text-transform:uppercase;letter-spacing:1px;padding-top:2px}
.fh-actions{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.fh-panel{margin-top:18px;padding-top:16px;border-top:1px solid ${C.borderStrong}}
.fh-panel h3{font-family:${F.display};letter-spacing:2px;font-weight:400;font-size:22px;margin-bottom:8px}
.fh-checklist{list-style:none;display:flex;flex-direction:column;gap:6px}
.fh-checklist label{display:flex;gap:10px;align-items:flex-start;cursor:pointer;min-height:44px;padding-top:8px}
.fh-checklist input{width:20px;height:20px;margin-top:2px;flex-shrink:0;accent-color:${C.red}}
.fh-checklist span span{display:block;color:${C.muted};font-size:13px}
.fh-footer{max-width:1200px;margin:24px auto 0;padding:24px;border-top:1px solid ${C.borderStrong};color:${C.muted};font-size:13px}
.fh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:860px){.fh-filters{grid-template-columns:1fr 1fr}.fh-field-search{grid-column:1/-1}}
@media (max-width:600px){
  .fh-header{padding:10px 16px}.fh-banner{padding:10px 16px}.fh-main{padding:16px}
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

function StatusBadge({ status }) {
  return <span className={`fh-badge fh-st-${status}`}>{STATUS_LABEL[status]}</span>;
}

const DemoBadge = () => <span className="fh-badge fh-badge-demo">Demo</span>;

function festivalDatesText(listing) {
  const s = formatDateOnly(listing.festivalDates?.start);
  const e = formatDateOnly(listing.festivalDates?.end);
  if (!s) return "Dates not known";
  return e && e !== s ? `${s} – ${e}` : s;
}

function Filters({ filters, setFilter, regions, genres, onReset }) {
  const id = useId();
  return (
    <form className="fh-filters" role="search" aria-label="Filter festival listings" onSubmit={(e) => e.preventDefault()}>
      <div className="fh-field fh-field-search">
        <label htmlFor={`${id}-q`}>Search</label>
        <input id={`${id}-q`} className="fh-input" type="search" value={filters.search} placeholder="Festival, region or genre"
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
          <option value={ALL}>All genres</option>
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
    </form>
  );
}

function ListingCard({ listing, info, entry }) {
  return (
    <a className="fh-card" href={`${HASH_PREFIX}${encodeURIComponent(listing.id)}`}>
      <div className="fh-badges"><DemoBadge /><StatusBadge status={info.status} /></div>
      <h2>{listing.name}</h2>
      <div className="fh-meta">{listing.region} · {festivalDatesText(listing)}</div>
      <div>{deadlineSummary(info, listing)}</div>
      <div className="fh-badges">{(listing.genres || []).map((g) => <span key={g} className="fh-chip">{g}</span>)}</div>
      {entry && (
        <div className="fh-saved">
          ★ On your shortlist · {STAGES.find((s) => s.value === entry.stage)?.label}
        </div>
      )}
    </a>
  );
}

function DetailDialog({ listing, missing, info, entry, onClose, onToggleSave, onUpdate }) {
  const ref = useRef(null);
  const headingId = useId();
  const stageId = useId();
  const outcomeId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  const progress = entry ? checklistProgress(entry) : null;

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
          <p className="fh-small" style={{ marginTop: 12 }}>That link doesn't match any listing in the demo data.</p>
        ) : (
          <>
            <div className="fh-badges" style={{ marginTop: 10 }}><DemoBadge /><StatusBadge status={info.status} /></div>
            <p className="fh-small" style={{ marginTop: 8 }}>{info.reason} {DEMO_DATA_NOTICE}</p>
            <dl className="fh-dl">
              <dt>Festival dates</dt><dd>{festivalDatesText(listing)}</dd>
              <dt>Location</dt><dd>{listing.location}</dd>
              <dt>Genres</dt><dd>{(listing.genres || []).join(", ")}</dd>
              <dt>Applications</dt>
              <dd>
                {formatDateOnly(listing.application?.opens) ? `Open ${formatDateOnly(listing.application.opens)}` : "Opening date not known"}
                {" · "}
                {formatDateOnly(listing.application?.closes) ? `Deadline ${formatDateOnly(listing.application.closes)} (end of day, UK time)` : "Deadline not known"}
                <div>{deadlineSummary(info, listing)}</div>
              </dd>
              <dt>Eligibility</dt><dd>{listing.eligibility || "Not known"}</dd>
              <dt>Fees</dt><dd>{listing.fee || "Not known"}</dd>
              <dt>Source</dt>
              <dd>
                <a href={listing.sourceUrl} target="_blank" rel="noopener noreferrer">Example source link (demo, not a real page)<span className="fh-sr"> (opens in a new tab)</span></a>
              </dd>
              <dt>Last checked</dt><dd>{formatDateOnly(listing.lastChecked) || "Not checked"}</dd>
            </dl>
            <div className="fh-actions">
              <a className="fh-btn fh-btn-primary" href={listing.applyUrl} target="_blank" rel="noopener noreferrer">
                Example application link (demo)<span className="fh-sr"> — not a real opportunity, opens in a new tab</span>
              </a>
              <button type="button" className="fh-btn" onClick={onToggleSave}>
                {entry ? "★ Remove from shortlist" : "☆ Save to shortlist"}
              </button>
            </div>
            <p className="fh-small">{NO_AUTO_SUBMIT}</p>

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

const STORAGE_MESSAGES = {
  unavailable: "Saving isn't available in this browser (storage is blocked or full). Your shortlist will only last until you leave this page.",
  failed: "Your last change couldn't be saved in this browser (storage is blocked or full). It will be lost when you leave this page.",
  corrupt: "Some saved shortlist data in this browser couldn't be read and was ignored.",
};

export default function FestivalHubApp({ listings = DEMO_LISTINGS, today: todayProp } = {}) {
  const today = useMemo(() => todayProp || londonDateOf(), [todayProp]);
  const knownIds = useMemo(() => new Set(listings.map((l) => l.id)), [listings]);
  const [{ items: initialSaved, problem: initialProblem }] = useState(() => loadSaved(window, knownIds));
  const [saved, setSaved] = useState(initialSaved);
  const [storageProblem, setStorageProblem] = useState(initialProblem);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [openId, setOpenId] = useState(() => readHashId());
  const lastTrigger = useRef(null);

  useEffect(() => {
    const onHash = () => setOpenId(readHashId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value })), []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const regions = useMemo(() => regionsOf(listings), [listings]);
  const genres = useMemo(() => genresOf(listings), [listings]);
  const savedIds = useMemo(() => new Set(Object.keys(saved)), [saved]);
  const results = useMemo(() => applyFilters(listings, filters, { today, savedIds }), [listings, filters, today, savedIds]);

  const commit = useCallback((next) => {
    setSaved(next);
    const ok = persistSaved(next, window);
    setStorageProblem((p) => (ok ? (p === "corrupt" ? "corrupt" : null) : (p === "unavailable" ? "unavailable" : "failed")));
  }, []);

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
    const next = { ...saved };
    if (next[openListing.id]) delete next[openListing.id];
    else next[openListing.id] = emptyEntry();
    commit(next);
  };
  const updateEntry = (patch) => {
    if (!openListing || !saved[openListing.id]) return;
    commit({ ...saved, [openListing.id]: { ...saved[openListing.id], ...patch } });
  };

  return (
    <>
      <style>{CSS}</style>
      <a className="fh-skip" href="#fh-results">Skip to listings</a>
      <header className="fh-header">
        <a className="fh-brand" href={CALENDAR_LINKS.calendar} aria-label="Music Scene Magazine Gig Calendar home">
          <Logo />
          <span className="fh-title" aria-hidden="true">Festival <span>Hub</span></span>
        </a>
        <nav className="fh-nav" aria-label="MSM calendar">
          <a className="fh-btn" href={CALENDAR_LINKS.calendar}>Gig calendar</a>
          <a className="fh-btn" href={CALENDAR_LINKS.claim}>Claim a profile</a>
        </nav>
      </header>
      <div className="fh-banner" role="note">
        {DEMO_DATA_NOTICE} Real listings will only be added after checks against official festival sources.
      </div>

      <main className="fh-main" onClickCapture={(e) => {
        const a = e.target.closest && e.target.closest("a.fh-card");
        if (a) lastTrigger.current = a;
      }} onKeyDownCapture={(e) => {
        const a = e.target.closest && e.target.closest("a.fh-card");
        if (a) lastTrigger.current = a;
      }}>
        <section className="fh-intro" aria-labelledby="fh-h1">
          <h1 id="fh-h1">Festival Hub 2027 <span style={{ color: C.red }}>· Demo</span></h1>
          <p>Find UK festival application windows for grassroots bands, shortlist the ones that fit, and track your applications. You always apply directly to each festival.</p>
          <div className="fh-benefits">
            {MSM_BENEFITS.map((b) => (
              <div className="fh-benefit" key={b.title}><h3>{b.title}</h3><p>{b.body}</p></div>
            ))}
          </div>
          <div className="fh-actions">
            <a className="fh-btn fh-btn-primary" href={CALENDAR_LINKS.calendar}>Register or add gigs on the calendar</a>
            <a className="fh-btn" href={CALENDAR_LINKS.claim}>Claim your artist profile</a>
          </div>
          <p className="fh-small">On the calendar, use “Login / Register” to create a free artist account, then “Submit gig” to add dates. {NO_GUARANTEE}</p>
        </section>

        {storageProblem && (
          <div className="fh-notice" role="alert">{STORAGE_MESSAGES[storageProblem]}</div>
        )}

        <Filters filters={filters} setFilter={setFilter} regions={regions} genres={genres} onReset={resetFilters} />

        <p className="fh-count" role="status" aria-live="polite">
          {results.length === 1 ? "1 demo listing" : `${results.length} demo listings`}
          {savedIds.size ? ` · ${savedIds.size} on your shortlist` : ""}
        </p>

        <div id="fh-results" tabIndex={-1}>
          {results.length === 0 ? (
            <div className="fh-empty">
              <p>{filters.savedOnly && savedIds.size === 0 ? "Your shortlist is empty. Open a listing and choose “Save to shortlist”." : "No demo listings match these filters."}</p>
              <button type="button" className="fh-btn fh-btn-primary" onClick={resetFilters}>Reset filters</button>
            </div>
          ) : (
            <ul className="fh-grid" aria-label="Festival listings">
              {results.map(({ listing, info }) => (
                <li key={listing.id}><ListingCard listing={listing} info={info} entry={saved[listing.id]} /></li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <footer className="fh-footer">
        <p>{STORAGE_NOTE}</p>
        <p style={{ marginTop: 6 }}>Deadlines are shown as the last day to apply, in UK time.</p>
      </footer>

      {openId !== null && (
        <DetailDialog
          key={openId}
          listing={openListing}
          missing={!openListing}
          info={openListing ? applicationStatus(openListing, today) : null}
          entry={openListing ? saved[openListing.id] : null}
          onClose={closeDetail}
          onToggleSave={toggleSave}
          onUpdate={updateEntry}
        />
      )}
    </>
  );
}
