import { describe, it, expect } from "vitest";
import { GENRES, GENRE_COLORS, normalizeGenre, isValidGenre, genreColor, genreLabel, NO_GENRE_COLOR } from "./genres.js";

describe("normalizeGenre", () => {
  it("returns the canonical genre for an exact match", () => {
    expect(normalizeGenre("Blues")).toBe("Blues");
  });

  it("matches case-insensitively and returns the canonical casing", () => {
    expect(normalizeGenre("blues")).toBe("Blues");
    expect(normalizeGenre("PUNK")).toBe("Punk");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(normalizeGenre("  Tribute  ")).toBe("Tribute");
  });

  it("returns null for blank, missing, or unrecognized input -- never a default genre", () => {
    expect(normalizeGenre("")).toBeNull();
    expect(normalizeGenre(null)).toBeNull();
    expect(normalizeGenre(undefined)).toBeNull();
    expect(normalizeGenre("Not A Real Genre")).toBeNull();
    expect(normalizeGenre("Indie Rock and roll")).toBeNull();
  });
});

describe("isValidGenre", () => {
  it("every canonical genre validates against itself", () => {
    for (const g of GENRES) expect(isValidGenre(g)).toBe(true);
  });

  it("rejects unrecognized and empty values", () => {
    expect(isValidGenre("")).toBe(false);
    expect(isValidGenre("Not A Real Genre")).toBe(false);
    expect(isValidGenre(null)).toBe(false);
  });
});

describe("genreColor / genreLabel", () => {
  it("looks up the real color for a known genre", () => {
    expect(genreColor("Indie Rock")).toBe(GENRE_COLORS["Indie Rock"]);
  });

  it("falls back to the neutral color, never a genre color, for no genre", () => {
    expect(genreColor(null)).toBe(NO_GENRE_COLOR);
    expect(genreColor(undefined)).toBe(NO_GENRE_COLOR);
    expect(Object.values(GENRE_COLORS)).not.toContain(NO_GENRE_COLOR);
  });

  it("labels no genre as the neutral marker, not blank or a substituted genre", () => {
    expect(genreLabel(null)).toBe("–");
    expect(genreLabel("")).toBe("–");
    expect(genreLabel("Ska")).toBe("Ska");
  });
});
