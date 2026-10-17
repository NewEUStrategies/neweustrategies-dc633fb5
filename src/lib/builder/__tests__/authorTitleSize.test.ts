import { describe, expect, it } from "vitest";
import { authorSizeFromTitle, resolveAuthorDisplay } from "../authorDisplay";
describe("CMS author title sizing", () => {
  it.each(["pl", "en"] as const)("uses title minus 2 px in %s", (lang) => {
    expect(resolveAuthorDisplay({ authorSizePx: 16 }, lang).relativeToTitle).toBe(true);
    expect(authorSizeFromTitle(16)).toBe(14);
    expect(authorSizeFromTitle(26)).toBe(24);
    expect(authorSizeFromTitle(18.5)).toBe(16.5);
  });
  it("persists fixed-size mode from the CMS", () => {
    const value = resolveAuthorDisplay(
      { authorSizeRelativeToTitle: false, authorSizePx: 13 },
      "pl",
    );
    expect(value.relativeToTitle).toBe(false);
    expect(value.nameSizePx).toBe(13);
  });
});
