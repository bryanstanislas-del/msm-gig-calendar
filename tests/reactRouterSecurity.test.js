// React Router open-redirect advisories (GHSA-wrjc-x8rr-h8h6,
// GHSA-jjmj-jmhj-qwj2 in 6.x; GHSA-qwww-vcr4-c8h2 in 7.12.0-7.18.1).
//
// 1) The installed react-router-dom AND its transitive react-router are a
//    fixed release (>= 7.18.2), pinned exactly in package.json.
// 2) Every data-driven <Link to> in the app is a fixed in-app prefix plus a
//    stored slug (/gig/, /artist/, /venue/, /festival/, /promoter/), and the
//    notification links are built the same way (App.jsx). Rendered with
//    hostile slugs, those hrefs must stay same-origin.
// 3) navigate() is only ever called with a string literal, so no attacker
//    value can choose a navigation target.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Link } from "react-router-dom";

const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url).pathname;
const ORIGIN = "https://calendar.musicscenemagazine.co.uk";

function version(name) {
  return require(`${name}/package.json`).version.split(".").map(Number);
}
function atLeast([a, b, c], [x, y, z]) {
  return a !== x ? a > x : b !== y ? b > y : c >= z;
}

describe("react-router is a fixed release", () => {
  it.each(["react-router-dom", "react-router"])("%s >= 7.18.2", (name) => {
    expect(atLeast(version(name), [7, 18, 2])).toBe(true);
  });

  it("react-router-dom is pinned exactly and resolves the same react-router version", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.dependencies["react-router-dom"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version("react-router-dom")).toEqual(version("react-router"));
    const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    expect(lock.packages["node_modules/react-router"].version).toBe(lock.packages["node_modules/react-router-dom"].version);
    expect(lock.packages["node_modules/@remix-run/router"]).toBeUndefined();
  });
});

describe("app-built Link targets stay same-origin with hostile slugs", () => {
  let errSpy;
  beforeAll(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); }); // SSR useLayoutEffect noise
  afterAll(() => errSpy.mockRestore());

  const PREFIXES = ["/gig/", "/artist/", "/venue/", "/festival/", "/promoter/"];
  const SLUGS = ["\\evil.example", "\\\\evil.example", "/evil.example", "//evil.example", "https://evil.example/x",
    "javascript:alert(1)", "../../../evil", "%2F%2Fevil.example", "\\/evil.example", " //evil.example"];

  function href(to) {
    const html = renderToString(createElement(MemoryRouter, null, createElement(Link, { to }, "x")));
    const m = /href="([^"]*)"/.exec(html);
    return m[1].replace(/&amp;/g, "&");
  }

  it.each(PREFIXES.flatMap((p) => SLUGS.map((s) => [p, s])))("%s + %j", (prefix, slug) => {
    const h = href(`${prefix}${slug}`);
    expect(h.startsWith("/")).toBe(true);
    expect(h[1]).not.toMatch(/[/\\]/);
    expect(new URL(h, ORIGIN).origin).toBe(ORIGIN);
  });
});

describe("navigation targets are not attacker-controlled", () => {
  function sources(dir) {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
  }

  it("every navigate(...) call in src/ passes a string literal", () => {
    const calls = sources(join(ROOT, "src")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bnavigate\(([^)]*)\)/g)].map((m) => ({ file, arg: m[1].trim() }))
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.arg, c.file).toMatch(/^(["'])\/[A-Za-z0-9/_-]*\1$/);
  });

  it("notification links are built in-app from a fixed prefix", () => {
    const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
    const assigns = [...app.matchAll(/\blink = (?!null;)([^;]+);/g)].map((m) => m[1]);
    expect(assigns.length).toBeGreaterThan(0);
    for (const a of assigns) expect(a).toMatch(/^`\/(gig|festival)\/\$\{/);
  });
});
