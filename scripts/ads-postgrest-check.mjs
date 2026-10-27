// Driven by scripts/ads-postgrest-test.sh (local PostgREST on 127.0.0.1).
import fs from "node:fs";
import crypto from "node:crypto";

const { PGRST_URL: URL, PGRST_SECRET: SECRET } = process.env;
const [ADMIN, OWNER, OTHER, BOOKING] = process.env.PGRST_IDS.trim().split(/\s+/);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const AS = { admin: jwt(ADMIN), owner: jwt(OWNER), other: jwt(OTHER), anon: null };
let failures = 0;
const check = (ok, label) => { console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failures += 1; };
const get = async (who, table, select, extra = "") => {
  const r = await fetch(`${URL}/${table}?select=${encodeURIComponent(select)}${extra}`, { headers: AS[who] ? { Authorization: `Bearer ${AS[who]}` } : {} });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
};

// Every select in the browser ads client, exactly as written.
const src = fs.readFileSync("src/ads/adsClient.js", "utf8");
const consts = Object.fromEntries([...src.matchAll(/const (\w+) = `([\s\S]*?)`;/g)].map((m) => [m[1], m[2]]));
const selects = [...src.matchAll(/from\("(\w+)"\)\s*\.select\(\s*(?:"([^"]*)"|`([^`]*)`|(\w+))/g)]
  .map((m) => [m[1], (m[2] ?? m[3] ?? consts[m[4]] ?? "").replace(/\s+/g, "")]);
console.log(`== ${selects.length} client selects through real PostgREST`);
check(selects.length >= 10, "client selects discovered");
for (const who of ["admin", "owner", "other"]) {
  for (const [t, sel] of selects) {
    const r = await get(who, t, sel, "&limit=2");
    check(r.status === 200, `${who}: ${t} -> ${r.status}${r.status === 200 ? "" : ` ${r.body?.code} ${String(r.body?.message).slice(0, 90)}`}`);
  }
}

console.log("== payment-history embed semantics");
const bookingSel = selects.find(([t]) => t === "ad_bookings")[1];
const unhinted = bookingSel.replace("ad_payments!ad_payments_booking_id_fkey(", "ad_payments(");
const amb = await get("admin", "ad_bookings", unhinted);
check(amb.status === 300 && amb.body?.code === "PGRST201", `unhinted ad_payments embed is ambiguous in this schema (${amb.status} ${amb.body?.code})`);
const own = await get("owner", "ad_bookings", bookingSel, `&id=eq.${BOOKING}`);
const pays = own.body?.[0]?.ad_payments || [];
check(own.status === 200 && pays.length === 2, `owner's booking lists ALL its payments (funding + duplicate): ${pays.length}`);
check(pays.some((p) => p.requires_refund) && pays.some((p) => !p.requires_refund), "duplicate payment's REFUND REQUIRED flag is visible");
const adm = await get("admin", "ad_bookings", bookingSel, `&id=eq.${BOOKING}`);
check(adm.status === 200 && (adm.body?.[0]?.ad_payments || []).length === 2, "admin sees the same payment history");
const oth = await get("other", "ad_bookings", bookingSel);
check(oth.status === 200 && oth.body.length === 0, "other advertiser sees no bookings");
const anon = await get("anon", "ad_bookings", "id");
check(anon.status !== 200 || anon.body.length === 0, `anon sees no bookings (${anon.status})`);

console.log("== admin panel reads");
for (const [t, min] of [["ad_settings", 15], ["ad_inventory_units", 3], ["ad_products", 2]]) {
  const r = await get("admin", t, "*");
  check(r.status === 200 && r.body.length >= min, `admin ${t}: ${r.body.length ?? r.status} rows`);
}
const own2 = await get("owner", "ad_settings", "key");
check(own2.status === 200 && own2.body.length === 0, "advertiser cannot read ad_settings");
console.log(failures ? `POSTGREST CHECKS FAILED (${failures})` : "ALL POSTGREST CHECKS PASSED");
process.exit(failures ? 1 : 0);
