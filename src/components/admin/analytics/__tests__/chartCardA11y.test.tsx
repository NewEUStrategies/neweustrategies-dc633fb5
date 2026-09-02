// Dostępność kart wykresów BI: kanwa ECharts jest dla czytnika ekranu pusta,
// więc region musi mieć nazwę, a dane - tekstową alternatywę.
//
// Do 12.08 karta renderowała kanwę bez ani jednego atrybutu dostępności: cały
// pulpit /admin/analytics był dla osoby niewidzącej zbiorem nieopisanych
// prostokątów, mimo że dane do tabeli i tak jechały obok wykresu na potrzeby
// eksportu CSV.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// EChart montuje prawdziwą instancję ECharts (kanwa + ResizeObserver) - w teście
// zastępujemy go znacznikiem, bo przedmiotem testu jest OTOCZKA dostępności,
// nie renderer wykresu.
vi.mock("../EChart", () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));

// Podmieniamy WYŁĄCZNIE `useTranslation`, resztę modułu zostawiamy prawdziwą:
// `src/lib/i18n.ts` woła `i18n.use(initReactI18next)` przy ewaluacji, a słownik
// analityki jest importowany przez ChartDataTable - pełny mock wywracał init.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === "adminAnalytics.chartCard.chartRegion") return `Chart: ${String(opts?.title)}`;
      if (key === "adminAnalytics.chartCard.dataTable") return "Chart data (table)";
      if (key === "adminAnalytics.chartCard.dataTableHint") return "Same content as the chart.";
      return key;
    },
  }),
}));

import type { ChartCardProps } from "../ChartCard";

// Dynamiczny import PO `vi.mock`, żeby karta zobaczyła podmieniony `useTranslation`.
const { ChartCard } = await import("../ChartCard");

const CSV: NonNullable<ChartCardProps["csv"]> = {
  filename: "views.csv",
  headers: ["Dzien", "Odslony"],
  rows: [
    ["2026-08-01", 1200],
    ["2026-08-02", 1580],
  ],
};

describe("ChartCard - dostępność", () => {
  it("opisuje region wykresu nazwą zbudowaną z tytułu", () => {
    render(<ChartCard title="Odslony wpisow" option={{}} />);

    expect(screen.getByRole("img", { name: "Chart: Odslony wpisow" })).toBeTruthy();
  });

  it("udostępnia dane jako tabelę z nagłówkami kolumn i wierszami", () => {
    render(<ChartCard title="Odslony wpisow" option={{}} csv={CSV} />);

    const table = screen.getByRole("table");
    expect(table).toBeTruthy();
    // Nagłówki muszą być `<th scope="col">`, inaczej czytnik nie zwiąże komórki
    // z kolumną przy nawigacji po tabeli.
    const columnHeaders = screen.getAllByRole("columnheader");
    expect(columnHeaders.map((h) => h.textContent)).toEqual(["Dzien", "Odslony"]);
    expect(screen.getByText("2026-08-02")).toBeTruthy();
    expect(screen.getByText("1,580")).toBeTruthy();
  });

  it("wiąże region wykresu z tabelą przez aria-describedby", () => {
    render(<ChartCard title="Odslony wpisow" option={{}} csv={CSV} />);

    const region = screen.getByRole("img", { name: "Chart: Odslony wpisow" });
    const describedBy = region.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toBeTruthy();
  });

  it("bez danych nie zmyśla tabeli, ale region nadal ma nazwę", () => {
    render(<ChartCard title="Bez danych" option={{}} />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("img", { name: "Chart: Bez danych" })).toBeTruthy();
  });

  it.each([
    ["puste wiersze", { filename: "e.csv", headers: ["Dzien"], rows: [] }],
    ["puste naglowki", { filename: "e.csv", headers: [], rows: [["x"]] }],
  ])("nie zostawia wiszącego aria-describedby przy %s", (_label, csv) => {
    // Zgłoszone w recenzji PR #220: `csv` może ISTNIEĆ i być pusty - pulpit
    // w trakcie ładowania albo raport, który legalnie nie ma wyników. Tabela
    // się wtedy nie renderuje, więc atrybut wskazywałby element, którego nie ma:
    // czytnik obiecuje opis i go nie dostarcza.
    render(<ChartCard title="Puste" option={{}} csv={csv as NonNullable<ChartCardProps["csv"]>} />);

    expect(screen.queryByRole("table")).toBeNull();
    const region = screen.getByRole("img", { name: "Chart: Puste" });
    expect(region.getAttribute("aria-describedby")).toBeNull();
  });

  it("dwie karty na jednej stronie mają RÓŻNE id tabel", () => {
    // slug(title) dawałby ten sam id dla dwóch kart o tym samym tytule w różnych
    // sekcjach pulpitu, a zduplikowany id rozjeżdża aria-describedby.
    render(
      <>
        <ChartCard title="Ten sam tytul" option={{}} csv={CSV} />
        <ChartCard title="Ten sam tytul" option={{}} csv={CSV} />
      </>,
    );

    const ids = screen.getAllByRole("img").map((region) => region.getAttribute("aria-describedby"));
    expect(ids[0]).not.toBe(ids[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
