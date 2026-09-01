// `GscBiDashboard` - pulpit Search Console: kolejnosc danych, stany i okablowanie.
//
// PO CO. Ten plik stal na zerze (0/163 linii, 0/66 funkcji) - najwiekszy zer w
// module analityki. Czysta arytmetyka wnioskow zostala juz wyciagnieta do
// `gscInsights.ts` i ma wlasny, pelny test; TUTAJ przedmiotem dowodu jest to,
// czego tamten plik nie widzi, a co decyduje o tym, czy operator patrzy na
// POMIAR, czy na atrape pomiaru:
//
//   1. KOLEJNOSC I AGREGACJA. Search Console oddaje wiersze bez gwarancji
//      porzadku. Panel sam sortuje serie czasowa, przycina rank do 15 fraz,
//      zwija kraje do osmiu plus „Inne" i skraca sciezki w treemapie. Kazda z
//      tych operacji jest cicha: zle posortowany trend to wykres, ktory
//      wyglada poprawnie i klamie o kierunku ruchu.
//   2. ROZROZNIENIE STANOW. „Search Console niepodlaczony", „ladowanie",
//      „zero wierszy" i „zapytanie padlo" to CZTERY rozne komunikaty dla
//      operatora, a wszystkie cztery da sie pomylic z jednym: zerami w
//      kafelkach KPI. Klucz `configured: false` istnieje wylacznie po to, zeby
//      tego rozroznienia pilnowac.
//   3. OKABLOWANIE FILTRA. Zmiana okna ma zmienic WEJSCIE zapytania, nie samo
//      renderowanie - dlatego asercje ida na argument funkcji serwerowej.
//   4. IZOLACJA WARSZTATU. Panel czyta dane wlasciwosci przypietej do
//      biezacego warsztatu; wlasciwosc innego warsztatu nie ma prawa pojawic
//      sie ani w wyborze, ani w argumencie zapytania.
//   5. ALTERNATYWA TEKSTOWA. ECharts maluje do kanwy, ktora dla czytnika
//      ekranu jest pustym prostokatem. Karta ma mechanizm tabeli danych - test
//      sprawdza, ILE wykresow panelu faktycznie go dostaje.
//
// ECHARTS JEST TU ZAKAZANY (patrz naglowek `EChart.tsx`): podmieniamy `EChart`
// atrapa, ktora PRZECHWYTUJE `option`. Dzieki temu asercje o kolejnosci i
// agregacji ida na strukture danych oddana wykresowi, a nie na piksele.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GscRow, GscSite } from "@/lib/analytics/gsc.functions";

type Opt = Record<string, unknown>;

interface AnalyticsInput {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit: number;
}

const h = vi.hoisted(() => ({
  listSites: vi.fn(),
  queryAnalytics: vi.fn(),
  chartOptions: [] as Record<string, unknown>[],
}));

// `useServerFn` staje sie tozsamoscia - wywolanie idzie prosto do atrapy.
// Mock CZESCIOWY, bo `@/lib/i18n` ciagnie z tego samego pakietu
// `createIsomorphicFn`, a pelna atrapa wywracalaby inicjalizacje slownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/gsc.functions", () => ({
  listGscSites: (...args: unknown[]) => h.listSites(...args),
  queryGscAnalytics: (...args: unknown[]) => h.queryAnalytics(...args),
}));

// Atrapa wykresu zapisuje `option`. To jedyne miejsce, w ktorym widac, CO panel
// policzyl - i jedyny sposob na dowiedzenie kolejnosci bez wciagania echarts do
// procesu testowego.
vi.mock("../EChart", () => ({
  EChart: ({ option }: { option: Record<string, unknown> }) => {
    h.chartOptions.push(option);
    return <div data-testid="echart" />;
  },
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujezyczny, a przedmiotem
// dowodu jest to, ze napisy przychodza ZE SLOWNIKA. Jezyk przestawia sie przez
// `i18n.changeLanguage`. Skrot `vi.mock("react-i18next", () => reactI18nextMock())`
// zakleszcza test - fabryka siegnelaby po `@/lib/i18n`, ktory importuje wlasnie
// atrapowany modul (patrz naglowek `src/test/i18nReal.ts`).
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { GscBiDashboard } from "../GscBiDashboard";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

const SITE_A = "sc-domain:alfa.example.com";
const SITE_B = "sc-domain:beta.example.org";
const SITE_NES = "sc-domain:neweuropeanstrategies.com";

function site(siteUrl: string): GscSite {
  return { siteUrl, permissionLevel: "siteOwner" };
}

function row(
  key: string,
  clicks: number,
  impressions: number,
  ctr: number,
  position: number,
): GscRow {
  return { keys: [key], clicks, impressions, ctr, position };
}

/** Serie dzienne CELOWO w zlej kolejnosci - GSC nie obiecuje porzadku. */
const DATE_ROWS: GscRow[] = [
  row("2026-08-03", 30, 300, 0.1, 8),
  row("2026-08-01", 10, 200, 0.05, 12),
  row("2026-08-02", 20, 250, 0.08, 10),
];
const PREV_ROWS: GscRow[] = [
  row("2026-07-30", 25, 350, 0.071, 11),
  row("2026-07-31", 15, 250, 0.06, 13),
];
const QUERY_ROWS: GscRow[] = [
  row("energia w cee", 50, 500, 0.1, 2.4),
  row("polityka klimatyczna", 30, 600, 0.05, 7.2),
  row("raport nes", 20, 900, 0.022, 15.5),
  row("bezpieczenstwo dostaw", 5, 400, 0.0125, 33),
  row("dlugi ogon frazy", 1, 100, 0.01, 78),
];
const PAGE_ROWS: GscRow[] = [
  row("https://alfa.example.com/analizy/bardzo-dluga-sciezka-o-energii-w-regionie", 40, 900, 0.044, 6),
  row("https://alfa.example.com/o-nas", 12, 300, 0.04, 9),
];
/** Kraje juz posortowane malejaco - tak jak oddaje je API. */
const COUNTRY_ROWS: GscRow[] = [
  row("pol", 100, 900, 0.11, 5),
  row("deu", 90, 800, 0.11, 6),
  row("fra", 80, 700, 0.11, 7),
  row("esp", 70, 600, 0.11, 8),
  row("ita", 60, 500, 0.12, 9),
  row("nld", 50, 400, 0.12, 10),
  row("bel", 40, 300, 0.13, 11),
  row("cze", 30, 200, 0.15, 12),
  row("svk", 20, 150, 0.13, 14),
  row("hun", 10, 100, 0.1, 16),
];
const DEVICE_ROWS: GscRow[] = [
  row("DESKTOP", 40, 500, 0.08, 9),
  row("MOBILE", 18, 220, 0.081, 11),
  row("TABLET", 2, 30, 0.066, 13),
];

interface Dataset {
  date: GscRow[];
  query: GscRow[];
  page: GscRow[];
  country: GscRow[];
  device: GscRow[];
  prev: GscRow[];
}

const FULL: Dataset = {
  date: DATE_ROWS,
  query: QUERY_ROWS,
  page: PAGE_ROWS,
  country: COUNTRY_ROWS,
  device: DEVICE_ROWS,
  prev: PREV_ROWS,
};
const EMPTY: Dataset = { date: [], query: [], page: [], country: [], device: [], prev: [] };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Odpowiada wierszami wedlug wymiaru. Zapytanie o POPRZEDNIE okno rozpoznajemy
 * po tym, ze jego `endDate` nie jest dzisiejsza data - to jedyne, co je odroznia
 * od zapytania o serie dzienna biezacego okna.
 */
function respondWith(ds: Dataset): void {
  h.queryAnalytics.mockImplementation(async (arg: { data: AnalyticsInput }) => {
    const dim = arg.data.dimensions[0];
    if (dim === "date") {
      return { rows: arg.data.endDate === todayISO() ? ds.date : ds.prev };
    }
    if (dim === "query") return { rows: ds.query };
    if (dim === "page") return { rows: ds.page };
    if (dim === "country") return { rows: ds.country };
    if (dim === "device") return { rows: ds.device };
    return { rows: [] };
  });
}

// ---------------------------------------------------------------------------
// Narzedzia
// ---------------------------------------------------------------------------

function rec(v: unknown): Opt {
  return (v ?? {}) as Opt;
}
function seriesOf(o: Opt): Opt[] {
  return Array.isArray(o.series) ? (o.series as Opt[]) : [];
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map(String) : [];
}
function numList(v: unknown): number[] {
  return Array.isArray(v) ? (v as unknown[]).map(Number) : [];
}

/** OSTATNIA przechwycona opcja pasujaca do predykatu - czyli stan po ostatnim renderze. */
function lastOption(label: string, pred: (o: Opt) => boolean): Opt {
  for (let i = h.chartOptions.length - 1; i >= 0; i -= 1) {
    if (pred(h.chartOptions[i])) return h.chartOptions[i];
  }
  throw new Error(`test: nie przechwycono opcji wykresu „${label}"`);
}

/** Ostatnie `n` przechwyconych opcji pasujacych do predykatu, w kolejnosci renderu. */
function lastOptions(label: string, pred: (o: Opt) => boolean, n: number): Opt[] {
  const hits = h.chartOptions.filter(pred);
  if (hits.length < n) throw new Error(`test: przechwycono za malo opcji „${label}"`);
  return hits.slice(hits.length - n);
}

const trendOption = () =>
  lastOption("trend", (o) => seriesOf(o).length === 3 && "dataZoom" in o);
const topQueriesOption = () =>
  lastOption(
    "top zapytan",
    (o) => !Array.isArray(o.yAxis) && rec(o.yAxis).type === "category",
  );
const positionOption = () =>
  lastOption(
    "rozklad pozycji",
    (o) => Array.isArray(o.yAxis) && seriesOf(o)[0]?.type === "bar",
  );
const donutOption = (name: string) =>
  lastOption(
    `donut ${name}`,
    (o) => seriesOf(o)[0]?.type === "pie" && seriesOf(o)[0]?.name === name,
  );
const treemapOption = () =>
  lastOption("treemap", (o) => seriesOf(o)[0]?.type === "treemap");
const calendarOption = () => lastOption("kalendarz", (o) => "calendar" in o);

function analyticsInputs(): AnalyticsInput[] {
  return h.queryAnalytics.mock.calls.map((c) => (c[0] as { data: AnalyticsInput }).data);
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Tytuly kart w kolejnosci, w jakiej panel je uklada. */
const CHART_TITLE_KEYS = [
  "adminAnalytics.gsc.charts.trendTitle",
  "adminAnalytics.gsc.charts.topQueriesTitle",
  "adminAnalytics.gsc.charts.positionTitle",
  "adminAnalytics.gsc.charts.countriesTitle",
  "adminAnalytics.gsc.charts.devicesTitle",
  "adminAnalytics.gsc.charts.pagesTitle",
  "adminAnalytics.gsc.charts.calendarTitle",
] as const;

function regionName(lang: "pl" | "en", titleKey: string): string {
  const t = realT(lang);
  return t("adminAnalytics.chartCard.chartRegion", { title: t(titleKey) });
}

/** Dostepne nazwy regionow wykresow - jedyne miejsce, w ktorym tytul karty jest UNIKALNY. */
function chartRegionNames(): string[] {
  return screen.getAllByRole("img").map((el) => el.getAttribute("aria-label") ?? "");
}

/** Wartosc kafelka KPI stojaca przy podanej etykiecie. */
function kpiValue(label: string): string {
  const box = screen.getByText(label).closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI „${label}"`);
  return box.lastElementChild?.textContent ?? "";
}

function panel(configured = true, client?: QueryClient) {
  const queryClient =
    client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <GscBiDashboard configured={configured} />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Czeka az wszystkie szesc zapytan panelu odpowie i znikna wskazniki ladowania. */
async function loaded(): Promise<void> {
  await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));
  await waitFor(() => {
    expect(screen.queryByText(realT("pl")("adminAnalytics.common.loadingData"))).toBeNull();
    expect(screen.queryByText(realT("en")("adminAnalytics.common.loadingData"))).toBeNull();
  });
}

/** Otwiera liste Radiksa klawiatura - pointer events nie dzialaja w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

function comboboxWithText(text: string): HTMLElement {
  const found = screen
    .getAllByRole("combobox")
    .find((el) => (el.textContent ?? "").trim() === text);
  if (!found) throw new Error(`test: nie znaleziono pola wyboru z tekstem „${text}"`);
  return found;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.chartOptions.length = 0;
  h.listSites.mockReset();
  h.queryAnalytics.mockReset();
  h.listSites.mockResolvedValue({ sites: [site(SITE_A)], configured: true });
  respondWith(FULL);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("GscBiDashboard - Search Console niepodlaczony", () => {
  it("mowi, ze integracji nie ma, zamiast pokazywac zera jako pomiar", () => {
    const t = realT("pl");
    const { container } = panel(false);

    // Caly panel to JEDEN komunikat - zadnego kafelka, zadnego wykresu.
    expect(container.textContent).toBe(
      t("adminAnalytics.gsc.notConfiguredPre") +
        t("adminAnalytics.gsc.notConfiguredTab") +
        t("adminAnalytics.gsc.notConfiguredPost"),
    );
    expect(screen.queryByText(t("adminAnalytics.gsc.clicks"))).toBeNull();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it("nie odpytuje ani listy wlasciwosci, ani Search Analytics", async () => {
    panel(false);

    // `enabled: configured` ma wstrzymac ODCZYT, nie tylko ukryc wynik -
    // inaczej niepodlaczony tenant generuje ruch do bramki przy kazdym wejsciu.
    await waitFor(() => expect(h.listSites).not.toHaveBeenCalled());
    expect(h.queryAnalytics).not.toHaveBeenCalled();
  });

  it("komunikat o braku integracji ma tresc w EN, nie polska awaryjna", async () => {
    await i18n.changeLanguage("en");
    const t = realT("en");
    const { container } = panel(false);

    expect(container.textContent).toBe(
      t("adminAnalytics.gsc.notConfiguredPre") +
        t("adminAnalytics.gsc.notConfiguredTab") +
        t("adminAnalytics.gsc.notConfiguredPost"),
    );
    expect(container.textContent).toContain("Search Console");
    expect(container.textContent).not.toContain(
      realT("pl")("adminAnalytics.gsc.notConfiguredTab"),
    );
  });
});

describe("GscBiDashboard - ladowanie", () => {
  it("w trakcie pobierania pokazuje wskaznik ladowania ze slownika", async () => {
    h.queryAnalytics.mockImplementation(() => new Promise<{ rows: GscRow[] }>(() => {}));
    panel();

    expect(
      await screen.findByText(realT("pl")("adminAnalytics.common.loadingData")),
    ).toBeInTheDocument();
  });

  it.fails(
    "DEFEKT: w trakcie pobierania kafelki KPI pokazuja zera, jakby to byl pomiar",
    async () => {
      // Zero i „jeszcze nie wiem" to dwie rozne informacje. Panel renderuje
      // pelna siatke KPI natychmiast, wiec operator widzi „0 klikniec" zanim
      // dane w ogole dojada - i nie ma jak odroznic tego od wlasciwosci, ktora
      // faktycznie nie ma ruchu. Sasiedni pulpity modulu (`AudienceSegments`,
      // `RelatedPostsAnalytics`) w takiej sytuacji renderuja komunikat.
      h.queryAnalytics.mockImplementation(() => new Promise<{ rows: GscRow[] }>(() => {}));
      panel();
      await screen.findByText(realT("pl")("adminAnalytics.common.loadingData"));

      expect(kpiValue(realT("pl")("adminAnalytics.gsc.clicks"))).not.toBe("0");
    },
  );
});

describe("GscBiDashboard - dane", () => {
  it("kafelki KPI licza sumy okna, a pozycje wazy wyswietleniami", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    // 10+20+30 klikniec, 200+250+300 wyswietlen, CTR = 60/750,
    // pozycja = (12*200 + 10*250 + 8*300) / 750 = 9,73.
    await waitFor(() => expect(kpiValue(t("adminAnalytics.gsc.clicks"))).toBe("60"));
    expect(kpiValue(t("adminAnalytics.gsc.impressions"))).toBe("750");
    expect(kpiValue("CTR")).toBe("8.00%");
    expect(kpiValue(t("adminAnalytics.gsc.avgPosition"))).toBe("9.7");
  });

  it("trend porzadkuje serie chronologicznie mimo wierszy w zlej kolejnosci", async () => {
    panel();
    await loaded();

    await waitFor(() => {
      const o = trendOption();
      expect(strList(rec(o.xAxis).data)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    });
    const o = trendOption();
    const s = seriesOf(o);
    // Klikniecia, wyswietlenia i CTR musza jechac PO TEJ SAMEJ osi czasu -
    // rozjazd choc jednej serii to wykres, ktory wyglada poprawnie i klamie.
    expect(numList(s[0].data)).toEqual([10, 20, 30]);
    expect(numList(s[1].data)).toEqual([200, 250, 300]);
    expect(numList(s[2].data)).toEqual([5, 8, 10]);
  });

  it("iskry przy KPI jada tym samym porzadkiem co trend", async () => {
    panel();
    await loaded();

    // Iskry licza sie POZA `useMemo`, kazda wlasnym sortem - to osobna okazja,
    // zeby wykres kierunkowy przy kafelku pokazal cos innego niz duzy trend.
    await waitFor(() => {
      const [klikniecia, wyswietlenia] = lastOptions(
        "iskra",
        (o) => rec(o.xAxis).show === false,
        2,
      );
      expect(numList(seriesOf(klikniecia)[0].data)).toEqual([10, 20, 30]);
      expect(numList(seriesOf(wyswietlenia)[0].data)).toEqual([200, 250, 300]);
    });
  });

  it("rank zapytan idzie rosnaco ku gorze wykresu poziomego", async () => {
    panel();
    await loaded();

    await waitFor(() => {
      const o = topQueriesOption();
      expect(strList(rec(o.yAxis).data)).toEqual([
        "dlugi ogon frazy",
        "bezpieczenstwo dostaw",
        "raport nes",
        "polityka klimatyczna",
        "energia w cee",
      ]);
    });
    // Os kategorii ECharts rosnie w gore, wiec najmocniejsza fraza musi byc
    // OSTATNIA - odwrotna kolejnosc dalaby rank do gory nogami.
    expect(numList(seriesOf(topQueriesOption())[0].data)).toEqual([1, 5, 20, 30, 50]);
  });

  it("rank przycina sie do 15 fraz i zostawia te najmocniejsze", async () => {
    const many = Array.from({ length: 18 }, (_, i) =>
      row(`fraza ${String(i + 1).padStart(2, "0")}`, i + 1, (i + 1) * 10, 0.1, 5),
    );
    respondWith({ ...FULL, query: many });
    panel();
    await loaded();

    await waitFor(() => {
      const labels = strList(rec(topQueriesOption().yAxis).data);
      expect(labels).toHaveLength(15);
      expect(labels[14]).toBe("fraza 18");
      expect(labels[0]).toBe("fraza 04");
    });
    // Trzy najslabsze frazy wypadaja - gdyby przycinal przed sortowaniem,
    // wypadlyby przypadkowe.
    expect(strList(rec(topQueriesOption().yAxis).data)).not.toContain("fraza 03");
  });

  it("histogram pozycji sumuje wyswietlenia do przedzialow SERP", async () => {
    panel();
    await loaded();

    await waitFor(() => {
      const o = positionOption();
      expect(strList(rec(o.xAxis).data)).toEqual(["1-3", "4-10", "11-20", "21-50", "51+"]);
    });
    const s = seriesOf(positionOption());
    // pozycje 2,4 / 7,2 / 15,5 / 33 / 78 - po jednej frazie na przedzial.
    expect(numList(s[0].data)).toEqual([500, 600, 900, 400, 100]);
    expect(numList(s[1].data)).toEqual([50, 30, 20, 5, 1]);
  });

  it("donut krajow pokazuje osiem najwiekszych, a reszte zwija w „Inne”", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => {
      const data = donutOption(t("adminAnalytics.gsc.charts.countriesTitle")).series;
      expect(Array.isArray(data)).toBe(true);
    });
    const slices = (seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))[0]
      .data ?? []) as Array<{ name: string; value: number }>;
    expect(slices).toHaveLength(9);
    expect(slices.slice(0, 8).map((s) => s.name)).toEqual([
      "pol",
      "deu",
      "fra",
      "esp",
      "ita",
      "nld",
      "bel",
      "cze",
    ]);
    // „Inne" to dokladnie to, czego donut NIE pokazal: svk 20 + hun 10.
    expect(slices[8]).toEqual({ name: t("adminAnalytics.gsc.other"), value: 30 });
  });

  it("donut urzadzen nie dokleja „Innych”, gdy wymiar ma mniej niz dziewiec wartosci", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => {
      const slices = (seriesOf(donutOption(t("adminAnalytics.gsc.charts.devicesTitle")))[0].data ??
        []) as Array<{ name: string; value: number }>;
      expect(slices.map((s) => s.name)).toEqual(["DESKTOP", "MOBILE", "TABLET"]);
    });
  });

  it.fails(
    "DEFEKT: „Inne” w donucie liczy sie z ogona WEJSCIA, nie z reszty poza pierwsza osemka",
    async () => {
      // `top` bierze osiem najwiekszych PO wlasnym sortowaniu, ale `otherClicks`
      // sumuje `rows.slice(8)` - ogon KOLEJNOSCI WEJSCIOWEJ. Gdy API odda
      // wiersze inaczej niz malejaco, te dwa zbiory zachodza na siebie: kraje
      // pokazane jako osobne wycinki wchodza JESZCZE RAZ do „Innych", a udzialy
      // procentowe donuta przestaja sie sumowac do calosci.
      const t = realT("pl");
      respondWith({ ...FULL, country: [...COUNTRY_ROWS].reverse() });
      panel();
      await loaded();

      await waitFor(() => {
        const slices = (seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))[0]
          .data ?? []) as Array<{ name: string; value: number }>;
        expect(slices).toHaveLength(9);
      });
      const slices = (seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))[0]
        .data ?? []) as Array<{ name: string; value: number }>;
      expect(slices[8]).toEqual({ name: t("adminAnalytics.gsc.other"), value: 30 });
    },
  );

  it("treemap obcina domene ze sciezki i skraca dlugie adresy", async () => {
    panel();
    await loaded();

    await waitFor(() => {
      const nodes = (seriesOf(treemapOption())[0].data ?? []) as Array<{
        name: string;
        value: number;
        fullPath: string;
        rawUrl: string;
      }>;
      expect(nodes).toHaveLength(2);
      // Kafelek pokazuje SCIEZKE, nie caly adres - domena w kazdym kaflu to
      // szum, ktory zjada miejsce na nazwe strony.
      expect(nodes[0].fullPath).toBe("/analizy/bardzo-dluga-sciezka-o-energii-w-regionie");
      expect(nodes[0].name).toBe(
        "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie".slice(0, 30) + "…",
      );
      expect(nodes[0].rawUrl).toBe(PAGE_ROWS[0].keys[0]);
      // Sortowanie treemapy idzie po WYSWIETLENIACH, nie po klikieciach.
      expect(nodes.map((n) => n.value)).toEqual([900, 300]);
    });
  });

  it("kalendarz dostaje pary dzien-klikniecia i zakres od pierwszego do ostatniego dnia", async () => {
    panel();
    await loaded();

    await waitFor(() => {
      const o = calendarOption();
      expect(rec(o.calendar).range).toEqual(["2026-08-01", "2026-08-03"]);
      expect(seriesOf(o)[0].data).toEqual([
        ["2026-08-01", 10],
        ["2026-08-02", 20],
        ["2026-08-03", 30],
      ]);
      // Skala koloru musi siegac maksimum serii, inaczej najmocniejszy dzien
      // jest nieodrozninalny od sredniego.
      expect(rec(o.visualMap).max).toBe(30);
    });
  });

  it("sekcja interpretacji dostaje okno i wlasciwosc, ktore panel faktycznie pokazuje", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    expect(
      await screen.findByText(
        t("adminAnalytics.gsc.insightsSubtitle", { site: SITE_A, days: 28 }),
      ),
    ).toBeInTheDocument();
  });
});

describe("GscBiDashboard - zero wierszy", () => {
  it("kalendarz nie dostaje pustego zakresu, tylko wykres bez serii", async () => {
    respondWith(EMPTY);
    panel();
    await loaded();

    // `range: [undefined, undefined]` wywrocilby kalendarz ECharts. Panel
    // zwraca wtedy `{ series: [] }` - i to jest kontrakt, nie przypadek.
    await waitFor(() => {
      const empty = lastOption(
        "pusty kalendarz",
        (o) => seriesOf(o).length === 0 && Object.keys(o).length === 1,
      );
      expect(empty).toEqual({ series: [] });
    });
  });

  it("przy zerze wierszy nie zmysla wycinkow donuta ani wezlow treemapy", async () => {
    const t = realT("pl");
    respondWith(EMPTY);
    panel();
    await loaded();

    await waitFor(() => {
      expect(seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))[0].data).toEqual(
        [],
      );
    });
    expect(seriesOf(treemapOption())[0].data).toEqual([]);
    expect(strList(rec(trendOption().xAxis).data)).toEqual([]);
  });

  it.fails(
    "DEFEKT: przy zerze wierszy panel nie mowi „brak danych w oknie”, tylko rysuje zera",
    async () => {
      // Komunikat JEST w slowniku i JEST uzywany przez dwa sasiednie pulpity
      // tego samego modulu (`AudienceSegmentsDashboard`, `RelatedPostsAnalytics`).
      // Tutaj wlasciwosc bez ani jednego wyswietlenia wyglada identycznie jak
      // wlasciwosc, ktorej dane nie dojechaly.
      respondWith(EMPTY);
      panel();
      await loaded();

      expect(
        screen.getByText(realT("pl")("adminAnalytics.common.noDataWindow")),
      ).toBeInTheDocument();
    },
  );
});

describe("GscBiDashboard - blad zapytania", () => {
  it("po awarii Search Analytics panel nie jest pusty - narzedzia steruja dalej", async () => {
    const t = realT("pl");
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    panel();

    // Minimum, ktore panel dowozi: operator wciaz moze zmienic okno i ponowic.
    expect(
      await screen.findByRole("button", { name: t("adminAnalytics.common.refresh") }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.gsc.window"))).toBeInTheDocument();
  });

  it.fails("DEFEKT: awaria zapytania nie wystawia zadnego komunikatu bledu", async () => {
    // Blizniaczy pulpit GA4 z tego samego modulu renderuje w tej sytuacji karte
    // `adminAnalytics.ga4.apiError`. GSC polyka wyjatek: zapytania sa w stanie
    // `error`, a panel rysuje pelna siatke zer - operator widzi „brak ruchu"
    // tam, gdzie w rzeczywistosci padla bramka.
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    const { container } = panel();
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));

    await waitFor(() => {
      expect(container.textContent ?? "").toMatch(/503|b[łl][ąa]d|error/i);
    });
  });

  it.fails("DEFEKT: przy padnietym zapytaniu KPI pokazuje 0 zamiast braku pomiaru", async () => {
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    panel();
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));

    expect(kpiValue(realT("pl")("adminAnalytics.gsc.clicks"))).not.toBe("0");
  });
});

describe("GscBiDashboard - wejscie zapytania", () => {
  it("startowe okno to 28 dni, a poprzednie okno przylega do niego i ma te sama dlugosc", async () => {
    panel();
    await loaded();

    const inputs = analyticsInputs();
    const current = inputs.filter((i) => i.endDate === todayISO());
    const previous = inputs.filter((i) => i.endDate !== todayISO());
    expect(current).toHaveLength(5);
    expect(previous).toHaveLength(1);
    for (const i of current) expect(spanDays(i.startDate, i.endDate)).toBe(28);
    // Porownanie „vs poprzedni okres" ma sens tylko wtedy, gdy okna sa rowne
    // i stykaja sie bez luki - inaczej delta w KPI mierzy dwa rozne odcinki.
    expect(spanDays(previous[0].startDate, previous[0].endDate)).toBe(28);
    expect(previous[0].endDate).toBe(current[0].startDate);
  });

  it("kazdy wymiar jedzie osobnym zapytaniem, a serie dzienna ma wyzszy limit wierszy", async () => {
    panel();
    await loaded();

    const inputs = analyticsInputs();
    expect(inputs.map((i) => i.dimensions)).toEqual([
      ["date"],
      ["query"],
      ["page"],
      ["country"],
      ["device"],
      ["date"],
    ]);
    // 400 dla dni (90-dniowe okno + zapas), 200 dla wymiarow rankingowych.
    expect(inputs.filter((i) => i.dimensions[0] === "date").map((i) => i.rowLimit)).toEqual([
      400, 400,
    ]);
    expect(inputs.filter((i) => i.dimensions[0] !== "date").map((i) => i.rowLimit)).toEqual([
      200, 200, 200, 200,
    ]);
  });

  it("zmiana okna na 7 dni przestawia WEJSCIE zapytania, nie tylko etykiete", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const before = h.queryAnalytics.mock.calls.length;

    const listbox = openSelect(comboboxWithText(t("adminAnalytics.timeRange.preset28d")));
    fireEvent.click(
      within(listbox).getByRole("option", { name: t("adminAnalytics.timeRange.preset7d") }),
    );

    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => {
      const after = analyticsInputs().slice(before);
      const current = after.filter((i) => i.endDate === todayISO());
      expect(current.length).toBeGreaterThan(0);
      for (const i of current) expect(spanDays(i.startDate, i.endDate)).toBe(7);
    });
    const previous = analyticsInputs()
      .slice(before)
      .filter((i) => i.endDate !== todayISO());
    expect(previous.every((i) => spanDays(i.startDate, i.endDate) === 7)).toBe(true);
  });

  it("„Odswiez” ponawia wszystkie szesc zapytan, nie tylko serie dzienna", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const before = h.queryAnalytics.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.common.refresh") }));

    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBe(before + 6));
    // Ponowienie musi objac KAZDY wymiar - inaczej po odswiezeniu czesc kart
    // pokazuje dane z poprzedniego stanu obok danych swiezych.
    const after = analyticsInputs().slice(before);
    expect(new Set(after.map((i) => i.dimensions[0]))).toEqual(
      new Set(["date", "query", "page", "country", "device"]),
    );
  });
});

describe("GscBiDashboard - wybor wlasciwosci", () => {
  it("bez wskazania operatora panel wybiera wlasciwosc glowna, nie pierwsza z brzegu", async () => {
    h.listSites.mockResolvedValue({
      sites: [site(SITE_A), site(SITE_NES), site(SITE_B)],
      configured: true,
    });
    panel();
    await loaded();

    expect(analyticsInputs().every((i) => i.siteUrl === SITE_NES)).toBe(true);
  });

  it("wybor innej wlasciwosci przestawia argument zapytania", async () => {
    h.listSites.mockResolvedValue({ sites: [site(SITE_A), site(SITE_B)], configured: true });
    panel();
    await loaded();
    const before = h.queryAnalytics.mock.calls.length;

    const listbox = openSelect(comboboxWithText(SITE_A));
    fireEvent.click(within(listbox).getByRole("option", { name: SITE_B }));

    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThan(before));
    expect(analyticsInputs().slice(before).every((i) => i.siteUrl === SITE_B)).toBe(true);
  });

  it("bez ani jednej wlasciwosci panel nie strzela zapytaniem z pustym adresem", async () => {
    h.listSites.mockResolvedValue({ sites: [], configured: true });
    panel();

    await waitFor(() => expect(h.listSites).toHaveBeenCalled());
    // `enabled: Boolean(effectiveSite)` ma trzymac zapytanie, a nie wysylac
    // `siteUrl: ""` - walidator server fn odrzucilby to bledem 400 na kazdym
    // wejsciu na zakladke.
    await waitFor(() => expect(h.queryAnalytics).not.toHaveBeenCalled());
    expect(
      screen.getByText(realT("pl")("adminAnalytics.gsc.selectProperty")),
    ).toBeInTheDocument();
  });
});

describe("GscBiDashboard - izolacja warsztatow", () => {
  it("wybor wlasciwosci pokazuje wylacznie wlasciwosci zwrocone dla biezacego warsztatu", async () => {
    h.listSites.mockResolvedValue({ sites: [site(SITE_A)], configured: true });
    const { container } = panel();
    await loaded();

    const listbox = openSelect(comboboxWithText(SITE_A));
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([SITE_A]);
    expect(container.textContent ?? "").not.toContain("beta.example.org");
  });

  it("po przejsciu na inny warsztat panel nie pokazuje danych poprzedniego", async () => {
    // Wspoldzielony `QueryClient` to najostrzejszy przypadek: gdyby klucz cache
    // nie niosl wlasciwosci, panel warsztatu B odziedziczylby wiersze warsztatu A.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = panel(true, client);
    await loaded();
    expect(await screen.findByText("energia w cee")).toBeInTheDocument();
    first.unmount();

    h.listSites.mockResolvedValue({ sites: [site(SITE_B)], configured: true });
    respondWith({
      ...EMPTY,
      date: [row("2026-08-01", 4, 40, 0.1, 3)],
      query: [row("beta fraza wlasna", 4, 40, 0.1, 3)],
    });
    h.queryAnalytics.mockClear();
    const second = panel(true, client);

    expect(await screen.findByText("beta fraza wlasna")).toBeInTheDocument();
    // Zapytanie warsztatu A nie ma prawa zostac na ekranie warsztatu B.
    expect(within(second.container).queryByText("energia w cee")).toBeNull();
    expect(within(second.container).queryByText("raport nes")).toBeNull();
  });

  it.fails(
    "DEFEKT: klucz cache listy wlasciwosci nie niesie warsztatu, wiec panel B maluje wiersze warsztatu A",
    async () => {
      // `queryKey: ["gsc-sites"]` jest STALY - nie ma w nim ani tenanta, ani
      // uzytkownika. Przy kliencie react-query przezywajacym zmiane warsztatu
      // panel dostaje z cache liste wlasciwosci POPRZEDNIEGO warsztatu,
      // `preferredSite` wskazuje cudza wlasciwosc, a wpisy `["gsc-bi", <cudza
      // wlasciwosc>, ...]` sa jeszcze swieze (`staleTime: 60_000`) - wiec
      // PIERWSZA klatka panelu warsztatu B pokazuje zapytania warsztatu A.
      // Zadne zapytanie sieciowe przy tym nie leci, co czyni wyciek cichym:
      // widac go wylacznie na ekranie.
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const first = panel(true, client);
      await loaded();
      first.unmount();

      h.listSites.mockResolvedValue({ sites: [site(SITE_B)], configured: true });
      respondWith({ ...EMPTY, query: [row("beta fraza wlasna", 4, 40, 0.1, 3)] });
      const second = panel(true, client);

      expect(second.container.textContent ?? "").not.toContain("energia w cee");
    },
  );
});

describe("GscBiDashboard - dostepnosc", () => {
  it("wykresy z eksportem CSV maja tekstowa alternatywe z tymi samymi liczbami", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("table").length).toBeGreaterThan(0));
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);

    const trend = tables[0];
    expect(within(trend).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      t("adminAnalytics.gsc.csvHeaders.date"),
      t("adminAnalytics.gsc.csvHeaders.clicks"),
      t("adminAnalytics.gsc.csvHeaders.impressions"),
      t("adminAnalytics.gsc.csvHeaders.ctr"),
      t("adminAnalytics.gsc.csvHeaders.position"),
    ]);
    expect(within(trend).getByText("2026-08-02")).toBeInTheDocument();
    expect(within(tables[1]).getByText("energia w cee")).toBeInTheDocument();
  });

  it("region kazdego wykresu ma nazwe zbudowana z tytulu karty", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
    const names = screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", {
        title: t("adminAnalytics.gsc.charts.calendarTitle"),
      }),
    );
  });

  it.fails(
    "DEFEKT: piec z siedmiu wykresow panelu nie ma zadnej alternatywy tekstowej",
    async () => {
      // Karta UMIE zbudowac tabele danych - dostaje ja tylko trend i rank fraz.
      // Rozklad pozycji, kraje, urzadzenia, strony i kalendarz jada bez `csv`,
      // wiec dla czytnika ekranu sa pustym prostokatem z sama nazwa. Slownik ma
      // nawet gotowy komunikat na te sytuacje (`chartCard.dataTableMissing`),
      // ktorego nikt nie uzywa.
      panel();
      await loaded();

      await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
      const withoutText = screen
        .getAllByRole("img")
        .filter((el) => !el.getAttribute("aria-describedby"));
      expect(withoutText.map((el) => el.getAttribute("aria-label"))).toEqual([]);
    },
  );

  it("poza nienazwanymi przyciskami panel nie ma innych naruszen axe", async () => {
    const { container } = panel();
    await loaded();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));

    // Regule `button-name` wylaczamy TYLKO tutaj i tylko po to, zeby jeden znany
    // defekt (test nizej) nie przykrywal wszystkiego innego: kolejnosci
    // naglowkow, poprawnosci ARIA, semantyki list i tabel.
    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(summarize(violations)).toBe("");
  });

  it("karta niepodlaczonej integracji jest wolna od naruszen axe", async () => {
    const { container } = panel(false);

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it.fails("DEFEKT: dziewiec przyciskow panelu nie ma dostepnej nazwy", async () => {
    // Dwa pola wyboru w pasku narzedzi (wlasciwosc, okno) maja widoczna
    // etykiete `<label>`, ale bez `htmlFor` - czyli dla czytnika ekranu sa
    // bezimienne. Do tego siedem przyciskow „wiecej" na kartach wykresow to
    // sama ikona `MoreHorizontal` bez `aria-label`, choc przycisk pelnego
    // ekranu obok - w tym samym pliku `ChartCard.tsx` - nazwe ma.
    const { container } = panel();
    await loaded();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));

    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("GscBiDashboard - dwujezycznosc", () => {
  it("wszystkie siedem kart wykresow nazywa sie ze slownika PL", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
    expect(chartRegionNames()).toEqual(CHART_TITLE_KEYS.map((k) => regionName("pl", k)));
    expect(screen.getByText(t("adminAnalytics.gsc.property"))).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.gsc.window"))).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.gsc.avgPosition"))).toBeInTheDocument();
  });

  it("ten sam panel po EN mowi po angielsku, bez ani jednego polskiego tytulu", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const pl = realT("pl");
    const { container } = panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
    expect(chartRegionNames()).toEqual(CHART_TITLE_KEYS.map((k) => regionName("en", k)));
    for (const key of CHART_TITLE_KEYS) {
      // Brak klucza w EN oznaczalby cichy fallback na polski tytul - a to
      // wyglada jak dzialajacy panel, wiec nikt tego nie zglosi.
      expect(en(key)).not.toBe(pl(key));
      expect(container.textContent ?? "").not.toContain(pl(key));
    }
    expect(
      screen.getByText(en("adminAnalytics.gsc.insightsSubtitle", { site: SITE_A, days: 28 })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en("adminAnalytics.common.refresh") }),
    ).toBeInTheDocument();
  });

  it("naglowki tabeli danych tez sa dwujezyczne", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("table").length).toBe(2));
    expect(
      within(screen.getAllByRole("table")[1])
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      en("adminAnalytics.gsc.csvHeaders.query"),
      en("adminAnalytics.gsc.csvHeaders.clicks"),
      en("adminAnalytics.gsc.csvHeaders.impressions"),
      en("adminAnalytics.gsc.csvHeaders.ctr"),
      en("adminAnalytics.gsc.csvHeaders.position"),
    ]);
  });
});
