import { describe, it, expect } from "vitest";
import { londonDayStart, reviewDueBefore, londonDate, daysInclusive, isWithinBookedDates, formatDeadline, nextWorkingDayAfter } from "./londonTime.js";

// Same England & Wales holidays seeded by the migration (subset used here).
const HOLIDAYS = ["2026-04-03", "2026-04-06", "2026-12-25", "2026-12-28"];
const iso = (d) => d.toISOString();

describe("Europe/London day boundaries (DST)", () => {
  it("spring forward: 29 Mar 2026 is 23h long", () => {
    expect(iso(londonDayStart("2026-03-29"))).toBe("2026-03-29T00:00:00.000Z");
    expect(iso(londonDayStart("2026-03-30"))).toBe("2026-03-29T23:00:00.000Z");
  });
  it("fall back: 25 Oct 2026 is 25h long", () => {
    expect(londonDayStart("2026-10-26") - londonDayStart("2026-10-25")).toBe(25 * 3600 * 1000);
  });
  it("London date of an instant late in the UTC evening during BST", () => {
    expect(londonDate(new Date("2026-10-15T23:30:00Z"))).toBe("2026-10-16");
    expect(londonDate(new Date("2026-12-15T23:30:00Z"))).toBe("2026-12-15");
  });
});

describe("review deadline = end of next UK working day (exclusive instant)", () => {
  it.each([
    ["Thu -> end of Fri", "2026-10-15T08:00:00Z", "2026-10-16T23:00:00.000Z"],
    ["Fri -> end of Mon", "2026-10-16T17:00:00Z", "2026-10-19T23:00:00.000Z"],
    ["23:30 UTC Thu is Fri in London", "2026-10-15T23:30:00Z", "2026-10-19T23:00:00.000Z"],
    ["Sat -> end of Mon across clock change", "2026-10-24T11:00:00Z", "2026-10-27T00:00:00.000Z"],
    ["Easter Thursday skips Good Fri + Easter Mon", "2026-04-02T09:00:00Z", "2026-04-07T23:00:00.000Z"],
    ["Christmas Eve skips 25th + substitute 28th", "2026-12-24T10:00:00Z", "2026-12-30T00:00:00.000Z"],
  ])("%s", (_l, readyAt, expected) => {
    expect(iso(reviewDueBefore(new Date(readyAt), HOLIDAYS))).toBe(expected);
  });
  it("respects configurable holidays", () => {
    expect(nextWorkingDayAfter("2026-10-15", ["2026-10-16"])).toBe("2026-10-19");
  });
  it("formats the inclusive last day", () => {
    expect(formatDeadline("2026-10-19T23:00:00.000Z")).toBe("end of Mon 19 Oct 2026 (UK time)");
  });
});

describe("inclusive booked-date window", () => {
  it("counts days inclusively", () => {
    expect(daysInclusive("2026-10-20", "2026-10-20")).toBe(1);
    expect(daysInclusive("2026-10-24", "2026-10-26")).toBe(3);
  });
  it("live from 00:00 London on start until 00:00 London after end", () => {
    expect(isWithinBookedDates("2026-10-20", "2026-10-21", new Date("2026-10-19T22:59:59Z"))).toBe(false);
    expect(isWithinBookedDates("2026-10-20", "2026-10-21", new Date("2026-10-19T23:00:00Z"))).toBe(true);
    expect(isWithinBookedDates("2026-10-20", "2026-10-21", new Date("2026-10-21T22:59:59Z"))).toBe(true);
    expect(isWithinBookedDates("2026-10-20", "2026-10-21", new Date("2026-10-21T23:00:00Z"))).toBe(false);
  });
  it("end date on the DST change day ends at GMT midnight", () => {
    expect(isWithinBookedDates("2026-10-24", "2026-10-25", new Date("2026-10-25T23:59:59Z"))).toBe(true);
    expect(isWithinBookedDates("2026-10-24", "2026-10-25", new Date("2026-10-26T00:00:00Z"))).toBe(false);
  });
});
