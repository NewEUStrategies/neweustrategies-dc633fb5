// TARCZA W PLIKU: LICZBY CZYTELNE I WYCINKI NAZWANE.
//
// Pod paletą ról (domyślną) liczba w łuku idzie tuszem głównym z obwódką
// płyty, a wycinki poza wyróżnionym są stopniami szarości. W pliku SVG
// eksport zdejmował klasy i `style`, więc:
//   1. obwódka traciła `paint-order: stroke` i malowała się NA cyfrach,
//   2. klucz (tabela HTML pod rysunkiem) jechał wyłącznie do PNG - w SVG
//      szare wycinki bez liczby w łuku nie miały nazwy.
// Ta bramka renderuje PRAWDZIWĄ tarczę i przepuszcza ją przez prawdziwe
// `svgZWklejonaFarba`; podmieniona jest tylko funkcja zapisu pliku.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { svgZWklejonaFarba, type WpisKlucza } from "@/lib/charts/exportImage";
import { Chart } from "../Chart";

const eksport = vi.hoisted(() => ({
  pobierzPlik: vi.fn(),
  svgDoPliku: vi.fn<
    (
      svg: SVGSVGElement,
      opts?: { background?: string; fontFamily?: string; klucz?: readonly WpisKlucza[] },
    ) => Blob
  >(() => new Blob(["svg"], { type: "image/svg+xml" })),
}));

vi.mock("@/lib/charts/exportImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/charts/exportImage")>()),
  pobierzPlik: eksport.pobierzPlik,
  svgDoPliku: eksport.svgDoPliku,
}));

afterEach(() => {
  cleanup();
  eksport.pobierzPlik.mockClear();
  eksport.svgDoPliku.mockClear();
});

const DANE: Record<string, Json> = {
  categories: ["Polska", "Niemcy", "Francja", "Włochy", "Hiszpania", "Holandia", "Belgia"],
  series: [{ name: "Udział", values: [22, 31, 18, 12, 8, 5, 4] }],
  unit: "%",
  animate: false,
};

function tarcza(kind: "pie" | "donut", extra: Record<string, Json> = {}) {
  return render(
    <Chart config={parseChartConfig({ ...DANE, kind, title: "Udziały", ...extra })} lang="pl" />,
  );
}

describe("liczba w łuku z obwódką płyty", () => {
  for (const kind of ["pie", "donut"] as const) {
    it(`${kind}: obwódka ma kolejność malowania w atrybucie i ta przeżywa eksport`, () => {
      const { container } = tarcza(kind);
      const halo = [...container.querySelectorAll("text[data-halo='true']")];
      expect(halo.length).toBeGreaterThan(0);
      for (const t of halo) expect(t.getAttribute("paint-order")).toBe("stroke");

      const svg = container.querySelector<SVGSVGElement>("[data-chart-canvas] svg");
      expect(svg).not.toBeNull();
      const klon = svgZWklejonaFarba(svg as SVGSVGElement);
      const wPliku = [...klon.querySelectorAll("text")].filter((t) =>
        /%$/.test(t.textContent ?? ""),
      );
      expect(wPliku.length).toBeGreaterThan(0);
      for (const t of wPliku) {
        // Liczba bez obwódki (paleta kategorialna) nie potrzebuje kolejności;
        // liczba z obwódką MUSI ją mieć.
        if (t.hasAttribute("stroke") && t.getAttribute("stroke") !== "none") {
          expect(t.getAttribute("paint-order")).toBe("stroke");
        }
      }
      expect(
        [...klon.querySelectorAll("text")].filter((t) => t.getAttribute("paint-order") === "stroke")
          .length,
      ).toBe(halo.length);
    });
  }

  it("paleta kategorialna: tusz slotu, bez obwódki i bez kolejności", () => {
    const { container } = tarcza("pie", { palette: "categorical" });
    expect(container.querySelectorAll("text[data-halo]")).toHaveLength(0);
    expect(container.querySelectorAll("text[paint-order]")).toHaveLength(0);
  });
});

describe("klucz tarczy w pliku SVG", () => {
  it("SVG dostaje ten sam klucz co PNG - wycinki z udziałem", async () => {
    tarcza("donut");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako SVG" }));
    // Moduł eksportu doładowuje się po kliknięciu (dynamiczny import).
    await waitFor(() => expect(eksport.svgDoPliku).toHaveBeenCalledTimes(1));
    const klucz = eksport.svgDoPliku.mock.calls[0][1]?.klucz ?? [];
    expect(klucz.length).toBeGreaterThan(1);
    expect(klucz[0].label).toMatch(/^Niemcy \d/);
    for (const wpis of klucz) {
      expect(wpis.color).not.toBe("");
      expect(wpis.textColor).not.toBe("");
    }
  });
});
