// Festival Hub -- pure search / filter / sort over listings.
import { STATUS, applicationStatus } from "./status.js";

export const ALL = "all";

export const DEFAULT_FILTERS = Object.freeze({
  search: "",
  region: ALL,
  genre: ALL,
  status: ALL,
  deadline: ALL, // all | 7 | 30 | 90  (open listings closing within N days)
  savedOnly: false,
});

export const DEADLINE_OPTIONS = Object.freeze([
  { value: ALL, label: "Any deadline" },
  { value: "7", label: "Closing within 7 days" },
  { value: "30", label: "Closing within 30 days" },
  { value: "90", label: "Closing within 90 days" },
]);

export const STATUS_ORDER = [STATUS.OPEN, STATUS.NOT_YET_OPEN, STATUS.UNVERIFIED, STATUS.CLOSED];

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export const regionsOf = (listings) => uniqueSorted(listings.map((l) => l.region).filter(Boolean));
export const genresOf = (listings) => uniqueSorted(listings.flatMap((l) => l.genres || []));

const norm = (s) => String(s || "").toLowerCase();

export function isDefaultFilters(filters) {
  return Object.keys(DEFAULT_FILTERS).every((k) => filters[k] === DEFAULT_FILTERS[k]);
}

// Attaches computed status info, filters and sorts.
// `savedIds` is a Set of saved listing ids.
export function applyFilters(listings, filters, { today, savedIds = new Set() } = {}) {
  const q = norm(filters.search).trim();
  const withinDays = filters.deadline === ALL ? null : Number(filters.deadline);

  return listings
    .map((listing) => ({ listing, info: applicationStatus(listing, today) }))
    .filter(({ listing, info }) => {
      if (filters.region !== ALL && listing.region !== filters.region) return false;
      if (filters.genre !== ALL && !(listing.genres || []).includes(filters.genre)) return false;
      if (filters.status !== ALL && info.status !== filters.status) return false;
      if (withinDays != null && !(info.status === STATUS.OPEN && info.daysLeft <= withinDays)) return false;
      if (filters.savedOnly && !savedIds.has(listing.id)) return false;
      if (q) {
        const hay = [listing.name, listing.region, listing.location, ...(listing.genres || [])].map(norm).join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const byStatus = STATUS_ORDER.indexOf(a.info.status) - STATUS_ORDER.indexOf(b.info.status);
      if (byStatus) return byStatus;
      // Soonest deadline first within a status; unknown deadlines last.
      const ca = a.listing.application?.closes || "9999-12-31";
      const cb = b.listing.application?.closes || "9999-12-31";
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.listing.name.localeCompare(b.listing.name);
    });
}
