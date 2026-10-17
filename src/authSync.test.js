import { describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { startAuthSync } from "./authSync.js";

// Controllable fake: emit(event, session) drives the listener; buildAuth
// results are resolved by hand so races are deterministic.
function fakeSupabase(startSession = null) {
  let cb;
  return {
    emit: (e, s) => cb(e, s),
    cbResult: (e, s) => cb(e, s),
    unsubscribed: false,
    auth: {
      getSession: async () => ({ data: { session: startSession }, error: null }),
      onAuthStateChange(fn) { cb = fn; const self = this; return { data: { subscription: { unsubscribe() { self.unsubscribed = true; } } } }; },
    },
  };
}
const session = (id) => ({ access_token: "LOCAL-FAKE", user: { id } });
function harness(startSession) {
  const sb = fakeSupabase(startSession);
  const pending = [];
  const buildAuth = vi.fn((s) => new Promise((res, rej) => pending.push({ id: s.user.id, res, rej })));
  const setAuth = vi.fn();
  const onError = vi.fn();
  const queue = [];
  const stop = startAuthSync({ supabase: sb, buildAuth, setAuth, onError, defer: (fn) => queue.push(fn) });
  const flush = async () => { while (queue.length) queue.shift()(); await Promise.resolve(); };   // run deferred tasks; their awaits stay pending
  const settle = async (id, value) => { const p = pending.find((x) => x.id === id && !x.done); p.done = true; p.res(value); await Promise.resolve(); await Promise.resolve(); };
  return { sb, buildAuth, setAuth, onError, stop, flush, settle, pending, queue };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const lastAuth = (h) => h.setAuth.mock.calls.at(-1)?.[0];

describe("auth sync (deterministic fake client)", () => {
  it("startup session loads the profile outside the callback, once (INITIAL_SESSION duplicate ignored)", async () => {
    const h = harness(session("u1"));
    await tick();
    h.sb.emit("INITIAL_SESSION", session("u1"));
    expect(h.buildAuth).not.toHaveBeenCalled();            // deferred, not inside the callback
    await h.flush();
    expect(h.buildAuth).toHaveBeenCalledTimes(1);
    await h.settle("u1", { user: { id: "u1" }, profile: { role: "admin" } });
    expect(lastAuth(h)).toEqual({ user: { id: "u1" }, profile: { role: "admin" } });
  });
  it("the auth callback is synchronous (returns no promise)", () => {
    const h = harness(null);
    expect(h.sb.cbResult("SIGNED_IN", session("u1"))).toBeUndefined();
  });
  it("SIGNED_OUT while a profile load is pending: the late result is dropped", async () => {
    const h = harness(null);
    h.sb.emit("SIGNED_IN", session("u1"));
    await h.flush();
    h.sb.emit("SIGNED_OUT", null);
    expect(lastAuth(h)).toBeNull();
    await h.settle("u1", { user: { id: "u1" } });
    expect(lastAuth(h)).toBeNull();                         // not resurrected
  });
  it("account switch: the previous user's late result never overwrites the new user", async () => {
    const h = harness(null);
    h.sb.emit("SIGNED_IN", session("a"));
    await h.flush();
    h.sb.emit("SIGNED_IN", session("b"));
    await h.flush();
    await h.settle("b", { user: { id: "b" } });
    await h.settle("a", { user: { id: "a" } });
    expect(lastAuth(h)).toEqual({ user: { id: "b" } });
    expect(h.setAuth.mock.calls.filter(([x]) => x?.user?.id === "a")).toEqual([]);
  });
  it("TOKEN_REFRESHED / USER_UPDATED for the same user do not refetch", async () => {
    const h = harness(null);
    h.sb.emit("SIGNED_IN", session("u1"));
    await h.flush();
    h.sb.emit("TOKEN_REFRESHED", session("u1"));
    h.sb.emit("USER_UPDATED", session("u1"));
    await h.flush();
    expect(h.buildAuth).toHaveBeenCalledTimes(1);
  });
  it("unmount: no state update afterwards; listener unsubscribed", async () => {
    const h = harness(null);
    h.sb.emit("SIGNED_IN", session("u1"));
    await h.flush();
    h.stop();
    await h.settle("u1", { user: { id: "u1" } });
    h.sb.emit("SIGNED_OUT", null);
    expect(h.setAuth).not.toHaveBeenCalled();
    expect(h.sb.auth.unsubscribed).toBe(true);
  });
  it("a deferred load that is superseded before it runs makes no request", async () => {
    const h = harness(null);
    h.sb.emit("SIGNED_IN", session("u1"));
    h.sb.emit("SIGNED_OUT", null);
    await h.flush();
    expect(h.buildAuth).not.toHaveBeenCalled();
  });
  it("profile load failure is reported without session data; auth not set", async () => {
    const h = harness(null);
    h.sb.emit("SIGNED_IN", session("u1"));
    await h.flush();
    h.pending[0].rej(new Error("network down"));
    await tick();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.setAuth).not.toHaveBeenCalled();
  });
});

describe("auth sync: delayed startup getSession vs newer events (review repro)", () => {
  function delayed() {
    let resolveStartup, rejectStartup;
    const sb = fakeSupabase(null);
    sb.auth.getSession = () => new Promise((res, rej) => { resolveStartup = res; rejectStartup = rej; });
    const pending = [];
    const buildAuth = vi.fn((s) => new Promise((res) => pending.push({ id: s.user.id, res })));
    const setAuth = vi.fn();
    const onError = vi.fn();
    const queue = [];
    const stop = startAuthSync({ supabase: sb, buildAuth, setAuth, onError, defer: (fn) => queue.push(fn) });
    const flush = async () => { await tick(); while (queue.length) queue.shift()(); await tick(); };
    return { sb, buildAuth, setAuth, onError, stop, flush, pending,
      // getSession is requested one microtask after start (so a synchronous throw is caught too).
      startupResolves: async (id) => { await tick(); resolveStartup({ data: { session: id ? session(id) : null }, error: null }); await tick(); },
      startupRejects: async (e) => { await tick(); rejectStartup(e); await tick(); } };
  }
  it("SIGNED_OUT before startup resolves: the stale startup session is ignored (was [null, 'stale-user'])", async () => {
    const h = delayed();
    await tick();
    h.sb.emit("SIGNED_OUT", null);
    await h.startupResolves("stale-user");
    await h.flush();
    expect(h.buildAuth).not.toHaveBeenCalled();
    expect(h.setAuth.mock.calls).toEqual([[null]]);
  });
  it("account B signs in before startup (account A) resolves: A never replaces B", async () => {
    const h = delayed();
    await tick();
    h.sb.emit("SIGNED_IN", session("b"));
    await h.startupResolves("a");
    await h.flush();
    expect(h.buildAuth.mock.calls.map(([s]) => s.user.id)).toEqual(["b"]);
    h.pending[0].res({ user: { id: "b" } });
    await tick();
    expect(h.setAuth.mock.calls).toEqual([[{ user: { id: "b" } }]]);
  });
  it("INITIAL_SESSION before startup resolves: one load, from the event", async () => {
    const h = delayed();
    await tick();
    h.sb.emit("INITIAL_SESSION", session("u1"));
    await h.startupResolves("u1");
    await h.flush();
    expect(h.buildAuth).toHaveBeenCalledTimes(1);
  });
  it("no newer event: the startup session is used", async () => {
    const h = delayed();
    await h.startupResolves("u1");
    await h.flush();
    expect(h.buildAuth.mock.calls.map(([s]) => s.user.id)).toEqual(["u1"]);
  });
  it("startup rejection is reported, never unhandled, and changes no auth", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const h = delayed();
    await h.startupRejects(new Error("storage unavailable"));
    await tick(); await tick();
    process.off("unhandledRejection", unhandled);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
    expect(h.setAuth).not.toHaveBeenCalled();
  });
  it("startup error result is reported, not treated as signed out", async () => {
    const sb = fakeSupabase(null);
    sb.auth.getSession = async () => ({ data: { session: null }, error: new Error("lock timeout") });
    const setAuth = vi.fn(), onError = vi.fn();
    startAuthSync({ supabase: sb, buildAuth: vi.fn(), setAuth, onError, defer: () => {} });
    await tick();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(setAuth).not.toHaveBeenCalled();
  });
  it("account switch clears the previous user's auth immediately, before the new profile resolves", async () => {
    const h = harness(null);
    h.sb.emit("SIGNED_IN", session("admin-a"));
    await h.flush();
    await h.settle("admin-a", { user: { id: "admin-a" }, profile: { role: "admin" } });
    h.sb.emit("SIGNED_IN", session("b"));
    expect(lastAuth(h)).toBeNull();                          // admin UI gone right away
    await h.flush();
    await h.settle("b", { user: { id: "b" }, profile: { role: "band" } });
    expect(h.setAuth.mock.calls.map(([x]) => x?.user?.id ?? null)).toEqual(["admin-a", null, "b"]);
  });
});

describe("auth sync with the REAL supabase-js client (fake fetch, no network)", () => {
  const URL = "https://abcdefghijklmnopqrst.supabase.co";
  const KEY = "sb-abcdefghijklmnopqrst-auth-token";
  function realClient({ stalledProfiles = false } = {}) {
    const store = new Map([[KEY, JSON.stringify({ access_token: "LOCAL.FAKE.token", refresh_token: "LOCAL-FAKE-refresh", token_type: "bearer",
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u-admin", aud: "authenticated", role: "authenticated", email: "admin@example.invalid" } })]]);
    const requests = [];
    const fetch = async (u) => {
      const url = String(u);
      requests.push(url.replace(URL, ""));
      if (url.includes("/rest/v1/profiles")) {
        if (stalledProfiles) await new Promise(() => {});
        return new Response(JSON.stringify([{ user_id: "u-admin", role: "admin" }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = createClient(URL, "LOCAL-FAKE-anon", { auth: { storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
      persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
    return { client, requests };
  }
  const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("HUNG"), ms))]);

  it("stored session -> profile loaded -> later ads requests complete", async () => {
    const { client, requests } = realClient();
    const setAuth = vi.fn();
    const stop = startAuthSync({ supabase: client, setAuth, buildAuth: async (s) => {
      const { data } = await client.from("profiles").select("*").eq("user_id", s.user.id);
      return { user: s.user, profile: data[0] };
    } });
    await vi.waitFor(() => expect(setAuth).toHaveBeenCalled(), { timeout: 2000 });
    expect(setAuth.mock.calls.at(-1)[0].profile.role).toBe("admin");
    expect(await within(client.from("ad_settings").select("key").then(() => "DONE"), 1500)).toBe("DONE");
    expect(requests.filter((r) => r.startsWith("/rest/v1/profiles")).length).toBe(1);
    stop();
  });
  it("even a profile request that never returns cannot block ads requests or sign-out", async () => {
    const { client } = realClient({ stalledProfiles: true });
    const setAuth = vi.fn();
    const stop = startAuthSync({ supabase: client, setAuth, buildAuth: async (s) => { await client.from("profiles").select("*").eq("user_id", s.user.id); return { user: s.user }; } });
    await new Promise((r) => setTimeout(r, 50));
    expect(await within(client.from("ad_settings").select("key").then(() => "DONE"), 1500)).toBe("DONE");
    await within(client.auth.signOut(), 1500);
    await vi.waitFor(() => expect(setAuth).toHaveBeenLastCalledWith(null), { timeout: 2000 });
    stop();
  });
});
