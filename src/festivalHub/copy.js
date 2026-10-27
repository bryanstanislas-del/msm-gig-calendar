// Festival Hub -- copy and links into the existing MSM calendar flows.
//
// Plain links only: the hub never signs anyone in, never writes to the
// calendar, and never makes MSM registration a condition of applying to a
// festival. Paths below are existing calendar routes.

export const CALENDAR_LINKS = Object.freeze({
  calendar: "/",
  claim: "/claim",
});

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
  "The hub never submits applications for you. Application links open the festival's own page in a new tab.";

export const STORAGE_NOTE =
  "Your shortlist and progress are saved only in this browser. Nothing is sent to MSM, and no contact details are stored.";
