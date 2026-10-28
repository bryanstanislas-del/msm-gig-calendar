// Hub logo asset: a derived, full-resolution LOSSLESS WebP of the shared brand
// master (see theme.js / docs/festival-hub.md). Decoded-pixel equality with the
// master is checked in the browser (scripts/e2e/festival-hub.mjs); Node has no
// WebP decoder without adding a dependency.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const hub = readFileSync(new URL("./assets/msm-logo-hub.webp", import.meta.url));
const master = readFileSync(new URL("../../public/brand/MSM-Logo-Master.png", import.meta.url));

describe("Hub logo asset", () => {
  it("is a simple lossless WebP (RIFF/WEBP/VP8L) at the master's full resolution", () => {
    expect(hub.toString("latin1", 0, 4)).toBe("RIFF");
    expect(hub.toString("latin1", 8, 12)).toBe("WEBP");
    expect(hub.toString("latin1", 12, 16)).toBe("VP8L");
    expect(hub[20]).toBe(0x2f); // VP8L signature
    const bits = hub.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    expect([width, height]).toEqual([1254, 1254]);
    expect(master.readUInt32BE(16)).toBe(1254); // PNG IHDR width
    expect(master.readUInt32BE(20)).toBe(1254); // PNG IHDR height
  });
  it("stays within the 350,000 B budget and is smaller than the master", () => {
    expect(hub.length).toBe(342906);
    expect(hub.length).toBeLessThanOrEqual(350000);
    expect(master.length - hub.length).toBe(201926);
  });
  it("leaves the shared brand master (with its C2PA credentials) unchanged", () => {
    expect(createHash("sha256").update(master).digest("hex")).toBe("b4c507ce95abcd4bf1357bcc8f7f6f3b215a213f61e231f7cd3e28d205dbf7ee");
    expect(master.includes(Buffer.from("caBX"))).toBe(true);
    expect(hub.includes(Buffer.from("caBX"))).toBe(false); // derived copy: not the credentialled original
  });
});
