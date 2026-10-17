// Runs wordpress/msm-ads/assets/msm-ads.js in a Node vm with a STUBBED
// minimal DOM and a FAKE CLOCK (Date.now + setTimeout under test control).
// The repo intentionally has no jsdom. Local fixtures only; no real site.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../assets/msm-ads.js", import.meta.url)), "utf8");
const API = "https://calendar.example.test";
const T0 = Date.UTC(2026, 9, 20, 11, 0, 0);
const MIN = 60 * 1000;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

// ── Minimal DOM ───────────────────────────────────────────────────────
function makeEl(tag, props = {}) {
  const el = {
    tagName: tag.toUpperCase(), className: "", children: [], attrs: {}, listeners: {}, parentNode: null, ...props,
    get firstChild() { return this.children[0] || null; },
    appendChild(c) {
      if (c.isFragment) { [...c.children].forEach((x) => this.appendChild(x)); c.children = []; return c; }
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = this; this.children.push(c); return c;
    },
    insertBefore(c, ref) {
      if (c.isFragment) { [...c.children].forEach((x) => this.insertBefore(x, ref)); c.children = []; return c; }
      if (c.parentNode) c.parentNode.removeChild(c);
      const i = this.children.indexOf(ref);
      c.parentNode = this; this.children.splice(i < 0 ? this.children.length : i, 0, c); return c;
    },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
    fire(t) { (this.listeners[t] || []).slice().forEach((f) => f({ type: t })); },
    getElementsByTagName(t) {
      const out = [];
      const walk = (n) => n.children.forEach((c) => { if (c.tagName === t.toUpperCase()) out.push(c); walk(c); });
      walk(this);
      return out;
    },
  };
  if (el.tagName === "IMG") Object.assign(el, { complete: false, naturalWidth: 0 });
  return el;
}
const frag = () => Object.assign(makeEl("#fragment"), { isFragment: true });
function cloneDeep(n) {
  const c = n.isFragment ? frag() : makeEl(n.tagName, { className: n.className, attrs: { ...n.attrs } });
  n.children.forEach((k) => c.appendChild(cloneDeep(k)));
  return c;
}

function goodAd(over = {}) {
  return {
    creative_id: "11111111-2222-4333-8444-555555555555", alt: "Tour banner",
    desktop: { url: `${API}/api/ads/creative?v=1&s=desktop`, width: 1200, height: 250 },
    mobile: { url: `${API}/api/ads/creative?v=1&s=mobile`, width: 600, height: 250 },
    click_url: `${API}/api/ads/click?t=abc.def`, impression_url: `${API}/api/ads/impression`, impression_token: "abc.def",
    serve_until: new Date(T0 + 60 * MIN).toISOString(), ...over,
  };
}

/**
 * respond(callIndex) -> ads array | "fail". Builds a page whose container
 * #msm-wp-home-top holds either a house advert (JS mode) or a PHP-rendered
 * advert + <template class="msm-ad-house"> (server mode).
 */
async function setup({ respond = () => [goodAd()], server = null, jsMode = true } = {}) {
  const clock = { now: T0, timers: new Map(), seq: 0 };
  const FakeDate = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  };
  const body = makeEl("body");
  const container = makeEl("div");
  body.appendChild(container);
  const house = makeEl("a", { className: "house" });
  let serverEl = null, serverImg = null;
  if (server) {
    serverEl = makeEl("div", { className: "msm-ad" });
    for (const [k, v] of Object.entries(server.attrs)) serverEl.setAttribute(k, v);
    serverImg = makeEl("img");
    Object.assign(serverImg, server.img || {});
    const pic = makeEl("picture"); pic.appendChild(serverImg);
    const link = makeEl("a"); link.appendChild(pic);
    serverEl.appendChild(link);
    container.appendChild(serverEl);
    if (server.template !== false) {
      const tpl = makeEl("template", { className: "msm-ad-house", content: frag() });
      tpl.content.appendChild(house);
      container.appendChild(tpl);
    }
  } else {
    container.appendChild(house);
  }
  const observers = [];
  const beacons = [];
  const fetches = [];
  const document = {
    readyState: "complete", visibilityState: "visible", listeners: {},
    getElementById: (id) => (id === "msm-wp-home-top" ? container : null),
    createElement: (t) => makeEl(t),
    createDocumentFragment: frag,
    importNode: (n) => cloneDeep(n),
    querySelectorAll: (sel) => (sel === ".msm-ad[data-msm-ad-token]" && serverEl && serverEl.getAttribute("data-msm-ad-token") ? [serverEl] : []),
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
  };
  const win = { listeners: {}, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); } };
  const ctx = {
    window: win, document, Date: FakeDate,
    navigator: { sendBeacon: (u, b) => { beacons.push({ u, at: clock.now }); return true; } },
    fetch: async (url, opts) => {
      const r = respond(fetches.length);
      fetches.push({ url, opts, at: clock.now });
      if (r === "fail") throw new Error("network");
      return { ok: true, json: async () => ({ placement: "wordpress-home-top", ads: r }) };
    },
    IntersectionObserver: class {
      constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
      observe(t) { this.targets.push(t); }
      disconnect() { this.disconnected = true; }
    },
    Blob: class { constructor(p) { this.p = p; } },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: (fn, ms) => { const id = ++clock.seq; clock.timers.set(id, { fn, at: clock.now + Math.max(0, Number(ms) || 0) }); return id; },
    clearTimeout: (id) => { clock.timers.delete(id); },
    JSON, Math, Object, Array, Number, String, isNaN, Promise,
  };
  Object.assign(win, ctx, { MSM_ADS_CONFIG: { apiBase: API, restUrl: "https://www.example.test/wp-json/msm-ads/v1/slot", containers: jsMode && !server ? { "wordpress-home-top": "msm-wp-home-top" } : {} } });
  ctx.window = win;
  vm.runInNewContext(SRC, ctx);
  await flush();

  const env = {
    clock, container, house, observers, beacons, fetches, document, win,
    get img() { return serverImg || container.getElementsByTagName("img")[0] || null; },
    get showingAd() { return container.children.some((c) => c.className === "msm-ad"); },
    get showingHouse() { return container.children.length === 1 && container.children[0].className === "house"; },
    pendingTimers: () => clock.timers.size,
    async advance(ms) {
      const target = clock.now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of clock.timers) if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        clock.timers.delete(next[0]);
        clock.now = next[1].at;
        next[1].fn();
        await flush();
      }
      clock.now = target;
      await flush();
    },
    jump(ms) { clock.now += ms; }, // suspended tab: no timers run
    // Throttled tab: the clock moves on, then overdue timers fire LATE (in
    // due order, but Date.now() already past all of them).
    async fireLate(ms) {
      clock.now += ms;
      for (;;) {
        let next = null;
        for (const [id, t] of clock.timers) if (t.at <= clock.now && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        clock.timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
    },
    async loadImage(ok = true) {
      const img = env.img;
      img.complete = true; img.naturalWidth = ok ? 1200 : 0;
      img.fire(ok ? "load" : "error");
      await flush();
    },
    view(ratio) { observers.at(-1).cb([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]); },
    async setVisible(v) { document.visibilityState = v ? "visible" : "hidden"; (document.listeners.visibilitychange || []).forEach((f) => f()); await flush(); },
    async pageshow() { (win.listeners.pageshow || []).forEach((f) => f({ persisted: true })); await flush(); },
  };
  return env;
}

const serverAttrs = (over = {}) => ({
  "data-msm-ad-placement": "wordpress-home-top",
  "data-msm-ad-creative": "11111111-2222-4333-8444-555555555555",
  "data-msm-ad-until": new Date(T0 + 60 * MIN).toISOString(),
  "data-msm-ad-token": "abc.def",
  "data-msm-ad-impression": `${API}/api/ads/impression`,
  ...over,
});

describe("JS mode: rendering and house fallback", () => {
  it("swaps the house advert for a valid ad (label, sponsored link, src set)", async () => {
    const e = await setup();
    expect(e.showingAd).toBe(true);
    const ad = e.container.children[0];
    expect(ad.children[0].textContent).toBe("Advertisement");
    expect(ad.children[1].href).toBe(`${API}/api/ads/click?t=abc.def`);
    expect(ad.children[1].rel).toBe("sponsored noopener");
    expect(e.img.src).toBe(`${API}/api/ads/creative?v=1&s=desktop`);
    expect(e.fetches[0].opts.cache).toBe("no-store");
  });
  it.each([
    ["foreign click host", { click_url: "https://evil.example/click?t=abc.def" }],
    ["javascript url", { click_url: "javascript:alert(1)" }],
    ["foreign image host", { desktop: { url: "https://evil.example/a.png", width: 1200, height: 250 } }],
    ["already expired", { serve_until: new Date(T0 - 1000).toISOString() }],
    ["bad token", { impression_token: "<x>" }],
  ])("keeps the house advert for an invalid ad (%s)", async (_l, over) => {
    const e = await setup({ respond: () => [goodAd(over)] });
    expect(e.showingHouse).toBe(true);
  });
  it("keeps the house advert when there is no booking or the proxy fails", async () => {
    expect((await setup({ respond: () => [] })).showingHouse).toBe(true);
    expect((await setup({ respond: () => "fail" })).showingHouse).toBe(true);
  });
});

describe("JS mode: hard expiry, resume and revocation (fake clock)", () => {
  it("restores the house advert exactly at serve_until and leaves no timers/observers", async () => {
    const e = await setup({ respond: () => [goodAd({ serve_until: new Date(T0 + 10 * MIN).toISOString() })] });
    await e.loadImage();
    e.view(1);
    await e.advance(10 * MIN - 1);
    expect(e.showingAd).toBe(true);
    await e.advance(1);
    expect(e.showingHouse).toBe(true);
    expect(e.pendingTimers()).toBe(0);
    expect(e.observers.every((o) => o.disconnected)).toBe(true);
    const fetchesAtEnd = e.fetches.length;
    expect(fetchesAtEnd).toBeLessThanOrEqual(1 + 5); // initial + at most one refresh per 2 min
    await e.advance(60 * MIN);
    expect(e.fetches.length).toBe(fetchesAtEnd); // nothing keeps running
  });
  it("enforces expiry immediately when a suspended tab resumes (visibilitychange)", async () => {
    const e = await setup({ respond: () => [goodAd({ serve_until: new Date(T0 + 5 * MIN).toISOString() })] });
    await e.loadImage();
    await e.setVisible(false);
    e.jump(6 * MIN); // timers did not fire while suspended
    expect(e.showingAd).toBe(true);
    await e.setVisible(true);
    expect(e.showingHouse).toBe(true);
    expect(e.pendingTimers()).toBe(0);
  });
  it("enforces expiry on bfcache restore (pageshow)", async () => {
    const e = await setup({ respond: () => [goodAd({ serve_until: new Date(T0 + 5 * MIN).toISOString() })] });
    e.jump(5 * MIN);
    await e.pageshow();
    expect(e.showingHouse).toBe(true);
  });
  it("revocation (pause/refund/kill switch) removes the advert within one refresh interval", async () => {
    const e = await setup({ respond: (i) => (i === 0 ? [goodAd()] : []) });
    await e.loadImage();
    await e.advance(2 * MIN - 1);
    expect(e.showingAd).toBe(true);
    await e.advance(1);
    expect(e.showingHouse).toBe(true);
    expect(e.pendingTimers()).toBe(0);
  });
  it("a different (replacement) creative counts as revocation of the shown one", async () => {
    const e = await setup({ respond: (i) => (i === 0 ? [goodAd()] : [goodAd({ creative_id: "99999999-2222-4333-8444-555555555555" })]) });
    await e.advance(2 * MIN);
    expect(e.showingHouse).toBe(true);
  });
  it("network failure on refresh keeps the advert but never past its hard expiry", async () => {
    const e = await setup({ respond: (i) => (i === 0 ? [goodAd({ serve_until: new Date(T0 + 7 * MIN).toISOString() })] : "fail") });
    await e.advance(6 * MIN);
    expect(e.showingAd).toBe(true);
    await e.advance(1 * MIN);
    expect(e.showingHouse).toBe(true);
  });
  it("hidden tabs do not poll; resume after a stale period rechecks at once", async () => {
    const e = await setup({ respond: (i) => (i === 0 ? [goodAd()] : []) });
    await e.setVisible(false);
    await e.advance(10 * MIN);
    expect(e.fetches.length).toBe(1);
    expect(e.showingAd).toBe(true);
    await e.setVisible(true);
    expect(e.fetches.length).toBe(2);
    expect(e.showingHouse).toBe(true);
  });
  it("a shorter serve_until from refresh tightens the hard expiry", async () => {
    const e = await setup({ respond: (i) => [goodAd({ serve_until: new Date(T0 + (i === 0 ? 60 : 3) * MIN).toISOString() })] });
    await e.advance(2 * MIN);
    expect(e.showingAd).toBe(true);
    await e.advance(1 * MIN);
    expect(e.showingHouse).toBe(true);
  });
});

describe("JS mode: viewable impressions (fake clock)", () => {
  it("slow image: nothing counts before the creative has loaded, even after >1 s in view", async () => {
    const e = await setup();
    expect(e.observers).toHaveLength(0); // not armed before load
    await e.advance(3000);
    expect(e.beacons).toHaveLength(0);
    await e.loadImage();
    e.view(0.6);
    await e.advance(999);
    expect(e.beacons).toHaveLength(0);
    await e.advance(1);
    expect(e.beacons).toHaveLength(1);
    expect(e.observers[0].targets[0]).toBe(e.img);
  });
  it("failed image: house restored, no beacon, nothing left pending", async () => {
    const e = await setup();
    await e.loadImage(false);
    expect(e.showingHouse).toBe(true);
    await e.advance(5000);
    expect(e.beacons).toHaveLength(0);
    expect(e.observers).toHaveLength(0);
    expect(e.pendingTimers()).toBe(0);
  });
  it("expiry during observation: no beacon at the boundary, house restored", async () => {
    const e = await setup({ respond: () => [goodAd({ serve_until: new Date(T0 + 500).toISOString() })] });
    await e.loadImage();
    e.view(1);
    await e.advance(1000);
    expect(e.beacons).toHaveLength(0);
    expect(e.showingHouse).toBe(true);
  });
  it("throttled timers: a late 1 s boundary after serve_until never counts", async () => {
    const e = await setup({ respond: () => [goodAd({ serve_until: new Date(T0 + 1500).toISOString() })] });
    await e.loadImage();
    e.view(1); // boundary due at +1000 ms, expiry at +1500 ms
    await e.fireLate(2000); // both fire late; the view timer runs first with now = +2000 ms
    expect(e.beacons).toHaveLength(0);
    expect(e.showingHouse).toBe(true);
    expect(e.pendingTimers()).toBe(0);
  });
  it("tab hidden or scrolled out before 1 s: no beacon; a fresh full second is required", async () => {
    const e = await setup();
    await e.loadImage();
    e.view(1);
    await e.advance(900);
    await e.setVisible(false);
    await e.advance(5000);
    expect(e.beacons).toHaveLength(0);
    await e.setVisible(true);
    await e.advance(999);
    expect(e.beacons).toHaveLength(0);
    e.view(0.3); // scrolled mostly out at the boundary
    await e.advance(10);
    expect(e.beacons).toHaveLength(0);
    e.view(0.8);
    await e.advance(1000);
    expect(e.beacons).toHaveLength(1);
  });
  it("image broken by the boundary: no beacon, house restored", async () => {
    const e = await setup();
    await e.loadImage();
    e.view(1);
    e.img.naturalWidth = 0; // e.g. decoded data evicted / replaced by a broken response
    await e.advance(1000);
    expect(e.beacons).toHaveLength(0);
    expect(e.showingHouse).toBe(true);
  });
  it("counts at most once per page view", async () => {
    const e = await setup();
    await e.loadImage();
    e.view(1);
    await e.advance(1000);
    e.view(0); e.view(1);
    await e.advance(5000);
    expect(e.beacons).toHaveLength(1);
  });
});

describe("server (PHP-rendered) mode", () => {
  it("adopts a cached, already-loaded image: impression after 1 s, then hard expiry restores the template house advert", async () => {
    const e = await setup({ server: { attrs: serverAttrs({ "data-msm-ad-until": new Date(T0 + 4 * MIN).toISOString() }), img: { complete: true, naturalWidth: 1200 } } });
    expect(e.observers).toHaveLength(1);
    e.view(1);
    await e.advance(1000);
    expect(e.beacons).toHaveLength(1);
    await e.advance(4 * MIN);
    expect(e.container.children.map((c) => c.className)).toEqual(["house"]);
    expect(e.pendingTimers()).toBe(0);
  });
  it("cached image that loaded, counted, then fails later (responsive source change) restores the house advert", async () => {
    const e = await setup({ server: { attrs: serverAttrs(), img: { complete: true, naturalWidth: 1200 } } });
    expect(e.img.listeners.error).toHaveLength(1); // listener attached even though already complete
    e.view(1);
    await e.advance(1000);
    expect(e.beacons).toHaveLength(1);
    e.img.naturalWidth = 0;
    e.img.fire("error");
    await e.advance(0);
    expect(e.container.children.map((c) => c.className)).toEqual(["house"]);
    expect(e.pendingTimers()).toBe(0);
    expect(e.img.listeners.error).toHaveLength(0); // cleaned up
    await e.advance(10 * MIN);
    expect(e.beacons).toHaveLength(1);
    expect(e.fetches).toHaveLength(0); // no refresh left running
  });
  it("JS mode: image error after the impression counted still restores the house advert", async () => {
    const e = await setup();
    await e.loadImage();
    e.view(1);
    await e.advance(1000);
    expect(e.beacons).toHaveLength(1);
    e.img.naturalWidth = 0;
    e.img.fire("error");
    await e.advance(0);
    expect(e.showingHouse).toBe(true);
    expect(e.pendingTimers()).toBe(0);
  });
  it("cached broken image (complete, naturalWidth 0) restores the house advert immediately", async () => {
    const e = await setup({ server: { attrs: serverAttrs(), img: { complete: true, naturalWidth: 0 } } });
    expect(e.container.children.map((c) => c.className)).toEqual(["house"]);
    expect(e.beacons).toHaveLength(0);
  });
  it("slow image then error: no beacon, house restored, nothing pending", async () => {
    const e = await setup({ server: { attrs: serverAttrs(), img: { complete: false } } });
    await e.advance(2000);
    await e.loadImage(false);
    expect(e.container.children.map((c) => c.className)).toEqual(["house"]);
    expect(e.beacons).toHaveLength(0);
    expect(e.pendingTimers()).toBe(0);
  });
  it("revocation via the bounded refresh removes a PHP-rendered advert", async () => {
    const e = await setup({ respond: () => [], server: { attrs: serverAttrs(), img: { complete: true, naturalWidth: 1200 } } });
    await e.advance(2 * MIN);
    expect(e.container.children.map((c) => c.className)).toEqual(["house"]);
  });
  it("suspended tab resume enforces expiry for PHP-rendered adverts", async () => {
    const e = await setup({ server: { attrs: serverAttrs({ "data-msm-ad-until": new Date(T0 + MIN).toISOString() }), img: { complete: true, naturalWidth: 1200 } } });
    e.jump(2 * MIN);
    await e.setVisible(true);
    expect(e.container.children.map((c) => c.className)).toEqual(["house"]);
  });
  it("unverifiable markup (no serve_until) fails safe to the house advert", async () => {
    const attrs = serverAttrs();
    delete attrs["data-msm-ad-until"];
    const e = await setup({ server: { attrs, img: { complete: true, naturalWidth: 1200 } } });
    expect(e.container.children.map((c) => c.className)).toEqual(["house"]);
  });
  it("without a house template the advert is simply removed at expiry (never left showing)", async () => {
    const e = await setup({ server: { attrs: serverAttrs({ "data-msm-ad-until": new Date(T0 + MIN).toISOString() }), img: { complete: true, naturalWidth: 1200 }, template: false } });
    await e.advance(MIN);
    expect(e.container.children).toHaveLength(0);
  });
});
