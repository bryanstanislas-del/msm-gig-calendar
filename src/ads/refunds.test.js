import { describe, it, expect } from "vitest";
import { mergeIntervals, msmLostIntervals, lostTimeRefund, assessRefund, totalSeconds, proposeCorrectionAmendment, elapsedPackageInterval } from "./refunds.js";
import { formatLondonWithOffset } from "./ukWorkingTime.js";

const H = 3600;

describe("agreed worked examples", () => {
  it("£300 / 720 h x 6 h = £2.50", () => {
    expect(lostTimeRefund({ placementPence: 30000, purchasedSeconds: 720 * H, lostSeconds: 6 * H }).pence).toBe(250);
  });
  it("plus a missed initial priority deadline = £152.50", () => {
    const a = assessRefund({ placementPence: 30000, priorityFeePence: 15000, priorityMissedByMsm: true, purchasedSeconds: 720 * H,
      lostIntervals: [["2026-11-02T10:00:00Z", "2026-11-02T16:00:00Z"]] });
    expect(a.lines).toEqual([{ kind: "priority_fee", pence: 15000 }, expect.objectContaining({ kind: "lost_time", pence: 250, lostSeconds: 6 * H })]);
    expect(a.totalPence).toBe(15250);
    expect(a.gates).toEqual([]);
  });
  it("missed priority deadline refunds the full fee even when the campaign starts on time (no lost time)", () => {
    expect(assessRefund({ placementPence: 30000, priorityFeePence: 15000, priorityMissedByMsm: true, purchasedSeconds: 720 * H }).totalPence).toBe(15000);
  });
});

describe("integer money, exact fractions, final-penny rounding only", () => {
  it("fractional: £100 / 720 h x 1 h = 13.888.. p -> 14 p (half-up); exact fraction kept", () => {
    const r = lostTimeRefund({ placementPence: 10000, purchasedSeconds: 720 * H, lostSeconds: H });
    expect(r.pence).toBe(14);
    expect(r.exact).toEqual({ numerator: String(10000 * H), denominator: String(720 * H) });
    expect(lostTimeRefund({ placementPence: 10000, purchasedSeconds: 720 * H, lostSeconds: H, rounding: "down" }).pence).toBe(13);
  });
  it("no intermediate rounding: 3 x 1 h computed together, not 3 x 14 p", () => {
    expect(lostTimeRefund({ placementPence: 10000, purchasedSeconds: 720 * H, lostSeconds: 3 * H }).pence).toBe(42); // 41.67 -> 42
    expect(lostTimeRefund({ placementPence: 10000, purchasedSeconds: 720 * 3600, lostSeconds: 7 * H }).pence).toBe(97); // 97.22 -> 97
  });
  it("capped at the placement charge; whole run lost is a manual gate", () => {
    expect(lostTimeRefund({ placementPence: 30000, purchasedSeconds: 720 * H, lostSeconds: 900 * H }).pence).toBe(30000);
    const a = assessRefund({ placementPence: 30000, purchasedSeconds: 720 * H, lostIntervals: [["2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"]] });
    expect(a.gates).toContain("whole_run_lost");
  });
  it("multi-slot and discount allocations are manual gates", () => {
    expect(assessRefund({ placementPence: 30000, purchasedSeconds: 720 * H, multiPlacement: true, discounted: true }).gates)
      .toEqual(["multi_slot_allocation", "tax_or_discount_allocation"]);
  });
  it("rejects non-integer money/time", () => {
    expect(() => lostTimeRefund({ placementPence: 100.5, purchasedSeconds: 10, lostSeconds: 1 })).toThrow();
  });
});

describe("lost-time attribution (no double counting; advertiser waiting excluded)", () => {
  const bookedFrom = "2026-11-02T00:00:00Z", bookedUntil = "2026-11-04T00:00:00Z";
  it("late review without lost display: approval after deadline but before start -> nothing lost", () => {
    expect(msmLostIntervals({ bookedFrom, bookedUntil, reviewDueAt: "2026-10-30T00:00:00Z", approvedAt: "2026-10-31T12:00:00Z" })).toEqual([]);
  });
  it("review delay into the run counts only from the later of start and deadline", () => {
    const lost = msmLostIntervals({ bookedFrom, bookedUntil, reviewDueAt: "2026-11-02T06:00:00Z", approvedAt: "2026-11-02T12:00:00Z" });
    expect(totalSeconds(lost)).toBe(6 * H);
  });
  it("mixed overlapping review delay + outage are merged; advertiser waiting removed", () => {
    const lost = msmLostIntervals({ bookedFrom, bookedUntil, reviewDueAt: "2026-11-02T00:00:00Z", approvedAt: "2026-11-02T10:00:00Z",
      outages: [["2026-11-02T08:00:00Z", "2026-11-02T14:00:00Z"], ["2026-11-03T20:00:00Z", "2026-11-04T06:00:00Z"]],
      advertiserWaiting: [["2026-11-02T03:00:00Z", "2026-11-02T05:00:00Z"]] });
    // [0,14) minus [3,5) = 12h, plus outage clipped at booking end [20,24) = 4h
    expect(totalSeconds(lost)).toBe(16 * H);
    expect(mergeIntervals([[1, 5], [3, 7], [9, 10]])).toEqual([[1, 7], [9, 10]]);
  });
});

describe("correction-delay amendment proposal (never applied without agreement)", () => {
  const bookedFrom = "2026-11-02T00:00:00Z", bookedUntil = "2026-11-03T00:00:00Z";
  it("approval before start needs no amendment", () => {
    expect(proposeCorrectionAmendment({ approvedAt: "2026-11-01T10:00:00Z", bookedFrom, bookedUntil })).toEqual({ needed: false });
  });
  it("next whole UK hour after approval, purchased duration preserved", () => {
    const p = proposeCorrectionAmendment({ approvedAt: "2026-11-02T10:17:00Z", bookedFrom, bookedUntil, now: "2026-11-02T10:17:00Z" });
    expect(p).toMatchObject({ viable: true, preservesDuration: true, shortenedSeconds: 0 });
    expect(p.start.toISOString()).toBe("2026-11-02T11:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-11-03T11:00:00.000Z");
  });
  it("never displaces a confirmed following booking: shortened at its boundary", () => {
    const p = proposeCorrectionAmendment({ approvedAt: "2026-11-02T10:17:00Z", bookedFrom, bookedUntil, followingBookingFrom: "2026-11-03T00:00:00Z" });
    expect(p).toMatchObject({ viable: true, preservesDuration: false, shortenedSeconds: 11 * H });
    expect(p.end.toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });
  it("no remaining capacity / already expired -> not viable (no negative or expired runs)", () => {
    expect(proposeCorrectionAmendment({ approvedAt: "2026-11-02T23:30:00Z", bookedFrom, bookedUntil, followingBookingFrom: "2026-11-03T00:00:00Z" }))
      .toEqual({ needed: true, viable: false });
  });
});

describe("proposed 24-hour packages (gated): exact elapsed hours across DST", () => {
  it("30 days = 720 elapsed hours even across the autumn clock change", () => {
    const p = elapsedPackageInterval("2026-10-10T11:00:00Z", 720);
    expect((p.end - p.start) / 3600000).toBe(720);
    expect(formatLondonWithOffset(p.start)).toBe("Sat 10 Oct 2026 12:00 BST (UTC+01:00)");
    expect(formatLondonWithOffset(p.end)).toBe("Mon 9 Nov 2026 11:00 GMT (UTC+00:00)"); // wall clock shifts by the DST hour
  });
  it("24 h on the spring-forward day is 24 real hours", () => {
    const p = elapsedPackageInterval("2026-03-28T12:00:00Z", 24);
    expect(formatLondonWithOffset(p.end)).toBe("Sun 29 Mar 2026 13:00 BST (UTC+01:00)");
  });
  it("rejects non-whole-hour starts and non-positive lengths", () => {
    expect(() => elapsedPackageInterval("2026-03-28T12:30:00Z", 24)).toThrow();
    expect(() => elapsedPackageInterval("2026-03-28T12:00:00Z", 0)).toThrow();
  });
});
