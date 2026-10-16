import { describe, it, expect } from "vitest";
import {
  initialClockStart, standardReviewDue, priorityReviewDue, initialReviewDue, addWorkingHours, correctionResponseDue,
  correctionReviewDue, isTimely, reviewMetDeadline, nextWholeUkHour, formatLondonWithOffset, EW_BANK_HOLIDAYS,
} from "./ukWorkingTime.js";
import { isWorkingDay } from "./londonTime.js";

const iso = (d) => d.toISOString();

describe("initial clock start: payment cleared AND complete material, either order", () => {
  it("starts at whichever happens last; never before both", () => {
    expect(initialClockStart({ paymentClearedAt: "2026-10-16T10:00:00Z", materialCompleteAt: null })).toBeNull();
    expect(initialClockStart({ paymentClearedAt: null, materialCompleteAt: "2026-10-16T10:00:00Z" })).toBeNull();
    expect(iso(initialClockStart({ paymentClearedAt: "2026-10-16T10:00:00Z", materialCompleteAt: "2026-10-16T12:00:00Z" }))).toBe("2026-10-16T12:00:00.000Z");
    expect(iso(initialClockStart({ paymentClearedAt: "2026-10-16T13:00:00Z", materialCompleteAt: "2026-10-16T12:00:00Z" }))).toBe("2026-10-16T13:00:00.000Z");
  });
});

describe("standard review: by 23:59:59 London next working day", () => {
  it.each([
    ["Fri 17:00 -> end of Mon", "2026-10-16T16:00:00Z", "2026-10-19T23:00:00.000Z"],
    ["Sat -> end of Mon", "2026-10-17T10:00:00Z", "2026-10-19T23:00:00.000Z"],
    ["Thu before Good Friday -> end of Tue after Easter", "2026-04-02T09:00:00Z", "2026-04-07T23:00:00.000Z"],
    ["Fri before summer bank holiday -> end of Tue", "2026-08-28T15:00:00Z", "2026-09-01T23:00:00.000Z"],
    ["Fri before autumn clock change -> end of Mon in GMT", "2026-10-23T16:00:00Z", "2026-10-27T00:00:00.000Z"],
  ])("%s", (_l, from, due) => expect(iso(standardReviewDue(from))).toBe(due));
});

describe("priority review: 12 elapsed hours including nights and weekends", () => {
  it("overnight and weekend", () => {
    expect(iso(priorityReviewDue("2026-10-16T20:00:00Z"))).toBe("2026-10-17T08:00:00.000Z"); // Fri night -> Sat morning
    expect(iso(priorityReviewDue("2026-10-24T20:00:00Z"))).toBe("2026-10-25T08:00:00.000Z"); // across the clock change: 12 real hours
    expect(iso(initialReviewDue({ clockStart: "2026-10-16T16:00:00Z", priority: true }))).toBe("2026-10-17T04:00:00.000Z");
    expect(iso(initialReviewDue({ clockStart: "2026-10-16T16:00:00Z", priority: false }))).toBe("2026-10-19T23:00:00.000Z");
    expect(initialReviewDue({ clockStart: null, priority: true })).toBeNull();
  });
});

describe("working hours: 09:00-17:00 London, Mon-Fri, E&W bank holidays excluded", () => {
  it.each([
    ["Fri 16:00 + 3h -> Mon 11:00 (BST)", "2026-10-16T15:00:00Z", "2026-10-19T10:00:00.000Z"],
    ["Mon 10:00 + 3h -> 13:00", "2026-10-19T09:00:00Z", "2026-10-19T12:00:00.000Z"],
    ["before opening: 07:00 + 3h -> 12:00", "2026-10-19T06:00:00Z", "2026-10-19T11:00:00.000Z"],
    ["after close: 18:00 + 3h -> next day 12:00", "2026-10-19T17:00:00Z", "2026-10-20T11:00:00.000Z"],
    ["exactly to close: 14:00 + 3h -> 17:00 same day", "2026-10-19T13:00:00Z", "2026-10-19T16:00:00.000Z"],
    ["weekend: Sat + 3h -> Mon 12:00", "2026-10-17T10:00:00Z", "2026-10-19T11:00:00.000Z"],
    ["Fri 16:00 before clock change -> Mon 11:00 GMT", "2026-10-23T15:00:00Z", "2026-10-26T11:00:00.000Z"],
    ["Thu 16:00 before Good Friday -> Tue 11:00", "2026-04-02T15:00:00Z", "2026-04-07T10:00:00.000Z"],
    ["Christmas Eve 15:30 GMT -> Tue 29th 10:30", "2026-12-24T15:30:00Z", "2026-12-29T10:30:00.000Z"],
  ])("%s", (_l, from, due) => expect(iso(addWorkingHours(from, 3))).toBe(due));
  it("holiday table is maintained through 2028 and only contains weekdays", () => {
    expect(EW_BANK_HOLIDAYS).toContain("2028-12-26");
    for (const d of EW_BANK_HOLIDAYS) expect(isWorkingDay(d, [])).toBe(true);
  });
});

describe("correction response window", () => {
  it("starts only on successful delivery; known failure starts nothing", () => {
    expect(correctionResponseDue({ noticeDeliveredAt: null })).toBeNull();
    expect(iso(correctionResponseDue({ noticeDeliveredAt: "2026-10-16T15:00:00Z" }))).toBe("2026-10-19T10:00:00.000Z");
  });
  it("received exactly at the deadline is timely; one second later is late", () => {
    expect(isTimely("2026-10-19T10:00:00Z", "2026-10-19T10:00:00Z")).toBe(true);
    expect(isTimely("2026-10-19T10:00:01Z", "2026-10-19T10:00:00Z")).toBe(false);
  });
  it("timely priority correction -> 3 working hours; late priority or standard -> end of next working day", () => {
    const due = "2026-10-19T10:00:00Z";
    expect(iso(correctionReviewDue({ receivedAt: "2026-10-19T10:00:00Z", responseDueAt: due, priority: true }))).toBe("2026-10-19T13:00:00.000Z");
    expect(iso(correctionReviewDue({ receivedAt: "2026-10-19T10:00:01Z", responseDueAt: due, priority: true }))).toBe("2026-10-20T23:00:00.000Z");
    expect(iso(correctionReviewDue({ receivedAt: "2026-10-19T10:00:00Z", responseDueAt: due, priority: false }))).toBe("2026-10-20T23:00:00.000Z");
  });
});

describe("what counts as review", () => {
  const dueAt = "2026-10-17T04:00:00Z"; // 12h after Fri 16:00 UTC
  it("approval, reasoned rejection or genuine correction request by the deadline; acknowledgement never", () => {
    expect(reviewMetDeadline({ outcome: "correction_requested", outcomeAt: "2026-10-17T03:59:00Z", dueAt })).toBe(true); // 11h59m
    expect(reviewMetDeadline({ outcome: "approved", outcomeAt: dueAt, dueAt })).toBe(true);
    expect(reviewMetDeadline({ outcome: "approved", outcomeAt: "2026-10-17T04:00:01Z", dueAt })).toBe(false);
    expect(reviewMetDeadline({ outcome: "acknowledged", outcomeAt: "2026-10-16T17:00:00Z", dueAt })).toBe(false);
    expect(reviewMetDeadline({ outcome: "correction_requested", outcomeAt: "2026-10-16T17:00:00Z", dueAt, genuine: false })).toBe(false);
  });
});

describe("UK hour helpers and display", () => {
  it("next whole UK hour after approval", () => {
    expect(iso(nextWholeUkHour("2026-10-19T10:17:00Z"))).toBe("2026-10-19T11:00:00.000Z");
    expect(iso(nextWholeUkHour("2026-10-19T10:00:00Z"))).toBe("2026-10-19T11:00:00.000Z");
  });
  it("shows explicit offsets", () => {
    expect(formatLondonWithOffset("2026-10-19T10:00:00Z")).toBe("Mon 19 Oct 2026 11:00 BST (UTC+01:00)");
    expect(formatLondonWithOffset("2026-12-19T10:00:00Z")).toBe("Sat 19 Dec 2026 10:00 GMT (UTC+00:00)");
    expect(formatLondonWithOffset("2026-10-19T22:59:59Z")).toBe("Mon 19 Oct 2026 23:59:59 BST (UTC+01:00)");
  });
});
