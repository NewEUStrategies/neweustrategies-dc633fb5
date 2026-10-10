// ALIASY KRAJÓW: tabela zamknięta, sprawdzana na PRAWDZIWYCH zasobach geometrii.
//
// Tabela aliasów jest danymi, nie logiką - pomyłka w niej nie wywoła błędu
// kompilacji, tylko po cichu narysuje wartość na złym kraju albo na żadnym.
// Dlatego bramka czyta `public/geo/*.json` (te same pliki, które rysuje mapa)
// i pilnuje czterech rzeczy:
//   1. każdy kraj zasobu, który MA kod ISO-3, jest w tabeli ISO-3,
//   2. każdy cel aliasu istnieje w geometrii (alias do kraju, którego mapa nie
//      zna, to cicha strata danych),
//   3. alias nie przykrywa nazwy, którą zasób daje INNEMU krajowi,
//   4. klucze są już znormalizowane - inaczej nigdy by nie trafiły.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODE_ALIASES,
  ISO3_TO_ISO2,
  countryAliasKey,
  countryNameAliases,
  normaliseCountryName,
  resolveCountryAlias,
} from "@/lib/charts/countryAliases";

interface AssetCountry {
  id: string;
  pl: string;
  en: string;
}

/** Wszystkie kraje ze wszystkich zasobów geometrii - po identyfikatorze. */
function krajeZasobow(): Map<string, AssetCountry> {
  const out = new Map<string, AssetCountry>();
  for (const plik of readdirSync("public/geo").filter((p) => p.endsWith(".json"))) {
    const zasob = JSON.parse(readFileSync(`public/geo/${plik}`, "utf8")) as {
      countries: AssetCountry[];
    };
    for (const c of zasob.countries) if (!out.has(c.id)) out.set(c.id, c);
  }
  return out;
}

const KRAJE = krajeZasobow();

/** Obszary bez kodu ISO-3 - zasób nadaje im kody użytkownika. */
const BEZ_ISO3 = new Set(["XN", "XS"]);

describe("aliasy krajów - zgodność z zasobami geometrii", () => {
  it("zasoby da się przeczytać i znają ponad dwieście krajów", () => {
    expect(KRAJE.size).toBeGreaterThan(200);
  });

  it("każdy kraj z kodem ISO-3 ma pozycję w tabeli ISO-3 -> ISO-2", () => {
    const cele = new Set(Object.values(ISO3_TO_ISO2));
    const brakujace = [...KRAJE.keys()].filter((id) => !BEZ_ISO3.has(id) && !cele.has(id));
    expect(brakujace).toEqual([]);
  });

  it("każdy cel aliasu - kodu i nazwy - istnieje w geometrii", () => {
    const cele = [
      ...Object.values(ISO3_TO_ISO2),
      ...Object.values(CODE_ALIASES),
      ...countryNameAliases().values(),
    ];
    expect(cele.filter((id) => !KRAJE.has(id))).toEqual([]);
  });

  it("kody ISO-3 są trzyliterowe i wielkimi literami", () => {
    for (const kod of Object.keys(ISO3_TO_ISO2)) expect(kod).toMatch(/^[A-Z]{3}$/);
  });

  it("alias nie przykrywa nazwy, którą zasób daje innemu krajowi", () => {
    const zZasobu = new Map<string, string>();
    for (const c of KRAJE.values()) {
      for (const nazwa of [c.pl, c.en]) zZasobu.set(countryAliasKey(nazwa), c.id);
    }
    const kolizje = [...countryNameAliases()].filter(
      ([klucz, id]) => zZasobu.has(klucz) && zZasobu.get(klucz) !== id,
    );
    expect(kolizje).toEqual([]);
  });

  it("klucze nazw są już w postaci znormalizowanej", () => {
    for (const klucz of countryNameAliases().keys()) {
      expect(countryAliasKey(klucz), klucz).toBe(klucz);
    }
  });

  it("kody aliasów Eurostatu nie są kodami żadnego kraju zasobu", () => {
    // Gdyby „EL" albo „UK" były kiedyś w geometrii, alias przemalowałby
    // prawdziwy kraj na inny.
    for (const kod of Object.keys(CODE_ALIASES)) expect(KRAJE.has(kod), kod).toBe(false);
  });
});

describe("aliasy krajów - rozwiązywanie etykiet", () => {
  it("Eurostat: EL to Grecja, UK to Wielka Brytania - bez względu na wielkość liter", () => {
    expect(resolveCountryAlias("EL")).toBe("GR");
    expect(resolveCountryAlias(" uk ")).toBe("GB");
  });

  it("ISO-3 prowadzi do ISO-2, także kody wycofane", () => {
    expect(resolveCountryAlias("POL")).toBe("PL");
    expect(resolveCountryAlias("deu")).toBe("DE");
    expect(resolveCountryAlias("XKX")).toBe("XK");
    expect(resolveCountryAlias("ROM")).toBe("RO");
  });

  it("nazwy potoczne EN i zastępcze PL", () => {
    const pary: [string, string][] = [
      ["Russia", "RU"],
      ["Czechia", "CZ"],
      ["Turkey", "TR"],
      ["North Macedonia", "MK"],
      ["Moldova", "MD"],
      ["Vatican", "VA"],
      ["Holland", "NL"],
      ["Bosnia-Herzegovina", "BA"],
      ["Korea, Rep.", "KR"],
      ["Congo, Dem. Rep.", "CD"],
      ["Iran, Islamic Rep.", "IR"],
      ["The Gambia", "GM"],
      ["Republika Czeska", "CZ"],
      ["Niderlandy", "NL"],
      ["Federacja Rosyjska", "RU"],
      ["Zjednoczone Królestwo", "GB"],
      ["Korea Płd.", "KR"],
      ["RPA", "ZA"],
    ];
    for (const [etykieta, id] of pary) expect(resolveCountryAlias(etykieta), etykieta).toBe(id);
  });

  it("nieznana etykieta to null - alias nie zgaduje", () => {
    for (const obca of ["Atlantyda", "EU27_2020", "", "PL", "Polska", "ABC", "constructor"]) {
      expect(resolveCountryAlias(obca), obca).toBeNull();
    }
  });

  it("klucz aliasu czyta „&” jako „and” i gubi początkowe „the”", () => {
    expect(countryAliasKey("Bosnia & Herzegovina")).toBe("bosnia and herzegovina");
    expect(countryAliasKey("The Netherlands")).toBe("netherlands");
    // Sama normalizacja nazw (skorowidz zasobu) zostaje bez zmian.
    expect(normaliseCountryName("The Netherlands")).toBe("the netherlands");
    expect(normaliseCountryName("Łotwa")).toBe("lotwa");
  });
});
