// STAN ARKUSZA WYKRESU - poprawki po przeglądzie końcowym PR2.
//
//   1. NAPIS ZAPISANY, KTÓREGO PARSER NIE ODCZYTA („12%", „−3", „7 p"),
//      przeżywa każdą edycję INNEJ komórki i każdą operację na strukturze -
//      do tej poprawki pierwsza niezwiązana zmiana przepisywała cały tekst
//      danych z pustymi komórkami w ich miejscu, po cichu;
//   2. GRANICA PROGNOZY (`forecastFrom`) jest wskaźnikiem kategorii jak akcent
//      wycinka: wstawienie, usunięcie, przesunięcie i sortowanie wierszy
//      przeliczają ją tym samym ruchem, a zapis bloku (indeks od zera)
//      i widgetu (numer od jednego) oddaje ją w tej samej łatce.
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/blocks/types";
import {
  blockGridChanges,
  gridInsertCategory,
  gridMoveCategory,
  gridMoveSeries,
  gridPaste,
  gridRemoveCategory,
  gridSetCategory,
  gridSetValue,
  gridSort,
  gridTranspose,
  readBlockGrid,
  readWidgetGrid,
  widgetGridPatch,
  type ChartGridValue,
} from "../chartGridState";

const ZAPISANE = "; Eksport; Import\n2021; 12%; 5\n2022; −3; 7 p";

const dane = (v: ChartGridValue) => String(widgetGridPatch(v, "data").data);

describe("napis zapisany, którego parser nie odczyta - widget", () => {
  it("edycja innej komórki zostawia nieodczytane napisy bez zmian", () => {
    const g = readWidgetGrid(ZAPISANE, {}, "pl");
    expect(dane(gridSetValue(g, 0, 1, 6))).toBe("; Eksport; Import\n2021; 12%; 6\n2022; −3; 7 p");
  });

  it("zmiana etykiety też nie kasuje napisów", () => {
    const g = readWidgetGrid(ZAPISANE, {}, "pl");
    expect(dane(gridSetCategory(g, 0, "2020"))).toBe(
      "; Eksport; Import\n2020; 12%; 5\n2022; −3; 7 p",
    );
  });

  it("zatwierdzenie liczby albo luki w TEJ komórce zdejmuje napis", () => {
    const g = readWidgetGrid(ZAPISANE, {}, "pl");
    expect(dane(gridSetValue(g, 0, 0, 12))).toBe("; Eksport; Import\n2021; 12; 5\n2022; −3; 7 p");
    // Wyczyszczona komórka to świadoma luka, a nie „ta sama wartość".
    expect(dane(gridSetValue(g, 1, 0, null))).toBe("; Eksport; Import\n2021; 12%; 5\n2022; ; 7 p");
  });

  it("napis idzie za swoją komórką przy wstawieniu i usunięciu wiersza", () => {
    const g = readWidgetGrid(ZAPISANE, {}, "pl");
    expect(dane(gridInsertCategory(g, 0))).toBe(
      "; Eksport; Import\n; ; \n2021; 12%; 5\n2022; −3; 7 p",
    );
    expect(dane(gridRemoveCategory(g, 0))).toBe("; Eksport; Import\n2022; −3; 7 p");
  });

  it("napis idzie za komórką przy przesunięciu wiersza i serii, sortowaniu i obrocie", () => {
    const g = readWidgetGrid(ZAPISANE, {}, "pl");
    expect(dane(gridMoveCategory(g, 1, -1))).toBe("; Eksport; Import\n2022; −3; 7 p\n2021; 12%; 5");
    expect(dane(gridMoveSeries(g, 0, 1))).toBe("; Import; Eksport\n2021; 5; 12%\n2022; 7 p; −3");
    // Sortowanie po etykietach malejąco: 2022 przed 2021.
    expect(dane(gridSort(g, -1, "desc"))).toBe("; Eksport; Import\n2022; −3; 7 p\n2021; 12%; 5");
    expect(dane(gridTranspose(g))).toBe("; 2021; 2022\nEksport; 12%; −3\nImport; 5; 7 p");
  });

  it("wklejenie zakresu zastępuje napisy w komórkach, które przykrywa - i tylko w nich", () => {
    const g = readWidgetGrid(ZAPISANE, {}, "pl");
    const { value } = gridPaste(g, [["1"]], { row: 1, col: 0 }, "pl");
    expect(dane(value)).toBe("; Eksport; Import\n2021; 12%; 5\n2022; 1; 7 p");
  });
});

describe("napis zapisany, którego parser nie odczyta - blok CMS", () => {
  const blok = (): Record<string, Json> => ({
    categories: ["2021", "2022"],
    series: [{ name: "Eksport", values: ["12%", 5], colorSlot: 3 }],
  });

  it("edycja innej komórki oddaje napis w treści bloku bez zmian", () => {
    const g = readBlockGrid(blok());
    const zmiany = blockGridChanges(gridSetValue(g, 1, 0, 6));
    const series = zmiany.series as { values: Json[] }[];
    expect(series[0].values).toEqual(["12%", 6]);
  });

  it("zatwierdzenie liczby w tej komórce zapisuje liczbę", () => {
    const g = readBlockGrid(blok());
    const series = blockGridChanges(gridSetValue(g, 0, 0, 12)).series as { values: Json[] }[];
    expect(series[0].values).toEqual([12, 5]);
  });
});

describe("granica prognozy idzie za kategorią - blok CMS (indeks od zera)", () => {
  const LATA = ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
  const blok = (extra: Record<string, Json> = {}): Record<string, Json> => ({
    kind: "fan",
    categories: LATA,
    series: [{ name: "PKB", values: [1, 2, 3, 4, 5, 6, 7, 8], colorSlot: 3 }],
    forecastFrom: 4,
    ...extra,
  });
  /** Pierwsza kategoria prognozy po zapisie zmian w treść bloku. */
  const pierwszaPrognozy = (v: ChartGridValue) => {
    const z = blockGridChanges(v);
    return (z.categories as string[])[z.forecastFrom as number];
  };

  it("wstawienie wiersza nad granicą przesuwa ją razem z kategorią 2023", () => {
    const g = gridInsertCategory(readBlockGrid(blok()), 0);
    expect(blockGridChanges(g).forecastFrom).toBe(5);
    expect(pierwszaPrognozy(g)).toBe("2023");
  });

  it("usunięcie wiersza nad granicą cofa ją o jeden", () => {
    const g = gridRemoveCategory(readBlockGrid(blok()), 0);
    expect(blockGridChanges(g).forecastFrom).toBe(3);
    expect(pierwszaPrognozy(g)).toBe("2023");
  });

  it("usunięcie pierwszej kategorii prognozy zostawia granicę na miejscu - prognoza zaczyna się od następnej", () => {
    const g = gridRemoveCategory(readBlockGrid(blok()), 4);
    expect(blockGridChanges(g).forecastFrom).toBe(4);
    expect(pierwszaPrognozy(g)).toBe("2024");
  });

  it("przesunięcie i sortowanie niosą granicę z kategorią", () => {
    const wGore = gridMoveCategory(readBlockGrid(blok()), 4, -1);
    expect(pierwszaPrognozy(wGore)).toBe("2023");
    const malejaco = gridSort(readBlockGrid(blok()), 0, "desc");
    expect(pierwszaPrognozy(malejaco)).toBe("2023");
  });

  it("blok bez granicy nie dostaje klucza, a edycja wartości granicy nie zmienia", () => {
    const bez = blockGridChanges(
      gridInsertCategory(readBlockGrid(blok({ forecastFrom: null })), 0),
    );
    expect("forecastFrom" in bez).toBe(false);
    expect(blockGridChanges(gridSetValue(readBlockGrid(blok()), 0, 0, 9)).forecastFrom).toBe(4);
  });
});

describe("granica prognozy idzie za kategorią - widget (numer od jednego)", () => {
  const CSV = "; PKB\n2019; 1\n2020; 2\n2021; 3\n2022; 4\n2023; 5";

  it("wstawienie wiersza nad granicą zapisuje numer o jeden większy w tej samej łatce", () => {
    // Numer 5 = piąta kategoria, czyli 2023.
    const g = gridInsertCategory(readWidgetGrid(CSV, { forecastFrom: 5 }, "pl"), 0);
    expect(widgetGridPatch(g, "data").forecastFrom).toBe(6);
  });

  it("sortowanie malejąco przenosi granicę z kategorią 2023 na początek", () => {
    const g = gridSort(readWidgetGrid(CSV, { forecastFrom: 5 }, "pl"), -1, "desc");
    expect(widgetGridPatch(g, "data").forecastFrom).toBe(1);
  });

  it("widget bez granicy nie dostaje klucza w łatce (łatka nie kasuje cudzego pola)", () => {
    const g = gridInsertCategory(readWidgetGrid(CSV, {}, "pl"), 0);
    expect("forecastFrom" in widgetGridPatch(g, "data")).toBe(false);
  });
});
