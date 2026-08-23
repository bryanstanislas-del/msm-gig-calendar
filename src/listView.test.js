import { describe, it, expect } from "vitest";
import { selectListViewGigs } from "./App";

// Regression coverage for the List View "starts on old gigs" production bug:
// the view must default to today-forward, in chronological order, while an
// explicit From Date (past or future) is still respected as-is. See
// selectListViewGigs in App.jsx for the implementation this exercises.

const TODAY = "2026-08-23";

const gig = (id, date, extra = {}) => ({
  id,
  band_name: `Band ${id}`,
  venue: "Venue",
  city: "City",
  date,
  time: "20:00",
  genre: "rock",
  ...extra,
});

describe("selectListViewGigs", () => {
  it("defaults to today-forward, excluding past gigs", () => {
    const gigs = [
      gig("past-1", "2026-06-01"),
      gig("past-2", "2026-08-22"),
      gig("today",  "2026-08-23"),
      gig("future", "2026-09-01"),
    ];

    const result = selectListViewGigs(gigs, { dateFrom: "", todayStr: TODAY });

    expect(result.map(g => g.id)).toEqual(["today", "future"]);
  });

  it("includes gigs happening today", () => {
    const gigs = [gig("today", "2026-08-23")];
    const result = selectListViewGigs(gigs, { dateFrom: "", todayStr: TODAY });
    expect(result.map(g => g.id)).toContain("today");
  });

  it("keeps a multi-day gig that started in the past but ends today or later", () => {
    const gigs = [
      // Festival-style item: started yesterday, still running today.
      gig("ongoing-festival", "2026-08-22", { end_date: "2026-08-24" }),
      // Fully in the past, including its end date.
      gig("finished-festival", "2026-08-10", { end_date: "2026-08-15" }),
    ];

    const result = selectListViewGigs(gigs, { dateFrom: "", todayStr: TODAY });

    expect(result.map(g => g.id)).toEqual(["ongoing-festival"]);
  });

  it("sorts remaining (today + future) gigs chronologically", () => {
    const gigs = [
      gig("later",   "2026-10-05"),
      gig("today",   "2026-08-23"),
      gig("sooner",  "2026-09-01"),
      gig("soonest", "2026-08-24"),
    ];

    const result = selectListViewGigs(gigs, { dateFrom: "", todayStr: TODAY });

    expect(result.map(g => g.id)).toEqual(["today", "soonest", "sooner", "later"]);
  });

  it("starts from the next upcoming gig when there are none today", () => {
    const gigs = [
      gig("past",  "2026-08-01"),
      gig("next",  "2026-08-30"),
      gig("later", "2026-09-15"),
    ];

    const result = selectListViewGigs(gigs, { dateFrom: "", todayStr: TODAY });

    expect(result.map(g => g.id)).toEqual(["next", "later"]);
  });

  it("returns an empty list rather than falling back to past gigs when nothing is upcoming", () => {
    const gigs = [gig("past-1", "2026-06-01"), gig("past-2", "2026-07-15")];
    const result = selectListViewGigs(gigs, { dateFrom: "", todayStr: TODAY });
    expect(result).toEqual([]);
  });

  it("respects an explicit From Date in the past, still returning historical results", () => {
    const gigs = [
      gig("june",   "2026-06-01"),
      gig("july",   "2026-07-01"),
      gig("today",  "2026-08-23"),
      gig("future", "2026-09-01"),
    ];

    const result = selectListViewGigs(gigs, { dateFrom: "2026-06-01", todayStr: TODAY });

    // Explicit dateFrom bypasses the upcoming-only default entirely --
    // upstream date filtering (against filters.dateFrom) already narrowed
    // the input; this just preserves chronological order over all of it.
    expect(result.map(g => g.id)).toEqual(["june", "july", "today", "future"]);
  });

  it("respects an explicit future From Date too", () => {
    const gigs = [
      gig("today",  "2026-08-23"),
      gig("future", "2026-09-01"),
    ];

    const result = selectListViewGigs(gigs, { dateFrom: "2026-08-30", todayStr: TODAY });

    expect(result.map(g => g.id)).toEqual(["today", "future"]);
  });

  it("is a pure function of its inputs, independent of any persisted or cached 'now' -- passing a different todayStr for the same gigs changes the result deterministically", () => {
    const gigs = [gig("aug-23", "2026-08-23"), gig("aug-24", "2026-08-24")];

    const asOfAug23 = selectListViewGigs(gigs, { dateFrom: "", todayStr: "2026-08-23" });
    const asOfAug25 = selectListViewGigs(gigs, { dateFrom: "", todayStr: "2026-08-25" });

    expect(asOfAug23.map(g => g.id)).toEqual(["aug-23", "aug-24"]);
    // Once "today" moves past both gigs, they roll off the default list --
    // proving the cutoff tracks the current date rather than a stale value
    // baked in at some earlier point (e.g. from a cached PWA session).
    expect(asOfAug25.map(g => g.id)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const gigs = [gig("b", "2026-09-01"), gig("a", "2026-08-23")];
    const original = [...gigs];

    selectListViewGigs(gigs, { dateFrom: "", todayStr: TODAY });

    expect(gigs).toEqual(original);
  });
});
