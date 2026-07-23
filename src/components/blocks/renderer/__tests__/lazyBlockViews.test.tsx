// Ciężkie / rzadkie bloki dynamiczne renderera są code-splitowane (React.lazy)
// przez lazyBlockViews.tsx, żeby czytelnik zwykłego artykułu nie ściągał ich
// kodu. Ten test pilnuje dwóch niezmienników:
//   1. dyspozytor rejestru dalej trzyma FUNKCJĘ renderera dla każdego z tych
//      typów (leniwy jest komponent w środku, nie wpis w mapie) - inaczej
//      BlockView[type](ctx) rzuciłby na produkcji;
//   2. leniwy chunk faktycznie się rozwiązuje i renderuje IDENTYCZNĄ treść
//      (tu: pełny, statyczny SVG wykresu), więc SSR/CSR i crawler dostają to
//      samo, co przed podziałem - tyle że pobrane na żądanie.
import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { Json } from "@/lib/blocks/types";
import { BLOCK_RENDERERS } from "../registry";
import { ChartBlockView } from "../lazyBlockViews";

describe("lazyBlockViews - registry integrity", () => {
  it("keeps a function renderer for every deferred block type", () => {
    // Podział dotyczy komponentu w środku renderera, nie samego wpisu w mapie.
    for (const type of ["liveblog", "poll", "calendar", "chart", "data-map"] as const) {
      expect(typeof BLOCK_RENDERERS[type]).toBe("function");
    }
  });
});

describe("lazyBlockViews - deferred chunk resolves to real content", () => {
  it("renders the full static chart SVG once the lazy chunk loads", async () => {
    const data: Record<string, Json> = {
      kind: "bar",
      title: "Eksport wg lat",
      categories: ["2021", "2022", "2023"],
      series: [
        { name: "Eksport", values: [120, 150, 170], colorSlot: 1 },
        { name: "Import", values: [80, 95, 110], colorSlot: 2 },
      ],
    };
    // Wrapper niesie własny <Suspense fallback={null}> - renderujemy wprost.
    const { container } = render(<ChartBlockView data={data} lang="pl" cls="" />);
    // Zanim chunk się rozwiąże, boundary jest pusty (fallback null) - to jest
    // dokładnie kontrakt „SSR wypełnia, klient dogrywa na żądanie".
    await waitFor(() => {
      // 2 serie x 3 kategorie = 6 słupków w finalnym stanie SVG.
      expect(container.querySelectorAll("path.neh-bar")).toHaveLength(6);
    });
  });
});
