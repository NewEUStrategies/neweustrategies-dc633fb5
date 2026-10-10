// STAN SIATKI MAPY (`mapGridState.ts`) - zapis w bloku i w widgecie, kraj
// wpisany nazwą, uwagi wierszy.
//
// Siatka trzyma wiersze NIEDOKOŃCZONE, a rysunek czyta tylko kompletne -
// więc adaptery muszą zapisać wszystko, co autor wpisał, a czytać to samo,
// co czyta renderer (`parseMapValues` w bloku, `parseMapData` w widgecie).
// Uwagi mówią, dlaczego wiersz nie trafi na mapę tak, jak go wpisano.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseMapValues } from "@/lib/charts/parse";
import { parseMapData } from "@/lib/charts/csv";
import { MAP_GRID_MAX_ROWS } from "@/lib/charts/gridModel";
import type { GeoAsset } from "@/lib/charts/types";
import {
  blockMapValues,
  countryNameOf,
  drawnMapValues,
  mapCountryLookup,
  mapGridIsBlank,
  mapInsertRow,
  mapMoveRow,
  mapRemoveRow,
  mapRowStatuses,
  mapSetCell,
  readBlockMapRows,
  readWidgetMapRows,
  resolveCountryEntry,
  widgetMapText,
  type MapGridRow,
} from "../mapGridState";

/** Prawdziwy zasób Europy - nazwy krajów takie, jakie zobaczy autor. */
const EUROPA = (JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset)
  .countries;
const lookup = mapCountryLookup(EUROPA);

describe("blok CMS - wiersze takie, jakie są w treści", () => {
  it("wiersze niedokończone zostają, kod dwuliterowy idzie wielkimi literami", () => {
    expect(
      readBlockMapRows([
        { id: "pl", value: 12 },
        { id: "", value: 5 },
        { id: "DE", value: null },
        { id: "Narnia", value: 1 },
      ]),
    ).toEqual([
      { id: "PL", value: 12 },
      { id: "", value: 5 },
      { id: "DE", value: null },
      { id: "Narnia", value: 1 },
    ]);
  });

  it("liczba zapisana napisem czyta się tak jak w parserze (przecinek dziesiętny)", () => {
    const rows = readBlockMapRows([{ id: "PL", value: "12,5" }]);
    expect(rows).toEqual([{ id: "PL", value: 12.5 }]);
    expect(parseMapValues([{ id: "PL", value: "12,5" }])).toEqual([{ id: "PL", value: 12.5 }]);
  });

  it("pozycja w złym typie daje pusty wiersz, nie „[object Object]”", () => {
    const rows = readBlockMapRows([7, null, { id: { a: 1 }, value: "abc" }, "PL"]);
    expect(rows).toEqual([
      { id: "", value: null },
      { id: "", value: null },
      { id: "", value: null },
      { id: "", value: null },
    ]);
    expect(readBlockMapRows("wartości")).toEqual([]);
  });

  it("zapis oddaje wszystkie wiersze; rysunek bierze tylko kompletne", () => {
    const rows: MapGridRow[] = [
      { id: "PL", value: 1 },
      { id: "DE", value: null },
    ];
    const values = blockMapValues(rows);
    expect(values).toEqual([
      { id: "PL", value: 1 },
      { id: "DE", value: null },
    ]);
    expect(parseMapValues(values)).toEqual([{ id: "PL", value: 1 }]);
  });

  it("limit wierszy siatki obowiązuje też przy odczycie", () => {
    const many = Array.from({ length: MAP_GRID_MAX_ROWS + 5 }, () => ({ id: "", value: 1 }));
    expect(readBlockMapRows(many)).toHaveLength(MAP_GRID_MAX_ROWS);
  });
});

describe("widget buildera - pole „ISO2; wartość”", () => {
  it("zapis i odczyt są odwrotne, kropka dziesiętna, wiersz bez wartości jako „PL;”", () => {
    const rows: MapGridRow[] = [
      { id: "PL", value: 12.5 },
      { id: "DE", value: null },
      { id: "", value: 3 },
    ];
    const text = widgetMapText(rows);
    expect(text).toBe("PL; 12.5\nDE;\n; 3");
    expect(readWidgetMapRows(text)).toEqual(rows);
  });

  it("wiersz całkiem pusty nie trafia do tekstu", () => {
    expect(
      widgetMapText([
        { id: "", value: null },
        { id: "PL", value: 1 },
      ]),
    ).toBe("PL; 1");
  });

  it("średnik w kodzie nie rozbija formatu", () => {
    expect(widgetMapText([{ id: "a;b", value: 1 }])).toBe("a,b; 1");
  });

  it("odczyt liczb jest TEN SAM co w widoku widgetu (`parseMapData`)", () => {
    const text = "PL; 12,5\nDE;  1 234\nFR; abc\nIT;\nES; -3\n\nUA; 0.25";
    const kompletne = readWidgetMapRows(text).filter(
      (r): r is { id: string; value: number } => r.value !== null,
    );
    expect(kompletne).toEqual(parseMapData(text));
  });
});

describe("operacje na wierszach", () => {
  const rows: MapGridRow[] = [
    { id: "PL", value: 1 },
    { id: "DE", value: 2 },
  ];

  it("brak zmiany oddaje TEN SAM obiekt - siatka nie robi pustego kroku historii", () => {
    expect(mapSetCell(rows, 0, { value: 1 })).toBe(rows);
    expect(mapRemoveRow(rows, 5)).toBe(rows);
    expect(mapMoveRow(rows, 0, -1)).toBe(rows);
  });

  it("zapis komórki za ostatnim wierszem dopisuje wiersz (wiersz-zachęta pustej siatki)", () => {
    expect(mapSetCell([], 0, { id: "PL" })).toEqual([{ id: "PL", value: null }]);
  });

  it("wstaw, przesuń, usuń", () => {
    expect(mapInsertRow(rows, 1)).toEqual([rows[0], { id: "", value: null }, rows[1]]);
    expect(mapMoveRow(rows, 0, 1)).toEqual([rows[1], rows[0]]);
    expect(mapRemoveRow(rows, 0)).toEqual([rows[1]]);
  });

  it("wstawienie ponad limit nie zmienia siatki", () => {
    const pelne = Array.from({ length: MAP_GRID_MAX_ROWS }, () => ({ id: "", value: null }));
    expect(mapInsertRow(pelne, 0)).toBe(pelne);
  });

  it("siatka pusta to siatka bez kodu i bez liczby", () => {
    expect(mapGridIsBlank([])).toBe(true);
    expect(mapGridIsBlank([{ id: " ", value: null }])).toBe(true);
    expect(mapGridIsBlank([{ id: "", value: 0 }])).toBe(false);
  });
});

describe("kraj wpisany w komórkę kodu", () => {
  it.each([
    ["Czechy", "CZ"],
    ["Czech Republic", "CZ"],
    ["czechia", "CZ"],
    ["UK", "GB"],
    ["EL", "GR"],
    ["pl", "PL"],
    ["POL", "PL"],
    ["Niemcy", "DE"],
    ["Germany", "DE"],
  ])("„%s” -> %s", (wpis, kod) => {
    expect(resolveCountryEntry(wpis, lookup.index)).toBe(kod);
  });

  it("kraj spoza regionu dostaje kod (uwaga „poza regionem”), a nie „nieznany”", () => {
    expect(resolveCountryEntry("USA", lookup.index)).toBe("US");
    expect(resolveCountryEntry("United States", lookup.index)).toBe("US");
  });

  it("przed wczytaniem zasobu (bez skorowidza) nazwę rozpoznają nazwy CLDR (`Intl`)", () => {
    expect(resolveCountryEntry("Czechy")).toBe("CZ");
    expect(resolveCountryEntry("Niemcy")).toBe("DE");
    expect(resolveCountryEntry("Japonia", lookup.index)).toBe("JP");
  });

  it("wpis, którego nic nie rozpoznaje, zostaje jak jest", () => {
    expect(resolveCountryEntry("Narnia", lookup.index)).toBe("Narnia");
    expect(resolveCountryEntry("  ", lookup.index)).toBe("");
  });
});

describe("uwagi wierszy", () => {
  it("każdy rodzaj uwagi z właściwego powodu", () => {
    const rows: MapGridRow[] = [
      { id: "PL", value: 1 }, // 0 ok
      { id: "", value: null }, // 1 pusty
      { id: "", value: 4 }, // 2 bez kraju
      { id: "Narnia", value: 1 }, // 3 nieznany (nie kod)
      { id: "QQ", value: 1 }, // 4 nieznany kod
      { id: "PL", value: 2 }, // 5 powtórzenie wiersza 1
      { id: "DE", value: null }, // 6 brak wartości
      { id: "US", value: 3 }, // 7 poza regionem
    ];
    expect(mapRowStatuses(rows, lookup.ids)).toEqual([
      { kind: "ok" },
      { kind: "empty" },
      { kind: "noCountry" },
      { kind: "unknown" },
      { kind: "unknown" },
      { kind: "duplicate", row: 1 },
      { kind: "noValue" },
      { kind: "outside" },
    ]);
  });

  it("powtórzenie wskazuje wiersz, który parser bierze - PIERWSZY z wartością", () => {
    const rows: MapGridRow[] = [
      { id: "PL", value: null },
      { id: "PL", value: 7 },
    ];
    expect(mapRowStatuses(rows, lookup.ids)).toEqual([
      { kind: "duplicate", row: 2 },
      { kind: "ok" },
    ]);
    expect(parseMapValues(blockMapValues(rows))).toEqual([{ id: "PL", value: 7 }]);
  });

  it("przed wczytaniem zasobu uwaga „poza regionem” milczy", () => {
    expect(mapRowStatuses([{ id: "US", value: 1 }], null)).toEqual([{ kind: "ok" }]);
  });
});

describe("nazwy krajów i domena legendy", () => {
  it("nazwa z zasobu w języku dokumentu", () => {
    expect(countryNameOf("CZ", "pl", lookup.names)).toBe("Czechy");
    expect(countryNameOf("CZ", "en", lookup.names)).toBe("Czech Republic");
  });

  it("kod, który niczego nie wskazuje, nie ma nazwy", () => {
    expect(countryNameOf("QQ", "pl", lookup.names)).toBe("");
    expect(countryNameOf("Narnia", "pl", lookup.names)).toBe("");
  });

  it("domena legendy to kraje regionu (gdy zasób jest znany)", () => {
    const values = [
      { id: "PL", value: 1 },
      { id: "US", value: 100 },
    ];
    expect(drawnMapValues(values, lookup.ids)).toEqual([1]);
    expect(drawnMapValues(values, null)).toEqual([1, 100]);
  });
});
