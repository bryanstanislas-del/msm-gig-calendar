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
});
