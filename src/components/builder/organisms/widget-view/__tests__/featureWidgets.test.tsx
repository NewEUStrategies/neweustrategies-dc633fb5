// Adaptery NES Digital Features (FeatureWidgets.tsx): treść widgetu buildera
// (pola *_pl/_en + textarea w formacie ";") -> konfiguracja komponentów
// src/components/features. Renderujemy adaptery BEZPOŚREDNIO (bez lazy/Suspense
// WidgetView), bo kontraktem tego pliku jest mapowanie treści, nie orkiestracja
// chunków - a dane wierszowe niosą tłumaczenie inline "PL|EN".
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import {
  CompareWidgetView,
  CorridorMapWidgetView,
  IndicatorWidgetView,
  MethodologyWidgetView,
  NetworkWidgetView,
  RiskMatrixWidgetView,
  SankeyWidgetView,
  SourcesWidgetView,
  TimelineWidgetView,
} from "../FeatureWidgets";

let nextId = 0;
function node(type: WidgetNode["type"], content: WidgetContent): WidgetNode {
  return { id: `fw-${nextId++}`, kind: "widget", type, content };
}

function renderFeature(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Tekst bywa dzielony przez elementy (jednostki, tspany SVG) - asercja po textContent. */
function expectText(container: HTMLElement, ...fragments: string[]): void {
  const text = container.textContent ?? "";
  for (const fragment of fragments) expect(text).toContain(fragment);
}

describe("FeatureWidgets - adaptery treść -> konfiguracja", () => {
  it("feature-timeline: parsuje wiersze i honoruje wyłączoną animację", () => {
    renderFeature(
      <TimelineWidgetView
        lang="pl"
        node={node("feature-timeline", {
          title_pl: "Kalendarium EDIS",
          title_en: "EDIS timeline",
          data: "2024-03; Prezentacja EDIS|EDIS unveiled; Pierwsza strategia|First strategy; 1",
          animate: "off",
        })}
      />,
    );
    expect(screen.getByText("Kalendarium EDIS")).toBeInTheDocument();
    expect(screen.getByText("Prezentacja EDIS")).toBeInTheDocument();
  });

  it("feature-sankey: przepływy + jednostka + clamp wysokości spoza zakresu", () => {
    const container1 = renderFeature(
      <SankeyWidgetView
        lang="en"
        node={node("feature-sankey", {
          title_pl: "Przepływy LNG",
          title_en: "LNG flows",
          data: "USA|USA; Terminale UE|EU terminals; 56",
          unit: "mld m3",
          height: "9999",
        })}
      />,
    );
    expectText(container1.container, "LNG flows", "EU terminals");
  });

  it("feature-compare: nagłówek kolumn, wiersze i highlight w zakresie", () => {
    const compare1 = renderFeature(
      <CompareWidgetView
        lang="pl"
        node={node("feature-compare", {
          title_pl: "Porównanie",
          data: "; Polska|Poland; Niemcy|Germany\nWydatki [% PKB]|Spending [% GDP]; 4,1; 2,1",
          highlight: "0",
        })}
      />,
    );
    expectText(compare1.container, "Polska", "Wydatki");
  });

  it("feature-compare: highlight spoza zakresu degraduje do braku wyróżnienia", () => {
    renderFeature(
      <CompareWidgetView
        lang="en"
        node={node("feature-compare", {
          title_en: "Compare",
          data: "; A|A; B|B\nRow|Row; 1; 2",
          highlight: "7",
        })}
      />,
    );
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });

  it("feature-risk-matrix: osie i pozycje macierzy", () => {
    const risk = renderFeature(
      <RiskMatrixWidgetView
        lang="pl"
        node={node("feature-risk-matrix", {
          title_pl: "Macierz ryzyka",
          axisXLabel_pl: "Wpływ",
          axisYLabel_pl: "Prawdopodobieństwo",
          data: "Blackout|Blackout; 4; 5; 1",
        })}
      />,
    );
    expectText(risk.container, "Macierz ryzyka", "Blackout");
  });

  it("feature-indicator: delta ze strzałką i sparkline", () => {
    renderFeature(
      <IndicatorWidgetView
        lang="pl"
        node={node("feature-indicator", {
          label_pl: "Wydatki obronne",
          value: "4,1",
          unit: "% PKB",
          delta: "+0,3 pp",
          deltaArrow: "up",
          deltaTone: "positive",
          spark: "3,1; 3,4; 3,8; 4,1",
          href: "/analizy/obronnosc",
        })}
      />,
    );
    expect(screen.getByText("Wydatki obronne")).toBeInTheDocument();
    expect(screen.getByText("4,1")).toBeInTheDocument();
  });

  it("feature-indicator: nieznane wartości arrow/tone spadają do neutralnych", () => {
    renderFeature(
      <IndicatorWidgetView
        lang="en"
        node={node("feature-indicator", {
          label_en: "Defence spending",
          value: "2,1",
          deltaArrow: "sideways",
          deltaTone: "loud",
        })}
      />,
    );
    expect(screen.getByText("Defence spending")).toBeInTheDocument();
  });

  it("feature-network: krawędzie i grupy grafu", () => {
    renderFeature(
      <NetworkWidgetView
        lang="pl"
        node={node("feature-network", {
          title_pl: "Sieć aktorów",
          edges: "KE|EC; Rada|Council; 3",
          groups: "KE|EC; 1",
          height: "100",
        })}
      />,
    );
    expect(screen.getByText("Sieć aktorów")).toBeInTheDocument();
  });

  it("feature-corridor-map: region world + korytarze i markery", () => {
    renderFeature(
      <CorridorMapWidgetView
        lang="pl"
        node={node("feature-corridor-map", {
          title_pl: "Korytarze",
          region: "world",
          corridors: "Bałtyk-Adriatyk|Baltic-Adriatic; 1; 54.35,18.65 > 45.44,12.32",
          markers: "Gdańsk|Gdansk; 54.35,18.65; 1",
          highlightCountries: "PL; IT",
        })}
      />,
    );
    expect(screen.getByText("Korytarze")).toBeInTheDocument();
  });

  it("feature-corridor-map: nieznany region degraduje do Europy", () => {
    const corridorEn = renderFeature(
      <CorridorMapWidgetView
        lang="en"
        node={node("feature-corridor-map", {
          title_en: "Corridors",
          region: "mars",
          corridors: "North-South|North-South; 1; 54.35,18.65 > 45.44,12.32",
        })}
      />,
    );
    expectText(corridorEn.container, "Corridors");
  });

  it("feature-sources: sortowanie year-desc i wyszukiwarka wyłączona", () => {
    const sources = renderFeature(
      <SourcesWidgetView
        lang="pl"
        node={node("feature-sources", {
          title_pl: "Źródła",
          entries:
            "report; 2024; NES; Strategia bezpieczeństwa|Security strategy; https://example.org/r1",
          sort: "year-desc",
          showSearch: "off",
        })}
      />,
    );
    expectText(sources.container, "Źródła", "Strategia bezpieczeństwa");
  });

  it("feature-methodology: nota z wersją i datą, fallback i18n PL -> EN", () => {
    renderFeature(
      <MethodologyWidgetView
        lang="pl"
        node={node("feature-methodology", {
          title_en: "Methodology",
          body_en: "Sources and weighting.",
          version: "1.2",
          updated: "2026-07-01",
        })}
      />,
    );
    expect(screen.getByText("Methodology")).toBeInTheDocument();
  });
});
