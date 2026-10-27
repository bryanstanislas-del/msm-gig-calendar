// Festival Hub entry point (separate Vite build: vite.festival-hub.config.js).
// Deliberately does not register the calendar's service worker and does
// not import anything from the calendar app.
import React from "react";
import ReactDOM from "react-dom/client";
import FestivalHubApp from "./FestivalHubApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FestivalHubApp />
  </React.StrictMode>
);
