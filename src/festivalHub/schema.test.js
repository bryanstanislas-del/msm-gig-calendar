import { describe, it, expect } from "vitest";
import { validateListing, validateDirectory } from "./schema.js";

const base = () => ({
  id: "some-fest", name: "Some Fest", editionYear: 2027, region: "Wales", location: null,
  festivalDates: { start: "2027-06-01", end: "2027-06-03" }, genres: [], officialUrl: "https://somefest.co.uk/",
  eligibility: null, applicationFee: null, performerPay: null,
  listingVerification: { status: "verified", editionConfirmed: true, sourceUrl: "https://somefest.co.uk/", checkedDate: "2026-10-27", sourcePublishedDate: null, evidence: "Official site." },
  application: { status: "open", editionYear: 2027, opens: null, closes: "2027-01-31", sourceUrl: "https://somefest.co.uk/apply", checkedDate: "2026-10-27", evidence: "2027 call open.", url: "https://somefest.co.uk/apply", urlEdition: 2027 },
});
const errs = (l, opts = { today: "2026-10-27" }) => validateListing(l, opts).errors;
const withApp = (patch) => { const l = base(); l.application = { ...l.application, ...patch }; return l; };

describe("validateListing", () => {
  it("accepts a complete record and allows unknown fields to be null", () => {
    expect(errs(base())).toEqual([]);
    const l = base(); l.festivalDates = null; l.location = null;
    expect(errs(l)).toEqual([]);
  });
  it("rejects typos / unknown fields, wrong edition, bad region and placeholder hosts", () => {
    const l = base(); l.deadine = "x"; l.editionYear = 2026; l.region = "Midlands"; l.officialUrl = "https://example.org/x";
    const e = errs(l).join("\n");
    expect(e).toMatch(/unknown field "deadine"/);
    expect(e).toMatch(/editionYear must be 2027/);
    expect(e).toMatch(/region must be one of/);
    expect(e).toMatch(/placeholder host/);
  });
  it("keeps demo and real data apart", () => {
    const l = base(); l.id = "demo-x";
    expect(errs(l).join()).toMatch(/must not start with "demo-"/);
    expect(validateListing(base(), { demo: true }).errors.join()).toMatch(/isDemo|example\.org/);
  });
  it("requires evidence for verified listings and non-unverified windows", () => {
    const l = base(); delete l.listingVerification.evidence; delete l.application.checkedDate;
    const e = errs(l).join("\n");
    expect(e).toMatch(/listingVerification\.evidence/);
    expect(e).toMatch(/application\.checkedDate/);
    const l2 = base(); delete l2.listingVerification.editionConfirmed;
    expect(errs(l2).join()).toMatch(/editionConfirmed/);
  });
  it("application evidence must be for the 2027 edition and a confirmed edition", () => {
    expect(errs(withApp({ editionYear: 2026 })).join()).toMatch(/evidence must be for the 2027 edition/);
    const l = base(); l.listingVerification.editionConfirmed = false;
    expect(errs(l).join()).toMatch(/needs listingVerification.editionConfirmed/);
  });
  it("checks dates, times, ordering and freshness inputs", () => {
    expect(errs(withApp({ closes: "2027-06-02" })).join()).toMatch(/on\/after the festival start/);
    expect(errs(withApp({ opens: "2027-02-01" })).join()).toMatch(/opens is after closes/);
    expect(errs(withApp({ closesTime: "9pm" })).join()).toMatch(/HH:MM/);
    expect(errs(withApp({ closes: null, closesTime: "21:00", noPublishedDeadline: true })).join()).toMatch(/closesTime needs application.closes/);
    expect(errs(withApp({ checkedDate: "2026-10-28" })).join()).toMatch(/in the future/);
    expect(errs(withApp({ sourcePublishedDate: "2026-11-01" })).join()).toMatch(/sourcePublishedDate is after checkedDate/);
    expect(errs(withApp({ status: "open", opens: "2026-11-01", closes: "2027-01-31" })).join()).toMatch(/use announced/);
    expect(errs(withApp({ noPublishedDeadline: true })).join()).toMatch(/cannot have a closing date/);
  });
  it("open without a deadline needs explicit no-deadline evidence (warning, shown Unverified)", () => {
    const r = validateListing(withApp({ closes: null }), { today: "2026-10-27" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/shown as Unverified/);
  });
  it("application url rules", () => {
    expect(errs(withApp({ urlEdition: undefined })).join()).toMatch(/urlEdition/);
    expect(errs(withApp({ urlEdition: 2026 })).join()).toMatch(/must be for the listing edition/);
    expect(errs(withApp({ status: "unverified" })).join()).toMatch(/unverified window must not carry an application url/);
    expect(errs(withApp({ email: "not an email" })).join()).toMatch(/email/);
  });
  it("performer pay and genres", () => {
    const l = base(); l.performerPay = { status: "free beer" };
    expect(errs(l).join()).toMatch(/performerPay.status/);
    const g = base(); g.genres = ["All genres", "Rock"];
    expect(errs(g).join()).toMatch(/only genre/);
  });
  it("duplicate ids fail the directory", () => {
    const r = validateDirectory([base(), base()], { today: "2026-10-27" });
    expect(r.valid).toHaveLength(1);
    expect(r.problems[0].errors).toContain("duplicate id");
  });
});
