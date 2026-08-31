import { describe, it, expect } from "vitest";
import { normaliseName, normaliseCity, stripStatusWording, normaliseTime } from "./textNormalize.js";

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

describe("normaliseTime", () => {
  it("parses canonical 24-hour HH:MM values", () => {
    expect(normaliseTime("12:35")).toBe(12 * 60 + 35);
    expect(normaliseTime("15:35")).toBe(15 * 60 + 35);
    expect(normaliseTime("20:00")).toBe(20 * 60);
    expect(normaliseTime("00:00")).toBe(0);
  });

  it("parses H:MM with an am/pm suffix", () => {
    expect(normaliseTime("8:00pm")).toBe(20 * 60);
    expect(normaliseTime("8:00 PM")).toBe(20 * 60);
    expect(normaliseTime("8:00am")).toBe(8 * 60);
    expect(normaliseTime("12:00pm")).toBe(12 * 60); // noon
    expect(normaliseTime("12:00am")).toBe(0); // midnight
  });

  it("parses a bare hour + am/pm with no minutes", () => {
    expect(normaliseTime("8pm")).toBe(20 * 60);
    expect(normaliseTime("8 pm")).toBe(20 * 60);
    expect(normaliseTime("8am")).toBe(8 * 60);
  });

  it("two different textual forms of the same actual time normalise identically", () => {
    expect(normaliseTime("20:00")).toBe(normaliseTime("8:00pm"));
    expect(normaliseTime("08:00")).toBe(normaliseTime("8am"));
  });

  it("returns null (never throws) for unparseable, empty, or missing values", () => {
    for (const input of [null, undefined, "", "   ", "TBC", "doors 7", "tbc", "-"]) {
      expect(() => normaliseTime(input)).not.toThrow();
      expect(normaliseTime(input)).toBeNull();
    }
  });

  it("returns null for an out-of-range hour or minute rather than a nonsensical value", () => {
    expect(normaliseTime("25:00")).toBeNull();
    expect(normaliseTime("12:99")).toBeNull();
  });

  it("never throws on adversarial input", () => {
    const inputs = ["a".repeat(5000), "🎸🎤", "12:35:00:00", "{}"];
    for (const input of inputs) {
      expect(() => normaliseTime(input)).not.toThrow();
    }
  });
});
