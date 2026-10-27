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

export const MODES = Object.freeze({ REAL: "real", DEMO: "demo" });

export function getDirectory(mode, { today = londonDateOf(), real = CURATED_LISTINGS, demo = DEMO_LISTINGS } = {}) {
  const isDemo = mode === MODES.DEMO;
  const { valid, problems } = validateDirectory(isDemo ? demo : real, { demo: isDemo, today });
  return { mode: isDemo ? MODES.DEMO : MODES.REAL, listings: valid, problems };
}

// ?demo=1 selects demo mode; anything else is the real directory.
export const modeFromSearch = (search) => (new URLSearchParams(search).get("demo") === "1" ? MODES.DEMO : MODES.REAL);
