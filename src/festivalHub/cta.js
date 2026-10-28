// Festival Hub -- outbound links for a listing (pure, unit-tested).
//
// Only an OPEN window with a checked 2027 application page gets the
// apply-style "Official application page" button. Everything else links
// to official information, and any application page that isn't current is
// labelled as reference (historical edition or not open).
import { HUB_EDITION_YEAR } from "./constants.js";
import { STATUS } from "./status.js";

export function ctaLinks(listing, info, demo = false) {
  const ap = listing.application || {};
  const tag = demo ? " (demo example)" : "";
  const links = [];
  const canApply = info.status === STATUS.OPEN && !!ap.url && ap.urlEdition === HUB_EDITION_YEAR;
  if (canApply) links.push({ kind: "apply", href: ap.url, label: `Official application page${tag}`, primary: true });
  links.push({ kind: "info", href: listing.officialUrl, label: `View official information${tag}`, primary: !canApply });
  if (!canApply && ap.url) {
    const label = ap.urlEdition && ap.urlEdition < HUB_EDITION_YEAR
      ? `${ap.urlEdition} application page (historical — not for ${HUB_EDITION_YEAR})`
      : `${HUB_EDITION_YEAR} application page (not open — reference only)`;
    links.push({ kind: "reference", href: ap.url, label: label + tag, primary: false });
  }
  // Same page twice (e.g. the application page is the official page): keep the first.
  return links.filter((l, i) => links.findIndex((x) => x.href === l.href) === i);
}
