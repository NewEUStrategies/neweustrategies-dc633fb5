// BLOK CMS I WIDGET BUILDERA RYSUJĄ TEN SAM WYKRES - znacznik w znacznik.
//
// Oba wchodzą do tego samego silnika (`Chart`), ale każdy swoją drogą: blok
// parsuje Json bloku (`ChartBlockView` -> `parseChartConfig`), widget składa
// konfigurację z płaskich pól i tekstu CSV (`ChartWidgetView` ->
// `widgetChartConfig`). Drogi rozjeżdżały się po cichu (widget nie czytał
// notatek, daty danych, `n`, akcentu), więc ten sam wykres mówił czytelnikowi
// w bloku i w widgecie co innego.
//
// UMOWA: ten sam wykres zapisany w obu formach daje TEN SAM znacznik figury
// dla każdego z siedemnastu rodzajów. Jedyna różnica to margines zewnętrzny:
// widget stoi w ramie buildera, więc figura ma `my-0`, a blok w artykule -
// `my-6`. Identyfikatory `useId` liczą się od montowania, więc są
// normalizowane przed porównaniem.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import type { WidgetNode } from "@/lib/builder/types";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { ChartBlockView } from "@/components/blocks/DataVizViews";
import { ChartWidgetView } from "@/components/builder/organisms/widget-view/DataVizWidgets";

afterEach(cleanup);

const KATEGORIE = ["PL", "DE", "FR", "IT", "ES", "NL", "BE", "CZ"];
const A = [12, 31, 24, 19, 8, 27, 15, 22];
const B = [9, 28, 21, 23, 11, 24, 13, 18];

/** Wykres w kształcie bloku CMS. */
function blok(kind: ChartKind): Record<string, Json> {
  return {
    kind,
    title: "Handel zagraniczny",
    description: "Eksport i import",
    categories: KATEGORIE,
    // Sloty jak z tekstu CSV widgetu (`slotForSeries`: 3, 4).
    series: [
      { name: "Eksport", values: A, colorSlot: 3 },
      { name: "Import", values: B, colorSlot: 4 },
    ],
    unit: " mld EUR",
    height: 320,
    showLegend: true,
    showGrid: true,
    showValues: false,
    animate: false,
    source: "Eurostat",
    caption: "Dane roczne.",
    palette: "focus",
    accentSeries: 1,
    direction: "higher",
    provenance: "W",
    band: { min: 10, max: 20, sourceId: "band" },
    target: { value: 25 },
    sources: [
      {
        id: "band",
        author: "Eurostat",
        title: "Benchmark handlu",
        container: "",
        publisher: "",
        published: "",
        accessed: "",
        url: "https://example.org/benchmark",
        reliability: "",
      },
    ],
    sourceDate: "2025-06",
    sampleSize: 8,
    notesShows: "Eksport rośnie szybciej.",
    notesSurprising: "Czechy przed Włochami.",
    notesHidden: "Usługi poza zakresem.",
    demo: false,
  };
}

/** Ten sam wykres w kształcie treści widgetu buildera. */
function widget(kind: ChartKind): WidgetNode {
  const csv = ["; Eksport; Import", ...KATEGORIE.map((k, i) => `${k}; ${A[i]}; ${B[i]}`)].join(
    "\n",
  );
  return {
    id: "w1",
    kind: "widget",
    type: "chart",
    content: {
      kind,
      title_pl: "Handel zagraniczny",
      description_pl: "Eksport i import",
      data: csv,
      unit: " mld EUR",
      height: 320,
      showLegend: "on",
      showGrid: "on",
      showValues: "off",
      animate: "off",
      stacked: "off",
      source_pl: "Eurostat",
      caption_pl: "Dane roczne.",
      palette: "focus",
      accentSeries: 1,
      direction: "higher",
      provenance: "W",
      bandMin: "10",
      bandMax: "20",
      bandSourceAuthor: "Eurostat",
      bandSourceTitle: "Benchmark handlu",
      bandSourceUrl: "https://example.org/benchmark",
      target: "25",
      sourceDate: "2025-06",
      sampleSize: 8,
      notesShows_pl: "Eksport rośnie szybciej.",
      notesSurprising_pl: "Czechy przed Włochami.",
      notesHidden_pl: "Usługi poza zakresem.",
      demo: "off",
    },
  };
}

/** Znacznik figury bez identyfikatorów `useId` i bez klasy marginesu. */
function figura(root: HTMLElement): { html: string; margin: string[] } {
  const fig = root.querySelector("figure.neh-chart");
  if (fig === null) throw new Error("brak figury wykresu");
  const margin = (fig.getAttribute("class") ?? "").split(/\s+/).filter((c) => /^my-/.test(c));
  const kopia = fig.cloneNode(true) as HTMLElement;
  kopia.setAttribute(
    "class",
    (kopia.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((c) => !/^my-/.test(c))
      .sort()
      .join(" "),
  );
  return { html: kopia.outerHTML.replace(/_r_[0-9a-z]+_/g, "ID"), margin };
}

describe("ChartBlockView i ChartWidgetView - ta sama figura", () => {
  for (const kind of CHART_KINDS) {
    it(`${kind}: identyczny znacznik, widget bez marginesu zewnętrznego`, () => {
      const b = render(<ChartBlockView data={blok(kind)} lang="pl" />);
      const zBloku = figura(b.container);
      b.unmount();
      const w = render(<ChartWidgetView node={widget(kind)} lang="pl" />);
      const zWidgetu = figura(w.container);
      // Porównanie nie jest puste: figura niesie notatki, przypis źródła
      // pasma, datę danych i n - pola, które widget kiedyś gubił.
      expect(zBloku.html).toContain("Czechy przed Włochami.");
      expect(zBloku.html).toContain('class="neh-fn"');
      expect(zBloku.html).toContain("2025-06");
      expect(zWidgetu.html).toBe(zBloku.html);
      expect(zBloku.margin).toEqual(["my-6"]);
      expect(zWidgetu.margin).toEqual(["my-0"]);
    });
  }

  it("ten sam wykres po angielsku też jest identyczny", () => {
    const b = render(<ChartBlockView data={blok("bar")} lang="en" />);
    const zBloku = figura(b.container);
    b.unmount();
    const tresc = widget("bar");
    tresc.content = {
      ...tresc.content,
      title_en: "Handel zagraniczny",
      description_en: "Eksport i import",
    };
    const w = render(<ChartWidgetView node={tresc} lang="en" />);
    expect(figura(w.container).html).toBe(zBloku.html);
  });
});
