import { describe, it, expect } from "vitest";
import { normaliseNameForSearch, normalisePostcodeForSearch } from "./normalize.js";

describe("normaliseNameForSearch", () => {
  it("lowercases and collapses whitespace, same as strict normalisation", () => {
    expect(normaliseNameForSearch("Platform  Tavern")).toBe("platform tavern");
    expect(normaliseNameForSearch("PLATFORM TAVERN")).toBe("platform tavern");
  });

  it("strips a genuine leading 'The '", () => {
    expect(normaliseNameForSearch("The Platform Tavern")).toBe("platform tavern");
    expect(normaliseNameForSearch("THE Platform Tavern")).toBe("platform tavern");
  });

  it("does not mis-strip a name that merely starts with the letters 'the' as one word", () => {
    expect(normaliseNameForSearch("Theatre Royal")).toBe("theatre royal");
  });

  it("strips apostrophes without leaving a stray token", () => {
    expect(normaliseNameForSearch("Ronnie Scott's")).toBe("ronnie scotts");
  });

  it("treats comma/hyphen/slash punctuation as whitespace, without deleting words", () => {
    expect(normaliseNameForSearch("Platform Tavern,")).toBe("platform tavern");
    expect(normaliseNameForSearch("Platform Tavern - Southampton")).toBe("platform tavern southampton");
  });

  it("never deletes whole words merely because they don't match anything", () => {
    // This is a normalisation-only guarantee -- it must not collapse to
    // "platform tavern". Whether it's still findable as a candidate is
    // ranking.js's CONTAINS tier's job, tested separately.
    expect(normaliseNameForSearch("Platform Tavern Town Quay")).toBe("platform tavern town quay");
  });

  it("returns an empty string for empty/nullish input", () => {
    expect(normaliseNameForSearch("")).toBe("");
    expect(normaliseNameForSearch(null)).toBe("");
    expect(normaliseNameForSearch(undefined)).toBe("");
  });
});

describe("normalisePostcodeForSearch", () => {
  it("is whitespace- and case-insensitive", () => {
    expect(normalisePostcodeForSearch("so14 2ny")).toBe("SO142NY");
    expect(normalisePostcodeForSearch("SO14   2NY")).toBe("SO142NY");
    expect(normalisePostcodeForSearch("SO142NY")).toBe("SO142NY");
  });

  it("returns an empty string for empty/nullish input", () => {
    expect(normalisePostcodeForSearch("")).toBe("");
    expect(normalisePostcodeForSearch(null)).toBe("");
  });
});
