// Logotyp poziomy chrome'u (src/lib/brand/headerLogo.ts) - wspólny dla paska
// mobilnego `Header.tsx` i paska czytania `share/ReadingHeader.tsx`.
//
// CO TU MA DOWÓD
//  1. PEŁNA KOLEJNOŚĆ łańcucha dla obu motywów. Dla każdej pozycji wypełniamy
//     ją ORAZ wszystkie słabsze, a silniejsze zostawiamy puste - wygrać musi
//     ta pozycja. Zła kolejność nie wywraca renderu, tylko daje ciemny znak na
//     ciemnym tle (albo odwrotnie), czego żaden zrzut nie łapie.
//  2. FORMA ADRESU: kanoniczny `${PUBLIC_MEDIA_ORIGIN}/media/...` wychodzi
//     względny (`/media/...`), każdy inny adres bez zmian. Właśnie ta forma
//     decyduje o kluczu auto-preloadu Reacta (bez `srcSet` kluczem jest surowy
//     `src`): dwa paski z różną formą dawały dwa preloady logo na każdym wpisie.
//     Dowód na realnym SSR obu pasków: `share/__tests__/chromeLogoPreload.test.tsx`.
//  3. Brak logotypu (brak obiektu, puste napisy, wartości innego typu) = `""`,
//     na którym paski przechodzą na wordmark tekstowy.
import { describe, expect, it } from "vitest";
import { headerLogoSrc, type HeaderLogoVariants } from "@/lib/brand/headerLogo";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";

type Field = keyof Required<HeaderLogoVariants>;

const url = (field: Field) => `https://cdn.example.com/logo-${field.replace("_", "-")}.svg`;

/** Pozycja `index` i wszystkie słabsze wypełnione, silniejsze puste. */
function fillFrom(chain: readonly Field[], index: number): HeaderLogoVariants {
  const logo: HeaderLogoVariants = {};
  for (const field of chain.slice(index)) logo[field] = url(field);
  return logo;
}

const CHAINS: ReadonlyArray<{ motyw: "jasny" | "ciemny"; isDark: boolean; chain: Field[] }> = [
  { motyw: "jasny", isDark: false, chain: ["mobile", "main", "mobile_dark", "main_dark"] },
  { motyw: "ciemny", isDark: true, chain: ["mobile_dark", "main_dark", "mobile", "main"] },
];

describe("headerLogoSrc - kolejność łańcucha", () => {
  for (const { motyw, isDark, chain } of CHAINS) {
    it.each(chain.map((field, index) => ({ field, index })))(
      `${motyw}: pozycja $index ($field) wygrywa ze wszystkimi słabszymi`,
      ({ field, index }) => {
        expect(headerLogoSrc(fillFrom(chain, index), isDark)).toBe(url(field));
      },
    );
  }

  it("pusty napis na silniejszej pozycji nie wygrywa", () => {
    expect(headerLogoSrc({ mobile: "", main: url("main") }, false)).toBe(url("main"));
    expect(headerLogoSrc({ mobile_dark: "", main_dark: url("main_dark") }, true)).toBe(
      url("main_dark"),
    );
  });

  it("wartość innego typu (uszkodzony wiersz ustawień) jest pomijana, a nie wywraca SSR", () => {
    const corrupt = { mobile: 42, main: null, mobile_dark: url("mobile_dark") };
    expect(headerLogoSrc(corrupt as unknown as HeaderLogoVariants, false)).toBe(url("mobile_dark"));
  });
});

describe("headerLogoSrc - forma adresu (klucz auto-preloadu Reacta)", () => {
  it("kanoniczny `/media/...` -> ścieżka względna, z zapytaniem", () => {
    const canonical = `${PUBLIC_MEDIA_ORIGIN}/media/theme/logo/nes-horizontal.svg`;
    expect(headerLogoSrc({ mobile: canonical }, false)).toBe(
      "/media/theme/logo/nes-horizontal.svg",
    );
    expect(headerLogoSrc({ main_dark: `${canonical}?v=3` }, true)).toBe(
      "/media/theme/logo/nes-horizontal.svg?v=3",
    );
  });

  it.each([
    ["obcy origin z katalogiem /media/", "https://cdn.example.com/media/logo.svg"],
    ["origin najemcy", "https://najemca.example/media/logo.svg"],
    [
      "host techniczny magazynu",
      "https://p.supabase.co/storage/v1/object/public/media/theme/logo.svg",
    ],
    ["kanoniczny poza /media/", `${PUBLIC_MEDIA_ORIGIN}/assets/logo.svg`],
    ["ścieżka już względna", "/media/theme/logo.svg"],
    ["goła nazwa pliku", "m.png"],
  ])("%s: bez zmian", (_label, src) => {
    expect(headerLogoSrc({ mobile: src }, false)).toBe(src);
  });
});

describe("headerLogoSrc - brak logotypu", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["pusty obiekt", {}],
    ["same puste napisy", { main: "", main_dark: "", mobile: "", mobile_dark: "" }],
  ])("%s -> pusty napis (wordmark tekstowy) w obu motywach", (_label, logo) => {
    expect(headerLogoSrc(logo, false)).toBe("");
    expect(headerLogoSrc(logo, true)).toBe("");
  });
});
