// Mapa-choropleta silnika wykresów (`src/components/charts/ChoroplethMap.tsx`) -
// pierwszy test tego pliku.
//
// PO CO. To jedyny wykres w silniku redakcyjnym, który koduje wartość
// WYPEŁNIENIEM obszaru, i jedyny, który dociąga geometrię fetchem. Z tego
// wychodzą trzy klasy defektów, których nie widać na oko:
//
//   * SKALA RAMPY. Odcień liczy się z `(value - min) / (max - min)`. Gdy
//     wszystkie wartości są równe (albo jest tylko jeden region), mianownik
//     wyszedłby zerem - rozbraja go zerowa rozpiętość przy liczeniu odcienia,
//     a NIE podbicie `max` o 1 (tamta sztuczna jedynka wyciekała do legendy
//     jako realna wartość). Pilnujemy, żeby legenda mapy z jednym regionem
//     nie obiecywała zakresu, którego w danych nie ma;
//   * ALTERNATYWA TEKSTOWA. Kolor bez etykiety nie jest treścią: osoba
//     czytająca ekran, drukująca stronę albo nierozróżniająca odcieni musi
//     dostać wszystkie liczby z tabeli. Tabela musi też ZOSTAĆ, gdy zasób
//     geometrii nie dojedzie - inaczej awaria CDN zabiera dane, nie tylko
//     obrazek. Region bez geometrii (albo przed hydracją) nie może zniknąć
//     z tabeli tylko dlatego, że nie ma dla niego kształtu;
//   * MOTYW. Wypełnienie jedzie przez `color-mix()` na tokenach rampy, ale
//     w atrybucie `fill` siedzi jeszcze awaryjny hex interpolowany w JS -
//     i on musi brać parę hexów TEGO SAMEGO motywu. Na jednej parze jasnej
//     ramp awaryjny w trybie ciemnym był odwrócony: najwyższa wartość
//     dostawała najmniej widoczny kolor.
//
// Do tego pilnujemy porządku malowania (kraje bez danych PRZED krajami z
// danymi, żeby obrys aktywnego nie chował się pod sąsiadem), fokusowalności
// wyłącznie krajów Z DANYMI, obu języków na każdym napisie i izolacji między
// przestrzeniami roboczymi.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, w happy-dom
// zerowe, więc szerokość zostaje na starcie 720 px. Wysokość liczy aspekt
// zasobu: europe 825/960 -> 619 px, world 427/960 -> 320 px.
// `getBoundingClientRect()` zwraca w happy-dom zera, więc `clientX` wskaźnika
// jest wprost współrzędną kotwicy tooltipa.
//
// PUŁAPKA HARNESSU: happy-dom ma `getBBox()`, ale zwraca zerowy prostokąt -
// pozycjonowanie tooltipa na fokusie ma więc dwa testy: jeden dowodzi, że brak
// geometrii nie wywraca komponentu, drugi podstawia prostokąt i sprawdza
// arytmetykę środka kraju.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import type { GeoAsset, DataMapConfig } from "@/lib/charts/types";
import type { Json } from "@/lib/content-model/json";
import { parseDataMapConfig } from "@/lib/charts/parse";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({ geo: null as unknown, fail: false }));

// Ten sam wzorzec, co w `src/components/tracker/__tests__/policyPositionsMap.test.tsx`:
// zasób geometrii nie schodzi z sieci, a stan zapytania jest sterowany z testu.
vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["geo", region],
    queryFn: () =>
      h.fail ? Promise.reject(new Error("geo asset: HTTP 404")) : (h.geo ?? new Promise(() => {})),
  }),
}));

const { ChoroplethMap } = await import("../ChoroplethMap");

/** Minimalny zasób geometrii - kształty nie mają znaczenia dla reguł. */
function geoAsset(
  ids: readonly string[] = ["PL", "DE", "FR", "CZ"],
  viewBox = "0 0 960 825",
): GeoAsset {
  return {
    v: 1,
    license: "test",
    viewBox,
    countries: ids.map((id, i) => ({
      id,
      pl: `${id} po polsku`,
      en: `${id} in English`,
      d: `M${i} ${i}`,
    })),
  };
}

/** Zasób z DZIURAMI w nazwach - jedna strona słownika pusta. */
const ASSET_BEZ_NAZW: GeoAsset = {
  v: 1,
  license: "test",
  viewBox: "0 0 960 825",
  countries: [
    { id: "PL", pl: "Polska", en: "", d: "M0 0" },
    { id: "DE", pl: "", en: "Germany", d: "M1 1" },
  ],
};

function cfg(data: Record<string, Json>): DataMapConfig {
  return parseDataMapConfig(data);
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function mapa(
  data: Record<string, Json>,
  opts: { lang?: "pl" | "en"; awaitSvg?: boolean } = {},
) {
  const view = render(
    <Wrapper>
      <ChoroplethMap config={cfg(data)} lang={opts.lang ?? "pl"} />
    </Wrapper>,
  );
  if (opts.awaitSvg !== false) {
    await waitFor(() => expect(view.container.querySelector("svg.block")).not.toBeNull());
  }
  return view;
}

/** Ścieżki krajów - ikona przełącznika tabeli też jest <path>. */
const countryPaths = (root: HTMLElement): SVGPathElement[] => [
  ...root.querySelectorAll<SVGPathElement>("g.neh-map-countries > path"),
];
const dataPaths = (root: HTMLElement): SVGPathElement[] =>
  countryPaths(root).filter((p) => p.hasAttribute("tabindex"));
const bgPaths = (root: HTMLElement): SVGPathElement[] =>
  countryPaths(root).filter((p) => !p.hasAttribute("tabindex"));
const tip = (root: HTMLElement): Element | null => root.querySelector(".neh-tooltip");
/** Pasek legendy sekwencyjnej: gradient jest aria-hidden, liczby są tekstem. */
const legendBox = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>("span[aria-hidden].rounded-full")?.parentElement ?? null;

function openTable(root: HTMLElement, name: RegExp | string = /dane|data/i): HTMLTableElement {
  fireEvent.click(within(root).getByRole("button", { name }));
  const table = root.querySelector("table");
  if (!table) throw new Error("brak tabeli danych");
  return table as HTMLTableElement;
}

/** Podstawia geometrię, której happy-dom nie liczy (patrz nagłówek pliku). */
function stubGeometry(
  path: SVGPathElement,
  box: { x: number; y: number; width: number; height: number },
) {
  Object.defineProperty(path, "getBBox", {
    value: () => ({
      ...box,
      top: box.y,
      left: box.x,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }),
    configurable: true,
  });
  Object.defineProperty(path.ownerSVGElement as SVGSVGElement, "viewBox", {
    value: { baseVal: { width: 960 } },
    configurable: true,
  });
}

const EUROPA: Record<string, Json> = {
  region: "europe",
  title: "Poparcie w krajach UE",
  values: [
    { id: "PL", value: 10 },
    { id: "DE", value: 90 },
  ],
};

beforeEach(() => {
  h.geo = geoAsset();
  h.fail = false;
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("ChoroplethMap - pusty zestaw", () => {
  it("mapa BEZ danych daje notę, a nie pustą kartę z legendą", async () => {
    const { container } = await mapa(
      { region: "europe", title: "Pusta", values: [] },
      { awaitSvg: false },
    );
    expect(container.querySelector("svg.block")).toBeNull();
    expect(container.querySelector("figure")).toBeNull();
    expect(container.textContent).toBe("Brak danych mapy.");
  });

  it("nota o braku danych jest przetłumaczona", async () => {
    const { container } = await mapa(
      { region: "europe", values: [] },
      { lang: "en", awaitSvg: false },
    );
    expect(container.textContent).toBe("No map data.");
  });

  it("wpisy z nieprawidłowym kodem kraju są odsiewane przy parsowaniu", async () => {
    // `parseMapValues` przepuszcza wyłącznie ISO-2; sama mapa nie ma szansy
    // dostać śmiecia, więc zestaw z samych śmieci = zestaw pusty.
    const { container } = await mapa(
      {
        region: "europe",
        values: [
          { id: "Polska", value: 1 },
          { id: "PL", value: null },
        ],
      },
      { awaitSvg: false },
    );
    expect(container.textContent).toBe("Brak danych mapy.");
  });
});

describe("ChoroplethMap - płótno i cykl życia zasobu geometrii", () => {
  it("wysokość wynika z ASPEKTU regionu, nie z domysłu", async () => {
    const europa = await mapa(EUROPA);
    // 720 * 825/960 = 618,75 -> 619.
    expect(europa.container.querySelector("svg.block")?.getAttribute("height")).toBe("619");
    expect(europa.container.querySelector("svg.block")?.getAttribute("width")).toBe("720");
    europa.unmount();

    const swiat = await mapa({ ...EUROPA, region: "world" });
    // 720 * 427/960 = 320,25 -> 320.
    expect(swiat.container.querySelector("svg.block")?.getAttribute("height")).toBe("320");
  });

  it("viewBox przychodzi Z ZASOBU - mapa nie zakłada własnej projekcji", async () => {
    h.geo = geoAsset(["PL", "DE"], "0 0 500 400");
    const { container } = await mapa(EUROPA);
    const svg = container.querySelector("svg.block");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 500 400");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  });

  it("do czasu wczytania geometrii stoi migotka SCHOWANA przed czytnikiem", async () => {
    h.geo = null;
    const { container } = await mapa(EUROPA, { awaitSvg: false });
    const shimmer = container.querySelector(".skeleton-shimmer");
    expect(shimmer).not.toBeNull();
    expect(shimmer?.hasAttribute("aria-hidden")).toBe(true);
    // Rama i przełącznik tabeli są na miejscu - liczby są dostępne od razu.
    expect(container.querySelector("figure")).not.toBeNull();
    expect(openTable(container).textContent).toContain("90");
  });

  it("awaria zasobu daje KOMUNIKAT (oba języki), a tabela z danymi zostaje", async () => {
    h.fail = true;
    const pl = await mapa(EUROPA, { awaitSvg: false });
    await waitFor(() => expect(pl.getByText("Nie udało się wczytać mapy.")).toBeTruthy());
    expect(pl.container.querySelector(".skeleton-shimmer")).toBeNull();
    expect(openTable(pl.container).textContent).toContain("90");
    pl.unmount();

    const en = await mapa(EUROPA, { lang: "en", awaitSvg: false });
    await waitFor(() => expect(en.getByText("Map failed to load.")).toBeTruthy());
  });

  it("tytuł opisuje grupę SVG, a jego brak nie zostawia pustego atrybutu", async () => {
    const zTytulem = await mapa(EUROPA);
    const svg = zTytulem.container.querySelector("svg.block");
    // role="group", nie "img": kraje z danymi są w środku fokusowalne.
    expect(svg?.getAttribute("role")).toBe("group");
    expect(svg?.getAttribute("aria-label")).toBe("Poparcie w krajach UE");
    zTytulem.unmount();

    const bezTytulu = await mapa({ ...EUROPA, title: "" });
    expect(bezTytulu.container.querySelector("svg.block")?.hasAttribute("aria-label")).toBe(false);
  });
});

describe("ChoroplethMap - ramp sekwencyjny", () => {
  it("najniższa wartość dostaje 15% rampy, nie 0 - żeby odróżnić ją od BRAKU danych", async () => {
    const { container } = await mapa({
      region: "europe",
      values: [
        { id: "PL", value: 0 },
        { id: "DE", value: 100 },
        { id: "FR", value: 50 },
      ],
    });
    const pct = (label: RegExp): number => {
      const p = dataPaths(container).find((n) => label.test(n.getAttribute("aria-label") ?? ""));
      return Number(/(\d+)%/.exec(p?.getAttribute("style") ?? "")?.[1]);
    };
    expect(pct(/^PL/)).toBe(15);
    expect(pct(/^DE/)).toBe(100);
    // Środek domeny siada w środku pasma 15..100. Binarnie 0,15 + 0,85 * 0,5
    // to 0,5749999..., więc Math.round oddaje 57 - w atrybucie jest dokładnie
    // to, co wyliczył komponent, bez zaokrąglania "na oko".
    expect(pct(/^FR/)).toBe(57);
  });

  it("ramp jest MONOTONICZNY - wyższa wartość nie może dostać bledszego odcienia", async () => {
    const { container } = await mapa({
      region: "europe",
      values: [
        { id: "PL", value: 1 },
        { id: "DE", value: 7 },
        { id: "FR", value: 3 },
        { id: "CZ", value: 5 },
      ],
    });
    const pary = dataPaths(container)
      .map((p) => ({
        v: Number(/: (\d+)/.exec(p.getAttribute("aria-label") ?? "")?.[1]),
        pct: Number(/(\d+)%/.exec(p.getAttribute("style") ?? "")?.[1]),
      }))
      .sort((a, b) => a.v - b.v);
    expect(pary.map((x) => x.v)).toEqual([1, 3, 5, 7]);
    for (let i = 1; i < pary.length; i++) {
      expect(pary[i].pct).toBeGreaterThan(pary[i - 1].pct);
    }
  });

  it("JEDEN region rozbraja dzielenie przez zero (min = max) - zero NaN w wypełnieniu", async () => {
    const { container } = await mapa({ region: "europe", values: [{ id: "PL", value: 42 }] });
    const [jedyny] = dataPaths(container);
    expect(jedyny.getAttribute("style")).toContain("15%");
    expect(jedyny.getAttribute("fill")).toMatch(/^#[0-9a-f]{6}$/);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("wszystkie wartości RÓWNE też nie dzielą przez zero", async () => {
    const { container } = await mapa({
      region: "europe",
      values: [
        { id: "PL", value: 5 },
        { id: "DE", value: 5 },
      ],
    });
    expect(container.innerHTML).not.toContain("NaN");
    for (const p of dataPaths(container)) expect(p.getAttribute("style")).toContain("15%");
  });

  it("legenda NIE wymyśla maksimum - przy jednym regionie pokazuje tylko wartość, która jest w danych", () => {
    // Dzielenie przez zero rozbraja `span` przy liczeniu odcienia, a NIE
    // podbicie `max` o 1. Dawna sztuczna jedynka wychodziła na wierzch
    // w legendzie: dla jednego regionu o wartości 42 mld czytelnik dostawał
    // skalę "42 mld ... 43 mld", czyli obietnicę zakresu, w którym nikogo
    // nie ma. Przy zdegenerowanej domenie legenda podaje JEDNĄ wartość.
    const view = render(
      <Wrapper>
        <ChoroplethMap
          config={cfg({ region: "europe", unit: " mld", values: [{ id: "PL", value: 42 }] })}
          lang="pl"
        />
      </Wrapper>,
    );
    const napisy = [
      ...(legendBox(view.container)?.querySelectorAll("span.tabular-nums") ?? []),
    ].map((s) => s.textContent);
    expect(napisy).not.toContain("43 mld");
    expect(napisy).toEqual(["42 mld"]);
  });

  it("region spoza geometrii wpływa na domenę rampy, ale nie znika z tabeli", async () => {
    // Zasób nie ma kształtu dla "XX" (np. nowszy słownik danych niż mapa),
    // więc na obrazku go nie ma - ale to wciąż dana i musi być w tabeli.
    const { container } = await mapa({
      region: "europe",
      values: [
        { id: "XX", value: 5 },
        { id: "PL", value: 10 },
        { id: "DE", value: 90 },
      ],
    });
    expect(dataPaths(container).map((p) => p.getAttribute("aria-label"))).toEqual([
      "PL po polsku: 10",
      "DE po polsku: 90",
    ]);
    const table = openTable(container);
    expect(within(table).getByRole("row", { name: /^XX/ }).textContent).toBe("XX5");
  });
});

describe("ChoroplethMap - kraje bez danych", () => {
  it("tło mapy NIE jest fokusowalne i nie udaje danych", async () => {
    // Kraj bez danych w porządku tabulacji byłby pustym przystankiem, a dla
    // czytnika obietnicą treści, której nie ma.
    const { container } = await mapa(EUROPA);
    expect(countryPaths(container)).toHaveLength(4);
    const tlo = bgPaths(container);
    expect(tlo).toHaveLength(2);
    for (const p of tlo) {
      expect(p.hasAttribute("role")).toBe(false);
      expect(p.hasAttribute("aria-label")).toBe(false);
      expect(p.querySelector("title")?.textContent).toMatch(/po polsku$/);
    }
  });

  it("nazwa tła idzie w języku strony", async () => {
    const { container } = await mapa(EUROPA, { lang: "en" });
    expect(bgPaths(container)[0].querySelector("title")?.textContent).toBe("FR in English");
  });

  it("tło maluje się PRZED krajami z danymi - obrys aktywnego nie chowa się pod sąsiadem", async () => {
    const { container } = await mapa(EUROPA);
    const kolejnosc = countryPaths(container).map((p) => p.hasAttribute("tabindex"));
    expect(kolejnosc).toEqual([false, false, true, true]);
  });

  it("tło bierze --secondary, bo --muted w ciemnym motywie JEST kolorem karty", async () => {
    // Powód wyboru tokenu jest w komentarzu komponentu - tu jest jego dowód
    // z `src/styles.css`: w bloku `.dark` --muted == --card, więc kraje bez
    // danych zniknęłyby całkowicie. Fill jedzie w `style`, nie w atrybucie,
    // bo var() w atrybutach prezentacyjnych SVG nie jest wspierany wszędzie.
    const css = readFileSync("src/styles.css", "utf8");
    const dark = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));
    const token = (name: string): string =>
      dark.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? "";
    expect(token("--muted")).toBe(token("--card"));
    expect(token("--secondary")).not.toBe(token("--card"));

    const { container } = await mapa(EUROPA);
    const [tlo] = bgPaths(container);
    expect(tlo.getAttribute("style")).toBe("fill: var(--secondary);");
    expect(tlo.getAttribute("fill")).toBeNull();
    expect(tlo.getAttribute("fill-rule")).toBe("evenodd");
  });
});

describe("ChoroplethMap - tabela jako równorzędna droga do danych", () => {
  it("każdy region ma wiersz z nazwą i wartością, posortowany MALEJĄCO", async () => {
    const { container } = await mapa({
      region: "europe",
      unit: " mld",
      values: [
        { id: "PL", value: 10 },
        { id: "DE", value: 90 },
        { id: "FR", value: 50 },
      ],
    });
    const table = openTable(container);
    const wiersze = within(table).getAllByRole("row").slice(1);
    expect(wiersze.map((r) => r.textContent)).toEqual([
      "DE po polsku90 mld",
      "FR po polsku50 mld",
      "PL po polsku10 mld",
    ]);
    // Nazwa regionu jest nagłówkiem WIERSZA - czytnik czyta ją przy wartości.
    expect(wiersze[0].querySelector("th")?.getAttribute("scope")).toBe("row");
  });

  it("nagłówki i nazwy regionów są przetłumaczone", async () => {
    const { container } = await mapa(EUROPA, { lang: "en" });
    const table = openTable(container, "Show data");
    expect([...table.querySelectorAll("th[scope='col']")].map((th) => th.textContent)).toEqual([
      "Country",
      "Value",
    ]);
    expect(within(table).getByRole("row", { name: /^PL in English/ })).toBeTruthy();
  });

  it("nazwa kraju w tabeli ma fallback językowy w OBIE strony", async () => {
    // Zasób geometrii bywa niepełny (kraj dopisany po jednej stronie
    // słownika). Pusta komórka to utrata danych, więc `nameOf` podstawia
    // nazwę z drugiego języka, a w ostateczności kod ISO.
    h.geo = ASSET_BEZ_NAZW;

    const en = await mapa(EUROPA, { lang: "en" });
    // "PL" ma pustą nazwę EN -> wchodzi polska; "DE" ma pustą PL -> zostaje EN.
    expect(
      within(openTable(en.container, "Show data"))
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(["Germany90", "Polska10"]);
    en.unmount();

    const pl = await mapa(EUROPA);
    expect(
      within(openTable(pl.container))
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(["Germany90", "Polska10"]);
  });

  it("tooltip też korzysta z fallbacku nazwy", async () => {
    h.geo = ASSET_BEZ_NAZW;
    const { container } = await mapa(EUROPA, { lang: "en" });
    fireEvent.pointerMove(dataPaths(container)[0], { clientX: 40, clientY: 40 });
    expect(tip(container)?.textContent).toBe("PolskaValue10");
  });

  it("ETYKIETA ARIA kraju ma ten sam fallback nazwy co tabela - żaden region nie zostaje bez nazwy", async () => {
    // Wszystkie DROGI do nazwy idą przez jedno `nameOf` (z fallbackiem
    // `c.en || c.pl` i kodem ISO na końcu): tabela, tooltip i `aria-label`
    // ścieżki. Gdyby etykieta brała `lang === "en" ? c.en : c.pl` wprost,
    // zasób bez nazwy w języku strony kazałby czytnikowi ogłosić ": 10" -
    // wartość bez podmiotu. To jedyny kanał dostępu do tego regionu na
    // obrazku, więc jego brak jest utratą treści, a nie kosmetyką.
    h.geo = ASSET_BEZ_NAZW;
    const { container } = await mapa(EUROPA, { lang: "en" });
    const etykiety = dataPaths(container).map((p) => p.getAttribute("aria-label"));
    expect(etykiety).toEqual(["Polska: 10", "Germany: 90"]);
  });

  it("PRZED hydracją zasobu tabela pokazuje kod kraju, nigdy pustą komórkę", async () => {
    // Nazwy krajów mieszkają w zasobie geometrii, a ten dogrywa się po
    // hydracji. SSR/crawler dostaje wtedy kod ISO - to degradacja czytelna,
    // pusta komórka byłaby brakiem danych.
    h.geo = null;
    const { container } = await mapa({ ...EUROPA, unit: " %" }, { awaitSvg: false });
    const table = openTable(container);
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(["DE90 %", "PL10 %"]);
  });

  it("przełącznik tabeli ma stan dla czytnika i realnie odsłania panel", async () => {
    const { container, getByRole } = await mapa(EUROPA);
    const przycisk = getByRole("button", { name: "Pokaż dane" });
    expect(przycisk.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(przycisk.getAttribute("aria-controls") ?? "");
    expect(panel?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(przycisk);
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(getByRole("button", { name: "Ukryj dane" }).getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("figcaption")?.textContent).toContain("Poparcie w krajach UE");
  });

  it("podpis źródła jedzie do ramy, a jego brak nie zostawia pustego akapitu", async () => {
    const zZrodlem = await mapa({ ...EUROPA, source: "Źródło: Eurostat 2026" });
    expect(zZrodlem.getByText("Źródło: Eurostat 2026")).toBeTruthy();
    zZrodlem.unmount();
    const bez = await mapa(EUROPA);
    expect(bez.container.querySelectorAll("p.text-xs")).toHaveLength(0);
  });
});

describe("ChoroplethMap - tooltip", () => {
  it("wskazanie kraju pokazuje nazwę, jednostkę i wartość", async () => {
    const { container } = await mapa({ ...EUROPA, unit: " mld EUR" });
    expect(tip(container)).toBeNull();
    fireEvent.pointerMove(dataPaths(container)[0], { clientX: 120, clientY: 60 });
    expect(tip(container)?.textContent).toBe("PL po polskumld EUR10 mld EUR");
    // Wizualny duplikat - dla czytnika schowany, dane niesie aria-label i tabela.
    expect(tip(container)?.getAttribute("aria-hidden")).toBe("true");
    expect(tip(container)?.getAttribute("style")).toContain("translate3d(120px, 60px, 0)");
  });

  it("bez jednostki wiersz tooltipa dostaje etykietę 'Wartość' / 'Value'", async () => {
    const pl = await mapa(EUROPA);
    fireEvent.pointerMove(dataPaths(pl.container)[0], { clientX: 10, clientY: 10 });
    expect(tip(pl.container)?.textContent).toBe("PL po polskuWartość10");
    pl.unmount();

    const en = await mapa(EUROPA, { lang: "en" });
    fireEvent.pointerMove(dataPaths(en.container)[0], { clientX: 10, clientY: 10 });
    expect(tip(en.container)?.textContent).toBe("PL in EnglishValue10");
  });

  it("tooltip przy prawej krawędzi odbija się w lewo zamiast wyjeżdżać z karty", async () => {
    const { container } = await mapa(EUROPA);
    const [pl] = dataPaths(container);
    fireEvent.pointerMove(pl, { clientX: 100, clientY: 20 });
    expect(tip(container)?.getAttribute("style")).toContain("translate(12px");
    // Próg odbicia to 0,6 szerokości kontenera = 432 px.
    fireEvent.pointerMove(pl, { clientX: 500, clientY: 20 });
    expect(tip(container)?.getAttribute("style")).toContain("calc(-100% - 12px)");
  });

  it("opuszczenie kraju chowa tooltip", async () => {
    const { container } = await mapa(EUROPA);
    fireEvent.pointerMove(dataPaths(container)[0], { clientX: 100, clientY: 20 });
    expect(tip(container)).not.toBeNull();
    fireEvent.pointerLeave(dataPaths(container)[0]);
    expect(tip(container)).toBeNull();
  });

  it("aktywny kraj dostaje data-active - to on nosi obrys wyróżnienia", async () => {
    const { container } = await mapa(EUROPA);
    const [pl, de] = dataPaths(container);
    fireEvent.pointerMove(pl, { clientX: 100, clientY: 20 });
    expect(dataPaths(container)[0].getAttribute("data-active")).toBe("true");
    expect(dataPaths(container)[1].hasAttribute("data-active")).toBe(false);
    fireEvent.pointerLeave(pl);
    fireEvent.pointerMove(de, { clientX: 100, clientY: 20 });
    expect(dataPaths(container)[0].hasAttribute("data-active")).toBe(false);
    expect(dataPaths(container)[1].getAttribute("data-active")).toBe("true");
  });

  it("wskaźnik nad ODMONTOWANYM drzewem nie ustawia tooltipa", async () => {
    // Kotwica liczy się z prostokąta kontenera. Gdy ścieżka nie ma już
    // rodzica (przebudowa mapy w trakcie ruchu wskaźnikiem), handler musi
    // wyjść cicho, a nie czytać `getBoundingClientRect` z niczego.
    const { container } = await mapa(EUROPA);
    const [pl] = dataPaths(container);
    Object.defineProperty(pl, "ownerSVGElement", {
      value: document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      configurable: true,
    });
    fireEvent.pointerMove(pl, { clientX: 100, clientY: 20 });
    expect(tip(container)).toBeNull();
  });

  it("BRAK geometrii SVG nie wywala fokusa", async () => {
    const { container } = await mapa(EUROPA);
    expect(() => fireEvent.focus(dataPaths(container)[0])).not.toThrow();
  });

  it("FOKUS klawiaturą kotwiczy tooltip w ŚRODKU kraju, a blur go chowa", async () => {
    const { container } = await mapa({ ...EUROPA, unit: " %" });
    const [pl] = dataPaths(container);
    // Geometria podstawiona ręcznie - patrz nagłówek pliku. Skala = 720/960.
    stubGeometry(pl, { x: 100, y: 200, width: 60, height: 40 });
    fireEvent.focus(pl);
    expect(tip(container)?.textContent).toBe("PL po polsku%10 %");
    // (100 + 30) * 0,75 = 97,5 -> 98; (200 + 20) * 0,75 = 165.
    expect(tip(container)?.getAttribute("style")).toContain("translate3d(98px, 165px, 0)");
    fireEvent.blur(pl);
    expect(tip(container)).toBeNull();
  });

  it("zerowy viewBox nie pozwala policzyć skali - fokus po prostu nic nie ustawia", async () => {
    const { container } = await mapa(EUROPA);
    const [pl] = dataPaths(container);
    Object.defineProperty(pl, "getBBox", {
      value: () => ({ x: 1, y: 1, width: 2, height: 2 }),
      configurable: true,
    });
    Object.defineProperty(pl.ownerSVGElement as SVGSVGElement, "viewBox", {
      value: { baseVal: { width: 0 } },
      configurable: true,
    });
    fireEvent.focus(pl);
    expect(tip(container)).toBeNull();
  });
});

describe("ChoroplethMap - legenda sekwencyjna", () => {
  it("legenda podaje granice domeny TEKSTEM, a gradient jest dekoracją", async () => {
    const { container } = await mapa({
      region: "europe",
      unit: " mld",
      values: [
        { id: "PL", value: 10 },
        { id: "DE", value: 90 },
      ],
    });
    const box = legendBox(container);
    expect(
      [...(box?.querySelectorAll("span.tabular-nums") ?? [])].map((s) => s.textContent),
    ).toEqual(["10 mld", "90 mld"]);
    const gradient = container.querySelector("span[aria-hidden].rounded-full");
    expect(gradient?.textContent).toBe("");
  });

  it("granice legendy są liczone Z DANYCH, nie z krajów widocznych na mapie", async () => {
    const { container } = await mapa({
      region: "europe",
      values: [
        { id: "PL", value: 10 },
        { id: "DE", value: 90 },
        { id: "XX", value: 3 },
      ],
    });
    expect(
      [...(legendBox(container)?.querySelectorAll("span.tabular-nums") ?? [])].map(
        (s) => s.textContent,
      ),
    ).toEqual(["3", "90"]);
  });

  it("granice legendy są formatowane per język", async () => {
    const dane: Record<string, Json> = {
      region: "europe",
      unit: " mln",
      values: [
        { id: "PL", value: 1234.5 },
        { id: "DE", value: 9999.9 },
      ],
    };
    const pl = await mapa(dane);
    expect(legendBox(pl.container)?.textContent).toBe("1234,5 mln9999,9 mln");
    pl.unmount();
    const en = await mapa(dane, { lang: "en" });
    expect(legendBox(en.container)?.textContent).toBe("1,234.5 mln9,999.9 mln");
  });

  it("wyłączona legenda nie zostawia po sobie paska", async () => {
    const { container } = await mapa({ ...EUROPA, showLegend: false });
    expect(legendBox(container)).toBeNull();
    // Sama mapa i tabela zostają.
    expect(container.querySelector("svg.block")).not.toBeNull();
    expect(openTable(container).textContent).toContain("90");
  });
});

describe("ChoroplethMap - dostępność", () => {
  it("kraj z danymi jest OSIĄGALNY Z KLAWIATURY i nazwany bez pomocy koloru", async () => {
    const { container } = await mapa({ ...EUROPA, unit: " %" });
    const [pl] = dataPaths(container);
    expect(pl.getAttribute("tabindex")).toBe("0");
    expect(pl.getAttribute("role")).toBe("img");
    expect(pl.getAttribute("aria-label")).toBe("PL po polsku: 10 %");
    // Kolor jest DODATKIEM: nazwa i wartość jadą tekstem w etykiecie.
    expect(screen.getByRole("img", { name: "DE po polsku: 90 %" })).toBeTruthy();
  });

  it("axe nie ma zastrzeżeń w obu językach, z otwartą tabelą", async () => {
    for (const lang of ["pl", "en"] as const) {
      const { container, unmount } = await mapa({ ...EUROPA, source: "Źródło: test" }, { lang });
      openTable(container);
      const naruszenia = await axeViolations(container);
      expect(naruszenia, `${lang}: ${summarize(naruszenia)}`).toEqual([]);
      unmount();
    }
  });

  it("axe nie ma zastrzeżeń w stanie awarii zasobu", async () => {
    h.fail = true;
    const { container } = await mapa(EUROPA, { awaitSvg: false });
    await waitFor(() => expect(screen.getByText("Nie udało się wczytać mapy.")).toBeTruthy());
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("ChoroplethMap - motyw jasny i ciemny", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const LIGHT = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
  const DARK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

  function token(block: string, name: string): string {
    const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`brak tokenu ${name}`);
    return m[1].toLowerCase();
  }

  function luminancja(hex: string): number {
    const c = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function kontrast(a: string, b: string): number {
    const [l1, l2] = [luminancja(a), luminancja(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }

  const MOTYWY = [
    ["jasny", LIGHT, "#ffffff"],
    ["ciemny", DARK, "#0f0f0f"],
  ] as const;

  it("ramp jest ZDEFINIOWANY w obu motywach i w każdym idzie w swoją stronę", async () => {
    for (const [nazwa, block] of MOTYWY) {
      expect(token(block, "--chart-seq-min"), nazwa).toMatch(/^#[0-9a-f]{6}$/);
      expect(token(block, "--chart-seq-max"), nazwa).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Jasny motyw: jasny -> ciemny. Ciemny: odwrotnie (kotwica przestawiona).
    expect(luminancja(token(LIGHT, "--chart-seq-min"))).toBeGreaterThan(
      luminancja(token(LIGHT, "--chart-seq-max")),
    );
    expect(luminancja(token(DARK, "--chart-seq-min"))).toBeLessThan(
      luminancja(token(DARK, "--chart-seq-max")),
    );
  });

  it("końce rampy są rozróżnialne między sobą i widoczne na karcie w obu motywach", async () => {
    for (const [nazwa, block, card] of MOTYWY) {
      const lo = token(block, "--chart-seq-min");
      const hi = token(block, "--chart-seq-max");
      expect(kontrast(lo, hi), `${nazwa} min/max`).toBeGreaterThanOrEqual(3);
      expect(kontrast(hi, card), `${nazwa} max/karta`).toBeGreaterThanOrEqual(3);
    }
  });

  it("przełączenie motywu NIE zmienia wypełnień z tokenów", async () => {
    const jasna = await mapa(EUROPA);
    const styles = dataPaths(jasna.container).map((p) => p.getAttribute("style"));
    jasna.unmount();

    document.documentElement.classList.add("dark");
    const ciemna = await mapa(EUROPA);
    // color-mix na tokenach rampy jest ten sam - motyw podmienia same tokeny.
    expect(dataPaths(ciemna.container).map((p) => p.getAttribute("style"))).toEqual(styles);
    for (const s of styles) expect(s).toContain("var(--chart-seq-max)");
  });

  it("awaryjne wypełnienie idzie ZA MOTYWEM - w ciemnym najwyższa wartość zostaje najwidoczniejsza", async () => {
    // Atrybut `fill` to fallback dla przeglądarek bez color-mix(): hex
    // interpolowany w JS między parą hexów TEGO SAMEGO motywu, co tokeny
    // rampy. Na jednej parze jasnej ciemny motyw dostawał ramp odwrotny do
    // tokenowego: najniższa wartość świeciła (#b0c8e5 na karcie #0f0f0f,
    // ~11:1), a NAJWYŻSZA gasła (#0d366b, ~1,6:1 - poniżej progu 3:1 dla
    // obiektu graficznego). Tu pilnujemy kierunku i progu w trybie ciemnym.
    document.documentElement.classList.add("dark");
    const { container } = await mapa({
      region: "europe",
      values: [
        { id: "PL", value: 10 },
        { id: "DE", value: 90 },
      ],
    });
    const CARD_DARK = "#0f0f0f";
    const fillOf = (label: RegExp): string =>
      dataPaths(container)
        .find((p) => label.test(p.getAttribute("aria-label") ?? ""))
        ?.getAttribute("fill") ?? "";
    const lo = kontrast(fillOf(/^PL/), CARD_DARK);
    const hi = kontrast(fillOf(/^DE/), CARD_DARK);
    expect(hi, `najwyższa wartość na ciemnej karcie: ${hi.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("ChoroplethMap - izolacja przestrzeni roboczych", () => {
  it("podmiana danych wymiata regiony poprzedniej przestrzeni z mapy, legendy i tabeli", async () => {
    const alfa = cfg({
      region: "europe",
      title: "Zasięg - workspace alfa",
      unit: " szt.",
      values: [
        { id: "PL", value: 11 },
        { id: "DE", value: 22 },
      ],
    });
    const beta = cfg({
      region: "europe",
      title: "Zasięg - workspace beta",
      unit: " szt.",
      values: [
        { id: "FR", value: 77 },
        { id: "CZ", value: 88 },
      ],
    });

    const view = render(
      <Wrapper>
        <ChoroplethMap config={alfa} lang="pl" />
      </Wrapper>,
    );
    await waitFor(() => expect(view.container.querySelector("svg.block")).not.toBeNull());
    fireEvent.pointerMove(dataPaths(view.container)[0], { clientX: 50, clientY: 50 });
    expect(tip(view.container)?.textContent).toContain("11 szt.");
    openTable(view.container);

    view.rerender(
      <Wrapper>
        <ChoroplethMap config={beta} lang="pl" />
      </Wrapper>,
    );

    // Kraj z alfy nie ma już danych, więc tooltip po nim musi zgasnąć.
    expect(tip(view.container)).toBeNull();
    expect(dataPaths(view.container).map((p) => p.getAttribute("aria-label"))).toEqual([
      "FR po polsku: 77 szt.",
      "CZ po polsku: 88 szt.",
    ]);
    const html = view.container.innerHTML;
    for (const slad of ["alfa", "11 szt.", "22 szt.", "PL po polsku: "]) {
      expect(html, slad).not.toContain(slad);
    }
    expect(html).toContain("Zasięg - workspace beta");
  });

  it("wskazany kraj obecny w OBU przestrzeniach przemalowuje się na nową wartość", async () => {
    const alfa = cfg({ region: "europe", unit: " szt.", values: [{ id: "PL", value: 11 }] });
    const beta = cfg({ region: "europe", unit: " szt.", values: [{ id: "PL", value: 99 }] });
    const view = render(
      <Wrapper>
        <ChoroplethMap config={alfa} lang="pl" />
      </Wrapper>,
    );
    await waitFor(() => expect(view.container.querySelector("svg.block")).not.toBeNull());
    fireEvent.pointerMove(dataPaths(view.container)[0], { clientX: 50, clientY: 50 });
    expect(tip(view.container)?.textContent).toContain("11 szt.");

    view.rerender(
      <Wrapper>
        <ChoroplethMap config={beta} lang="pl" />
      </Wrapper>,
    );
    expect(tip(view.container)?.textContent).toContain("99 szt.");
    expect(view.container.innerHTML).not.toContain("11 szt.");
  });
});
