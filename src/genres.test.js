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

// Conservative genre aliases (Smart Import / Music in the City genre-loss
// investigation): a small, explicit set of alternate spellings of genres
// that are ALREADY canonical -- never a new genre, never fuzzy/substring
// matching. Regression coverage for the exact cases identified in that
// investigation.
describe("normalizeGenre -- conservative genre aliases", () => {
  it("A: 'Singer Songwriter' resolves to the canonical 'Singer-Songwriter'", () => {
    expect(normalizeGenre("Singer Songwriter")).toBe("Singer-Songwriter");
  });

  it("B: case-insensitive 'SINGER SONGWRITER' / 'singer songwriter' resolves to 'Singer-Songwriter'", () => {
    expect(normalizeGenre("SINGER SONGWRITER")).toBe("Singer-Songwriter");
    expect(normalizeGenre("singer songwriter")).toBe("Singer-Songwriter");
  });

  it("C: surrounding whitespace ' Singer Songwriter ' resolves to 'Singer-Songwriter'", () => {
    expect(normalizeGenre(" Singer Songwriter ")).toBe("Singer-Songwriter");
  });

  it("D: 'Hip Hop' resolves to the canonical 'Hip-Hop'", () => {
    expect(normalizeGenre("Hip Hop")).toBe("Hip-Hop");
  });

  it("E: case-insensitive 'HIP HOP' / 'hip hop' resolves to 'Hip-Hop'", () => {
    expect(normalizeGenre("HIP HOP")).toBe("Hip-Hop");
    expect(normalizeGenre("hip hop")).toBe("Hip-Hop");
  });

  it("F: 'Rhythm & Blues' resolves to the canonical 'R&B'", () => {
    expect(normalizeGenre("Rhythm & Blues")).toBe("R&B");
  });

  it("G: 'Rhythm and Blues' resolves to the canonical 'R&B'", () => {
    expect(normalizeGenre("Rhythm and Blues")).toBe("R&B");
  });

  it("H: case-insensitive variants of both Rhythm & Blues forms resolve to 'R&B'", () => {
    expect(normalizeGenre("rhythm & blues")).toBe("R&B");
    expect(normalizeGenre("RHYTHM AND BLUES")).toBe("R&B");
    expect(normalizeGenre("Rhythm and blues")).toBe("R&B");
    expect(normalizeGenre(" rhythm & blues ")).toBe("R&B");
  });

  it("I: the canonical 'R&B' still resolves to itself, unaffected by the new aliases", () => {
    expect(normalizeGenre("R&B")).toBe("R&B");
    expect(normalizeGenre("r&b")).toBe("R&B");
  });

  it("J: the canonical 'Singer-Songwriter' still resolves to itself, unaffected", () => {
    expect(normalizeGenre("Singer-Songwriter")).toBe("Singer-Songwriter");
  });

  it("K: the canonical 'Hip-Hop' still resolves to itself, unaffected", () => {
    expect(normalizeGenre("Hip-Hop")).toBe("Hip-Hop");
  });

  it("L: 'Blues' remains 'Blues' and is NOT converted to 'R&B' by the new alias", () => {
    expect(normalizeGenre("Blues")).toBe("Blues");
    expect(normalizeGenre("blues")).not.toBe("R&B");
  });

  it("M: an unknown genre still resolves to null, never a default", () => {
    expect(normalizeGenre("Not A Real Genre")).toBeNull();
  });

  it("N: a blank genre still resolves to null", () => {
    expect(normalizeGenre("")).toBeNull();
    expect(normalizeGenre("   ")).toBeNull();
  });

  it("O: 'Indie/Folk' is not aliased and remains null", () => {
    expect(normalizeGenre("Indie/Folk")).toBeNull();
  });

  it("P: 'Rock n Roll, Blues & Pop' is not aliased and remains null", () => {
    expect(normalizeGenre("Rock n Roll, Blues & Pop")).toBeNull();
  });

  it("Q: 'Heavy Metal' is not aliased and remains null", () => {
    expect(normalizeGenre("Heavy Metal")).toBeNull();
  });

  it("R: 'Musical Theatre' is not aliased and remains null", () => {
    expect(normalizeGenre("Musical Theatre")).toBeNull();
  });

  it("never restores the old unknown-genre-defaults-to-Indie-Rock behaviour", () => {
    expect(normalizeGenre("Not A Real Genre")).not.toBe("Indie Rock");
    expect(normalizeGenre("")).not.toBe("Indie Rock");
    expect(normalizeGenre("Indie/Folk")).not.toBe("Indie Rock");
  });
});

// Analysis-only regression coverage (no Supabase read/write): reproduces
// the exact 22 distinct "lost" source genre values and row counts retained
// from the Music in the City investigation (298-row batch; 122 rows had a
// non-blank source genre that resolved to null before this change), and
// confirms the alias layer recovers exactly the three intended values --
// no more, no less -- with the exact arithmetic the investigation predicted.
describe("Smart Import MITC batch impact -- alias recovery arithmetic (analysis only)", () => {
  const LOST_MITC_GENRES = [
    { source: "Singer Songwriter", count: 30 },
    { source: "Indie/Folk", count: 19 },
    { source: "Rock n Roll, Blues & Pop", count: 10 },
    { source: "Hip Hop", count: 9 },
    { source: "Heavy Metal", count: 8 },
    { source: "Choir", count: 6 },
    { source: "Musical Theatre", count: 6 },
    { source: "Rhythm & Blues", count: 6 },
    { source: "Brass Band (wind/symphony)", count: 4 },
    { source: "Easy Listening", count: 3 },
    { source: "Ukulele", count: 3 },
    { source: "Youth", count: 3 },
    { source: "A Capella", count: 2 },
    { source: "Busker", count: 2 },
    { source: "Protest Songs", count: 2 },
    { source: "Samba Reggae", count: 2 },
    { source: "Sea Shanties", count: 2 },
    { source: "Argentine Tango", count: 1 },
    { source: "Darkwave", count: 1 },
    { source: "Piano", count: 1 },
    { source: "Pipe Band", count: 1 },
    { source: "Samba Rock & Drums", count: 1 },
  ];

  it("the 22 lost-genre values total exactly 122 rows, matching the investigation", () => {
    const total = LOST_MITC_GENRES.reduce((sum, { count }) => sum + count, 0);
    expect(total).toBe(122);
  });

  it("only Singer Songwriter, Hip Hop, and Rhythm & Blues newly resolve -- 45 of 122 recovered, 77 remain unresolved", () => {
    const recovered = LOST_MITC_GENRES.filter(({ source }) => normalizeGenre(source) !== null);
    const recoveredCount = recovered.reduce((sum, { count }) => sum + count, 0);
    const remainingCount = 122 - recoveredCount;

    expect(recovered.map((r) => r.source).sort()).toEqual(["Hip Hop", "Rhythm & Blues", "Singer Songwriter"]);
    expect(recoveredCount).toBe(45);
    expect(remainingCount).toBe(77);
  });

  it("every other lost-genre value still resolves to null -- no accidental recognition", () => {
    const stillUnresolved = LOST_MITC_GENRES.filter(
      ({ source }) => !["Singer Songwriter", "Hip Hop", "Rhythm & Blues"].includes(source)
    );
    for (const { source } of stillUnresolved) {
      expect(normalizeGenre(source)).toBeNull();
    }
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
