import { describe, it, expect } from "vitest";
import {
  FIXED_SLOTS,
  VALID_PROMO_LABELS,
  IN_FEED_AFTER_INDEX,
  DESKTOP_ARTWORK,
  MOBILE_ARTWORK,
  isKnownSlot,
  isValidHttpUrl,
  indexPromoSlotsBySlot,
  shouldRenderPromoSlot,
  resolvePromoSources,
  resolveLinkProps,
  hasMobileCreative,
  shouldDisplayPromoSlot,
  resolvePromoLabel,
  shouldShowInFeedSlot,
  buildListViewItems,
  validatePromoSlotForm,
} from "./PromoSlot.jsx";

const activeConfig = (overrides = {}) => ({
  slot: "TOP",
  image_url: "https://musicscenemagazine.co.uk/wp-content/uploads/promo.jpg",
  mobile_image_url: null,
  target_url: "https://musicscenemagazine.co.uk/",
  alt_text: "More than a gig guide",
  label: "Editorial",
  active: true,
  ...overrides,
});

describe("isKnownSlot / FIXED_SLOTS", () => {
  it("the fixed slot set is exactly TOP, IN_FEED, LOWER -- no arbitrary slot creation", () => {
    expect(FIXED_SLOTS).toEqual(["TOP", "IN_FEED", "LOWER"]);
  });
  it("accepts each fixed slot", () => {
    for (const slot of FIXED_SLOTS) expect(isKnownSlot(slot)).toBe(true);
  });
  it("rejects anything outside the fixed set", () => {
    expect(isKnownSlot("SIDEBAR")).toBe(false);
    expect(isKnownSlot("top")).toBe(false); // case-sensitive, matches the DB CHECK constraint exactly
    expect(isKnownSlot(undefined)).toBe(false);
    expect(isKnownSlot(null)).toBe(false);
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http/https URLs", () => {
    expect(isValidHttpUrl("https://musicscenemagazine.co.uk/")).toBe(true);
    expect(isValidHttpUrl("http://example.com/image.jpg")).toBe(true);
  });
  it("rejects non-http(s) schemes, malformed strings, and empty/missing values", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
    expect(isValidHttpUrl(undefined)).toBe(false);
    expect(isValidHttpUrl(42)).toBe(false);
  });
});

describe("indexPromoSlotsBySlot", () => {
  it("indexes rows by slot name", () => {
    const rows = [activeConfig({ slot: "TOP" }), activeConfig({ slot: "LOWER", active: false })];
    const map = indexPromoSlotsBySlot(rows);
    expect(map.TOP.slot).toBe("TOP");
    expect(map.LOWER.slot).toBe("LOWER");
    expect(map.IN_FEED).toBeUndefined();
  });
  it("drops a row with an unrecognised slot value rather than surfacing it", () => {
    const map = indexPromoSlotsBySlot([activeConfig({ slot: "SIDEBAR" })]);
    expect(map.SIDEBAR).toBeUndefined();
    expect(Object.keys(map)).toEqual([]);
  });
  it("handles a failed/empty fetch (undefined or []) the same as no active rows", () => {
    expect(indexPromoSlotsBySlot(undefined)).toEqual({});
    expect(indexPromoSlotsBySlot([])).toEqual({});
  });
});

describe("shouldRenderPromoSlot -- empty/inactive/missing behaviour", () => {
  it("renders when active with a valid image URL (active TOP renders)", () => {
    expect(shouldRenderPromoSlot(activeConfig())).toBe(true);
  });
  it("does not render when inactive (inactive TOP does not render)", () => {
    expect(shouldRenderPromoSlot(activeConfig({ active: false }))).toBe(false);
  });
  it("does not render when the slot has no config at all -- missing slot renders nothing", () => {
    expect(shouldRenderPromoSlot(undefined)).toBe(false);
    expect(shouldRenderPromoSlot(null)).toBe(false);
  });
  it("does not render when active but image_url is missing or invalid -- also proves a promo fetch failure (resolving to {}) can never break the calendar", () => {
    expect(shouldRenderPromoSlot(activeConfig({ image_url: null }))).toBe(false);
    expect(shouldRenderPromoSlot(activeConfig({ image_url: "" }))).toBe(false);
    expect(shouldRenderPromoSlot(activeConfig({ image_url: "not a url" }))).toBe(false);
    // The exact shape a failed DB.getPromoSlots() fetch degrades to in
    // App.jsx (.catch(() => []) -> indexPromoSlotsBySlot([]) -> {}), so
    // promoSlots.TOP is undefined -- never throws, never renders.
    expect(shouldRenderPromoSlot({}.TOP)).toBe(false);
  });
});

describe("resolvePromoSources -- mobile image fallback", () => {
  it("supplies a mobile source when a valid mobile_image_url is configured", () => {
    const sources = resolvePromoSources(activeConfig({ mobile_image_url: "https://musicscenemagazine.co.uk/wp-content/uploads/promo-mobile.jpg" }));
    expect(sources.mobileSrc).toBe("https://musicscenemagazine.co.uk/wp-content/uploads/promo-mobile.jpg");
    expect(sources.desktopSrc).toBe(activeConfig().image_url);
  });
  it("falls back to no mobile source (desktop image used on every viewport) when mobile_image_url is absent", () => {
    const sources = resolvePromoSources(activeConfig({ mobile_image_url: null }));
    expect(sources.mobileSrc).toBeNull();
    expect(sources.desktopSrc).toBe(activeConfig().image_url);
  });
  it("falls back the same way when mobile_image_url is present but invalid", () => {
    const sources = resolvePromoSources(activeConfig({ mobile_image_url: "not a url" }));
    expect(sources.mobileSrc).toBeNull();
  });
});

describe("hasMobileCreative -- PR #36 review fix: mobile fallback presentation decision", () => {
  it("A: true when a valid mobile creative is configured -- the 600x250 <picture> mobile <source>/aspect-ratio presentation applies", () => {
    expect(hasMobileCreative(activeConfig({ mobile_image_url: "https://musicscenemagazine.co.uk/wp-content/uploads/promo-mobile.jpg" }))).toBe(true);
  });
  it("B: false when no mobile creative is configured -- the desktop-native-aspect-ratio fallback applies instead (no destructive mobile crop)", () => {
    expect(hasMobileCreative(activeConfig({ mobile_image_url: null }))).toBe(false);
  });
  it("B: false when mobile_image_url is present but invalid -- same safe fallback, never a broken/malformed mobile source", () => {
    expect(hasMobileCreative(activeConfig({ mobile_image_url: "not a url" }))).toBe(false);
  });
  it("stays in exact lockstep with resolvePromoSources().mobileSrc -- the same underlying decision the <picture> element itself uses", () => {
    const withMobile = activeConfig({ mobile_image_url: "https://musicscenemagazine.co.uk/wp-content/uploads/promo-mobile.jpg" });
    const withoutMobile = activeConfig({ mobile_image_url: null });
    expect(hasMobileCreative(withMobile)).toBe(resolvePromoSources(withMobile).mobileSrc !== null);
    expect(hasMobileCreative(withoutMobile)).toBe(resolvePromoSources(withoutMobile).mobileSrc !== null);
  });
});

describe("artwork dimension constants", () => {
  it("desktop is 1200x250 (4.8:1) and mobile is 600x250 (2.4:1), matching the audit's own recommendation", () => {
    expect(DESKTOP_ARTWORK).toEqual({ width: 1200, height: 250 });
    expect(MOBILE_ARTWORK).toEqual({ width: 600, height: 250 });
  });
});

describe("shouldDisplayPromoSlot -- PR #36 review fix: broken image hides the slot", () => {
  it("C: displays when the slot should render and no image load failure has occurred", () => {
    expect(shouldDisplayPromoSlot(activeConfig(), false)).toBe(true);
  });
  it("C: hides when a real image load failure has occurred, even though the slot is otherwise perfectly valid/active", () => {
    expect(shouldDisplayPromoSlot(activeConfig(), true)).toBe(false);
  });
  it("stays hidden for the ordinary reasons (inactive/missing/invalid) regardless of the failure flag", () => {
    expect(shouldDisplayPromoSlot(activeConfig({ active: false }), false)).toBe(false);
    expect(shouldDisplayPromoSlot(undefined, false)).toBe(false);
  });
});

describe("resolveLinkProps -- target link attributes", () => {
  it("returns new-tab, noopener/noreferrer link props for a valid target_url", () => {
    const link = resolveLinkProps(activeConfig({ target_url: "https://musicscenemagazine.co.uk/" }));
    expect(link).toEqual({ href: "https://musicscenemagazine.co.uk/", target: "_blank", rel: "noopener noreferrer" });
  });
  it("returns null (non-clickable artwork, never a broken link) when target_url is missing", () => {
    expect(resolveLinkProps(activeConfig({ target_url: null }))).toBeNull();
  });
  it("returns null when target_url is present but invalid", () => {
    expect(resolveLinkProps(activeConfig({ target_url: "javascript:alert(1)" }))).toBeNull();
    expect(resolveLinkProps(activeConfig({ target_url: "not a url" }))).toBeNull();
  });
});

describe("resolvePromoLabel -- editorial vs sponsored/advertisement disclosure", () => {
  it("passes through each of the four supported labels", () => {
    for (const label of VALID_PROMO_LABELS) {
      expect(resolvePromoLabel(activeConfig({ label }))).toBe(label);
    }
  });
  it("returns null (no badge) for an unrecognised label rather than rendering raw unvalidated text", () => {
    expect(resolvePromoLabel(activeConfig({ label: "Definitely Not A Real Label" }))).toBeNull();
    expect(resolvePromoLabel(activeConfig({ label: null }))).toBeNull();
    expect(resolvePromoLabel(undefined)).toBeNull();
  });
});

describe("shouldShowInFeedSlot / buildListViewItems -- List View IN_FEED placement", () => {
  const gigs = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, band_name: `Band ${i}`, date: `2026-09-${10 + i}` }));

  it("shows IN_FEED once there are enough results (more than IN_FEED_AFTER_INDEX)", () => {
    expect(IN_FEED_AFTER_INDEX).toBe(6);
    expect(shouldShowInFeedSlot(activeConfig(), 7)).toBe(true);
  });

  it("IN_FEED hidden for insufficient results -- exactly at or below the threshold", () => {
    expect(shouldShowInFeedSlot(activeConfig(), 6)).toBe(false);
    expect(shouldShowInFeedSlot(activeConfig(), 1)).toBe(false);
    expect(shouldShowInFeedSlot(activeConfig(), 0)).toBe(false);
  });

  it("IN_FEED hidden when the slot itself is inactive/missing, regardless of result count", () => {
    expect(shouldShowInFeedSlot(activeConfig({ active: false }), 50)).toBe(false);
    expect(shouldShowInFeedSlot(undefined, 50)).toBe(false);
  });

  it("inserts exactly one promo item after the 6th gig when there are enough results", () => {
    const items = buildListViewItems(gigs, activeConfig());
    expect(items).toHaveLength(11); // 10 gigs + 1 promo
    expect(items[6]).toEqual({ kind: "promo", config: activeConfig() });
    expect(items.filter((i) => i.kind === "promo")).toHaveLength(1);
  });

  it("IN_FEED does not affect gig order -- every gig appears exactly once, in its original sorted order, identity preserved", () => {
    const items = buildListViewItems(gigs, activeConfig());
    const gigItems = items.filter((i) => i.kind === "gig").map((i) => i.gig);
    expect(gigItems).toEqual(gigs); // same objects, same order, nothing dropped/duplicated/reordered
  });

  it("returns gigs unchanged (no promo item at all) when the slot should not show", () => {
    const items = buildListViewItems(gigs.slice(0, 5), activeConfig());
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.kind === "gig")).toBe(true);
  });

  it("returns gigs unchanged for an empty gig list", () => {
    expect(buildListViewItems([], activeConfig())).toEqual([]);
  });
});

describe("validatePromoSlotForm -- admin config validation", () => {
  it("passes for a fully valid form", () => {
    expect(validatePromoSlotForm(activeConfig())).toEqual([]);
  });
  it("passes for a minimal/blank form on a known slot (admin mid-setup, or deactivating)", () => {
    expect(validatePromoSlotForm({ slot: "TOP", image_url: "", mobile_image_url: "", target_url: "", label: "" })).toEqual([]);
  });
  it("rejects an unknown slot", () => {
    expect(validatePromoSlotForm({ slot: "SIDEBAR" })).toContain("Slot must be one of TOP, IN_FEED, LOWER.");
  });
  it("rejects an invalid (non-empty) image URL", () => {
    expect(validatePromoSlotForm({ slot: "TOP", image_url: "not a url" })).toContain("Desktop image URL must be a valid http(s) URL.");
  });
  it("rejects an invalid (non-empty) mobile image URL", () => {
    expect(validatePromoSlotForm({ slot: "TOP", mobile_image_url: "not a url" })).toContain("Mobile image URL must be a valid http(s) URL.");
  });
  it("rejects an invalid (non-empty) target URL", () => {
    expect(validatePromoSlotForm({ slot: "TOP", target_url: "javascript:alert(1)" })).toContain("Destination URL must be a valid http(s) URL.");
  });
  it("rejects a label outside the four supported values", () => {
    expect(validatePromoSlotForm({ slot: "TOP", label: "Not A Real Label" })).toContain("Label must be one of Editorial, Sponsored, Advertisement, Partner.");
  });
  it("accumulates multiple errors at once", () => {
    const errors = validatePromoSlotForm({ slot: "SIDEBAR", image_url: "nope", label: "nope" });
    expect(errors.length).toBe(3);
  });
});
