// Canonical gig-genre taxonomy, shared by every gig-genre touchpoint: the
// public Submit Your Gig form, the moderation/gig edit form, Bulk Import,
// and the Smart Import (Gig Parse) CSV/TSV pipeline in src/smartImport.
// Kept in exactly one place, framework-free (no React/Supabase import,
// same posture as notificationHelpers.js), so App.jsx and src/smartImport
// can both import it without a second, drifting genre list ever existing.
//
// gigs.genre is a nullable text column with no default (see the
// gigs_genre_nullable migration) -- null means "no genre assigned" and is
// a distinct, first-class state, not a fallback to any genre in this list,
// including "Other".
export const GENRES = [
  "Acoustic","Afrobeat","Alternative","Americana","Bluegrass","Blues","Blues Rock",
  "Britpop","Celtic","Classic Rock","Classical","Comedy","Country","Covers","Dance",
  "Electronic","Experimental","Folk","Folk Rock","Funk","Funk Rock","Fusion",
  "Garage Rock","Gospel","Grunge","Hard Rock","Hardcore","Hip-Hop","Indie Rock",
  "Jazz","Jazz-Funk","Latin","Metal","Metalcore","New Wave","Original Music",
  "Pop","Progressive Rock","Psychedelic","Punk","R&B","Reggae","Rock","Shoegaze",
  "Singer-Songwriter","Ska","Ska Punk","Soul","Southern Rock","Spoken Word",
  "Tribute","World Music","Other",
  // Added: real-world genre values surfaced by the Music in the City /
  // Portsmouth-PO source data that warranted a genuine new canonical
  // genre (as opposed to an alternate spelling of an existing one -- see
  // GENRE_ALIASES below for those). Purely additive -- see genres.test.js
  // for the exact-count (65) and no-duplicates assertions. Alphabetised
  // here for readability; the array itself is always re-sorted below
  // regardless of source order, so this grouping is cosmetic only.
  "A Capella","Alternative Rock","Argentine Tango","Brass Band","Choir",
  "Darkwave","Easy Listening","Indie","Indie Folk","Musical Theatre",
  "Pipe Band","Protest Songs","Samba Reggae","Sea Shanties",
].sort();

export const GENRE_COLORS = {
  "Acoustic":          "#a5d6a7",
  "Alternative":       "#ef5350",
  "Americana":         "#d4a373",
  "Blues":             "#1a78c2",
  "Blues Rock":        "#1565c0",
  "Britpop":           "#7986cb",
  "Celtic":            "#66bb6a",
  "Classic Rock":      "#ff8a65",
  "Classical":         "#90e0ef",
  "Comedy":            "#ffd600",
  "Country":           "#c9a227",
  "Covers":            "#bdbdbd",
  "Dance":             "#00e5ff",
  "Electronic":        "#9b5de5",
  "Experimental":      "#78909c",
  "Festival":          "#22d3ee",
  "Folk":              "#f4a261",
  "Folk Rock":         "#ffb74d",
  "Funk":              "#ff6f00",
  "Fusion":            "#26c6da",
  "Garage Rock":       "#ef9a9a",
  "Gospel":            "#fff176",
  "Grunge":            "#8d6e63",
  "Hard Rock":         "#b71c1c",
  "Hip-Hop":           "#ff9f1c",
  "Indie Rock":        "#e8203a",
  "Jazz":              "#43aa8b",
  "Jazz-Funk":         "#00897b",
  "Latin":             "#f06292",
  "Metal":             "#ff595e",
  "Metalcore":         "#c62828",
  "New Wave":          "#ab47bc",
  "Original Music":    "#29b6f6",
  "Pop":               "#ff6b9d",
  "Progressive Rock":  "#5c6bc0",
  "Psychedelic":       "#ce93d8",
  "Punk":              "#ff4d00",
  "R&B":               "#ce93d8",
  "Reggae":            "#2dc653",
  "Rock":              "#ff7043",
  "Shoegaze":          "#c77dff",
  "Singer-Songwriter": "#a1887f",
  "Ska":               "#ffee58",
  "Ska Punk":          "#d4e157",
  "Soul":              "#e040fb",
  "Southern Rock":     "#ffa726",
  "Spoken Word":       "#90a4ae",
  "Tribute":           "#b0bec5",
  "World Music":       "#52b788",
  "Afrobeat":          "#f4a261",
  "Bluegrass":         "#a5c27c",
  "Funk Rock":         "#ff8c42",
  "Hardcore":          "#d32f2f",
  "Ska Punk":          "#d4e157",
  "Other":             "#888888",
  // Added alongside the 14 new canonical genres above -- each needs its
  // own explicit, non-neutral colour (GENRE_COLORS is a flat lookup map,
  // not derived/generated -- see genreColor()'s own fallback-to-neutral
  // behaviour for any genre missing here). None of these reuse
  // NO_GENRE_COLOR ("#9a9a9a"), and no existing entry above was changed.
  "A Capella":         "#f8bbd0",
  "Alternative Rock":  "#f4511e",
  "Argentine Tango":   "#c2185b",
  "Brass Band":        "#ffb300",
  "Choir":             "#b39ddb",
  "Darkwave":          "#4a148c",
  "Easy Listening":    "#f0e68c",
  "Indie":             "#26a69a",
  "Indie Folk":        "#8bc34a",
  "Musical Theatre":   "#ec407a",
  "Pipe Band":         "#3f51b5",
  "Protest Songs":     "#795548",
  "Samba Reggae":      "#00c853",
  "Sea Shanties":      "#0288d1",
};

// Neutral "no genre assigned" marker -- mirrors the app's existing muted
// neutral tone (C.muted in App.jsx, already used for e.g. StatusBadge's
// "UNKNOWN" fallback) rather than any actual genre colour, so an
// unclassified gig never reads as a deliberate genre choice.
export const NO_GENRE_COLOR = "#9a9a9a";

// Sentinel option value for "no genre" in <select> dropdowns -- gigs.genre
// itself stores real NULL, never this string; this only exists so a
// controlled <select>'s value can represent "nothing chosen".
export const NO_GENRE_OPTION = "";

const GENRE_LOOKUP = new Map(GENRES.map((g) => [g.toLowerCase(), g]));

// Conservative, explicit aliases for a small number of obvious alternate
// spellings/punctuation of an EXISTING canonical genre -- never a new
// genre, never a fuzzy/substring/inferred match. Each entry here is a
// deliberate, individually-reviewed decision (see the Smart Import Music
// in the City genre-loss investigation), not a general normalisation rule
// (e.g. this does NOT treat "&"/"and" as equivalent everywhere -- only for
// the two specific Rhythm & Blues spellings below). Keys are matched
// against the same trimmed/lowercased form canonicalizeGenre already uses
// for the canonical list, so matching stays case-insensitive and
// whitespace-tolerant for free. Only ever resolves to a genre already in
// GENRES above -- adding an alias here must never require adding a new
// canonical genre.
const GENRE_ALIASES = {
  "singer songwriter": "Singer-Songwriter",
  "hip hop": "Hip-Hop",
  "rhythm & blues": "R&B",
  "rhythm and blues": "R&B",
  // Added alongside the taxonomy expansion above -- each maps to a genre
  // that is now canonical (Brass Band/Indie Folk are new; Metal already
  // existed). Still explicit, still exact-match-only after normalisation.
  "heavy metal": "Metal",
  "indie/folk": "Indie Folk",
  "brass band (wind/symphony)": "Brass Band",
};

// Case-insensitive match against the canonical list, returning the
// canonical casing. Anything not on the list (including "") returns null.
export function isValidGenre(value) {
  return typeof value === "string" && GENRE_LOOKUP.has(value.trim().toLowerCase());
}

// Exact canonical match first, then the small explicit alias map, then
// null -- an alias can never shadow or override an actual canonical genre
// (e.g. "Blues" always resolves to "Blues", never anything from the alias
// map), since the canonical lookup always runs first.
export function canonicalizeGenre(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return GENRE_LOOKUP.get(key) || GENRE_ALIASES[key] || null;
}

// Blank/unrecognised input must never fall back to a default genre --
// always null, never a specific genre (see gigs.genre's DB default).
export function normalizeGenre(value) {
  return canonicalizeGenre(value);
}

export function genreColor(genre) {
  return GENRE_COLORS[genre] || NO_GENRE_COLOR;
}

export function genreLabel(genre) {
  return genre || "–";
}
