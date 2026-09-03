// Mapa stanowisk państw członkowskich w dossier trackera.
//
// 280 linii, zero wykonanych. To jedyny w module wykres, który koduje dane
// KOLOREM - i stąd jego najważniejsza reguła, wypisana wprost w nagłówku
// pliku: **tooltip nigdy nie jest jedyną drogą do danych**. Osoba czytająca
// ekran, drukująca dossier albo po prostu nierozróżniająca zieleni od
// czerwieni musi dostać pełną treść z tabeli. Regresja jest tu wyjątkowo
// cicha: mapa dalej wygląda dobrze, a połowa czytelników traci dostęp do
// informacji, o którą przyszła.
//
// Druga reguła to porządek tabeli. Kolejność „za -> przeciw -> podzielone ->
// brak" niesie sens polityczny (kto popiera, kto blokuje), a alfabet w obrębie
// grupy MUSI iść po nazwach w języku strony - `localeCompare` bez locale
// stawia „Łotwa" po „Węgrzech".
//
// PUŁAPKA HARNESSU: happy-dom nie implementuje geometrii SVG (`getBBox`,
// `viewBox.baseVal`), więc obsługa fokusu ma tu dwa testy - jeden na wersję
// bez geometrii (komponent nie może się wywalić), drugi z podstawioną.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeoAsset } from "@/lib/charts/types";
import type { PolicyPosition } from "@/lib/tracker/queries";

const h = vi.hoisted(() => ({
  geo: null as unknown,
  fail: false,
}));

vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["geo", region],
    queryFn: () => {
      if (h.fail) throw new Error("404");
      return h.geo ?? new Promise(() => {});
    },
  }),
}));

const { PolicyPositionsMap } = await import("@/components/tracker/PolicyPositionsMap");

/** Minimalny zasób geometrii - kształty nie mają znaczenia dla reguł. */
function geoAsset(ids: string[] = ["PL", "DE", "FR", "NL"]): GeoAsset {
  return {
    v: 1,
    license: "test",
    viewBox: "0 0 960 825",
    countries: ids.map((id) => ({ id, pl: `${id} po polsku`, en: `${id} in English`, d: "M0 0" })),
  };
}

function position(overrides: Partial<PolicyPosition> = {}): PolicyPosition {
  return {
    item_id: "i1",
    country_code: "PL",
    stance: "support",
    note_pl: null,
    note_en: null,
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as PolicyPosition;
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function map(
  opts: { positions?: PolicyPosition[]; lang?: "pl" | "en"; awaitSvg?: boolean } = {},
) {
  const view = render(
    <Wrapper>
      <PolicyPositionsMap
        positions={opts.positions ?? [position()]}
        lang={opts.lang ?? "pl"}
        title="Stanowiska państw"
        description="Kto popiera pakiet"
      />
    </Wrapper>,
  );
  if (opts.awaitSvg !== false && h.geo && !h.fail) {
    await waitFor(() => expect(view.container.querySelector("svg.block")).toBeInTheDocument());
  }
  return view;
}

/** Treść samej podpowiedzi. Tabela też niesie notę (jest w DOM, tylko ukryta),
 *  więc `container.textContent` nie odróżniłby jednej drogi do danych od drugiej. */
function tooltipText(container: HTMLElement): string {
  return container.querySelector(".neh-tooltip")?.textContent ?? "";
}

/** Ścieżki krajów - z pominięciem ikon interfejsu, które też są <path>. */
function countryPaths(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>("g.neh-map-countries > path")];
}

/** Otwiera przełączaną tabelę danych pod wykresem. */
function openTable() {
  fireEvent.click(screen.getByRole("button", { name: /dane|data/i }));
  return screen.getByRole("table");
}

beforeEach(() => {
  h.geo = geoAsset();
  h.fail = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Znak zastępczy pustej noty - DYWIZ, nie pauza.
 *
 * Ten test przypinał wcześniej pauzę (U+2014) literałem. House style
 * repozytorium dopuszcza w treści widocznej wyłącznie dywiz, a `i18nCohesion`
 * pilnuje tego tylko w słownikach - literał w kodzie komponentu przechodził
 * obok bramki. Po zamianie test padł, co dowodzi, że asercja dotyczy TEGO
 * znaku, a nie „czegokolwiek w tej komórce".
 */
const NO_NOTE_DASH = "-";

describe("PolicyPositionsMap - pusty zestaw", () => {
  it("dossier BEZ stanowisk nie dostaje pustej mapy", async () => {
    // Ramka wykresu z zerową legendą i pustą tabelą wygląda jak awaria
    // ładowania, a to po prostu dossier, którego jeszcze nikt nie opisał.
    const { container } = await map({ positions: [], awaitSvg: false });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PolicyPositionsMap - tabela jest równorzędną drogą do danych", () => {
  // Nazwy państw pochodzą ze słownika UE (`euCountries`), a nie z zasobu
  // geometrii - ten drugi opisuje tylko tło mapy.
  it("każde stanowisko ma wiersz z państwem, stanowiskiem i notą", async () => {
    await map({
      positions: [position({ country_code: "PL", stance: "support", note_pl: "Poparcie rządu" })],
    });
    const row = within(openTable()).getByRole("row", { name: /Polska/ });
    expect(within(row).getByText("Za")).toBeInTheDocument();
    expect(within(row).getByText("Poparcie rządu")).toBeInTheDocument();
  });

  it("brak noty daje DYWIZ, a nie pustą komórkę", async () => {
    // Pusta komórka w tabeli czyta się jak brak danych do odczytu; dywiz
    // mówi „sprawdziliśmy, nie ma noty".
    await map({ positions: [position()] });
    expect(within(openTable()).getByText(NO_NOTE_DASH)).toBeInTheDocument();
  });

  it("nota ma fallback językowy w OBIE strony", async () => {
    const { unmount } = await map({ positions: [position({ note_en: "Only English" })] });
    expect(within(openTable()).getByText("Only English")).toBeInTheDocument();
    unmount();

    await map({ lang: "en", positions: [position({ note_pl: "Tylko po polsku" })] });
    expect(within(openTable()).getByText("Tylko po polsku")).toBeInTheDocument();
  });

  it("nota z samych spacji liczy się jako brak", async () => {
    await map({ positions: [position({ note_pl: "   " })] });
    expect(within(openTable()).getByText(NO_NOTE_DASH)).toBeInTheDocument();
  });

  it("nagłówki tabeli są przetłumaczone", async () => {
    await map({ lang: "en", positions: [position()] });
    const table = openTable();
    expect(within(table).getByRole("columnheader", { name: "Country" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Position" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Note" })).toBeInTheDocument();
  });
});

describe("PolicyPositionsMap - porządek tabeli niesie sens polityczny", () => {
  it("sortuje ZA -> PRZECIW -> PODZIELONE -> BRAK", async () => {
    await map({
      positions: [
        position({ country_code: "FR", stance: "undecided" }),
        position({ country_code: "DE", stance: "oppose" }),
        position({ country_code: "PL", stance: "support" }),
        position({ country_code: "NL", stance: "mixed" }),
      ],
    });
    const rows = within(openTable()).getAllByRole("row").slice(1);
    expect(
      rows.map((r) => r.textContent?.replace(/(Za|Przeciw|Podzielone|Brak stanowiska).*/, "")),
    ).toEqual(["Polska", "Niemcy", "Niderlandy", "Francja"]);
  });

  it("w obrębie grupy sortuje po nazwie W JĘZYKU STRONY", async () => {
    // `localeCompare` bez locale stawia „Łotwa" za „Węgrzech" - polski
    // czytelnik dostaje alfabet, którego nie zna.
    await map({
      positions: [
        position({ country_code: "HU", stance: "support" }),
        position({ country_code: "LV", stance: "support" }),
      ],
    });
    const rows = within(openTable()).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Łotwa");
    expect(rows[1].textContent).toContain("Węgry");
  });

  it("nieznane stanowisko ląduje w grupie „brak stanowiska”", async () => {
    // Kolumna ma CHECK, ale migracja rozszerzająca słownik dotrze do bazy
    // przed nowym frontem - wtedy wiersz ma nie zniknąć z tabeli.
    await map({ positions: [position({ stance: "nieznane" as PolicyPosition["stance"] })] });
    expect(within(openTable()).getByText("Brak stanowiska")).toBeInTheDocument();
  });
});

describe("PolicyPositionsMap - legenda z licznikami", () => {
  it("pokazuje wszystkie cztery kategorie, także te bez państw", async () => {
    // Zero w legendzie to informacja („nikt nie jest przeciw"), a nie brak
    // danych - dlatego kategorie nie znikają.
    const { container } = await map({ positions: [position()] });
    const legend = container.querySelectorAll("ul[role=list] > li");
    expect(legend).toHaveLength(4);
    expect(legend[0].textContent).toContain("(1)");
    expect(legend[1].textContent).toContain("(0)");
  });

  it("liczy państwa w każdej kategorii", async () => {
    const { container } = await map({
      positions: [
        position({ country_code: "PL", stance: "support" }),
        position({ country_code: "DE", stance: "support" }),
        position({ country_code: "FR", stance: "oppose" }),
      ],
    });
    const legend = [...container.querySelectorAll("ul[role=list] > li")].map(
      (li) => li.textContent,
    );
    expect(legend[0]).toContain("(2)");
    expect(legend[1]).toContain("(1)");
  });

  it("etykiety legendy są przetłumaczone", async () => {
    const { container } = await map({ lang: "en", positions: [position()] });
    expect(container.querySelector("ul[role=list]")?.textContent).toContain("In favour");
  });
});

describe("PolicyPositionsMap - mapa", () => {
  it("państwo ze stanowiskiem jest OSIĄGALNE Z KLAWIATURY i opisane", async () => {
    // Kolor sam w sobie nie jest treścią - etykieta niesie nazwę i stanowisko.
    await map({ positions: [position({ country_code: "PL", stance: "oppose" })] });
    const path = screen.getByRole("img", { name: "Polska: Przeciw" });
    expect(path).toHaveAttribute("tabindex", "0");
  });

  it("państwo BEZ stanowiska nie jest fokusowalne i nie udaje danych", async () => {
    // Kraj bez stanowiska to tło mapy; w porządku tabulacji byłby pustym
    // przystankiem, a dla czytnika - obietnicą treści, której nie ma.
    const { container } = await map({ positions: [position({ country_code: "PL" })] });
    const background = countryPaths(container).filter((p) => !p.hasAttribute("tabindex"));
    expect(background).toHaveLength(3);
    expect(background[0].querySelector("title")?.textContent).toBe("DE po polsku");
  });

  it("nazwy tła idą w języku strony", async () => {
    const { container } = await map({ lang: "en", positions: [position({ country_code: "PL" })] });
    const background = countryPaths(container).filter((p) => !p.hasAttribute("tabindex"));
    expect(background[0].querySelector("title")?.textContent).toBe("DE in English");
  });

  it("awaria zasobu geometrii daje komunikat, nie pustą dziurę", async () => {
    h.fail = true;
    await map({ positions: [position()], awaitSvg: false });
    expect(await screen.findByText("Nie udało się wczytać mapy.")).toBeInTheDocument();
    // Tabela zostaje - dane są dostępne również bez mapy.
    expect(within(openTable()).getByRole("row", { name: /Polska/ })).toBeInTheDocument();
  });

  it("komunikat awarii jest przetłumaczony", async () => {
    h.fail = true;
    await map({ lang: "en", positions: [position()], awaitSvg: false });
    expect(await screen.findByText("Map failed to load.")).toBeInTheDocument();
  });

  it("do czasu wczytania geometrii stoi migotka ukryta przed czytnikiem", async () => {
    h.geo = null;
    const { container } = await map({ positions: [position()], awaitSvg: false });
    const shimmer = container.querySelector(".skeleton-shimmer");
    expect(shimmer).toBeInTheDocument();
    expect(shimmer).toHaveAttribute("aria-hidden");
  });
});

describe("PolicyPositionsMap - podpowiedź", () => {
  it("najechanie na państwo pokazuje jego stanowisko", async () => {
    const { container } = await map({
      positions: [position({ country_code: "PL", stance: "support", note_pl: "Poparcie rządu" })],
    });
    const path = screen.getByRole("img", { name: /Polska/ });
    fireEvent.pointerMove(path, { clientX: 100, clientY: 50 });
    expect(tooltipText(container)).toContain("Polska");
    expect(tooltipText(container)).toContain("Za");
    expect(tooltipText(container)).toContain("Poparcie rządu");
  });

  it("opuszczenie państwa chowa podpowiedź", async () => {
    const { container } = await map({
      positions: [position({ note_pl: "Poparcie rządu" })],
    });
    const path = screen.getByRole("img", { name: /Polska/ });
    fireEvent.pointerMove(path, { clientX: 100, clientY: 50 });
    expect(tooltipText(container)).toContain("Poparcie rządu");
    fireEvent.pointerLeave(path);
    await waitFor(() => expect(container.querySelector(".neh-tooltip")).toBeNull());
  });

  it("DŁUGA nota jest przycięta - podpowiedź nie może zasłonić mapy", async () => {
    const long = "a".repeat(300);
    const { container } = await map({ positions: [position({ note_pl: long })] });
    fireEvent.pointerMove(screen.getByRole("img", { name: /Polska/ }), {
      clientX: 10,
      clientY: 10,
    });
    expect(tooltipText(container)).toContain(`${"a".repeat(137)}…`);
    expect(tooltipText(container)).not.toContain(long);
  });

  it("BRAK geometrii SVG nie wywala fokusa", async () => {
    // happy-dom nie implementuje `getBBox`/`viewBox.baseVal`; komponent ma
    // wtedy po prostu nie ustawić podpowiedzi, a nie rzucić wyjątkiem.
    await map({ positions: [position({ note_pl: "Poparcie rządu" })] });
    const path = screen.getByRole("img", { name: /Polska/ });
    expect(() => fireEvent.focus(path)).not.toThrow();
  });

  it("fokus klawiaturą pokazuje podpowiedź NAD środkiem państwa", async () => {
    const { container } = await map({ positions: [position({ note_pl: "Poparcie rządu" })] });
    const path = screen.getByRole("img", { name: /Polska/ }) as unknown as SVGPathElement;
    // Geometria podstawiona ręcznie - patrz nagłówek pliku.
    Object.defineProperty(path, "getBBox", {
      value: () => ({ x: 100, y: 200, width: 60, height: 40 }),
      configurable: true,
    });
    Object.defineProperty(path.ownerSVGElement!, "viewBox", {
      value: { baseVal: { width: 960 } },
      configurable: true,
    });
    fireEvent.focus(path);
    expect(tooltipText(container)).toContain("Poparcie rządu");
  });

  it("utrata fokusu chowa podpowiedź", async () => {
    const { container } = await map({ positions: [position({ note_pl: "Poparcie rządu" })] });
    const path = screen.getByRole("img", { name: /Polska/ }) as unknown as SVGPathElement;
    Object.defineProperty(path, "getBBox", {
      value: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      configurable: true,
    });
    Object.defineProperty(path.ownerSVGElement!, "viewBox", {
      value: { baseVal: { width: 960 } },
      configurable: true,
    });
    fireEvent.focus(path);
    expect(tooltipText(container)).toContain("Poparcie rządu");
    fireEvent.blur(path);
    await waitFor(() => expect(container.querySelector(".neh-tooltip")).toBeNull());
  });
});
