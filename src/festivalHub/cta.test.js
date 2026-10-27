import { describe, it, expect } from "vitest";
import { ctaLinks } from "./cta.js";
import { STATUS } from "./status.js";

const l = (application) => ({ officialUrl: "https://fest.co.uk/", application });
const open = { status: STATUS.OPEN };

describe("ctaLinks", () => {
  it("open + 2027 application page: apply button first, official info second", () => {
    expect(ctaLinks(l({ url: "https://fest.co.uk/apply", urlEdition: 2027 }), open).map((x) => x.kind)).toEqual(["apply", "info"]);
  });
  it("same page for both: one apply button", () => {
    expect(ctaLinks(l({ url: "https://fest.co.uk/", urlEdition: 2027 }), open).map((x) => x.kind)).toEqual(["apply"]);
  });
  it("not open: no apply button, form labelled as reference", () => {
    const r = ctaLinks(l({ url: "https://fest.co.uk/apply", urlEdition: 2027 }), { status: STATUS.CLOSED });
    expect(r.map((x) => x.kind)).toEqual(["info", "reference"]);
    expect(r[1].label).toMatch(/not open — reference only/);
  });
  it("historical form is labelled with its year", () => {
    const r = ctaLinks(l({ url: "https://fest.co.uk/apply-2026", urlEdition: 2026 }), { status: STATUS.NOT_YET_ANNOUNCED });
    expect(r[1].label).toBe("2026 application page (historical — not for 2027)");
  });
  it("open but a 2026 form is never an apply button", () => {
    expect(ctaLinks(l({ url: "https://fest.co.uk/apply", urlEdition: 2026 }), open).some((x) => x.kind === "apply")).toBe(false);
  });
  it("demo labels", () => {
    expect(ctaLinks(l({ url: "https://fest.co.uk/apply", urlEdition: 2027 }), open, true)[0].label).toBe("Official application page (demo example)");
  });
});
