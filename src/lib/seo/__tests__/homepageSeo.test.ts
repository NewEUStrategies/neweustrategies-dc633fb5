import { describe, expect, it } from "vitest";
import { resolveHomepageSeoText } from "@/lib/seo/homepageSeo";

const BRAND = { title: "New European Strategies", description: "Opis serwisu." };

describe("resolveHomepageSeoText - jedna reguła dla `/` i podglądów panelu", () => {
  it("własny tytuł SEO strony idzie dosłownie, bez sufiksu", () => {
    expect(resolveHomepageSeoText({ seo_title_pl: "Własny tytuł" }, "pl", BRAND)).toMatchObject({
      title: "Własny tytuł",
      titleIsOverride: true,
    });
  });

  it("bez nadpisania - tytuł SERWISU, nie tytuł treści strony", () => {
    // `title_pl` („Strona główna") nie jest nawet częścią wejścia - wiersz
    // strony nie ma jak przemianować serwisu.
    const out = resolveHomepageSeoText({ seo_title_pl: "   ", excerpt_pl: null }, "pl", BRAND);
    expect(out).toEqual({
      title: BRAND.title,
      description: BRAND.description,
      titleIsOverride: false,
    });
  });

  it("nadpisanie NIE przechodzi między językami, zajawka przechodzi", () => {
    const out = resolveHomepageSeoText(
      { seo_title_pl: "Tylko PL", excerpt_pl: "Zajawka <b>polska</b> strony głównej." },
      "en",
      BRAND,
    );
    expect(out.title).toBe(BRAND.title);
    expect(out.description).toBe("Zajawka polska strony głównej.");
  });

  it("opis: pole SEO > zajawka > opis serwisu", () => {
    expect(
      resolveHomepageSeoText({ seo_description_pl: "Opis SEO", excerpt_pl: "Zajawka" }, "pl", BRAND)
        .description,
    ).toBe("Opis SEO");
    expect(resolveHomepageSeoText({ excerpt_pl: "Zajawka" }, "pl", BRAND).description).toBe(
      "Zajawka",
    );
  });

  it("bez strony (tryb wpisów, render zdegradowany) - wartości serwisu", () => {
    expect(resolveHomepageSeoText(null, "pl", BRAND)).toEqual({
      title: BRAND.title,
      description: BRAND.description,
      titleIsOverride: false,
    });
  });
});
