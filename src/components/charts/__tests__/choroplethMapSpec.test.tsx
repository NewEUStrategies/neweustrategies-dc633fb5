// KARTOGRAM WEDŁUG SPECYFIKACJI PANELU (PR2, kontrakt W4).
//
// Mapa dostała w PR2 to, co wykresy miały od specyfikacji 2026-10, a czego
// jej brakowało: metę panelu (źródła z numeracją artykułu, pochodzenie, demo,
// podpis, trzy zdania „Jak czytać", data danych, n), własne teksty okna
// pomocy, klucz eksportu PNG, powiększenie, cel eksportu `[data-chart-canvas]`,
// kreskowanie „brak danych" w pikselach CSS, tooltip z próbką, faktami
// (pozycja, przedział) i źródłem, obrys dwutonowy na nakładce, dotyk
// (stuknięcie otwiera, stuknięcie obok i Escape zamyka) oraz panel przy
// pustym zestawie. Każdy z tych punktów ma tu test - stary plik
// `choroplethMap.test.tsx` pilnuje reguł sprzed PR2.
//
// HARNESS. Zasób geometrii jest atrapą (jak w pliku obok), szerokość
// kontenera jest STEROWANA z testu (happy-dom raportuje `clientWidth` 0, a test
// kreskowania potrzebuje widgetu 320 px), eksport jest przechwycony (jak
// w `chartFrameSeam.test.tsx`), a `ChartTooltip` jest obłożony rejestratorem
// propsów: happy-dom odrzuca `color-mix()` w skrócie `background`, więc kolor
// próbki trzeba czytać z propsa, nie z DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import type { GeoAsset } from "@/lib/charts/types";
import type { Json } from "@/lib/content-model/json";
import type { WpisKlucza } from "@/lib/charts/exportImage";
import { parseDataMapConfig } from "@/lib/charts/parse";

const h = vi.hoisted(() => ({
  geo: null as unknown,
  width: 720,
  tooltips: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["geo", region],
    queryFn: () => h.geo ?? new Promise(() => {}),
  }),
}));

vi.mock("@/hooks/useContainerWidth", async () => {
  const { useRef } = await import("react");
  return {
    useContainerWidth: () => ({ ref: useRef(null), width: h.width }),
  };
});

vi.mock("../ChartTooltip", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ChartTooltip")>();
  return {
    ...real,
    ChartTooltip: (props: ComponentProps<typeof real.ChartTooltip>) => {
      if (props.visible) h.tooltips.push(props as unknown as Record<string, unknown>);
      return real.ChartTooltip(props);
    },
  };
});

const exportMocks = vi.hoisted(() => ({
  pobierzPlik: vi.fn(),
  svgDoPliku: vi.fn(
    (_svg: SVGSVGElement, _opts?: { background?: string; fontFamily?: string }) =>
      new Blob(["svg"], { type: "image/svg+xml" }),
  ),
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

/** Kraje atrapy; kształt zależy od pozycji, więc ścieżkę znajdziemy po `d`. */
const KRAJE = ["PL", "DE", "FR", "CZ", "SK"] as const;
const ksztalt = (id: string): string => {
  const i = (KRAJE as readonly string[]).indexOf(id);
  return `M${i * 10} ${i * 10}h8v8h-8z`;
};

function zasob(ids: readonly string[] = KRAJE): GeoAsset {
  return {
    v: 1,
    license: "test",
    viewBox: "0 0 960 825",
    countries: ids.map((id) => ({
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

async function mapa(
  data: Record<string, Json>,
  opts: {
    lang?: "pl" | "en";
    awaitSvg?: boolean;
    footnoteNumbers?: ReadonlyMap<string, number>;
  } = {},
) {
  const view = render(
    <Wrapper>
      <ChoroplethMap
        config={parseDataMapConfig(data)}
        lang={opts.lang ?? "pl"}
        footnoteNumbers={opts.footnoteNumbers}
      />
    </Wrapper>,
  );
  if (opts.awaitSvg !== false) {
    await waitFor(() => expect(view.container.querySelector("svg.block")).not.toBeNull());
  }
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
const obrys = (root: HTMLElement): Element | null => root.querySelector("g.neh-map-outline");
const ostatniTooltip = (): Record<string, unknown> => h.tooltips[h.tooltips.length - 1] ?? {};

/** Cztery kraje z danymi, piąty (SK) bez - mapa ma tło do kreskowania. */
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
  h.width = 720;
  h.tooltips = [];
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  exportMocks.pobierzPlik.mockClear();
  exportMocks.svgDoPliku.mockClear();
  exportMocks.svgDoPng.mockClear();
});

describe("meta panelu - mapa mówi to samo co wykres", () => {
  const ZRODLA: Record<string, Json> = {
    ...KLASY,
    source: "",
    provenance: "W",
    sources: [
      { id: "es", title: "GDP per capita", author: "Eurostat", url: "https://ec.europa.eu/x" },
      { id: "wb", title: "World Development Indicators", author: "World Bank" },
    ],
  };

  it("źródła dostają numery Z SEKWENCJI ARTYKUŁU, a bez niej - własne", async () => {
    const artykul = await mapa(ZRODLA, {
      footnoteNumbers: new Map([
        ["es", 7],
        ["wb", 8],
      ]),
    });
    expect(screen.getByRole("button", { name: "Przypis 7 - pokaż źródło" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Przypis 8 - pokaż źródło" })).toBeTruthy();
    artykul.unmount();

    await mapa(ZRODLA);
    expect(screen.getByRole("button", { name: "Przypis 1 - pokaż źródło" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Przypis 2 - pokaż źródło" })).toBeTruthy();
  });

  it("pochodzenie liczb stoi literą w podtytule, a dane demo dostają znaczek", async () => {
    const { container } = await mapa({ ...ZRODLA, demo: true });
    const head = container.querySelector("figcaption")?.textContent ?? "";
    expect(head).toContain("(W)");
    expect(head).toContain("demo");
    expect(head).toContain("dane demo");
  });

  it("podpis, trzy zdania „Jak czytać”, data danych i n jadą do ramy", async () => {
    const { container } = await mapa({
      ...KLASY,
      caption: "Podpis pod mapą.",
      notesShows: "Zachód jest bogatszy.",
      notesSurprising: "Czechy przed Polską.",
      notesHidden: "Brak Słowacji.",
      sourceDate: "2025-12-31",
      sampleSize: 4,
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Podpis pod mapą.");
    expect(text).toContain("Zachód jest bogatszy.");
    expect(text).toContain("Czechy przed Polską.");
    expect(text).toContain("Brak Słowacji.");
    expect(text).toContain("Dane na dzień: 2025-12-31");
    expect(text).toContain("n = 4");
  });

  it("okno „Jak czytać” mówi o MAPIE: schemat, klasy, metoda i interakcje (bez zdań o osiach)", async () => {
    await mapa({ ...KLASY, scheme: "diverging", midpoint: 30, method: "quantile" });
    fireEvent.click(screen.getByRole("button", { name: "Jak czytać ten wykres" }));
    const dialog = document.querySelector("dialog[open]") as HTMLElement;
    const text = dialog.textContent ?? "";
    expect(text).toContain("Kraje kreskowane nie mają danych.");
    expect(text).toContain("Schemat: rozbieżny (spadek - wzrost).");
    expect(text).toContain("punkt środkowy (30 tys. EUR)");
    expect(text).toContain("Liczba klas: 4, podział: kwantyle (równe liczebności).");
    expect(text).toContain("stuknij kraj");
    expect(text).not.toContain("Oś pozioma");
    expect(text).not.toContain("Jedna seria w akcencie");
  });

  it("okno pomocy po angielsku i dla skali ciągłej", async () => {
    await mapa({ ...KLASY, classes: 0, scheme: "slate" }, { lang: "en" });
    fireEvent.click(screen.getByRole("button", { name: /how to read/i }));
    const text = (document.querySelector("dialog[open]") as HTMLElement).textContent ?? "";
    expect(text).toContain("Scheme: Slate.");
    expect(text).toContain("Method: Continuous scale.");
  });
});

describe("eksport i powiększenie", () => {
  it("rysunek siedzi w `[data-chart-canvas]` - eksport go znajduje", async () => {
    const { container } = await mapa(KLASY);
    const svg = container.querySelector("svg.block");
    expect(svg?.closest("[data-chart-canvas]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako SVG" }));
    await waitFor(() => expect(exportMocks.svgDoPliku).toHaveBeenCalledTimes(1));
    expect(exportMocks.svgDoPliku.mock.calls[0]?.[0]).toBe(svg);
  });

  it("klucz PNG to pozycje legendy: przedziały klas i „brak danych”", async () => {
    const { container } = await mapa(KLASY);
    const legenda = [...container.querySelectorAll("[data-map-class]")].map((li) => li.textContent);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako PNG" }));
    await waitFor(() => expect(exportMocks.svgDoPng).toHaveBeenCalledTimes(1));
    const klucz = exportMocks.svgDoPng.mock.calls[0]?.[1].klucz ?? [];
    expect(klucz.map((w) => w.label)).toEqual([...legenda, "brak danych (kreskowanie)"]);
  });

  it("mapa z wyłączoną legendą eksportuje się bez klucza - tak, jak wygląda", async () => {
    await mapa({ ...KLASY, showLegend: false });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz wykres jako PNG" }));
    await waitFor(() => expect(exportMocks.svgDoPng).toHaveBeenCalledTimes(1));
    expect(exportMocks.svgDoPng.mock.calls[0]?.[1].klucz).toEqual([]);
  });

  it("powiększenie rysuje DRUGIE płótno, zwężone do wysokości okna (bez pasów)", async () => {
    const { container } = await mapa(KLASY);
    fireEvent.click(screen.getByRole("button", { name: "Powiększ wykres" }));
    const dialog = await waitFor(() => {
      const d = [...document.querySelectorAll("dialog[open]")].find((n) =>
        n.querySelector("[data-chart-canvas] svg"),
      );
      if (!d) throw new Error("brak okna z mapą");
      return d as HTMLElement;
    });
    const svg = dialog.querySelector("[data-chart-canvas] svg") as SVGSVGElement;
    const w = Number(svg.getAttribute("width"));
    const hgt = Number(svg.getAttribute("height"));
    const limit = Math.round(Math.min(window.innerHeight * 0.6, 560));
    expect(hgt).toBeLessThanOrEqual(limit);
    expect(w).toBeLessThanOrEqual(720);
    // Pudełko dokładnie obejmuje rysunek: wysokość = szerokość * aspekt zasobu.
    expect(hgt).toBe(Math.round(w * (825 / 960)));
    expect(svg).not.toBe(container.querySelector(".neh-chart-body svg.block"));
  });
});

describe("kraje bez danych - kreskowanie w pikselach CSS", () => {
  /** Odstęp linii kreskowania w px CSS, policzony z wyrenderowanego wzoru. */
  function odstepPx(root: HTMLElement): number {
    const svg = root.querySelector("svg.block") as SVGSVGElement;
    const wzor = svg.querySelector("pattern") as SVGPatternElement;
    const k = Number(/scale\(([\d.]+)\)/.exec(wzor.getAttribute("patternTransform") ?? "")?.[1]);
    const vb = Number((svg.getAttribute("viewBox") ?? "").split(" ")[2]);
    return Number(wzor.getAttribute("width")) * k * (Number(svg.getAttribute("width")) / vb);
  }

  it.each([320, 480, 720, 1100])("przy szerokości %d px odstęp linii >= 4 px CSS", async (w) => {
    h.width = w;
    const { container } = await mapa(KLASY);
    expect(odstepPx(container)).toBeGreaterThanOrEqual(4);
    // I nie rośnie z szerokością - to ten sam wzór na każdym ekranie.
    expect(odstepPx(container)).toBeCloseTo(5, 3);
  });

  it("kraj bez danych pokazuje tooltip „brak danych” z próbką kreskowaną", async () => {
    const { container } = await mapa(KLASY);
    fireEvent.pointerMove(sciezka(container, "SK"), { clientX: 30, clientY: 30 });
    expect(tip(container)?.textContent).toBe("SK po polskuWartośćbrak danych");
    const rows = ostatniTooltip().rows as Array<{ color?: string }>;
    expect(rows[0].color).toContain("var(--chart-map-nodata-hatch)");
  });

  it("legenda ma „brak danych”, gdy jest kraj bez wartości, i nie ma, gdy go nie ma", async () => {
    const z = await mapa(KLASY);
    expect(z.container.querySelector("[data-map-nodata]")).not.toBeNull();
    z.unmount();
    h.geo = zasob(["PL", "DE", "FR", "CZ"]);
    const bez = await mapa(KLASY);
    expect(bez.container.querySelector("[data-map-nodata]")).toBeNull();
  });
});

describe("tooltip - próbka, fakty i źródło", () => {
  it("próbka ma kolor KRAJU, fakty to pozycja i przedział klasy, na dole źródło", async () => {
    const { container } = await mapa(KLASY);
    const fr = sciezka(container, "FR");
    fireEvent.pointerMove(fr, { clientX: 50, clientY: 40 });
    const props = ostatniTooltip();
    const rows = props.rows as Array<{ name: string; value: string; color?: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Wartość");
    expect(rows[0].value).toBe("40 tys. EUR");
    // Ten sam napis, którym kraj jest namalowany.
    expect(`fill: ${rows[0].color ?? ""};`).toBe(fr.getAttribute("style"));
    expect(props.facts).toEqual([
      { label: "Pozycja", value: "2. z 4" },
      { label: "Przedział", value: "od 40 do 50 tys. EUR" },
    ]);
    expect(props.source).toBe("Źródło: Eurostat");
    expect(tip(container)?.textContent).toContain("Źródło: Eurostat");
  });

  it("remis dzieli pozycję, a skala ciągła nie ma faktu przedziału (EN)", async () => {
    const { container } = await mapa(
      {
        ...KLASY,
        classes: 0,
        values: [
          { id: "PL", value: 30 },
          { id: "DE", value: 30 },
          { id: "FR", value: 10 },
        ],
      },
      { lang: "en" },
    );
    fireEvent.pointerMove(sciezka(container, "DE"), { clientX: 5, clientY: 5 });
    expect(ostatniTooltip().facts).toEqual([{ label: "Rank", value: "1 of 3" }]);
  });
});

describe("obrys wskazania i fokusu - nakładka dwutonowa", () => {
  it("wskazanie rysuje NA KOŃCU rysunku kopię kształtu z dwoma obrysami bez skalowania", async () => {
    const { container } = await mapa(KLASY);
    const de = sciezka(container, "DE");
    fireEvent.pointerMove(de, { clientX: 10, clientY: 10 });
    const g = obrys(container);
    expect(g).not.toBeNull();
    expect(g?.getAttribute("aria-hidden")).toBe("true");
    // Ostatnie dziecko SVG - żaden sąsiad nie zamaluje obrysu.
    expect(container.querySelector("svg.block")?.lastElementChild).toBe(g);
    const paths = [...(g?.querySelectorAll("path") ?? [])];
    expect(paths.map((p) => p.getAttribute("class"))).toEqual([
      "neh-map-outline-halo",
      "neh-map-outline-ink",
    ]);
    for (const p of paths) {
      expect(p.getAttribute("d")).toBe(de.getAttribute("d"));
      expect(p.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
    fireEvent.pointerLeave(de);
    expect(obrys(container)).toBeNull();
  });

  it("fokus: Escape chowa dymek, ale ZOSTAWIA obrys fokusu; blur zdejmuje oba", async () => {
    const { container } = await mapa(KLASY);
    const pl = sciezka(container, "PL");
    Object.defineProperty(pl, "getBBox", {
      value: () => ({ x: 0, y: 0, width: 8, height: 8 }),
      configurable: true,
    });
    Object.defineProperty(pl.ownerSVGElement as SVGSVGElement, "viewBox", {
      value: { baseVal: { width: 960 } },
      configurable: true,
    });
    fireEvent.focus(pl);
    expect(tip(container)).not.toBeNull();
    expect(obrys(container)).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip(container)).toBeNull();
    expect(obrys(container)).not.toBeNull();
    fireEvent.blur(pl);
    expect(obrys(container)).toBeNull();
  });
});

describe("dotyk", () => {
  it("stuknięcie otwiera tooltip i trzyma go po „opuszczeniu”; stuknięcie obok zamyka", async () => {
    const { container } = await mapa(KLASY);
    const cz = sciezka(container, "CZ");
    fireEvent.pointerDown(cz, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerUp(cz, { pointerType: "touch", clientX: 20, clientY: 20 });
    expect(tip(container)?.textContent).toContain("CZ po polsku");
    // Po stuknięciu przeglądarka wysyła `pointerleave` - dymek musi zostać.
    fireEvent.pointerLeave(cz, { pointerType: "touch" });
    expect(tip(container)).not.toBeNull();
    // Stuknięcie w INNY kraj przełącza dymek, nie zamyka go.
    const de = sciezka(container, "DE");
    fireEvent.pointerDown(de, { pointerType: "touch" });
    fireEvent.pointerUp(de, { pointerType: "touch", clientX: 40, clientY: 40 });
    expect(tip(container)?.textContent).toContain("DE po polsku");
    // Stuknięcie poza krajem zamyka.
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(tip(container)).toBeNull();
    expect(obrys(container)).toBeNull();
  });

  it("Escape zamyka dymek otwarty stuknięciem", async () => {
    const { container } = await mapa(KLASY);
    const pl = sciezka(container, "PL");
    fireEvent.pointerUp(pl, { pointerType: "touch", clientX: 5, clientY: 5 });
    expect(tip(container)).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip(container)).toBeNull();
  });

  it("ruch palca to przewijanie, nie wskazanie", async () => {
    const { container } = await mapa(KLASY);
    fireEvent.pointerMove(sciezka(container, "PL"), { pointerType: "touch", clientX: 5 });
    expect(tip(container)).toBeNull();
  });
});

describe("pusty zestaw, domena i motyw", () => {
  it("pusty zestaw zostaje panelem o wysokości rysunku regionu i nie dociąga geometrii", async () => {
    h.geo = null;
    const { container } = await mapa(
      { region: "europe", title: "Pusta mapa", source: "Eurostat", values: [] },
      { awaitSvg: false },
    );
    expect(container.querySelector("figure")).not.toBeNull();
    expect(within(container.querySelector("figcaption") as HTMLElement).getByText("Pusta mapa"));
    const pudlo = container.querySelector<HTMLElement>(".neh-map-empty");
    // 720 * 825/960 = 618,75 -> 619 - ta sama wysokość, co mapa z danymi.
    expect(pudlo?.style.height).toBe("619px");
    expect(container.querySelector(".skeleton-shimmer")).toBeNull();
  });

  it("klasy liczą się z krajów NARYSOWANYCH - wartość spoza mapy nie robi własnej klasy", async () => {
    const { container } = await mapa({
      ...KLASY,
      values: [...(KLASY.values as Json[]), { id: "XX", value: 1000 }],
    });
    const legenda = [...container.querySelectorAll("[data-map-class]")].map((li) => li.textContent);
    expect(legenda.at(-1)).toBe("od 40 do 50 tys. EUR");
    expect(container.querySelector("[data-note='outside']")?.textContent).toContain("XX");
  });

  it("schemat rozbieżny maluje tokenami znaku wokół punktu środkowego", async () => {
    const { container } = await mapa({ ...KLASY, scheme: "diverging", midpoint: 30 });
    expect(sciezka(container, "PL").getAttribute("style")).toContain("var(--chart-negative)");
    expect(sciezka(container, "DE").getAttribute("style")).toContain("var(--chart-positive)");
  });

  it("jasny i ciemny motyw mają IDENTYCZNĄ geometrię - różni się wyłącznie hex awaryjny", async () => {
    const zdejmijHex = (html: string): string => html.replace(/ fill="#[0-9a-f]{6}"/g, "");
    const jasna = await mapa(KLASY);
    fireEvent.pointerMove(sciezka(jasna.container, "DE"), { clientX: 10, clientY: 10 });
    const htmlJasna = zdejmijHex(jasna.container.innerHTML);
    jasna.unmount();

    document.documentElement.classList.add("dark");
    const ciemna = await mapa(KLASY);
    fireEvent.pointerMove(sciezka(ciemna.container, "DE"), { clientX: 10, clientY: 10 });
    // Identyfikatory `useId` (wzór kreskowania, powiązania ARIA ramy) są per
    // drzewo - normalizujemy je przed porównaniem.
    const norm = (html: string): string =>
      html.replace(/neh-map-hatch-[\w-]+/g, "neh-map-hatch").replace(/_r_[0-9a-z]+_/g, "_r_");
    expect(norm(zdejmijHex(ciemna.container.innerHTML))).toBe(norm(htmlJasna));
  });
});
