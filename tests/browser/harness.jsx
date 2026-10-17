// LOCAL BROWSER-TEST HARNESS: renders the real advertiser/admin screens
// against tests/browser/fakeSupabase.js (synthetic fixtures, no network).
import React from "react";
import ReactDOM from "react-dom/client";
import AdvertiserPortal from "../../src/components/ads/AdvertiserPortal.jsx";
import AdminAds from "../../src/components/admin/AdminAds.jsx";
import { USERS } from "./fixtures.js";

const q = new URLSearchParams(location.search);
const user = USERS[q.get("user") || "owner"];
ReactDOM.createRoot(document.getElementById("root")).render(
  q.get("screen") === "admin" ? <AdminAds /> : <AdvertiserPortal user={{ id: user.id }} logo={null} />,
);
