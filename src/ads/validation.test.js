import { describe, it, expect } from "vitest";
import { destinationUrlProblem, isSafeDestinationUrl, altTextProblem, creativeFileProblem, isKnownPlacement } from "./validation.js";

describe("ads destination URL rule", () => {
  it.each([
    "https://example.com",
    "https://www.example.co.uk/path?utm_source=msm&x=1#top",
    "https://sub.example-band.com:8443/tickets",
  ])("accepts %s", (u) => expect(isSafeDestinationUrl(u)).toBe(true));

  it.each([
    "http://example.com",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>",
    "//example.com",
    "https://user:pw@example.com",
    "https://localhost/",
    "https://app.localhost/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://2130706433/",
    "https://exa mple.com",
    "https://example.com/\nSet-Cookie:x",
    "https://example",
    "https://example.com/" + "a".repeat(2050),
    "",
    null,
  ])("rejects %s", (u) => expect(isSafeDestinationUrl(u)).toBe(false));

  it("explains the problem", () => {
    expect(destinationUrlProblem("http://example.com")).toMatch(/https/);
  });
});

describe("alt text + file prechecks", () => {
  it("alt text bounds", () => {
    expect(altTextProblem("ab")).toBeTruthy();
    expect(altTextProblem("Band tour banner")).toBeNull();
    expect(altTextProblem("x".repeat(251))).toBeTruthy();
  });
  it("file type, size and exact dimensions", () => {
    const expected = { width: 1200, height: 250 };
    expect(creativeFileProblem({ type: "image/svg+xml", size: 10 }, {}, expected)).toMatch(/PNG/);
    expect(creativeFileProblem({ type: "image/gif", size: 10 }, {}, expected)).toMatch(/PNG/);
    expect(creativeFileProblem({ type: "image/png", size: 2_000_000 }, {}, expected)).toMatch(/1 MB/);
    expect(creativeFileProblem({ type: "image/png", size: 10 }, { width: 1199, height: 250 }, expected)).toMatch(/exactly 1200x250/);
    expect(creativeFileProblem({ type: "image/webp", size: 10 }, { width: 1200, height: 250 }, expected)).toBeNull();
  });
  it("placements are allow-listed", () => {
    expect(isKnownPlacement("wordpress-home-top")).toBe(true);
    expect(isKnownPlacement("wordpress-home-top/../x")).toBe(false);
    expect(isKnownPlacement("wordpress-article-review-top")).toBe(false);
  });
});
