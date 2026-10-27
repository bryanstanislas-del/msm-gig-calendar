import { describe, it, expect } from "vitest";
import { STATUS, applicationStatus, isValidDateOnly, londonDateOf, daysBetween, formatDateOnly, deadlineSummary } from "./status.js";

const listing = (application, extra = {}) => ({ verified: true, application, ...extra });
const at = (iso, l) => applicationStatus(l, londonDateOf(new Date(iso)));

describe("isValidDateOnly", () => {
  it("accepts real calendar days", () => {
    expect(isValidDateOnly("2027-03-28")).toBe(true);
    expect(isValidDateOnly("2028-02-29")).toBe(true);
  });
  it("rejects malformed or impossible dates and non-strings", () => {
    for (const v of ["2027-02-29", "2027-02-30", "2027-13-01", "2027-00-10", "2027-1-5", "28/03/2027", "2027-03-28T00:00", "", null, undefined, 20270328, {}]) {
      expect(isValidDateOnly(v)).toBe(false);
    }
  });
});

describe("londonDateOf across BST changes (2027)", () => {
  it("BST starts 28 March 2027 at 01:00 UTC", () => {
    expect(londonDateOf(new Date("2027-03-27T23:59:59Z"))).toBe("2027-03-27");
    expect(londonDateOf(new Date("2027-03-28T00:30:00Z"))).toBe("2027-03-28"); // 00:30 GMT
    expect(londonDateOf(new Date("2027-03-28T22:59:59Z"))).toBe("2027-03-28"); // 23:59:59 BST
    expect(londonDateOf(new Date("2027-03-28T23:00:00Z"))).toBe("2027-03-29"); // 00:00 BST
  });
  it("BST ends 31 October 2027 at 01:00 UTC", () => {
    expect(londonDateOf(new Date("2027-10-30T22:59:59Z"))).toBe("2027-10-30"); // 23:59:59 BST
    expect(londonDateOf(new Date("2027-10-30T23:00:00Z"))).toBe("2027-10-31"); // 00:00 BST
    expect(londonDateOf(new Date("2027-10-31T23:59:59Z"))).toBe("2027-10-31"); // 23:59:59 GMT
    expect(londonDateOf(new Date("2027-11-01T00:00:00Z"))).toBe("2027-11-01");
  });
});

describe("applicationStatus (date-only deadlines in Europe/London)", () => {
  it("deadline on BST start day: open through 23:59:59 BST, closed from London midnight", () => {
    const l = listing({ opens: "2027-01-10", closes: "2027-03-28" });
    expect(at("2027-03-28T00:30:00Z", l)).toMatchObject({ status: STATUS.OPEN, daysLeft: 0 });
    expect(at("2027-03-28T22:59:59Z", l).status).toBe(STATUS.OPEN);
    expect(at("2027-03-28T23:00:00Z", l).status).toBe(STATUS.CLOSED);
  });
  it("deadline on BST end day: open through 23:59:59 GMT", () => {
    const l = listing({ opens: "2026-10-01", closes: "2027-10-31" });
    expect(at("2027-10-31T23:59:59Z", l)).toMatchObject({ status: STATUS.OPEN, daysLeft: 0 });
    expect(at("2027-11-01T00:00:00Z", l).status).toBe(STATUS.CLOSED);
  });
  it("deadline the day before BST ends closes at 23:00 UTC (midnight BST)", () => {
    const l = listing({ opens: "2026-10-01", closes: "2027-10-30" });
    expect(at("2027-10-30T22:59:59Z", l).status).toBe(STATUS.OPEN);
    expect(at("2027-10-30T23:00:00Z", l).status).toBe(STATUS.CLOSED);
  });
  it("opening day boundary is inclusive", () => {
    const l = listing({ opens: "2027-01-10", closes: "2027-03-28" });
    expect(applicationStatus(l, "2027-01-09")).toMatchObject({ status: STATUS.NOT_YET_OPEN, daysUntilOpen: 1 });
    expect(applicationStatus(l, "2027-01-10")).toMatchObject({ status: STATUS.OPEN, daysLeft: 77 });
  });
  it("expiry: last day open, next day closed", () => {
    const l = listing({ opens: "2026-06-01", closes: "2026-10-01" });
    expect(applicationStatus(l, "2026-10-01").status).toBe(STATUS.OPEN);
    expect(applicationStatus(l, "2026-10-02").status).toBe(STATUS.CLOSED);
  });
  it("missing opening date: open until the deadline", () => {
    expect(applicationStatus(listing({ closes: "2027-01-31" }), "2026-12-01").status).toBe(STATUS.OPEN);
  });
  it("never reports open for unverified, missing or invalid data", () => {
    const today = "2026-12-01";
    expect(applicationStatus(listing({ opens: "2026-10-01", closes: "2027-01-31" }, { verified: false }), today).status).toBe(STATUS.UNVERIFIED);
    expect(applicationStatus({ application: { closes: "2027-01-31" } }, today).status).toBe(STATUS.UNVERIFIED);
    expect(applicationStatus(listing({ opens: "2026-10-01", closes: null }), today).reason).toMatch(/Deadline not known/);
    expect(applicationStatus(listing({ opens: "2026-10-01" }), today).status).toBe(STATUS.UNVERIFIED);
    expect(applicationStatus(listing({ closes: "2027-02-30" }), today).reason).toMatch(/Deadline date is invalid/);
    expect(applicationStatus(listing({ opens: "nope", closes: "2027-01-31" }), today).reason).toMatch(/Opening date is invalid/);
    expect(applicationStatus(listing({ opens: "2027-02-01", closes: "2027-01-31" }), today).reason).toMatch(/after the deadline/);
    expect(applicationStatus(listing(undefined), today).status).toBe(STATUS.UNVERIFIED);
    expect(applicationStatus(null, today).status).toBe(STATUS.UNVERIFIED);
  });
});

describe("formatting", () => {
  it("formats date-only values without timezone drift", () => {
    expect(formatDateOnly("2027-03-28")).toBe("28 March 2027");
    expect(formatDateOnly("2027-10-31")).toBe("31 October 2027");
    expect(formatDateOnly("bad")).toBeNull();
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(daysBetween("2027-10-30", "2027-11-01")).toBe(2);
  });
  it("summarises deadlines", () => {
    const l = listing({ opens: "2026-10-01", closes: "2026-11-05" });
    expect(deadlineSummary(applicationStatus(l, "2026-11-05"), l)).toBe("Closes today (5 November 2026)");
    expect(deadlineSummary(applicationStatus(l, "2026-11-04"), l)).toBe("Closes tomorrow (5 November 2026)");
    expect(deadlineSummary(applicationStatus(l, "2026-10-27"), l)).toBe("Closes 5 November 2026 · 9 days left");
    expect(deadlineSummary(applicationStatus(l, "2026-11-06"), l)).toBe("Closed 5 November 2026");
  });
});
