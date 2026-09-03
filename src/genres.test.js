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

  // O, Q and R below were written under PR #26, when Indie/Folk, Heavy
  // Metal and Musical Theatre were all deliberately unrecognised. The
  // taxonomy-expansion PR that followed intentionally supersedes exactly
  // these three (Indie/Folk and Heavy Metal via new aliases, Musical
  // Theatre by becoming canonical itself) -- updated in place rather than
  // left stale and wrong. See "taxonomy expansion" and "new aliases"
  // below for the full dedicated coverage.
  it("O (superseded by the taxonomy expansion): 'Indie/Folk' now resolves via alias to 'Indie Folk'", () => {
    expect(normalizeGenre("Indie/Folk")).toBe("Indie Folk");
  });

  it("P: 'Rock n Roll, Blues & Pop' is still not aliased and remains null (ambiguous compound description)", () => {
    expect(normalizeGenre("Rock n Roll, Blues & Pop")).toBeNull();
  });

  it("Q (superseded by the taxonomy expansion): 'Heavy Metal' now resolves via alias to 'Metal'", () => {
    expect(normalizeGenre("Heavy Metal")).toBe("Metal");
  });

  it("R (superseded by the taxonomy expansion): 'Musical Theatre' is now itself a canonical genre", () => {
    expect(normalizeGenre("Musical Theatre")).toBe("Musical Theatre");
  });

  it("never restores the old unknown-genre-defaults-to-Indie-Rock behaviour", () => {
    expect(normalizeGenre("Not A Real Genre")).not.toBe("Indie Rock");
    expect(normalizeGenre("")).not.toBe("Indie Rock");
    expect(normalizeGenre("Rock n Roll, Blues & Pop")).not.toBe("Indie Rock");
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

  it("the 22 lost-genre values total exactly 122 rows, matching the original investigation", () => {
    const total = LOST_MITC_GENRES.reduce((sum, { count }) => sum + count, 0);
    expect(total).toBe(122);
  });

  // Superseded by the taxonomy-expansion PR: with the full current
  // taxonomy (PR #26's 4 aliases + this PR's 14 new canonical genres + 3
  // new aliases), 16 of the original 22 lost-genre values now resolve --
  // not just the original 3 PR #26 covered.
  it("with the full current taxonomy, 16 of the 22 values now resolve -- 102 of 122 recovered, 20 remain unresolved", () => {
    const recovered = LOST_MITC_GENRES.filter(({ source }) => normalizeGenre(source) !== null);
    const recoveredCount = recovered.reduce((sum, { count }) => sum + count, 0);
    const remainingCount = 122 - recoveredCount;

    expect(recovered.map((r) => r.source).sort()).toEqual([
      "A Capella", "Argentine Tango", "Brass Band (wind/symphony)", "Choir", "Darkwave",
      "Easy Listening", "Heavy Metal", "Hip Hop", "Indie/Folk", "Musical Theatre",
      "Pipe Band", "Protest Songs", "Rhythm & Blues", "Samba Reggae", "Sea Shanties", "Singer Songwriter",
    ]);
    expect(recoveredCount).toBe(102);
    expect(remainingCount).toBe(20);
  });

  it("the remaining 6 lost-genre values are still deliberately unresolved -- ambiguous/instrument/context descriptors, not genres", () => {
    const stillUnresolved = LOST_MITC_GENRES.filter(({ source }) => normalizeGenre(source) === null);
    expect(stillUnresolved.map((r) => r.source).sort()).toEqual([
      "Busker", "Piano", "Rock n Roll, Blues & Pop", "Samba Rock & Drums", "Ukulele", "Youth",
    ]);
    const stillUnresolvedCount = stillUnresolved.reduce((sum, { count }) => sum + count, 0);
    expect(stillUnresolvedCount).toBe(20);
  });
});

// Second-round MITC impact analysis (this PR): the 77 rows that remained
// unresolved after PR #26's alias fix plus the first 45-row production
// repair. Verifies the exact 57-recovered/20-remaining arithmetic this
// PR's own investigation predicted, rather than assuming it.
describe("Smart Import MITC batch impact round 2 -- taxonomy expansion recovery arithmetic (analysis only)", () => {
  const UNRESOLVED_77 = [
    { source: "Indie/Folk", count: 19 },
    { source: "Rock n Roll, Blues & Pop", count: 10 },
    { source: "Heavy Metal", count: 8 },
    { source: "Choir", count: 6 },
    { source: "Musical Theatre", count: 6 },
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

  it("the 19 currently-unresolved values total exactly 77 rows", () => {
    const total = UNRESOLVED_77.reduce((sum, { count }) => sum + count, 0);
    expect(total).toBe(77);
  });

  it("exactly the 13 intended values recover -- 57 of 77 recovered", () => {
    const recovered = UNRESOLVED_77.filter(({ source }) => normalizeGenre(source) !== null);
    const recoveredCount = recovered.reduce((sum, { count }) => sum + count, 0);

    expect(recovered.map((r) => r.source).sort()).toEqual([
      "A Capella", "Argentine Tango", "Brass Band (wind/symphony)", "Choir", "Darkwave",
      "Easy Listening", "Heavy Metal", "Indie/Folk", "Musical Theatre", "Pipe Band",
      "Protest Songs", "Samba Reggae", "Sea Shanties",
    ]);
    expect(recoveredCount).toBe(57);
  });

  it("exactly the 6 deliberately-unresolved values remain -- 20 of 77 still unresolved", () => {
    const stillUnresolved = UNRESOLVED_77.filter(({ source }) => normalizeGenre(source) === null);
    const stillUnresolvedCount = stillUnresolved.reduce((sum, { count }) => sum + count, 0);

    expect(stillUnresolved.map((r) => r.source).sort()).toEqual([
      "Busker", "Piano", "Rock n Roll, Blues & Pop", "Samba Rock & Drums", "Ukulele", "Youth",
    ]);
    expect(stillUnresolvedCount).toBe(20);
  });

  it("each recovered value maps to exactly its expected canonical genre", () => {
    expect(normalizeGenre("Indie/Folk")).toBe("Indie Folk");
    expect(normalizeGenre("Heavy Metal")).toBe("Metal");
    expect(normalizeGenre("Choir")).toBe("Choir");
    expect(normalizeGenre("Musical Theatre")).toBe("Musical Theatre");
    expect(normalizeGenre("Brass Band (wind/symphony)")).toBe("Brass Band");
    expect(normalizeGenre("Easy Listening")).toBe("Easy Listening");
    expect(normalizeGenre("A Capella")).toBe("A Capella");
    expect(normalizeGenre("Protest Songs")).toBe("Protest Songs");
    expect(normalizeGenre("Samba Reggae")).toBe("Samba Reggae");
    expect(normalizeGenre("Sea Shanties")).toBe("Sea Shanties");
    expect(normalizeGenre("Argentine Tango")).toBe("Argentine Tango");
    expect(normalizeGenre("Darkwave")).toBe("Darkwave");
    expect(normalizeGenre("Pipe Band")).toBe("Pipe Band");
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

// Taxonomy expansion: 14 new canonical genres surfaced by the Music in the
// City / Portsmouth-PO source data, added additively alongside the
// existing 51 (see genres.js's own header comment on GENRES).
describe("normalizeGenre -- taxonomy expansion (14 new canonical genres)", () => {
  const NEW_CANONICAL_GENRES = [
    "A Capella", "Alternative Rock", "Argentine Tango", "Brass Band", "Choir",
    "Darkwave", "Easy Listening", "Indie", "Indie Folk", "Musical Theatre",
    "Pipe Band", "Protest Songs", "Samba Reggae", "Sea Shanties",
  ];

  it("each of the 14 new canonical genres resolves to itself", () => {
    for (const g of NEW_CANONICAL_GENRES) expect(normalizeGenre(g)).toBe(g);
  });

  it("each of the 14 new canonical genres is present in GENRES", () => {
    for (const g of NEW_CANONICAL_GENRES) expect(GENRES).toContain(g);
  });

  // Verified directly against origin/main rather than assumed: the
  // pre-expansion GENRES array actually has 53 entries, not 51 -- so
  // 53 + 14 new = 67, not 65. See this PR's report for the reconciliation.
  it("the canonical genre list is now exactly 67 entries (53 pre-existing + 14 new)", () => {
    expect(GENRES).toHaveLength(67);
  });

  it("the canonical genre list has no duplicates", () => {
    expect(new Set(GENRES).size).toBe(GENRES.length);
  });

  it("all 53 pre-existing canonical genres are still present and unchanged", () => {
    const PRE_EXISTING_53 = [
      "Acoustic","Afrobeat","Alternative","Americana","Bluegrass","Blues","Blues Rock",
      "Britpop","Celtic","Classic Rock","Classical","Comedy","Country","Covers","Dance",
      "Electronic","Experimental","Folk","Folk Rock","Funk","Funk Rock","Fusion",
      "Garage Rock","Gospel","Grunge","Hard Rock","Hardcore","Hip-Hop","Indie Rock",
      "Jazz","Jazz-Funk","Latin","Metal","Metalcore","New Wave","Original Music",
      "Pop","Progressive Rock","Psychedelic","Punk","R&B","Reggae","Rock","Shoegaze",
      "Singer-Songwriter","Ska","Ska Punk","Soul","Southern Rock","Spoken Word",
      "Tribute","World Music","Other",
    ];
    expect(PRE_EXISTING_53).toHaveLength(53);
    for (const g of PRE_EXISTING_53) {
      expect(GENRES).toContain(g);
      expect(normalizeGenre(g)).toBe(g);
    }
  });
});

describe("normalizeGenre -- new aliases (Heavy Metal / Indie Folk / Brass Band)", () => {
  it("'Heavy Metal' resolves to the canonical 'Metal'", () => {
    expect(normalizeGenre("Heavy Metal")).toBe("Metal");
  });

  it("case-insensitive and whitespace-padded 'Heavy Metal' variants resolve to 'Metal'", () => {
    expect(normalizeGenre("heavy metal")).toBe("Metal");
    expect(normalizeGenre(" HEAVY METAL ")).toBe("Metal");
  });

  it("'Indie/Folk' resolves to the canonical 'Indie Folk'", () => {
    expect(normalizeGenre("Indie/Folk")).toBe("Indie Folk");
  });

  it("case-insensitive and whitespace-padded 'Indie/Folk' variants resolve to 'Indie Folk'", () => {
    expect(normalizeGenre("indie/folk")).toBe("Indie Folk");
    expect(normalizeGenre(" INDIE/FOLK ")).toBe("Indie Folk");
  });

  it("'Brass Band (wind/symphony)' resolves to the canonical 'Brass Band'", () => {
    expect(normalizeGenre("Brass Band (wind/symphony)")).toBe("Brass Band");
  });

  it("case-insensitive and whitespace-padded 'Brass Band (wind/symphony)' variants resolve to 'Brass Band'", () => {
    expect(normalizeGenre("BRASS BAND (WIND/SYMPHONY)")).toBe("Brass Band");
    expect(normalizeGenre(" brass band (wind/symphony) ")).toBe("Brass Band");
  });
});

describe("normalizeGenre -- regression: existing PR #26 aliases and canonical forms unchanged", () => {
  it("PR #26 aliases still work unchanged", () => {
    expect(normalizeGenre("Singer Songwriter")).toBe("Singer-Songwriter");
    expect(normalizeGenre("Hip Hop")).toBe("Hip-Hop");
    expect(normalizeGenre("Rhythm & Blues")).toBe("R&B");
    expect(normalizeGenre("Rhythm and Blues")).toBe("R&B");
  });

  it("canonical forms involved in any alias still resolve to themselves, unaffected", () => {
    expect(normalizeGenre("Singer-Songwriter")).toBe("Singer-Songwriter");
    expect(normalizeGenre("Hip-Hop")).toBe("Hip-Hop");
    expect(normalizeGenre("R&B")).toBe("R&B");
    expect(normalizeGenre("Metal")).toBe("Metal");
    expect(normalizeGenre("Blues")).toBe("Blues");
  });
});

describe("normalizeGenre -- values that must remain deliberately unresolved", () => {
  it("Busker remains null (performance context, not a genre)", () => {
    expect(normalizeGenre("Busker")).toBeNull();
  });

  it("Piano remains null (instrument descriptor, not a genre)", () => {
    expect(normalizeGenre("Piano")).toBeNull();
  });

  it("'Rock n Roll, Blues & Pop' remains null (ambiguous compound description)", () => {
    expect(normalizeGenre("Rock n Roll, Blues & Pop")).toBeNull();
  });

  it("'Samba Rock & Drums' remains null (ambiguous compound/performance description)", () => {
    expect(normalizeGenre("Samba Rock & Drums")).toBeNull();
  });

  it("Ukulele remains null (instrument descriptor, not a genre)", () => {
    expect(normalizeGenre("Ukulele")).toBeNull();
  });

  it("Youth remains null (demographic/performer descriptor, not a genre)", () => {
    expect(normalizeGenre("Youth")).toBeNull();
  });

  it("blank and unknown genres remain null", () => {
    expect(normalizeGenre("")).toBeNull();
    expect(normalizeGenre("Not A Real Genre")).toBeNull();
  });

  it("never restores the old unknown-genre-defaults-to-Indie-Rock behaviour", () => {
    expect(normalizeGenre("Busker")).not.toBe("Indie Rock");
    expect(normalizeGenre("Not A Real Genre")).not.toBe("Indie Rock");
  });
});

describe("genreColor -- colour coverage for the expanded taxonomy", () => {
  it("every one of the 65 canonical genres resolves to a valid, non-neutral colour", () => {
    for (const g of GENRES) {
      const color = genreColor(g);
      expect(color).toBeTruthy();
      expect(color).not.toBe(NO_GENRE_COLOR);
      expect(GENRE_COLORS[g]).toBe(color);
    }
  });

  it("NULL/unrecognised genre still resolves to the neutral colour", () => {
    expect(genreColor(null)).toBe(NO_GENRE_COLOR);
    expect(genreColor("Not A Real Genre")).toBe(NO_GENRE_COLOR);
  });

  it("existing genre colours are unchanged by this expansion", () => {
    expect(GENRE_COLORS["Blues"]).toBe("#1a78c2");
    expect(GENRE_COLORS["Indie Rock"]).toBe("#e8203a");
    expect(GENRE_COLORS["R&B"]).toBe("#ce93d8");
    expect(GENRE_COLORS["Hip-Hop"]).toBe("#ff9f1c");
    expect(GENRE_COLORS["Singer-Songwriter"]).toBe("#a1887f");
    expect(GENRE_COLORS["Metal"]).toBe("#ff595e");
    expect(GENRE_COLORS["Other"]).toBe("#888888");
  });

  it("each of the 14 new canonical genres has its own explicit, non-neutral colour entry", () => {
    const NEW_CANONICAL_GENRES = [
      "A Capella", "Alternative Rock", "Argentine Tango", "Brass Band", "Choir",
      "Darkwave", "Easy Listening", "Indie", "Indie Folk", "Musical Theatre",
      "Pipe Band", "Protest Songs", "Samba Reggae", "Sea Shanties",
    ];
    for (const g of NEW_CANONICAL_GENRES) {
      expect(GENRE_COLORS[g]).toBeTruthy();
      expect(GENRE_COLORS[g]).not.toBe(NO_GENRE_COLOR);
    }
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
