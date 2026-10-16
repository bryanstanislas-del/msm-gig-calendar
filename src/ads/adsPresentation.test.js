import { describe, it, expect } from "vitest";
import { describeBooking, formatPence, canStartCheckout, friendlyAdsError, clampToEarliest, earliestStartExplanation, reviewPromiseText, correctionText, confirmationText, parseLostIntervals, refundProcessingKey, removalMessage, cancellationGuidance, CANCELLATION_INITIATORS, notificationStatusText, amendmentText, servingIntervalText } from "./adsPresentation.js";

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

describe("priority, corrections and confirmation wording", () => {
  it("shows the exact priority price and deadline before payment", () => {
    const t = reviewPromiseText({ priority_review: true, priority_fee_pence: 15000, currency: "gbp", review_due_if_ready_now: "2026-10-17T03:00:00Z" });
    expect(t).toMatch(/Priority review \(£150\.00\)/);
    expect(t).toMatch(/12 elapsed hours \(nights and weekends included\)/);
    expect(t).toMatch(/by Sat 17 Oct 2026 04:00 BST \(UTC\+01:00\)/);
    expect(t).toMatch(/No extra fee for corrections/);
  });
  it("standard promise names the working-day rule", () => {
    expect(reviewPromiseText({ priority_review: false, review_due_if_ready_now: "2026-10-19T23:00:00Z" }))
      .toMatch(/23:59:59 UK time on the next working day.*before Tue 20 Oct 2026 00:00 BST \(UTC\+01:00\)/);
  });
  it("earliest-start text mentions priority only when offered", () => {
    expect(earliestStartExplanation({ earliest_start: "2026-10-20" }, true)).toMatch(/Optional priority review is offered/);
    expect(earliestStartExplanation({ earliest_start: "2026-10-20" })).toMatch(/Priority review is not available/);
  });
  it("correction: reasons, exact version, deadline with offset; no window before notice", () => {
    const base = { version_no: 2, reasons: ["Logo cropped", "Link 404"], status: "awaiting_response" };
    expect(correctionText({ ...base, response_due_at: "2026-10-19T10:00:00Z" }))
      .toBe("MSM asked for a correction to version 2: Logo cropped; Link 404. Please submit a corrected version by Mon 19 Oct 2026 11:00 BST (UTC+01:00) (3 UK working hours, 09:00-17:00 Mon-Fri).");
    expect(correctionText({ ...base, status: "awaiting_notice", response_due_at: null })).toMatch(/starts when our notice reaches you/);
    expect(correctionText({ ...base, status: "responded", responded_at: "2026-10-19T10:00:01Z", timely: false })).toMatch(/after the deadline/);
  });
  it("correction_requested status line", () => {
    expect(describeBooking(confirmed, { review_status: "correction_requested" }, null, now).label).toMatch(/Correction requested/);
  });
  it("durable confirmation shows price split, interval end exclusive and draft terms version", () => {
    const t = confirmationText({ confirmed_at: "2026-10-16T09:00:00Z", placement_pence: 1000, priority_fee_pence: 15000, priority_review: true,
      total_pence: 16000, currency: "gbp", booked_from: "2026-10-26T00:00:00Z", booked_until: "2026-10-27T00:00:00Z",
      review_rule: "Initial review within 12 elapsed hours", terms_version: "DRAFT-NOT-APPROVED-2026-10-16" });
    expect(t).toMatch(/Placement £10\.00 \+ priority review £150\.00 = £160\.00/);
    expect(t).toMatch(/Runs Mon 26 Oct 2026 00:00 GMT \(UTC\+00:00\) until Tue 27 Oct 2026 00:00 GMT \(UTC\+00:00\) \(end not included\)/);
    expect(t).toMatch(/DRAFT-NOT-APPROVED/);
  });
});

describe("admin refund inputs", () => {
  it("parses lost intervals with explicit offsets and evidence", () => {
    expect(parseLostIntervals("2026-11-02T10:00Z | 2026-11-02T16:00+00:00 | Vercel incident ZZ-1\n\n")).toEqual([
      { from: "2026-11-02T10:00:00.000Z", until: "2026-11-02T16:00:00.000Z", evidence: "Vercel incident ZZ-1" }]);
  });
  it("rejects wall-clock times without an offset, reversed intervals and missing evidence", () => {
    expect(() => parseLostIntervals("2026-11-02T10:00 | 2026-11-02T16:00Z | Vercel incident ZZ-1")).toThrow(/explicit offset/);
    expect(() => parseLostIntervals("2026-11-02T16:00Z | 2026-11-02T10:00Z | Vercel incident ZZ-1")).toThrow(/after start/);
    expect(() => parseLostIntervals("2026-11-02T10:00Z | 2026-11-02T16:00Z | short")).toThrow(/evidence/);
  });
  it("processing key is stable for the same action (idempotent re-click)", () => {
    expect(refundProcessingKey("a1", "submitted", "re_1")).toBe(refundProcessingKey("a1", "submitted", "re_1"));
    expect(refundProcessingKey("a1", "failed")).toBe("refund-a1-0-failed-none");
    expect(refundProcessingKey("a1", "failed", null, 1)).not.toBe(refundProcessingKey("a1", "failed", null, 0));
  });
});

describe("cancellation initiator wording", () => {
  it("MSM removal never offers advertiser-cancellation loss retention", () => {
    const g = cancellationGuidance({ initiated_by: "msm", party_type: "business" });
    expect(g).toMatchObject({ canAssess: true, allowNetLoss: false });
    expect(g.text).toMatch(/no loss can be retained/);
    expect(g.text).toMatch(/gated/);
    expect(removalMessage("msm")).toMatch(/no advertiser-cancellation losses/);
  });
  it("advertiser-initiated business cancellation may retain evidenced net loss", () => {
    expect(cancellationGuidance({ initiated_by: "advertiser", party_type: "business" })).toMatchObject({ canAssess: true, allowNetLoss: true });
    expect(removalMessage("advertiser")).toMatch(/advertiser's request/);
  });
  it("undetermined initiator or status is gated", () => {
    expect(cancellationGuidance({ initiated_by: "undetermined", party_type: "business" }).canAssess).toBe(false);
    expect(cancellationGuidance({ initiated_by: "advertiser", party_type: "undetermined" }).canAssess).toBe(false);
    expect(cancellationGuidance(null).canAssess).toBe(false);
    expect(Object.keys(CANCELLATION_INITIATORS)).toEqual(["advertiser", "msm"]);
  });
});

describe("notification status wording", () => {
  it("never presents acceptance or delivery as reading", () => {
    expect(notificationStatusText({ status: "accepted" })).toMatch(/not yet reported delivered/);
    expect(notificationStatusText({ status: "delivered" })).toMatch(/not proof it was read/);
    expect(notificationStatusText({ status: "pending" })).toMatch(/off unless both switches are on/);
  });
});

describe("booking amendment wording", () => {
  const base = { status: "proposed", original_from: "2026-11-02T00:00:00Z", original_until: "2026-11-04T00:00:00Z",
    proposed_from: "2026-11-02T11:00:00Z", proposed_until: "2026-11-04T00:00:00Z", purchased_seconds: 172800,
    preserves_duration: false, shortened_seconds: 39600, expires_at: "2026-11-03T11:00:00Z" };
  it("shows both exact intervals with offsets, the shortfall, and that nothing changes without acceptance", () => {
    const t = amendmentText(base, new Date("2026-11-02T12:00:00Z"));
    expect(t).toContain("run Mon 2 Nov 2026 11:00 GMT (UTC+00:00) until Wed 4 Nov 2026 00:00 GMT (UTC+00:00) (end not included), 37 h");
    expect(t).toContain("instead of Mon 2 Nov 2026 00:00 GMT (UTC+00:00) until Wed 4 Nov 2026 00:00 GMT (UTC+00:00)");
    expect(t).toMatch(/11 h shorter than your purchased 48 h/);
    expect(t).toMatch(/does not waive any refund/);
    expect(t).toMatch(/Nothing changes unless you accept/);
  });
  it("expired and decided states", () => {
    expect(amendmentText(base, new Date("2026-11-03T11:00:00Z"))).toMatch(/offer has expired/);
    expect(amendmentText({ ...base, status: "accepted" })).toMatch(/Status: accepted/);
    expect(amendmentText({ ...base, preserves_duration: true, shortened_seconds: 0 }, new Date("2026-11-02T12:00:00Z"))).toMatch(/purchased 48 h are kept/);
  });
  it("serving interval prefers the accepted amendment", () => {
    expect(servingIntervalText({ start_date: "2026-11-02", end_date: "2026-11-03" })).toBe("2026-11-02 to 2026-11-03 (UK dates, inclusive)");
    expect(servingIntervalText({ start_date: "2026-11-02", end_date: "2026-11-03", serve_from: "2026-11-02T11:00:00Z", serve_until: "2026-11-04T00:00:00Z" }))
      .toMatch(/^Mon 2 Nov 2026 11:00 GMT \(UTC\+00:00\) until Wed 4 Nov 2026 00:00 GMT/);
  });
});
