import { describe, it, expect } from "vitest";
import { formatResultMeta } from "./VenuePicker.jsx";

// VenuePicker.jsx itself is not rendered/mounted here -- this repo has no
// jsdom or @testing-library/react dependency (checked before writing this
// PR: package.json/devDependencies has neither), and this task explicitly
// says not to introduce a new testing framework solely for one component.
// All the logic with real correctness requirements (debounce/stale-search
// handling, ranking, stale-selection protection) already lives in, and is
// fully tested by, pickerState.test.js and ranking.test.js -- the
// component itself is a thin wrapper over those, verified by direct code
// review instead of an automated render test. formatResultMeta() is the
// one piece of presentation logic in the component file substantial
// enough to be worth a pure-function test, and it's a plain export, so it
// is tested here without needing to render anything.
describe("formatResultMeta", () => {
  it("renders the documented example exactly: 'Town Quay, Southampton · SO14 2NY'", () => {
    const result = { name: "Platform Tavern", city: "Southampton", address: "Town Quay", postcode: "SO14 2NY" };
    expect(formatResultMeta(result)).toBe("Town Quay, Southampton · SO14 2NY");
  });

  it("does not duplicate the city when the address already contains it", () => {
    const result = { name: "Fabric", city: "London", address: "77a Charterhouse St, London", postcode: "EC1M 6HJ" };
    expect(formatResultMeta(result)).toBe("77a Charterhouse St, London · EC1M 6HJ");
  });

  it("falls back to just city when address is absent (current search_entities contract)", () => {
    const result = { name: "Platform Tavern", city: "Southampton" };
    expect(formatResultMeta(result)).toBe("Southampton");
  });

  it("falls back to just city + postcode when address is absent but postcode is present", () => {
    const result = { name: "Platform Tavern", city: "Southampton", postcode: "SO14 2NY" };
    expect(formatResultMeta(result)).toBe("Southampton · SO14 2NY");
  });

  it("renders address alone when city is absent", () => {
    const result = { name: "Platform Tavern", address: "Town Quay" };
    expect(formatResultMeta(result)).toBe("Town Quay");
  });

  it("never renders a blank/placeholder line when nothing is available", () => {
    const result = { name: "Mystery Venue" };
    expect(formatResultMeta(result)).toBe("");
  });
});
