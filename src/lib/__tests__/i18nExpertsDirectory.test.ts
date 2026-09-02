// Parytet PL/EN nakładki huba eksperta + dwie rzeczy, których nie widzi żadna
// bramka globalna: POLSKIE FORMY licznika publikacji i pokrycie kluczy, które
// woła publiczny katalog `/experts`.
//
// PO CO TEN PLIK. `expert.publicationsCount` miał JEDNĄ formę
// („{{count}} publikacji"), więc karta świeżo dodanego eksperta pokazywała
// „1 publikacji" - błąd widoczny na każdej karcie i niewidoczny dla bramek:
// parytet PL/EN był zielony (klucz istniał w obu językach), ratchet napisów
// w kodzie też (nie ma tu napisu w kodzie), a `tsc` nie ma czego sprawdzać,
// bo `t()` przyjmuje `string`. Złapać to może wyłącznie test, który pyta
// o ZESTAW form liczby mnogiej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
// - `src/lib/__tests__/i18nOverlayDashGate.test.ts` pilnuje pauzy „—" nad
//   WSZYSTKIMI nakładkami, więc tutaj nie ma osobnej asercji o pauzie;
// - `src/__tests__/i18nParity.gate.test.ts` porównuje rdzeń;
// - render katalogu ma własny plik
//   `src/routes/__tests__/expertsDirectoryRoute.test.tsx`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { expertsPl, expertsEn } from "@/lib/i18n-experts";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: readonly string[]): string[] => [
  ...new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, ""))),
];

const pl = flatten(expertsPl as unknown as Tree);
const en = flatten(expertsEn as unknown as Tree);

const ROUTE_SOURCE = readFileSync("src/routes/experts.tsx", "utf8");

describe("i18n-experts - parytet i kompletność", () => {
  it("ma identyczny zestaw kluczy w PL i EN (po normalizacji liczby mnogiej)", () => {
    // Klucz obecny tylko po polsku renderuje surowy identyfikator
    // (`expert.directoryLoadFailed`) odwiedzającemu wersję angielską.
    expect(baseKeys(pl).sort()).toEqual(baseKeys(en).sort());
  });

  it("nie ma pustych tłumaczeń", () => {
    // Pusty napis w słowniku to element interfejsu bez etykiety - w praktyce
    // przycisk albo plakietka, których nie da się przeczytać ani wskazać.
    const values = [expertsPl, expertsEn].map((tree) => JSON.stringify(tree)).join(" ");
    expect(values).not.toContain('""');
  });

  it("licznik publikacji ma WSZYSTKIE polskie formy liczby mnogiej", () => {
    // 1 publikacja / 2-4 publikacje / 5+ publikacji. Jedna forma dawała
    // „1 publikacji" na karcie każdego eksperta z jedną pozycją.
    expect(pl.filter((k) => k.startsWith("expert.publicationsCount")).sort()).toEqual([
      "expert.publicationsCount_few",
      "expert.publicationsCount_many",
      "expert.publicationsCount_one",
      "expert.publicationsCount_other",
    ]);
    expect(en.filter((k) => k.startsWith("expert.publicationsCount")).sort()).toEqual([
      "expert.publicationsCount_few",
      "expert.publicationsCount_many",
      "expert.publicationsCount_one",
      "expert.publicationsCount_other",
    ]);
  });

  it("zachowuje interpolację `{{count}}` w KAŻDEJ formie licznika", () => {
    // Literówka w nazwie zmiennej renderuje surowy placeholder na karcie.
    for (const tree of [expertsPl, expertsEn]) {
      for (const form of ["_one", "_few", "_many", "_other"] as const) {
        const value = (tree.expert as unknown as Record<string, string>)[
          `publicationsCount${form}`
        ];
        expect(value, `publicationsCount${form}`).toContain("{{count}}");
      }
    }
  });

  it("pokrywa KAŻDY klucz `expert.*` wołany w trasie /experts", () => {
    // i18next na brak klucza nie rzuca - zwraca sam klucz, więc katalog
    // wyświetlałby `expert.directoryLoadFailed` zamiast zdania.
    const used = [...ROUTE_SOURCE.matchAll(/"(expert\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]);
    const declared = new Set([...pl, ...baseKeys(pl)]);
    const missing = [...new Set(used)].filter((key) => !declared.has(key)).sort();

    expect(missing).toEqual([]);
  });

  it("KONTROLA DODATNIA: predykat pokrycia ODRZUCA klucz, którego nie ma", () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby wyrażenie
    // regularne nie łapało niczego (np. po zmianie cudzysłowów w trasie).
    const declared = new Set([...pl, ...baseKeys(pl)]);

    expect(declared.has("expert.directoryTitle")).toBe(true);
    expect(declared.has("expert.nieMaTakiegoKlucza")).toBe(false);
  });

  it("trasa /experts NIE opisuje stanu degradacji napisem w kodzie", () => {
    // Regresja: komunikat degradacji dopisany jako `lang === "en" ? ... : ...`
    // omija parytet PL/EN i zamyka drogę do trzeciego języka. Skan pomija
    // `head()`, który świadomie składa metadane POZA Reactem (tam `t()` nie
    // istnieje) - dokładnie jak w `i18nPodcasts.test.ts`.
    const headStart = ROUTE_SOURCE.indexOf("  head:");
    const headEnd = ROUTE_SOURCE.indexOf("  component:", headStart);
    const body =
      headStart >= 0 && headEnd > headStart
        ? ROUTE_SOURCE.slice(0, headStart) + ROUTE_SOURCE.slice(headEnd)
        : ROUTE_SOURCE;

    expect(body).toContain('t("expert.directoryLoadFailed")');
    expect(body).not.toMatch(/lang === "pl"\s*\?\s*["'`]/);
  });
});
