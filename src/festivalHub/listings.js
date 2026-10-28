// Festival Hub -- the two data sets, kept apart.
//
// "real" = curatedListings.js (source-backed, default view)
// "demo" = demoFixtures.js (only behind the explicit demo toggle)
// Each mode has its own validated list, id namespace ("demo-" prefix) and
// browser storage key; a listing from one mode can never appear in, or be
// saved into, the other.
import { CURATED_LISTINGS } from "./curatedListings.js";
import { DEMO_LISTINGS } from "./demoFixtures.js";
import { validateDirectory } from "./schema.js";
import { londonDateOf } from "./dates.js";
import { DEMO_ENABLED } from "./launch.js";

export const MODES = Object.freeze({ REAL: "real", DEMO: "demo" });

export function getDirectory(mode, { today = londonDateOf(), real = CURATED_LISTINGS, demo = DEMO_ENABLED ? DEMO_LISTINGS : [] } = {}) {
  const isDemo = DEMO_ENABLED && mode === MODES.DEMO;
  const { valid, problems } = validateDirectory(isDemo ? demo : real, { demo: isDemo, today });
  return { mode: isDemo ? MODES.DEMO : MODES.REAL, listings: valid, problems };
}

// ?demo=1 selects demo mode (staging builds only); anything else, and every
// launch build, is the real directory.
export const modeFromSearch = (search) => (DEMO_ENABLED && new URLSearchParams(search).get("demo") === "1" ? MODES.DEMO : MODES.REAL);

// Paths the hub page is actually served at (vercel.json rewrites and the
// static file). Links that switch mode reuse the current path only if it is
// one of these; anything else -- e.g. "//host/..." or another unexpected
// path -- falls back to /festival-hub/, so the toggle can never become a
// protocol-relative, off-site link.
export const HUB_PATHS = Object.freeze(["/", "/festival-hub", "/festival-hub/", "/festival-hub/index.html"]);
export const HUB_FALLBACK_PATH = "/festival-hub/";
export const hubBasePath = (pathname) => (HUB_PATHS.includes(pathname) ? pathname : HUB_FALLBACK_PATH);
