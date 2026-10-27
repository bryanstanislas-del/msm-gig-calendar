// Festival Hub -- REAL, source-backed 2027 listings (git-curated).
//
// Records come only from MSM's reviewed research against official festival
// sources (Batch A: 13 open calls; Batch B: 13 non-open records; all
// checked 2026-10-27). Never add records that have not been checked on the
// festival's official site, and never use third-party directories as proof.
// Unknown fields stay null / [] -- do not fill them with guesses. Every record must pass validateListing()
// with zero errors (enforced by curated.test.js); invalid records are
// never shown.
//
// Record shape (see schema.js for every rule):
// {
//   id: "festival-slug",                 // lowercase slug, not "demo-..."
//   name: "Festival Name",
//   editionYear: 2027,
//   region: "South East",                // one of UK_REGIONS
//   location: "Town, County" | null,
//   festivalDates: { start: "2027-07-16", end: "2027-07-18" | null } | null,
//   genres: [],                          // may be empty
//   festivalDatesText: "May 2027" | null, // only when exact dates are not published
//   officialUrl: "https://…",            // festival's own site / page
//   eligibility: "…" | null,             // null = not known
//   applicationFee: "…" | null,          // cost to apply; null = not known
//   performerPay: { status: "paid" | "unpaid" | "negotiated" | "not-stated", note } | null,
//   listingVerification: {               // the festival itself
//     status: "verified" | "unverified",
//     editionConfirmed: true | false,    // 2027 edition confirmed on an official source
//     sourceUrl: "https://…", extraSourceUrls: ["https://…"],   // extra: optional
//     checkedDate: "YYYY-MM-DD",
//     sourcePublishedDate: "YYYY-MM-DD" | null,   // date shown on the page, if any
//     evidence: "One-line note of what the page says",
//   },
//   application: {                       // the 2027 application window
//     status: "open" | "announced" | "not-yet-announced" | "closed" | "unverified",
//     editionYear: 2027,                 // year the evidence is about
//     opens: "YYYY-MM-DD" | null,
//     closes: "YYYY-MM-DD" | null,
//     closesTime: "21:00" | null,        // ONLY if the source states a time (UK time)
//     closesText: "exact wording from the source" | null,
//     yearInferred: false,               // true if the page omits the year
//     yearConflict: false,               // true if official pages disagree -> Unverified
//     noPublishedDeadline: false,        // true only when the official source gives no deadline
//     url: "https://…" | null,           // official application page (open windows only shown as Apply)
//     urlEdition: 2027 | null,           // year that page/form is for (2026 = historical)
//     email: "bands@…" | null,           // organiser's published address, shown as text only
//     instructions: "…" | null,          // short how-to-apply note (e.g. external form not tested)
//     sourceUrl: "https://…", extraSourceUrls: [], checkedDate: "YYYY-MM-DD",
//     sourcePublishedDate: "YYYY-MM-DD" | null,
//     evidence: "One-line note, e.g. '2027 applications open; closes 1 Dec 9pm'",
//   },
// }

const CHECKED = "2026-10-27";
const Y = 2027;

// Festival / edition verification (separate from the application window).
const festival = (sourceUrl, evidence, { extra, editionConfirmed = true, published = null } = {}) => ({
  status: "verified", editionConfirmed, sourceUrl, ...(extra ? { extraSourceUrls: extra } : {}),
  checkedDate: CHECKED, sourcePublishedDate: published, evidence,
});
// 2027 application window evidence.
const window2027 = (status, sourceUrl, evidence, rest = {}) => ({
  status, editionYear: Y, sourceUrl, checkedDate: CHECKED, sourcePublishedDate: null, evidence, ...rest,
});
// Window not confirmed: what was seen is still recorded so sources show.
const unconfirmed = (sourceUrl, evidence, rest = {}) => ({ status: "unverified", sourceUrl, checkedDate: CHECKED, evidence, ...rest });

export const CURATED_LISTINGS = Object.freeze([
  // ── Batch A: official 2027 open calls observed on 2026-10-27 ─────────
  {
    id: "the-great-escape", name: "The Great Escape", editionYear: Y,
    region: "South East", location: "Brighton", festivalDates: null, festivalDatesText: "May 2027 (exact dates not stated)",
    genres: ["All genres"], officialUrl: "https://greatescapefestival.com/apply-to-play/",
    eligibility: "Emerging artists; all genres.", applicationFee: "Free to apply; no CD Baby account needed.", performerPay: null,
    listingVerification: festival("https://greatescapefestival.com/apply-to-play/", "Official apply page for the 2027 festival in Brighton (May).",
      { extra: ["https://greatescapefestival.com/artist-applications-for-the-great-escape-2027-are-now-open/"] }),
    application: window2027("open", "https://greatescapefestival.com/apply-to-play/",
      "Explicit 2027 open call at the top of the apply page, matched by a dated official news post. Page footer still has stale 'coming soon' text.", {
        opens: null, closes: "2027-02-15", url: "https://greatescapefestival.com/apply-to-play/", urlEdition: Y,
        extraSourceUrls: ["https://greatescapefestival.com/artist-applications-for-the-great-escape-2027-are-now-open/"],
      }),
  },
  {
    id: "buckle-and-boots", name: "Buckle & Boots", editionYear: Y,
    region: "North West", location: "Whitebottom Farm, Greater Manchester", festivalDates: { start: "2027-05-27", end: "2027-05-30" },
    genres: [], officialUrl: "https://buckleandboots.co.uk/band-applications/",
    eligibility: "Asks for Spotify and photo links and your indicative performance cost.", applicationFee: null,
    performerPay: { status: "not-stated", note: "Performance fee not stated (negotiated)." },
    listingVerification: festival("https://buckleandboots.co.uk/band-applications/", "Official band applications page for the 2027 festival."),
    application: window2027("open", "https://buckleandboots.co.uk/band-applications/",
      "Page explicitly invites acts for 2027; window 1 Sept to 8 Jan (years inferred).", {
        opens: "2026-09-01", closes: "2027-01-08", closesText: "8th January", yearInferred: true,
        url: "https://buckleandboots.co.uk/band-applications/", urlEdition: Y,
      }),
  },
  {
    id: "hanwell-hootie", name: "Hanwell Hootie", editionYear: Y,
    region: "London", location: "Hanwell", festivalDates: { start: "2027-05-08", end: null },
    genres: [], officialUrl: "https://www.hanwellhootie.co.uk/",
    eligibility: null, applicationFee: null, performerPay: { status: "paid", note: "Official post says musicians are paid." },
    listingVerification: festival("https://www.hanwellhootie.co.uk/", "Official site for the 2027 Hootie on 8 May 2027."),
    application: window2027("open", "https://www.hanwellhootie.co.uk/",
      "Official post dated 21 Oct 2026 invites 2027 applications before 9pm on Tuesday 1 December (year inferred from the post date).", {
        sourcePublishedDate: "2026-10-21", opens: null, closes: "2026-12-01", closesTime: "21:00",
        closesText: "before 9pm Tuesday 1 December", yearInferred: true,
        url: "https://www.hanwellhootie.co.uk/", urlEdition: Y,
        instructions: "The official post links to an external Amplead form (amplead.com/apply-to-play/han27). MSM has not tested that form.",
      }),
  },
  {
    id: "mostly-jazz-funk-and-soul", name: "Mostly Jazz Funk & Soul", editionYear: Y,
    region: "West Midlands", location: "Moseley Park, Birmingham", festivalDates: { start: "2027-07-09", end: "2027-07-11" },
    genres: ["Jazz", "Funk", "Soul"], officialUrl: "https://www.mostlyjazz.co.uk/apply-to-play/",
    eligibility: "Send music and live-video links, socials and a brief bio.", applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.mostlyjazz.co.uk/apply-to-play/", "Official apply-to-play page for the 2027 festival."),
    application: window2027("open", "https://www.mostlyjazz.co.uk/apply-to-play/", "Explicit 2027 call for artists; no deadline published.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://www.mostlyjazz.co.uk/apply-to-play/", urlEdition: Y,
      email: "apply@mostlyjazz.co.uk",
      instructions: "Official instruction: email your music and live-video links, socials and a brief bio.",
    }),
  },
  {
    id: "craic-by-the-creek", name: "Craic by the Creek", editionYear: Y,
    region: "North West", location: "Whitebottom Farm, Compstall, Greater Manchester", festivalDates: null, festivalDatesText: null,
    genres: ["Irish", "Country", "Traditional", "Bluegrass", "Folk"], officialUrl: "https://craicbythecreek.co.uk/apply-to-play",
    eligibility: "Bands, duos and solo acts welcome from anywhere; other suitable genres considered.", applicationFee: null, performerPay: null,
    listingVerification: festival("https://craicbythecreek.co.uk/apply-to-play", "Official apply page for CBTC27; location from the need-to-know page.",
      { extra: ["https://craicbythecreek.co.uk/need-to-know-information"] }),
    application: window2027("open", "https://craicbythecreek.co.uk/apply-to-play", "Apply page explicitly invites acts for CBTC27; no deadline given.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://craicbythecreek.co.uk/apply-to-play", urlEdition: Y,
    }),
  },
  {
    id: "boho-festival", name: "Boho Festival", editionYear: Y,
    region: "East Midlands", location: "Nottinghamshire", festivalDates: null, festivalDatesText: null,
    genres: ["House", "Soul", "Funk", "Disco", "Dub", "Reggae", "Electronic", "Alternative"],
    officialUrl: "https://www.bohemianevents.co.uk/boho-festival/band-applications",
    eligibility: "Bands, DJs, acoustic and other live acts.", applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.bohemianevents.co.uk/boho-festival/band-applications", "Official band applications page for Boho Festival 2027."),
    application: window2027("open", "https://www.bohemianevents.co.uk/boho-festival/band-applications", "Explicit 2027 call for acts; no deadline or fee given.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://www.bohemianevents.co.uk/boho-festival/band-applications", urlEdition: Y,
    }),
  },
  {
    id: "butefest", name: "ButeFest", editionYear: Y,
    region: "Scotland", location: "Isle of Bute", festivalDates: { start: "2027-07-23", end: "2027-07-25" },
    genres: [], officialUrl: "https://www.butefest.co.uk/contact/",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.butefest.co.uk/tickets/", "Official tickets page gives the 2027 dates."),
    application: window2027("open", "https://www.butefest.co.uk/contact/", "Contact page explicitly invites 2027 artist applications; no deadline, eligibility or fee published there.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://www.butefest.co.uk/contact/", urlEdition: Y,
      instructions: "The page links to a Google form that MSM could not test.",
    }),
  },
  {
    id: "teddy-rocks", name: "Teddy Rocks", editionYear: Y,
    region: "South West", location: "Charisworth Farm, Blandford, Dorset", festivalDates: { start: "2027-04-30", end: "2027-05-02" },
    genres: [], officialUrl: "https://teddyrocks.co.uk/play",
    eligibility: "Form accepts original or tribute acts, with music links and an act description.", applicationFee: null, performerPay: null,
    listingVerification: festival("https://teddyrocks.co.uk/play", "Official play page for Teddy Rocks 2027."),
    application: window2027("open", "https://teddyrocks.co.uk/play", "Invitation to register your act for 2027; no deadline published.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://teddyrocks.co.uk/play", urlEdition: Y,
    }),
  },
  {
    id: "dart-music-festival", name: "Dart Music Festival", editionYear: Y,
    region: "South West", location: "Dartmouth, Devon", festivalDates: { start: "2027-05-14", end: "2027-05-16" },
    genres: [], officialUrl: "https://www.dartmusicfestival.co.uk/artists-applications/",
    eligibility: "Original and emerging music encouraged across broad genres. International acts only if already touring the UK. Limited backline; state your performance costs honestly.",
    applicationFee: null, performerPay: { status: "not-stated", note: "No travel or accommodation payments." },
    listingVerification: festival("https://www.dartmusicfestival.co.uk/artists-applications/", "Official artist applications page for the 2027 festival."),
    application: window2027("open", "https://www.dartmusicfestival.co.uk/artists-applications/", "Explicit 2027 application form; no deadline published.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://www.dartmusicfestival.co.uk/artists-applications/", urlEdition: Y,
    }),
  },
  {
    id: "twyfest", name: "Twyfest", editionYear: Y,
    region: "South East", location: "Twyford, Buckinghamshire", festivalDates: { start: "2027-06-19", end: null },
    genres: [], officialUrl: "https://twyfest.uk/",
    eligibility: "Bands, solo artists and DJs; local acts preferred.", applicationFee: null,
    performerPay: { status: "unpaid", note: "Stage, sound, lights and drinks are offered, not money." },
    listingVerification: festival("https://twyfest.uk/", "Official site for Twyfest 2027; location confirmed on the about page.", { extra: ["https://twyfest.uk/about.php"] }),
    application: window2027("open", "https://twyfest.uk/", "Official 2027 booking invitation; no deadline published.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://twyfest.uk/", urlEdition: Y,
      email: "bands@twyfest.uk", instructions: "Email the published address or use the contact form on the official site.",
    }),
  },
  {
    id: "focus-wales", name: "FOCUS Wales", editionYear: Y,
    region: "Wales", location: "Wrexham", festivalDates: { start: "2027-05-06", end: "2027-05-08" },
    genres: ["All genres"], officialUrl: "https://focuswales.com/information/",
    eligibility: "Up to 100 30-minute showcases; applications from anywhere. No covers or tributes; no email applications.",
    applicationFee: "Free to apply (per official information).", performerPay: { status: "negotiated", note: "Performance fees negotiated." },
    listingVerification: festival("https://focuswales.com/information/", "Official information page for FOCUS Wales 2027."),
    application: window2027("open", "https://www.amplead.com/apply-to-play/focus27",
      "Explicit 2027 call on the Amplead page linked from the official information page. No deadline on primary pages (a third-party date was not used).", {
        opens: null, closes: null, noPublishedDeadline: true, url: "https://www.amplead.com/apply-to-play/focus27", urlEdition: Y,
        extraSourceUrls: ["https://focuswales.com/information/"],
      }),
  },
  {
    id: "kelburn-garden-party", name: "Kelburn Garden Party", editionYear: Y,
    region: "Scotland", location: "Near Largs", festivalDates: null, festivalDatesText: null,
    genres: ["Jazz", "World", "Folk", "Experimental", "Electronic", "Dance"],
    officialUrl: "https://www.kelburngardenparty.com/get-involved/artist-applications/",
    eligibility: "Music artist applications (not the visual-art or crew applications).", applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.kelburngardenparty.com/get-involved/artist-applications/", "Official artist applications page; location from the travel page.",
      { extra: ["https://www.kelburngardenparty.com/travel/"] }),
    application: window2027("open", "https://www.kelburngardenparty.com/get-involved/artist-applications/",
      "Page links explicitly to the 2027 artist application; deadline '15th December' (year inferred).", {
        opens: null, closes: "2026-12-15", closesText: "15th December", yearInferred: true,
        url: "https://www.kelburngardenparty.com/get-involved/artist-applications/", urlEdition: Y,
        instructions: "The page links to a Google form that MSM could not test.",
      }),
  },
  {
    id: "dorsetfest", name: "DorsetFest", editionYear: Y,
    region: "South West", location: "Warren Farm, Bulbarrow, Dorset", festivalDates: { start: "2027-06-18", end: "2027-06-19" },
    genres: [], officialUrl: "https://www.dorsetfest.org/bandapplications",
    eligibility: "Volunteer-run charitable festival; asks for your estimated performance cost and music/social links.", applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.dorsetfest.org/bandapplications", "Official band applications page; the 2027 form refers to Friday 18 and Saturday 19 June."),
    application: window2027("open", "https://www.dorsetfest.org/bandapplications", "Explicit 2027 band applications; no deadline or fee given.", {
      opens: null, closes: null, noPublishedDeadline: true, url: "https://www.dorsetfest.org/bandapplications", urlEdition: Y,
    }),
  },

  // ── Batch B: not open on 2026-10-27 ──────────────────────────────────
  {
    id: "manorfest", name: "Manorfest", editionYear: Y,
    region: "East Midlands", location: "Manor Park, Rothwell, Northamptonshire", festivalDates: { start: "2027-08-29", end: null },
    genres: [], officialUrl: "https://manorfest.co.uk/play",
    eligibility: "Bands, artists and DJs; covers and originals allowed; local acts prioritised; live video requested.", applicationFee: null,
    performerPay: { status: "negotiated", note: "Fees agreed per act." },
    listingVerification: festival("https://manorfest.co.uk/play", "Official play page for Manorfest 2027."),
    application: window2027("announced", "https://manorfest.co.uk/play", "Official page gives the 2027 window as 1 Nov 2026 to 31 Mar 2027 (times not stated).", {
      opens: "2026-11-01", closes: "2027-03-31",
    }),
  },
  {
    id: "wychwood", name: "Wychwood Festival", editionYear: Y,
    region: "South West", location: "Cheltenham Racecourse", festivalDates: { start: "2027-06-04", end: "2027-06-06" },
    genres: [], officialUrl: "https://wychwoodfestival.com/contact-us",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://wychwoodfestival.com/contact-us", "Official site for Wychwood 2027."),
    application: window2027("not-yet-announced", "https://wychwoodfestival.com/contact-us", "Says 2027 artist applications open later in the year; no window dates yet.", {
      opens: null, closes: null,
    }),
  },
  {
    id: "icebreaker", name: "Icebreaker Festival", editionYear: Y,
    region: "South East", location: "Portsmouth / Southsea", festivalDates: { start: "2027-01-30", end: null },
    genres: [], officialUrl: "https://www.icebreakerfestival.com/",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.icebreakerfestival.com/", "Official homepage gives the 2027 date."),
    application: window2027("closed", "https://www.icebreakerfestival.com/applications", "Applications page has a 2027 heading and says applications are now closed; deadline not stated.", {
      opens: null, closes: null,
    }),
  },
  {
    id: "hastings-fat-tuesday", name: "Hastings Fat Tuesday", editionYear: Y,
    region: "South East", location: "Hastings", festivalDates: { start: "2027-02-05", end: "2027-02-09" },
    genres: [], officialUrl: "https://hastingsfattuesday.co.uk/music-festival/",
    eligibility: "Multiple short sets; see the official page for fees.", applicationFee: null, performerPay: null,
    listingVerification: festival("https://hastingsfattuesday.co.uk/music-festival/", "Official music festival page for 2027."),
    // Source still shows an open banner/Apply button; the expired deadline wins.
    application: window2027("open", "https://hastingsfattuesday.co.uk/music-festival/",
      "Explicit 2027 window 7–25 Oct 2026 (time not stated). Page still shows an open banner after the deadline.", {
        opens: "2026-10-07", closes: "2026-10-25",
      }),
  },
  {
    id: "english-folk-expo-label-showcase", name: "English Folk Expo (label showcase)", editionYear: Y,
    region: "North West", location: "Manchester", festivalDates: { start: "2027-03-10", end: "2027-03-13" },
    genres: ["Folk", "Roots", "Acoustic"], officialUrl: "https://www.soundroots.uk/news/5f1wlj0lm3rsaz6hi348qygb2gozid",
    eligibility: "English or England-based artists, unless a formal partnership applies.", applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.soundroots.uk/news/5f1wlj0lm3rsaz6hi348qygb2gozid", "Official news post about the 2027 showcase.", { published: "2026-04-09" }),
    application: window2027("closed", "https://www.soundroots.uk/news/5f1wlj0lm3rsaz6hi348qygb2gozid",
      "News post (9 Apr 2026) invited 2027 applications; deadline 7 June 2026 ('midnight' is ambiguous, so no time recorded).", {
        sourcePublishedDate: "2026-04-09", opens: null, closes: "2026-06-07", closesText: "Sunday 7 June 2026 at midnight",
      }),
  },
  {
    id: "together-again", name: "Together Again", editionYear: Y,
    region: "North West", location: "Bolesworth Castle, Cheshire", festivalDates: { start: "2027-07-23", end: "2027-07-25" },
    genres: [], officialUrl: "https://togetheragainfestival.co.uk/",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://togetheragainfestival.co.uk/", "Official homepage gives the 2027 dates."),
    application: window2027("closed", "https://togetheragainfestival.co.uk/apply-to-play/",
      "The official 2027 apply page links a Google form that now says it is no longer accepting responses; deadline not stated.", {
        opens: null, closes: null,
        extraSourceUrls: ["https://docs.google.com/forms/d/e/1FAIpQLSdU4nAPLp_ZiXI5qOK2kit-GmfxpE8k60I3kebPyF0ZXSBV2w/closedform?embedded=true"],
      }),
  },
  {
    id: "donnyfest", name: "DonnyFest", editionYear: Y,
    region: "Yorkshire and the Humber", location: "Doncaster", festivalDates: null, festivalDatesText: null,
    genres: [], officialUrl: "https://donnyfest.co.uk/apply-to-play/",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://donnyfest.co.uk/apply-to-play/", "Official apply page; the 2027 edition is not clearly confirmed.", { editionConfirmed: false }),
    application: unconfirmed("https://donnyfest.co.uk/apply-to-play/",
      "Heading says DonnyFest27, 'opening soon' with a 31 Oct 2026 deadline, but the body refers to DonnyFest26. Years conflict; awaiting confirmation.", { yearConflict: true }),
  },
  {
    id: "country-on-the-coast", name: "Country on the Coast", editionYear: Y,
    region: "South East", location: "Southsea, Portsmouth", festivalDates: { start: "2027-04-17", end: "2027-04-18" },
    genres: ["Country"], officialUrl: "https://www.countryonthecoastfestival.com/artist-applications",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.countryonthecoastfestival.com/artist-applications", "Page header gives the 2027 dates."),
    application: unconfirmed("https://www.countryonthecoastfestival.com/artist-applications",
      "Header shows 2027, but the artist call in the body invites 2026 applications with 2026 dates.", { yearConflict: true }),
  },
  {
    id: "camper-calling", name: "Camper Calling", editionYear: Y,
    region: "West Midlands", location: "Ragley Hall, Warwickshire (per official page title)", festivalDates: null, festivalDatesText: null,
    genres: [], officialUrl: "https://www.campercalling.com/apply-to-play",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.campercalling.com/apply-to-play", "Official apply page; 2027 edition dates not confirmed.", { editionConfirmed: false }),
    application: unconfirmed("https://www.campercalling.com/apply-to-play", "Generic application form link; no evidence of a current 2027 window."),
  },
  {
    id: "stendhal", name: "Stendhal Festival", editionYear: Y,
    region: "Northern Ireland", location: "Ballymully Cottage Farm, Limavady", festivalDates: { start: "2027-07-01", end: "2027-07-03" },
    genres: [], officialUrl: "https://www.stendhalfestival.com/performance-applications-2026/",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.stendhalfestival.com/performance-applications-2026/", "Page footer gives the 2027 event dates."),
    application: unconfirmed("https://www.stendhalfestival.com/performance-applications-2026/",
      "Page covers 2026 applications (closed). That historical form says nothing about a 2027 window."),
  },
  {
    id: "deer-shed", name: "Deer Shed Festival", editionYear: Y,
    region: "Yorkshire and the Humber", location: "Baldersby Park, Topcliffe", festivalDates: { start: "2027-07-23", end: "2027-07-25" },
    genres: [], officialUrl: "https://www.deershedfestival.com/emi.aspx",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.deershedfestival.com/emi.aspx", "Official page for the 2027 festival dates."),
    application: unconfirmed("https://www.deershedfestival.com/emi.aspx",
      "Header says 2027, but the body (2026 guest tickets, deadline 'Thursday 2 April' with no year) matches 2026. Earlier criteria are not treated as 2027 eligibility.", { yearConflict: true }),
  },
  {
    id: "2000trees", name: "2000trees", editionYear: Y,
    region: "South West", location: "Upcote Farm, Withington, Cheltenham", festivalDates: { start: "2027-07-07", end: "2027-07-10" },
    genres: [], officialUrl: "https://2000trees.co.uk/contact",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://2000trees.co.uk/contact", "Official site for the 2027 festival."),
    application: unconfirmed("https://2000trees.co.uk/contact", "Generic bands contact asking for one link; not an explicit 2027 open call."),
  },
  {
    id: "milford-on-sea-music-festival", name: "Milford on Sea Music Festival", editionYear: Y,
    region: "South East", location: "Village Green, Milford on Sea, Hampshire", festivalDates: { start: "2027-07-02", end: "2027-07-04" },
    genres: [], officialUrl: "https://www.milfordonseamusicfestival.co.uk/",
    eligibility: null, applicationFee: null, performerPay: null,
    listingVerification: festival("https://www.milfordonseamusicfestival.co.uk/", "Official site confirms the 2027 dates."),
    application: unconfirmed("https://www.milfordonseamusicfestival.co.uk/",
      "No explicit artist call on the official site. A third-party mirror quotes an open call, but it was not confirmed on a primary source, so it is not recorded."),
  },
]);
