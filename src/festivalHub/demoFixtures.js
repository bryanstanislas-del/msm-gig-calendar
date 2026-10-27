// Festival Hub -- DEMO FIXTURES ONLY (shown only with the explicit demo
// toggle, never mixed with curatedListings.js).
//
// Every listing below is fictional: names, places, criteria, fees, dates and
// links are invented so the statuses, filters and saving can be reviewed.
// All links point at example.org. Each record exercises one case of the
// status rules in status.js (noted per record). Check dates are static, so
// as real time passes some will age into "needs re-check" -- that is the
// freshness rule working, not a bug.

export const DEMO_DATA_NOTICE =
  "Demo data: these are fictional example listings, not real festivals or open opportunities.";

const ex = (slug, page) => `https://example.org/festival-hub-demo/${slug}/${page}`;
const verified = (slug, checkedDate) => ({
  status: "verified", editionConfirmed: true, sourceUrl: ex(slug, "about"), checkedDate, sourcePublishedDate: null,
  evidence: "Example evidence note (demo): 2027 edition dates shown on the festival's site.",
});

export const DEMO_LISTINGS = Object.freeze([
  { // Open, deadline with a stated time and an inferred year.
    id: "demo-northfields", name: "Northfields Example Festival", isDemo: true, editionYear: 2027,
    region: "North West", location: "Example field site (demo)",
    festivalDates: { start: "2027-07-16", end: "2027-07-18" }, genres: ["Indie", "Rock"],
    officialUrl: ex("northfields", "home"),
    eligibility: "Example criteria: original material, UK-based acts, 30–45 minute set.", applicationFee: "Free to apply (example)",
    listingVerification: verified("northfields", "2026-10-20"),
    application: {
      status: "open", editionYear: 2027, opens: "2026-09-01", closes: "2026-12-15", closesTime: "18:00",
      closesText: "Applications close 6pm, 15 December", yearInferred: true, url: ex("northfields", "apply"), urlEdition: 2027,
      sourceUrl: ex("northfields", "apply"), checkedDate: "2026-10-20", sourcePublishedDate: "2026-09-01",
      evidence: "Example (demo): page says applications for the 2027 festival are open.",
    },
  },
  { // Open, date-only deadline (time not stated).
    id: "demo-coastline", name: "Coastline Example Weekender", isDemo: true, editionYear: 2027,
    region: "South West", location: "Example seafront (demo)",
    festivalDates: { start: "2027-06-04", end: "2027-06-06" }, genres: ["Folk", "Acoustic", "Singer-Songwriter"],
    officialUrl: ex("coastline", "home"), eligibility: "Example criteria: acoustic or folk acts, up to 4 performers.", applicationFee: null,
    listingVerification: verified("coastline", "2026-10-22"),
    application: {
      status: "open", editionYear: 2027, opens: "2026-10-01", closes: "2026-11-05",
      closesText: "Deadline: 5 November 2026", url: ex("coastline", "apply"), urlEdition: 2027,
      sourceUrl: ex("coastline", "apply"), checkedDate: "2026-10-22",
      evidence: "Example (demo): 2027 artist applications open, deadline 5 November 2026.",
    },
  },
  { // Announced future opening date.
    id: "demo-highland", name: "Highland Example Gathering", isDemo: true, editionYear: 2027,
    region: "Scotland", location: "Example glen (demo)",
    festivalDates: { start: "2027-08-13", end: "2027-08-15" }, genres: ["Rock", "Metal"],
    officialUrl: ex("highland", "home"), eligibility: "Example criteria: heavier rock and metal acts with a recent live video.",
    applicationFee: "£10 per application (example)",
    listingVerification: verified("highland", "2026-10-18"),
    application: {
      status: "announced", editionYear: 2027, opens: "2027-01-10", closes: "2027-03-28", closesTime: "21:00",
      closesText: "Opens 10 Jan 2027, closes 28 March 2027 at 9pm", url: null,
      sourceUrl: ex("highland", "news"), checkedDate: "2026-10-18",
      evidence: "Example (demo): news post announces 2027 application dates.",
    },
  },
  { // Closed per source; old form kept for reference.
    id: "demo-valleys", name: "Valleys Example Fest", isDemo: true, editionYear: 2027,
    region: "Wales", location: "Example town park (demo)",
    festivalDates: { start: "2027-05-29", end: "2027-05-30" }, genres: ["Punk", "Alternative"],
    officialUrl: ex("valleys", "home"), eligibility: "Example criteria: punk and alternative acts within 100 miles.", applicationFee: "Free to apply (example)",
    listingVerification: verified("valleys", "2026-10-02"),
    application: {
      status: "closed", editionYear: 2027, opens: "2026-06-01", closes: "2026-10-01",
      closesText: "Applications closed 1 October", url: ex("valleys", "apply"), urlEdition: 2027,
      sourceUrl: ex("valleys", "apply"), checkedDate: "2026-10-02",
      evidence: "Example (demo): form says 2027 applications are now closed.",
    },
  },
  { // Festival not yet checked.
    id: "demo-riverside", name: "Riverside Example Sessions", isDemo: true, editionYear: 2027,
    region: "London", location: null, festivalDates: null, genres: ["Jazz", "Soul", "R&B"],
    officialUrl: ex("riverside", "home"), eligibility: null, applicationFee: null,
    listingVerification: { status: "unverified" },
    application: { status: "unverified" },
  },
  { // Open with explicit rolling intake (no published deadline).
    id: "demo-moorland", name: "Moorland Example Festival", isDemo: true, editionYear: 2027,
    region: "Yorkshire and the Humber", location: "Example moor-top site (demo)",
    festivalDates: { start: "2027-07-02", end: "2027-07-04" }, genres: ["Indie", "Electronic"],
    officialUrl: ex("moorland", "home"), eligibility: null, applicationFee: null,
    listingVerification: verified("moorland", "2026-10-16"),
    application: {
      status: "open", editionYear: 2027, opens: "2026-10-15", closes: null, noPublishedDeadline: true,
      closesText: "Rolling applications for 2027 — no closing date", url: ex("moorland", "apply"), urlEdition: 2027,
      sourceUrl: ex("moorland", "apply"), checkedDate: "2026-10-16",
      evidence: "Example (demo): page says 2027 applications are rolling with no deadline.",
    },
  },
  { // Not yet announced; only last year's (historical) form exists. Dates unknown.
    id: "demo-harbour", name: "Harbour Example Live", isDemo: true, editionYear: 2027,
    region: "Northern Ireland", location: "Example harbour stage (demo)", festivalDates: null, genres: ["Pop", "Indie"],
    officialUrl: ex("harbour", "home"), eligibility: null, applicationFee: "£15 per application in 2026 (example)",
    listingVerification: verified("harbour", "2026-10-21"),
    application: {
      status: "not-yet-announced", editionYear: 2027, opens: null, closes: null,
      url: ex("harbour", "apply-2026"), urlEdition: 2026,
      sourceUrl: ex("harbour", "home"), checkedDate: "2026-10-21",
      evidence: "Example (demo): site shows only the 2026 form; nothing yet for 2027.",
    },
  },
  { // Open; deadline on the BST-end date, date only.
    id: "demo-midlands", name: "Midlands Example Stage", isDemo: true, editionYear: 2027,
    region: "West Midlands", location: "Example city square (demo)",
    festivalDates: { start: "2027-11-19", end: "2027-11-21" }, genres: ["Hip-Hop", "R&B", "Soul"],
    officialUrl: ex("midlands", "home"), eligibility: "Example criteria: Midlands-based hip-hop, R&B and soul acts.", applicationFee: "Free to apply (example)",
    listingVerification: verified("midlands", "2026-10-19"),
    application: {
      status: "open", editionYear: 2027, opens: "2026-10-01", closes: "2027-10-31",
      url: ex("midlands", "apply"), urlEdition: 2027,
      sourceUrl: ex("midlands", "apply"), checkedDate: "2026-10-19",
      evidence: "Example (demo): 2027 applications open until 31 October 2027.",
    },
  },
  { // Was open, but the check is older than the freshness window.
    id: "demo-lakeside", name: "Lakeside Example Festival", isDemo: true, editionYear: 2027,
    region: "East of England", location: "Example lakeside (demo)",
    festivalDates: { start: "2027-06-18", end: "2027-06-20" }, genres: ["Indie", "Folk"],
    officialUrl: ex("lakeside", "home"), eligibility: null, applicationFee: null,
    listingVerification: verified("lakeside", "2026-09-01"),
    application: {
      status: "open", editionYear: 2027, opens: "2026-08-15", closes: "2027-02-01",
      url: ex("lakeside", "apply"), urlEdition: 2027,
      sourceUrl: ex("lakeside", "apply"), checkedDate: "2026-09-01",
      evidence: "Example (demo): applications were open on 1 September.",
    },
  },
  { // Official pages disagree about the year.
    id: "demo-borders", name: "Borders Example Weekender", isDemo: true, editionYear: 2027,
    region: "North East", location: "Example market town (demo)",
    festivalDates: null, genres: ["Rock", "Blues"],
    officialUrl: ex("borders", "home"), eligibility: null, applicationFee: null,
    listingVerification: verified("borders", "2026-10-23"),
    application: {
      status: "open", editionYear: 2027, opens: null, closes: "2026-12-01", yearConflict: true,
      closesText: "Apply by 1 December (form heading says 2026)", url: null,
      sourceUrl: ex("borders", "apply"), checkedDate: "2026-10-23",
      evidence: "Example (demo): homepage says 2027 but the form heading says 2026.",
    },
  },
]);
