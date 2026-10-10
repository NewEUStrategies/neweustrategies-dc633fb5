// NAGŁÓWEK MAPY „geo" - nazwa wymiaru, nie Gruzja.
//
// Rozpoznanie nagłówka mapy wymaga, żeby pierwsza komórka NIE wskazywała
// kraju. „geo" (wymiar Eurostatu, kolumna krajów w pakiecie `eurostat` dla R)
// jest jednak kodem ISO-3 Gruzji, więc tabela „geo | 2019 | 2020" wchodziła
// bez nagłówka: Gruzja dostawała wartość 2019 (rok z nagłówka), a jej
// prawdziwy wiersz szedł do powtórzonych. Trzy wejścia mają tę samą regułę:
// import pliku, podgląd tabeli mapy i wklejenie w siatkę.
import { describe, expect, it } from "vitest";
import { buildCountryIndex, tableToMapValues } from "@/lib/charts/importTable";
import { applyMapPasteAt } from "@/lib/charts/gridModel";
import { initialMapTableLayout, mapTableValues } from "../mapTableLayout";

const EUROPA = buildCountryIndex([
  { id: "PL", pl: "Polska", en: "Poland" },
  { id: "DE", pl: "Niemcy", en: "Germany" },
  { id: "FR", pl: "Francja", en: "France" },
  { id: "GE", pl: "Gruzja", en: "Georgia" },
]);

const LATA = [
  ["geo", "2019", "2020"],
  ["PL", "1,5", "2"],
  ["GE", "3", "4"],
  ["DE", "5", "6"],
];

const JEDEN_ROK = [
  ["geo", "2023"],
  ["PL", "5,1"],
  ["DE", "3,2"],
  ["FR", "4,4"],
];

describe("nagłówek „geo” nie jest Gruzją", () => {
  it("import tabeli: nagłówek pominięty, Gruzja ma swoją wartość", () => {
    const out = tableToMapValues(LATA, EUROPA, {});
    expect(out.values).toEqual([
      { id: "PL", value: 1.5 },
      { id: "GE", value: 3 },
      { id: "DE", value: 5 },
    ]);
    const kody = out.problems.map((p) => p.code);
    expect(kody).not.toContain("duplicateCountries");
    expect(kody).not.toContain("aliasesApplied");
  });

  it("jedna kolumna roku: Gruzji, której w danych nie ma, nie ma też na mapie", () => {
    const out = tableToMapValues(JEDEN_ROK, EUROPA, {});
    expect(out.values.map((v) => v.id)).toEqual(["PL", "DE", "FR"]);
  });

  it("podgląd tabeli mapy rozpoznaje nagłówek", () => {
    const lata = initialMapTableLayout(LATA, EUROPA);
    expect(lata.header).toBe(true);
    expect(mapTableValues(LATA, EUROPA, lata).values).toContainEqual({ id: "GE", value: 3 });
    const rok = initialMapTableLayout(JEDEN_ROK, EUROPA);
    expect(rok.header).toBe(true);
    expect(mapTableValues(JEDEN_ROK, EUROPA, rok).values.map((v) => v.id)).toEqual([
      "PL",
      "DE",
      "FR",
    ]);
  });

  it("wklejenie w siatkę mapy pomija nagłówek", () => {
    const { rows, problems } = applyMapPasteAt([], LATA, { row: 0, col: 0 }, EUROPA);
    expect(rows).toEqual([
      { id: "PL", value: 1.5 },
      { id: "GE", value: 3 },
      { id: "DE", value: 5 },
    ]);
    expect(problems.map((p) => p.code)).not.toContain("duplicateCountries");
  });

  it("„GEO | 3,5” w tabeli bez nagłówka dalej jest Gruzją - wiersz z liczbą to dane", () => {
    const rows = [
      ["GEO", "3,5"],
      ["PL", "1"],
    ];
    expect(tableToMapValues(rows, EUROPA, {}).values).toEqual([
      { id: "GE", value: 3.5 },
      { id: "PL", value: 1 },
    ]);
  });

  it("„id” nad kodami na mapie świata to nagłówek, nie Indonezja", () => {
    const swiat = buildCountryIndex([
      { id: "PL", pl: "Polska", en: "Poland" },
      { id: "ID", pl: "Indonezja", en: "Indonesia" },
    ]);
    const out = tableToMapValues(
      [
        ["id", "value"],
        ["PL", "1"],
        ["ID", "2"],
      ],
      swiat,
      {},
    );
    expect(out.values).toEqual([
      { id: "PL", value: 1 },
      { id: "ID", value: 2 },
    ]);
    expect(out.problems).toEqual([]);
  });
});
