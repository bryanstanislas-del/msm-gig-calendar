import { describe, it, expect } from "vitest";
import { buildReportCsv, buildReportPdf, reportTotals, ctrPercent } from "./report.js";

const report = {
  booking_id: "11111111-2222-4333-8444-555555555555", status: "confirmed", product_name: "TEST ONLY - Homepage top banner (per day)",
  placements: ["wordpress-home-top"], booked_start: "2026-10-24", booked_end: "2026-10-26", from: "2026-10-24", to: "2026-10-26",
  is_test: true, generated_at: "2026-10-27T09:00:00Z",
  rows: [{ day: "2026-10-24", impressions: 200, clicks: 3 }, { day: "2026-10-25", impressions: 0, clicks: 0 }, { day: "2026-10-26", impressions: 50, clicks: 1 }],
};

describe("report CSV", () => {
  it("has one row per UK day plus totals and flags test data", () => {
    const csv = buildReportCsv(report).trim().split("\r\n");
    expect(csv[0]).toBe("booking_reference,date_uk,placement,impressions,clicks,ctr_percent,test_data");
    expect(csv).toHaveLength(5);
    expect(csv[1]).toBe(`${report.booking_id},2026-10-24,wordpress-home-top,200,3,1.50,yes`);
    expect(csv[4]).toBe(`${report.booking_id},TOTAL,wordpress-home-top,250,4,1.60,yes`);
  });
  it("neutralises spreadsheet formula injection and quotes", () => {
    const evil = { ...report, booking_id: '=HYPERLINK("http://x")', rows: [] };
    const csv = buildReportCsv(evil);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
  it("totals + CTR edge cases", () => {
    expect(reportTotals(report)).toEqual({ impressions: 250, clicks: 4, ctr: "1.60" });
    expect(ctrPercent(0, 0)).toBe("0.00");
  });
});

describe("report PDF", () => {
  it("is a structurally valid PDF with correct xref offsets", () => {
    const pdf = buildReportPdf(report);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain("TEST BOOKING");
    expect(text).toContain("2026-10-25");
    expect(text).toContain("limitations");
  });
  it("paginates long ranges", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ day: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, impressions: i, clicks: 0 }));
    const text = buildReportPdf({ ...report, rows }).toString("latin1");
    expect(Number(/\/Count (\d+)/.exec(text)[1])).toBeGreaterThan(1);
  });
});
