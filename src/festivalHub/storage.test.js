import { describe, it, expect } from "vitest";
import { STORAGE_KEYS, MAX_SAVED, loadSaved, persistSaved, sanitiseEntry, sanitiseState, isValidId, checklistProgress, emptyEntry } from "./storage.js";

function fakeWindow({ throwOnGet = false, throwOnSet = false, throwOnAccess = false, initial } = {}) {
  const map = new Map(initial === undefined ? [] : [[STORAGE_KEYS.real, initial]]);
  const storage = {
    getItem: (k) => { if (throwOnGet) throw new Error("SecurityError"); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (throwOnSet) throw new Error("QuotaExceededError"); map.set(k, String(v)); },
  };
  const win = {};
  Object.defineProperty(win, "localStorage", { get() { if (throwOnAccess) throw new Error("SecurityError"); return storage; } });
  return { win, map };
}

describe("ids", () => {
  it("bounded, lowercase slug ids only", () => {
    expect(isValidId("demo-highland")).toBe(true);
    expect(isValidId("a".repeat(64))).toBe(true);
    expect(isValidId("a".repeat(65))).toBe(false);
    for (const bad of ["", "-lead", "Upper", "has space", "__proto__", "x/y", 5, null]) expect(isValidId(bad)).toBe(false);
  });
});

describe("sanitise", () => {
  it("keeps only known stages, outcomes and boolean checklist keys", () => {
    expect(sanitiseEntry({ stage: "applied", outcome: "offered", checklist: { bio: true, music: "yes", hacker: true } }))
      .toEqual({ stage: "applied", outcome: "offered", checklist: { bio: true } });
    expect(sanitiseEntry({ stage: "booked!", outcome: "x" })).toEqual(emptyEntry());
    expect(sanitiseEntry(null)).toBeNull();
    expect(sanitiseEntry([1])).toBeNull();
  });
  it("never keeps free text such as contact details", () => {
    const out = sanitiseEntry({ stage: "preparing", email: "a@b.c", phone: "0123", notes: "call me", checklist: { contact: true } });
    expect(JSON.stringify(out)).not.toMatch(/a@b\.c|0123|call me/);
    expect(out.checklist).toEqual({ contact: true });
  });
  it("drops invalid ids, unknown listings and caps entries", () => {
    const items = { "demo-a": {}, "BAD ID": {}, "demo-gone": {} };
    const r = sanitiseState({ version: 1, items }, new Set(["demo-a"]));
    expect(Object.keys(r.items)).toEqual(["demo-a"]);
    expect(r.dropped).toBe(2);
    const many = Object.fromEntries(Array.from({ length: MAX_SAVED + 5 }, (_, i) => [`id-${i}`, {}]));
    expect(Object.keys(sanitiseState({ version: 1, items: many }).items)).toHaveLength(MAX_SAVED);
  });
  it("rejects wrong versions and shapes", () => {
    expect(sanitiseState({ version: 2, items: {} }).invalid).toBe(true);
    expect(sanitiseState({ version: 1, items: [] }).invalid).toBe(true);
    expect(sanitiseState("x").invalid).toBe(true);
  });
});

describe("load / persist", () => {
  it("round-trips through storage", () => {
    const { win, map } = fakeWindow();
    expect(loadSaved(win)).toEqual({ items: {}, problem: null });
    const items = { "demo-highland": { stage: "applied", outcome: "pending", checklist: { epk: true } } };
    expect(persistSaved(items, win)).toBe(true);
    expect(JSON.parse(map.get(STORAGE_KEYS.real))).toEqual({ version: 1, items });
    expect(loadSaved(win)).toEqual({ items, problem: null });
  });
  it("reports corrupt JSON or invalid content without throwing", () => {
    expect(loadSaved(fakeWindow({ initial: "{not json" }).win)).toEqual({ items: {}, problem: "corrupt" });
    expect(loadSaved(fakeWindow({ initial: JSON.stringify({ version: 1, items: { "demo-x": {}, "!!": {} } }) }).win))
      .toEqual({ items: { "demo-x": emptyEntry() }, problem: "corrupt" });
  });
  it("reports unavailable storage and failed writes", () => {
    expect(loadSaved(fakeWindow({ throwOnAccess: true }).win).problem).toBe("unavailable");
    expect(loadSaved(fakeWindow({ throwOnGet: true }).win).problem).toBe("unavailable");
    expect(loadSaved(undefined).problem).toBe("unavailable");
    expect(persistSaved({ "demo-a": emptyEntry() }, fakeWindow({ throwOnSet: true }).win)).toBe(false);
    expect(persistSaved({ "demo-a": emptyEntry() }, fakeWindow({ throwOnAccess: true }).win)).toBe(false);
  });
  it("sanitises on write too", () => {
    const { win, map } = fakeWindow();
    persistSaved({ "demo-a": { stage: "applied", email: "x@y.z" }, "BAD": {} }, win);
    expect(map.get(STORAGE_KEYS.real)).not.toMatch(/x@y\.z|BAD/);
  });
  it("checklist progress", () => {
    expect(checklistProgress({ checklist: { epk: true, bio: true } })).toEqual({ done: 2, total: 7 });
  });
  it("real and demo stores are separate keys", () => {
    const { win, map } = fakeWindow();
    persistSaved({ "demo-x": emptyEntry() }, win, STORAGE_KEYS.demo);
    expect(loadSaved(win, undefined, STORAGE_KEYS.real)).toEqual({ items: {}, problem: null });
    expect(Object.keys(loadSaved(win, undefined, STORAGE_KEYS.demo).items)).toEqual(["demo-x"]);
    expect(STORAGE_KEYS.real).not.toBe(STORAGE_KEYS.demo);
    expect([...map.keys()]).toEqual([STORAGE_KEYS.demo]);
  });
  it("ids from the other mode are dropped on load", () => {
    const { win } = fakeWindow({ initial: JSON.stringify({ version: 1, items: { "demo-x": {}, "twyfest": {} } }) });
    expect(Object.keys(loadSaved(win, new Set(["twyfest"])).items)).toEqual(["twyfest"]);
  });
});
