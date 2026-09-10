/**
 * PromoSlot.jsx — Editorial Promo + Future Advertising Positions, Phase 1
 *
 * One reusable component for all three fixed public-page positions (TOP,
 * IN_FEED, LOWER — see App.jsx's own render for where each is placed).
 * Serves both MSM's own editorial promotion today and a paid
 * sponsor/advertiser creative later, without any UI change — see this
 * engagement's read-only architecture audit for the full reasoning.
 *
 * Deliberately NOT a campaign/advertising platform: no scheduling,
 * rotation, impressions/click tracking, geographic targeting, or billing
 * in this phase (see promo_slots migration's own header comment).
 *
 * TESTING NOTE (same convention as venueSearch/VenuePicker.jsx —
 * see that file's own comment): this repo has no jsdom or
 * @testing-library/react dependency, and this task explicitly says not
 * to introduce a new testing framework solely for one component. Every
 * piece of logic with a real correctness requirement is therefore
 * factored out into the plain, exported functions below, fully covered
 * by PromoSlot.test.js without rendering anything. The component itself
 * is a thin wrapper over those functions, verified by direct code
 * review instead of an automated render test.
 */

import { useState, useEffect } from "react";

// ── Pure logic (fully unit-tested — see PromoSlot.test.js) ────────────────

export const FIXED_SLOTS = ["TOP", "IN_FEED", "LOWER"];
export const VALID_PROMO_LABELS = ["Editorial", "Sponsored", "Advertisement", "Partner"];

// IN_FEED only feels like part of the results, not a lonely orphan card,
// once there's a real screenful of gigs both above and below it. Chosen
// conservatively: at least one more gig must follow the insertion point,
// so the slot never lands exactly at the end of a short list.
export const IN_FEED_AFTER_INDEX = 6;

// Desktop/mobile artwork dimensions per the audit's own recommendation --
// used both for the <img> intrinsic width/height (a CLS-prevention floor
// for browsers that ignore aspect-ratio) and PROMO_SLOT_CSS's own
// aspect-ratio rules below (the one that actually governs layout in any
// modern browser, and the one that switches at the same 600px breakpoint
// the <picture> mobile <source> uses).
export const DESKTOP_ARTWORK = { width: 1200, height: 250 };
export const MOBILE_ARTWORK = { width: 600, height: 250 };

export function isKnownSlot(slot) {
  return FIXED_SLOTS.includes(slot);
}

export function isValidHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Indexes DB.getPromoSlots()'s row array by slot name for O(1) lookup
// from MainApp (e.g. { TOP: {...}, LOWER: {...} }). A slot with no
// active row simply has no key here -- exactly the same shape a
// failed/empty fetch already produces (see App.jsx's own .catch(() =>
// [])), so callers never need to distinguish "fetch failed" from
// "nothing active for this slot": both just mean
// shouldRenderPromoSlot(undefined) === false. Rows for an unrecognised
// slot value (should not happen given the DB's own CHECK constraint, but
// never trusted blindly) are silently dropped rather than surfaced.
export function indexPromoSlotsBySlot(rows) {
  const map = {};
  for (const row of rows || []) {
    if (row && isKnownSlot(row.slot)) map[row.slot] = row;
  }
  return map;
}

// The one gate for "does this slot have anything worth putting on the
// page at all". Missing config (undefined/null -- a slot with no active
// row, or a failed fetch that resolved to {}) is treated exactly the
// same as an explicitly inactive row or a blank image URL: render
// nothing, per the audit's own "empty/inactive behaviour" requirement.
export function shouldRenderPromoSlot(config) {
  return Boolean(config && config.active === true && isValidHttpUrl(config.image_url));
}

// The <picture> element's two candidate sources. mobileSrc is the
// <source media="(max-width:600px)"> candidate -- omitted entirely
// (null) when no mobile-specific creative has been configured, so the
// browser simply keeps using the desktop <img> on a small screen rather
// than forcing a wrong-aspect-ratio crop/stretch of the desktop creative.
// desktopSrc is always the <img> tag's own src.
export function resolvePromoSources(config) {
  return {
    desktopSrc: config?.image_url || null,
    mobileSrc: isValidHttpUrl(config?.mobile_image_url) ? config.mobile_image_url : null,
  };
}

// A slot's artwork is shown whenever shouldRenderPromoSlot() already
// passed; whether it's wrapped in a clickable link is a separate,
// independent decision -- an admin may legitimately paste artwork before
// the destination URL is finalised. Rather than hiding an
// already-approved banner over a link-only omission/typo, or rendering a
// dead/broken <a href="">, an invalid or missing target_url simply means
// the artwork renders WITHOUT a link wrapper (plain, non-clickable
// image) -- documented safest-consistent behaviour per the audit's own
// open question on this.
export function resolveLinkProps(config) {
  if (!isValidHttpUrl(config?.target_url)) return null;
  return { href: config.target_url, target: "_blank", rel: "noopener noreferrer" };
}

// PR #36 review fix: whether a dedicated mobile creative exists is the
// one decision that governs which CSS aspect-ratio a small viewport
// gets (see PROMO_SLOT_CSS's msm-promo-slot--has-mobile modifier below).
// Extracted as its own named, directly-testable decision because of its
// significance -- this is exactly the "critical fallback review" case
// the independent review flagged: WITHOUT this modifier class gating
// the mobile aspect-ratio override, a mobile viewport would force the
// 4.8:1 desktop creative into a 2.4:1 box via object-fit:cover, cropping
// ~25% off each side and risking real content loss (a logo or CTA
// positioned near either edge). Equivalent to
// resolvePromoSources(config).mobileSrc !== null.
export function hasMobileCreative(config) {
  return resolvePromoSources(config).mobileSrc !== null;
}

// PR #36 review fix: the final render gate, combining
// shouldRenderPromoSlot()'s own active/valid-URL check with a runtime
// image-load failure (see PromoSlot's own onError handling below) --
// extracted as its own pure, testable decision so "a broken image hides
// the slot" has real test coverage without needing to simulate an
// actual <img> load failure (this repo has no jsdom -- see this file's
// own testing note above).
export function shouldDisplayPromoSlot(config, imgFailed) {
  return shouldRenderPromoSlot(config) && !imgFailed;
}

// Only one of the four fixed labels is ever rendered as a disclosure
// badge. An unrecognised value (corrupted data, or a future label this
// older client build doesn't know about yet) fails safe to no badge at
// all, rather than displaying raw, unvalidated text on the public page.
export function resolvePromoLabel(config) {
  return VALID_PROMO_LABELS.includes(config?.label) ? config.label : null;
}

export function shouldShowInFeedSlot(config, gigCount) {
  return shouldRenderPromoSlot(config) && gigCount > IN_FEED_AFTER_INDEX;
}

// Interleaves the IN_FEED promo (if any) into an already-sorted gig list
// for ListView's own render. Pure and side-effect-free, so it's testable
// without mounting anything, and so ListView's existing sort/filter
// logic (completely untouched) can never be affected by it: this only
// ever inserts one extra { kind:"promo" } item into the returned array
// -- it never reorders, drops, duplicates, or otherwise touches a
// { kind:"gig" } item or the `gig` objects themselves.
export function buildListViewItems(sortedGigs, promoConfig) {
  const items = sortedGigs.map((gig) => ({ kind: "gig", gig }));
  if (!shouldShowInFeedSlot(promoConfig, sortedGigs.length)) return items;
  const before = items.slice(0, IN_FEED_AFTER_INDEX);
  const after = items.slice(IN_FEED_AFTER_INDEX);
  return [...before, { kind: "promo", config: promoConfig }, ...after];
}

// Admin form validation -- deliberately minimal: this is a 3-fixed-row
// configuration form, not a general content model. Every URL field is
// optional (an admin may be mid-setup, or deliberately deactivating a
// slot), but if present must be a real http(s) URL; label, if present,
// must be one of the four supported values (also enforced by the DB's
// own CHECK constraint -- this is the same validation surfaced early, in
// the admin UI, before a round trip).
export function validatePromoSlotForm(form) {
  const errors = [];
  if (!isKnownSlot(form?.slot)) errors.push("Slot must be one of TOP, IN_FEED, LOWER.");
  if (form?.image_url && !isValidHttpUrl(form.image_url)) errors.push("Desktop image URL must be a valid http(s) URL.");
  if (form?.mobile_image_url && !isValidHttpUrl(form.mobile_image_url)) errors.push("Mobile image URL must be a valid http(s) URL.");
  if (form?.target_url && !isValidHttpUrl(form.target_url)) errors.push("Destination URL must be a valid http(s) URL.");
  if (form?.label && !VALID_PROMO_LABELS.includes(form.label)) errors.push("Label must be one of Editorial, Sponsored, Advertisement, Partner.");
  return errors;
}

// ── Component ───────────────────────────────────────────────────────────

// Scoped by a stable class name rather than touching App.jsx's own
// GLOBAL_CSS -- keeps this feature self-contained in its own file.
//
// Desktop width correction: max-width caps the SLOT (not just the img)
// at the artwork's own native 1200px, with margin:16px auto centring it
// -- below that width it's still full-width (auto block sizing, the
// existing "width:100% below the max" behaviour), it just never grows
// past its native size and gets upscaled into an oversized hero on a
// wide desktop viewport. Capping the container rather than only the img
// keeps the label badge (positioned absolutely relative to this same
// element) correctly aligned to the actual displayed artwork edge at
// any viewport width, and works identically in ListView's flex column
// (IN_FEED) and the plain block flow above/below the list (TOP/LOWER):
// max-width still constrains a stretched flex item, and margin:auto
// still centres it in the leftover space.
//
// PR #36 review fix (mobile fallback): the mobile aspect-ratio override
// below is scoped to .msm-promo-slot--has-mobile, a modifier class the
// component only adds when hasMobileCreative(config) is true. When a
// dedicated mobile creative WAS supplied, the <picture> mobile <source>
// and this 2.4:1 override switch together at the same 600px breakpoint,
// exactly as before -- correct 600x250 presentation, no distortion. When
// no mobile creative exists, the modifier class is absent, so the img
// keeps the desktop 4.8:1 aspect-ratio at every viewport width: the full,
// uncropped desktop creative is preserved (just naturally thinner at
// mobile widths, since height scales down with width) instead of being
// force-cropped into a 2.4:1 box via object-fit:cover -- a thinner banner
// beats losing a logo/CTA positioned near either edge. (Well below the
// 1200px cap in any case, so this correction never interacts with it.)
export const PROMO_SLOT_CSS = `
.msm-promo-slot { position:relative; margin:16px auto; max-width:${DESKTOP_ARTWORK.width}px; }
.msm-promo-slot img {
  display:block; width:100%; height:auto;
  aspect-ratio:${DESKTOP_ARTWORK.width}/${DESKTOP_ARTWORK.height};
  object-fit:cover; border-radius:8px;
}
.msm-promo-slot a { display:block; }
.msm-promo-slot__label {
  position:absolute; top:8px; left:8px; z-index:1;
  padding:3px 9px; border-radius:999px; font-size:10px; font-weight:700;
  letter-spacing:1px; text-transform:uppercase; color:#fff;
  background:rgba(10,10,10,0.72); pointer-events:none;
}
@media (max-width:600px) {
  .msm-promo-slot--has-mobile img { aspect-ratio:${MOBILE_ARTWORK.width}/${MOBILE_ARTWORK.height}; }
}
`;

// `eager`: true only for the TOP slot (above-the-fold, loads with
// priority); IN_FEED/LOWER default to lazy, off-screen at first paint.
// Fetching/rendering promo content never blocks or delays gig data --
// this component reads only its own `config` prop, computed once in
// MainApp from a promo-slots fetch that is itself independent of (and
// never awaited by) the gigs fetch; see App.jsx's own loading state,
// which this component has no part in.
export default function PromoSlot({ config, eager = false }) {
  // PR #36 review fix (broken image): tracks a real <img> load failure
  // (a syntactically valid URL that 404s or otherwise fails to fetch) --
  // shouldRenderPromoSlot() alone only validates URL syntax, it can't
  // know whether the URL actually resolves to an image. Declared before
  // the shouldDisplayPromoSlot() early return below (Rules of Hooks: a
  // hook can never follow a conditional return).
  const [imgFailed, setImgFailed] = useState(false);

  // Reset the failure flag whenever the underlying creative URL(s)
  // change, so a slot that failed once gets a fresh attempt at a NEW
  // image instead of staying hidden forever -- never a retry loop on
  // the same URL (nothing re-triggers the effect unless the config
  // itself changes), just a clean re-attempt when the admin fixes/swaps
  // the URL and MainApp's next promo-slots fetch delivers it.
  useEffect(() => {
    setImgFailed(false);
  }, [config?.image_url, config?.mobile_image_url]);

  if (!shouldDisplayPromoSlot(config, imgFailed)) return null;

  const { desktopSrc, mobileSrc } = resolvePromoSources(config);
  const link = resolveLinkProps(config);
  const label = resolvePromoLabel(config);
  const altText = config.alt_text || "";
  const layoutClass = hasMobileCreative(config) ? "msm-promo-slot msm-promo-slot--has-mobile" : "msm-promo-slot";

  const media = (
    <picture>
      {mobileSrc && <source media="(max-width: 600px)" srcSet={mobileSrc} />}
      <img
        src={desktopSrc}
        alt={altText}
        width={DESKTOP_ARTWORK.width}
        height={DESKTOP_ARTWORK.height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => setImgFailed(true)}
        {...(eager ? { fetchpriority: "high" } : {})}
      />
    </picture>
  );

  return (
    <div className={layoutClass}>
      <style>{PROMO_SLOT_CSS}</style>
      {label && <span className="msm-promo-slot__label">{label}</span>}
      {link ? (
        <a href={link.href} target={link.target} rel={link.rel} aria-label={altText || "Promotional link"}>
          {media}
        </a>
      ) : (
        media
      )}
    </div>
  );
}
