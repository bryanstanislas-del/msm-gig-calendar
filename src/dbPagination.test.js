import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression coverage for the 1,000-row scaling fix: Supabase/PostgREST
// silently truncates any unbounded query at the project's max-rows
// ceiling (Supabase's default is 1000), and App.jsx's own `supabase`
// client is constructed inline via createClient(...) rather than a
// separately-importable instance -- so these tests mock the
// `@supabase/supabase-js` module itself, giving a fake chainable query
// builder that records exactly what DB.getApprovedGigs/getAllGigs/
// getGigCounts ask for (table, filters, ordering, range) and answers
// with caller-controlled fixture data. This proves the real DB methods
// -- not just the standalone fetchAllPages helper -- page correctly,
// order deterministically, and never silently swallow a later-page
// error.

let tableImpl;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table) => tableImpl(table) }),
}));

const { DB, fetchAllPages, FETCH_ALL_PAGE_SIZE } = await import("./App.jsx");
const { gigMatchesCityFilter } = await import("./App.jsx");

// Mimics a supabase-js query builder closely enough for these tests:
// chainable .select/.eq/.order, terminal .range() (paginated calls) or
// bare await (count-only `head:true` calls, which never call .range()).
// `respond(state)` is caller-supplied per test and decides what each
// individual request returns.
function makeChain(table, respond) {
  const state = { table, selectArgs: null, eqs: [], orders: [], range: null };
  const chain = {
    select(cols, opts) { state.selectArgs = [cols, opts]; return chain; },
    eq(col, val) { state.eqs.push([col, val]); return chain; },
    order(col, opts) { state.orders.push([col, opts]); return chain; },
    range(from, to) { state.range = [from, to]; return Promise.resolve(respond({ ...state, range: [from, to] })); },
    then(resolve, reject) { return Promise.resolve(respond(state)).then(resolve, reject); },
  };
  return chain;
}

beforeEach(() => { tableImpl = undefined; });

describe("DB.getApprovedGigs (paginated)", () => {
  it("returns the complete approved set spanning more than one API page", async () => {
    const all = Array.from({ length: 1250 }, (_, i) => ({ id: `g${i}`, status: "approved", date: "2026-09-10" }));
    const calls = [];
    tableImpl = (table) => makeChain(table, (state) => {
      calls.push(state);
      const [from, to] = state.range;
      return { data: all.slice(from, to + 1), error: null };
    });

    const result = await DB.getApprovedGigs();

    expect(result.length).toBe(1250);
    expect(calls.length).toBe(2); // 1000 + 250, second page < pageSize terminates
    expect(calls[0].table).toBe("gigs");
    expect(calls[0].eqs).toEqual([["status", "approved"]]);
    // Deterministic secondary ordering: date is not unique across 1,610+
    // gigs, so `id` must ride alongside it for pagination to never
    // duplicate or skip a row.
    expect(calls[0].orders).toEqual([
      ["date", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("a gig located beyond the first API page passes public filtering (city, genre, venue) once returned", async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => ({
      id: `f${i}`, status: "approved", date: "2026-01-01", city: "Southampton", genre: "Rock", venue: "Filler Venue",
    }));
    const target = { id: "page2-gig", status: "approved", date: "2027-01-01", city: "Portsmouth", genre: "Blues", venue: "Kings Theatre" };
    const all = [...filler, target];
    tableImpl = (table) => makeChain(table, (state) => {
      const [from, to] = state.range;
      return { data: all.slice(from, to + 1), error: null };
    });

    const result = await DB.getApprovedGigs();

    expect(result.length).toBe(1001);
    const found = result.find(g => g.id === "page2-gig");
    expect(found).toBeTruthy();
    expect(gigMatchesCityFilter(found, "Portsmouth")).toBe(true);
    expect(result.filter(g => g.genre === "Blues")).toEqual([target]);
    expect(result.filter(g => g.venue === "Kings Theatre")).toEqual([target]);
  });

  it("throws rather than returning partial data when a later page fails", async () => {
    const all = Array.from({ length: 1200 }, (_, i) => ({ id: i, status: "approved" }));
    let call = 0;
    tableImpl = (table) => makeChain(table, () => {
      call++;
      if (call === 1) return { data: all.slice(0, 1000), error: null };
      return { data: null, error: { message: "page 2 failed" } };
    });

    await expect(DB.getApprovedGigs()).rejects.toThrow("page 2 failed");
  });

  it("returns an empty array (not an error) when there are zero approved gigs", async () => {
    tableImpl = (table) => makeChain(table, () => ({ data: [], error: null }));
    const result = await DB.getApprovedGigs();
    expect(result).toEqual([]);
  });
});

describe("DB.getAllGigs (paginated, admin)", () => {
  it("returns the complete set -- including older-created and rejected rows -- beyond the first API page", async () => {
    // created_at desc means the OLDEST rows are the ones that used to be
    // truncated away; put a rejected row and an old approved row deep
    // past page 1 to prove they now survive.
    const recent = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, status: "approved", created_at: `2026-09-0${1 + (i % 4)}` }));
    const older = [
      { id: "old-approved", status: "approved", created_at: "2026-06-01" },
      { id: "old-rejected", status: "rejected", created_at: "2026-06-01" },
    ];
    const all = [...recent, ...older];
    const calls = [];
    tableImpl = (table) => makeChain(table, (state) => {
      calls.push(state);
      const [from, to] = state.range;
      return { data: all.slice(from, to + 1), error: null };
    });

    const result = await DB.getAllGigs();

    expect(result.length).toBe(1002);
    expect(result.find(g => g.id === "old-approved")).toBeTruthy();
    expect(result.find(g => g.id === "old-rejected")).toBeTruthy();
    expect(calls[0].eqs).toEqual([]); // no status filter -- every status included
    expect(calls[0].orders).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: true }],
    ]);
  });

  it("throws rather than returning partial data when a later page fails", async () => {
    const all = Array.from({ length: 1100 }, (_, i) => ({ id: i }));
    let call = 0;
    tableImpl = (table) => makeChain(table, () => {
      call++;
      if (call === 1) return { data: all.slice(0, 1000), error: null };
      return { data: null, error: { message: "admin page 2 failed" } };
    });

    await expect(DB.getAllGigs()).rejects.toThrow("admin page 2 failed");
  });
});

describe("DB.getGigCounts (true database counts, not array length)", () => {
  it("uses head:true exact-count queries per status, independent of any row fetch", async () => {
    const totals = { total: 1811, approved: 1610, pending: 0, rejected: 201 };
    const calls = [];
    tableImpl = (table) => makeChain(table, (state) => {
      calls.push(state);
      const statusEq = state.eqs.find(([c]) => c === "status");
      const key = statusEq ? statusEq[1] : "total";
      return { count: totals[key], error: null };
    });

    const result = await DB.getGigCounts();

    expect(result).toEqual(totals);
    expect(calls.length).toBe(4);
    for (const call of calls) {
      expect(call.selectArgs[1]).toEqual({ count: "exact", head: true });
      expect(call.range).toBeNull(); // count queries never page -- head:true never returns rows
    }
  });

  it("propagates an error rather than returning a wrong/zero count", async () => {
    tableImpl = (table) => makeChain(table, () => ({ count: null, error: { message: "count query failed" } }));
    await expect(DB.getGigCounts()).rejects.toThrow("count query failed");
  });
});

describe("fetchAllPages (generic pagination helper)", () => {
  const fakeTable = (rows) => (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null });

  it("1. returns everything when there are fewer rows than one page", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    expect(await fetchAllPages(fakeTable(rows), { pageSize: 1000 })).toEqual(rows);
  });

  it("2. returns everything and terminates cleanly on exactly one full page", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    let calls = 0;
    const fetchPage = (from, to) => { calls++; return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); };
    const result = await fetchAllPages(fetchPage, { pageSize: 10 });
    expect(result).toEqual(rows);
    expect(calls).toBe(2); // full page, then an empty page confirms completion
  });

  it("3. returns everything spanning more than one page", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const result = await fetchAllPages(fakeTable(rows), { pageSize: 10 });
    expect(result).toEqual(rows);
  });

  it("4. does not lose rows sharing the same non-unique sort value across a page boundary", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: i, date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}` }));
    const result = await fetchAllPages(fakeTable(rows), { pageSize: 1000 });
    expect(result.length).toBe(1200);
    expect(result.map(r => r.id)).toEqual(rows.map(r => r.id));
  });

  it("5/6/7. produces deterministic results with no duplicated and no skipped rows", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const result = await fetchAllPages(fakeTable(rows), { pageSize: 1000 });
    const ids = result.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(rows.map(r => r.id));
  });

  it("8. terminates on a final partial page", async () => {
    const rows = Array.from({ length: 1050 }, (_, i) => ({ id: i }));
    let calls = 0;
    const fetchPage = (from, to) => { calls++; return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); };
    const result = await fetchAllPages(fetchPage, { pageSize: 1000 });
    expect(result.length).toBe(1050);
    expect(calls).toBe(2);
  });

  it("terminates immediately when the first page is empty", async () => {
    expect(await fetchAllPages(fakeTable([]), { pageSize: 1000 })).toEqual([]);
  });

  it("9. throws on a later page's error instead of silently returning the rows already fetched", async () => {
    const fetchPage = (from) => from === 0
      ? Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null })
      : Promise.resolve({ data: null, error: { message: "network error on page 2" } });
    await expect(fetchAllPages(fetchPage, { pageSize: 1000 })).rejects.toThrow("network error on page 2");
  });

  it("throws on the very first page's error without returning anything", async () => {
    const fetchPage = () => Promise.resolve({ data: null, error: { message: "boom" } });
    await expect(fetchAllPages(fetchPage)).rejects.toThrow("boom");
  });

  it("uses the default page size of 1000 when none is specified", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    let firstPageLen = null;
    const fetchPage = (from, to) => {
      if (from === 0) firstPageLen = to - from + 1;
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    };
    const result = await fetchAllPages(fetchPage);
    expect(firstPageLen).toBe(FETCH_ALL_PAGE_SIZE);
    expect(result.length).toBe(1500);
  });
});
