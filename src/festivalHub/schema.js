// Festival Hub -- listing schema and editorial validation.
//
// One record shape is used for real (curatedListings.js) and demo
// (demoFixtures.js) data, so both go through the same status logic and UI.
// They are never mixed: see listings.js. The full field list with comments
// is at the top of curatedListings.js.
//
// A listing carries TWO separate verifications:
//   listingVerification -- the festival itself and its 2027 edition;
//   application         -- the 2027 application window, with its own
//                          evidenced state, source, checked date and note.
//
// validateListing() returns { errors, warnings }. Records with any error
// are not shown; curated.test.js requires the real data to have none.

import { HUB_EDITION_YEAR, UK_REGIONS, APPLICATION_STATES, LISTING_VERIFICATION, PERFORMER_PAY, ALL_GENRES } from "./constants.js";
import { isValidDateOnly, isValidTime } from "./dates.js";
import { isValidId } from "./storage.js";

export { HUB_EDITION_YEAR, UK_REGIONS, APPLICATION_STATES, LISTING_VERIFICATION, PERFORMER_PAY, ALL_GENRES };

const LISTING_KEYS = new Set(["id", "name", "isDemo", "editionYear", "region", "location", "festivalDates", "festivalDatesText",
  "genres", "officialUrl", "eligibility", "applicationFee", "performerPay", "listingVerification", "application"]);
const VERIFICATION_KEYS = new Set(["status", "editionConfirmed", "sourceUrl", "extraSourceUrls", "checkedDate", "sourcePublishedDate", "evidence"]);
const APPLICATION_KEYS = new Set(["status", "editionYear", "opens", "closes", "closesTime", "closesText",
  "yearInferred", "yearConflict", "noPublishedDeadline", "url", "urlEdition", "email", "instructions",
  "sourceUrl", "extraSourceUrls", "checkedDate", "sourcePublishedDate", "evidence"]);

const MAX_TEXT = 500;
const MAX_EVIDENCE = 300;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// Placeholder / documentation hosts -- allowed (and required) only in demo data.
const EXAMPLE_HOSTS = /(^|\.)(example\.(org|com|net)|localhost|invalid|test)$/i;

function httpsUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

const nonEmpty = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const nullableText = (v, max = MAX_TEXT) => v === null || v === undefined || nonEmpty(v, max);
const isSet = (v) => v !== undefined && v !== null;

function unknownKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) errors.push(`${where}: unknown field "${k}"`);
}

function checkUrl(value, where, { allowExample }, errors) {
  const u = httpsUrl(value);
  if (!u) { errors.push(`${where} must be an https URL`); return; }
  if (!allowExample && EXAMPLE_HOSTS.test(u.hostname)) errors.push(`${where} uses a placeholder host (${u.hostname})`);
  if (allowExample && !EXAMPLE_HOSTS.test(u.hostname)) errors.push(`${where} in demo data must use example.org`);
}

function checkEvidence(obj, where, opts, errors) {
  checkUrl(obj.sourceUrl, `${where}.sourceUrl`, opts, errors);
  if (isSet(obj.extraSourceUrls)) {
    if (!Array.isArray(obj.extraSourceUrls) || obj.extraSourceUrls.length > 5) errors.push(`${where}.extraSourceUrls must be a list of up to 5 URLs`);
    else obj.extraSourceUrls.forEach((u, i) => checkUrl(u, `${where}.extraSourceUrls[${i}]`, opts, errors));
  }
  if (!isValidDateOnly(obj.checkedDate)) errors.push(`${where}.checkedDate must be YYYY-MM-DD`);
  else if (opts.today && obj.checkedDate > opts.today) errors.push(`${where}.checkedDate is in the future`);
  if (!nonEmpty(obj.evidence, MAX_EVIDENCE)) errors.push(`${where}.evidence must be a note of 1–${MAX_EVIDENCE} characters`);
  // Date the source page says it was published/updated (if shown) -- not the date we looked at it.
  if (isSet(obj.sourcePublishedDate)) {
    if (!isValidDateOnly(obj.sourcePublishedDate)) errors.push(`${where}.sourcePublishedDate must be YYYY-MM-DD or null`);
    else if (isValidDateOnly(obj.checkedDate) && obj.sourcePublishedDate > obj.checkedDate) errors.push(`${where}.sourcePublishedDate is after checkedDate`);
  }
}

// opts: { demo: boolean, today: "YYYY-MM-DD" }
export function validateListing(listing, { demo = false, today } = {}) {
  const errors = [];
  const warnings = [];
  const urlOpts = { allowExample: demo, today };
  if (!listing || typeof listing !== "object" || Array.isArray(listing)) return { errors: ["not an object"], warnings };

  unknownKeys(listing, LISTING_KEYS, "listing", errors);
  if (!isValidId(listing.id)) errors.push("id must be a lowercase slug (a-z, 0-9, -), max 64");
  if (demo) {
    if (listing.isDemo !== true) errors.push("demo record must have isDemo: true");
    if (isValidId(listing.id) && !listing.id.startsWith("demo-")) errors.push('demo id must start with "demo-"');
  } else {
    if (listing.isDemo !== undefined) errors.push("real record must not have isDemo");
    if (typeof listing.id === "string" && listing.id.startsWith("demo-")) errors.push('real id must not start with "demo-"');
  }
  if (!nonEmpty(listing.name, 120)) errors.push("name is required (max 120)");
  if (listing.editionYear !== HUB_EDITION_YEAR) errors.push(`editionYear must be ${HUB_EDITION_YEAR}`);
  if (!UK_REGIONS.includes(listing.region)) errors.push(`region must be one of: ${UK_REGIONS.join(", ")}`);
  if (!nullableText(listing.location, 160)) errors.push("location must be null or text (max 160)");
  if (!Array.isArray(listing.genres) || !listing.genres.every((g) => nonEmpty(g, 40))) errors.push("genres must be an array of short strings (may be empty)");
  else if (listing.genres.includes(ALL_GENRES) && listing.genres.length > 1) errors.push(`"${ALL_GENRES}" must be the only genre when used`);
  if (!nullableText(listing.eligibility)) errors.push(`eligibility must be null or text (max ${MAX_TEXT})`);
  if (!nullableText(listing.applicationFee, 160)) errors.push("applicationFee must be null or text (max 160)");
  if (!nullableText(listing.festivalDatesText, 80)) errors.push("festivalDatesText must be null or short text (max 80)");
  checkUrl(listing.officialUrl, "officialUrl", urlOpts, errors);

  // Performer pay is about being paid to play -- separate from any application fee.
  if (isSet(listing.performerPay)) {
    const pp = listing.performerPay;
    if (typeof pp !== "object") errors.push("performerPay must be null or { status, note }");
    else {
      unknownKeys(pp, new Set(["status", "note"]), "performerPay", errors);
      if (!Object.values(PERFORMER_PAY).includes(pp.status)) errors.push(`performerPay.status must be one of: ${Object.values(PERFORMER_PAY).join(", ")}`);
      if (!nullableText(pp.note, 200)) errors.push("performerPay.note must be null or text (max 200)");
    }
  }

  // Festival dates: null until the 2027 dates are published.
  const fd = listing.festivalDates;
  let festivalStart = null;
  if (fd !== null) {
    if (!fd || typeof fd !== "object") errors.push("festivalDates must be null or { start, end }");
    else {
      unknownKeys(fd, new Set(["start", "end"]), "festivalDates", errors);
      if (!isValidDateOnly(fd.start)) errors.push("festivalDates.start must be YYYY-MM-DD");
      else {
        festivalStart = fd.start;
        if (Number(fd.start.slice(0, 4)) !== listing.editionYear) errors.push("festivalDates.start is not in the edition year");
      }
      if (isSet(fd.end) && !isValidDateOnly(fd.end)) errors.push("festivalDates.end must be YYYY-MM-DD or null");
      else if (fd.end && festivalStart && fd.end < festivalStart) errors.push("festivalDates.end is before start");
    }
  }

  // Listing verification.
  const lv = listing.listingVerification;
  if (!lv || typeof lv !== "object") errors.push("listingVerification is required");
  else {
    unknownKeys(lv, VERIFICATION_KEYS, "listingVerification", errors);
    if (!Object.values(LISTING_VERIFICATION).includes(lv.status)) errors.push("listingVerification.status must be verified | unverified");
    if (lv.status === LISTING_VERIFICATION.VERIFIED) {
      checkEvidence(lv, "listingVerification", urlOpts, errors);
      if (typeof lv.editionConfirmed !== "boolean") errors.push(`listingVerification.editionConfirmed (is the ${HUB_EDITION_YEAR} edition confirmed?) must be true/false`);
    } else if (isSet(lv.editionConfirmed) && lv.editionConfirmed !== false) {
      errors.push("an unverified listing cannot have a confirmed edition");
    }
  }

  // Application window.
  const ap = listing.application;
  if (!ap || typeof ap !== "object") errors.push("application is required");
  else {
    unknownKeys(ap, APPLICATION_KEYS, "application", errors);
    const states = Object.values(APPLICATION_STATES);
    if (!states.includes(ap.status)) errors.push(`application.status must be one of: ${states.join(", ")}`);
    if (ap.status !== APPLICATION_STATES.UNVERIFIED) {
      checkEvidence(ap, "application", urlOpts, errors);
      if (ap.editionYear !== listing.editionYear) errors.push("application.editionYear must match the listing edition (evidence must be for the 2027 edition)");
      if (lv?.editionConfirmed !== true) errors.push(`application.status "${ap.status}" needs listingVerification.editionConfirmed: true (use "unverified")`);
    } else if (isSet(ap.sourceUrl) || isSet(ap.checkedDate) || isSet(ap.evidence)) {
      // An unconfirmed window may still record what was seen, so sources always show.
      checkEvidence(ap, "application", urlOpts, errors);
    }
    if (ap.status === APPLICATION_STATES.UNVERIFIED && isSet(ap.url)) errors.push("an unverified window must not carry an application url");
    for (const k of ["opens", "closes"]) {
      if (isSet(ap[k]) && !isValidDateOnly(ap[k])) errors.push(`application.${k} must be YYYY-MM-DD or null`);
    }
    if (isValidDateOnly(ap.opens) && isValidDateOnly(ap.closes) && ap.opens > ap.closes) errors.push("application.opens is after closes");
    if (festivalStart && isValidDateOnly(ap.closes) && ap.closes >= festivalStart) errors.push("application.closes is on/after the festival start");
    // Exact deadline time only when the source states one (UK local time).
    if (isSet(ap.closesTime)) {
      if (!isValidTime(ap.closesTime)) errors.push("application.closesTime must be HH:MM (24h, UK time) or null");
      if (!ap.closes) errors.push("application.closesTime needs application.closes");
    }
    if (isSet(ap.closesText) && !nonEmpty(ap.closesText, 200)) errors.push("application.closesText must be the source's wording (max 200) or null");
    for (const k of ["yearInferred", "yearConflict", "noPublishedDeadline"]) {
      if (isSet(ap[k]) && typeof ap[k] !== "boolean") errors.push(`application.${k} must be true/false`);
    }
    if (ap.yearInferred === true && !ap.closes && !ap.opens) errors.push("application.yearInferred needs a recorded date");
    if (ap.yearInferred === true && !ap.closesText) warnings.push("year inferred: record the source's exact wording in application.closesText");
    if (ap.yearConflict === true && ap.status === APPLICATION_STATES.OPEN) warnings.push("yearConflict: shown as Unverified, not open");
    if (ap.noPublishedDeadline === true && ap.closes) errors.push("application.noPublishedDeadline cannot have a closing date");
    if (ap.status === APPLICATION_STATES.OPEN && isValidDateOnly(ap.opens) && isValidDateOnly(ap.checkedDate) && ap.opens > ap.checkedDate) {
      errors.push("status open but application.opens is after checkedDate (use announced)");
    }
    if (ap.status === APPLICATION_STATES.ANNOUNCED && !isValidDateOnly(ap.opens)) errors.push("announced window needs application.opens");
    if (ap.status === APPLICATION_STATES.OPEN && !ap.closes && ap.noPublishedDeadline !== true) {
      warnings.push("open with no closing date and no 'no published deadline' evidence: shown as Unverified");
    }
    if (isSet(ap.url)) {
      checkUrl(ap.url, "application.url", urlOpts, errors);
      if (!Number.isInteger(ap.urlEdition)) errors.push("application.urlEdition (year the form/page is for) is required with application.url");
      if (ap.status === APPLICATION_STATES.OPEN && ap.urlEdition !== listing.editionYear) errors.push("an open window's application.url must be for the listing edition");
    } else if (isSet(ap.urlEdition)) {
      errors.push("application.urlEdition given without application.url");
    }
    // Public organiser address shown as text only; the hub never sends mail.
    if (isSet(ap.email) && !(typeof ap.email === "string" && EMAIL_RE.test(ap.email) && ap.email.length <= 120)) errors.push("application.email must be a plain email address or null");
    if (!nullableText(ap.instructions, 300)) errors.push("application.instructions must be null or text (max 300)");
  }
  if (lv?.status === LISTING_VERIFICATION.UNVERIFIED && ap && ap.status !== APPLICATION_STATES.UNVERIFIED) {
    warnings.push("listing is unverified, so its application status is shown as Unverified");
  }
  return { errors, warnings };
}

// Validates a whole data set: duplicate ids are errors too.
// Returns { valid: listing[], problems: [{ id, errors, warnings }] }.
export function validateDirectory(listings, opts = {}) {
  const valid = [];
  const problems = [];
  const seen = new Set();
  (Array.isArray(listings) ? listings : []).forEach((listing, i) => {
    const { errors, warnings } = validateListing(listing, opts);
    const id = listing?.id ?? `#${i}`;
    if (seen.has(id)) errors.push("duplicate id");
    seen.add(id);
    if (errors.length || warnings.length) problems.push({ id, errors, warnings });
    if (!errors.length) valid.push(listing);
  });
  return { valid, problems };
}
