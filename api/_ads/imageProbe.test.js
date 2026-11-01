import { describe, it, expect } from "vitest";
import { probeImage, sha256Hex } from "./imageProbe.js";
import { fakePng, fakeJpeg, fakeWebpVp8x } from "./testFixtures.js";

function fakeWebpVp8l(w, h) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii"); b.write("WEBP", 8, "ascii"); b.write("VP8L", 12, "ascii"); b[20] = 0x2f;
  b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
}

describe("server-side image probing (magic bytes, not extension)", () => {
  it("reads PNG/JPEG/WebP dimensions", () => {
    expect(probeImage(fakePng(1200, 250))).toEqual({ mime: "image/png", width: 1200, height: 250 });
    expect(probeImage(fakeJpeg(600, 250))).toEqual({ mime: "image/jpeg", width: 600, height: 250 });
    expect(probeImage(fakeWebpVp8x(1200, 250))).toEqual({ mime: "image/webp", width: 1200, height: 250 });
    expect(probeImage(fakeWebpVp8l(600, 250))).toEqual({ mime: "image/webp", width: 600, height: 250 });
  });
  it("rejects SVG, GIF, HTML and truncated files", () => {
    expect(probeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(probeImage(Buffer.from("GIF89a\x01\x00\x01\x00"))).toBeNull();
    expect(probeImage(Buffer.from("<html><script>x</script></html>"))).toBeNull();
    expect(probeImage(fakePng(1, 1).subarray(0, 10))).toBeNull();
    expect(probeImage("not a buffer")).toBeNull();
  });
  it("hashes content", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
