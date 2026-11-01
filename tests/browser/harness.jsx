// LOCAL BROWSER-TEST HARNESS: renders the real advertiser/admin screens
// against tests/browser/fakeSupabase.js (synthetic fixtures, no network).
import React from "react";
import ReactDOM from "react-dom/client";
import AdvertiserPortal from "../../src/components/ads/AdvertiserPortal.jsx";
import AdminAds from "../../src/components/admin/AdminAds.jsx";
import { USERS } from "./fixtures.js";

// Same text/colour/font baseline the real app wraps every tab in
// (App.jsx: background C.bg, color C.white, fontFamily F.body). Values are
// duplicated -- importing App.jsx would pull the live app -- and kept equal
// to App.jsx by tests/browserHarnessTheme.test.js. Web fonts are blocked in the
// local run (no network), so the stack falls back to the system sans-serif.
export const APP_BASELINE = { background: "#0d0d0d", color: "#fff", fontFamily: "'Barlow',sans-serif" };

const q = new URLSearchParams(location.search);
const user = USERS[q.get("user") || "owner"];
ReactDOM.createRoot(document.getElementById("root")).render(
  <div style={{ minHeight: "100vh", ...APP_BASELINE }}>
    {q.get("screen") === "admin" ? <AdminAds /> : <AdvertiserPortal user={{ id: user.id }} logo={null} />}
  </div>,
);
