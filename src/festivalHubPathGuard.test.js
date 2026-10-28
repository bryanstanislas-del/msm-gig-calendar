import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { festivalHubGuardAction, FESTIVAL_HUB_DOCUMENT } from "./festivalHubPathGuard.js";

const loc = (pathname, search = "", hash = "") => ({ pathname, search, hash });

describe("festivalHubGuardAction", () => {
  it("leaves every non-hub calendar path alone", () => {
    for (const p of ["/", "/claim", "/artist/some-band", "/venue/x", "/festival/some-fest", "/festival", "/festivals",
      "/festival-hubs", "/festival-hub-x", "/gig/abc", "/api/og", "/index.html", "/x/festival-hub", "/FESTIVAL-HUB"]) {
      expect(festivalHubGuardAction(loc(p))).toBeNull();
    }
    expect(festivalHubGuardAction(null)).toBeNull();
  });
  it("sends hub paths to the isolated hub document, keeping query and hash", () => {
    expect(festivalHubGuardAction(loc("/festival-hub"))).toBe(FESTIVAL_HUB_DOCUMENT);
    expect(festivalHubGuardAction(loc("/festival-hub/"))).toBe(FESTIVAL_HUB_DOCUMENT);
    expect(festivalHubGuardAction(loc("/festival-hub/anything", "?a=1", "#festival=demo-highland")))
      .toBe("/festival-hub/index.html?a=1#festival=demo-highland");
  });
  it("halts instead of looping when already on the hub document", () => {
    expect(festivalHubGuardAction(loc(FESTIVAL_HUB_DOCUMENT))).toBe("halt");
  });
});

describe("calendar entry wiring", () => {
  it("imports the guard before anything else in src/main.jsx", () => {
    const imports = readFileSync(new URL("./main.jsx", import.meta.url), "utf8")
      .split("\n").filter((l) => l.startsWith("import "));
    expect(imports[0]).toBe("import './festivalHubPathGuard.js'");
  });
  it("guard module has no imports of its own", () => {
    expect(readFileSync(new URL("./festivalHubPathGuard.js", import.meta.url), "utf8")).not.toMatch(/^\s*import\s/m);
  });
});
