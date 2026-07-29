import { describe, it, expect } from "vitest";
import { describeNotificationEvent, formatNotificationDate, DEFAULT_NOTIFICATION_PREFS } from "./notificationHelpers";

describe("formatNotificationDate", () => {
  it("formats an ISO date string as day/short-month/year", () => {
    expect(formatNotificationDate("2026-08-15")).toBe("15 Aug 2026");
  });

  it("formats a full timestamptz string", () => {
    expect(formatNotificationDate("2026-08-15T10:30:00.000Z")).toMatch(/^15 Aug 2026$/);
  });

  it("returns an empty string for falsy input", () => {
    expect(formatNotificationDate(null)).toBe("");
    expect(formatNotificationDate(undefined)).toBe("");
    expect(formatNotificationDate("")).toBe("");
  });

  it("returns an empty string for an unparseable date instead of 'Invalid Date'", () => {
    expect(formatNotificationDate("not-a-date")).toBe("");
  });
});

describe("describeNotificationEvent", () => {
  it("describes a new gig alert with band/venue/city/date", () => {
    const { title, body } = describeNotificationEvent({
      eventType: "gig_added",
      metadata: { band_name: "The Velvet Wolves", venue: "The Roxy", city: "Manchester", date: "2026-09-01" },
    });
    expect(title).toBe("New gig added");
    expect(body).toBe("The Velvet Wolves — The Roxy — Manchester · 1 Sept 2026");
  });

  it("describes a cancellation using the same gig metadata shape", () => {
    const { title, body } = describeNotificationEvent({
      eventType: "gig_cancelled",
      metadata: { band_name: "The Velvet Wolves", venue: "The Roxy", city: "Manchester", date: "2026-09-01" },
    });
    expect(title).toBe("Gig cancelled");
    expect(body).toContain("The Velvet Wolves");
  });

  it("describes a venue event addition", () => {
    const { title } = describeNotificationEvent({
      eventType: "venue_event_added",
      metadata: { band_name: "The Velvet Wolves", venue: "The Roxy", city: "Manchester", date: "2026-09-01" },
    });
    expect(title).toBe("New event at your venue");
  });

  it("describes a festival update using the festival's own name", () => {
    const { title, body } = describeNotificationEvent({
      eventType: "festival_updated",
      metadata: { band_name: "Meadow Sounds Festival" },
    });
    expect(title).toBe("Festival profile updated");
    expect(body).toBe("Meadow Sounds Festival was updated.");
  });

  it("falls back to a generic label for an event_type it doesn't recognize", () => {
    const { title, body } = describeNotificationEvent({ eventType: "some_future_event", metadata: {} });
    expect(title).toBe("Notification");
    expect(body).toBe("");
  });

  it("handles missing metadata without throwing", () => {
    expect(() => describeNotificationEvent({ eventType: "gig_added" })).not.toThrow();
    expect(describeNotificationEvent({ eventType: "gig_added" }).body).toBe("");
  });

  it("handles a completely empty call without throwing", () => {
    expect(() => describeNotificationEvent()).not.toThrow();
    expect(describeNotificationEvent().title).toBe("Notification");
  });

  it("omits missing gig-line fields gracefully (no dangling separators)", () => {
    const { body } = describeNotificationEvent({
      eventType: "gig_added",
      metadata: { band_name: "The Velvet Wolves" }, // no venue/city/date
    });
    expect(body).toBe("The Velvet Wolves");
  });
});

describe("DEFAULT_NOTIFICATION_PREFS", () => {
  it("defaults in-app on, email/web-push off, and all alert categories on", () => {
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({
      in_app_enabled: true,
      email_enabled: false,
      web_push_enabled: false,
      new_gig_alerts: true,
      cancellation_alerts: true,
      artist_updates: true,
      venue_updates: true,
      festival_updates: true,
    });
  });
});
