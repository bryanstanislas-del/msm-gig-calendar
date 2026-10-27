// Festival Hub -- MSM brand tokens.
//
// Copied (not imported) from the calendar's C/F constants in App.jsx: the
// hub must not import App.jsx, because loading that module starts the
// calendar's backend client. theme.test.js keeps these values in sync
// with App.jsx. Black / white / red only.

export const C = Object.freeze({
  bg: "#0d0d0d",
  surface: "#111",
  surfaceHigh: "#161616",
  border: "rgba(255,255,255,0.07)",
  borderStrong: "rgba(255,255,255,0.12)",
  red: "#e8203a",
  white: "#fff",
  muted: "#9a9a9a",
  dim: "#828282",
  // Hub-only semantic tokens (not in App.jsx). White text on the brand red
  // #e8203a is 4.47:1, just under WCAG AA 4.5:1, and the same red as small
  // text on #111 is 4.23:1. The brand red stays for borders, accents and
  // large text; these tokens cover the cases it can't:
  redFill: "#dc1c35",       // background behind white text: 4.93:1
  redTextOnDark: "#ff4d61", // small red text on the dark surfaces: 5.83:1 on #111
  placeholder: "#9a9a9a",   // input placeholder on the input fill: 5.17:1
});

export const F = Object.freeze({
  display: "'Bebas Neue',sans-serif",
  body: "'Barlow',sans-serif",
});

export const LOGO_SRC = "/brand/MSM-Logo-Master.png";
// Same crop as the calendar's MSMLogo (monogram + wordmark band of the
// square master asset).
export const LOGO_CROP = Object.freeze({ top: 0.24, height: 0.56 });
