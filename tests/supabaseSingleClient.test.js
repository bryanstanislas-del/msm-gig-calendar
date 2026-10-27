// Regression for the preview isolation blocker: App.jsx used to build its own
// production client while ads/admin screens used src/supabaseClient.js, so an
// overridden preview showed production gigs/sessions next to staging ads.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../src");
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return files(p);
    return /\.(js|jsx)$/.test(d.name) && !/\.test\.(js|jsx)$/.test(d.name) ? [p] : [];
  });
}
const rel = (p) => path.relative(SRC, p).split(path.sep).join("/");
const all = files(SRC).map((p) => ({ file: rel(p), text: fs.readFileSync(p, "utf8") }));

describe("one Supabase client and one project for the whole browser app", () => {
  it("only src/supabaseClient.js creates a Supabase client", () => {
    expect(all.filter((f) => /\bcreateClient\s*\(/.test(f.text)).map((f) => f.file)).toEqual(["supabaseClient.js"]);
  });
  it("only src/supabaseConfig.js names a Supabase project URL", () => {
    expect(all.filter((f) => /https:\/\/[a-z0-9]{20}\.supabase\.co/.test(f.text)).map((f) => f.file)).toEqual(["supabaseConfig.js"]);
  });
  it("App (Calendar + auth/session), admin and ads all import that shared client", () => {
    const importsShared = (f) => /import\s*\{\s*supabase\s*\}\s*from\s*["'](\.\/|\.\.\/|\.\.\/\.\.\/)supabaseClient(\.js)?["']/.test(f.text);
    const byName = Object.fromEntries(all.map((f) => [f.file, f]));
    for (const f of ["App.jsx", "ads/adsClient.js", "components/admin/AdminPromoSlots.jsx", "components/ClaimDirectoryPage.jsx"]) {
      expect(importsShared(byName[f]), f).toBe(true);
    }
    expect(/SUPABASE_ANON_KEY\s*=/.test(byName["App.jsx"].text)).toBe(false);
    // No other browser module can construct or import its own client.
    expect(all.filter((f) => /@supabase\/supabase-js/.test(f.text)).map((f) => f.file)).toEqual(["supabaseClient.js"]);
  });
});
