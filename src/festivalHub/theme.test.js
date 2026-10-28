import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { C, F, LOGO_SRC, LOGO_CROP } from "./theme.js";

// theme.js copies the calendar's tokens (it cannot import App.jsx); keep
// them in sync by reading App.jsx as text.
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

describe("hub brand tokens match the calendar", () => {
  it("colours", () => {
    for (const key of ["bg", "surface", "surfaceHigh", "border", "borderStrong", "red", "white", "muted", "dim"]) {
      expect(app, key).toMatch(new RegExp(`${key}:"${C[key].replace(/[().]/g, "\\$&")}"`));
    }
  });
  it("fonts and logo", () => {
    expect(app).toContain(`display:"${F.display}"`);
    expect(app).toContain(`body:"${F.body}"`);
    // The calendar keeps the shared master; the Hub uses its own derived asset.
    expect(app).toContain(`const MSM_LOGO_SRC = "/brand/MSM-Logo-Master.png"`);
    expect(LOGO_SRC).toMatch(/msm-logo-hub\.webp$/);
    expect(app).toContain(`full:     { top: ${LOGO_CROP.top}, height: ${LOGO_CROP.height} }`);
  });
  it("no purple in the hub palette", () => {
    expect(Object.values(C).join(" ")).not.toMatch(/#9b59b6|purple|violet/i);
  });
});
