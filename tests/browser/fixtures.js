// Synthetic fixtures for the local browser checks. No real people, emails or
// keys; *.invalid domains only. The page clock is fixed at NOW by the runner.
export const NOW = "2026-11-02T12:00:00Z";
export const USERS = {
  owner: { id: "u-owner", role: "advertiser" },
  other: { id: "u-other", role: "advertiser" },
  admin: { id: "u-admin", role: "admin" },
};
const snap = (over = {}) => ({ product_name: "TEST homepage top (daily)", unit_codes: ["wordpress-home-top"], billable_days: 2,
  price_per_day_pence: 1000, total_pence: 2000, currency: "gbp", is_test: true, ...over });
const booking = (id, adv, start, end, over = {}, campaign = null) => ({
  id, advertiser_id: adv, start_date: start, end_date: end, serve_from: null, serve_until: null, amended_at: null, status: "confirmed",
  status_reason: null, hold_expires_at: "2026-10-30T00:00:00Z", is_test: true, created_at: "2026-10-28T10:00:00Z", confirmed_at: "2026-10-28T10:05:00Z",
  ad_purchase_snapshots: snap(), ad_payments: [{ status: "paid", amount_pence: 2000, currency: "gbp", requires_refund: false }],
  ad_campaigns: campaign ? [campaign] : [], ...over,
});
const version = (id, no, status, over = {}) => ({ id, version_no: no, status, destination_url: "https://example.invalid/", alt_text: `ZZ banner ${no}`,
  submitted_at: "2026-11-02T09:00:00Z", review_clock_started_at: "2026-11-02T09:00:00Z", review_due_before: "2026-11-02T21:00:00Z",
  reviewed_at: null, rejection_reason: null, desktop_object_path: "a/b/c-desktop.png", mobile_object_path: "a/b/c-mobile.png", ...over });

export const fixture = {
  ad_advertisers: [
    { id: "adv-owner", owner_user_id: "u-owner", display_name: "ZZ Owner <b>Co</b>", contact_email: "owner@example.invalid", status: "active" },
    { id: "adv-other", owner_user_id: "u-other", display_name: "ZZ Other", contact_email: "other@example.invalid", status: "active" },
  ],
  ad_products: [{ id: "p-daily", code: "TEST-wp-home-top-daily", name: "TEST homepage top (daily)", description: "TEST PRICE", price_per_day_pence: 1000,
    min_days: 1, max_days: 28, currency: "gbp", is_test: true, active: true,
    ad_product_units: [{ ad_inventory_units: { code: "wordpress-home-top", name: "Homepage top", desktop_width: 1200, desktop_height: 250, mobile_width: 600, mobile_height: 250, max_bytes: 1048576 } }] }],
  ad_inventory_units: [{ id: "u1", code: "wordpress-home-top", name: "Homepage top", rotation_capacity: 1, active: true, is_test: true }],
  ad_settings: [
    { key: "ads_priority_review_enabled", bool_value: true, int_value: null, description: "Priority review" },
    { key: "ads_amendments_enabled", bool_value: true, int_value: null, description: "Amendments" },
  ],
  ad_bookings: [
    booking("b-review", "adv-owner", "2026-11-03", "2026-11-04", { ad_purchase_snapshots: snap({ total_pence: 17000 }) },
      { id: "c-review", review_status: "under_review", current_version_id: "v2", approved_version_id: null, paused: false,
        ad_creative_versions: [version("v1", 1, "correction_requested"), version("v2", 2, "submitted")] }),
    booking("b-amend", "adv-owner", "2026-11-02", "2026-11-03", {},
      { id: "c-amend", review_status: "approved", current_version_id: "v3", approved_version_id: "v3", paused: false,
        ad_creative_versions: [version("v3", 1, "approved", { reviewed_at: "2026-11-02T10:17:00Z" })] }),
    booking("b-expired", "adv-owner", "2026-11-06", "2026-11-06"),
    booking("b-other", "adv-other", "2026-11-08", "2026-11-08"),
    booking("b-removed", "adv-other", "2026-11-10", "2026-11-10", { status: "cancelled", status_reason: "Removed by MSM (financial assessment separate)" }),
  ],
  ad_booking_confirmations: [{ booking_id: "b-review", confirmed_at: "2026-10-28T10:05:00Z", total_pence: 17000, placement_pence: 2000,
    priority_fee_pence: 15000, priority_review: true, currency: "gbp", terms_version: "DRAFT-NOT-APPROVED-2026-10-16",
    review_rule: "Initial review within 12 elapsed hours", booked_from: "2026-11-03T00:00:00Z", booked_until: "2026-11-05T00:00:00Z" }],
  ad_booking_amendments: [
    { id: "am-open", booking_id: "b-amend", reason: "correction_delay", status: "proposed", approved_at: "2026-11-02T10:17:00Z",
      original_from: "2026-11-02T00:00:00Z", original_until: "2026-11-04T00:00:00Z", proposed_from: "2026-11-02T11:00:00Z", proposed_until: "2026-11-04T00:00:00Z",
      purchased_seconds: 172800, preserves_duration: false, shortened_seconds: 39600, proposed_at: "2026-11-02T10:30:00Z", expires_at: "2026-11-03T10:30:00Z", decided_at: null },
    { id: "am-lapsed", booking_id: "b-expired", reason: "correction_delay", status: "proposed", approved_at: "2026-10-31T10:00:00Z",
      original_from: "2026-11-06T00:00:00Z", original_until: "2026-11-07T00:00:00Z", proposed_from: "2026-11-06T11:00:00Z", proposed_until: "2026-11-07T11:00:00Z",
      purchased_seconds: 86400, preserves_duration: true, shortened_seconds: 0, proposed_at: "2026-11-01T10:00:00Z", expires_at: "2026-11-02T10:00:00Z", decided_at: null },
    { id: "am-other", booking_id: "b-other", reason: "correction_delay", status: "proposed", approved_at: "2026-11-02T09:00:00Z",
      original_from: "2026-11-08T00:00:00Z", original_until: "2026-11-09T00:00:00Z", proposed_from: "2026-11-08T10:00:00Z", proposed_until: "2026-11-09T10:00:00Z",
      purchased_seconds: 86400, preserves_duration: true, shortened_seconds: 0, proposed_at: "2026-11-02T09:30:00Z", expires_at: "2026-11-03T09:30:00Z", decided_at: null },
  ],
  sla: {
    "b-review": { initial_kind: "initial_priority", initial_due_at: "2026-11-02T21:00:00Z", initial_review_met: null, priority_fee_refund_assessment_needed: false,
      first_review_outcome: "correction_requested", first_review_outcome_at: "2026-11-02T10:00:00Z",
      deadlines: [{ kind: "initial_priority", starts_at: "2026-11-02T09:00:00Z", due_at: "2026-11-02T21:00:00Z" },
                  { kind: "correction_response", starts_at: "2026-11-02T11:00:00Z", due_at: "2026-11-02T14:00:00Z" }],
      corrections: [{ id: "rq1", version_no: 1, reasons: ["Logo <script>x</script> cropped", "Link returns 404"], status: "awaiting_response",
                      response_due_at: "2026-11-02T14:00:00Z", cause: "advertiser_material", timely: null }] },
    "b-amend": { initial_kind: "initial_priority", initial_due_at: "2026-11-01T12:00:00Z", initial_review_met: false, priority_fee_refund_assessment_needed: true,
      first_review_outcome: "approved", first_review_outcome_at: "2026-11-02T10:17:00Z", deadlines: [], corrections: [] },
  },
  ad_refund_assessments: [
    { id: "ra-gated", booking_id: "b-amend", kind: "service_failure", status: "manual_gate", total_pence: 15250, gates: ["cross_kind_allocation", "exceeds_booking_total"],
      note: "Priority missed", proposed_at: "2026-11-02T11:00:00Z", decided_at: null, decision_note: null, target_pay_by: null,
      ad_refund_lines: [{ kind: "priority_fee", pence: 15000 }, { kind: "lost_time", pence: 250, lost_seconds: 21600, purchased_seconds: 172800 }], ad_refund_processing_events: [] },
    { id: "ra-open", booking_id: "b-review", kind: "service_failure", status: "proposed", total_pence: 250, gates: [],
      note: "Outage", proposed_at: "2026-11-02T11:30:00Z", decided_at: null, decision_note: null, target_pay_by: null,
      ad_refund_lines: [{ kind: "lost_time", pence: 250, lost_seconds: 21600, purchased_seconds: 172800 }], ad_refund_processing_events: [] },
  ],
  ad_cancellation_cases: [{ booking_id: "b-removed", initiated_by: "msm", party_type: "business", removed_at: "2026-11-01T09:00:00Z", reason: "Slot withdrawn" }],
  ad_notification_outbox: [
    { id: "n-recon", kind: "correction_request", status: "needs_reconciliation", attempts: 6, recipient_role: "advertiser", booking_id: "b-review",
      created_at: "2026-11-01T09:00:00Z", accepted_at: null, delivered_at: null, failed_at: null, next_attempt_at: "2026-11-01T09:00:00Z",
      last_error: "HTTP 503", first_dispatched_at: "2026-11-01T09:00:00Z", dispatch_generation: 1,
      reconciliation_reason: "provider idempotency window elapsed with unknown outcome" },
  ],
  earliest: { earliest_start: "2026-11-05", review_due_before_if_ready_now: "2026-11-04T00:00:00Z" },
  quotes: {
    standard: { available: true, unavailable_days: [], billable_days: 1, total_pence: 1000, placement_pence: 1000, priority_fee_pence: 0, priority_review: false,
      priority_available: true, currency: "gbp", is_test: true, live_from: "2026-11-05T00:00:00Z", review_due_if_ready_now: "2026-11-04T00:00:00Z", terms_version: "DRAFT-NOT-APPROVED-2026-10-16" },
    priority: { available: true, unavailable_days: [], billable_days: 1, total_pence: 16000, placement_pence: 1000, priority_fee_pence: 15000, priority_review: true,
      priority_available: true, currency: "gbp", is_test: true, live_from: "2026-11-05T00:00:00Z", review_due_if_ready_now: "2026-11-03T00:00:00Z", terms_version: "DRAFT-NOT-APPROVED-2026-10-16" },
  },
};
