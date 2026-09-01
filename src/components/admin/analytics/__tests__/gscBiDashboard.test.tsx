// `GscBiDashboard` - pulpit Search Console: kolejność danych, stany i okablowanie.
//
// PO CO. Ten plik stał na zerze (0/163 linii, 0/66 funkcji) - największy zer w
// module analityki. Czysta arytmetyka wniosków została już wyciągnięta do
// `gscInsights.ts` i ma własny, pełny test; TUTAJ przedmiotem dowodu jest to,
// czego tamten plik nie widzi, a co decyduje o tym, czy operator patrzy na
// POMIAR, czy na atrapę pomiaru:
//
//   1. KOLEJNOŚĆ I AGREGACJA. Search Console oddaje wiersze bez gwarancji
//      porządku. Panel sam sortuje serię czasową, przycina rank do 15 fraz,
//      zwija kraje do ośmiu plus „Inne" i skraca ścieżki w treemapie. Każda z
//      tych operacji jest cicha: źle posortowany trend to wykres, który
//      wygląda poprawnie i kłamie o kierunku ruchu.
//   2. ROZRÓŻNIENIE STANÓW. „Search Console niepodłączony", „ładowanie",
//      „zero wierszy" i „zapytanie padło" to CZTERY różne komunikaty dla
//      operatora, a wszystkie cztery da się pomylić z jednym: zerami w
//      kafelkach KPI. Klucz `configured: false` istnieje wyłącznie po to, żeby
//      tego rozróżnienia pilnować.
//   3. OKABLOWANIE FILTRA. Zmiana okna ma zmienić WEJŚCIE zapytania, nie samo
//      renderowanie - dlatego asercje idą na argument funkcji serwerowej.
//   4. IZOLACJA WARSZTATU. Panel czyta dane właściwości przypiętej do
//      bieżącego warsztatu; właściwość innego warsztatu nie ma prawa pojawić
//      się ani w wyborze, ani w argumencie zapytania.
//   5. ALTERNATYWA TEKSTOWA. ECharts maluje do kanwy, która dla czytnika
//      ekranu jest pustym prostokątem. Karta ma mechanizm tabeli danych - test
//      sprawdza, ILE wykresów panelu faktycznie go dostaje.
//
// ECHARTS JEST TU ZAKAZANY (patrz nagłówek `EChart.tsx`): podmieniamy `EChart`
// atrapą, która PRZECHWYTUJE `option`. Dzięki temu asercje o kolejności i
// agregacji idą na strukturę danych oddaną wykresowi, a nie na piksele.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GscRow, GscSite } from "@/lib/analytics/gsc.functions";
import type { ChartClickParams } from "../ChartDrillDialog";

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
  charts: [] as Array<{
    option: Record<string, unknown>;
    onDataClick?: (params: unknown) => void;
  }>,
}));

// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy.
// Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywracałaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/gsc.functions", () => ({
  listGscSites: (...args: unknown[]) => h.listSites(...args),
  queryGscAnalytics: (...args: unknown[]) => h.queryAnalytics(...args),
}));

// Atrapa wykresu zapisuje `option`. To jedyne miejsce, w którym widać, CO panel
// policzył - i jedyny sposób na dowiedzenie kolejności bez wciągania echarts do
// procesu testowego.
vi.mock("../EChart", () => ({
  EChart: ({
    option,
    onDataClick,
  }: {
    option: Record<string, unknown>;
    onDataClick?: (params: unknown) => void;
  }) => {
    h.charts.push({ option, onDataClick });
    return <div data-testid="echart" />;
  },
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujęzyczny, a przedmiotem
// dowodu jest to, że napisy przychodzą ZE SŁOWNIKA. Język przestawia się przez
// `i18n.changeLanguage`. Skrót `vi.mock("react-i18next", () => reactI18nextMock())`
// zakleszcza test - fabryka sięgnęłaby po `@/lib/i18n`, który importuje właśnie
// atrapowany moduł (patrz nagłówek `src/test/i18nReal.ts`).
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

/** Wiersz BEZ klucza wymiaru - Search Console oddaje takie przy agregatach. */
function keylessRow(clicks: number, impressions: number, ctr: number, position: number): GscRow {
  return { keys: [], clicks, impressions, ctr, position };
}

/** Serie dzienne CELOWO w złej kolejności - GSC nie obiecuje porządku. */
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
  row(
    "https://alfa.example.com/analizy/bardzo-dluga-sciezka-o-energii-w-regionie",
    40,
    900,
    0.044,
    6,
  ),
  row("https://alfa.example.com/o-nas", 12, 300, 0.04, 9),
];
/** Kraje już posortowane malejąco - tak jak oddaje je API. */
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
 * Odpowiada wierszami według wymiaru. Zapytanie o POPRZEDNIE okno rozpoznajemy
 * po tym, że jego `endDate` nie jest dzisiejszą datą - to jedyne, co je odróżnia
 * od zapytania o serię dzienną bieżącego okna.
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
// Narzędzia
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

interface Captured {
  option: Opt;
  onDataClick?: (params: unknown) => void;
}

/** OSTATNI przechwycony wykres pasujący do predykatu - czyli stan po ostatnim renderze. */
function lastChart(label: string, pred: (o: Opt) => boolean): Captured {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    if (pred(h.charts[i].option)) return h.charts[i];
  }
  throw new Error(`test: nie przechwycono wykresu „${label}"`);
}

function lastOption(label: string, pred: (o: Opt) => boolean): Opt {
  return lastChart(label, pred).option;
}

/** Ostatnie `n` przechwyconych opcji pasujących do predykatu, w kolejności renderu. */
function lastOptions(label: string, pred: (o: Opt) => boolean, n: number): Opt[] {
  const hits = h.charts.filter((c) => pred(c.option)).map((c) => c.option);
  if (hits.length < n) throw new Error(`test: przechwycono za malo opcji „${label}"`);
  return hits.slice(hits.length - n);
}

/** Formater podpowiedzi, który panel oddaje wykresowi. */
function tooltipFormatter(o: Opt): (raw: unknown) => string {
  const f = rec(o.tooltip).formatter;
  if (typeof f !== "function") throw new Error("test: wykres nie ma formatera podpowiedzi");
  return f as (raw: unknown) => string;
}

/** Symuluje kliknięcie w element wykresu - dokładnie tak, jak robi to ECharts. */
async function clickChart(chart: Captured, params: ChartClickParams): Promise<void> {
  await act(async () => {
    chart.onDataClick?.(params);
  });
}

const isTrend = (o: Opt) => seriesOf(o).length === 3 && "dataZoom" in o;
const isTopQueries = (o: Opt) => !Array.isArray(o.yAxis) && rec(o.yAxis).type === "category";
const isPosition = (o: Opt) => Array.isArray(o.yAxis) && seriesOf(o)[0]?.type === "bar";
const isDonut = (name: string) => (o: Opt) =>
  seriesOf(o)[0]?.type === "pie" && seriesOf(o)[0]?.name === name;
const isTreemap = (o: Opt) => seriesOf(o)[0]?.type === "treemap";
const isCalendar = (o: Opt) => "calendar" in o;

const trendOption = () => lastOption("trend", isTrend);
const topQueriesOption = () => lastOption("top zapytan", isTopQueries);
const positionOption = () => lastOption("rozklad pozycji", isPosition);
const donutOption = (name: string) => lastOption(`donut ${name}`, isDonut(name));
const treemapOption = () => lastOption("treemap", isTreemap);
const calendarOption = () => lastOption("kalendarz", isCalendar);

function analyticsInputs(): AnalyticsInput[] {
  return h.queryAnalytics.mock.calls.map((c) => (c[0] as { data: AnalyticsInput }).data);
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Tytuły kart w kolejności, w jakiej panel je układa. */
const CHART_TITLE_KEYS = [
  "adminAnalytics.gsc.charts.trendTitle",
  "adminAnalytics.gsc.charts.topQueriesTitle",
  "adminAnalytics.gsc.charts.positionTitle",
  "adminAnalytics.gsc.charts.countriesTitle",
  "adminAnalytics.gsc.charts.devicesTitle",
  "adminAnalytics.gsc.charts.pagesTitle",
  "adminAnalytics.gsc.charts.calendarTitle",
] as const;

/** Tłumacz przypięty do języka, który instancja i18next ma W TEJ CHWILI. */
function tNow() {
  return realT(i18n.language?.toLowerCase().startsWith("en") ? "en" : "pl");
}

function regionName(lang: "pl" | "en", titleKey: string): string {
  const t = realT(lang);
  return t("adminAnalytics.chartCard.chartRegion", { title: t(titleKey) });
}

/** Dostępne nazwy regionów wykresów - jedyne miejsce, w którym tytuł karty jest UNIKALNY. */
function chartRegionNames(): string[] {
  return screen.getAllByRole("img").map((el) => el.getAttribute("aria-label") ?? "");
}

/**
 * Wartość metryki w oknie drążenia, odczytana przy jej etykiecie.
 *
 * Szukamy WEWNĄTRZ siatki metryk, nie w całym oknie: podtytuł okna bywa nazwą
 * serii („Kliknięcia"), więc ta sama etykieta stoi w dwóch miejscach.
 */
function metricValue(label: string): string {
  const d = screen.getByRole("dialog");
  const head = within(d).getByText(tNow()("adminAnalytics.drillDialog.metrics"));
  const grid = head.nextElementSibling;
  if (!grid) throw new Error("test: okno drazenia nie ma siatki metryk");
  return within(grid as HTMLElement).getByText(label).nextElementSibling?.textContent ?? "";
}

/** Wartość kafelka KPI stojąca przy podanej etykiecie. */
function kpiValue(label: string): string {
  const box = screen.getByText(label).closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI „${label}"`);
  return box.lastElementChild?.textContent ?? "";
}

function panel(configured = true, client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <GscBiDashboard configured={configured} />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Czeka aż wszystkie sześć zapytań panelu odpowie i znikną wskaźniki ładowania. */
async function loaded(): Promise<void> {
  await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));
  await waitFor(() => {
    expect(screen.queryByText(realT("pl")("adminAnalytics.common.loadingData"))).toBeNull();
    expect(screen.queryByText(realT("en")("adminAnalytics.common.loadingData"))).toBeNull();
  });
}

/** Otwiera listę Radiksa klawiaturą - pointer events nie działają w happy-dom. */
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
  h.charts.length = 0;
  h.listSites.mockReset();
  h.queryAnalytics.mockReset();
  h.listSites.mockResolvedValue({ sites: [site(SITE_A)], configured: true });
  respondWith(FULL);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("GscBiDashboard - Search Console niepodłączony", () => {
  it("mówi, że integracji nie ma, zamiast pokazywać zera jako pomiar", () => {
    const t = realT("pl");
    const { container } = panel(false);

    // Cały panel to JEDEN komunikat - żadnego kafelka, żadnego wykresu.
    expect(container.textContent).toBe(
      t("adminAnalytics.gsc.notConfiguredPre") +
        t("adminAnalytics.gsc.notConfiguredTab") +
        t("adminAnalytics.gsc.notConfiguredPost"),
    );
    expect(screen.queryByText(t("adminAnalytics.gsc.clicks"))).toBeNull();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it("nie odpytuje ani listy właściwości, ani Search Analytics", async () => {
    panel(false);

    // `enabled: configured` ma wstrzymać ODCZYT, nie tylko ukryć wynik -
    // inaczej niepodłączony tenant generuje ruch do bramki przy każdym wejściu.
    await waitFor(() => expect(h.listSites).not.toHaveBeenCalled());
    expect(h.queryAnalytics).not.toHaveBeenCalled();
  });

  it("komunikat o braku integracji ma treść w EN, nie polską awaryjną", async () => {
    await i18n.changeLanguage("en");
    const t = realT("en");
    const { container } = panel(false);

    expect(container.textContent).toBe(
      t("adminAnalytics.gsc.notConfiguredPre") +
        t("adminAnalytics.gsc.notConfiguredTab") +
        t("adminAnalytics.gsc.notConfiguredPost"),
    );
    expect(container.textContent).toContain("Search Console");
    expect(container.textContent).not.toContain(realT("pl")("adminAnalytics.gsc.notConfiguredTab"));
  });
});

describe("GscBiDashboard - ładowanie", () => {
  it("w trakcie pobierania pokazuje wskaźnik ładowania ze słownika", async () => {
    h.queryAnalytics.mockImplementation(() => new Promise<{ rows: GscRow[] }>(() => {}));
    panel();

    expect(
      await screen.findByText(realT("pl")("adminAnalytics.common.loadingData")),
    ).toBeInTheDocument();
  });

  it.fails(
    "DEFEKT: w trakcie pobierania kafelki KPI pokazują zera, jakby to był pomiar",
    async () => {
      // Zero i „jeszcze nie wiem" to dwie różne informacje. Panel renderuje
      // pełną siatkę KPI natychmiast, więc operator widzi „0 kliknięć" zanim
      // dane w ogóle dojadą - i nie ma jak odróżnić tego od właściwości, która
      // faktycznie nie ma ruchu. Sąsiedni pulpity modułu (`AudienceSegments`,
      // `RelatedPostsAnalytics`) w takiej sytuacji renderują komunikat.
      h.queryAnalytics.mockImplementation(() => new Promise<{ rows: GscRow[] }>(() => {}));
      panel();
      await screen.findByText(realT("pl")("adminAnalytics.common.loadingData"));

      expect(kpiValue(realT("pl")("adminAnalytics.gsc.clicks"))).not.toBe("0");
    },
  );
});

describe("GscBiDashboard - dane", () => {
  it("kafelki KPI liczą sumy okna, a pozycję waży wyświetleniami", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    // 10+20+30 kliknięć, 200+250+300 wyświetleń, CTR = 60/750,
    // pozycja = (12*200 + 10*250 + 8*300) / 750 = 9,73.
    await waitFor(() => expect(kpiValue(t("adminAnalytics.gsc.clicks"))).toBe("60"));
    expect(kpiValue(t("adminAnalytics.gsc.impressions"))).toBe("750");
    expect(kpiValue("CTR")).toBe("8.00%");
    expect(kpiValue(t("adminAnalytics.gsc.avgPosition"))).toBe("9.7");
  });

  it("trend porządkuje serie chronologicznie mimo wierszy w złej kolejności", async () => {
    panel();
    await loaded();

    await waitFor(() => {
      const o = trendOption();
      expect(strList(rec(o.xAxis).data)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    });
    const o = trendOption();
    const s = seriesOf(o);
    // Kliknięcia, wyświetlenia i CTR muszą jechać PO TEJ SAMEJ osi czasu -
    // rozjazd choć jednej serii to wykres, który wygląda poprawnie i kłamie.
    expect(numList(s[0].data)).toEqual([10, 20, 30]);
    expect(numList(s[1].data)).toEqual([200, 250, 300]);
    expect(numList(s[2].data)).toEqual([5, 8, 10]);
  });

  it("iskry przy KPI jadą tym samym porządkiem co trend", async () => {
    panel();
    await loaded();

    // Iskry liczą się POZA `useMemo`, każda własnym sortem - to osobna okazja,
    // żeby wykres kierunkowy przy kafelku pokazał coś innego niż duży trend.
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

  it("rank zapytań idzie rosnąco ku górze wykresu poziomego", async () => {
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
    // Oś kategorii ECharts rośnie w górę, więc najmocniejsza fraza musi być
    // OSTATNIA - odwrotna kolejność dałaby rank do góry nogami.
    expect(numList(seriesOf(topQueriesOption())[0].data)).toEqual([1, 5, 20, 30, 50]);
  });

  it("rank przycina się do 15 fraz i zostawia te najmocniejsze", async () => {
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
    // Trzy najsłabsze frazy wypadają - gdyby przycinał przed sortowaniem,
    // wypadłyby przypadkowe.
    expect(strList(rec(topQueriesOption().yAxis).data)).not.toContain("fraza 03");
  });

  it("histogram pozycji sumuje wyświetlenia do przedziałów SERP", async () => {
    panel();
    await loaded();

    await waitFor(() => {
      const o = positionOption();
      expect(strList(rec(o.xAxis).data)).toEqual(["1-3", "4-10", "11-20", "21-50", "51+"]);
    });
    const s = seriesOf(positionOption());
    // pozycje 2,4 / 7,2 / 15,5 / 33 / 78 - po jednej frazie na przedział.
    expect(numList(s[0].data)).toEqual([500, 600, 900, 400, 100]);
    expect(numList(s[1].data)).toEqual([50, 30, 20, 5, 1]);
  });

  it("donut krajów pokazuje osiem największych, a resztę zwija w „Inne”", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => {
      const data = donutOption(t("adminAnalytics.gsc.charts.countriesTitle")).series;
      expect(Array.isArray(data)).toBe(true);
    });
    const slices = (seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))[0].data ??
      []) as Array<{ name: string; value: number }>;
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
    // „Inne" to dokładnie to, czego donut NIE pokazał: svk 20 + hun 10.
    expect(slices[8]).toEqual({ name: t("adminAnalytics.gsc.other"), value: 30 });
  });

  it("donut urządzeń nie dokleja „Innych”, gdy wymiar ma mniej niż dziewięć wartości", async () => {
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
    "DEFEKT: „Inne” w donucie liczy się z ogona WEJŚCIA, nie z reszty poza pierwszą ósemką",
    async () => {
      // `top` bierze osiem największych PO własnym sortowaniu, ale `otherClicks`
      // sumuje `rows.slice(8)` - ogon KOLEJNOŚCI WEJŚCIOWEJ. Gdy API odda
      // wiersze inaczej niż malejąco, te dwa zbiory zachodzą na siebie: kraje
      // pokazane jako osobne wycinki wchodzą JESZCZE RAZ do „Innych", a udziały
      // procentowe donuta przestają się sumować do całości.
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

  it("treemap obcina domenę ze ścieżki i skraca długie adresy", async () => {
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
      // Kafelek pokazuje ŚCIEŻKĘ, nie cały adres - domena w każdym kaflu to
      // szum, który zjada miejsce na nazwę strony.
      expect(nodes[0].fullPath).toBe("/analizy/bardzo-dluga-sciezka-o-energii-w-regionie");
      expect(nodes[0].name).toBe(
        "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie".slice(0, 30) + "…",
      );
      expect(nodes[0].rawUrl).toBe(PAGE_ROWS[0].keys[0]);
      // Sortowanie treemapy idzie po WYŚWIETLENIACH, nie po kliknięciach.
      expect(nodes.map((n) => n.value)).toEqual([900, 300]);
    });
  });

  it("kalendarz dostaje pary dzień-kliknięcia i zakres od pierwszego do ostatniego dnia", async () => {
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
      // Skala koloru musi sięgać maksimum serii, inaczej najmocniejszy dzień
      // jest nieodróżnialny od średniego.
      expect(rec(o.visualMap).max).toBe(30);
    });
  });

  it("sekcja interpretacji dostaje okno i właściwość, które panel faktycznie pokazuje", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    expect(
      await screen.findByText(t("adminAnalytics.gsc.insightsSubtitle", { site: SITE_A, days: 28 })),
    ).toBeInTheDocument();
  });
});

describe("GscBiDashboard - podpowiedzi wykresów", () => {
  // Formater podpowiedzi to JEDYNE miejsce, w którym użytkownik widzi liczby
  // pojedynczego elementu wykresu. Jest funkcją oddaną ECharts, więc nie
  // renderuje się sam z siebie - bez tego bloku etykiety `clicksLabel`,
  // `impressionsLabel`, `ctrLabel` i `positionLabel` nie mają żadnego dowodu.
  it("podpowiedź rankingu fraz składa wszystkie cztery metryki ze słownika", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(strList(rec(topQueriesOption().yAxis).data)).toHaveLength(5));
    const html = tooltipFormatter(topQueriesOption())([
      { name: "energia w cee", value: 50, dataIndex: 4 },
    ]);
    expect(html).toContain("energia w cee");
    expect(html).toContain(`${t("adminAnalytics.gsc.clicksLabel")}<b>50</b>`);
    expect(html).toContain(`${t("adminAnalytics.gsc.impressionsLabel")}500`);
    expect(html).toContain(`${t("adminAnalytics.gsc.ctrLabel")}10.00%`);
    expect(html).toContain(`${t("adminAnalytics.gsc.positionLabel")}2.4`);
  });

  it("podpowiedź rankingu nie zmyśla wiersza dla indeksu spoza zbioru", async () => {
    panel();
    await loaded();

    await waitFor(() => expect(strList(rec(topQueriesOption().yAxis).data)).toHaveLength(5));
    // Pusty napis, a nie „undefined" w dymku - ECharts pokazuje zwrócony tekst
    // dosłownie.
    expect(tooltipFormatter(topQueriesOption())([{ name: "x", value: 0, dataIndex: 99 }])).toBe("");
  });

  it("podpowiedź donuta podaje udział procentowy obok wartości", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() =>
      expect(seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))).toHaveLength(1),
    );
    expect(
      tooltipFormatter(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))({
        name: "pol",
        value: 100,
        percent: 18.5,
      }),
    ).toBe("pol: <b>100</b> (18.5%)");
  });

  it("podpowiedź treemapy pokazuje wyświetlenia, kliknięcia i CTR strony", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(seriesOf(treemapOption())[0].data).toHaveLength(2));
    const html = tooltipFormatter(treemapOption())({
      name: "/o-nas",
      value: 300,
      data: { ctr: 0.04, clicks: 12 },
    });
    expect(html).toContain(`${t("adminAnalytics.gsc.impressionsLabel")}<b>300</b>`);
    expect(html).toContain(`${t("adminAnalytics.gsc.clicksLabel")}12`);
    expect(html).toContain(`${t("adminAnalytics.gsc.ctrLabel")}4.00%`);
  });

  it("podpowiedź kalendarza mówi, ile kliknięć przyniósł dany dzień", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(rec(calendarOption().calendar).range).toBeTruthy());
    expect(tooltipFormatter(calendarOption())({ value: ["2026-08-02", 20] })).toBe(
      `2026-08-02: <b>20</b> ${t("adminAnalytics.gsc.clicksShort")}`,
    );
  });
});

describe("GscBiDashboard - drążenie wykresów", () => {
  // Kliknięciem w element wykresu operator otwiera okno ze szczegółami. Cała
  // ta warstwa to funkcje oddane karcie, więc bez symulowanego kliknięcia
  // pozostaje martwa - a to ona decyduje, CZY kliknięcie w cokolwiek pokaże
  // liczby TEGO wiersza, czy sąsiedniego.
  it("kliknięcie w punkt trendu pokazuje metryki tego dnia", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(trendOption().xAxis).data)).toHaveLength(3));

    await clickChart(lastChart("trend", isTrend), {
      dataIndex: 1,
      seriesName: t("adminAnalytics.gsc.clicks"),
    });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.trendTitle"))).toBeInTheDocument();
    expect(within(d).getByText("2026-08-02")).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("20");
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("250");
    expect(metricValue("CTR")).toBe("8.00%");
    expect(metricValue(t("adminAnalytics.gsc.avgPosition"))).toBe("10.0");
  });

  it("kliknięcie w pusty obszar trendu nie otwiera okna bez treści", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(trendOption().xAxis).data)).toHaveLength(3));

    await clickChart(lastChart("trend", isTrend), { dataIndex: 99 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie w słupek rankingu otwiera tę frazę, którą widać na osi", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(topQueriesOption().yAxis).data)).toHaveLength(5));

    // Indeks 4 to góra osi kategorii, czyli fraza NAJMOCNIEJSZA - gdyby drążenie
    // pomijało `reverse()`, otworzyłoby frazę z drugiego końca rankingu.
    await clickChart(lastChart("top zapytan", isTopQueries), { dataIndex: 4 });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText("energia w cee")).toBeInTheDocument();
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.topQueriesTitle"))).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("50");
    expect(metricValue("CTR")).toBe("10.00%");
  });

  it("kliknięcie w przedział pozycji sumuje wszystkie frazy z tego przedziału", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(positionOption().xAxis).data)).toHaveLength(5));

    await clickChart(lastChart("rozklad pozycji", isPosition), { dataIndex: 1 });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText(`${t("adminAnalytics.gsc.avgPosition")}: 4-10`)).toBeInTheDocument();
    // Jedyna fraza w przedziale 4-10: 30 klik. z 600 wyświetleń.
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("30");
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("600");
    expect(metricValue("CTR")).toBe("5.00%");
  });

  it("kliknięcie w wycinek donuta otwiera kraj, a wycinek „Inne” nic nie otwiera", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() =>
      expect(seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))).toHaveLength(1),
    );
    const donut = lastChart("donut krajow", isDonut(t("adminAnalytics.gsc.charts.countriesTitle")));

    await clickChart(donut, { name: "deu" });
    const d = screen.getByRole("dialog");
    expect(within(d).getByText("deu")).toBeInTheDocument();
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.countriesTitle"))).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("90");

    // „Inne" to worek zbiorczy, nie kraj - nie ma czego pokazać i panel ma to
    // wiedzieć, zamiast otwierać okno o pustym wierszu.
    fireEvent.keyDown(d, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await clickChart(donut, { name: t("adminAnalytics.gsc.other") });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie w kafel treemapy daje ścieżkę, metryki i odnośnik do strony", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(seriesOf(treemapOption())[0].data).toHaveLength(2));
    const node = (seriesOf(treemapOption())[0].data as unknown[])[0];

    await clickChart(lastChart("treemap", isTreemap), { data: node });

    const d = screen.getByRole("dialog");
    const path = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
    expect(within(d).getAllByText(path).length).toBeGreaterThan(0);
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("900");
    expect(metricValue("CTR")).toBe("4.40%");
    // Odnośnik prowadzi do PEŁNEGO adresu, nie do skróconej etykiety.
    const link = within(d).getByRole("link", {
      name: t("adminAnalytics.drillDialog.openInNewTab"),
    });
    expect(link).toHaveAttribute("href", PAGE_ROWS[0].keys[0]);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("kliknięcie w kafel bez ścieżki nie otwiera okna", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(seriesOf(treemapOption())[0].data).toHaveLength(2));

    await clickChart(lastChart("treemap", isTreemap), { data: undefined });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie w dzień kalendarza pokazuje pełne metryki tego dnia", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(rec(calendarOption().calendar).range).toBeTruthy());

    await clickChart(lastChart("kalendarz", isCalendar), { value: ["2026-08-03", 30] });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.calendarTitle"))).toBeInTheDocument();
    expect(within(d).getByText("2026-08-03")).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("300");
  });

  it("dzień spoza serii pokazuje same kliknięcia, a nie wymyślone wyświetlenia", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(rec(calendarOption().calendar).range).toBeTruthy());

    // Kalendarz maluje całe tygodnie, więc da się kliknąć dzień, którego nie ma
    // w danych. Panel ma wtedy pokazać TYLKO to, co niesie sama komórka.
    await clickChart(lastChart("kalendarz", isCalendar), { value: ["2026-07-04", 7] });

    const d = screen.getByRole("dialog");
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("7");
    expect(within(d).queryByText(t("adminAnalytics.gsc.impressions"))).toBeNull();
  });

  it("kliknięcie w komórkę bez wartości nie otwiera okna", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(rec(calendarOption().calendar).range).toBeTruthy());

    await clickChart(lastChart("kalendarz", isCalendar), { value: undefined });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("GscBiDashboard - zero wierszy", () => {
  it("kalendarz nie dostaje pustego zakresu, tylko wykres bez serii", async () => {
    respondWith(EMPTY);
    panel();
    await loaded();

    // `range: [undefined, undefined]` wywróciłby kalendarz ECharts. Panel
    // zwraca wtedy `{ series: [] }` - i to jest kontrakt, nie przypadek.
    await waitFor(() => {
      const empty = lastOption(
        "pusty kalendarz",
        (o) => seriesOf(o).length === 0 && Object.keys(o).length === 1,
      );
      expect(empty).toEqual({ series: [] });
    });
  });

  it("przy zerze wierszy nie zmyśla wycinków donuta ani węzłów treemapy", async () => {
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
    "DEFEKT: przy zerze wierszy panel nie mówi „brak danych w oknie”, tylko rysuje zera",
    async () => {
      // Komunikat JEST w słowniku i JEST używany przez dwa sąsiednie pulpity
      // tego samego modułu (`AudienceSegmentsDashboard`, `RelatedPostsAnalytics`).
      // Tutaj właściwość bez ani jednego wyświetlenia wygląda identycznie jak
      // właściwość, której dane nie dojechały.
      respondWith(EMPTY);
      panel();
      await loaded();

      expect(
        screen.getByText(realT("pl")("adminAnalytics.common.noDataWindow")),
      ).toBeInTheDocument();
    },
  );
});

describe("GscBiDashboard - wiersze brzegowe", () => {
  it("wiersz bez klucza wymiaru nie wstawia „undefined” w żadnym miejscu panelu", async () => {
    const t = realT("pl");
    // Search Console potrafi oddać wiersz z pustą tablicą `keys` (agregat bez
    // wymiaru). Każde miejsce, w którym panel sięga po `keys[0]`, ma na to
    // własny zapasowy napis - i wszystkie muszą zadziałać naraz, bo jeden
    // przeciek renderuje „undefined" na kafelku, w tabeli i w eksporcie CSV.
    respondWith({
      date: [keylessRow(5, 50, 0.1, 4)],
      query: [keylessRow(5, 50, 0.1, 4)],
      page: [keylessRow(5, 50, 0.1, 4)],
      country: [keylessRow(5, 50, 0.1, 4)],
      device: [keylessRow(5, 50, 0.1, 4)],
      prev: [],
    });
    const { container } = panel();
    await loaded();

    await waitFor(() => expect(strList(rec(trendOption().xAxis).data)).toEqual([""]));
    expect(strList(rec(topQueriesOption().yAxis).data)).toEqual([""]);
    const slices = (seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))[0].data ??
      []) as Array<{ name: string }>;
    expect(slices.map((x) => x.name)).toEqual(["?"]);
    const nodes = (seriesOf(treemapOption())[0].data ?? []) as Array<{ name: string }>;
    expect(nodes.map((n) => n.name)).toEqual(["/"]);
    // Kalendarz bez daty nie może dostać `range: [undefined, undefined]`.
    expect(
      strList(rec(calendarOption().calendar).range).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ).toBe(true);
    expect(container.textContent ?? "").not.toContain("undefined");
  });

  it("wiersz bez klucza obok wierszy z kluczem nie psuje sortowania", async () => {
    const t = realT("pl");
    // Zbiór MIESZANY jest trudniejszy niż jednorodny: porównania w sortowaniu
    // biegną między wierszem z kluczem i bez, więc zapasowy napis musi zadziałać
    // po obu stronach porównania - inaczej `localeCompare` dostaje `undefined`
    // i seria ustawia się losowo.
    respondWith({
      date: [keylessRow(5, 50, 0.1, 4), row("2026-08-01", 10, 200, 0.05, 12)],
      query: [keylessRow(7, 70, 0.1, 4), row("fraza z kluczem", 3, 30, 0.1, 2)],
      page: [],
      country: [keylessRow(9, 90, 0.1, 4), row("pol", 4, 40, 0.1, 3)],
      device: [],
      prev: [],
    });
    panel();
    await loaded();

    await waitFor(() => expect(strList(rec(trendOption().xAxis).data)).toEqual(["", "2026-08-01"]));
    expect(numList(seriesOf(trendOption())[0].data)).toEqual([5, 10]);
    // Rank: mocniejszy jest wiersz bez klucza, więc po odwróceniu stoi na górze.
    expect(strList(rec(topQueriesOption().yAxis).data)).toEqual(["fraza z kluczem", ""]);
    const slices = (seriesOf(donutOption(t("adminAnalytics.gsc.charts.countriesTitle")))[0].data ??
      []) as Array<{ name: string; value: number }>;
    expect(slices.map((x) => x.name)).toEqual(["?", "pol"]);
    // Podpowiedź wywołana bez ładunku ma oddać tekst, a nie „undefined".
    expect(tooltipFormatter(topQueriesOption())([])).not.toContain("undefined");
  });

  it("drążenie wiersza bez klucza otwiera okno z metrykami, a nie z „undefined”", async () => {
    const t = realT("pl");
    respondWith({
      date: [keylessRow(5, 50, 0.1, 4), row("2026-08-01", 10, 200, 0.05, 12)],
      query: [keylessRow(7, 70, 0.1, 4), row("fraza z kluczem", 3, 30, 0.1, 2)],
      page: [],
      country: [keylessRow(9, 90, 0.1, 4), row("pol", 4, 40, 0.1, 3)],
      device: [],
      prev: [],
    });
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(trendOption().xAxis).data)).toEqual(["", "2026-08-01"]));

    // Trend: pierwszy punkt to wiersz bez daty.
    await clickChart(lastChart("trend", isTrend), { dataIndex: 0 });
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("5");
    const trendDialog = screen.getByRole("dialog");
    expect(trendDialog.textContent ?? "").not.toContain("undefined");
    fireEvent.keyDown(trendDialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Rank: górna pozycja osi to wiersz bez klucza.
    await clickChart(lastChart("top zapytan", isTopQueries), { dataIndex: 1 });
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("7");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Donut: wycinek „?" to nadal konkretny wiersz, więc ma się otworzyć.
    await clickChart(
      lastChart("donut krajow", isDonut(t("adminAnalytics.gsc.charts.countriesTitle"))),
      { name: "?" },
    );
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("9");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Kalendarz: komórka bez daty trafia w ten sam wiersz.
    await clickChart(lastChart("kalendarz", isCalendar), { value: ["", 5] });
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("50");
  });

  it("kliknięcie w trend bez indeksu danych nie otwiera okna", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(trendOption().xAxis).data)).toHaveLength(3));

    await clickChart(lastChart("trend", isTrend), { seriesName: "CTR" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pozycja spoza wszystkich przedziałów nie dokłada się do żadnego słupka", async () => {
    // Pozycja 0 nie istnieje w SERP - wpadnięcie takiego wiersza do przedziału
    // „1-3" zawyżyłoby najważniejszy słupek raportu.
    respondWith({
      ...EMPTY,
      date: DATE_ROWS,
      query: [row("pozycja zerowa", 7, 70, 0.1, 0), row("uczciwa fraza", 3, 30, 0.1, 2)],
    });
    panel();
    await loaded();

    await waitFor(() => expect(strList(rec(positionOption().xAxis).data)).toHaveLength(5));
    const s = seriesOf(positionOption());
    expect(numList(s[0].data)).toEqual([30, 0, 0, 0, 0]);
    expect(numList(s[1].data)).toEqual([3, 0, 0, 0, 0]);
  });

  it("pusty przedział pozycji pokazuje CTR 0,00%, a nie dzielenie przez zero", async () => {
    respondWith({
      ...EMPTY,
      date: DATE_ROWS,
      query: [row("uczciwa fraza", 3, 30, 0.1, 2)],
    });
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(positionOption().xAxis).data)).toHaveLength(5));

    await clickChart(lastChart("rozklad pozycji", isPosition), { dataIndex: 4 });

    expect(metricValue("CTR")).toBe("0.00%");
    expect(metricValue(realT("pl")("adminAnalytics.gsc.impressions"))).toBe("0");
  });

  it("kliknięcie bez indeksu danych nie otwiera okna na żadnym wykresie", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(strList(rec(topQueriesOption().yAxis).data)).toHaveLength(5));

    // ECharts wysyła zdarzenie także dla elementów bez danych (etykieta osi,
    // linia progu) - wtedy `dataIndex` nie jest liczbą.
    await clickChart(lastChart("top zapytan", isTopQueries), { name: "os" });
    expect(screen.queryByRole("dialog")).toBeNull();

    await clickChart(lastChart("rozklad pozycji", isPosition), { name: "os" });
    expect(screen.queryByRole("dialog")).toBeNull();

    await clickChart(
      lastChart("donut krajow", isDonut(realT("pl")("adminAnalytics.gsc.charts.countriesTitle"))),
      { dataIndex: 0 },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kafel treemapy bez metryk pokazuje zera, a odnośnik prowadzi do ścieżki", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(seriesOf(treemapOption())[0].data).toHaveLength(2));

    await clickChart(lastChart("treemap", isTreemap), { data: { fullPath: "/kontakt" } });

    const d = screen.getByRole("dialog");
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("0");
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("0");
    expect(metricValue("CTR")).toBe("0.00%");
    expect(metricValue(t("adminAnalytics.gsc.avgPosition"))).toBe("0.0");
    // Bez pełnego adresu odnośnik musi zostać przy ścieżce - nigdy `undefined`.
    expect(
      within(d).getByRole("link", { name: t("adminAnalytics.drillDialog.openInNewTab") }),
    ).toHaveAttribute("href", "/kontakt");
  });
});

describe("GscBiDashboard - błąd zapytania", () => {
  it("po awarii Search Analytics panel nie jest pusty - narzędzia sterują dalej", async () => {
    const t = realT("pl");
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    panel();

    // Minimum, które panel dowozi: operator wciąż może zmienić okno i ponowić.
    expect(
      await screen.findByRole("button", { name: t("adminAnalytics.common.refresh") }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.gsc.window"))).toBeInTheDocument();
  });

  it.fails("DEFEKT: awaria zapytania nie wystawia żadnego komunikatu błędu", async () => {
    // Bliźniaczy pulpit GA4 z tego samego modułu renderuje w tej sytuacji kartę
    // `adminAnalytics.ga4.apiError`. GSC połyka wyjątek: zapytania są w stanie
    // `error`, a panel rysuje pełną siatkę zer - operator widzi „brak ruchu"
    // tam, gdzie w rzeczywistości padła bramka.
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    const { container } = panel();
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));

    // Krótki limit: dowodzimy BRAKU komunikatu, więc nie ma na co czekać.
    await waitFor(
      () => {
        expect(container.textContent ?? "").toMatch(/503|b[łl][ąa]d|error/i);
      },
      { timeout: 400 },
    );
  });

  it.fails("DEFEKT: przy padniętym zapytaniu KPI pokazuje 0 zamiast braku pomiaru", async () => {
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    panel();
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));

    expect(kpiValue(realT("pl")("adminAnalytics.gsc.clicks"))).not.toBe("0");
  });
});

describe("GscBiDashboard - wejście zapytania", () => {
  it("startowe okno to 28 dni, a poprzednie okno przylega do niego i ma tę samą długość", async () => {
    panel();
    await loaded();

    const inputs = analyticsInputs();
    const current = inputs.filter((i) => i.endDate === todayISO());
    const previous = inputs.filter((i) => i.endDate !== todayISO());
    expect(current).toHaveLength(5);
    expect(previous).toHaveLength(1);
    for (const i of current) expect(spanDays(i.startDate, i.endDate)).toBe(28);
    // Porównanie „vs poprzedni okres" ma sens tylko wtedy, gdy okna są równe
    // i stykają się bez luki - inaczej delta w KPI mierzy dwa różne odcinki.
    expect(spanDays(previous[0].startDate, previous[0].endDate)).toBe(28);
    expect(previous[0].endDate).toBe(current[0].startDate);
  });

  it("każdy wymiar jedzie osobnym zapytaniem, a seria dzienna ma wyższy limit wierszy", async () => {
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
    // 400 dla dni (90-dniowe okno + zapas), 200 dla wymiarów rankingowych.
    expect(inputs.filter((i) => i.dimensions[0] === "date").map((i) => i.rowLimit)).toEqual([
      400, 400,
    ]);
    expect(inputs.filter((i) => i.dimensions[0] !== "date").map((i) => i.rowLimit)).toEqual([
      200, 200, 200, 200,
    ]);
  });

  it("zmiana okna na 7 dni przestawia WEJŚCIE zapytania, nie tylko etykietę", async () => {
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

  it("„Odśwież” ponawia wszystkie sześć zapytań, nie tylko serię dzienną", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const before = h.queryAnalytics.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.common.refresh") }));

    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBe(before + 6));
    // Ponowienie musi objąć KAŻDY wymiar - inaczej po odświeżeniu część kart
    // pokazuje dane z poprzedniego stanu obok danych świeżych.
    const after = analyticsInputs().slice(before);
    expect(new Set(after.map((i) => i.dimensions[0]))).toEqual(
      new Set(["date", "query", "page", "country", "device"]),
    );
  });
});

describe("GscBiDashboard - wybór właściwości", () => {
  it("bez wskazania operatora panel wybiera właściwość główną, nie pierwszą z brzegu", async () => {
    h.listSites.mockResolvedValue({
      sites: [site(SITE_A), site(SITE_NES), site(SITE_B)],
      configured: true,
    });
    panel();
    await loaded();

    expect(analyticsInputs().every((i) => i.siteUrl === SITE_NES)).toBe(true);
  });

  it("wybór innej właściwości przestawia argument zapytania", async () => {
    h.listSites.mockResolvedValue({ sites: [site(SITE_A), site(SITE_B)], configured: true });
    panel();
    await loaded();
    const before = h.queryAnalytics.mock.calls.length;

    const listbox = openSelect(comboboxWithText(SITE_A));
    fireEvent.click(within(listbox).getByRole("option", { name: SITE_B }));

    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThan(before));
    expect(
      analyticsInputs()
        .slice(before)
        .every((i) => i.siteUrl === SITE_B),
    ).toBe(true);
  });

  it("bez ani jednej właściwości panel nie strzela zapytaniem z pustym adresem", async () => {
    h.listSites.mockResolvedValue({ sites: [], configured: true });
    panel();

    await waitFor(() => expect(h.listSites).toHaveBeenCalled());
    // `enabled: Boolean(effectiveSite)` ma trzymać zapytanie, a nie wysyłać
    // `siteUrl: ""` - walidator server fn odrzuciłby to błędem 400 na każdym
    // wejściu na zakładkę.
    await waitFor(() => expect(h.queryAnalytics).not.toHaveBeenCalled());
    expect(screen.getByText(realT("pl")("adminAnalytics.gsc.selectProperty"))).toBeInTheDocument();
  });
});

describe("GscBiDashboard - izolacja warsztatów", () => {
  it("wybór właściwości pokazuje wyłącznie właściwości zwrócone dla bieżącego warsztatu", async () => {
    h.listSites.mockResolvedValue({ sites: [site(SITE_A)], configured: true });
    const { container } = panel();
    await loaded();

    const listbox = openSelect(comboboxWithText(SITE_A));
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([SITE_A]);
    expect(container.textContent ?? "").not.toContain("beta.example.org");
  });

  it("po przejściu na inny warsztat panel nie pokazuje danych poprzedniego", async () => {
    // Współdzielony `QueryClient` to najostrzejszy przypadek: gdyby klucz cache
    // nie niósł właściwości, panel warsztatu B odziedziczyłby wiersze warsztatu A.
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
    // Zapytanie warsztatu A nie ma prawa zostać na ekranie warsztatu B.
    expect(within(second.container).queryByText("energia w cee")).toBeNull();
    expect(within(second.container).queryByText("raport nes")).toBeNull();
  });

  it.fails(
    "DEFEKT: klucz cache listy właściwości nie niesie warsztatu, więc panel B maluje wiersze warsztatu A",
    async () => {
      // `queryKey: ["gsc-sites"]` jest STAŁY - nie ma w nim ani tenanta, ani
      // użytkownika. Przy kliencie react-query przeżywającym zmianę warsztatu
      // panel dostaje z cache listę właściwości POPRZEDNIEGO warsztatu,
      // `preferredSite` wskazuje cudzą właściwość, a wpisy `["gsc-bi", <cudza
      // właściwość>, ...]` są jeszcze świeże (`staleTime: 60_000`) - więc
      // PIERWSZA klatka panelu warsztatu B pokazuje zapytania warsztatu A.
      // Żadne zapytanie sieciowe przy tym nie leci, co czyni wyciek cichym:
      // widać go wyłącznie na ekranie.
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

describe("GscBiDashboard - dostępność", () => {
  it("wykresy z eksportem CSV mają tekstową alternatywę z tymi samymi liczbami", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("table").length).toBeGreaterThan(0));
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);

    const trend = tables[0];
    expect(
      within(trend)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      t("adminAnalytics.gsc.csvHeaders.date"),
      t("adminAnalytics.gsc.csvHeaders.clicks"),
      t("adminAnalytics.gsc.csvHeaders.impressions"),
      t("adminAnalytics.gsc.csvHeaders.ctr"),
      t("adminAnalytics.gsc.csvHeaders.position"),
    ]);
    expect(within(trend).getByText("2026-08-02")).toBeInTheDocument();
    expect(within(tables[1]).getByText("energia w cee")).toBeInTheDocument();
  });

  it("region każdego wykresu ma nazwę zbudowaną z tytułu karty", async () => {
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
    "DEFEKT: pięć z siedmiu wykresów panelu nie ma żadnej alternatywy tekstowej",
    async () => {
      // Karta UMIE zbudować tabelę danych - dostaje ją tylko trend i rank fraz.
      // Rozkład pozycji, kraje, urządzenia, strony i kalendarz jadą bez `csv`,
      // więc dla czytnika ekranu są pustym prostokątem z samą nazwą. Słownik ma
      // nawet gotowy komunikat na tę sytuację (`chartCard.dataTableMissing`),
      // którego nikt nie używa.
      panel();
      await loaded();

      await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
      const withoutText = screen
        .getAllByRole("img")
        .filter((el) => !el.getAttribute("aria-describedby"));
      expect(withoutText.map((el) => el.getAttribute("aria-label"))).toEqual([]);
    },
  );

  it("poza nienazwanymi przyciskami panel nie ma innych naruszeń axe", async () => {
    const { container } = panel();
    await loaded();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));

    // Regułę `button-name` wyłączamy TYLKO tutaj i tylko po to, żeby jeden znany
    // defekt (test niżej) nie przykrywał wszystkiego innego: kolejności
    // nagłówków, poprawności ARIA, semantyki list i tabel.
    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(summarize(violations)).toBe("");
  });

  it("karta niepodłączonej integracji jest wolna od naruszeń axe", async () => {
    const { container } = panel(false);

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it.fails("DEFEKT: dziewięć przycisków panelu nie ma dostępnej nazwy", async () => {
    // Dwa pola wyboru w pasku narzędzi (właściwość, okno) mają widoczną
    // etykietę `<label>`, ale bez `htmlFor` - czyli dla czytnika ekranu są
    // bezimienne. Do tego siedem przycisków „więcej" na kartach wykresów to
    // sama ikona `MoreHorizontal` bez `aria-label`, choć przycisk pełnego
    // ekranu obok - w tym samym pliku `ChartCard.tsx` - nazwę ma.
    const { container } = panel();
    await loaded();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));

    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("GscBiDashboard - dwujęzyczność", () => {
  it("wszystkie siedem kart wykresów nazywa się ze słownika PL", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
    expect(chartRegionNames()).toEqual(CHART_TITLE_KEYS.map((k) => regionName("pl", k)));
    expect(screen.getByText(t("adminAnalytics.gsc.property"))).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.gsc.window"))).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.gsc.avgPosition"))).toBeInTheDocument();
  });

  it("ten sam panel po EN mówi po angielsku, bez ani jednego polskiego tytułu", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const pl = realT("pl");
    const { container } = panel();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(7));
    expect(chartRegionNames()).toEqual(CHART_TITLE_KEYS.map((k) => regionName("en", k)));
    for (const key of CHART_TITLE_KEYS) {
      // Brak klucza w EN oznaczałby cichy fallback na polski tytuł - a to
      // wygląda jak działający panel, więc nikt tego nie zgłosi.
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

  it("nagłówki tabeli danych też są dwujęzyczne", async () => {
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
