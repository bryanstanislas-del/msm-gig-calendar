// Festival Hub -- browser-local shortlist and application progress.
//
// Stored only in this browser (localStorage, one versioned key). Nothing
// is sent anywhere. Only listing ids, a progress stage, an outcome and
// yes/no checklist ticks are kept -- never free text, names, emails,
// phone numbers or any other contact details.
//
// Every value read back is validated; anything unexpected is dropped, so
// a hand-edited or corrupted entry can never break the page.

export const STORAGE_KEY = "msm.festivalHub.v1";
export const STORAGE_VERSION = 1;
export const MAX_SAVED = 200;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const STAGES = Object.freeze([
  { value: "interested", label: "Interested" },
  { value: "preparing", label: "Preparing" },
  { value: "applied", label: "Applied" },
  { value: "outcome", label: "Outcome received" },
]);

export const OUTCOMES = Object.freeze([
  { value: "pending", label: "Not recorded" },
  { value: "offered", label: "Offered a slot" },
  { value: "unsuccessful", label: "Unsuccessful" },
  { value: "no-reply", label: "No reply" },
]);

export const CHECKLIST = Object.freeze([
  { key: "epk", label: "EPK (electronic press kit)", hint: "One link with your best photo, short bio, music and live video." },
  { key: "music", label: "Music links", hint: "Two or three of your strongest tracks on a public streaming or Bandcamp page." },
  { key: "liveVideo", label: "Live video", hint: "A recent, unedited live clip — bookers want to see you on stage." },
  { key: "bio", label: "Short bio", hint: "50–100 words: who you are, where you're from, recent highlights." },
  { key: "techSpec", label: "Tech spec", hint: "Line-up, instruments, inputs and anything you need from the stage." },
  { key: "stagePlot", label: "Stage plot", hint: "A simple diagram of where everyone stands and plugs in." },
  { key: "contact", label: "Booking contact ready", hint: "Decide who handles bookings. Keep your contact details in your own application — the hub never stores them." },
]);

const STAGE_VALUES = new Set(STAGES.map((s) => s.value));
const OUTCOME_VALUES = new Set(OUTCOMES.map((o) => o.value));
const CHECKLIST_KEYS = CHECKLIST.map((c) => c.key);

export const isValidId = (id) => typeof id === "string" && ID_PATTERN.test(id);

export function emptyEntry() {
  return { stage: "interested", outcome: "pending", checklist: {} };
}

// Cleans one stored entry; returns null if it is unusable.
export function sanitiseEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const stage = STAGE_VALUES.has(raw.stage) ? raw.stage : "interested";
  const outcome = OUTCOME_VALUES.has(raw.outcome) ? raw.outcome : "pending";
  const checklist = {};
  const rawChecklist = raw.checklist && typeof raw.checklist === "object" ? raw.checklist : {};
  for (const key of CHECKLIST_KEYS) {
    if (rawChecklist[key] === true) checklist[key] = true;
  }
  return { stage, outcome, checklist };
}

// Cleans a whole stored document. `knownIds` (optional Set) drops entries
// for listings that no longer exist.
export function sanitiseState(raw, knownIds) {
  const items = {};
  let dropped = 0;
  if (!raw || typeof raw !== "object" || raw.version !== STORAGE_VERSION || !raw.items || typeof raw.items !== "object" || Array.isArray(raw.items)) {
    return { items, dropped: raw == null ? 0 : 1, invalid: raw != null };
  }
  for (const [id, value] of Object.entries(raw.items)) {
    if (Object.keys(items).length >= MAX_SAVED) { dropped++; continue; }
    if (!isValidId(id) || (knownIds && !knownIds.has(id))) { dropped++; continue; }
    const entry = sanitiseEntry(value);
    if (!entry) { dropped++; continue; }
    items[id] = entry;
  }
  return { items, dropped, invalid: false };
}

function getStorage(win) {
  try {
    const s = win && win.localStorage;
    return s || null;
  } catch {
    return null;
  }
}

// Returns { items, problem } where problem is null | "unavailable" | "corrupt".
export function loadSaved(win = typeof window !== "undefined" ? window : undefined, knownIds) {
  const storage = getStorage(win);
  if (!storage) return { items: {}, problem: "unavailable" };
  let text;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { items: {}, problem: "unavailable" };
  }
  if (text == null) return { items: {}, problem: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { items: {}, problem: "corrupt" };
  }
  const { items, dropped, invalid } = sanitiseState(parsed, knownIds);
  return { items, problem: invalid || dropped > 0 ? "corrupt" : null };
}

// Returns true if the write succeeded.
export function persistSaved(items, win = typeof window !== "undefined" ? window : undefined) {
  const storage = getStorage(win);
  if (!storage) return false;
  const clean = sanitiseState({ version: STORAGE_VERSION, items }).items;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, items: clean }));
    return true;
  } catch {
    return false;
  }
}

export function checklistProgress(entry) {
  const done = CHECKLIST_KEYS.filter((k) => entry?.checklist?.[k]).length;
  return { done, total: CHECKLIST_KEYS.length };
}
