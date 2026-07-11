import { describe, expect, it } from "vitest";
import { hasContentTargeting, matchesAdTargeting, parseAdTargeting } from "../types";

const ctx = (over: Partial<Parameters<typeof matchesAdTargeting>[1]> = {}) => ({
  categorySlugs: [] as string[],
  tagSlugs: [] as string[],
  language: "pl" as const,
  ...over,
});

describe("parseAdTargeting", () => {
  it("zwraca pusty targeting dla nie-obiektów i tablic", () => {
    expect(parseAdTargeting(null)).toEqual({});
    expect(parseAdTargeting("x")).toEqual({});
    expect(parseAdTargeting(42)).toEqual({});
    expect(parseAdTargeting(["pl"])).toEqual({});
  });

  it("odfiltrowuje śmieci i puste stringi", () => {
    expect(
      parseAdTargeting({
        categorySlugs: ["europa", "", 7, null],
        tagSlugs: [],
        languages: ["pl", "de", "en", 1],
      }),
    ).toEqual({ categorySlugs: ["europa"], languages: ["pl", "en"] });
  });

  it("ignoruje nieznane klucze", () => {
    expect(parseAdTargeting({ foo: "bar" })).toEqual({});
  });
});

describe("matchesAdTargeting", () => {
  it("pusty targeting pasuje wszędzie", () => {
    expect(matchesAdTargeting({}, ctx())).toBe(true);
    expect(matchesAdTargeting({}, ctx({ language: "en" }))).toBe(true);
  });

  it("languages zawęża do wersji językowej", () => {
    expect(matchesAdTargeting({ languages: ["pl"] }, ctx({ language: "pl" }))).toBe(true);
    expect(matchesAdTargeting({ languages: ["pl"] }, ctx({ language: "en" }))).toBe(false);
  });

  it("kategorie i tagi działają w semantyce OR", () => {
    const targeting = { categorySlugs: ["europa"], tagSlugs: ["ai"] };
    expect(matchesAdTargeting(targeting, ctx({ categorySlugs: ["europa"] }))).toBe(true);
    expect(matchesAdTargeting(targeting, ctx({ tagSlugs: ["ai"] }))).toBe(true);
    expect(matchesAdTargeting(targeting, ctx({ categorySlugs: ["sport"], tagSlugs: ["eu"] }))).toBe(
      false,
    );
  });

  it("targeting treściowy nie pasuje do kontekstu bez treści", () => {
    expect(matchesAdTargeting({ categorySlugs: ["europa"] }, ctx())).toBe(false);
  });

  it("język i treść muszą pasować jednocześnie", () => {
    const targeting = { categorySlugs: ["europa"], languages: ["en"] as const };
    expect(
      matchesAdTargeting(
        { ...targeting, languages: [...targeting.languages] },
        ctx({ categorySlugs: ["europa"], language: "pl" }),
      ),
    ).toBe(false);
  });
});

describe("hasContentTargeting", () => {
  it("wykrywa targeting treściowy", () => {
    expect(hasContentTargeting({})).toBe(false);
    expect(hasContentTargeting({ languages: ["pl"] })).toBe(false);
    expect(hasContentTargeting({ tagSlugs: ["ai"] })).toBe(true);
  });
});
