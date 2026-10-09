// BRAMKA ZDOLNOŚCI RODZAJÓW. `KIND_CAPS` steruje tym, co edytory oferują
// autorowi i co rama obiecuje czytelnikowi, więc tabela kłamiąca w KTÓRĄKOLWIEK
// stronę jest defektem widocznym dla ludzi:
//   * flaga `true` bez rysunku - autor ustawia pasmo, którego nikt nie zobaczy,
//   * rysunek bez flagi - rodzaj umie coś narysować, a edytor tego nie oferuje.
// Dlatego każda flaga jest sprawdzana RENDEREM, w obie strony, na tych samych
// danych dla wszystkich rodzajów.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import { Chart } from "@/components/charts/Chart";

afterEach(cleanup);

const ZRODLO = {
  id: "bench",
  author: "Eurostat",
  title: "Benchmark",
  publisher: "Eurostat",
  url: "https://example.org/benchmark",
};

const KATEGORIE = ["PL", "DE", "FR", "IT", "ES", "NL", "BE", "CZ", "HU", "AT", "SE", "DK"];
const SERIE = [
  { name: "Wynik 2025", values: [12, 31, 24, 19, 8, 27, 15, 22, 6, 17, 29, 11] },
  { name: "Wynik 2024", values: [9, 28, 21, 23, 11, 24, 13, 18, 7, 15, 26, 14] },
  { name: "Zmiana", values: [3, 3, 3, -4, -3, 3, 2, 4, -1, 2, 3, -3] },
  { name: "Plan", values: [10, 25, 20, 20, 10, 25, 15, 20, 8, 16, 27, 12] },
  { name: "Mediana", values: [11, 27, 22, 21, 9, 26, 14, 20, 7, 16, 28, 13] },
];

/** Wskaźnik z KOMPLETEM odniesień: pasmo ze źródłem, cel i kierunek. */
function dane(kind: ChartKind, extra: Record<string, Json> = {}): Record<string, Json> {
  return {
    kind,
    categories: KATEGORIE,
    series: SERIE.slice(0, 3),
    unit: " mln EUR",
    animate: false,
    direction: "higher",
    band: { min: 10, max: 20, sourceId: "bench" },
    target: { value: 25 },
    sources: [ZRODLO],
    ...extra,
  };
}

function renderKind(kind: ChartKind, extra: Record<string, Json> = {}) {
  return render(<Chart config={parseChartConfig(dane(kind, extra))} lang="pl" />);
}

/** Kolory znaczników rysunku (bez identyfikatorów definicji, które są per instancja). */
function podpisKolorow(root: HTMLElement): string {
  return [...root.querySelectorAll("svg *")]
    .map((el) =>
      ["fill", "stroke", "style"]
        .map((a) => (el.getAttribute(a) ?? "").replace(/url\(#[^)]*\)/g, "url(#)"))
        .join("|"),
    )
    .join("\n");
}

/**
 * Jak dojść do tooltipa z klawiatury - ten sam podział, co w bramce
 * `everyKindRenders`: ogniskowalny kontener ze strzałkami albo ogniskowalny
 * każdy znacznik osobno (wycinki tarczy). Mapa wyczerpująca po `ChartKind`,
 * więc nowy rodzaj nie skompiluje się bez deklaracji. Wartość to klawisz
 * „dalej" kontenera - kategorie słupków poziomych i parametry tornada
 * biegną w pionie.
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

describe("KIND_CAPS - tabela jest kompletna i spójna", () => {
  it("ma wpis dla KAŻDEGO rodzaju i żadnego więcej", () => {
    expect(Object.keys(KIND_CAPS).sort()).toEqual([...CHART_KINDS].sort());
  });

  it("flagi nie przeczą sobie nawzajem", () => {
    for (const kind of CHART_KINDS) {
      const caps = KIND_CAPS[kind];
      // Kolor kodujący wartość albo znak nie jest wyborem - paleta nie ma tu
      // czego zmieniać.
      if (caps.colorTarget === "encoded") expect(caps.palette, kind).toBe(false);
      // Przełączać w legendzie da się tylko serie.
      if (caps.legendToggle) expect(caps.colorTarget, kind).toBe("series");
      // Cel i pasmo stoją na osi wartości - rodzaje bez niej ich nie mają.
      if (caps.band || caps.target) expect(caps.family, kind).toBe("cartesian");
    }
  });
});

describe("KIND_CAPS - każda flaga zgadza się z rysunkiem", () => {
  for (const kind of CHART_KINDS) {
    const caps = KIND_CAPS[kind];

    it(`${kind}: pasmo optimum ze źródłem ${caps.band ? "JEST" : "NIE jest"} rysowane`, () => {
      const { container } = renderKind(kind);
      expect(container.querySelector("[data-role='optimum-band']") !== null).toBe(caps.band);
    });

    it(`${kind}: linia celu ${caps.target ? "JEST" : "NIE jest"} rysowana`, () => {
      const { container } = renderKind(kind);
      expect(container.querySelector("[data-role='target']") !== null).toBe(caps.target);
    });

    it(`${kind}: legenda ${caps.legendToggle ? "PRZEŁĄCZA" : "NIE przełącza"} serii`, () => {
      // Pięć serii, bo przy 2-4 seriach linii legendę zastępują etykiety przy
      // końcu linii - wtedy przełącznika nie byłoby z innego powodu.
      const { container } = renderKind(kind, { series: SERIE, showLegend: true });
      expect(container.querySelector(".neh-legend [aria-pressed]") !== null).toBe(
        caps.legendToggle,
      );
    });

    it(`${kind}: wybór palety ${caps.palette ? "ZMIENIA" : "NIE zmienia"} rysunku`, () => {
      const focus = renderKind(kind, { palette: "focus" });
      const wFocus = podpisKolorow(focus.container);
      focus.unmount();
      const kat = renderKind(kind, { palette: "categorical" });
      const wKat = podpisKolorow(kat.container);
      expect(wFocus !== wKat).toBe(caps.palette);
    });

    it(`${kind}: tooltip ${caps.facts ? "MA" : "NIE ma"} siatki ocen`, () => {
      const { container } = renderKind(kind);
      const dojscie = DOJSCIE[kind];
      const cel = container.querySelector<HTMLElement>(
        dojscie === "fokus" ? "[tabindex='0']" : "[role='img'][tabindex='0']",
      );
      if (!cel) throw new Error(`${kind}: nie ma czego ogniskować`);
      if (dojscie === "fokus") {
        fireEvent.focus(cel);
      } else {
        // Dwa kroki: przy drugim punkcie istnieje poprzedni, więc „Zmiana"
        // ma z czym się porównać.
        fireEvent.keyDown(cel, { key: dojscie });
        fireEvent.keyDown(cel, { key: dojscie });
      }
      expect(container.querySelector(".neh-tooltip")).not.toBeNull();
      expect(container.querySelector(".neh-tip-facts") !== null).toBe(caps.facts);
    });
  }
});
