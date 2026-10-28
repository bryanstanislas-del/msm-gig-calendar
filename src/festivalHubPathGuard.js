// Festival Hub path guard for the CALENDAR entry (src/main.jsx).
//
// The Festival Hub (/festival-hub) is a separate page that must never start
// the calendar app or its backend client. If the calendar shell is ever
// served on a hub path anyway (a routing fallback, or a service worker
// serving its cached app shell), this module -- imported FIRST in main.jsx --
// stops the calendar from booting: it sends the browser to the hub's own
// document and throws, which halts evaluation of main.jsx's remaining
// imports (App.jsx, the service worker registration) before they run.

export const FESTIVAL_HUB_PATH = /^\/festival-hub(\/|$)/;
export const FESTIVAL_HUB_DOCUMENT = "/festival-hub/index.html";

// null       -> not a hub path, boot the calendar normally
// "halt"     -> already on the hub document; stop without redirecting
// "<url>"    -> redirect target for the hub document
export function festivalHubGuardAction(location) {
  if (!location || !FESTIVAL_HUB_PATH.test(location.pathname)) return null;
  if (location.pathname === FESTIVAL_HUB_DOCUMENT) return "halt";
  return FESTIVAL_HUB_DOCUMENT + (location.search || "") + (location.hash || "");
}

if (typeof window !== "undefined") {
  const action = festivalHubGuardAction(window.location);
  if (action) {
    if (action === "halt") {
      const root = document.getElementById("root");
      if (root) root.innerHTML = '<p style="color:#fff;font-family:sans-serif;padding:24px">The Festival Hub could not load. <a style="color:#fff" href="/">Go to the gig calendar</a></p>';
    } else {
      window.location.replace(action);
    }
    throw new Error("MSM calendar not started on a Festival Hub path");
  }
}
