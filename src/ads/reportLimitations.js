// Honest measurement limitations shown in the portal and printed in every report.
export const REPORT_LIMITATIONS = [
  "Impression = at least 50% of the advert's pixels visible in the browser viewport for at least 1 continuous second while the tab is visible (IAB/MRC display viewability guideline), measured by MSM's own script.",
  "Counts are first-party and unaudited. Ad blockers, disabled JavaScript, privacy tools and network failures prevent some views/clicks from being counted.",
  "Repeat views/clicks by the same browser within 30 minutes are counted once; known bots and abnormal request rates are excluded. Filtering is heuristic and not MRC-accredited.",
  "Visitors are identified only by a daily-rotating keyed hash that is discarded after 30 minutes; no IP addresses, cookies or personal data are stored.",
  "Dates are UK calendar days (Europe/London). Days before the advert was approved, or while it was paused, show zero.",
];
