// EKSPORT PNG I SVG DLA KAŻDEGO RODZAJU - przycisk, który nic nie robi, jest
// gorszy od jego braku.
//
// CO SIĘ DZIAŁO. Rama szukała rysunku pod `.neh-canvas svg` i wychodziła
// BEZ SŁOWA, gdy go nie znalazła. Tarcza i pierścień nie miały tej klasy,
// więc przyciski PNG i SVG nad nimi wyglądały na działające, a nie robiły
// niczego - bez pliku i bez komunikatu. Kartogram (W4) jest w tej samej
// sytuacji.
//
// CO PILNUJE TA BRAMKA, na TYCH SAMYCH danych dla wszystkich rodzajów
// (lista z `CHART_KINDS`, więc rodzaj dopisany w przyszłości wchodzi tu sam):
//   1. kliknięcie SVG oddaje funkcji eksportu NIEPUSTY `<svg>` rysunku,
//   2. kliknięcie PNG robi to samo i niesie klucz (tarcza: wycinki z udziałem),
//   3. żaden rodzaj nie pokazuje komunikatu „nie udało się zapisać",
//   4. rama kartogramu (rodzina `map`) znajduje cel `[data-chart-canvas] svg`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import type { WpisKlucza } from "@/lib/charts/exportImage";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { Chart } from "../Chart";
import { ChartFrame, type ChartCaption } from "../ChartFrame";

const eksport = vi.hoisted(() => ({
  pobierzPlik: vi.fn(),
  svgDoPliku: vi.fn((svg: SVGSVGElement) => new Blob([svg.tagName], { type: "image/svg+xml" })),
  svgDoPng: vi.fn<
    (
      svg: SVGSVGElement,
      opts: { background: string; scale?: number; klucz?: readonly WpisKlucza[] },
    ) => Promise<Blob>
  >(async () => new Blob(["png"], { type: "image/png" })),
}));

vi.mock("@/lib/charts/exportImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/charts/exportImage")>()),
  pobierzPlik: eksport.pobierzPlik,
  svgDoPliku: eksport.svgDoPliku,
  svgDoPng: eksport.svgDoPng,
}));

afterEach(() => {
  cleanup();
  eksport.pobierzPlik.mockClear();
  eksport.svgDoPliku.mockClear();
  eksport.svgDoPng.mockClear();
});

/** Ten sam zestaw co w bramce `everyKindRenders` - rodzaj ma działać na danych autora. */
const DANE: Record<string, Json> = {
  categories: [
    "Polska",
    "Niemcy",
    "Francja",
    "Włochy",
    "Hiszpania",
    "Holandia",
    "Belgia",
    "Czechy",
    "Węgry",
    "Austria",
    "Szwecja",
    "Dania",
  ],
  series: [
    { name: "Wynik 2025", values: [12, 31, 24, 19, 8, 27, 15, 22, 6, 17, 29, 11] },
    { name: "Wynik 2024", values: [9, 28, 21, 23, 11, 24, 13, 18, 7, 15, 26, 14] },
    { name: "Zmiana", values: [3, 3, 3, -4, -3, 3, 2, 4, -1, 2, 3, -3] },
  ],
  unit: " mln EUR",
  animate: false,
  sampleSize: 12,
};

const EXPORT_FAILED = "Nie udało się zapisać pliku. Spróbuj ponownie.";

function renderKind(kind: ChartKind) {
  return render(
    <Chart config={parseChartConfig({ ...DANE, kind, title: `Wykres ${kind}` })} lang="pl" />,
  );
}

describe("eksport rysunku - każdy rodzaj", () => {
  for (const kind of CHART_KINDS) {
    it(`${kind}: SVG i PNG dostają niepusty <svg> rysunku`, async () => {
      const { container } = renderKind(kind);
      // Cel eksportu stoi w drzewie, zanim ktokolwiek kliknie.
      const cel = container.querySelector("[data-chart-canvas] svg");
      expect(cel, `${kind}: brak [data-chart-canvas] svg`).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako SVG" }));
      expect(eksport.svgDoPliku).toHaveBeenCalledTimes(1);
      const svg = eksport.svgDoPliku.mock.calls[0][0];
      expect(svg).toBe(cel);
      expect(svg.tagName.toLowerCase()).toBe("svg");
      // Rysunek, nie pusta skorupa: w środku są znaczniki.
      expect(svg.querySelectorAll("*").length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako PNG" }));
      await waitFor(() => expect(eksport.svgDoPng).toHaveBeenCalledTimes(1));
      expect(eksport.svgDoPng.mock.calls[0][0]).toBe(cel);
      await waitFor(() => expect(eksport.pobierzPlik).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(EXPORT_FAILED)).toBeNull();
    });
  }

  it("tarcza dokłada do PNG klucz z wycinkami i udziałami (nie ma legendy ramy)", async () => {
    renderKind("donut");
    fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako PNG" }));
    await waitFor(() => expect(eksport.svgDoPng).toHaveBeenCalledTimes(1));
    const klucz = eksport.svgDoPng.mock.calls[0][1].klucz ?? [];
    // Pięć wycinków: cztery największe i „Pozostałe".
    expect(klucz).toHaveLength(5);
    expect(klucz[0].label).toMatch(/^Niemcy \d/);
    expect(klucz.at(-1)?.label).toMatch(/^Pozostałe \d/);
  });
});

describe("eksport rysunku - rama kartogramu", () => {
  const CAPTION: ChartCaption = {
    source: "",
    sourceDate: "",
    unit: "",
    sampleSize: null,
    zeroBaselineBroken: false,
    shareSumMismatch: null,
    notesShows: "",
    notesSurprising: "",
    notesHidden: "",
  };

  it("rama z rodziną `map` eksportuje `[data-chart-canvas] svg` - cel, który stawia kartogram", () => {
    // Kartogram (`ChoroplethMap`, tor W4) owija swój rysunek znacznikiem
    // `data-chart-canvas`; ta bramka pilnuje drugiej strony umowy - że rama
    // z rodziną mapy ten cel znajduje i oddaje go eksportowi.
    render(
      <ChartFrame
        title="Mapa"
        description=""
        lang="pl"
        metric={null}
        legend={[]}
        showLegend={false}
        caption={CAPTION}
        table={null}
        meta={{
          family: "map",
          demo: false,
          provenance: null,
          sources: [],
          hasBand: false,
          hasTarget: false,
          zoomable: false,
        }}
      >
        <div data-chart-canvas>
          <svg id="mapa">
            <path d="M0 0L10 10" />
          </svg>
        </div>
      </ChartFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako SVG" }));
    expect(eksport.svgDoPliku).toHaveBeenCalledTimes(1);
    expect(eksport.svgDoPliku.mock.calls[0][0].id).toBe("mapa");
    expect(screen.queryByText(EXPORT_FAILED)).toBeNull();
  });
});
