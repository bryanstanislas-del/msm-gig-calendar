// Keeps the local browser harness baseline identical to the real app's tab
// wrapper (App.jsx C.bg / C.white / F.body) without importing App.jsx.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
describe("browser harness matches the app's text baseline", () => {
  it("background, text colour and body font equal App.jsx", () => {
    const app = read("src/App.jsx");
    const bg = /export const C = \{[\s\S]*?\bbg:"([^"]+)"/.exec(app)[1];
    const white = /export const C = \{[\s\S]*?\bwhite:"([^"]+)"/.exec(app)[1];
    const body = /export const F = \{[^}]*\bbody:"([^"]+)"/.exec(app)[1];
    expect(app).toMatch(/background:C\.bg, color:C\.white, fontFamily:F\.body/);   // the wrapper the harness mirrors
    const h = read("tests/browser/harness.jsx");
    const base = /APP_BASELINE = \{ background: "([^"]+)", color: "([^"]+)", fontFamily: "([^"]+)" \}/.exec(h);
    expect([base[1], base[2], base[3]]).toEqual([bg, white, body]);
  });
});
