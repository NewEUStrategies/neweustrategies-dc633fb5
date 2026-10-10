// WYCINEK WYRÓŻNIONY W PALECIE KATEGORIALNEJ MA WIDOCZNY NOŚNIK (uwaga
// przeglądu PR #489).
//
// Pod paletą ról wycinek wyróżniony jest w akcencie z obrysem audytowym. Pod
// paletą kategorialną zachowuje kolor swojego slotu - i bez obrysu wybór
// „Wycinek wyróżniony" w edytorze nie zmieniał rysunku wcale, o ile nic nie
// trafiało do „Pozostałe". Teraz nośnikiem jest obrys tuszem głównym, a
// pozostałe wycinki obrysu nie mają.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { PieChart } from "../PieChart";

function tarcza(palette: "focus" | "categorical", accentCategory: number): HTMLElement {
  const config = parseChartConfig({
    kind: "pie",
    palette,
    accentCategory,
    categories: ["A", "B", "C"],
    series: [{ name: "Udział", values: [50, 30, 20] }],
  } as Record<string, Json>);
  return render(<PieChart config={config} lang="pl" />).container;
}

function wycinki(root: HTMLElement): SVGPathElement[] {
  return [...root.querySelectorAll<SVGPathElement>("path.neh-slice")];
}

describe("wycinek wyróżniony w palecie kategorialnej", () => {
  it("ma obrys tuszem głównym i znacznik grubszego obrysu; inne wycinki - żadnego", () => {
    const [a, b, c] = wycinki(tarcza("categorical", 1));
    expect(b.getAttribute("data-accent")).toBe("true");
    expect(b.getAttribute("stroke")).toBe("var(--chart-ink)");
    expect(b.getAttribute("data-accent-outline")).toBe("true");
    // Kolor wypełnienia zostaje kolorem slotu, nie akcentem.
    expect(b.getAttribute("fill")).toMatch(/^var\(--chart-\d+\)$/);
    for (const w of [a, c]) {
      expect(w.getAttribute("stroke")).toBe("none");
      expect(w.hasAttribute("data-accent-outline")).toBe(false);
    }
  });

  it("zmiana wycinka wyróżnionego zmienia rysunek także bez „Pozostałe”", () => {
    const pierwszy = wycinki(tarcza("categorical", 0)).map((w) => w.getAttribute("stroke"));
    const drugi = wycinki(tarcza("categorical", 2)).map((w) => w.getAttribute("stroke"));
    expect(pierwszy).not.toEqual(drugi);
  });

  it("paleta ról bez zmian: akcent z obrysem audytowym, bez znacznika grubszego obrysu", () => {
    const [a] = wycinki(tarcza("focus", 0));
    expect(a.getAttribute("stroke")).toBe("var(--chart-accent-audit-graphic)");
    expect(a.hasAttribute("data-accent-outline")).toBe(false);
  });
});
