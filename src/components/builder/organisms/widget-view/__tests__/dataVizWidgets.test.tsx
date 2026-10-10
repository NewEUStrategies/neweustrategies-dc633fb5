// Renderery widgetów wizualizacji danych: parsowanie treści widgetu
// (CSV + pola i18n) -> wspólny silnik wykresów, oraz mapa z pobieraniem
// statycznego zasobu geometrii (fetch mockowany).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ChartWidgetView,
  DataMapWidgetView,
} from "@/components/builder/organisms/widget-view/DataVizWidgets";
import type { WidgetNode } from "@/lib/builder/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function node(type: WidgetNode["type"], content: WidgetNode["content"]): WidgetNode {
  return { id: "w1", kind: "widget", type, content };
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("ChartWidgetView", () => {
  const content: WidgetNode["content"] = {
    kind: "bar",
    title_pl: "Handel",
    title_en: "Trade",
    unit: " mld",
    data: "; Eksport; Import\n2023; 10; 7\n2024; 14; 9",
    stacked: "off",
    height: 320,
    showLegend: "on",
    showGrid: "on",
    showValues: "off",
    animate: "off",
    source_pl: "Źródło: test",
    source_en: "",
  };

  it("renders bars from the CSV data with the PL title", () => {
    const { container, getByText } = withClient(
      <ChartWidgetView node={node("chart", content)} lang="pl" />,
    );
    expect(getByText("Handel")).toBeTruthy();
    expect(container.querySelectorAll("path.neh-bar")).toHaveLength(4);
    // Podtytuł panelu: „jednostka. Źródło: X" - prefiks „Źródło:" wpisany
    // przez autora nie jest dublowany.
    expect(getByText("mld. Źródło: test")).toBeTruthy();
  });

  it("uses the EN title for lang=en and falls back to PL when missing", () => {
    const { getByText } = withClient(<ChartWidgetView node={node("chart", content)} lang="en" />);
    expect(getByText("Trade")).toBeTruthy();
    // source_en puste -> fallback do source_pl; prefiks idzie w języku strony.
    expect(getByText("mld. Source: test")).toBeTruthy();
  });

  it("renders the empty state for missing data", () => {
    const { getByText } = withClient(
      <ChartWidgetView node={node("chart", { data: "" })} lang="pl" />,
    );
    expect(getByText("Brak danych wykresu.")).toBeTruthy();
  });

  it("słupki są pełne także przy wariancie zapisanym przez starszy edytor", () => {
    // Specyfikacja systemu wykresów: słupek ma pełne wypełnienie w kolorze
    // serii. Warianty blady i gradientowy zniknęły z edytorów, ale treść
    // widgetu pochodzi z bazy i może je nadal nieść - nie mogą wrócić na
    // rysunek ani wywrócić strony.
    const jedna = { ...content, data: "; Eksport\n2023; 10\n2024; 14" };
    for (const style of ["pale", "gradient", "neon"]) {
      const { container, unmount } = withClient(
        <ChartWidgetView node={node("chart", { ...jedna, barStyle: style })} lang="pl" />,
      );
      const slupki = [...container.querySelectorAll("path.neh-bar")];
      expect(slupki.length).toBeGreaterThan(0);
      for (const slupek of slupki) {
        expect(slupek.getAttribute("data-style")).toBeNull();
        expect(slupek.getAttribute("fill")).toBe("var(--chart-accent)");
      }
      unmount();
    }
  });

  it("seria wyróżniona z treści widgetu dostaje akcent - pozostałe zachowują kolejność ról", () => {
    // Ta sama droga co blok CMS: `accentSeries` przechodzi przez parser
    // i rysownik maluje po RANDZE, nie po pozycji w arkuszu.
    const linia = { ...content, kind: "line", accentSeries: 1 };
    const { container } = withClient(<ChartWidgetView node={node("chart", linia)} lang="pl" />);
    const kreski = [...container.querySelectorAll("path.neh-line")].map((l) =>
      l.getAttribute("stroke"),
    );
    expect(kreski).toEqual(["var(--chart-s-main)", "var(--chart-accent)"]);
  });

  it("kolory serii z treści widgetu malują serie w palecie kategorialnej", () => {
    const kat = { ...content, kind: "line", palette: "categorical", seriesColors: "14;20" };
    const { container } = withClient(<ChartWidgetView node={node("chart", kat)} lang="pl" />);
    const kreski = [...container.querySelectorAll("path.neh-line")].map((l) =>
      l.getAttribute("stroke"),
    );
    expect(kreski).toEqual(["var(--chart-14)", "var(--chart-20)"]);
  });

  it("dane demonstracyjne z treści widgetu dostają znaczek „demo” przy tytule", () => {
    const { container } = withClient(
      <ChartWidgetView node={node("chart", { ...content, demo: "on" })} lang="pl" />,
    );
    expect(container.querySelector(".neh-badge")?.textContent).toBe("demo");
  });
});

describe("DataMapWidgetView", () => {
  const geoAsset = {
    v: 1,
    license: "test",
    viewBox: "0 0 960 825",
    countries: [
      { id: "PL", pl: "Polska", en: "Poland", d: "M10 10L20 10L20 20Z" },
      { id: "DE", pl: "Niemcy", en: "Germany", d: "M30 10L40 10L40 20Z" },
      { id: "FR", pl: "Francja", en: "France", d: "M50 10L60 10L60 20Z" },
    ],
  };

  it("renders the data table and fetches geometry for the SVG", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => geoAsset,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { container, getByText } = withClient(
      <DataMapWidgetView
        node={node("data-map", {
          region: "europe",
          title_pl: "Mapa",
          unit: "%",
          data: "PL; 38\nDE; 84",
          showLegend: "on",
          animate: "off",
        })}
        lang="pl"
      />,
    );

    expect(fetchMock).toHaveBeenCalledWith("/geo/europe-50m.v2.json");
    await waitFor(() => {
      expect(container.querySelectorAll("path.neh-country").length).toBe(3);
    });
    // Kraj z danymi jest fokusowalny i nazwany; tabela niesie wartości.
    const pl = container.querySelector('path[aria-label^="Polska"]');
    expect(pl).not.toBeNull();
    expect(getByText("Niemcy")).toBeTruthy();
  });

  it("renders the empty state without values", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => geoAsset })),
    );
    const { getByText } = withClient(
      <DataMapWidgetView node={node("data-map", { data: "" })} lang="pl" />,
    );
    expect(getByText("Brak danych mapy.")).toBeTruthy();
  });
});
