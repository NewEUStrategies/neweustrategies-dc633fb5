// `Ga4BiDashboard` - pulpit GA4: rozróżnianie stanów, agregacja i okablowanie okna.
//
// PO CO. Plik stał na zerze (0/116 linii, 0/41 funkcji). Czysta arytmetyka
// wniosków mieszka w `ga4Insights.ts` i ma własny, pełny test - TUTAJ
// przedmiotem dowodu jest wszystko, czego tamten plik nie widzi, a co decyduje
// o tym, czy administrator patrzy na POMIAR, czy na atrapę pomiaru:
//
//   1. ROZRÓŻNIENIE STANÓW. „GA4 niepodłączone", „ładowanie", „zero ruchu"
//      i „Data API zwróciło błąd" to CZTERY różne informacje dla operatora,
//      a wszystkie cztery wyglądają identycznie, gdy panel narysuje siatkę zer.
//      Najgroźniejszy jest przypadek pośredni: prop `configured` bierze się ze
//      statusu liczonego z ENV, a raport niesie WŁASNE pole `configured` -
//      gdy token wygaśnie, `runGa4Report` oddaje pusty raport z
//      `configured: false` i BEZ pola `error`, więc panel maluje zera jako
//      zmierzony brak ruchu.
//   2. AGREGACJA I KOLEJNOŚĆ. Data API nie obiecuje porządku wierszy. Panel sam
//      sortuje serię czasową, zwija donuty do ośmiu (a urządzenia do pięciu)
//      wycinków plus „Inne", przycina rank stron do 15 i skraca ścieżki do 40
//      znaków. Każda z tych operacji jest cicha: źle posortowany trend to
//      wykres, który wygląda poprawnie i kłamie o kierunku ruchu.
//   3. KAFELKI CZYTAJĄ WŁAŚCIWY RAPORT. Nagłówek `engagementRate` występuje
//      w DWÓCH raportach naraz (dobowym i „engagement"), a `sessions` w
//      czterech. Dane w teście są tak dobrane, że pomylenie raportu zmienia
//      liczbę na kafelku - inaczej test przechodziłby przy każdym podpięciu.
//   4. OKNO. Nagłówek komponentu obiecuje okno kanoniczne: pełne dni UTC, bez
//      dnia otwartego, i okno poprzednie ROZŁĄCZNE z bieżącym. To była
//      naprawa realnego błędu (dzień graniczny wpadał do obu przedziałów,
//      więc każda delta % była zaniżona) - obietnica bez testu wraca.
//   5. IZOLACJA WARSZTATÓW. Właściwość GA4 rozwiązuje serwer z ustawień
//      bieżącego warsztatu; klient nie ma prawa jej podać, a dane jednego
//      warsztatu nie mają prawa pojawić się w panelu drugiego.
//   6. ALTERNATYWA TEKSTOWA. ECharts maluje do kanwy, która dla czytnika
//      ekranu jest pustym prostokątem - test liczy, ile wykresów panelu
//      faktycznie dostaje mechanizm tabeli danych, który `ChartCard` ma.
//
// ECHARTS JEST TU ZAKAZANY (patrz nagłówek `EChart.tsx`): podmieniamy `EChart`
// atrapą, która PRZECHWYTUJE `option` i znakuje swój węzeł indeksem. Dzięki
// temu asercje o agregacji idą na strukturę danych oddaną konkretnej karcie,
// a nie na piksele.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Ga4Report, Ga4Row } from "@/lib/analytics/ga4.functions";
import type { ChartClickParams } from "../ChartDrillDialog";

type Opt = Record<string, unknown>;
type Lang = "pl" | "en";

interface ReportInput {
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  limit: number;
}

const h = vi.hoisted(() => ({
  runReport: vi.fn(),
  charts: [] as Array<{ option: Record<string, unknown>; onDataClick?: (p: unknown) => void }>,
}));

// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy.
// Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywracałaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/ga4.functions", () => ({
  runGa4Report: (...args: unknown[]) => h.runReport(...args),
}));

// Atrapa wykresu zapisuje `option` i ZNAKUJE swój węzeł indeksem zapisu. Bez
// tego znacznika trzech donutów panelu nie da się od siebie odróżnić - mają
// identyczny kształt opcji, a różnią się wyłącznie kartą, na której stoją.
vi.mock("../EChart", () => ({
  EChart: ({
    option,
    onDataClick,
  }: {
    option: Record<string, unknown>;
    onDataClick?: (p: unknown) => void;
  }) => {
    const index = h.charts.length;
    h.charts.push({ option, onDataClick });
    return <div data-testid="echart" data-chart-index={index} />;
  },
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujęzyczny, a przedmiotem
// dowodu jest to, że napisy przychodzą ZE SŁOWNIKA. Język przestawia się przez
// `i18n.changeLanguage` (patrz nagłówek `src/test/i18nReal.ts`).
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { resolveWindow, previousWindow } from "@/lib/analytics/semantic";
import { Ga4BiDashboard } from "../Ga4BiDashboard";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

const CORE = ["sessions", "activeUsers", "screenPageViews", "engagementRate"];
const ENGAGE_METRICS = [
  "engagementRate",
  "averageSessionDuration",
  "screenPageViewsPerSession",
  "bounceRate",
  "eventCount",
];

/** Ścieżka dłuższa niż 40 znaków - dowód na skracanie etykiet osi rankingu. */
const LONG_PATH = "/analizy/energia-w-europie-srodkowej-raport-roczny-2026";

function report(
  metricHeaders: string[],
  opts: { totals?: Array<string | number>; rows?: Ga4Row[]; configured?: boolean } = {},
): Ga4Report {
  return {
    configured: opts.configured ?? true,
    dimensionHeaders: ["dim"],
    metricHeaders,
    rows: opts.rows ?? [],
    totals: (opts.totals ?? []).map(String),
  };
}

function row(dim: string, ...metrics: Array<string | number>): Ga4Row {
  return { dims: [dim], metrics: metrics.map(String) };
}

/** Seria dobowa CELOWO w złej kolejności - Data API nie obiecuje porządku. */
const DATE_ROWS: Ga4Row[] = [
  row("20260803", 30, 22, 90, 0.25),
  row("20260801", 10, 8, 30, 0.5),
  row("20260802", 20, 15, 60, 0.75),
];

/**
 * Suma na kafelku „Zaangażowanie" to 0,5 z raportu DOBOWEGO, a nie 0,9
 * z raportu „engagement" - oba niosą nagłówek `engagementRate`, więc rozjazd
 * raportów natychmiast widać na liczbie.
 */
const DATE_REPORT = report(CORE, { totals: [60, 45, 180, 0.5], rows: DATE_ROWS });
const PREV_REPORT = report(CORE, {
  totals: [50, 40, 150, 0.4],
  rows: [row("20260728", 25, 20, 70, 0.4), row("20260729", 25, 20, 80, 0.4)],
});

/** Dziesięć źródeł: osiem wycinków + „Inne" = 6 + 4. Suma sesji: 500. */
const SOURCE_ROWS: Ga4Row[] = [
  row("google", 150),
  row("(direct)", 100),
  row("linkedin.com", 80),
  row("x.com", 60),
  row("bing", 40),
  row("newsletter", 30),
  row("facebook.com", 20),
  row("reddit.com", 10),
  row("partner.example.org", 6),
  row("ads.example.com", 4),
];
const COUNTRY_ROWS: Ga4Row[] = [
  row("Poland", 200),
  row("Germany", 150),
  row("France", 100),
  row("Czechia", 50),
];
const DEVICE_ROWS: Ga4Row[] = [row("desktop", 300), row("mobile", 150), row("tablet", 50)];
const PAGE_ROWS: Ga4Row[] = [
  row("/o-nas", 40, 0.5),
  row(LONG_PATH, 120, 0.75),
  row("/kontakt", 10, 0.25),
];

interface Dataset {
  date: Ga4Report;
  prev: Ga4Report;
  source: Ga4Report;
  country: Ga4Report;
  device: Ga4Report;
  page: Ga4Report;
  engagement: Ga4Report;
}

const FULL: Dataset = {
  date: DATE_REPORT,
  prev: PREV_REPORT,
  source: report(["sessions"], { rows: SOURCE_ROWS }),
  country: report(["sessions"], { rows: COUNTRY_ROWS }),
  device: report(["sessions"], { rows: DEVICE_ROWS }),
  page: report(["screenPageViews", "engagementRate"], { rows: PAGE_ROWS }),
  engagement: report(ENGAGE_METRICS, { totals: [0.9, 150, 3, 0.25, 2500] }),
};

/** Właściwość podłączona, ale bez ANI JEDNEJ sesji w oknie. */
const ZERO_TRAFFIC: Dataset = {
  date: report(CORE, { totals: [0, 0, 0, 0] }),
  prev: report(CORE, { totals: [0, 0, 0, 0] }),
  source: report(["sessions"]),
  country: report(["sessions"]),
  device: report(["sessions"]),
  page: report(["screenPageViews", "engagementRate"]),
  engagement: report(ENGAGE_METRICS, { totals: [0, 0, 0, 0, 0] }),
};

/** Dokładnie to, co oddaje `runGa4Report`, gdy zabraknie property lub tokenu. */
const EMPTY_REPORT: Ga4Report = {
  configured: false,
  dimensionHeaders: [],
  metricHeaders: [],
  rows: [],
  totals: [],
};
const NOT_CONFIGURED_ON_SERVER: Dataset = {
  date: EMPTY_REPORT,
  prev: EMPTY_REPORT,
  source: EMPTY_REPORT,
  country: EMPTY_REPORT,
  device: EMPTY_REPORT,
  page: EMPTY_REPORT,
  engagement: EMPTY_REPORT,
};

/** Ostatni PEŁNY dzień UTC - jedyne, co odróżnia raport bieżący od poprzedniego. */
function yesterdayUtc(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function respondWith(ds: Dataset): void {
  h.runReport.mockImplementation(async (arg: { data: ReportInput }) => {
    const dim = arg.data.dimensions[0];
    if (dim === undefined) return ds.engagement;
    if (dim === "date") return arg.data.endDate === yesterdayUtc() ? ds.date : ds.prev;
    if (dim === "sessionSource") return ds.source;
    if (dim === "country") return ds.country;
    if (dim === "deviceCategory") return ds.device;
    if (dim === "pagePath") return ds.page;
    return EMPTY_REPORT;
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
function slices(o: Opt): Array<{ name: string; value: number }> {
  return (seriesOf(o)[0]?.data ?? []) as Array<{ name: string; value: number }>;
}

const CHART_TITLE_KEYS = [
  "adminAnalytics.ga4.charts.trendTitle",
  "adminAnalytics.ga4.charts.engagementTitle",
  "adminAnalytics.ga4.charts.sourcesTitle",
  "adminAnalytics.ga4.charts.countriesTitle",
  "adminAnalytics.ga4.charts.devicesTitle",
  "adminAnalytics.ga4.charts.topPagesTitle",
] as const;

function regionName(lang: Lang, titleKey: string): string {
  const t = realT(lang);
  return t("adminAnalytics.chartCard.chartRegion", { title: t(titleKey) });
}

interface Captured {
  option: Opt;
  onDataClick?: (p: unknown) => void;
}

/**
 * Wykres KARTY o podanym tytule. Idziemy przez region ARIA, bo to jedyne
 * miejsce, w którym tytuł karty spotyka się z instancją wykresu - trzy donuty
 * mają identyczny kształt opcji i inaczej byłyby nierozróżnialne.
 */
function chartOf(titleKey: string, lang: Lang = "pl"): Captured {
  const region = screen.getByRole("img", { name: regionName(lang, titleKey) });
  const node = region.querySelector("[data-chart-index]");
  if (!node) throw new Error(`test: karta „${titleKey}" nie wyrenderowała wykresu`);
  const captured = h.charts[Number(node.getAttribute("data-chart-index"))];
  if (!captured) throw new Error(`test: brak zapisu opcji dla „${titleKey}"`);
  return captured;
}

function optionOf(titleKey: string, lang: Lang = "pl"): Opt {
  return chartOf(titleKey, lang).option;
}

/** Formater podpowiedzi, który panel oddaje donutowi. */
function tooltipFormatter(o: Opt): (raw: unknown) => string {
  const f = rec(o.tooltip).formatter;
  if (typeof f !== "function") throw new Error("test: donut nie ma formatera podpowiedzi");
  return f as (raw: unknown) => string;
}

/** Symuluje kliknięcie w element wykresu - dokładnie tak, jak robi to ECharts. */
async function clickChart(chart: Captured, params: ChartClickParams): Promise<void> {
  await act(async () => {
    chart.onDataClick?.(params);
  });
}

/**
 * Wartość kafelka KPI stojąca przy etykiecie. Etykieta „Zaangażowanie" jest
 * w panelu NIEJEDNOZNACZNA (kafelek + tytuł karty radaru), więc zawężamy do
 * pudełka, które faktycznie niesie liczbę.
 */
function kpiValue(label: string): string {
  const boxes = screen
    .getAllByText(label)
    .map((el) => el.closest("div.min-w-0"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => el.querySelector(".tabular-nums") !== null);
  if (boxes.length !== 1) {
    throw new Error(`test: oczekiwano jednego kafelka KPI „${label}", jest ${boxes.length}`);
  }
  return boxes[0].querySelector(".tabular-nums")?.textContent ?? "";
}

/**
 * Treść plakietki zmiany przy kafelku KPI. Sama treść jest NIEJEDNOZNACZNA
 * w panelu (sesje i odsłony rosną tu o tyle samo), więc czytamy ją z sąsiada
 * konkretnego kafelka, a nie po tekście.
 */
function kpiDelta(label: string): string {
  const boxes = screen
    .getAllByText(label)
    .map((el) => el.closest("div.min-w-0"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => el.querySelector(".tabular-nums") !== null);
  if (boxes.length !== 1) {
    throw new Error(`test: oczekiwano jednego kafelka KPI „${label}", jest ${boxes.length}`);
  }
  return boxes[0].nextElementSibling?.textContent ?? "";
}

function reportInputs(): ReportInput[] {
  return h.runReport.mock.calls.map((c) => (c[0] as { data: ReportInput }).data);
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

function panel(
  opts: { configured?: boolean; activeMode?: string; client?: QueryClient } = {},
): ReturnType<typeof render> & { queryClient: QueryClient } {
  const queryClient =
    opts.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <Ga4BiDashboard configured={opts.configured ?? true} activeMode={opts.activeMode} />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Czeka, aż wszystkie siedem raportów odpowie i zniknie wskaźnik ładowania. */
async function loaded(): Promise<void> {
  await waitFor(() => expect(h.runReport.mock.calls.length).toBeGreaterThanOrEqual(7));
  await waitFor(() => {
    expect(screen.queryByText(realT("pl")("adminAnalytics.common.loading"))).toBeNull();
    expect(screen.queryByText(realT("en")("adminAnalytics.common.loading"))).toBeNull();
  });
  await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(6));
}

/** Otwiera listę Radiksa klawiaturą - zdarzenia wskaźnika nie działają w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.charts.length = 0;
  h.runReport.mockReset();
  respondWith(FULL);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("Ga4BiDashboard - GA4 niepodłączone", () => {
  it("mówi, że integracji nie ma, zamiast pokazywać zera jako pomiar", () => {
    const t = realT("pl");
    const { container } = panel({ configured: false });

    // Cały panel to JEDEN komunikat - żadnego kafelka, żadnego wykresu.
    expect(container.textContent).toBe(
      t("adminAnalytics.ga4.notConfiguredPre") +
        t("adminAnalytics.ga4.notConfiguredTab") +
        t("adminAnalytics.ga4.notConfiguredPost"),
    );
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("nie wysyła ANI JEDNEGO raportu do Data API", async () => {
    panel({ configured: false });

    // `enabled: configured` ma wstrzymać ODCZYT, nie tylko ukryć wynik -
    // inaczej niepodłączony warsztat generuje siedem wywołań bramki przy
    // każdym wejściu na zakładkę.
    await waitFor(() => expect(h.runReport).not.toHaveBeenCalled());
  });

  it("komunikat o braku integracji ma treść w EN, nie polską awaryjną", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const { container } = panel({ configured: false });

    expect(container.textContent).toBe(
      en("adminAnalytics.ga4.notConfiguredPre") +
        en("adminAnalytics.ga4.notConfiguredTab") +
        en("adminAnalytics.ga4.notConfiguredPost"),
    );
    expect(container.textContent).not.toContain(realT("pl")("adminAnalytics.ga4.notConfiguredPre"));
  });
});

describe("Ga4BiDashboard - ładowanie", () => {
  it("w trakcie pobierania pokazuje wskaźnik ładowania ze słownika", async () => {
    h.runReport.mockImplementation(() => new Promise<Ga4Report>(() => {}));
    panel();

    expect(
      await screen.findByText(realT("pl")("adminAnalytics.common.loading")),
    ).toBeInTheDocument();
  });

  it("po dojściu danych wskaźnik ładowania znika", async () => {
    panel();
    await loaded();

    expect(screen.queryByText(realT("pl")("adminAnalytics.common.loading"))).toBeNull();
  });

  it.fails(
    "DEFEKT: w trakcie pobierania kafelki KPI pokazują zera, jakby to był pomiar",
    async () => {
      // Zero i „jeszcze nie wiem" to dwie różne informacje. Panel renderuje pełną
      // siatkę KPI natychmiast, więc operator widzi „0 sesji", zanim dane w ogóle
      // dojadą - i nie ma jak odróżnić tego od właściwości bez ruchu. Sąsiednie
      // pulpity modułu w takiej sytuacji renderują komunikat.
      h.runReport.mockImplementation(() => new Promise<Ga4Report>(() => {}));
      panel();
      await screen.findByText(realT("pl")("adminAnalytics.common.loading"));

      expect(kpiValue(realT("pl")("adminAnalytics.ga4.sessions"))).not.toBe("0");
    },
  );
});

describe("Ga4BiDashboard - błąd Data API", () => {
  it("raport z polem `error` zastępuje CAŁY pulpit komunikatem o błędzie", async () => {
    const t = realT("pl");
    respondWith({
      ...FULL,
      source: { ...EMPTY_REPORT, error: "GA4 wyłączone przez administratora" },
    });
    const { container } = panel();

    expect(
      await screen.findByText(
        t("adminAnalytics.ga4.apiError", { error: "GA4 wyłączone przez administratora" }),
      ),
    ).toBeInTheDocument();
    // Komunikat ma WYPRZEĆ liczby: siatka zer obok błędu wygląda jak pomiar.
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
    expect(container.textContent).not.toContain(t("adminAnalytics.ga4.charts.trendTitle"));
  });

  it("komunikat o błędzie cytuje treść zwróconą przez bramkę, a nie własny tekst", async () => {
    respondWith({ ...FULL, date: { ...EMPTY_REPORT, error: "GA4 403: insufficient permissions" } });
    panel();

    expect(await screen.findByText(/GA4 403: insufficient permissions/)).toBeInTheDocument();
  });

  it("komunikat o błędzie ma treść w EN", async () => {
    await i18n.changeLanguage("en");
    respondWith({ ...FULL, date: { ...EMPTY_REPORT, error: "boom" } });
    panel();

    expect(
      await screen.findByText(realT("en")("adminAnalytics.ga4.apiError", { error: "boom" })),
    ).toBeInTheDocument();
  });

  it.fails("DEFEKT: odrzucone wywołanie server fn nie wystawia żadnego komunikatu", async () => {
    // `anyError` szuka pola `error` w `q.data`, a odrzucone zapytanie ma
    // `data === undefined`. Awaria transportu (500 z bramki, brak sieci,
    // wyjątek w middleware) kończy się więc pełną siatką zer bez ani jednego
    // słowa ostrzeżenia - operator widzi „brak ruchu" tam, gdzie padł backend.
    h.runReport.mockRejectedValue(new Error("GA4 503: backend error"));
    const { container } = panel();
    await waitFor(() => expect(h.runReport.mock.calls.length).toBeGreaterThanOrEqual(7));

    // Krótki limit: dowodzimy BRAKU komunikatu, więc nie ma na co czekać.
    await waitFor(
      () => {
        expect(container.textContent ?? "").toMatch(/503|b[łl][ąa]d|error/i);
      },
      { timeout: 400 },
    );
  });
});

describe("Ga4BiDashboard - kafelki KPI", () => {
  it("kafelki czytają totale raportu DOBOWEGO, nie raportu zaangażowania", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(kpiValue(t("adminAnalytics.ga4.sessions"))).toBe("60"));
    expect(kpiValue(t("adminAnalytics.ga4.activeUsers"))).toBe("45");
    expect(kpiValue(t("adminAnalytics.ga4.views"))).toBe("180");
    // 0,5 pochodzi z raportu dobowego; raport „engagement" niesie 0,9 pod tym
    // samym nagłówkiem `engagementRate` - pomylenie źródeł dałoby „90.0%".
    expect(kpiValue(t("adminAnalytics.ga4.engagement"))).toBe("50.0%");
  });

  it("delta liczy się względem okna poprzedniego, osobno dla każdego kafelka", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    // 60 vs 50 = +20,0%; 45 vs 40 = +12,5%; 180 vs 150 = +20,0%.
    await waitFor(() => expect(kpiDelta(t("adminAnalytics.ga4.sessions"))).toBe("+20.0%"));
    expect(kpiDelta(t("adminAnalytics.ga4.activeUsers"))).toBe("+12.5%");
    expect(kpiDelta(t("adminAnalytics.ga4.views"))).toBe("+20.0%");
  });

  it("delta zaangażowania jest w punktach procentowych, nie w procentach względnych", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    // 0,5 vs 0,4: różnica względna to +25%, ale wskaźnik porównuje się w PP.
    // Kafelek dostaje `absoluteDelta` + sufiks „pp" - inaczej panel raportowałby
    // wzrost zaangażowania o jedną czwartą tam, gdzie urosło o 10 pp.
    await waitFor(() => expect(kpiDelta(t("adminAnalytics.ga4.engagement"))).toBe("+0,1pp"));
  });

  it("nagłówki metryk spoza CORE nie trafiają do kafelków", async () => {
    const t = realT("pl");
    // Raport dobowy z DODATKOWĄ metryką na pierwszej pozycji: gdyby panel czytał
    // totale po indeksie zamiast po nagłówku, każdy kafelek pokazałby liczbę
    // sąsiedniej metryki.
    respondWith({
      ...FULL,
      date: report(["bounceRate", ...CORE], { totals: [0.9, 60, 45, 180, 0.5] }),
    });
    panel();
    await loaded();

    await waitFor(() => expect(kpiValue(t("adminAnalytics.ga4.sessions"))).toBe("60"));
    expect(kpiValue(t("adminAnalytics.ga4.engagement"))).toBe("50.0%");
  });

  it("total nieliczbowy nie przecieka do kafelka jako NaN", async () => {
    const t = realT("pl");
    respondWith({ ...FULL, date: report(CORE, { totals: ["", "n/a", 180, 0.5] }) });
    panel();
    await loaded();

    await waitFor(() => expect(kpiValue(t("adminAnalytics.ga4.sessions"))).toBe("0"));
    expect(kpiValue(t("adminAnalytics.ga4.activeUsers"))).toBe("0");
  });
});

describe("Ga4BiDashboard - agregacja wykresów", () => {
  it("trend porządkuje serię chronologicznie i rozwija zbitą datę GA4", async () => {
    panel();
    await loaded();

    const o = optionOf("adminAnalytics.ga4.charts.trendTitle");
    // Data API oddaje `20260803` - oś musi pokazać `2026-08-03`, a wiersze
    // muszą wejść rosnąco mimo odwrotnej kolejności w odpowiedzi.
    expect(strList(rec(o.xAxis).data)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    const s = seriesOf(o);
    expect(numList(s[0].data)).toEqual([10, 20, 30]);
    expect(numList(s[1].data)).toEqual([8, 15, 22]);
    expect(numList(s[2].data)).toEqual([30, 60, 90]);
  });

  it("trzy serie trendu nazywają się ze słownika i jadą po tej samej osi", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const s = seriesOf(optionOf("adminAnalytics.ga4.charts.trendTitle"));
    expect(s.map((x) => x.name)).toEqual([
      t("adminAnalytics.ga4.sessions"),
      t("adminAnalytics.ga4.activeUsers"),
      t("adminAnalytics.ga4.views"),
    ]);
    // Rozjazd choć jednej serii to wykres, który wygląda poprawnie i kłamie.
    for (const one of s) expect(numList(one.data)).toHaveLength(3);
  });

  it("donut źródeł pokazuje osiem największych, a resztę zwija w „Inne”", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const data = slices(optionOf("adminAnalytics.ga4.charts.sourcesTitle"));
    expect(data).toHaveLength(9);
    expect(data.slice(0, 8).map((d) => d.name)).toEqual([
      "google",
      "(direct)",
      "linkedin.com",
      "x.com",
      "bing",
      "newsletter",
      "facebook.com",
      "reddit.com",
    ]);
    // „Inne" to dokładnie to, czego donut NIE pokazał: 6 + 4.
    expect(data[8]).toEqual({ name: t("adminAnalytics.ga4.other"), value: 10 });
  });

  it("donut urządzeń przycina się do PIĘCIU wycinków, nie do ośmiu jak pozostałe", async () => {
    const t = realT("pl");
    respondWith({
      ...FULL,
      device: report(["sessions"], {
        rows: [
          row("desktop", 300),
          row("mobile", 150),
          row("tablet", 50),
          row("smart tv", 20),
          row("console", 10),
          row("wearable", 6),
          row("kiosk", 4),
        ],
      }),
    });
    panel();
    await loaded();

    const data = slices(optionOf("adminAnalytics.ga4.charts.devicesTitle"));
    expect(data.map((d) => d.name)).toEqual([
      "desktop",
      "mobile",
      "tablet",
      "smart tv",
      "console",
      t("adminAnalytics.ga4.other"),
    ]);
    expect(data[5].value).toBe(10);
  });

  it("donut bez ogona nie dokleja pustego wycinka „Inne”", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const data = slices(optionOf("adminAnalytics.ga4.charts.countriesTitle"));
    expect(data.map((d) => d.name)).toEqual(["Poland", "Germany", "France", "Czechia"]);
    expect(data.map((d) => d.name)).not.toContain(t("adminAnalytics.ga4.other"));
  });

  it("donut sortuje malejąco, choćby API oddało wiersze rosnąco", async () => {
    respondWith({ ...FULL, country: report(["sessions"], { rows: [...COUNTRY_ROWS].reverse() }) });
    panel();
    await loaded();

    expect(
      slices(optionOf("adminAnalytics.ga4.charts.countriesTitle")).map((d) => d.value),
    ).toEqual([200, 150, 100, 50]);
  });

  it("donut bez metryki `sessions` w nagłówkach nie zmyśla wycinków", async () => {
    respondWith({
      ...FULL,
      country: report(["screenPageViews"], { rows: [row("Poland", 200)] }),
    });
    panel();
    await loaded();

    // Kontrakt: `{ series: [] }`, a nie wycinki policzone z przypadkowej metryki.
    expect(optionOf("adminAnalytics.ga4.charts.countriesTitle")).toEqual({ series: [] });
  });

  it("podpowiedź donuta podaje nazwę, wartość i udział z jednym miejscem po przecinku", async () => {
    panel();
    await loaded();

    const format = tooltipFormatter(optionOf("adminAnalytics.ga4.charts.sourcesTitle"));
    expect(format({ name: "google", value: 150, percent: 30 })).toBe("google: <b>150</b> (30.0%)");
  });

  it("radar czyta raport zaangażowania i normalizuje pięć osi do skali 0-100", async () => {
    panel();
    await loaded();

    const s = seriesOf(optionOf("adminAnalytics.ga4.charts.engagementTitle"));
    const values = numList((s[0].data as Array<{ value: number[] }>)[0].value);
    // 0,9 -> 90; 150 s / 3 -> 50; 3 odsłony * 20 -> 60; retencja 100 - 25 -> 75;
    // 2500 eventów / 50 -> 50.
    expect(values).toEqual([90, 50, 60, 75, 50]);
  });

  it("radar przycina osie do zakresu wskaźnika zamiast wyjść poza wykres", async () => {
    respondWith({
      ...FULL,
      engagement: report(ENGAGE_METRICS, { totals: [1, 9000, 40, 1, 999_999] }),
    });
    panel();
    await loaded();

    const s = seriesOf(optionOf("adminAnalytics.ga4.charts.engagementTitle"));
    const values = numList((s[0].data as Array<{ value: number[] }>)[0].value);
    // Wskaźniki radaru mają `max: 100`; wartość 3000 wypchnęłaby wielokąt poza
    // siatkę, a ujemna retencja - na drugą stronę środka.
    expect(values).toEqual([100, 100, 100, 0, 100]);
  });

  it("radar bez raportu zaangażowania pokazuje zera, nie NaN", async () => {
    respondWith({ ...FULL, engagement: report([], { totals: [] }) });
    panel();
    await loaded();

    const s = seriesOf(optionOf("adminAnalytics.ga4.charts.engagementTitle"));
    const values = numList((s[0].data as Array<{ value: number[] }>)[0].value);
    expect(values).toEqual([0, 0, 0, 100, 0]);
    expect(values.some(Number.isNaN)).toBe(false);
  });

  it("rank stron idzie rosnąco ku górze osi i skraca etykiety do 40 znaków", async () => {
    panel();
    await loaded();

    const o = optionOf("adminAnalytics.ga4.charts.topPagesTitle");
    expect(LONG_PATH.length).toBeGreaterThan(40);
    // Oś kategorii ECharts rośnie w górę, więc najmocniejsza strona jest
    // OSTATNIA - odwrotna kolejność dałaby rank do góry nogami.
    expect(strList(rec(o.yAxis).data)).toEqual(["/kontakt", "/o-nas", LONG_PATH.slice(0, 40)]);
    expect(numList(seriesOf(o)[0].data)).toEqual([10, 40, 120]);
  });

  it("rank stron przycina się do 15 pozycji i zostawia te najmocniejsze", async () => {
    const many = Array.from({ length: 18 }, (_, i) =>
      row(`/strona-${String(i + 1).padStart(2, "0")}`, i + 1, 0.5),
    );
    respondWith({
      ...FULL,
      page: report(["screenPageViews", "engagementRate"], { rows: many }),
    });
    panel();
    await loaded();

    const labels = strList(rec(optionOf("adminAnalytics.ga4.charts.topPagesTitle").yAxis).data);
    expect(labels).toHaveLength(15);
    expect(labels[14]).toBe("/strona-18");
    expect(labels[0]).toBe("/strona-04");
    // Trzy najsłabsze wypadają - gdyby przycinał przed sortowaniem, wypadłyby
    // przypadkowe.
    expect(labels).not.toContain("/strona-03");
  });

  it("wiersz z brakującą metryką daje zero na serii, nie dziurę i nie NaN", async () => {
    // Data API potrafi skrócić wiersz, gdy metryka nie ma wartości dla danego
    // dnia. Seria z `undefined` w środku rozjeżdża oś wobec dwóch pozostałych.
    respondWith({
      ...FULL,
      date: report(CORE, {
        totals: [30, 20, 60, 0.5],
        rows: [row("20260801", 10, 8), row("20260802", 20, 12, 60, 0.5)],
      }),
    });
    panel();
    await loaded();

    const s = seriesOf(optionOf("adminAnalytics.ga4.charts.trendTitle"));
    expect(numList(s[2].data)).toEqual([0, 60]);
    expect(numList(s[2].data).some(Number.isNaN)).toBe(false);
  });

  it("wymiar spoza formatu daty GA4 idzie na oś bez przekształcenia", async () => {
    // GA4 kubkuje nadmiarowe wiersze pod `(other)`. Ślepe cięcie po pozycjach
    // 0-4/4-6/6-8 zrobiłoby z tego „(oth)-er-)”, czyli etykietę-śmiecia.
    respondWith({
      ...FULL,
      date: report(CORE, {
        totals: [40, 30, 120, 0.5],
        rows: [row("20260801", 10, 8, 30, 0.5), row("(other)", 30, 22, 90, 0.5)],
      }),
    });
    panel();
    await loaded();

    expect(strList(rec(optionOf("adminAnalytics.ga4.charts.trendTitle").xAxis).data)).toEqual([
      "(other)",
      "2026-08-01",
    ]);
  });

  it("wiersz bez wymiaru dostaje znak zastępczy zamiast zniknąć z wykresu", async () => {
    respondWith({
      ...FULL,
      country: report(["sessions"], { rows: [row("", 200), row("Germany", 150)] }),
      page: report(["screenPageViews", "engagementRate"], {
        rows: [{ dims: [], metrics: ["5", "0.5"] }],
      }),
    });
    panel();
    await loaded();

    // Pusty wymiar to realna odpowiedź Data API (np. ruch bez przypisanego
    // kraju). Wycinek bez nazwy zniknąłby z legendy, a suma donuta przestałaby
    // zgadzać się z kafelkiem.
    expect(slices(optionOf("adminAnalytics.ga4.charts.countriesTitle")).map((d) => d.name)).toEqual(
      ["?", "Germany"],
    );
    expect(strList(rec(optionOf("adminAnalytics.ga4.charts.topPagesTitle").yAxis).data)).toEqual([
      "/",
    ]);
  });

  it("sekcja interpretacji dostaje okno i tryb, które panel faktycznie pokazuje", async () => {
    const t = realT("pl");
    panel({ activeMode: "oauth_refresh" });
    await loaded();

    expect(
      screen.getByText(
        t("adminAnalytics.ga4.insightsSubtitle", {
          days: 28,
          mode: t("adminAnalytics.ga4.modeOauth"),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("tryb bez OAuth opisany jest jako Service Account", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    expect(
      screen.getByText(
        t("adminAnalytics.ga4.insightsSubtitle", {
          days: 28,
          mode: t("adminAnalytics.ga4.modeServiceAccount"),
        }),
      ),
    ).toBeInTheDocument();
  });
});

describe("Ga4BiDashboard - zero ruchu a brak konfiguracji", () => {
  it("właściwość bez ruchu daje zera w kafelkach i puste, ale poprawne wykresy", async () => {
    const t = realT("pl");
    respondWith(ZERO_TRAFFIC);
    panel();
    await loaded();

    await waitFor(() => expect(kpiValue(t("adminAnalytics.ga4.sessions"))).toBe("0"));
    // Puste serie, nie brak wykresu - inaczej układ karty skacze przy pierwszym
    // dniu z ruchem.
    expect(strList(rec(optionOf("adminAnalytics.ga4.charts.trendTitle").xAxis).data)).toEqual([]);
    expect(slices(optionOf("adminAnalytics.ga4.charts.sourcesTitle"))).toEqual([]);
    expect(strList(rec(optionOf("adminAnalytics.ga4.charts.topPagesTitle").yAxis).data)).toEqual(
      [],
    );
  });

  it.fails("DEFEKT: raport z `configured: false` maluje się jak zmierzone zero ruchu", async () => {
    // `runGa4Report` oddaje `EMPTY_GA4_REPORT` (czyli `configured: false`,
    // BEZ pola `error`), gdy zabraknie property albo gdy odświeżenie tokenu
    // Google padnie w locie. Prop `configured` pochodzi tymczasem ze statusu
    // liczonego z ENV, więc jest wtedy `true` - i panel rysuje pełną siatkę
    // zer. Pole `configured` z odpowiedzi nie jest czytane W OGÓLE: „nie mam
    // dostępu do właściwości" i „właściwość nie miała ruchu" dają na ekranie
    // dokładnie ten sam obraz, choć pierwsze wymaga interwencji admina,
    // a drugie nie wymaga niczego.
    respondWith(NOT_CONFIGURED_ON_SERVER);
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain(
      realT("pl")("adminAnalytics.ga4.notConfiguredPre"),
    );
  });

  it.fails("DEFEKT: przy zerze ruchu panel nie mówi „brak danych w oknie”", async () => {
    // Komunikat JEST w słowniku (`adminAnalytics.common.noDataWindow`) i JEST
    // używany przez sąsiednie pulpity tego samego modułu. Tutaj właściwość bez
    // ani jednej sesji wygląda identycznie jak taka, której dane nie dojechały.
    respondWith(ZERO_TRAFFIC);
    panel();
    await loaded();

    expect(screen.getByText(realT("pl")("adminAnalytics.common.noDataWindow"))).toBeInTheDocument();
  });
});

describe("Ga4BiDashboard - drill-down", () => {
  it("kliknięcie punktu trendu otwiera okno z datą i czterema metrykami tego dnia", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.trendTitle"), {
      dataIndex: 1,
      seriesName: t("adminAnalytics.ga4.sessions"),
    });

    const dialog = await screen.findByRole("dialog");
    // Indeks 1 po posortowaniu to 2026-08-02, nie drugi wiersz odpowiedzi.
    expect(within(dialog).getByText("2026-08-02")).toBeInTheDocument();
    expect(within(dialog).getByText("20")).toBeInTheDocument();
    expect(within(dialog).getByText("15")).toBeInTheDocument();
    expect(within(dialog).getByText("60")).toBeInTheDocument();
    expect(within(dialog).getByText("75.0%")).toBeInTheDocument();
  });

  it("kliknięcie poza serią trendu nie otwiera pustego okna", async () => {
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.trendTitle"), { dataIndex: 99 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie legendy - zdarzenie bez indeksu punktu - nie otwiera okna", async () => {
    panel();
    await loaded();

    // ECharts woła ten sam handler dla legendy i osi. Bez bramki na brak
    // `dataIndex` panel otwierałby okno z danymi PIERWSZEGO dnia okna przy
    // każdym kliknięciu w cokolwiek na wykresie.
    await clickChart(chartOf("adminAnalytics.ga4.charts.trendTitle"), {
      componentType: "legend",
      name: realT("pl")("adminAnalytics.ga4.sessions"),
    });
    await clickChart(chartOf("adminAnalytics.ga4.charts.topPagesTitle"), {
      componentType: "legend",
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie poza słupkami rankingu nie otwiera pustego okna", async () => {
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.topPagesTitle"), { dataIndex: 42 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie wycinka donuta pokazuje sesje i udział liczony z CAŁEGO raportu", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.sourcesTitle"), {
      name: "google",
      value: 150,
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "google" })).toBeInTheDocument();
    // Mianownikiem jest suma wszystkich 10 źródeł (500), a nie suma ośmiu
    // pokazanych wycinków - inaczej udziały sumowałyby się do ponad 100%.
    expect(within(dialog).getByText("30.0%")).toBeInTheDocument();
    expect(within(dialog).getByText("150")).toBeInTheDocument();
    expect(
      within(dialog).getByText(t("adminAnalytics.ga4.charts.sourcesTitle")),
    ).toBeInTheDocument();
  });

  it("wycinek niosący wartość w `data` (tak robi ECharts dla kołowego) też się otwiera", async () => {
    panel();
    await loaded();

    // ECharts dla serii `pie` przekazuje kliknięty rekord w `params.data`,
    // a `params.value` bywa puste. Obsłużenie tylko `value` gasiłoby drążenie
    // po cichu - kliknięcie po prostu nic by nie robiło.
    await clickChart(chartOf("adminAnalytics.ga4.charts.countriesTitle"), {
      data: { name: "Germany", value: 150 },
    });

    const dialog = await screen.findByRole("dialog");
    // Bez `params.name` tytułem jest znak zastępczy, a nie „undefined".
    expect(within(dialog).getByRole("heading", { name: "?" })).toBeInTheDocument();
    expect(within(dialog).getByText("150")).toBeInTheDocument();
    // 150 z 500 sesji wszystkich krajów.
    expect(within(dialog).getByText("30.0%")).toBeInTheDocument();
  });

  it("udział wycinka przy zerowej sumie raportu to 0%, nie NaN ani dzielenie przez zero", async () => {
    respondWith({
      ...FULL,
      country: report(["sessions"], { rows: [row("Poland", 0), row("Germany", 0)] }),
    });
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.countriesTitle"), {
      name: "Poland",
      value: 0,
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("0.0%")).toBeInTheDocument();
    expect(dialog.textContent ?? "").not.toContain("NaN");
  });

  it("kliknięcie w element donuta bez wartości liczbowej nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.countriesTitle"), { name: "legenda" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie słupka rankingu prowadzi do PEŁNEJ ścieżki, nie do skróconej etykiety", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.topPagesTitle"), { dataIndex: 2 });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: LONG_PATH })).toBeInTheDocument();
    // Odnośnik musi wskazywać adres, który da się otworzyć - etykieta osi jest
    // ucięta do 40 znaków i prowadziłaby na 404.
    expect(
      within(dialog).getByRole("link", { name: t("adminAnalytics.drillDialog.openInNewTab") }),
    ).toHaveAttribute("href", LONG_PATH);
    expect(within(dialog).getByText("120")).toBeInTheDocument();
    expect(within(dialog).getByText("75.0%")).toBeInTheDocument();
  });

  it("radar nie jest klikalny - nie ma w nim czego drążyć", async () => {
    panel();
    await loaded();

    expect(chartOf("adminAnalytics.ga4.charts.engagementTitle").onDataClick).toBeUndefined();
  });
});

describe("Ga4BiDashboard - okno i wejście zapytania", () => {
  it("siedem raportów, każdy o swój wymiar i swój limit wierszy", async () => {
    panel();
    await loaded();

    const inputs = reportInputs();
    expect(inputs.map((i) => i.dimensions)).toEqual([
      ["date"],
      ["date"],
      ["sessionSource"],
      ["country"],
      ["deviceCategory"],
      ["pagePath"],
      [],
    ]);
    // 400 dla serii dobowej (90 dni + zapas), 1 dla pojedynczego wiersza totali.
    expect(inputs.map((i) => i.limit)).toEqual([400, 400, 20, 30, 10, 20, 1]);
    expect(inputs[6].metrics).toEqual(ENGAGE_METRICS);
  });

  it("okno startowe to 28 pełnych dni UTC BEZ dnia otwartego", async () => {
    panel();
    await loaded();

    const current = reportInputs().filter((i) => i.endDate === yesterdayUtc());
    expect(current).toHaveLength(6);
    for (const i of current) expect(spanDays(i.startDate, i.endDate)).toBe(28);
    // Dzień bieżący jest jeszcze niedomknięty przez ingestię GA4 - gdyby wpadł
    // do okna, ostatni punkt trendu zawsze zaniżał.
    expect(current[0].endDate).not.toBe(new Date().toISOString().slice(0, 10));
  });

  it("okno poprzednie ma tę samą długość i jest ROZŁĄCZNE z bieżącym", async () => {
    panel();
    await loaded();

    const inputs = reportInputs();
    const current = inputs.filter(
      (i) => i.dimensions[0] === "date" && i.endDate === yesterdayUtc(),
    );
    const previous = inputs.filter(
      (i) => i.dimensions[0] === "date" && i.endDate !== yesterdayUtc(),
    );
    expect(previous).toHaveLength(1);
    expect(spanDays(previous[0].startDate, previous[0].endDate)).toBe(28);
    // Oba przedziały GA4 są DOMKNIĘTE, więc wspólny dzień graniczny zawyżałby
    // bazę porównawczą i systematycznie zaniżał każdą deltę na kafelkach.
    expect(Date.parse(previous[0].endDate)).toBeLessThan(Date.parse(current[0].startDate));
    expect(spanDays(previous[0].endDate, current[0].startDate)).toBe(2);
  });

  it("granice okna zgadzają się z kanonicznym resolwerem warstwy semantycznej", async () => {
    panel();
    await loaded();

    const expected = resolveWindow({ presetId: "28d" });
    const expectedPrev = previousWindow(expected);
    const inputs = reportInputs();
    expect(inputs[0].startDate).toBe(expected.ga4.startDate);
    expect(inputs[0].endDate).toBe(expected.ga4.endDate);
    expect(inputs[1].startDate).toBe(expectedPrev.ga4.startDate);
    expect(inputs[1].endDate).toBe(expectedPrev.ga4.endDate);
  });

  it("panel pokazuje granice okna wprost, żeby dało się je uzgodnić z interfejsem Google", async () => {
    const t = realT("pl");
    const w = resolveWindow({ presetId: "28d" });
    panel();
    await loaded();

    expect(
      screen.getByText(
        t("adminAnalytics.semantic.window.range", {
          since: w.sinceIso.slice(0, 10),
          until: w.untilIso.slice(0, 10),
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.semantic.window.grainDay"))).toBeInTheDocument();
  });

  it("zmiana okna na 7 dni przestawia WEJŚCIE zapytania, nie tylko etykietę", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const before = h.runReport.mock.calls.length;

    const listbox = openSelect(screen.getByRole("combobox"));
    fireEvent.click(
      within(listbox).getByRole("option", { name: t("adminAnalytics.timeRange.preset7d") }),
    );

    await waitFor(() => expect(h.runReport.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => {
      const after = reportInputs().slice(before);
      expect(after.length).toBeGreaterThan(0);
      for (const i of after) expect(spanDays(i.startDate, i.endDate)).toBe(7);
    });
  });

  it("wybór okna zna cztery presety warstwy semantycznej, po polsku", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const listbox = openSelect(screen.getByRole("combobox"));
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      t("adminAnalytics.timeRange.preset7d"),
      t("adminAnalytics.timeRange.preset14d"),
      t("adminAnalytics.timeRange.preset28d"),
      t("adminAnalytics.timeRange.preset90d"),
    ]);
  });

  it("„Odśwież” ponawia WSZYSTKIE siedem raportów, nie tylko serię dobową", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const before = h.runReport.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.common.refresh") }));

    await waitFor(() => expect(h.runReport.mock.calls.length).toBe(before + 7));
    // Ponowienie musi objąć KAŻDY wymiar - inaczej po odświeżeniu część kart
    // pokazuje dane z poprzedniego stanu obok danych świeżych.
    const after = reportInputs().slice(before);
    expect(new Set(after.map((i) => i.dimensions[0] ?? "totals"))).toEqual(
      new Set(["date", "sessionSource", "country", "deviceCategory", "pagePath", "totals"]),
    );
  });
});

describe("Ga4BiDashboard - izolacja warsztatów", () => {
  it("klient nie podaje właściwości GA4 - rozwiązuje ją serwer z ustawień warsztatu", async () => {
    panel();
    await loaded();

    // Gdyby wejście niosło `propertyId`, wystarczyłoby podmienić je w narzędziach
    // deweloperskich, żeby przeczytać ruch cudzego warsztatu. Kontrakt: klient
    // wysyła WYŁĄCZNIE opis zakresu i metryk.
    for (const input of reportInputs()) {
      expect(Object.keys(input).sort()).toEqual([
        "dimensions",
        "endDate",
        "limit",
        "metrics",
        "startDate",
      ]);
    }
  });

  it("panel drugiego warsztatu pokazuje wyłącznie własne dane", async () => {
    const first = panel();
    await loaded();
    expect(await screen.findByText(/google \(150\)/)).toBeInTheDocument();
    first.unmount();

    h.runReport.mockReset();
    respondWith({
      ...ZERO_TRAFFIC,
      date: report(CORE, { totals: [7, 5, 9, 0.5], rows: [row("20260801", 7, 5, 9, 0.5)] }),
      source: report(["sessions"], { rows: [row("beta.example.org", 7)] }),
    });
    const second = panel();
    await loaded();

    expect(await screen.findByText(/beta\.example\.org \(7\)/)).toBeInTheDocument();
    expect(within(second.container).queryByText(/google \(150\)/)).toBeNull();
    expect(second.container.textContent ?? "").not.toContain("Poland");
  });

  it.fails(
    "DEFEKT: klucz cache nie niesie warsztatu, więc panel B maluje ruch warsztatu A",
    async () => {
      // `queryKey: ["ga4-bi", presetId, start, end, r.key]` nie ma ani tenanta,
      // ani użytkownika. Przy kliencie react-query przeżywającym zmianę
      // warsztatu (a tak jest w aplikacji - `QueryClient` stoi w korzeniu)
      // wpisy poprzedniego warsztatu są jeszcze świeże (`staleTime: 60_000`),
      // więc panel warsztatu B dostaje je Z CACHE i NIE WYSYŁA ani jednego
      // zapytania. Wyciek jest cichy: nie widać go w ruchu sieciowym, widać go
      // wyłącznie na ekranie.
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const first = panel({ client });
      await loaded();
      first.unmount();

      respondWith({
        ...ZERO_TRAFFIC,
        source: report(["sessions"], { rows: [row("beta.example.org", 7)] }),
      });
      const second = panel({ client });
      await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(6));

      expect(second.container.textContent ?? "").not.toContain("google (150)");
    },
  );
});

describe("Ga4BiDashboard - dostępność", () => {
  it("każdy z sześciu wykresów ma region ARIA nazwany tytułem swojej karty", async () => {
    panel();
    await loaded();

    expect(screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"))).toEqual(
      CHART_TITLE_KEYS.map((k) => regionName("pl", k)),
    );
  });

  it("karta niepodłączonej integracji jest wolna od naruszeń axe", async () => {
    const { container } = panel({ configured: false });

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("poza nienazwanymi przyciskami panel nie ma innych naruszeń axe", async () => {
    const { container } = panel();
    await loaded();

    // Regułę `button-name` wyłączamy TYLKO tutaj i tylko po to, żeby jeden znany
    // defekt (test niżej) nie przykrywał wszystkiego innego: kolejności
    // nagłówków, poprawności ARIA i semantyki list.
    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(summarize(violations)).toBe("");
  });

  it.fails("DEFEKT: żaden z sześciu wykresów panelu nie ma alternatywy tekstowej", async () => {
    // `ChartCard` UMIE zbudować tabelę danych - wystarczy podać jej `csv`.
    // `Ga4BiDashboard` nie podaje go ANI RAZ, więc dla czytnika ekranu cały
    // pulpit to sześć pustych prostokątów z samą nazwą. Bliźniaczy pulpit GSC
    // podaje `csv` dla dwóch kart, więc mechanizm jest sprawdzony w praktyce.
    panel();
    await loaded();

    const withoutText = screen
      .getAllByRole("img")
      .filter((el) => !el.getAttribute("aria-describedby"));
    expect(withoutText.map((el) => el.getAttribute("aria-label"))).toEqual([]);
  });

  it.fails(
    "DEFEKT: pole wyboru okna i przyciski kart wykresów nie mają dostępnych nazw",
    async () => {
      // Etykieta „Okno" jest zwykłym `<label>` bez `htmlFor`, a wyzwalacz Radiksa
      // nie ma `aria-label` - dla czytnika ekranu pole wyboru jest bezimienne.
      // Do tego sześć przycisków „więcej" na kartach to sama ikona
      // `MoreHorizontal`, choć sąsiedni przycisk pełnego ekranu - w tym samym
      // pliku `ChartCard.tsx` - nazwę ma.
      const { container } = panel();
      await loaded();

      expect(summarize(await axeViolations(container))).toBe("");
    },
  );
});

describe("Ga4BiDashboard - dwujęzyczność", () => {
  it("cały pasek narzędzi i sześć kart nazywa się ze słownika PL", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    expect(screen.getByText(t("adminAnalytics.ga4.window"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("adminAnalytics.common.refresh") }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"))).toEqual(
      CHART_TITLE_KEYS.map((k) => regionName("pl", k)),
    );
  });

  it("ten sam panel po EN mówi po angielsku, bez ani jednego polskiego tytułu", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const pl = realT("pl");
    const { container } = panel();
    await loaded();

    expect(screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"))).toEqual(
      CHART_TITLE_KEYS.map((k) => regionName("en", k)),
    );
    for (const key of CHART_TITLE_KEYS) {
      // Brak klucza EN oznaczałby cichy fallback na polski tytuł - a to wygląda
      // jak działający panel, więc nikt tego nie zgłosi.
      expect(en(key)).not.toBe(pl(key));
      expect(container.textContent ?? "").not.toContain(pl(key));
    }
    expect(
      screen.getByRole("button", { name: en("adminAnalytics.common.refresh") }),
    ).toBeInTheDocument();
    expect(screen.getByText(en("adminAnalytics.ga4.window"))).toBeInTheDocument();
  });

  it("legendy i etykiety oddane wykresom też są dwujęzyczne", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    panel();
    await loaded();

    const trend = optionOf("adminAnalytics.ga4.charts.trendTitle", "en");
    expect(strList(rec(trend.legend).data)).toEqual([
      en("adminAnalytics.ga4.sessions"),
      en("adminAnalytics.ga4.activeUsers"),
      en("adminAnalytics.ga4.views"),
    ]);
    const radar = optionOf("adminAnalytics.ga4.charts.engagementTitle", "en");
    const indicators = (rec(radar.radar).indicator ?? []) as Array<{ name: string }>;
    expect(indicators.map((i) => i.name)).toEqual([
      en("adminAnalytics.ga4.radar.engagement"),
      en("adminAnalytics.ga4.radar.sessionTime"),
      en("adminAnalytics.ga4.radar.viewsPerSession"),
      en("adminAnalytics.ga4.radar.retention"),
      en("adminAnalytics.ga4.radar.events"),
    ]);
    expect(seriesOf(radar)[0].data).toEqual([
      {
        value: [90, 50, 60, 75, 50],
        name: en("adminAnalytics.ga4.radar.seriesName", { days: 28 }),
      },
    ]);
  });

  it("wycinek „Inne” w donucie jest tłumaczony, a nie zaszyty po polsku", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    panel();
    await loaded();

    const data = slices(optionOf("adminAnalytics.ga4.charts.sourcesTitle", "en"));
    expect(data[8]).toEqual({ name: en("adminAnalytics.ga4.other"), value: 10 });
    expect(data[8].name).not.toBe(realT("pl")("adminAnalytics.ga4.other"));
  });
});
