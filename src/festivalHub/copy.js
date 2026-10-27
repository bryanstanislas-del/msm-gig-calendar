// Festival Hub -- copy and links into the existing MSM calendar flows.
//
// Plain links only: the hub never signs anyone in, never writes to the
// calendar, and never makes MSM registration a condition of applying to a
// festival. Calendar links point at the existing LIVE MSM calendar (not this
// staging deployment) and are labelled as such.

export const LIVE_CALENDAR_ORIGIN = "https://calendar.musicscenemagazine.co.uk";
export const CALENDAR_LINKS = Object.freeze({
  calendar: `${LIVE_CALENDAR_ORIGIN}/`,
  claim: `${LIVE_CALENDAR_ORIGIN}/claim`,
});
export const LIVE_LINK_NOTE = "opens the live MSM Gig Calendar";

export const MSM_BENEFITS = Object.freeze([
  {
    title: "A free artist profile",
    body: "Register as a band or solo artist on the MSM Gig Calendar to get a public profile page you can link from festival applications.",
  },
  {
    title: "Claim a profile we already list",
    body: "If MSM already lists your act, request to claim that profile instead of creating a duplicate. MSM reviews each claim.",
  },
  {
    title: "Show you're gigging",
    body: "Add your gig dates so anyone checking your application can see a current live calendar, and fans can follow you for new dates.",
  },
]);

export const NO_GUARANTEE =
  "MSM does not book festivals and cannot guarantee a slot. Each festival makes its own decisions, and you apply directly through the festival's own process — registering with MSM is never required to apply.";

export const NO_AUTO_SUBMIT =
  "The hub never submits applications for you. Links open the festival's own page in a new tab.";

export const OPEN_RECHECK_NOTE =
  "“Open” means the festival's own page showed an open 2027 call on the date checked. It isn't a guarantee: confirm details on the festival's site before applying. MSM hasn't tested external application forms.";

// "Before you apply" -- general preparation advice, no promises.
export const PREP_TIPS = Object.freeze([
  { title: "Read the brief first", body: "Check eligibility, location limits, set length and whether covers or tributes are accepted before you spend time on a form." },
  { title: "Note the exact deadline", body: "Some festivals close at a set time (for example 9pm UK time). If only a date is given, apply well before the end of that day." },
  { title: "Lead with live evidence", body: "A recent, unedited live clip and two or three strong tracks usually matter more than a long bio." },
  { title: "Keep one EPK link ready", body: "Photo, short bio, music, live video, socials and a contact — kept up to date in one place." },
  { title: "Be clear about costs and pay", body: "Know what you need to cover travel and time. Check whether a slot is paid, negotiated or unpaid, and what any application fee covers." },
  { title: "Follow their instructions exactly", body: "Use the method each festival asks for (form, email or platform) and keep a note of what you sent and when." },
]);

export const STORAGE_NOTE =
  "Your shortlist and progress are saved only in this browser. Nothing is sent to MSM, and no contact details are stored.";
