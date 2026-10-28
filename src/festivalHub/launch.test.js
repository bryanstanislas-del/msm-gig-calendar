// Launch builds (VITE_HUB_LAUNCH=1, injected by the standalone Vite config)
// must never show the fictional demo, whatever the URL says.
import { describe, it, expect, vi, afterEach } from "vitest";

async function load(flag) {
  vi.resetModules();
  vi.stubEnv("VITE_HUB_LAUNCH", flag);
  return { ...(await import("./launch.js")), ...(await import("./listings.js")) };
}
afterEach(() => vi.unstubAllEnvs());

describe("launch mode", () => {
  it("staging (default): the demo is available via ?demo=1", async () => {
    const m = await load("0");
    expect(m.LAUNCH_MODE).toBe(false);
    expect(m.DEMO_ENABLED).toBe(true);
    expect(m.modeFromSearch("?demo=1")).toBe(m.MODES.DEMO);
    const dir = m.getDirectory(m.MODES.DEMO, { today: "2026-10-27" });
    expect(dir.listings.length).toBeGreaterThan(0);
    expect(dir.listings.every((l) => l.isDemo)).toBe(true);
  });
  it("launch: ?demo=1 is ignored and only real listings are returned", async () => {
    const m = await load("1");
    expect(m.LAUNCH_MODE).toBe(true);
    expect(m.DEMO_ENABLED).toBe(false);
    for (const q of ["?demo=1", "?demo=true", "", "?x=1&demo=1"]) expect(m.modeFromSearch(q)).toBe(m.MODES.REAL);
    for (const mode of [m.MODES.DEMO, m.MODES.REAL]) {
      const dir = m.getDirectory(mode, { today: "2026-10-27" });
      expect(dir.listings.length).toBe(26);
      expect(dir.listings.some((l) => l.isDemo || l.id.startsWith("demo-"))).toBe(false);
    }
  });
});
