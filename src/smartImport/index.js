// Sprint 5A: public entry point for the Smart Import parsing engine.
// Anything outside src/smartImport/ (App.jsx, and later the 5B/5C
// matching/import UI) should import from here, not reach into the
// individual internal modules directly -- that keeps the internal split
// between parser/sourceProfiles/csvTsv/furniture/confidence free to change
// without touching call sites.

export { parseImportText } from "./parser.js";
export { PROFILES } from "./sourceProfiles.js";
export { STATUS_THRESHOLDS } from "./confidence.js";
