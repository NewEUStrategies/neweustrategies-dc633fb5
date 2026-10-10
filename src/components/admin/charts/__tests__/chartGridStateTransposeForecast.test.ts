// OBRÓT ARKUSZA A GRANICA PROGNOZY (uwaga przeglądu PR #489).
//
// Granica prognozy wskazuje KATEGORIĘ. Po obrocie kategoriami są dawne serie,
// więc zachowany indeks oznaczałby prognozą przypadkową kolumnę (albo, poza
// zakresem, granica znikałaby po cichu w parserze). Obrót unieważnia granicę:
// zapis bloku i widgetu usuwa klucz z treści, a treść bez granicy zostaje bez
// klucza.
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/blocks/types";
import {
  blockGridChanges,
  gridTranspose,
  readBlockGrid,
  readWidgetGrid,
  widgetGridPatch,
} from "../chartGridState";

const BLOK: Record<string, Json> = {
  categories: ["2023", "2024", "2025"],
  series: [
    { name: "Eksport", values: [1, 2, 3] },
    { name: "Import", values: [4, 5, 6] },
  ],
};

describe("obrót unieważnia granicę prognozy", () => {
  it("blok: klucz `forecastFrom` jest usuwany (undefined w łatce)", () => {
    const zmiany = blockGridChanges(gridTranspose(readBlockGrid({ ...BLOK, forecastFrom: 1 })));
    expect("forecastFrom" in zmiany).toBe(true);
    expect(zmiany.forecastFrom).toBeUndefined();
    expect(zmiany.categories).toEqual(["Eksport", "Import"]);
  });

  it("blok bez granicy: obrót nie dopisuje klucza", () => {
    const zmiany = blockGridChanges(gridTranspose(readBlockGrid(BLOK)));
    expect("forecastFrom" in zmiany).toBe(false);
  });

  it("widget: łatka usuwa numer granicy, a widget bez granicy go nie dostaje", () => {
    const csv = "; Eksport; Import\n2023; 1; 4\n2024; 2; 5\n2025; 3; 6";
    const z = widgetGridPatch(
      gridTranspose(readWidgetGrid(csv, { forecastFrom: 2 }, "pl")),
      "data",
    );
    expect("forecastFrom" in z).toBe(true);
    expect(z.forecastFrom).toBeUndefined();
    const bez = widgetGridPatch(gridTranspose(readWidgetGrid(csv, {}, "pl")), "data");
    expect("forecastFrom" in bez).toBe(false);
  });
});
