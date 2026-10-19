// Slug importu WordPressa: nowa postać (transliteracja liter z kreską) i stara
// postać, pod którą żyją adresy nadane przed 2026-10-19.
//
// CO TEN PLIK DOWODZI:
//   * `slugify` zamienia ł/Ł (i pozostałe litery bez rozkładu NFD) na ASCII,
//     zamiast na dywiz - tak samo jak slug taksonomii,
//   * `legacySlugify` odtwarza DOKŁADNIE dawne, okaleczone adresy - importery
//     szukają nimi istniejących wierszy, więc rozjazd = duplikat przy imporcie,
//   * dla wejścia BEZ takich liter obie postacie są identyczne - zmiana nie
//     dotyka adresów, których defekt nie dotyczył (i nie wymaga drugiego odczytu).
import { describe, expect, it } from "vitest";
import { slugifyTaxonomy } from "@/lib/content/taxonomySlug";
import { legacySlugify, slugify } from "@/lib/wp-import/slug";

describe("slugify (nowe adresy)", () => {
  it.each([
    ["Łódź Śródmieście", "lodz-srodmiescie"],
    ["Tytuł: podtytuł, cz. 2!", "tytul-podtytul-cz-2"],
    ["Zażółć gęślą jaźń", "zazolc-gesla-jazn"],
    ["Żółw", "zolw"],
    ["ŁUKASZ", "lukasz"],
  ])("transliteruje polskie ł: %s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it.each([
    ["Straße", "strasse"],
    ["Ærø", "aero"],
    ["Đakovo", "dakovo"],
    ["Œuvre", "oeuvre"],
    ["Søren", "soren"],
  ])("transliteruje litery i ligatury spoza NFD: %s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("daje ten sam rdzeń co slug taksonomii (jedna mapa transliteracji)", () => {
    for (const name of ["Łódź", "Miłość i Przyjaźń", "Paweł Wójcik", "Ærø", "Straße"]) {
      expect(slugify(name)).toBe(slugifyTaxonomy(name));
    }
  });

  it("jest idempotentny - ponowne przepuszczenie sluga go nie zmienia", () => {
    for (const input of ["Tytuł: podtytuł", "Straße 2.0", "---a  b---"]) {
      expect(slugify(slugify(input))).toBe(slugify(input));
    }
  });

  it("mieści wynik w 120 znakach także po rozwinięciu ligatur", () => {
    expect(slugify("ß".repeat(100))).toBe("s".repeat(120));
    expect(slugify("ł".repeat(200))).toHaveLength(120);
  });
});

describe("legacySlugify (adresy sprzed transliteracji)", () => {
  it.each([
    ["Łódź Śródmieście", "odz-srodmiescie"],
    ["Tytuł: podtytuł, cz. 2!", "tytu-podtytu-cz-2"],
    ["Zażółć gęślą jaźń", "zazo-c-gesla-jazn"],
    ["Żółw", "zo-w"],
    ["ł", ""],
  ])("odtwarza dawny adres: %s -> %s", (input, expected) => {
    expect(legacySlugify(input)).toBe(expected);
  });
});

describe("obie postacie", () => {
  it.each([
    "Café très",
    "gęślą jaźń",
    "Rok 2026",
    "Wersja 2.0, wydanie III",
    "a    b",
    "---brzegi---",
    "Привет мир",
    "moj-wpis",
    "a".repeat(200),
  ])("są równe dla wejścia bez liter z kreską: %s", (input) => {
    expect(slugify(input)).toBe(legacySlugify(input));
  });

  it.each(["ł", "Ł", "ø", "đ", "ß", "æ", "œ"])(
    "różnią się dla %s - stara postać robiła z niej dywiz",
    (letter) => {
      expect(legacySlugify(`a${letter}b`)).toBe("a-b");
      expect(slugify(`a${letter}b`)).toMatch(/^a[a-z]+b$/);
    },
  );
});
