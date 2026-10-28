import { describe, it, expect } from "vitest";
import { isValidDateOnly, londonDateOf, londonInstant, daysBetween, formatDateOnly } from "./dates.js";
import { STATUS, FRESHNESS_DAYS, applicationStatus, deadlineOf, deadlineSummary, formatDeadline } from "./status.js";

const at = (iso) => new Date(iso);
// A verified 2027 listing whose application evidence was checked on `checked`.
const listing = (application, { editionConfirmed = true, checked = "2027-03-01" } = {}) => ({
  editionYear: 2027,
  listingVerification: { status: "verified", editionConfirmed, sourceUrl: "https://x.test/", checkedDate: checked, evidence: "e" },
  application: { editionYear: 2027, checkedDate: checked, sourceUrl: "https://x.test/", evidence: "e", ...application },
});

describe("dates", () => {
  it("validates strict date-only strings", () => {
    expect(isValidDateOnly("2028-02-29")).toBe(true);
    for (const v of ["2027-02-29", "2027-13-01", "2027-1-5", "28/03/2027", "", null, 20270328]) expect(isValidDateOnly(v)).toBe(false);
  });
  it("London calendar date across BST start (28 Mar 2027) and end (31 Oct 2027)", () => {
    expect(londonDateOf(at("2027-03-28T22:59:59Z"))).toBe("2027-03-28");
    expect(londonDateOf(at("2027-03-28T23:00:00Z"))).toBe("2027-03-29");
    expect(londonDateOf(at("2027-10-30T23:00:00Z"))).toBe("2027-10-31");
    expect(londonDateOf(at("2027-10-31T23:59:59Z"))).toBe("2027-10-31");
  });
  it("converts UK wall-clock times to instants in GMT and BST", () => {
    expect(londonInstant("2026-12-01", "21:00").toISOString()).toBe("2026-12-01T21:00:00.000Z");
    expect(londonInstant("2027-07-01", "21:00").toISOString()).toBe("2027-07-01T20:00:00.000Z");
    expect(londonInstant("2027-03-28", "18:00").toISOString()).toBe("2027-03-28T17:00:00.000Z");
    expect(londonInstant("2027-10-31", "18:00").toISOString()).toBe("2027-10-31T18:00:00.000Z");
  });
  it("formats and counts days without timezone drift", () => {
    expect(formatDateOnly("2027-10-31")).toBe("31 October 2027");
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
  });
});

describe("applicationStatus: never open without explicit, current 2027 evidence", () => {
  const now = at("2027-03-10T12:00:00Z");
  it("open with a deadline", () => {
    expect(applicationStatus(listing({ status: "open", closes: "2027-03-20" }), now)).toMatchObject({ status: STATUS.OPEN, daysLeft: 10 });
  });
  it("open with explicit no-published-deadline evidence", () => {
    expect(applicationStatus(listing({ status: "open", noPublishedDeadline: true }), now)).toMatchObject({ status: STATUS.OPEN, noDeadline: true, daysLeft: null });
  });
  it("open without deadline or no-deadline evidence is Unverified", () => {
    expect(applicationStatus(listing({ status: "open" }), now).status).toBe(STATUS.UNVERIFIED);
  });
  it("unverified festival, unconfirmed edition, unverified window and wrong edition are Unverified", () => {
    const l = listing({ status: "open", closes: "2027-03-20" });
    expect(applicationStatus({ ...l, listingVerification: { status: "unverified" } }, now).status).toBe(STATUS.UNVERIFIED);
    expect(applicationStatus(listing({ status: "open", closes: "2027-03-20" }, { editionConfirmed: false }), now).reason).toMatch(/edition hasn't been confirmed/);
    expect(applicationStatus(listing({ status: "unverified" }), now).reason).toMatch(/application window is unconfirmed/);
    expect(applicationStatus(listing({ status: "open", closes: "2027-03-20", editionYear: 2026 }), now).reason).toMatch(/not for the 2027 edition/);
    expect(applicationStatus(null, now).status).toBe(STATUS.UNVERIFIED);
  });
  it("conflicting official years are Unverified, even if recorded open", () => {
    expect(applicationStatus(listing({ status: "open", closes: "2027-03-20", yearConflict: true }), now).reason).toMatch(/disagree/);
  });
  it("missing or future check date is Unverified", () => {
    expect(applicationStatus(listing({ status: "open", closes: "2027-03-20", checkedDate: undefined }), now).status).toBe(STATUS.UNVERIFIED);
    expect(applicationStatus(listing({ status: "open", closes: "2027-03-20", checkedDate: "2027-04-01" }), now).status).toBe(STATUS.UNVERIFIED);
  });
  it("not yet announced, announced (future), announced but date reached", () => {
    expect(applicationStatus(listing({ status: "not-yet-announced" }), now).status).toBe(STATUS.NOT_YET_ANNOUNCED);
    expect(applicationStatus(listing({ status: "announced", opens: "2027-03-15", closes: "2027-04-01" }), now)).toMatchObject({ status: STATUS.NOT_YET_OPEN, daysUntilOpen: 5 });
    expect(applicationStatus(listing({ status: "announced", opens: "2027-03-10", closes: "2027-04-01" }), now).status).toBe(STATUS.UNVERIFIED);
  });
  it("closed per source", () => {
    expect(applicationStatus(listing({ status: "closed" }), now).status).toBe(STATUS.CLOSED);
  });
});

describe("deadlines: stated time vs date only", () => {
  const hanwell = listing({ status: "open", closes: "2026-12-01", closesTime: "21:00" }, { checked: "2026-11-20" });
  it("a stated time closes at that UK time, not end of day", () => {
    expect(applicationStatus(hanwell, at("2026-12-01T20:59:59Z")).status).toBe(STATUS.OPEN);
    expect(applicationStatus(hanwell, at("2026-12-01T21:00:00Z")).status).toBe(STATUS.CLOSED);
  });
  it("a 6pm deadline in BST closes at 17:00 UTC", () => {
    const l = listing({ status: "open", closes: "2027-06-01", closesTime: "18:00" }, { checked: "2027-05-20" });
    expect(applicationStatus(l, at("2027-06-01T16:59:59Z")).status).toBe(STATUS.OPEN);
    expect(applicationStatus(l, at("2027-06-01T17:00:00Z")).status).toBe(STATUS.CLOSED);
  });
  it("date-only deadline: still shown open on the day (with 'time not stated'), closed the next London day", () => {
    const l = listing({ status: "open", closes: "2027-03-28" }, { checked: "2027-03-20" });
    expect(applicationStatus(l, at("2027-03-28T22:59:59Z")).status).toBe(STATUS.OPEN); // 23:59:59 BST
    expect(applicationStatus(l, at("2027-03-28T23:00:00Z")).status).toBe(STATUS.CLOSED);
    const l2 = listing({ status: "open", closes: "2027-10-31" }, { checked: "2027-10-20" });
    expect(applicationStatus(l2, at("2027-10-31T23:59:59Z")).status).toBe(STATUS.OPEN); // GMT again
    expect(applicationStatus(l2, at("2027-11-01T00:00:00Z")).status).toBe(STATUS.CLOSED);
    expect(deadlineSummary(applicationStatus(l2, at("2027-10-31T12:00:00Z")), l2)).toBe("Closes today (time not stated)");
  });
  it("formats deadlines honestly, keeping inferred years marked", () => {
    expect(formatDeadline(deadlineOf(hanwell))).toBe("1 December 2026, 21:00 UK time");
    expect(formatDeadline(deadlineOf(listing({ closes: "2027-01-08", yearInferred: true }))))
      .toBe("8 January 2027 (year inferred) (time not stated — apply earlier)");
    expect(deadlineOf(listing({ closes: null }))).toBeNull();
    expect(deadlineOf(listing({ closes: "2027-02-30" }))).toBeNull();
  });
});

describe("freshness", () => {
  const l = listing({ status: "open", closes: "2027-06-01" }, { checked: "2027-03-01" });
  it(`open stays open for ${FRESHNESS_DAYS} days after the check, then needs re-checking`, () => {
    expect(applicationStatus(l, at("2027-03-31T12:00:00Z")).status).toBe(STATUS.OPEN);
    expect(applicationStatus(l, at("2027-04-01T12:00:00Z"))).toMatchObject({ status: STATUS.UNVERIFIED, stale: true, checkedDaysAgo: 31 });
  });
  it("stale not-yet-announced and announced also need re-checking", () => {
    expect(applicationStatus(listing({ status: "not-yet-announced" }, { checked: "2027-01-01" }), at("2027-03-01T12:00:00Z")).stale).toBe(true);
  });
  it("explicit expiry always wins over staleness", () => {
    expect(applicationStatus(l, at("2027-06-02T12:00:00Z")).status).toBe(STATUS.CLOSED);
    expect(applicationStatus(listing({ status: "closed" }, { checked: "2026-01-01" }), at("2027-06-02T12:00:00Z")).status).toBe(STATUS.CLOSED);
  });
});
