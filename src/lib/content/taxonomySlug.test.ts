import { describe, expect, it } from "vitest";
import { slugifyTaxonomy } from "./taxonomySlug";

describe("slugifyTaxonomy", () => {
  it("lowercases and dashes word separators", () => {
    expect(slugifyTaxonomy("Hello World")).toBe("hello-world");
  });

  it("strips decomposable Polish diacritics (NFD combining marks)", () => {
    // Ś→s, ą→a etc. decompose to base letter + combining mark, which is removed.
    expect(slugifyTaxonomy("Śląsk")).toBe("slask");
    expect(slugifyTaxonomy("Gęślą jaźń")).toBe("gesla-jazn");
  });

  it("transliterates the atomic 'ł' to 'l' instead of dropping it", () => {
    // U+0142 has no canonical decomposition, so NFD leaves it untouched and the
    // non-alphanumeric -> dash rule used to eat it: "Łódź" produced `odz`.
    //
    // DLACZEGO TA ASERCJA SIĘ ZMIENIŁA. Poprzednia wersja tego testu
    // („matching prior behavior") była testem CHARAKTERYZUJĄCYM: zapisywała
    // zachowanie inline'owego helpera z `admin.posts.$slug.tsx`, żeby jego
    // wyodrębnienie do tego pliku było neutralne. Dokumentowała więc defekt, a
    // nie decyzję produktową - `odz` nigdy nie było poprawnym adresem dla
    // „Łódź" w polskim serwisie, a adres wpisu jest trwały (linkowany
    // i indeksowany).
    //
    // Ten sam defekt naprawiono wcześniej w propozycji adresu profilu (commit
    // 592a99a), którego opis wprost wymienił `taxonomySlug` jako powierzchnię
    // nietkniętą. Mapa transliteracji mieszka teraz w `@/lib/text/strokeLetters`
    // i jest wspólna dla obu powierzchni.
    expect(slugifyTaxonomy("Łódź")).toBe("lodz");
    expect(slugifyTaxonomy("Miłość i Przyjaźń")).toBe("milosc-i-przyjazn");
    expect(slugifyTaxonomy("Paweł Wójcik")).toBe("pawel-wojcik");
  });

  it("transliterates other non-decomposable letters and ligatures", () => {
    // Katalog treści jest ogólnoeuropejski - te litery pojawiają się w nazwach
    // programów i regionów, nie tylko w polskich.
    expect(slugifyTaxonomy("Ærø")).toBe("aero");
    expect(slugifyTaxonomy("Straße")).toBe("strasse");
    expect(slugifyTaxonomy("Đakovo")).toBe("dakovo");
  });

  it("collapses any run of non-alphanumerics into a single dash", () => {
    expect(slugifyTaxonomy("a  --  b__c!!d")).toBe("a-b-c-d");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyTaxonomy("  -Hello-  ")).toBe("hello");
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugifyTaxonomy("!!!")).toBe("");
    expect(slugifyTaxonomy("")).toBe("");
  });

  it("caps the slug at 80 characters", () => {
    expect(slugifyTaxonomy("a".repeat(200))).toHaveLength(80);
  });
});
