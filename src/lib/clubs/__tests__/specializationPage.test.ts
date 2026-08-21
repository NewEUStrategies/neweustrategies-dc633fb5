// Reguły strony specjalizacji klubu, wyprowadzone z JSX-a trasy
// `/club/specialization/$slug`.
//
// CO TEN PLIK DOWODZI. Trzy decyzje, które przed wyprowadzeniem były
// wyrażeniami inline w drzewie renderu i dały się sprawdzić wyłącznie przez
// zamontowanie całej strony:
//
//   1. STOPKA POPRZECZNA wypisuje wszystkie POZOSTAŁE specjalizacje i ani razu
//      tej, na której czytelnik stoi. Odnośnik własny nie psuje niczego
//      widocznego - jest po prostu klikiem bez skutku i linkiem do siebie na
//      ośmiu stronach naraz.
//   2. PUSTKA SEKCJI KLUBÓW mówi COŚ INNEGO gościowi i zalogowanemu, bo znaczy
//      co innego: RPC pokazuje anonimowi wyłącznie kluby `public`, więc jego
//      pustka jest efektem braku sesji, nie braku klubów.
//   3. ADRES CTA (`?spec=`) to kontrakt MIĘDZY dwiema trasami - formularz
//      zgłoszenia czyta ten parametr w `validateSearch` i preselekcjonuje
//      obszar. Zła nazwa parametru cofa kandydata do wyboru z listy.
//
// Plus komplet filarów: trzy kafle, każdy z nagłówkiem I zdaniem, w słowniku
// PL i EN. Kafel z samym nagłówkiem to obietnica bez treści postawiona
// bezpośrednio nad jedynym CTA strony.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Katalogu specjalizacji (slugi, ikony, numery)
// ani budowy widoków z bazy - to `specializations.ts` i jego zakres
// w `clubPureModules.test.ts`. Nagłówków SEO tych stron - `specializationHead`
// ma zakres w `clubApplyAndSpecSeo.test.ts`. Sklejenia z trasą (co dostaje
// `ClubDirectory`, jaki `href` ma CTA) - `clubSpecializationRoute.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  SPECIALIZATION_PILLARS,
  otherClubSpecializations,
  specializationApplySearch,
  specializationClubsEmptyKey,
} from "@/lib/clubs/specializationPage";
import { CLUB_SPECIALIZATIONS } from "@/lib/clubs/specializations";
import { clubEn, clubPl } from "@/lib/i18n-club";

/** Odczyt klucza i18n z drzewa słownika - `undefined`, gdy klucza nie ma. */
function readKey(tree: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, tree);
}

const KNOWN_SLUGS = CLUB_SPECIALIZATIONS.map((spec) => spec.slug);

// --- otherClubSpecializations ----------------------------------------------

describe("otherClubSpecializations - wszystkie POZA bieżącą", () => {
  it.each(KNOWN_SLUGS)("`%s` nie wskazuje na samą siebie", (slug) => {
    const others = otherClubSpecializations(slug);
    expect(others.map((spec) => spec.slug)).not.toContain(slug);
  });

  it.each(KNOWN_SLUGS)("`%s` oddaje komplet pozostałych, o jeden mniej", (slug) => {
    expect(otherClubSpecializations(slug)).toHaveLength(CLUB_SPECIALIZATIONS.length - 1);
  });

  it("suma bieżącej i pozostałych odtwarza CAŁY katalog", () => {
    // Inwariant zamiast liczby: dopisanie dziewiątej specjalizacji nie ma
    // prawa cicho wypaść ze stopki.
    for (const slug of KNOWN_SLUGS) {
      const covered = new Set([slug, ...otherClubSpecializations(slug).map((s) => s.slug)]);
      expect(covered).toEqual(new Set(KNOWN_SLUGS));
    }
  });

  it("zachowuje redakcyjną kolejność katalogu", () => {
    const others = otherClubSpecializations(KNOWN_SLUGS[3]);
    const expected = KNOWN_SLUGS.filter((slug) => slug !== KNOWN_SLUGS[3]);
    expect(others.map((spec) => spec.slug)).toEqual(expected);
  });

  it.each(["", "nie-ma-takiej", "ENERGY", "energy/", " energy"])(
    "slug spoza katalogu (`%s`) dostaje PEŁNY zestaw - to jego jedyna droga powrotna",
    (slug) => {
      expect(otherClubSpecializations(slug)).toHaveLength(CLUB_SPECIALIZATIONS.length);
    },
  );

  it("dopasowanie idzie po slugu, nie po kluczu i18n", () => {
    // Klucz (`energy`) i slug (`energy`) są dla części obszarów IDENTYCZNE,
    // więc pomyłka pola przechodzi na nich niezauważona. Ten obszar ma je
    // różne, dlatego stoi tu jako kanarek.
    const spec = CLUB_SPECIALIZATIONS.find((item) => item.slug !== item.key);
    expect(spec).toBeDefined();
    if (spec === undefined) return;
    expect(otherClubSpecializations(spec.key).map((item) => item.slug)).toContain(spec.slug);
  });
});

// --- specializationClubsEmptyKey -------------------------------------------

describe("specializationClubsEmptyKey - pustka znaczy co innego dla gościa", () => {
  it("zalogowany dowiaduje się o stanie obszaru", () => {
    expect(specializationClubsEmptyKey(true)).toBe("club.spec.clubsEmpty");
  });

  it("gość dostaje zaproszenie do zalogowania", () => {
    expect(specializationClubsEmptyKey(false)).toBe("club.spec.clubsAnon");
  });

  it("oba komunikaty są RÓŻNE i oba istnieją w PL i EN", () => {
    const anon = specializationClubsEmptyKey(false);
    const signed = specializationClubsEmptyKey(true);
    expect(anon).not.toBe(signed);
    for (const key of [anon, signed]) {
      expect(typeof readKey(clubPl, key), `PL: ${key}`).toBe("string");
      expect(typeof readKey(clubEn, key), `EN: ${key}`).toBe("string");
    }
  });
});

// --- specializationApplySearch ---------------------------------------------

describe("specializationApplySearch - kontrakt adresu lejka", () => {
  it("przenosi slug do parametru `spec` bez zmian", () => {
    expect(specializationApplySearch("finance-economy")).toEqual({ spec: "finance-economy" });
  });

  it("nie dokłada ŻADNEGO innego parametru", () => {
    // Dodatkowy klucz przeszedłby `validateSearch` formularza po cichu
    // (ona czyta wyłącznie `spec`), ale zostałby w adresie i w analityce.
    expect(Object.keys(specializationApplySearch("energy"))).toEqual(["spec"]);
  });

  it.each(["", "nie-ma-takiej", "energy"])("slug `%s` jedzie dosłownie", (slug) => {
    expect(specializationApplySearch(slug).spec).toBe(slug);
  });
});

// --- SPECIALIZATION_PILLARS ------------------------------------------------

describe("SPECIALIZATION_PILLARS - trzy filary, każdy z nagłówkiem i zdaniem", () => {
  it("są dokładnie trzy", () => {
    expect(SPECIALIZATION_PILLARS).toHaveLength(3);
  });

  it("nagłówki są różne - trzy kafle nie mogą powtarzać jednego", () => {
    const titles = SPECIALIZATION_PILLARS.map((pillar) => pillar.titleKey);
    expect(new Set(titles).size).toBe(SPECIALIZATION_PILLARS.length);
  });

  it("żaden filar nie ma nagłówka bez zdania pod nim", () => {
    for (const pillar of SPECIALIZATION_PILLARS) {
      expect(pillar.titleKey).not.toBe("");
      expect(pillar.descKey).not.toBe("");
      expect(pillar.descKey).not.toBe(pillar.titleKey);
    }
  });

  it("każdy klucz filaru istnieje w PL i EN", () => {
    const keys = SPECIALIZATION_PILLARS.flatMap((pillar) => [pillar.titleKey, pillar.descKey]);
    expect(keys).toHaveLength(6);
    for (const key of keys) {
      expect(typeof readKey(clubPl, key), `PL: ${key}`).toBe("string");
      expect(typeof readKey(clubEn, key), `EN: ${key}`).toBe("string");
    }
  });
});
