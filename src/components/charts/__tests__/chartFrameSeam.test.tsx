// RAMA WYKRESU - SZWY PR2: cel eksportu, błąd widoczny, klasy, teksty pomocy.
//
// PO CO OSOBNY PLIK. Rama (`ChartFrame`) jest wspólna dla 17 rodzajów wykresu
// i - od PR2 - kartogramu, który nie ma osi, serii ani legendy ramy. Szwy
// dołożone w P0a są małe, ale każdy z nich psuł się dotąd CICHO:
//   * eksport szukał wyłącznie `.neh-canvas svg`; rysunek bez tej klasy
//     (tarcza) dostawał przycisk, który po kliknięciu nie robił NIC - bez
//     pliku i bez komunikatu. Teraz celem jest `[data-chart-canvas] svg`
//     (z `.neh-canvas svg` jako aliasem), a brak rysunku to widoczny błąd;
//   * klasa wołającego doklejana na koniec listy nie WYGRYWAŁA z domyślnym
//     marginesem - `my-0` z podglądu edytora stało obok `my-6` i o wyniku
//     decydowała kolejność reguł w arkuszu. Teraz `cn` (tailwind-merge);
//   * teksty „Jak czytać" i klucz eksportu przychodzą od rysunku (`meta.help`,
//     `meta.exportKey`), gdy ogólne zdania słownika i legenda ramy nie pasują.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { WpisKlucza } from "@/lib/charts/exportImage";
import { ChartFrame, type ChartCaption, type ChartPanelMeta } from "../ChartFrame";

const exportMocks = vi.hoisted(() => ({
  pobierzPlik: vi.fn(),
  svgDoPliku: vi.fn((svg: SVGSVGElement) => new Blob([svg.id], { type: "image/svg+xml" })),
  svgDoPng: vi.fn<
    (
      svg: SVGSVGElement,
      opts: { background: string; scale?: number; klucz?: readonly WpisKlucza[] },
    ) => Promise<Blob>
  >(async () => new Blob(["png"], { type: "image/png" })),
}));

vi.mock("@/lib/charts/exportImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/charts/exportImage")>()),
  pobierzPlik: exportMocks.pobierzPlik,
  svgDoPliku: exportMocks.svgDoPliku,
  svgDoPng: exportMocks.svgDoPng,
}));

afterEach(() => {
  cleanup();
  exportMocks.pobierzPlik.mockClear();
  exportMocks.svgDoPliku.mockClear();
  exportMocks.svgDoPng.mockClear();
});

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

const META: ChartPanelMeta = {
  demo: false,
  provenance: null,
  sources: [],
  hasBand: false,
  hasTarget: false,
  zoomable: false,
};

const EXPORT_FAILED = "Nie udało się zapisać pliku. Spróbuj ponownie.";

function frame(children: ReactNode, extra: { className?: string; meta?: ChartPanelMeta } = {}) {
  return render(
    <ChartFrame
      title="Wykres testowy"
      description=""
      lang="pl"
      metric={null}
      legend={[]}
      showLegend={false}
      caption={CAPTION}
      table={null}
      className={extra.className}
      meta={extra.meta ?? META}
    >
      {children}
    </ChartFrame>,
  );
}

const zapiszSvg = () =>
  fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako SVG" }));
const zapiszPng = () =>
  fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako PNG" }));

describe("cel eksportu", () => {
  it("rysunek w `[data-chart-canvas]` jest eksportowany i nie ma komunikatu o błędzie", async () => {
    frame(
      <div data-chart-canvas>
        <svg id="rysunek" />
      </div>,
    );
    zapiszSvg();
    await waitFor(() => expect(exportMocks.pobierzPlik).toHaveBeenCalledTimes(1));
    expect(exportMocks.svgDoPliku.mock.calls[0]?.[0]).toHaveProperty("id", "rysunek");
    expect(screen.queryByText(EXPORT_FAILED)).toBeNull();
  });

  it("`.neh-canvas svg` zostaje aliasem dla rysunków bez znacznika", async () => {
    frame(
      <div className="neh-canvas">
        <svg id="stary" />
      </div>,
    );
    zapiszSvg();
    await waitFor(() => expect(exportMocks.pobierzPlik).toHaveBeenCalledTimes(1));
    expect(exportMocks.svgDoPliku.mock.calls[0]?.[0]).toHaveProperty("id", "stary");
  });

  it("znacznik `data-chart-canvas` ma pierwszeństwo przed aliasem", async () => {
    frame(
      <>
        <div className="neh-canvas">
          <svg id="alias" />
        </div>
        <div data-chart-canvas>
          <svg id="znacznik" />
        </div>
      </>,
    );
    zapiszSvg();
    await waitFor(() => expect(exportMocks.svgDoPliku).toHaveBeenCalledTimes(1));
    expect(exportMocks.svgDoPliku.mock.calls[0]?.[0]).toHaveProperty("id", "znacznik");
  });

  it("BRAK rysunku to widoczny komunikat, a nie przycisk, który nic nie robi", async () => {
    frame(<p>bez rysunku</p>);
    zapiszPng();
    expect(await screen.findByRole("status")).toHaveTextContent(EXPORT_FAILED);
    expect(exportMocks.pobierzPlik).not.toHaveBeenCalled();
    expect(exportMocks.svgDoPng).not.toHaveBeenCalled();
  });

  it("klucz eksportu PNG podany przez rysunek zastępuje legendę ramy", async () => {
    frame(
      <div data-chart-canvas>
        <svg />
      </div>,
      {
        meta: {
          ...META,
          exportKey: () => [
            { label: "Polska", color: "rgb(1, 2, 3)" },
            { label: "Niemcy", color: "rgb(4, 5, 6)" },
          ],
        },
      },
    );
    zapiszPng();
    await waitFor(() => expect(exportMocks.svgDoPng).toHaveBeenCalledTimes(1));
    const klucz = exportMocks.svgDoPng.mock.calls[0]?.[1].klucz ?? [];
    expect(klucz.map((w) => w.label)).toEqual(["Polska", "Niemcy"]);
    // Napis ma własny kolor (tekst figury) - nigdy pusty, bo płótno go nie zgadnie.
    for (const wpis of klucz) expect(wpis.textColor).not.toBe("");
  });
});

describe("klasy ramy", () => {
  it("klasa wołającego wygrywa z domyślnym marginesem (`cn`, nie sklejanie)", () => {
    const { container } = frame(<svg />, { className: "my-0" });
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure.classList.contains("my-0")).toBe(true);
    expect(figure.classList.contains("my-6")).toBe(false);
    expect(figure.classList.contains("neh-chart")).toBe(true);
  });

  it("bez klasy wołającego zostaje domyślny zestaw panelu", () => {
    const { container } = frame(<svg />);
    expect((container.querySelector("figure") as HTMLElement).className).toBe(
      "neh-chart not-prose my-6 border bg-card p-4",
    );
  });
});

describe("teksty „Jak czytać” od rysunku", () => {
  it("`meta.help` nadpisuje zdania słownika o elementach, kolorach i interakcjach", () => {
    frame(<svg />, {
      meta: {
        ...META,
        family: "map",
        help: {
          elements: "Kraj to obszar mapy.",
          colours: "Ciemniej znaczy więcej.",
          interactions: "Najedź na kraj.",
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Jak czytać ten wykres" }));
    const dialog = document.querySelector("dialog.neh-dialog[open]") as HTMLElement;
    expect(dialog.textContent).toContain("Kraj to obszar mapy.");
    expect(dialog.textContent).toContain("Ciemniej znaczy więcej.");
    expect(dialog.textContent).toContain("Najedź na kraj.");
    expect(dialog.textContent).not.toContain("Jedna seria w akcencie");
  });

  it("bez `meta.help` i bez palety zostają zdania ogólne (paleta ról domyślnie)", () => {
    frame(<svg />);
    fireEvent.click(screen.getByRole("button", { name: "Jak czytać ten wykres" }));
    const dialog = document.querySelector("dialog.neh-dialog[open]") as HTMLElement;
    expect(dialog.textContent).toContain("Jedna seria w akcencie");
  });
});
