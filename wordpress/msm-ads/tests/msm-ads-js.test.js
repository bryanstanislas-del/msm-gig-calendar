// Runs wordpress/msm-ads/assets/msm-ads.js in a Node vm with a STUBBED
// minimal DOM (this repo intentionally has no jsdom). Local fixtures only.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../assets/msm-ads.js", import.meta.url)), "utf8");
const API = "https://calendar.example.test";

function el(tag) {
  return {
    tagName: tag, children: [], attrs: {}, listeners: {}, parentNode: null,
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { if (c.isFragment) { c.children.forEach((x) => this.appendChild(x)); c.children = []; return c; } if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
  };
}

function goodAd(over = {}) {
  return {
    creative_id: "11111111-2222-4333-8444-555555555555", alt: "Tour banner",
    desktop: { url: `${API}/api/ads/creative?v=1&s=desktop`, width: 1200, height: 250 },
    mobile: { url: `${API}/api/ads/creative?v=1&s=mobile`, width: 600, height: 250 },
    click_url: `${API}/api/ads/click?t=abc.def`, impression_url: `${API}/api/ads/impression`, impression_token: "abc.def",
    serve_until: new Date(Date.now() + 3600e3).toISOString(), ...over,
  };
}

async function runWith(ads, { placement = "wordpress-home-top" } = {}) {
  const container = el("div");
  const house = el("a");
  container.appendChild(house);
  const observers = [];
  const beacons = [];
  const timers = [];
  const ctx = {
    window: {}, navigator: { sendBeacon: (u, b) => { beacons.push(u); return true; } },
    document: {
      readyState: "complete", visibilityState: "visible",
      getElementById: (id) => (id === "msm-wp-home-top" ? container : null),
      createElement: (t) => el(t),
      createDocumentFragment: () => Object.assign(el("#frag"), { isFragment: true }),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: vi.fn(async () => ({ ok: true, json: async () => ({ placement, ads }) })),
    IntersectionObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.off = true; } },
    Blob: class { constructor(p) { this.p = p; } },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    Date, JSON, Math, Object, Array, Number, String, isNaN,
  };
  ctx.window = ctx;
  ctx.window.MSM_ADS_CONFIG = { apiBase: API, restUrl: "https://www.example.test/wp-json/msm-ads/v1/slot", containers: { "wordpress-home-top": "msm-wp-home-top" } };
  vm.runInNewContext(SRC, ctx);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return { container, house, observers, beacons, timers, ctx };
}

describe("WordPress JS adapter", () => {
  it("swaps the house advert for a valid approved ad, with label + sponsored link", async () => {
    const { container, house } = await runWith([goodAd()]);
    expect(container.children).toHaveLength(1);
    expect(container.children[0]).not.toBe(house);
    const ad = container.children[0];
    expect(ad.children[0].textContent).toBe("Advertisement");
    expect(ad.children[1].href).toBe(`${API}/api/ads/click?t=abc.def`);
    expect(ad.children[1].rel).toBe("sponsored noopener");
  });

  it.each([
    ["foreign click host", { click_url: "https://evil.example/click?t=abc.def" }],
    ["javascript url", { click_url: "javascript:alert(1)" }],
    ["foreign image host", { desktop: { url: "https://evil.example/a.png", width: 1200, height: 250 } }],
    ["expired", { serve_until: new Date(Date.now() - 1000).toISOString() }],
    ["bad token", { impression_token: "<x>" }],
  ])("keeps the house advert for an invalid ad (%s)", async (_l, over) => {
    const { container, house } = await runWith([goodAd(over)]);
    expect(container.children).toEqual([house]);
  });

  it("keeps the house advert when there is no booking", async () => {
    const { container, house } = await runWith([]);
    expect(container.children).toEqual([house]);
  });

  it("restores the house advert if the artwork fails to load", async () => {
    const { container, house } = await runWith([goodAd()]);
    const img = container.children[0].children[1].children[0].children[1];
    img.listeners.error[0]();
    expect(container.children).toEqual([house]);
  });

  it("counts a viewable impression only after >=50% visible for 1s, once", async () => {
    const { observers, beacons, timers } = await runWith([goodAd()]);
    const io = observers[0];
    const before = timers.length;
    io.cb([{ isIntersecting: true, intersectionRatio: 0.3 }]);
    expect(timers.length).toBe(before); // under 50%: no timer
    io.cb([{ isIntersecting: true, intersectionRatio: 0.6 }]);
    const t = timers[timers.length - 1];
    expect(t.ms).toBe(1000);
    expect(beacons).toHaveLength(0);
    t.fn();
    expect(beacons).toEqual([`${API}/api/ads/impression`]);
    t.fn();
    expect(beacons).toHaveLength(1);
  });
});
