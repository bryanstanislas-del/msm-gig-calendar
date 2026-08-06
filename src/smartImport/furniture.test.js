import { describe, it, expect } from "vitest";
import { filterPageFurniture } from "./furniture.js";

describe("filterPageFurniture", () => {
  it("drops deny-listed phrases (privacy/cookies/terms/copyright/follow-us/back-to-top)", () => {
    const { keptLines, discardedCount } = filterPageFurniture([
      "Privacy Policy",
      "Cookie Policy",
      "Terms and Conditions",
      "© 2026 All rights reserved.",
      "Follow us",
      "Back to top",
      "12 June 2026 - The Obelisk, Woolston",
    ]);
    expect(keptLines).toEqual(["12 June 2026 - The Obelisk, Woolston"]);
    expect(discardedCount).toBe(6);
  });

  it("drops pure-URL lines but keeps a line that merely contains a URL alongside other text", () => {
    const { keptLines, discardedCount } = filterPageFurniture([
      "https://example.com/facebook",
      "Tickets: https://example.com/tickets - 12 June 2026",
    ]);
    expect(keptLines).toEqual(["Tickets: https://example.com/tickets - 12 June 2026"]);
    expect(discardedCount).toBe(1);
  });

  it("drops a line repeated more than twice (nav/footer repetition), but keeps a line repeated only twice", () => {
    const { keptLines, discardedCount } = filterPageFurniture([
      "Menu", "Menu", "Menu", // 3x -- over threshold, dropped
      "12 June 2026 - The Obelisk, Woolston",
      "12 June 2026 - The Obelisk, Woolston", // 2x -- a real recurring-gig line could legitimately appear twice; must survive
    ]);
    expect(keptLines).toEqual([
      "12 June 2026 - The Obelisk, Woolston",
      "12 June 2026 - The Obelisk, Woolston",
    ]);
    expect(discardedCount).toBe(3);
  });

  it("does NOT drop short nav-style words like 'Home'/'Gigs' -- conservative by design, they must survive as harmless unparseable rows rather than risk eating real short content", () => {
    const { keptLines, discardedCount } = filterPageFurniture(["Home", "Gigs", "About"]);
    expect(keptLines).toEqual(["Home", "Gigs", "About"]);
    expect(discardedCount).toBe(0);
  });

  it("silently skips blank lines without counting them as discarded furniture", () => {
    const { keptLines, discardedCount } = filterPageFurniture(["", "  ", "12 June 2026 - The Obelisk, Woolston", ""]);
    expect(keptLines).toEqual(["12 June 2026 - The Obelisk, Woolston"]);
    expect(discardedCount).toBe(0);
  });

  it("is case-insensitive for the deny-list", () => {
    const { discardedCount } = filterPageFurniture(["PRIVACY POLICY", "follow US"]);
    expect(discardedCount).toBe(2);
  });

  it("drops UI-chrome link/button text (View Details, Read More, Buy Tickets, Book Now, Find Out More, More Info, Share Event, Add to Calendar, Directions, Load More)", () => {
    const chrome = [
      "View Details", "Read More", "Buy Tickets", "Book Now", "Find Out More",
      "More Info", "Share Event", "Add to Calendar", "Directions", "Load More",
    ];
    const { keptLines, discardedCount } = filterPageFurniture([...chrome, "12 June 2026 - The Obelisk, Woolston"]);
    expect(keptLines).toEqual(["12 June 2026 - The Obelisk, Woolston"]);
    expect(discardedCount).toBe(chrome.length);
  });

  it("does NOT drop a real sentence that merely starts with one of the UI-chrome words -- these are whole-line matches, not a prefix match", () => {
    const { keptLines, discardedCount } = filterPageFurniture([
      "Directions to the venue are down Mill Lane",
      "More info coming soon about support acts",
    ]);
    expect(keptLines).toEqual([
      "Directions to the venue are down Mill Lane",
      "More info coming soon about support acts",
    ]);
    expect(discardedCount).toBe(0);
  });

  it("drops promotional-banner boilerplate (Promote Your Event / Add Your Event, as seen verbatim in the real Gig Guide sample)", () => {
    const { discardedCount } = filterPageFurniture(["Promote Your Event", "Add Your Event"]);
    expect(discardedCount).toBe(2);
  });

  it("drops basic pagination controls (Next/Previous, Page N of M), with or without arrow decoration", () => {
    const { discardedCount } = filterPageFurniture(["Next »", "« Previous", "Page 2 of 5", "Load More"]);
    expect(discardedCount).toBe(4);
  });
});
