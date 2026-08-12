// Dostepnosc kart wykresow BI: kanwa ECharts jest dla czytnika ekranu pusta,
// wiec region musi miec nazwe, a dane - tekstowa alternatywe.
//
// Do 12.08 karta renderowala kanwe bez ani jednego atrybutu dostepnosci: caly
// pulpit /admin/analytics byl dla osoby niewidzacej zbiorem nieopisanych
// prostokatow, mimo ze dane do tabeli i tak jechaly obok wykresu na potrzeby
// eksportu CSV.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// EChart montuje prawdziwa instancje ECharts (kanwa + ResizeObserver) - w tescie
// zastepujemy go znacznikiem, bo przedmiotem testu jest OTOCZKA dostepnosci,
// nie renderer wykresu.
vi.mock("../EChart", () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));

// Podmieniamy WYLACZNIE `useTranslation`, resztę modułu zostawiamy prawdziwą:
// `src/lib/i18n.ts` wola `i18n.use(initReactI18next)` przy ewaluacji, a slownik
// analityki jest importowany przez ChartDataTable - pelny mock wywracal init.
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

describe("ChartCard - dostepnosc", () => {
  it("opisuje region wykresu nazwa zbudowana z tytulu", () => {
    render(<ChartCard title="Odslony wpisow" option={{}} />);

    expect(screen.getByRole("img", { name: "Chart: Odslony wpisow" })).toBeTruthy();
  });

  it("udostepnia dane jako tabele z naglowkami kolumn i wierszami", () => {
    render(<ChartCard title="Odslony wpisow" option={{}} csv={CSV} />);

    const table = screen.getByRole("table");
    expect(table).toBeTruthy();
    // Naglowki musza byc `<th scope="col">`, inaczej czytnik nie zwiaze komorki
    // z kolumna przy nawigacji po tabeli.
    const columnHeaders = screen.getAllByRole("columnheader");
    expect(columnHeaders.map((h) => h.textContent)).toEqual(["Dzien", "Odslony"]);
    expect(screen.getByText("2026-08-02")).toBeTruthy();
    expect(screen.getByText("1,580")).toBeTruthy();
  });

  it("wiaze region wykresu z tabela przez aria-describedby", () => {
    render(<ChartCard title="Odslony wpisow" option={{}} csv={CSV} />);

    const region = screen.getByRole("img", { name: "Chart: Odslony wpisow" });
    const describedBy = region.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toBeTruthy();
  });

  it("bez danych nie zmyśla tabeli, ale region nadal ma nazwe", () => {
    render(<ChartCard title="Bez danych" option={{}} />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("img", { name: "Chart: Bez danych" })).toBeTruthy();
  });

  it.each([
    ["puste wiersze", { filename: "e.csv", headers: ["Dzien"], rows: [] }],
    ["puste naglowki", { filename: "e.csv", headers: [], rows: [["x"]] }],
  ])("nie zostawia wiszacego aria-describedby przy %s", (_label, csv) => {
    // Zgloszone w recenzji PR #220: `csv` moze ISTNIEC i byc pusty - pulpit
    // w trakcie ladowania albo raport, ktory legalnie nie ma wynikow. Tabela
    // sie wtedy nie renderuje, wiec atrybut wskazywalby element, ktorego nie ma:
    // czytnik obiecuje opis i go nie dostarcza.
    render(<ChartCard title="Puste" option={{}} csv={csv as NonNullable<ChartCardProps["csv"]>} />);

    expect(screen.queryByRole("table")).toBeNull();
    const region = screen.getByRole("img", { name: "Chart: Puste" });
    expect(region.getAttribute("aria-describedby")).toBeNull();
  });

  it("dwie karty na jednej stronie maja ROZNE id tabel", () => {
    // slug(title) dawalby ten sam id dla dwoch kart o tym samym tytule w roznych
    // sekcjach pulpitu, a zduplikowany id rozjezdza aria-describedby.
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
