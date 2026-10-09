// STAN ARKUSZA DANYCH WYKRESU - dane, kolory i wskaźniki akcentu RAZEM.
//
// Bramka kontraktu PR2 („Colour picker behaviour" (d)): każda operacja na
// strukturze zostawia kolor i wyróżnienie przy TEJ SAMEJ serii (kategorii),
// a zapis do widgetu to JEDNA łatka z czterema kluczami, którą adapter
// widgetu (`widgetChartConfig`) czyta z powrotem w ten sam stan.
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/blocks/types";
import { widgetChartConfig } from "@/lib/charts/widgetConfig";
import { slotForSeries } from "@/lib/charts/palette";
import {
  blockGridChanges,
  defaultSeriesName,
  gridInsertCategory,
  gridInsertSeries,
  gridMoveCategory,
  gridMoveSeries,
  gridPaste,
  gridRemoveCategory,
  gridRemoveSeries,
  gridReplace,
  gridSetValue,
  gridSort,
  gridTranspose,
  readBlockGrid,
  readWidgetGrid,
  widgetContentSignature,
  widgetGridCsv,
  widgetGridPatch,
  widgetGridSignature,
  widgetSeriesColors,
  type ChartGridValue,
} from "../chartGridState";

function stan(accentSeries = 0, accentCategory: number | null = null): ChartGridValue {
  return {
    model: {
      categories: ["2021", "2022", "2023"],
      series: [
        { name: "Eksport", values: [1, 2, 3], colorSlot: 3 },
        { name: "Import", values: [4, 5, 6], colorSlot: 12 },
        { name: "Saldo", values: [7, 8, 9], colorSlot: 14 },
      ],
    },
    accentSeries,
    accentCategory,
  };
}

const nazwaAkcentu = (v: ChartGridValue) => v.model.series[v.accentSeries].name;
const etykietaAkcentu = (v: ChartGridValue) =>
  v.accentCategory === null ? null : v.model.categories[v.accentCategory];

describe("operacje na seriach - kolor i akcent idą za serią", () => {
  it("przesunięcie serii zabiera kolor i akcent", () => {
    const v = gridMoveSeries(stan(1), 1, 1);
    expect(v.model.series.map((s) => s.name)).toEqual(["Eksport", "Saldo", "Import"]);
    expect(v.model.series[2].colorSlot).toBe(12);
    expect(nazwaAkcentu(v)).toBe("Import");
  });

  it("wstawienie serii PRZED wyróżnioną przesuwa wskaźnik", () => {
    const v = gridInsertSeries(stan(1), 0, "Nowa");
    expect(v.model.series[0].name).toBe("Nowa");
    expect(nazwaAkcentu(v)).toBe("Import");
    // Nowa seria nie dostaje koloru serii, która już jest na wykresie.
    expect([3, 12, 14]).not.toContain(v.model.series[0].colorSlot);
  });

  it("usunięcie serii przed wyróżnioną przesuwa wskaźnik, usunięcie wyróżnionej oddaje akcent pierwszej", () => {
    expect(nazwaAkcentu(gridRemoveSeries(stan(2), 0))).toBe("Saldo");
    const v = gridRemoveSeries(stan(1), 1);
    expect(v.accentSeries).toBe(0);
    expect(v.model.series.map((s) => s.colorSlot)).toEqual([3, 14]);
  });

  it("ostatniej serii i ostatniej kategorii usunąć się nie da", () => {
    const jedna: ChartGridValue = {
      model: { categories: ["a"], series: [{ name: "S", values: [1], colorSlot: 3 }] },
      accentSeries: 0,
      accentCategory: null,
    };
    expect(gridRemoveSeries(jedna, 0)).toBe(jedna);
    expect(gridRemoveCategory(jedna, 0)).toBe(jedna);
  });
});

describe("operacje na kategoriach - wyróżniony wycinek idzie za etykietą", () => {
  it("wstawienie, przesunięcie i usunięcie zostawiają wskazanie na tej samej etykiecie", () => {
    expect(etykietaAkcentu(gridInsertCategory(stan(0, 1), 0))).toBe("2022");
    expect(etykietaAkcentu(gridMoveCategory(stan(0, 1), 1, 1))).toBe("2022");
    expect(etykietaAkcentu(gridRemoveCategory(stan(0, 2), 0))).toBe("2023");
    expect(gridRemoveCategory(stan(0, 1), 1).accentCategory).toBeNull();
  });

  it("sortowanie po serii zostawia wskazanie na tej samej etykiecie", () => {
    const v = gridSort(stan(0, 0), 0, "desc");
    expect(v.model.categories).toEqual(["2023", "2022", "2021"]);
    expect(etykietaAkcentu(v)).toBe("2021");
  });

  it("obrót zamienia role wskaźników", () => {
    const v = gridTranspose(stan(2, 1));
    expect(v.model.categories).toEqual(["Eksport", "Import", "Saldo"]);
    expect(nazwaAkcentu(v)).toBe("2022");
    expect(etykietaAkcentu(v)).toBe("Saldo");
  });
});

describe("wklejenie i zastąpienie tabeli", () => {
  it("wklejenie zakresu od komórki kotwicy to jeden nowy stan, wskaźniki bez zmian", () => {
    const { value, problems } = gridPaste(
      stan(1),
      [
        ["10", "20"],
        ["30", "x"],
      ],
      { row: 1, col: 1 },
      "pl",
    );
    expect(value.model.series[1].values).toEqual([4, 10, 30]);
    expect(value.model.series[2].values).toEqual([7, 20, null]);
    expect(value.accentSeries).toBe(1);
    expect(problems).toEqual([{ code: "nonNumericCells", count: 1 }]);
  });

  it("wklejenie za krawędzią dokłada serie z nazwą w języku dokumentu", () => {
    const { value } = gridPaste(stan(), [["1", "2"]], { row: 0, col: 2 }, "en");
    expect(value.model.series[3].name).toBe(defaultSeriesName(3, "en"));
  });

  it("zastąpienie tabeli zostawia kolor i akcent przy serii o tej samej nazwie", () => {
    const v = gridReplace(stan(1, 2), {
      categories: ["2023", "2024"],
      series: [
        { name: "Import", values: [1, 2], colorSlot: slotForSeries(0) },
        { name: "Nowa", values: [3, 4], colorSlot: slotForSeries(1) },
      ],
    });
    expect(v.model.series[0].colorSlot).toBe(12);
    expect(nazwaAkcentu(v)).toBe("Import");
    expect(etykietaAkcentu(v)).toBe("2023");
  });
});

describe("blok CMS - adapter treści", () => {
  it("odczyt i zapis są odwrotne; wskaźnik domyślny znika z treści", () => {
    const v = stan(2, 1);
    const zmiany = blockGridChanges(v);
    expect(zmiany.accentSeries).toBe(2);
    expect(zmiany.accentCategory).toBe(1);
    const data: Record<string, Json> = {};
    for (const [k, w] of Object.entries(zmiany)) if (w !== undefined) data[k] = w;
    expect(readBlockGrid(data)).toEqual(v);
    const domyslne = blockGridChanges(stan());
    expect(domyslne.accentSeries).toBeUndefined();
    expect(domyslne.accentCategory).toBeUndefined();
  });

  it("wskaźnik spoza zakresu czyta się tak, jak narysuje go parser", () => {
    const v = readBlockGrid({
      categories: ["a"],
      series: [{ name: "S", values: ["12,5"], colorSlot: 99 }],
      accentSeries: 7,
      accentCategory: -1,
    });
    expect(v.accentSeries).toBe(0);
    expect(v.accentCategory).toBeNull();
    expect(v.model.series[0].values).toEqual([12.5]);
    expect(v.model.series[0].colorSlot).toBe(slotForSeries(0));
  });
});

describe("widget buildera - jedna łatka czytana z powrotem tym samym adapterem", () => {
  it("tekst średnikowy: kropka dziesiętna, etykiety bez średnika", () => {
    const csv = widgetGridCsv({
      categories: ["Kraków; Polska", "2024"],
      series: [{ name: "A", values: [1234.5, null], colorSlot: 3 }],
    });
    expect(csv).toBe("; A\nKraków, Polska; 1234.5\n2024; ");
  });

  it("kolory są pozycyjne, a domyślne (i puste z końca) nie zapisują się wcale", () => {
    expect(widgetSeriesColors([{ colorSlot: slotForSeries(0) }, { colorSlot: 12 }])).toBe(";12");
    expect(widgetSeriesColors([{ colorSlot: 12 }, { colorSlot: slotForSeries(1) }])).toBe("12");
    expect(widgetSeriesColors([{ colorSlot: slotForSeries(0) }])).toBe("");
  });

  it("łatka to cztery klucze naraz, a adapter widgetu czyta z niej ten sam stan", () => {
    const v = gridMoveSeries(stan(1), 1, 1);
    const patch = widgetGridPatch(v, "data");
    expect(Object.keys(patch).sort()).toEqual([
      "accentCategory",
      "accentSeries",
      "data",
      "seriesColors",
    ]);
    const content = { kind: "bar", palette: "categorical", ...patch };
    const config = widgetChartConfig(content, "pl");
    expect(config.series.map((s) => s.name)).toEqual(["Eksport", "Saldo", "Import"]);
    expect(config.series.map((s) => s.colorSlot)).toEqual([3, 14, 12]);
    expect(config.accentSeries).toBe(2);
    expect(readWidgetGrid(String(patch.data), content, "pl")).toEqual(v);
  });

  it("echo własnego zapisu ma ten sam podpis co stan, który go wysłał", () => {
    const v = stan(2, 1);
    const patch = widgetGridPatch(v, "data");
    expect(widgetContentSignature(String(patch.data), patch)).toBe(widgetGridSignature(v));
    // Stan bez wyborów (kolory domyślne, akcent domyślny) nie zapisuje nic
    // poza danymi - echo przychodzi z treścią BEZ tych kluczy.
    const domyslny = readWidgetGrid("; A; B\n2024; 1; 2", {}, "pl");
    const p2 = widgetGridPatch(domyslny, "data");
    expect(widgetContentSignature(String(p2.data), {})).toBe(widgetGridSignature(domyslny));
  });

  it("pusta treść dostaje jedną serię i jeden wiersz w języku dokumentu", () => {
    const v = readWidgetGrid("", {}, "en");
    expect(v.model.series.map((s) => s.name)).toEqual(["Series A"]);
    expect(v.model.categories).toEqual(["2024"]);
    expect(v.model.series[0].values).toEqual([null]);
  });

  it("zatwierdzona liczba zmienia tylko swoją komórkę", () => {
    const v = gridSetValue(stan(), 1, 2, 42);
    expect(v.model.series[2].values).toEqual([7, 42, 9]);
    expect(v.model.series[0].values).toEqual([1, 2, 3]);
  });
});
