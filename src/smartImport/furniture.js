// Sprint 5A: strips obvious non-gig "page furniture" out of a whole-webpage
// text paste before line-based parsing runs -- nav labels, cookie banners,
// footers, repeated menu text, UI-chrome link/button text ("View Details",
// "Buy Tickets"), pagination and promotional-banner boilerplate. Deliberately
// conservative: a false negative (junk that slips through and becomes an
// ignorable "unparseable" row) is cheap; a false positive (a real gig line
// silently discarded) is not. Only applied to line-based text input --
// CSV/TSV rows are already structured and never go through this pass, and
// marker-anchored profiles (msm-gig-guide) don't run this filter at all --
// see sourceProfiles.js's `filtersFurniture` flag.

const DENY_LIST_RE = new RegExp(
  "^(privacy policy|terms(\\s+(and|&)\\s+conditions)?|cookie(s)?( policy)?|" +
  "©|all rights reserved|subscribe|follow us|back to top|skip to content)",
  "i"
);

// UI-chrome link/button text, pagination and promotional-banner boilerplate.
// Unlike DENY_LIST_RE above (a *prefix* match -- safe there because none of
// those phrases are also plausible sentence openers), several of these are
// common enough words on their own ("Directions", "More Info", "Next") that
// they must match the *whole* line, leading/trailing arrows aside (e.g.
// "« Previous", "Next »") -- otherwise a real sentence that happens to
// start with one of these words
// ("Directions to the venue are down Mill Lane") would be silently
// discarded. Kept as a second, separately-anchored list rather than folded
// into DENY_LIST_RE so the two matching styles don't get confused.
const UI_CHROME_RE = new RegExp(
  "^\\s*[»›>→«‹<]*\\s*(" +
    "view details|read more|buy tickets|book now|find out more|more info|" +
    "share event|add to calendar|directions|load more|" +
    "promote your event|add your event|" +
    "next|previous|prev|page \\d+(\\s+of\\s+\\d+)?" +
  ")\\s*[»›>→«‹<]*\\s*$",
  "i"
);

const URL_ONLY_RE = /^https?:\/\/\S+$/i;

const MIN_LEN_WITHOUT_DIGIT = 4;

function isTooShortWithNoDigit(line) {
  return line.length < MIN_LEN_WITHOUT_DIGIT && !/\d/.test(line);
}

function isDenyListed(line) {
  const trimmed = line.trim();
  return DENY_LIST_RE.test(trimmed) || UI_CHROME_RE.test(trimmed);
}

function isUrlOnly(line) {
  return URL_ONLY_RE.test(line.trim());
}

// Lines repeated more than twice in the same paste are treated as
// nav/footer repetition from selecting a whole page (a real gig list very
// rarely repeats an identical line 3+ times).
const REPEAT_THRESHOLD = 2;

export function filterPageFurniture(lines) {
  const counts = new Map();
  for (const line of lines) {
    const key = line.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const keptLines = [];
  let discardedCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue; // blank lines are never "furniture", just skipped silently as today's parser already does

    const key = line;
    const isRepeated = (counts.get(key) || 0) > REPEAT_THRESHOLD;

    if (isTooShortWithNoDigit(line) || isDenyListed(line) || isUrlOnly(line) || isRepeated) {
      discardedCount++;
      continue;
    }
    keptLines.push(rawLine);
  }

  return { keptLines, discardedCount };
}
