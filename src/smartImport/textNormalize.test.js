import { describe, it, expect } from "vitest";
import { normaliseName, normaliseCity, stripStatusWording } from "./textNormalize.js";

describe("normaliseName", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normaliseName("  The   Obelisk  ")).toBe("the obelisk");
  });
  it("returns '' for null/undefined/empty", () => {
    expect(normaliseName(null)).toBe("");
    expect(normaliseName(undefined)).toBe("");
    expect(normaliseName("")).toBe("");
  });
});

describe("normaliseCity", () => {
  it("lowercases and trims but does not collapse internal whitespace", () => {
    expect(normaliseCity("  Southampton  ")).toBe("southampton");
  });
  it("returns '' for null/undefined", () => {
    expect(normaliseCity(null)).toBe("");
    expect(normaliseCity(undefined)).toBe("");
  });
});

describe("stripStatusWording", () => {
  it("strips a trailing ' - POSTPONED' suffix", () => {
    expect(stripStatusWording("A Skylit Drive / Vampires Everywhere - POSTPONED")).toBe(
      "A Skylit Drive / Vampires Everywhere"
    );
  });
  it("strips a trailing '(CANCELLED)' parenthetical", () => {
    expect(stripStatusWording("The Mafia (CANCELLED)")).toBe("The Mafia");
  });
  it("strips 'rescheduled' and 'sold out' variants", () => {
    expect(stripStatusWording("The Mafia - Rescheduled")).toBe("The Mafia");
    expect(stripStatusWording("The Mafia - SOLD OUT")).toBe("The Mafia");
    expect(stripStatusWording("The Mafia (sold-out)")).toBe("The Mafia");
  });
  it("strips stacked markers", () => {
    expect(stripStatusWording("The Mafia (CANCELLED) - RESCHEDULED")).toBe("The Mafia");
  });
  it("leaves an ordinary name untouched", () => {
    expect(stripStatusWording("The Mafia")).toBe("The Mafia");
  });
  it("passes through null/undefined/empty unchanged", () => {
    expect(stripStatusWording(null)).toBe(null);
    expect(stripStatusWording("")).toBe("");
  });
});
