import { describe, expect, it } from "vitest";
import { normalizeFontFamilyCssValue } from "./fontFamily";

describe("normalizeFontFamilyCssValue", () => {
  it("maps sans aliases to the CSS generic sans family", () => {
    expect(normalizeFontFamilyCssValue("sans")).toBe("sans-serif");
    expect(normalizeFontFamilyCssValue("Sans")).toBe("sans-serif");
  });
});
