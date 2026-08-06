// Sprint 5A: strips obvious non-gig "page furniture" out of a whole-webpage
// text paste before line-based parsing runs -- nav labels, cookie banners,
// footers, repeated menu text. Deliberately conservative: a false negative
// (junk that slips through and becomes an ignorable "unparseable" row) is
// cheap; a false positive (a real gig line silently discarded) is not. Only
// applied to line-based text input -- CSV/TSV rows are already structured
// and never go through this pass.

const DENY_LIST_RE = new RegExp(
  "^(privacy policy|terms(\\s+(and|&)\\s+conditions)?|cookie(s)?( policy)?|" +
  "©|all rights reserved|subscribe|follow us|back to top|skip to content)",
  "i"
);

const URL_ONLY_RE = /^https?:\/\/\S+$/i;

const MIN_LEN_WITHOUT_DIGIT = 4;

function isTooShortWithNoDigit(line) {
  return line.length < MIN_LEN_WITHOUT_DIGIT && !/\d/.test(line);
}

function isDenyListed(line) {
  return DENY_LIST_RE.test(line.trim());
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
