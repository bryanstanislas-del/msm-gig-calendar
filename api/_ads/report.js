// Advertiser/admin date-range reports: CSV and a minimal dependency-free
// PDF. Input is the jsonb returned by public.ad_report() -- which already
// enforces owner/admin access and contains no billing/contact data.

export const REPORT_LIMITATIONS = [
  "Impression = at least 50% of the advert's pixels visible in the browser viewport for at least 1 continuous second while the tab is visible (IAB/MRC display viewability guideline), measured by MSM's own script.",
  "Counts are first-party and unaudited. Ad blockers, disabled JavaScript, privacy tools and network failures prevent some views/clicks from being counted.",
  "Repeat views/clicks by the same browser within 30 minutes are counted once; known bots and abnormal request rates are excluded. Filtering is heuristic and not MRC-accredited.",
  "Visitors are identified only by a daily-rotating keyed hash that is discarded after 30 minutes; no IP addresses, cookies or personal data are stored.",
  "Dates are UK calendar days (Europe/London). Days before the advert was approved, or while it was paused, show zero.",
];

export function ctrPercent(impressions, clicks) {
  if (!impressions) return "0.00";
  return ((clicks / impressions) * 100).toFixed(2);
}

function csvCell(value) {
  let s = value == null ? "" : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportTotals(report) {
  const rows = report?.rows || [];
  const impressions = rows.reduce((a, r) => a + (Number(r.impressions) || 0), 0);
  const clicks = rows.reduce((a, r) => a + (Number(r.clicks) || 0), 0);
  return { impressions, clicks, ctr: ctrPercent(impressions, clicks) };
}

export function buildReportCsv(report) {
  const placement = (report.placements || []).join(" ");
  const lines = [["booking_reference", "date_uk", "placement", "impressions", "clicks", "ctr_percent", "test_data"].join(",")];
  for (const r of report.rows || []) {
    lines.push([report.booking_id, r.day, placement, r.impressions, r.clicks, ctrPercent(r.impressions, r.clicks), report.is_test ? "yes" : "no"].map(csvCell).join(","));
  }
  const t = reportTotals(report);
  lines.push([report.booking_id, "TOTAL", placement, t.impressions, t.clicks, t.ctr, report.is_test ? "yes" : "no"].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ── Minimal PDF writer (Helvetica, A4, text only) ─────────────────────

function pdfText(s) {
  return String(s ?? "")
    .replace(/£/g, "GBP ")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      if (line) out.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

export function buildPdf(lines, { title = "Report" } = {}) {
  const PAGE_LINES = 52;
  const pages = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += PAGE_LINES) pages.push(lines.slice(i, i + PAGE_LINES));

  const objects = []; // index = object number - 1
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${pdfText(title)}) /Producer (MSM Ads) >>`);
  const pageIds = [];
  for (const pageLines of pages) {
    let y = 800;
    let stream = "BT\n";
    for (const l of pageLines) {
      const size = l.size || 10;
      stream += `/${l.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 50 ${y} Tm (${pdfText(l.text)}) Tj\n`;
      y -= Math.round(size * 1.45);
    }
    stream += "ET";
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export function buildReportPdf(report) {
  const t = reportTotals(report);
  const L = [];
  L.push({ text: "Music Scene Magazine - Advertising report", bold: true, size: 16 });
  if (report.is_test) L.push({ text: "TEST BOOKING - test data only, not a commercial report", bold: true, size: 11 });
  L.push({ text: "" });
  L.push({ text: `Booking reference: ${report.booking_id}` });
  L.push({ text: `Package: ${report.product_name}` });
  L.push({ text: `Placement: ${(report.placements || []).join(", ")}` });
  L.push({ text: `Booked dates (UK, inclusive): ${report.booked_start} to ${report.booked_end}` });
  L.push({ text: `Report range (UK, inclusive): ${report.from} to ${report.to}` });
  L.push({ text: `Booking status: ${report.status}` });
  L.push({ text: `Generated: ${report.generated_at}` });
  L.push({ text: "" });
  L.push({ text: "Date (UK)        Impressions     Clicks     CTR %", bold: true });
  for (const r of report.rows || []) {
    L.push({ text: `${String(r.day).padEnd(16)} ${String(r.impressions).padStart(11)} ${String(r.clicks).padStart(10)} ${ctrPercent(r.impressions, r.clicks).padStart(9)}` });
  }
  L.push({ text: `${"TOTAL".padEnd(16)} ${String(t.impressions).padStart(11)} ${String(t.clicks).padStart(10)} ${t.ctr.padStart(9)}`, bold: true });
  L.push({ text: "" });
  L.push({ text: "How these numbers are measured (limitations)", bold: true });
  for (const note of REPORT_LIMITATIONS) for (const line of wrap(`- ${note}`, 95)) L.push({ text: line, size: 9 });
  return buildPdf(L, { title: `MSM advertising report ${report.booking_id}` });
}
