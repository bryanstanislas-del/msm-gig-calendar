// Sprint 5B: shared, deterministic text-normalisation helpers used by the
// venue/artist matching and duplicate-detection modules. Mirrors the
// normalisation the database itself already applies -- see
// venues.name_normalised (a GENERATED column) and auto_create_venue()'s own
// `lower(trim(regexp_replace(name, '\s+', ' ', 'g')))` -- so an "exact
// match" computed here agrees with what the database would itself treat as
// a duplicate. public.profiles has no equivalent generated column, so
// artist matching normalises band_name in JS using the same rule, for
// consistency with the venue side.

export function normaliseName(text) {
  if (!text) return "";
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normaliseCity(text) {
  if (!text) return "";
  return text.trim().toLowerCase();
}

// Strips a trailing structured-status marker ("- POSTPONED", "(CANCELLED)",
// "- Rescheduled", "SOLD OUT") from a name before it's used as a matching
// query. Sprint 5A deliberately keeps this wording *in* fields.artistName
// verbatim, for display (see sourceProfiles.js and parser.test.js's
// "postponed wording must be preserved verbatim" case) -- but matching
// against the venue/artist database needs the underlying name instead, or
// "The Mafia (CANCELLED)" would never find the existing "The Mafia" profile.
// Applied repeatedly so stacked markers ("Foo (CANCELLED) - RESCHEDULED")
// are all removed, not just the outermost one.
const STATUS_SUFFIX_RE = /\s*[-–(]\s*(cancell?ed|postponed|rescheduled|sold[\s-]?out)\)?\s*$/i;

export function stripStatusWording(text) {
  if (!text) return text;
  let cleaned = text;
  let prev;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(STATUS_SUFFIX_RE, "").trim();
  } while (cleaned !== prev);
  return cleaned;
}

// Recognises the same time vocabulary sourceProfiles.js's own extractTime()
// already extracts from free text -- "H:MM" optionally followed by am/pm,
// or a bare hour + am/pm -- so this stays compatible with, rather than
// inventing a second, conflicting grammar alongside, the parsing rules
// already in use elsewhere in Smart Import. Kept as its own single-value
// parser (not a reuse of extractTime() itself) because that function is
// shaped to find a time anywhere inside a whole line of prose and hand
// back the surrounding text; duplicate-detection callers only ever have
// one already-isolated field value to interpret.
//
// Returns minutes-since-midnight (0-1439) for a recognised time, or null
// for anything that isn't one -- CSV/TSV time cells are passed through
// verbatim with no validation (see csvTsv.js), so this must never throw on
// arbitrary text ("TBC", "doors 7", empty, garbage, etc).
const TIME_VALUE_RE = /^(\d{1,2}):(\d{2})\s*([ap]m)?$|^(\d{1,2})\s*([ap]m)$/i;

export function normaliseTime(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;

  const m = TIME_VALUE_RE.exec(trimmed);
  if (!m) return null;

  let h, min;
  if (m[1] !== undefined) {
    h = parseInt(m[1], 10);
    min = parseInt(m[2], 10);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
  } else {
    h = parseInt(m[4], 10);
    min = 0;
    const ampm = m[5].toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
  }

  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
