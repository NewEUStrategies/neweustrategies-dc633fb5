// D1 (brief 04) W RENDERZE: dymek i tabela mostka podają POZIOM PO KROKU.
//
// PO CO OSOBNY PLIK. Model (`lib/charts/waterfall.ts`) ma pole `level`
// i własny test, ale defekt żył w KONSUMENTACH: dymek (`CartesianChart`)
// i tabela danych (`Chart`) czytały `to`, czyli GÓRNĄ KRAWĘDŹ słupka. Dla
// kroku w dół górna krawędź to poziom SPRZED spadku - most MRR 100 → churn −5
// pisał „Poziom: 100” zamiast 95, a czytelnik sumujący mostek z dymków
// dostawał liczby, które się nie domykają. Ten plik przypina przejście reguły
// przez render, bo poprawny model nic nie znaczy, gdy widok czyta inne pole.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { Chart } from "../Chart";
import { CartesianChart } from "../CartesianChart";

// Mostek: 100 → +20 (120) → −5 (115) → −15 (100) → 100.
const BRIDGE: Record<string, Json> = {
  kind: "waterfall",
  categories: ["MRR start", "Nowe", "Churn", "Kontrakcja", "MRR koniec"],
  series: [{ name: "Mostek", values: [100, 20, -5, -15, 100] }],
  unit: " tys.",
  animate: false,
};

/** Kontener wykresu - jedyny element z fokusem; strzałki otwierają dymek kroku. */
function box(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>("[role='img']");
  if (!el) throw new Error("brak kontenera wykresu");
  return el;
}

/** Fakty dymku (`dd`) po wskazaniu kroku o danym indeksie. */
function tipFacts(root: HTMLElement, index: number): string[] {
  const el = box(root);
  for (let i = 0; i <= index; i += 1) fireEvent.keyDown(el, { key: "ArrowRight" });
  return [...root.querySelectorAll(".neh-tooltip dd")].map((d) => d.textContent ?? "");
}

describe("mostek - poziom po kroku w dymku i tabeli (D1)", () => {
  it("dymek kroku W DÓŁ: wkład −5 i poziom 115 (po spadku), nie 120 (krawędź słupka)", () => {
    const { container } = render(<CartesianChart config={parseChartConfig(BRIDGE)} lang="pl" />);
    const [, wklad, poziom] = tipFacts(container, 2);
    expect(wklad).toContain("-5");
    expect(poziom).toContain("115");
    expect(poziom).not.toContain("120");
  });

  it("dymek kroku W GÓRĘ: poziom po wzroście (120) - dla wzrostu krawędź i poziom są równe", () => {
    const { container } = render(<CartesianChart config={parseChartConfig(BRIDGE)} lang="pl" />);
    const [, wklad, poziom] = tipFacts(container, 1);
    expect(wklad).toContain("+20");
    expect(poziom).toContain("120");
  });

  it("tabela danych: kolumna poziomu niesie stan PO każdym kroku, filary - własną wartość", () => {
    const { container } = render(<Chart config={parseChartConfig(BRIDGE)} lang="pl" />);
    const poziomy = [...container.querySelectorAll("table tbody tr")].map((tr) => {
      const cells = tr.querySelectorAll("td");
      return cells[cells.length - 1]?.textContent ?? "";
    });
    expect(poziomy).toHaveLength(5);
    expect(poziomy.map((p) => p.replace(/\s/g, " "))).toEqual([
      expect.stringContaining("100"),
      expect.stringContaining("120"),
      expect.stringContaining("115"),
      expect.stringContaining("100"),
      expect.stringContaining("100"),
    ]);
  });
});
