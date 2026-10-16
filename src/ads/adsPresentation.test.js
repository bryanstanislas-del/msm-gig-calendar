import { describe, it, expect } from "vitest";
import { describeBooking, formatPence, canStartCheckout, friendlyAdsError, clampToEarliest, earliestStartExplanation } from "./adsPresentation.js";

const now = new Date("2026-10-15T12:00:00Z");
const confirmed = { status: "confirmed", hold_expires_at: "2026-10-15T11:00:00Z" };

describe("advertiser status wording", () => {
  it("payment alone is never shown as approved/live", () => {
    expect(describeBooking(confirmed, { review_status: "awaiting_creative" }, null, now).label).toMatch(/upload artwork/);
    const ur = describeBooking(confirmed, { review_status: "under_review" }, { review_due_before: "2026-10-16T23:00:00Z" }, now);
    expect(ur.label).toBe("Under review - decision due by end of Fri 16 Oct 2026 (UK time)");
  });
  it("approved / paused / rejected states", () => {
    expect(describeBooking(confirmed, { review_status: "approved", approved_version_id: "x" }, null, now).tone).toBe("good");
    expect(describeBooking(confirmed, { review_status: "approved", paused: true }, null, now).label).toMatch(/paused/);
    expect(describeBooking(confirmed, { review_status: "rejected" }, null, now).label).toMatch(/Changes needed/);
    expect(describeBooking(confirmed, { review_status: "rejected", approved_version_id: "x" }, null, now).label).toMatch(/previous approved/);
  });
  it("holds that have lapsed read as expired even before the DB sweeps them", () => {
    expect(describeBooking({ status: "held", hold_expires_at: "2026-10-15T11:59:00Z" }, {}, null, now).label).toBe("Hold expired");
  });
  it("checkout needs 31 minutes on the hold", () => {
    expect(canStartCheckout({ status: "held", hold_expires_at: "2026-10-15T12:31:30Z" }, now)).toBe(true);
    expect(canStartCheckout({ status: "held", hold_expires_at: "2026-10-15T12:30:00Z" }, now)).toBe(false);
  });
  it("money + errors", () => {
    expect(formatPence(3000)).toBe("£30.00");
    expect(friendlyAdsError(new Error("ADS_CAPACITY_UNAVAILABLE"))).toMatch(/already booked/);
    expect(friendlyAdsError(new Error("permission denied for table x"))).toBe("Something went wrong. Please try again.");
  });
});

describe("earliest standard start (server-derived) in the portal", () => {
  it("never lets the picker default/value go before the server's earliest date", () => {
    expect(clampToEarliest("", "2026-10-20")).toBe("2026-10-20");
    expect(clampToEarliest("2026-10-19", "2026-10-20")).toBe("2026-10-20"); // tampered/old value
    expect(clampToEarliest("2026-10-25", "2026-10-20")).toBe("2026-10-25");
  });
  it("explains the assumption and delayed readiness without promising approval", () => {
    const t = earliestStartExplanation({ earliest_start: "2026-10-20", review_due_before_if_ready_now: "2026-10-19T23:00:00Z" });
    expect(t).toMatch(/Earliest standard start: 2026-10-20/);
    expect(t).toMatch(/end of Mon 19 Oct 2026 \(UK time\)/);
    expect(t).toMatch(/assumes you pay and submit complete artwork and link now/);
    expect(t).toMatch(/remaining booked days/);
    expect(t).toMatch(/Approval is not guaranteed/);
    expect(t).not.toMatch(/guaranteed to (run|appear)|will be approved/i);
    expect(earliestStartExplanation(null)).toBe("");
  });
});
