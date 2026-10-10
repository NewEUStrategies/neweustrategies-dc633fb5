// PRÓBKI SERII W EDYTORZE = KOLORY NA RYSUNKU, W KAŻDYM RODZAJU (przegląd końcowy PR2).
//
// Edytor liczył próbki jedną drogą (`seriesPaint` z rangą po pozycji serii),
// a dwa rodzaje malują inaczej:
//   * małe panele - `kindSinglePaint` ze slotem panelu: pod paletą ról
//     KAŻDY panel jest akcentem, a serii wyróżnionej rysunek nie czyta;
//   * wykres punktowy z nieliczbowymi kategoriami - pierwsza seria to oś X,
//     a akcent i role idą po CHMURACH (`cloudPaints`).
// Edytor pokazywał więc próbki, etykiety ról i wybór serii wyróżnionej,
// które nie zgadzały się z rysunkiem. Ten plik przypina:
//   1. próbki obu rodzajów z przypadków z przeglądu;
//   2. BRAMKĘ: dla każdego rodzaju z kolorem serii i obu palet próbka edytora
//      to kolor, którym renderer naprawdę maluje serię (legenda ramy, a przy
//      panelach - linia panelu), a seria, której rysunek nie maluje, nie ma
//      próbki;
//   3. siatkę: przy panelach nie ma wyboru serii wyróżnionej, etykiet ról ani
//      próbnika, a przy chmurach kolumna osi X nie ma próbki i nie da się jej
//      wyróżnić.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import type { Json } from "@/lib/content-model/json";
import { CHART_KINDS, type ChartKind, type ChartSeries } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { ROLE } from "@/lib/charts/roles";
import type { ChartPalette } from "@/lib/charts/seriesStyle";
import { Chart } from "@/components/charts/Chart";
import { ChartDataGrid } from "../ChartDataGrid";
import { colorsBySeries, drawnSeriesSwatches, seriesAccentDrawn } from "../chartColorSlots";
import type { ChartGridValue } from "../chartGridState";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

afterEach(() => cleanup());

const s = (name: string, values: (number | null)[], colorSlot: number): ChartSeries => ({
  name,
  values,
  colorSlot,
});

const KRAJE = ["Polska", "Niemcy", "Francja"];
const TRZY = [s("PKB", [1, 2, 3], 1), s("Eksport", [4, 6, 5], 3), s("Import", [7, 8, 9], 4)];

describe("1. próbki z przypadków przeglądu", () => {
  it("małe panele, paleta ról: każdy panel w akcencie, bez ról i bez próbnika", () => {
    const probki = drawnSeriesSwatches(
      "small-multiples",
      { categories: KRAJE, series: TRZY },
      0,
      "focus",
    );
    expect(probki).toEqual([
      { color: ROLE.acc, role: null, pickable: false },
      { color: ROLE.acc, role: null, pickable: false },
      { color: ROLE.acc, role: null, pickable: false },
    ]);
  });

  it("małe panele, paleta kategorialna: jedna farba panelu, slot serii jej nie zmienia", () => {
    const probki = drawnSeriesSwatches(
      "small-multiples",
      { categories: KRAJE, series: TRZY },
      0,
      "categorical",
    );
    expect(new Set(probki?.map((p) => p?.color)).size).toBe(1);
    expect(probki?.every((p) => p !== null && !p.pickable)).toBe(true);
  });

  it("chmura z kolumną osi X: kolumna X bez próbki, akcent i role po chmurach", () => {
    const dane = { categories: KRAJE, series: TRZY };
    expect(drawnSeriesSwatches("scatter", dane, 0, "focus")).toEqual([
      null,
      { color: ROLE.acc, role: 0, pickable: false },
      { color: ROLE.sMain, role: 1, pickable: false },
    ]);
    expect(drawnSeriesSwatches("scatter", dane, 2, "focus")).toEqual([
      null,
      { color: ROLE.sMain, role: 1, pickable: false },
      { color: ROLE.acc, role: 0, pickable: false },
    ]);
    // Dwie kolumny (X i Y): jedyna chmura jest akcentem.
    expect(
      drawnSeriesSwatches("scatter", { categories: KRAJE, series: TRZY.slice(0, 2) }, 0, "focus"),
    ).toEqual([null, { color: ROLE.acc, role: 0, pickable: false }]);
  });

  it("serię wyróżnioną pokazuje edytor tylko tam, gdzie rysunek ją rysuje", () => {
    expect(seriesAccentDrawn("small-multiples")).toBe(false);
    expect(seriesAccentDrawn("scatter")).toBe(true);
    expect(seriesAccentDrawn("bar")).toBe(true);
    expect(seriesAccentDrawn("pie")).toBe(false);
    expect(seriesAccentDrawn("heatmap")).toBe(false);
  });
});

// Pięć serii: indeks bazowy przy 2-4 seriach zastępuje legendę etykietami.
const DANE: Record<string, Json> = {
  categories: ["Polska", "Niemcy", "Francja", "Włochy", "Hiszpania", "Holandia"],
  series: [
    { name: "Wynik 2025", values: [12, 31, 24, 19, 8, 27] },
    { name: "Wynik 2024", values: [9, 28, 21, 23, 11, 24] },
    { name: "Plan", values: [10, 25, 20, 20, 10, 25] },
    { name: "Mediana", values: [11, 27, 22, 21, 9, 26] },
    { name: "Cel", values: [14, 30, 26, 24, 12, 29] },
  ],
  unit: " mln EUR",
  animate: false,
  sampleSize: 6,
  showLegend: true,
};

describe("2. bramka: próbka edytora = farba renderera, każdy rodzaj z kolorem serii", () => {
  const rodzaje = CHART_KINDS.filter(colorsBySeries);
  for (const kind of rodzaje) {
    for (const palette of ["focus", "categorical"] as ChartPalette[]) {
      for (const accentSeries of [0, 2]) {
        it(`${kind}, ${palette}, seria wyróżniona ${accentSeries}`, () => {
          const config = parseChartConfig({ ...DANE, kind, palette, accentSeries });
          const probki = drawnSeriesSwatches(
            kind,
            { categories: config.categories, series: config.series },
            config.accentSeries,
            palette,
          );
          expect(probki).not.toBeNull();
          const { container } = render(<Chart config={config} lang="pl" />);
          const indeks = (nazwa: string | null) =>
            config.series.findIndex((x) => x.name === (nazwa ?? "").trim());
          const narysowane = new Map<number, string>();
          // Rodzaje bez legendy serii niosą kolor na znacznikach rysunku.
          if (kind === "small-multiples") {
            for (const panel of container.querySelectorAll("[data-role='panel']")) {
              const linia = panel.querySelector("[data-role='panel-line']");
              const i = indeks(panel.getAttribute("data-panel-label"));
              if (linia !== null && i !== -1) narysowane.set(i, linia.getAttribute("stroke") ?? "");
            }
          } else if (kind === "boxplot") {
            // Pudła w kolejności serii; kolor roli niesie `--neh-bar-token`.
            container.querySelectorAll("[data-role='box']").forEach((pudlo, i) => {
              narysowane.set(i, pudlo.getAttribute("style") ?? "");
            });
          } else if (kind === "beeswarm") {
            for (const kropka of container.querySelectorAll("[data-role='swarm-point']")) {
              narysowane.set(
                Number(kropka.getAttribute("data-swarm")),
                kropka.getAttribute("fill") ?? "",
              );
            }
          } else {
            for (const li of container.querySelectorAll(".neh-legend > li")) {
              const probka = li.querySelector(".neh-legend-swatch");
              narysowane.set(indeks(li.textContent), probka?.getAttribute("style") ?? "");
            }
          }
          expect(narysowane.size, kind).toBeGreaterThan(1);
          expect(narysowane.has(-1), kind).toBe(false);
          probki?.forEach((p, i) => {
            if (p === null) {
              // Seria, której rysunek nie maluje (oś X chmury), nie ma próbki.
              expect(narysowane.has(i), `${kind}: ${config.series[i].name}`).toBe(false);
              return;
            }
            const farba = narysowane.get(i);
            expect(farba, `${kind}: ${config.series[i].name}`).toBeDefined();
            expect(farba, `${kind}: ${config.series[i].name}`).toContain(p.color);
          });
        });
      }
    }
  }
});

describe("3. siatka danych mówi to, co rysunek", () => {
  const siatka = (series: ChartSeries[]): ChartGridValue => ({
    model: { categories: KRAJE, series },
    accentSeries: 0,
    accentCategory: null,
  });
  const zamontuj = (kind: ChartKind, palette: ChartPalette) =>
    render(
      <ChartDataGrid
        value={siatka(TRZY)}
        onChange={() => {}}
        kind={kind}
        palette={palette}
        docLang="pl"
        lang="pl"
      />,
    );

  it("małe panele: bez wyboru serii wyróżnionej, bez ról i bez próbnika", () => {
    zamontuj("small-multiples", "focus");
    expect(screen.queryByRole("combobox", { name: "Seria wyróżniona" })).toBeNull();
    expect(screen.queryByText("Akcent")).toBeNull();
    expect(screen.queryByText(/Kolory daje paleta ról/)).toBeNull();
    cleanup();
    zamontuj("small-multiples", "categorical");
    expect(screen.queryByRole("button", { name: /Kolor serii/ })).toBeNull();
  });

  it("chmura: kolumna osi X bez próbki i poza wyborem serii wyróżnionej", () => {
    const { container } = zamontuj("scatter", "focus");
    const naglowki = [...container.querySelectorAll("thead th")].slice(2);
    expect(within(naglowki[0] as HTMLElement).queryByText("Akcent")).toBeNull();
    expect(within(naglowki[1] as HTMLElement).getByText("Akcent")).toBeInTheDocument();
    const wybor = screen.getByRole("combobox", { name: "Seria wyróżniona" });
    const opcje = within(wybor)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opcje).toEqual(["Eksport", "Import"]);
  });
});
