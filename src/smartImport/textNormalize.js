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
