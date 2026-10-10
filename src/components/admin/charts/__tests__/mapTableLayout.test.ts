// UKŁAD TABELI MAPY (`mapTableLayout.ts`) - rozpoznanie kolumny krajów,
// obrót i jedna funkcja wartości dla podglądu i zapisu.
//
// Tabele z arkuszy rzadko mają kraj w pierwszej kolumnie: „Lp. | Kraj |
// Wartość" ma liczby porządkowe na początku, a „Rok | PL | DE" trzyma kraje
// w nagłówku. Rozpoznanie ma ustawić podgląd tak, żeby „Zastosuj" od razu
// dawało mapę, a autor mógł każdą decyzję zmienić.
import { describe, expect, it } from "vitest";
import { buildCountryIndex } from "@/lib/charts/importTable";
import {
  firstValueColumn,
  initialMapTableLayout,
  mapLayoutForTranspose,
  mapTableValues,
  projectMapTable,
} from "../mapTableLayout";

const index = buildCountryIndex([
  { id: "PL", pl: "Polska", en: "Poland" },
  { id: "DE", pl: "Niemcy", en: "Germany" },
  { id: "FR", pl: "Francja", en: "France" },
  { id: "CZ", pl: "Czechy", en: "Czech Republic" },
]);

describe("rozpoznanie układu", () => {
  it("kraj w pierwszej kolumnie, nagłówek nad latami - wartość z pierwszego roku", () => {
    const rows = [
      ["Kraj", "2019", "2020"],
      ["Polska", "1", "2"],
      ["Germany", "3", "4"],
    ];
    expect(initialMapTableLayout(rows, index)).toEqual({
      header: true,
      transpose: false,
      locale: "auto",
      countryColumn: 0,
      valueColumn: 1,
    });
    expect(mapTableValues(rows, index, initialMapTableLayout(rows, index)).values).toEqual([
      { id: "PL", value: 1 },
      { id: "DE", value: 3 },
    ]);
  });

  it("„Lp. | Kraj | Wartość” - kraje w drugiej kolumnie, wartość ZA nimi, nie liczba porządkowa", () => {
    const rows = [
      ["Lp.", "Kraj", "Wartość"],
      ["1", "Polska", "12,5"],
      ["2", "Czechy", "7"],
    ];
    const layout = initialMapTableLayout(rows, index);
    expect(layout).toMatchObject({ header: true, transpose: false, countryColumn: 1 });
    expect(layout.valueColumn).toBe(2);
    expect(mapTableValues(rows, index, layout).values).toEqual([
      { id: "PL", value: 12.5 },
      { id: "CZ", value: 7 },
    ]);
  });

  it("kraje w nagłówku („Rok | PL | DE | FR”) - podgląd startuje obrócony", () => {
    const rows = [
      ["Rok", "PL", "DE", "FR"],
      ["2024", "10", "20", "30"],
    ];
    const layout = initialMapTableLayout(rows, index);
    expect(layout).toMatchObject({ transpose: true, countryColumn: 0, header: true });
    expect(mapTableValues(rows, index, layout).values).toEqual([
      { id: "PL", value: 10 },
      { id: "DE", value: 20 },
      { id: "FR", value: 30 },
    ]);
  });

  it("tabela bez nagłówka („PL | 12”) nie traci pierwszego kraju", () => {
    const rows = [
      ["PL", "12"],
      ["DE", "13"],
    ];
    const layout = initialMapTableLayout(rows, index);
    expect(layout).toMatchObject({ header: false, transpose: false, countryColumn: 0 });
    expect(mapTableValues(rows, index, layout).values).toHaveLength(2);
  });

  it("tabela bez żadnego kraju zostaje w układzie zastanym (kraj w A, wartość w B)", () => {
    const layout = initialMapTableLayout(
      [
        ["a", "b"],
        ["c", "1"],
      ],
      index,
    );
    expect(layout).toMatchObject({ transpose: false, countryColumn: 0, valueColumn: 1 });
  });
});

describe("projekcja i obrót", () => {
  it("kolumna krajów idzie na początek, numer kolumny wartości liczy się od nowa", () => {
    const rows = [["1", "PL", "5"]];
    expect(projectMapTable(rows, base({ countryColumn: 1, valueColumn: 2 }))).toEqual({
      rows: [["PL", "1", "5"]],
      valueColumn: 2,
    });
    expect(projectMapTable(rows, base({ countryColumn: 1, valueColumn: 0 }))).toEqual({
      rows: [["PL", "1", "5"]],
      valueColumn: 1,
    });
  });

  it("układ bez kolumny krajów (układ wykresu, zapis sprzed PR2) czyta kraj z A", () => {
    const rows = [
      ["PL", "5"],
      ["DE", "6"],
    ];
    expect(mapTableValues(rows, index, base({ valueColumn: 1 })).values).toHaveLength(2);
  });

  it("przełączenie obrotu rozpoznaje kolumnę krajów od nowa", () => {
    const rows = [
      ["Rok", "PL", "DE"],
      ["2024", "1", "2"],
    ];
    const prosto = mapLayoutForTranspose(rows, base({}), false, index);
    const obrot = mapLayoutForTranspose(rows, prosto, true, index);
    expect(obrot).toMatchObject({ transpose: true, countryColumn: 0, valueColumn: 1 });
  });

  it("pierwsza kolumna wartości: za krajami, a gdy tam nic - przed nimi", () => {
    const tabela = [
      ["7", "PL", "x"],
      ["8", "DE", "y"],
    ];
    expect(firstValueColumn(tabela, 1, false)).toBe(0);
  });
});

function base(over: Partial<Parameters<typeof projectMapTable>[1]>) {
  return { header: false, transpose: false, locale: "auto" as const, valueColumn: 1, ...over };
}
