// LOCAL BROWSER-TEST FAKE of the shared Supabase client (aliased in place of
// src/supabaseClient.js by vite.harness.config.js). Synthetic fixtures only;
// no network. It mirrors the DATABASE rules the screens rely on: row
// visibility per user (RLS), owner-only amendment responses (admins get
// ADS_NOT_FOUND), admin-only RPCs (ADS_FORBIDDEN), manual-gate refusal and
// the internal correction cause hidden from advertisers. Every RPC call is
// recorded in window.__rpcCalls for assertions.
import { fixture, USERS } from "./fixtures.js";

const state = structuredClone(fixture);
const calls = (window.__rpcCalls = []);
const currentUser = () => USERS[new URLSearchParams(location.search).get("user") || "owner"];
const isAdmin = () => currentUser().role === "admin";
const ownedAdvertiserIds = () => state.ad_advertisers.filter((a) => a.owner_user_id === currentUser().id).map((a) => a.id);
const ownsBooking = (bid) => ownedAdvertiserIds().includes(state.ad_bookings.find((b) => b.id === bid)?.advertiser_id);

const VISIBLE = {
  ad_advertisers: (r) => isAdmin() || r.owner_user_id === currentUser().id,
  ad_bookings: (r) => isAdmin() || ownsBooking(r.id),
  ad_booking_confirmations: (r) => isAdmin() || ownsBooking(r.booking_id),
  ad_booking_amendments: (r) => isAdmin() || ownsBooking(r.booking_id),
  ad_products: () => true,
  ad_inventory_units: () => true,
  ad_settings: () => isAdmin(),
  ad_refund_assessments: () => isAdmin(),
  ad_notification_outbox: () => isAdmin(),
  ad_cancellation_cases: () => isAdmin(),
};
const err = (message) => ({ data: null, error: { message } });

function query(table) {
  const filters = [];
  let single = null;
  const run = () => {
    const visible = (state[table] || []).filter((r) => (VISIBLE[table] || (() => false))(r));
    const rows = visible.filter((r) => filters.every((f) => f(r)));
    if (single === "maybe") return { data: rows[0] || null, error: null };
    if (single === "one") return rows.length === 1 ? { data: rows[0], error: null } : err("JSON object requested, multiple (or no) rows returned");
    return { data: structuredClone(rows), error: null };
  };
  const q = {
    select: () => q, order: () => q, limit: () => q,
    eq: (c, v) => (filters.push((r) => r[c] === v), q),
    in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
    maybeSingle: () => ((single = "maybe"), q), single: () => ((single = "one"), q),
    then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
  };
  return q;
}

const RPC = {
  ad_public_flags: () => ({ portal: true, checkout: true, delivery: true }),
  ad_earliest_start: () => state.earliest,
  ad_quote: (a) => (a.p_priority ? state.quotes.priority : state.quotes.standard),
  ad_review_sla: ({ p_booking_id }) => {
    if (!(isAdmin() || ownsBooking(p_booking_id))) throw new Error("ADS_NOT_FOUND");
    const sla = structuredClone(state.sla[p_booking_id] || { deadlines: [], corrections: [] });
    if (!isAdmin()) for (const c of sla.corrections) delete c.cause;
    return sla;
  },
  ad_respond_amendment: ({ p_amendment_id, p_decision }) => {
    const a = state.ad_booking_amendments.find((x) => x.id === p_amendment_id);
    if (!a || !ownsBooking(a.booking_id)) throw new Error("ADS_NOT_FOUND");        // admins cannot answer for the owner
    if (a.status !== "proposed") throw new Error(`ADS_INVALID_STATE: amendment is ${a.status}`);
    if (new Date(a.expires_at) <= new Date()) { a.status = "expired"; return "expired"; }
    a.status = p_decision === "accept" ? "accepted" : "rejected";
    a.decided_at = new Date().toISOString();
    if (a.status === "accepted") Object.assign(state.ad_bookings.find((b) => b.id === a.booking_id), { serve_from: a.proposed_from, serve_until: a.proposed_until });
    return a.status;
  },
  ad_admin_decide_refund: ({ p_assessment_id, p_decision }) => {
    const a = state.ad_refund_assessments.find((x) => x.id === p_assessment_id);
    if (p_decision === "approve" && a.status === "manual_gate") throw new Error(`ADS_MANUAL_GATE: ${a.gates.join(", ")} needs an agreed policy before approval`);
    a.status = p_decision === "approve" ? "approved" : "rejected";
  },
};

export const supabase = {
  from: (t) => query(t),
  async rpc(name, args = {}) {
    calls.push({ name, args, user: currentUser().id });
    try {
      if (name.startsWith("ad_admin_") && !isAdmin()) throw new Error("ADS_FORBIDDEN");
      const h = RPC[name];
      return { data: h ? h(args) : null, error: null };
    } catch (e) { return err(e.message); }
  },
  auth: {
    getSession: async () => ({ data: { session: { access_token: "LOCAL-FAKE-token-0000000000", user: { id: currentUser().id } } } }),
    getUser: async () => ({ data: { user: { id: currentUser().id } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  storage: { from: () => ({
    createSignedUrl: async () => ({ data: { signedUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }, error: null }),
    upload: async () => ({ data: {}, error: { message: "uploads disabled in the browser test" } }),
  }) },
};
