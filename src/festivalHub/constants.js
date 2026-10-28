// Festival Hub -- shared constants (no imports, so any module can use them).

export const HUB_EDITION_YEAR = 2027;

export const UK_REGIONS = Object.freeze([
  "Scotland", "Wales", "Northern Ireland",
  "North East", "North West", "Yorkshire and the Humber",
  "East Midlands", "West Midlands", "East of England",
  "London", "South East", "South West",
]);

// What the official source says about the 2027 application window, as
// recorded by the editor. The displayed status is derived from this plus
// the date and freshness (status.js) -- dates alone never make a listing open.
export const APPLICATION_STATES = Object.freeze({
  OPEN: "open",                           // source explicitly says 2027 applications are open now
  ANNOUNCED: "announced",                 // source gives a future 2027 opening date
  NOT_YET_ANNOUNCED: "not-yet-announced", // source checked, no 2027 application info yet
  CLOSED: "closed",                       // source says 2027 applications have closed
  UNVERIFIED: "unverified",               // not checked / evidence unclear
});

export const LISTING_VERIFICATION = Object.freeze({ VERIFIED: "verified", UNVERIFIED: "unverified" });

// Whether performers are paid -- separate from any application fee.
export const PERFORMER_PAY = Object.freeze({
  PAID: "paid",
  UNPAID: "unpaid",
  NEGOTIATED: "negotiated",
  NOT_STATED: "not-stated",
});

// Use as the only genre when the official source says all genres are welcome.
// Genre filters treat it as matching every genre.
export const ALL_GENRES = "All genres";
