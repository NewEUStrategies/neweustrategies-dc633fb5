// LINIA ŹRÓDŁA W DYMKU KAŻDEGO RODZAJU + ZWOLNIENIE Z TYPOGRAFII BUILDERA.
//
// LINIA ŹRÓDŁA. Specyfikacja dymka kończy go linią „Źródło: ..." - liczba bez
// pochodzenia jest w dymku tak samo goła jak w tekście. Do PR2 linię miał
// wyłącznie rysownik kartezjański; dwanaście pozostałych rodzajów oddawało
// dymek z samymi wierszami, więc ta sama liczba na histogramie i na słupku
// raz miała źródło, a raz nie.
//
// ZWOLNIENIE Z TYPOGRAFII. Reguły „Theme Design" widgetu buildera stawiają
// rozmiar, grubość i krój z `!important` na `p`, `span`, `dt`, `dd`,
// `button`, `figcaption`... - czyli na podtytule, legendzie, wierszach dymka
// i przyciskach wykresu. Rama (`figure.neh-chart`) i korzeń dymka niosą
// `data-typography-exempt`, a szablon i generator omijają ich POTOMKÓW
// (forma przodka, patrz `typographyExemptAncestor.test.ts`).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { Chart } from "../Chart";

afterEach(cleanup);

const DANE: Record<string, Json> = {
  categories: ["PL", "DE", "FR", "IT", "ES", "NL", "BE", "CZ", "HU", "AT", "SE", "DK"],
  series: [
    { name: "Wynik 2025", values: [12, 31, 24, 19, 8, 27, 15, 22, 6, 17, 29, 11] },
    { name: "Wynik 2024", values: [9, 28, 21, 23, 11, 24, 13, 18, 7, 15, 26, 14] },
    { name: "Zmiana", values: [3, 3, 3, -4, -3, 3, 2, 4, -1, 2, 3, -3] },
  ],
  unit: " mln EUR",
  animate: false,
  source: "Eurostat, 2025",
};

/**
 * Droga do dymka z klawiatury - ten sam podział co w bramkach `kindCaps`
 * i `everyKindRenders`. Mapa wyczerpująca po `ChartKind`: nowy rodzaj nie
 * skompiluje się bez deklaracji.
 */
const DOJSCIE: Record<ChartKind, "ArrowRight" | "ArrowDown" | "fokus"> = {
  line: "ArrowRight",
  area: "ArrowRight",
  bar: "ArrowRight",
  "bar-horizontal": "ArrowDown",
  waterfall: "ArrowRight",
  pie: "fokus",
  donut: "fokus",
  histogram: "ArrowRight",
  boxplot: "ArrowRight",
  beeswarm: "ArrowRight",
  scatter: "ArrowRight",
  heatmap: "ArrowRight",
  tornado: "ArrowDown",
  fan: "ArrowRight",
  "index-base": "ArrowRight",
  "percent-stacked": "ArrowRight",
  "small-multiples": "ArrowRight",
};

function otworzDymek(kind: ChartKind, extra: Record<string, Json> = {}): HTMLElement {
  const { container } = render(
    <Chart config={parseChartConfig({ ...DANE, kind, ...extra })} lang="pl" />,
  );
  const dojscie = DOJSCIE[kind];
  const cel = container.querySelector<HTMLElement>(
    dojscie === "fokus" ? "[tabindex='0']" : "[role='img'][tabindex='0']",
  );
  if (!cel) throw new Error(`${kind}: nie ma czego ogniskować`);
  if (dojscie === "fokus") fireEvent.focus(cel);
  else {
    fireEvent.keyDown(cel, { key: dojscie });
    fireEvent.keyDown(cel, { key: dojscie });
  }
  return container;
}

describe("dymek każdego rodzaju kończy się linią źródła", () => {
  for (const kind of CHART_KINDS) {
    it(`${kind}: „Źródło: ..." w dymku`, () => {
      const container = otworzDymek(kind);
      const dymek = container.querySelector(".neh-tooltip");
      expect(dymek, kind).not.toBeNull();
      expect(dymek?.querySelector(".neh-tip-source")?.textContent).toBe("Źródło: Eurostat, 2025");
    });
  }

  it("dane demonstracyjne mówią o tym w linii źródła, także poza rodzajami kartezjańskimi", () => {
    const container = otworzDymek("histogram", { demo: true });
    expect(container.querySelector(".neh-tip-source")?.textContent).toBe("Źródło: dane demo");
  });

  it("wykres bez źródła nie ma pustej linii źródła", () => {
    const container = otworzDymek("donut", { source: "" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
    expect(container.querySelector(".neh-tip-source")).toBeNull();
  });
});

describe("typografia widgetu buildera nie sięga do wykresu", () => {
  for (const kind of CHART_KINDS) {
    it(`${kind}: rama i korzeń dymka niosą data-typography-exempt`, () => {
      const container = otworzDymek(kind);
      const rama = container.querySelector("figure.neh-chart");
      expect(rama?.hasAttribute("data-typography-exempt")).toBe(true);
      expect(container.querySelector(".neh-tooltip")?.hasAttribute("data-typography-exempt")).toBe(
        true,
      );
    });
  }
});
