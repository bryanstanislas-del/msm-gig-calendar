// Sprint 4 (Notification Centre): pure, side-effect-free helpers.
//
// Deliberately kept out of App.jsx and free of any Supabase/React import so
// they can be unit tested in isolation -- App.jsx has no test coverage today
// and pulls in a live Supabase client at module scope, which would make
// testing anything defined there require mocking network/auth state first.

// Mirrors the column defaults in
// supabase/migrations/20260729155347_sprint3_5_notification_delivery_architecture.sql
// (user_notification_preferences). Used whenever a user hasn't saved
// preferences yet, so the UI has something sensible to render/toggle from
// before their first save.
export const DEFAULT_NOTIFICATION_PREFS = {
  in_app_enabled: true,
  email_enabled: false,
  web_push_enabled: false,
  new_gig_alerts: true,
  cancellation_alerts: true,
  artist_updates: true,
  venue_updates: true,
  festival_updates: true,
};

function gigLine(metadata) {
  if (!metadata) return "";
  const where = [metadata.band_name, metadata.venue, metadata.city].filter(Boolean).join(" — ");
  const when = formatNotificationDate(metadata.date);
  return [where, when].filter(Boolean).join(" · ");
}

// event_type -> display copy. Mirrors the event_type -> category mapping in
// fanout_notification_event (same migration as above) -- keep in sync if a
// new event_type is ever added on the backend.
const EVENT_COPY = {
  gig_added:         { title: "New gig added",           describe: gigLine },
  gig_cancelled:     { title: "Gig cancelled",            describe: gigLine },
  venue_event_added: { title: "New event at your venue",  describe: gigLine },
  festival_updated:  {
    title: "Festival profile updated",
    // metadata.band_name is the festival's own display name here -- an
    // existing Sprint 3 naming quirk (recordNotificationEvent call in
    // EditProfile), not something introduced by this helper.
    describe: (metadata) => metadata?.band_name ? `${metadata.band_name} was updated.` : "Your festival profile was updated.",
  },
};

// dateStr: any value the Date constructor can parse (an ISO "YYYY-MM-DD"
// gig date, or a full timestamptz string) -- both are used as inputs across
// the notification list, so this is intentionally permissive rather than
// assuming one shape.
export function formatNotificationDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Turns a raw { eventType, metadata } pair (as returned by DB.getNotifications)
// into display-ready { title, body } text. Falls back to a generic label for
// any event_type this map doesn't know about yet, rather than rendering
// blank/broken text if the backend ever adds one this hasn't been updated for.
export function describeNotificationEvent({ eventType, metadata } = {}) {
  const copy = EVENT_COPY[eventType];
  if (!copy) return { title: "Notification", body: "" };
  return { title: copy.title, body: copy.describe(metadata) || "" };
}
