// Render + a11y (axe) dla silnika wykresów: kartezjański, kołowy, tabela
// danych i legenda. happy-dom ma IntersectionObserver, którego nie odpalamy -
// wykresy renderują wtedy stan KOŃCOWY ("static"), czyli dokładnie to, co
// widzi crawler / czytelnik bez JS.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Chart } from "./Chart";
import { parseChartConfig } from "@/lib/charts/parse";
import { axeViolations, summarize } from "@/test/axe";

const barConfig = parseChartConfig({
  kind: "bar",
  title: "Eksport wg lat",
  description: "Dane testowe",
  unit: " mld",
  categories: ["2021", "2022", "2023"],
  series: [
    { name: "Eksport", values: [120, 150, 170], colorSlot: 1 },
    { name: "Import", values: [80, 95, 110], colorSlot: 2 },
  ],
  source: "Źródło: test",
});

describe("Chart (cartesian)", () => {
  it("SSR-renders full final-state SVG marks (no JS gating)", () => {
    const { container } = render(<Chart config={barConfig} lang="pl" />);
    // 2 serie x 3 kategorie = 6 słupków.
    expect(container.querySelectorAll("path.neh-bar")).toHaveLength(6);
    // Brak klasy neh-armed - nic nie jest ukryte przed animacją.
    expect(container.querySelector(".neh-armed")).toBeNull();
  });

  it("shows a legend for >=2 series and a toggleable data table", () => {
    const { container, getByRole } = render(<Chart config={barConfig} lang="pl" />);
    const legend = container.querySelector("ul");
    expect(legend?.textContent).toContain("Eksport");
    expect(legend?.textContent).toContain("Import");
    const toggle = getByRole("button", { name: "Pokaż dane" });
    fireEvent.click(toggle);
    expect(getByRole("button", { name: "Ukryj dane" })).toBeTruthy();
    const table = container.querySelector("table");
    expect(table?.textContent).toContain("2022");
    expect(table?.textContent).toContain("150");
  });

  it("renders EN labels for lang=en", () => {
    const { getByRole } = render(<Chart config={barConfig} lang="en" />);
    expect(getByRole("button", { name: "Show data" })).toBeTruthy();
  });

  it("renders an empty-state note without data", () => {
    const { getByText } = render(
      <Chart config={parseChartConfig({ categories: [], series: [] })} lang="pl" />,
    );
    expect(getByText("Brak danych wykresu.")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Chart config={barConfig} lang="pl" />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("Chart (pie/donut)", () => {
  const pieConfig = parseChartConfig({
    kind: "donut",
    title: "Udział",
    categories: ["A", "B", "C"],
    series: [{ name: "Udział", values: [50, 30, 20], colorSlot: 1 }],
  });

  it("renders focusable slices with accessible names", () => {
    const { container } = render(<Chart config={pieConfig} lang="pl" />);
    const slices = container.querySelectorAll("path[tabindex='0']");
    expect(slices).toHaveLength(3);
    expect(slices[0].getAttribute("aria-label")).toContain("A");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Chart config={pieConfig} lang="pl" />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
