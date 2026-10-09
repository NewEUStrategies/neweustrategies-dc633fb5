// KARTOGRAM - poprawki po przeglądzie W4 (PR2).
//
// Każdy test odpowiada jednej znalezionej dziurze:
//   * FOKUS I WSKAZANIE to dwa stany - kursor przejeżdżający nad innym krajem
//     zdejmował obrys krajowi, który wciąż trzymał fokus klawiatury (zostawał
//     pierścień akcentu 1,02:1), a klik myszą nie może zostawiać obrysu
//     przyklejonego do klikniętego kraju;
//   * pierścień akcentu z `charts.css` jest na mapie NAPRAWDĘ zneutralizowany
//     (reguła `map.css` ustawia zwykłą krawędź, nie tylko `outline: none`);
//   * KLUCZ PNG nie maluje „brak danych" kolorem linii kreskowania (czytał się
//     jak środkowa klasa) - stoi średni ton wzoru i napis o kreskowaniu;
//   * POWIĘKSZENIE ma notę o kodach spoza regionu, tak jak panel;
//   * LEGENDA bez skali (żaden kod nie trafił na rysunek) zostaje z pozycją
//     „brak danych", zamiast zniknąć razem z kluczem do kreskowania;
//   * „JAK CZYTAĆ" nie obiecuje przedziału klasy skali ciągłej.
//
// Harness jak w `choroplethMapSpec.test.tsx`: atrapa zasobu geometrii,
// sterowana szerokość kontenera i przechwycony eksport.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import type { GeoAsset } from "@/lib/charts/types";
import type { Json } from "@/lib/content-model/json";
import type { WpisKlucza } from "@/lib/charts/exportImage";
import { parseDataMapConfig } from "@/lib/charts/parse";
import { mapScale } from "@/lib/charts/kinds/mapScale";

const h = vi.hoisted(() => ({ geo: null as unknown }));

vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["geo", region],
    queryFn: () => h.geo ?? new Promise(() => {}),
  }),
}));

vi.mock("@/hooks/useContainerWidth", async () => {
  const { useRef } = await import("react");
  return { useContainerWidth: () => ({ ref: useRef(null), width: 720 }) };
});

const exportMocks = vi.hoisted(() => ({
  pobierzPlik: vi.fn(),
  svgDoPliku: vi.fn(() => new Blob(["svg"], { type: "image/svg+xml" })),
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

const { ChoroplethMap } = await import("../ChoroplethMap");
const { MapLegend } = await import("../MapLegend");
const { MAP_HATCH, MAP_NODATA_KEY } = await import("../mapPaint");

const KRAJE = ["PL", "DE", "FR", "CZ", "SK"] as const;
const ksztalt = (id: string): string => {
  const i = (KRAJE as readonly string[]).indexOf(id);
  return `M${i * 10} ${i * 10}h8v8h-8z`;
};

function zasob(): GeoAsset {
  return {
    v: 1,
    license: "test",
    viewBox: "0 0 960 825",
    countries: KRAJE.map((id) => ({
      id,
      pl: `${id} po polsku`,
      en: `${id} in English`,
      d: ksztalt(id),
    })),
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function mapa(data: Record<string, Json>, lang: "pl" | "en" = "pl") {
  const view = render(
    <Wrapper>
      <ChoroplethMap config={parseDataMapConfig(data)} lang={lang} />
    </Wrapper>,
  );
  await waitFor(() => expect(view.container.querySelector("svg.block")).not.toBeNull());
  return view;
}

const sciezka = (root: HTMLElement, id: string): SVGPathElement => {
  const p = [...root.querySelectorAll<SVGPathElement>("g.neh-map-countries > path")].find(
    (n) => n.getAttribute("d") === ksztalt(id),
  );
  if (!p) throw new Error(`test: brak ścieżki ${id}`);
  return p;
};
const tip = (root: HTMLElement): Element | null => root.querySelector(".neh-tooltip");
const obrysy = (root: HTMLElement): string =>
  root.querySelector("g.neh-map-outline")?.getAttribute("data-outline") ?? "";

/** Fokus klawiatury w happy-dom: geometria ścieżki i viewBox są atrapą. */
function przygotujFokus(p: SVGPathElement): void {
  Object.defineProperty(p, "getBBox", {
    value: () => ({ x: 0, y: 0, width: 8, height: 8 }),
    configurable: true,
  });
  Object.defineProperty(p.ownerSVGElement as SVGSVGElement, "viewBox", {
    value: { baseVal: { width: 960 } },
    configurable: true,
  });
}

const KLASY: Record<string, Json> = {
  region: "europe",
  title: "PKB na mieszkańca",
  unit: " tys. EUR",
  scheme: "blue",
  classes: 4,
  method: "equal",
  source: "Eurostat",
  values: [
    { id: "PL", value: 10 },
    { id: "DE", value: 50 },
    { id: "FR", value: 40 },
    { id: "CZ", value: 20 },
  ],
};

beforeEach(() => {
  h.geo = zasob();
});

afterEach(() => {
  cleanup();
  exportMocks.svgDoPng.mockClear();
});

describe("fokus i wskazanie - dwa stany", () => {
  it("zjechanie kursora z innego kraju NIE zdejmuje obrysu krajowi z fokusem", async () => {
    const { container } = await mapa(KLASY);
    const pl = sciezka(container, "PL");
    const de = sciezka(container, "DE");
    przygotujFokus(pl);
    fireEvent.focus(pl);
    expect(obrysy(container)).toBe("PL");

    // Najechanie na inny kraj: dymek idzie za kursorem, obrys fokusu zostaje.
    fireEvent.pointerMove(de, { pointerType: "mouse", clientX: 30, clientY: 30 });
    expect(obrysy(container)).toBe("PL DE");
    expect(tip(container)?.textContent).toContain("DE po polsku");
    // Halo obu krajów pod tuszami obu krajów.
    const klasy = [...container.querySelectorAll("g.neh-map-outline > path")].map((p) =>
      p.getAttribute("class"),
    );
    expect(klasy).toEqual([
      "neh-map-outline-halo",
      "neh-map-outline-halo",
      "neh-map-outline-ink",
      "neh-map-outline-ink",
    ]);

    // Zjechanie: wraca fokus - obrys i dymek kraju z fokusem.
    fireEvent.pointerLeave(de, { pointerType: "mouse" });
    expect(obrysy(container)).toBe("PL");
    expect(tip(container)?.textContent).toContain("PL po polsku");
    expect(pl.getAttribute("data-active")).toBe("true");
    expect(de.getAttribute("data-active")).toBeNull();

    // To samo, gdy kursor przejedzie nad SAMYM krajem z fokusem.
    fireEvent.pointerMove(pl, { pointerType: "mouse", clientX: 4, clientY: 4 });
    fireEvent.pointerLeave(pl, { pointerType: "mouse" });
    expect(obrysy(container)).toBe("PL");

    fireEvent.blur(pl);
    expect(container.querySelector("g.neh-map-outline")).toBeNull();
  });

  it("Escape przy fokusie i wskazaniu chowa dymek, a obrys fokusu zostaje", async () => {
    const { container } = await mapa(KLASY);
    const pl = sciezka(container, "PL");
    przygotujFokus(pl);
    fireEvent.focus(pl);
    fireEvent.pointerMove(sciezka(container, "FR"), { pointerType: "mouse", clientX: 9 });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip(container)).toBeNull();
    expect(obrysy(container)).toBe("PL");
  });

  it("fokus z KLIKNIĘCIA nie przykleja obrysu ani dymka po zjechaniu kursora", async () => {
    const { container } = await mapa(KLASY);
    const cz = sciezka(container, "CZ");
    przygotujFokus(cz);
    // Przeglądarka po kliknięciu: element ma `:focus`, ale nie `:focus-visible`.
    Object.defineProperty(cz, "matches", {
      value: (sel: string) => sel === ":focus",
      configurable: true,
    });
    fireEvent.pointerMove(cz, { pointerType: "mouse", clientX: 25, clientY: 25 });
    fireEvent.focus(cz);
    fireEvent.pointerLeave(cz, { pointerType: "mouse" });
    expect(container.querySelector("g.neh-map-outline")).toBeNull();
    expect(tip(container)).toBeNull();
  });

  it("pierścień akcentu z charts.css jest na mapie zneutralizowany, nie tylko bez outline", () => {
    const css = readFileSync("src/components/charts/map.css", "utf8");
    const selektor = ".neh-chart .neh-map-canvas .neh-country:focus-visible {";
    const start = css.indexOf(selektor);
    expect(start).toBeGreaterThanOrEqual(0);
    const regula = css.slice(start, css.indexOf("}", start));
    expect(regula).toMatch(/outline:\s*none;/);
    // Ta sama krawędź co kraj bez fokusu (`.neh-chart .neh-country` w charts.css).
    expect(regula).toMatch(/stroke:\s*var\(--card\);/);
    expect(regula).toMatch(/stroke-width:\s*0\.6;/);
  });
});

describe("klucz PNG - pozycja „brak danych”", () => {
  it("ma średni ton kreskowania z tokenów i napis o kreskowaniu", async () => {
    await mapa(KLASY);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako PNG" }));
    await waitFor(() => expect(exportMocks.svgDoPng).toHaveBeenCalledTimes(1));
    const klucz = exportMocks.svgDoPng.mock.calls[0]?.[1].klucz ?? [];
    const brak = klucz.at(-1);
    expect(brak?.label).toBe("brak danych (kreskowanie)");
    // Rama rozwiązuje kolor sondą; happy-dom nie zna color-mix(), więc
    // sprawdzamy wejście - stałą, którą mapa podaje ramie.
    expect(MAP_NODATA_KEY).toBe(
      `color-mix(in srgb, var(--chart-map-nodata-hatch) ${Math.round(
        (MAP_HATCH.linePx / MAP_HATCH.spacingPx) * 100,
      )}%, var(--chart-map-nodata))`,
    );
    expect(MAP_NODATA_KEY).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("po angielsku napis też mówi o kreskowaniu", async () => {
    await mapa(KLASY, "en");
    fireEvent.click(screen.getByRole("button", { name: /png/i }));
    await waitFor(() => expect(exportMocks.svgDoPng).toHaveBeenCalledTimes(1));
    const klucz = exportMocks.svgDoPng.mock.calls[0]?.[1].klucz ?? [];
    expect(klucz.at(-1)?.label).toBe("no data (hatched)");
  });
});

describe("kody spoza regionu", () => {
  it("powiększenie też ma notę, które kody wypadły z rysunku", async () => {
    await mapa({
      ...KLASY,
      values: [...(KLASY.values as Json[]), { id: "XX", value: 1000 }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Powiększ wykres" }));
    const dialog = await waitFor(() => {
      const d = [...document.querySelectorAll("dialog[open]")].find((n) =>
        n.querySelector("[data-chart-canvas] svg"),
      );
      if (!d) throw new Error("brak okna z mapą");
      return d as HTMLElement;
    });
    expect(dialog.querySelector("[data-note='outside']")?.textContent).toContain("XX");
  });

  it("żaden kod na rysunku: mapa w całości kreskowana, a legenda ma „brak danych”", async () => {
    const { container } = await mapa({
      ...KLASY,
      scheme: "diverging",
      values: [
        { id: "XX", value: 1 },
        { id: "YY", value: 2 },
      ],
    });
    const legenda = container.querySelector(".neh-map-legend");
    expect(legenda).not.toBeNull();
    expect(legenda?.getAttribute("data-scale")).toBe("none");
    expect(legenda?.querySelector("[data-map-nodata]")?.textContent).toBe("brak danych");
    expect(legenda?.querySelectorAll("[data-map-class]")).toHaveLength(0);
    // Punkt środkowy bez skali nic nie mówi - nie stoi.
    expect(legenda?.querySelector("[data-map-midpoint]")).toBeNull();
    expect(container.querySelector("[data-note='outside']")?.textContent).toContain("XX, YY");
  });

  it("MapLegend bez skali i bez kraju bez danych nadal nie renderuje niczego", () => {
    const { container } = render(
      <MapLegend
        scale={mapScale([], "blue", 0, "quantile", null)}
        colorOf={() => "var(--chart-map-blue-min)"}
        method="quantile"
        lang="pl"
        unit=""
        showNoData={false}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("„Jak czytać” - interakcje według rodzaju skali", () => {
  async function pomoc(data: Record<string, Json>, lang: "pl" | "en" = "pl"): Promise<string> {
    await mapa(data, lang);
    fireEvent.click(
      screen.getByRole("button", {
        name: lang === "pl" ? "Jak czytać ten wykres" : /how to read/i,
      }),
    );
    return (document.querySelector("dialog[open]") as HTMLElement).textContent ?? "";
  }

  it("klasy: dymek obiecuje wartość, pozycję i przedział klasy", async () => {
    const text = await pomoc(KLASY);
    expect(text).toContain("aby zobaczyć wartość, pozycję i przedział klasy.");
  });

  it("skala ciągła: bez przedziału, a nazwa skali to kanoniczna `methods.continuous`", async () => {
    const text = await pomoc({ ...KLASY, classes: 0 });
    expect(text).toContain("aby zobaczyć wartość i pozycję.");
    expect(text).not.toContain("przedział");
    expect(text).toContain("Podział: skala ciągła.");
  });

  it("skala ciągła po angielsku: value and rank, bez class range", async () => {
    const text = await pomoc({ ...KLASY, classes: 0 }, "en");
    expect(text).toContain("to see its value and rank.");
    expect(text).not.toContain("class range");
  });
});
