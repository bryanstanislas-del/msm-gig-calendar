// The real, git-curated directory (curatedListings.js).
import { describe, it, expect } from "vitest";
import { CURATED_LISTINGS } from "./curatedListings.js";
import { validateDirectory } from "./schema.js";
import { applicationStatus, STATUS } from "./status.js";
import { ctaLinks } from "./cta.js";

// Research batches A and B were checked on 2026-10-27 (UK).
const CHECK_DAY = new Date("2026-10-27T12:00:00Z");
const statusOf = (l, now = CHECK_DAY) => applicationStatus(l, now).status;
const byId = Object.fromEntries(CURATED_LISTINGS.map((l) => [l.id, l]));

describe("curated listings", () => {
  it("every record passes validation with zero errors", () => {
    const { valid, problems } = validateDirectory(CURATED_LISTINGS, { today: "2026-10-27" });
    expect(problems.filter((p) => p.errors.length)).toEqual([]);
    expect(valid).toHaveLength(CURATED_LISTINGS.length);
  });

  it("26 records: 13 open, 2 future, 4 closed, 7 unverified on the check date", () => {
    expect(CURATED_LISTINGS).toHaveLength(26);
    const counts = {};
    for (const l of CURATED_LISTINGS) counts[statusOf(l)] = (counts[statusOf(l)] || 0) + 1;
    expect(counts).toEqual({ [STATUS.OPEN]: 13, [STATUS.NOT_YET_OPEN]: 1, [STATUS.NOT_YET_ANNOUNCED]: 1, [STATUS.CLOSED]: 4, [STATUS.UNVERIFIED]: 7 });
  });

  it("specific evidence cases resolve as reviewed", () => {
    expect(statusOf(byId["hastings-fat-tuesday"])).toBe(STATUS.CLOSED); // stale open banner, expired deadline wins
    expect(statusOf(byId["together-again"])).toBe(STATUS.CLOSED);
    for (const id of ["donnyfest", "country-on-the-coast", "deer-shed"]) expect(statusOf(byId[id])).toBe(STATUS.UNVERIFIED);
    expect(applicationStatus(byId.donnyfest, CHECK_DAY).reason).toMatch(/disagree/);
    expect(statusOf(byId["camper-calling"])).toBe(STATUS.UNVERIFIED);
    expect(statusOf(byId.manorfest)).toBe(STATUS.NOT_YET_OPEN);
    expect(statusOf(byId.wychwood)).toBe(STATUS.NOT_YET_ANNOUNCED);
  });

  it("Hanwell Hootie closes at 21:00 UK time on 1 Dec 2026, not end of day", () => {
    const h = byId["hanwell-hootie"];
    expect(h.application.closesTime).toBe("21:00");
    // By 1 Dec the 27 Oct check is stale (needs re-check), but at 21:00 explicit expiry wins.
    expect(statusOf(h, new Date("2026-12-01T20:59:00Z"))).toBe(STATUS.UNVERIFIED);
    expect(statusOf(h, new Date("2026-12-01T21:00:00Z"))).toBe(STATUS.CLOSED);
    expect(statusOf(h, new Date("2026-11-20T12:00:00Z"))).toBe(STATUS.OPEN);
  });

  it("open calls need re-checking after 30 days", () => {
    expect(statusOf(byId.twyfest, new Date("2026-11-26T12:00:00Z"))).toBe(STATUS.OPEN);
    expect(statusOf(byId.twyfest, new Date("2026-11-27T12:00:00Z"))).toBe(STATUS.UNVERIFIED);
  });

  it("only open listings get an apply button; every listing links official info and shows sources", () => {
    for (const l of CURATED_LISTINGS) {
      const info = applicationStatus(l, CHECK_DAY);
      const links = ctaLinks(l, info);
      const hasApply = links.some((x) => x.kind === "apply");
      expect(hasApply, l.id).toBe(info.status === STATUS.OPEN);
      expect(links.some((x) => x.href === l.officialUrl), l.id).toBe(true);
      expect(l.application.sourceUrl, l.id).toMatch(/^https:\/\//);
      expect(l.application.evidence.length, l.id).toBeGreaterThan(10);
    }
  });

  it("no unverified window stores a deadline or application link", () => {
    for (const l of CURATED_LISTINGS.filter((x) => x.application.status === "unverified")) {
      expect(l.application.closes ?? null, l.id).toBeNull();
      expect(l.application.url ?? null, l.id).toBeNull();
    }
  });

  it("unpaid and email details are recorded only where the research stated them", () => {
    expect(byId.twyfest.performerPay.status).toBe("unpaid");
    expect(CURATED_LISTINGS.filter((l) => l.performerPay?.status === "unpaid").map((l) => l.id)).toEqual(["twyfest"]);
    expect(CURATED_LISTINGS.filter((l) => l.application.email).map((l) => l.id).sort()).toEqual(["mostly-jazz-funk-and-soul", "twyfest"]);
  });
});
