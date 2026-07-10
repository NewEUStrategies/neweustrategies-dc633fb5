// Renderery widgetów wizualizacji danych: parsowanie treści widgetu
// (CSV + pola i18n) -> wspólny silnik wykresów, oraz mapa z pobieraniem
// statycznego zasobu geometrii (fetch mockowany).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ChartWidgetView,
  DataMapWidgetView,
} from "@/components/admin/builder/ui/organisms/widget-view/DataVizWidgets";
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
    expect(getByText("Źródło: test")).toBeTruthy();
  });

  it("uses the EN title for lang=en and falls back to PL when missing", () => {
    const { getByText } = withClient(<ChartWidgetView node={node("chart", content)} lang="en" />);
    expect(getByText("Trade")).toBeTruthy();
    // source_en puste -> fallback do source_pl.
    expect(getByText("Źródło: test")).toBeTruthy();
  });

  it("renders the empty state for missing data", () => {
    const { getByText } = withClient(
      <ChartWidgetView node={node("chart", { data: "" })} lang="pl" />,
    );
    expect(getByText("Brak danych wykresu.")).toBeTruthy();
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

    expect(fetchMock).toHaveBeenCalledWith("/geo/europe-50m.v1.json");
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
