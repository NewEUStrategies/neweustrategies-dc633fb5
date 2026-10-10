// TABELA MAPY BEZ NAGŁÓWKA - pierwszy kraj nie może zniknąć bez słowa.
//
// Rozpoznanie nagłówka wykresu (`analyseTable`) nie wie nic o krajach: tabela
// „kod | nazwa | wartość" ma tekst w drugiej kolumnie, więc wyglądała mu na
// nagłówek, a „kod | wartość | flaga" (flagi Eurostatu) - tak samo.
// Podgląd stawiał wtedy „Pierwszy wiersz to nagłówek", a „Zastosuj" gubiło
// pierwszy kraj bez żadnej uwagi. Ta sama ścieżka obsługuje import pliku,
// wklejenie całej tabeli w siatkę, wklejenie na kanwie i textareę widgetu.
// Reguła jest ta sama co w `tableToMapValues`: wiersz, którego komórka kraju
// wskazuje kraj, NIGDY nie jest nagłówkiem, a wiersz z liczbą w kolumnie
// wartości też nie (chyba że cały jest okresami: „Kraj | 2019 | 2020").
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildCountryIndex } from "@/lib/charts/importTable";
import type { GeoAsset } from "@/lib/charts/types";
import { initialMapTableLayout, mapLayoutForTranspose, mapTableValues } from "../mapTableLayout";

const EUROPA = buildCountryIndex(
  (JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset).countries,
);

const wartosci = (rows: string[][]) =>
  mapTableValues(rows, EUROPA, initialMapTableLayout(rows, EUROPA)).values;

describe("tabela bez nagłówka z dodatkową kolumną tekstu", () => {
  it("„kod | nazwa | wartość” - nagłówek wyłączony, trzy kraje", () => {
    const rows = [
      ["PL", "Polska", "5"],
      ["DE", "Niemcy", "7"],
      ["FR", "Francja", "9"],
    ];
    expect(initialMapTableLayout(rows, EUROPA)).toMatchObject({
      header: false,
      transpose: false,
      countryColumn: 0,
      valueColumn: 2,
    });
    expect(wartosci(rows)).toEqual([
      { id: "PL", value: 5 },
      { id: "DE", value: 7 },
      { id: "FR", value: 9 },
    ]);
  });

  it("„kod | wartość | flaga” (Eurostat) - pierwszy kraj zostaje", () => {
    const rows = [
      ["PL", "5", "p"],
      ["DE", "7", "e"],
    ];
    expect(initialMapTableLayout(rows, EUROPA).header).toBe(false);
    expect(wartosci(rows)).toEqual([
      { id: "PL", value: 5 },
      { id: "DE", value: 7 },
    ]);
  });

  it("kraj spoza regionu w pierwszym wierszu z liczbą - wiersz danych, zgłoszony jako nieznany", () => {
    const rows = [
      ["JP", "5", "p"],
      ["DE", "7", "e"],
    ];
    const layout = initialMapTableLayout(rows, EUROPA);
    expect(layout.header).toBe(false);
    const wynik = mapTableValues(rows, EUROPA, layout);
    expect(wynik.values).toEqual([{ id: "DE", value: 7 }]);
    expect(wynik.problems).toContainEqual({ code: "unknownCountries", labels: ["JP"] });
  });

  it("po przełączeniu obrotu tam i z powrotem nagłówek dalej jest wyłączony", () => {
    const rows = [
      ["PL", "Polska", "5"],
      ["DE", "Niemcy", "7"],
    ];
    const start = initialMapTableLayout(rows, EUROPA);
    const tam = mapLayoutForTranspose(rows, start, true, EUROPA);
    const zPowrotem = mapLayoutForTranspose(rows, tam, false, EUROPA);
    expect(zPowrotem).toMatchObject({ header: false, countryColumn: 0, valueColumn: 2 });
  });
});

describe("prawdziwe nagłówki dalej są nagłówkami", () => {
  it.each([
    [
      "Kraj | Wartość",
      [
        ["Kraj", "Wartość"],
        ["PL", "5"],
        ["DE", "7"],
      ],
    ],
    [
      "Lp. | Kraj | Wartość",
      [
        ["Lp.", "Kraj", "Wartość"],
        ["1", "Polska", "5"],
        ["2", "Niemcy", "7"],
      ],
    ],
    [
      "Kraj | 2019 | 2020",
      [
        ["Kraj", "2019", "2020"],
        ["PL", "5", "6"],
        ["DE", "7", "8"],
      ],
    ],
  ])("%s", (_, rows) => {
    expect(initialMapTableLayout(rows, EUROPA).header).toBe(true);
    expect(wartosci(rows).map((v) => v.id)).toEqual(["PL", "DE"]);
  });
});
