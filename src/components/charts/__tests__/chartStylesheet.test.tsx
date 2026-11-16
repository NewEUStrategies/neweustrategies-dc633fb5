// ARKUSZ WYKRESÓW JEDZIE Z HTML-EM SERWERA (roadmapa 9.3, S1).
//
// Reguły i tokeny wykresów nie stoją już w arkuszu głównym, więc wykres z HTML-a serwera
// musi sam nieść link zasobu, który React hoistuje do `<head>` (powłoka) albo którym
// wstrzymuje odsłonięcie granicy strumienia (`$RR`) - inaczej wykres stałby bez stylów aż do
// bootu. Ten sam kontrakt co `components/maps/__tests__/WorldMap.test.tsx`.
//
// Vitest nie przepuszcza CSS przez potok Vite, więc `?url` nie ma tu adresu: atrapa to adres
// `data:`, który happy-dom wczytuje bez sieci.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/components/charts/chart-sheet.css?url", () => ({
  default: "data:text/css,.neh-chart%7B%7D",
}));

import { Chart } from "@/components/charts/Chart";
import { IndicatorCard } from "@/components/features/IndicatorCard";
import { parseChartConfig } from "@/lib/charts/parse";

const LINK =
  /<link rel="stylesheet" href="data:text\/css,\.neh-chart%7B%7D" data-precedence="default"\/>/g;

describe("ChartStylesheet - link arkusza wykresów w HTML-u serwera", () => {
  it("wykres emituje dokładnie jeden link z precedencją grupy arkusza głównego", () => {
    const html = renderToString(
      <Chart
        config={parseChartConfig({
          kind: "bar",
          categories: ["A", "B"],
          series: [{ name: "S", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    // Rama i rysunek renderują link każdy osobno - React deduplikuje zasób po `href`.
    expect(html.match(LINK)).toHaveLength(1);
  });

  it("pusty stan wykresu (promień z `--chart-radius`) też go niesie", () => {
    const html = renderToString(
      <Chart config={parseChartConfig({ kind: "bar", categories: [], series: [] })} lang="pl" />,
    );
    expect(html).toContain("rounded-[var(--chart-radius)]");
    expect(html.match(LINK)).toHaveLength(1);
  });

  it("widok features malujący tokenem niesie link poza ramą wykresu", () => {
    const html = renderToString(
      <IndicatorCard
        config={{
          label: "Indeks",
          value: "72,4",
          unit: "/100",
          delta: "+5,1",
          deltaLabel: "r/r",
          deltaArrow: "up",
          deltaTone: "positive",
          spark: [58, 61, 60, 64, 72.4],
          source: "",
          href: "",
        }}
      />,
    );
    expect(html).toContain("var(--chart-positive-text)");
    expect(html.match(LINK)).toHaveLength(1);
  });
});
