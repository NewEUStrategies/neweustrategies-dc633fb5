// WYCINEK WYRÓŻNIONY TARCZY (`accentCategory`) I KOLORY WYCINKÓW.
//
// Model tarczy (`pieModel`) rozstrzyga RAZ, który wycinek jest wyróżniony
// i jakim kolorem maluje się każdy łuk - rysunek, tabela klucza, dymek
// i klucz eksportu czytają to samo pole. Ta bramka pilnuje reguł:
//   * `accentCategory` wskazuje kategorię (indeks w arkuszu); `null` albo
//     kategoria, której tarcza nie rysuje, oddaje akcent wycinkowi
//     największemu;
//   * wycinek wyróżniony NIGDY nie znika w „Pozostałych": głowa to wyróżniony
//     plus największe pozostałe (razem PIE_MAX_SLICES-1) i wycinek zbiorczy;
//   * paleta ról: wyróżniony w akcencie, reszta w stopniach neutralnych
//     w kolejności rysowania; paleta kategorialna: `SLOT_SEQUENCE` po pozycji,
//     nigdy slot 2 (pomarańcz marki) dla wycinka, który się nie wyróżnia;
//   * `PieSlice.index` to indeks kategorii, `null` dla wycinka zbiorczego.
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { PIE_MAX_SLICES } from "@/lib/charts/types";
import { SLOT_SEQUENCE } from "@/lib/charts/palette";
import { pieModel } from "../pieModel";

function model(values: (number | null)[], extra: Record<string, Json> = {}) {
  return pieModel(
    parseChartConfig({
      kind: "pie",
      categories: values.map((_, i) => `K${i}`),
      series: [{ name: "S", values }],
      ...extra,
    }),
    "pl",
  );
}

describe("wycinek wyróżniony", () => {
  it("bez wyboru akcent dostaje wycinek NAJWIĘKSZY", () => {
    const m = model([5, 40, 10, 20]);
    expect(m.slices.map((s) => s.label)).toEqual(["K1", "K3", "K2", "K0"]);
    expect(m.slices.map((s) => s.accent)).toEqual([true, false, false, false]);
    expect(m.slices[0].color).toBe("var(--chart-accent)");
  });

  it("`accentCategory` przenosi akcent na wskazaną kategorię, kolejność zostaje malejąca", () => {
    const m = model([5, 40, 10, 20], { accentCategory: 2 });
    expect(m.slices.map((s) => s.label)).toEqual(["K1", "K3", "K2", "K0"]);
    const wyrozniony = m.slices.find((s) => s.accent);
    expect(wyrozniony?.index).toBe(2);
    expect(wyrozniony?.color).toBe("var(--chart-accent)");
    // Pozostałe w neutralnych, w kolejności rysowania.
    expect(m.slices.filter((s) => !s.accent).map((s) => s.color)).toEqual([
      "var(--chart-s-main)",
      "color-mix(in oklab, var(--chart-s-alt) 50%, var(--chart-s-main))",
      "var(--chart-s-alt)",
    ]);
  });

  it("kategoria, której tarcza nie rysuje (zero, brak, ujemna), oddaje akcent największemu", () => {
    for (const accentCategory of [0, 1, 2]) {
      const m = model([0, null, -4, 7, 9], { accentCategory });
      expect(m.slices.find((s) => s.accent)?.index, String(accentCategory)).toBe(4);
    }
  });

  it("wyróżniony NIGDY nie znika w „Pozostałych” - głowa to on plus największe pozostałe", () => {
    // Dziesięć kategorii, wyróżniona NAJMNIEJSZA (indeks 9, wartość 1).
    const values = [50, 45, 40, 35, 30, 25, 20, 15, 10, 1];
    const m = model(values, { accentCategory: 9 });
    expect(m.slices).toHaveLength(PIE_MAX_SLICES);
    const wlasne = m.slices.filter((s) => s.index !== null);
    expect(wlasne).toHaveLength(PIE_MAX_SLICES - 1);
    expect(wlasne.map((s) => s.index)).toEqual([0, 1, 2, 9]);
    const zbiorczy = m.slices.at(-1);
    expect(zbiorczy?.index).toBeNull();
    expect(zbiorczy?.label).toBe("Pozostałe");
    expect(zbiorczy?.value).toBe(35 + 30 + 25 + 20 + 15 + 10);
    expect(m.slices.find((s) => s.accent)?.index).toBe(9);
    // Mianownik bez zmian: suma wszystkich dodatnich.
    expect(m.total).toBe(values.reduce((a, v) => a + v, 0));
  });

  it("wycinek zbiorczy nigdy nie jest wyróżniony i dostaje stopień najjaśniejszy", () => {
    const m = model([50, 45, 40, 35, 30, 25]);
    const zbiorczy = m.slices.at(-1);
    expect(zbiorczy?.accent).toBe(false);
    expect(zbiorczy?.color).toBe("var(--chart-s-alt)");
  });
});

describe("paleta kategorialna tarczy", () => {
  it("sloty z `SLOT_SEQUENCE` po pozycji - nigdy slot 2 (pomarańcz marki)", () => {
    const m = model([50, 45, 40, 35, 30, 25, 20], { palette: "categorical" });
    expect(m.slices.map((s) => s.colorSlot)).toEqual(SLOT_SEQUENCE.slice(0, PIE_MAX_SLICES));
    expect(m.slices.map((s) => s.color)).toEqual(
      SLOT_SEQUENCE.slice(0, PIE_MAX_SLICES).map((n) => `var(--chart-${n})`),
    );
    expect(SLOT_SEQUENCE.slice(0, PIE_MAX_SLICES)).not.toContain(2);
  });

  it("wybór akcentu nie przemalowuje palety kategorialnej - tylko chroni wycinek przed ogonem", () => {
    const m = model([50, 45, 40, 35, 30, 25, 20], { palette: "categorical", accentCategory: 6 });
    expect(m.slices.map((s) => s.color)).toEqual(
      SLOT_SEQUENCE.slice(0, PIE_MAX_SLICES).map((n) => `var(--chart-${n})`),
    );
    expect(m.slices.some((s) => s.index === 6)).toBe(true);
  });
});
