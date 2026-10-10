// SZACUNEK WYSOKOŚCI: WYKRES I MAPA DANYCH LICZĄ SIĘ Z TREŚCI (PR2).
//
// Stałe 360 px (wykres) i 420 px (mapa) były niedoszacowaniem: pomiar
// znacznika SSR z arkuszem produkcyjnym w Chromium dał 507 px dla wykresu
// domyślnego i 803-844 px dla mapy Europy. Niedoszacowanie to dokładnie ten
// błąd, którego szacunek ma unikać - pas za niski spycha treść pod sekcją.
//
// Moduł szacunku leży na ścieżce startowej, więc liczby silnika są w nim
// KOPIAMI (import jednej stałej wciągnąłby cały moduł silnika do chunka
// startowego). Ten plik pilnuje, żeby kopie nie odjechały od oryginałów -
// także od tego, co SSR naprawdę rysuje.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetNode } from "@/lib/builder/types";
import { CHART_HEIGHT_DEFAULT } from "@/lib/charts/parse";
import { REGION_ASPECT_FALLBACK } from "@/lib/charts/geoAspect";
import { MAP_REGIONS } from "@/lib/charts/types";
import { DataMapWidgetView } from "@/components/builder/organisms/widget-view/DataVizWidgets";
import {
  DATAVIZ_CHART_HEIGHT_DEFAULT,
  DATAVIZ_FRAME_PX,
  DATAVIZ_NOTE_PX,
  DATAVIZ_REGION_ASPECT,
  DATAVIZ_SSR_WIDTH_PX,
  estimateDataVizHeight,
  estimateWidgetHeight,
} from "@/lib/builder/sectionHeightEstimate";

function widget(type: string, content: Record<string, unknown>): WidgetNode {
  return { id: `${type}-1`, kind: "widget", type, content } as unknown as WidgetNode;
}

describe("kopie liczb silnika", () => {
  it("wysokość domyślna wykresu i aspekty regionów są te same co w silniku", () => {
    expect(DATAVIZ_CHART_HEIGHT_DEFAULT).toBe(CHART_HEIGHT_DEFAULT);
    expect({ ...DATAVIZ_REGION_ASPECT }).toEqual({ ...REGION_ASPECT_FALLBACK });
    expect(Object.keys(DATAVIZ_REGION_ASPECT).sort()).toEqual([...MAP_REGIONS].sort());
  });

  it.each(MAP_REGIONS)("rysunek SSR mapy %s ma wysokość z szerokości SSR i aspektu", (region) => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <DataMapWidgetView
          node={widget("data-map", { region, data: "PL; 1\nDE; 2", showLegend: "on" })}
          lang="pl"
        />
      </QueryClientProvider>,
    );
    const expected = Math.round(DATAVIZ_SSR_WIDTH_PX * DATAVIZ_REGION_ASPECT[region]);
    expect(html).toContain(`height:${expected}px`);
  });
});

describe("szacunek z treści", () => {
  it("wykres: wysokość rysunku z ustawienia + rama, z klamrą parsera", () => {
    expect(estimateDataVizHeight(widget("chart", {}))).toBe(320 + DATAVIZ_FRAME_PX);
    expect(estimateDataVizHeight(widget("chart", { height: 480 }))).toBe(480 + DATAVIZ_FRAME_PX);
    expect(estimateDataVizHeight(widget("chart", { height: 9999 }))).toBe(640 + DATAVIZ_FRAME_PX);
    expect(estimateDataVizHeight(widget("chart", { height: 10 }))).toBe(160 + DATAVIZ_FRAME_PX);
    expect(estimateDataVizHeight(widget("chart", { height: "480" }))).toBe(320 + DATAVIZ_FRAME_PX);
  });

  it("wypełnione zdania pod wykresem dokładają po linii, w każdym języku", () => {
    const content = {
      notesShows_pl: "Rośnie.",
      notesHidden_en: "No prices.",
      notesSurprising_pl: " ",
    };
    expect(estimateDataVizHeight(widget("chart", content))).toBe(
      320 + DATAVIZ_FRAME_PX + 2 * DATAVIZ_NOTE_PX,
    );
  });

  it("mapa: aspekt regionu; nieznany zapis (także klucz prototypu) to Europa", () => {
    const europa = Math.round(720 * (825 / 960)) + DATAVIZ_FRAME_PX;
    expect(estimateDataVizHeight(widget("data-map", { region: "europe" }))).toBe(europa);
    expect(estimateDataVizHeight(widget("data-map", {}))).toBe(europa);
    expect(estimateDataVizHeight(widget("data-map", { region: "atlantyda" }))).toBe(europa);
    expect(estimateDataVizHeight(widget("data-map", { region: "__proto__" }))).toBe(europa);
    expect(estimateDataVizHeight(widget("data-map", { region: "constructor" }))).toBe(europa);
    // Ameryka Południowa jest portretowa - mapa wyższa niż szeroka.
    expect(estimateDataVizHeight(widget("data-map", { region: "south-america" }))).toBe(
      Math.round(720 * (1143 / 960)) + DATAVIZ_FRAME_PX,
    );
  });

  it("pomiar w Chromium mieści się w szacunku (wolno przeszacować, nie niedoszacować)", () => {
    // 507 px wykresu domyślnego, 803 px mapy Europy przy 1110 px, 504 px świata.
    expect(estimateDataVizHeight(widget("chart", {}))).toBeGreaterThanOrEqual(507);
    expect(estimateDataVizHeight(widget("data-map", { region: "europe" }))).toBeGreaterThanOrEqual(
      803,
    );
    expect(estimateDataVizHeight(widget("data-map", { region: "world" }))).toBeGreaterThanOrEqual(
      504,
    );
  });

  it("inne typy nie są liczone z treści, a wysokość autora bije szacunek", () => {
    expect(estimateDataVizHeight(widget("heading", {}))).toBeUndefined();
    expect(estimateWidgetHeight(widget("chart", {}))).toBe(320 + DATAVIZ_FRAME_PX);
  });
});
