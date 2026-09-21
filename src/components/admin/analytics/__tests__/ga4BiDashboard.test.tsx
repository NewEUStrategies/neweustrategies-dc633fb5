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
//      warsztatu nie mają prawa pojawić się w panelu drugiego - także przez
//      CACHE, bo `QueryClient` stoi w korzeniu aplikacji i przeżywa
//      przelogowanie, więc klucz zapytania musi nieść warsztat.
//   6. ALTERNATYWA TEKSTOWA. Rysunek nigdy nie jest jedyną drogą do liczby:
//      każdy wykres panelu ma mieć nazwę regionu z tytułu karty i tabelę tych
//      samych danych, którą silnik rysuje przy każdym rodzaju.
//
// PANEL RYSUJE NASZYM SILNIKIEM, a ten plik go nie podmienia, tylko PODGLĄDA:
// `Chart` jest opakowany szpiegiem, który zapisuje `config`, `onSelect` oraz
// nazwę regionu, a potem woła PRAWDZIWY komponent. Asercje o agregacji idą
// więc na konfigurację oddaną konkretnej karcie, a asercje o dostępności - na
// to, co silnik z niej naprawdę narysował. Atrapa dowodziłaby tylko tego, że
// panel woła funkcję.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Ga4Report, Ga4Row } from "@/lib/analytics/ga4.functions";
import type { ChartConfig, ChartSeries } from "@/lib/charts/types";
import type { ChartSelection } from "@/lib/charts/selection";
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
  tenantId: "warsztat-a",
  charts: [] as Array<{
    config: ChartConfig;
    onSelect?: (selection: ChartSelection) => void;
    ariaLabel?: string;
  }>,
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

// Podmieniamy WYŁĄCZNIE hook warsztatu: jego droga do `profiles` ma własny test
// (`src/lib/tenant.ts`), a tutaj liczy się to, CZYM panel skleja klucz cache.
// Sterowanie `h.tenantId` pozwala zamontować dwa panele dwóch warsztatów na
// jednym `QueryClient` - dokładnie tak, jak dzieje się to po przelogowaniu.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

// SZPIEG, NIE ATRAPA. Zapisujemy konfigurację, obsługę wskazania i nazwę
// regionu, a potem oddajemy sterowanie prawdziwemu silnikowi - inaczej
// zniknęłyby z dokumentu tabele danych i nazwy rysunków, czyli dokładnie to,
// czego pilnuje sekcja o alternatywie tekstowej. Nazwa regionu jest przy
// okazji jedynym pewnym ROZRÓŻNIKIEM trzech donutów panelu: mają identyczny
// kształt konfiguracji i różnią się wyłącznie kartą, na której stoją.
vi.mock("@/components/charts/Chart", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/charts/Chart")>();
  return {
    ...real,
    Chart: (props: Parameters<typeof real.Chart>[0]) => {
      h.charts.push({
        config: props.config,
        onSelect: props.onSelect,
        ariaLabel: props.ariaLabel,
      });
      return real.Chart(props);
    },
  };
});

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

function seriesOf(o: ChartConfig): ChartSeries[] {
  return o.series;
}
function numList(v: unknown): number[] {
  return Array.isArray(v) ? (v as unknown[]).map(Number) : [];
}
/**
 * Wycinki pierścienia jako pary nazwa-wartość. Silnik nie przyjmuje rekordów
 * wycinków, tylko kategorie i serię - a to jest ta sama informacja zapisana
 * rozdzielnie, więc test składa ją z powrotem i pyta o to samo co dawniej.
 */
function slices(o: ChartConfig): Array<{ name: string; value: number }> {
  return o.categories.map((name, i) => ({ name, value: o.series[0]?.values[i] ?? 0 }));
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
  config: ChartConfig;
  onSelect?: (selection: ChartSelection) => void;
  ariaLabel?: string;
}

/**
 * Wykres KARTY o podanym tytule, rozpoznany po NAZWIE REGIONU. Trzy donuty
 * panelu mają identyczny kształt konfiguracji i różnią się wyłącznie kartą, na
 * której stoją - nazwa jest jedynym miejscem, w którym tytuł karty spotyka się
 * z instancją wykresu. Bierzemy zapis OSTATNI, bo panel przerysowuje się przy
 * każdej odpowiedzi zapytania.
 */
function chartOf(titleKey: string, lang: Lang = "pl"): Captured {
  const name = regionName(lang, titleKey);
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    if (h.charts[i].ariaLabel === name) return h.charts[i];
  }
  throw new Error(`test: karta „${titleKey}" nie wyrenderowała wykresu`);
}

function configOf(titleKey: string, lang: Lang = "pl"): ChartConfig {
  return chartOf(titleKey, lang).config;
}

/** Tabela danych rysunku - alternatywa tekstowa, którą silnik rysuje zawsze. */
function dataTableOf(titleKey: string, lang: Lang = "pl"): HTMLElement {
  const region = screen.getByLabelText(regionName(lang, titleKey));
  const el = region.closest("figure")?.querySelector<HTMLElement>("[data-chart-table] table");
  if (!el) throw new Error(`test: karta „${titleKey}" nie ma tabeli danych`);
  return el;
}

/** Symuluje WSKAZANIE elementu - tak, jak oddaje je silnik. */
async function clickChart(chart: Captured, selection: Partial<ChartSelection>): Promise<void> {
  await act(async () => {
    chart.onSelect?.({
      kind: chart.config.kind,
      categoryIndex: null,
      category: null,
      seriesIndex: null,
      seriesName: null,
      value: null,
      ...selection,
    });
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
async function loaded(lang: Lang = "pl"): Promise<void> {
  await waitFor(() => expect(h.runReport.mock.calls.length).toBeGreaterThanOrEqual(7));
  await waitFor(() => {
    expect(screen.queryByText(realT("pl")("adminAnalytics.common.loading"))).toBeNull();
    expect(screen.queryByText(realT("en")("adminAnalytics.common.loading"))).toBeNull();
  });
  // SZEŚĆ WYKRESÓW PO NAZWACH REGIONÓW, a nie po liczbie elementów o roli
  // obrazka ani po liczbie ram: wycinki pierścienia też mają rolę obrazka
  // (każdy jest osobnym celem tabulacji z własną nazwą), a wykres BEZ DANYCH
  // nie rysuje ramy, tylko komunikat - więc obie te liczby zależą od danych,
  // a nie od tego, czy panel się już zbudował. Nazwa regionu jest niezależna
  // od jednego i drugiego.
  await waitFor(() => {
    const nazwy = new Set(h.charts.map((c) => c.ariaLabel));
    for (const key of CHART_TITLE_KEYS) expect(nazwy.has(regionName(lang, key))).toBe(true);
  });
}

/** Otwiera listę Radiksa klawiaturą - zdarzenia wskaźnika nie działają w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.tenantId = "warsztat-a";
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
    expect(document.querySelectorAll("figure.neh-chart")).toHaveLength(0);
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

  it("w trakcie pobierania kafelki KPI nie malują zer - zero nie jest pomiarem", async () => {
    // PILNUJE ROZRÓŻNIENIA „0 sesji" od „jeszcze nie wiem". Panel renderuje
    // siatkę KPI natychmiast, więc dopóki raport dobowy nie odpowie, kafelek
    // musi mówić o trwającym pomiarze - zero byłoby nieodróżnialne od
    // właściwości bez ruchu, choć to zupełnie inna informacja dla operatora.
    const t = realT("pl");
    h.runReport.mockImplementation(() => new Promise<Ga4Report>(() => {}));
    panel();
    await screen.findByText(t("adminAnalytics.common.loading"));

    expect(kpiValue(t("adminAnalytics.ga4.sessions"))).not.toBe("0");
    expect(kpiValue(t("adminAnalytics.ga4.sessions"))).toBe(
      t("adminAnalytics.common.measuringShort"),
    );
  });
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
    expect(document.querySelectorAll("figure.neh-chart")).toHaveLength(0);
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

  it("odrzucone wywołanie server fn wystawia komunikat z przyczyną, nie siatkę zer", async () => {
    // PILNUJE DRUGIEJ DROGI DO BŁĘDU. Pole `error` mieszka w `q.data`, a
    // odrzucone zapytanie ma `data === undefined` - awaria transportu (500
    // z bramki, brak sieci, wyjątek w middleware) nie wykazuje się tam NIGDY.
    // Panel czyta osobno `q.isError` i cytuje treść wyjątku; bez tego operator
    // widziałby „brak ruchu" dokładnie tam, gdzie padł backend.
    h.runReport.mockRejectedValue(new Error("GA4 503: backend error"));
    const { container } = panel();
    await waitFor(() => expect(h.runReport.mock.calls.length).toBeGreaterThanOrEqual(7));

    expect(
      await screen.findByText(
        realT("pl")("adminAnalytics.ga4.apiError", { error: "GA4 503: backend error" }),
      ),
    ).toBeInTheDocument();
    // Komunikat WYPIERA liczby: siatka zer obok błędu wygląda jak pomiar.
    expect(document.querySelectorAll("figure.neh-chart")).toHaveLength(0);
    expect(container.textContent ?? "").toMatch(/503/);
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

    const o = configOf("adminAnalytics.ga4.charts.trendTitle");
    // Data API oddaje `20260803` - oś musi pokazać `2026-08-03`, a wiersze
    // muszą wejść rosnąco mimo odwrotnej kolejności w odpowiedzi.
    expect(o.categories).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    const s = seriesOf(o);
    expect(numList(s[0].values)).toEqual([10, 20, 30]);
    expect(numList(s[1].values)).toEqual([8, 15, 22]);
    expect(numList(s[2].values)).toEqual([30, 60, 90]);
  });

  it("trzy serie trendu nazywają się ze słownika i jadą po tej samej osi", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const s = seriesOf(configOf("adminAnalytics.ga4.charts.trendTitle"));
    expect(s.map((x) => x.name)).toEqual([
      t("adminAnalytics.ga4.sessions"),
      t("adminAnalytics.ga4.activeUsers"),
      t("adminAnalytics.ga4.views"),
    ]);
    // Rozjazd choć jednej serii to wykres, który wygląda poprawnie i kłamie.
    for (const one of s) expect(numList(one.values)).toHaveLength(3);
  });

  it("donut źródeł pokazuje osiem największych, a resztę zwija w „Inne”", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const data = slices(configOf("adminAnalytics.ga4.charts.sourcesTitle"));
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

    const data = slices(configOf("adminAnalytics.ga4.charts.devicesTitle"));
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

    const data = slices(configOf("adminAnalytics.ga4.charts.countriesTitle"));
    expect(data.map((d) => d.name)).toEqual(["Poland", "Germany", "France", "Czechia"]);
    expect(data.map((d) => d.name)).not.toContain(t("adminAnalytics.ga4.other"));
  });

  it("donut sortuje malejąco, choćby API oddało wiersze rosnąco", async () => {
    respondWith({ ...FULL, country: report(["sessions"], { rows: [...COUNTRY_ROWS].reverse() }) });
    panel();
    await loaded();

    expect(
      slices(configOf("adminAnalytics.ga4.charts.countriesTitle")).map((d) => d.value),
    ).toEqual([200, 150, 100, 50]);
  });

  it("donut bez metryki `sessions` w nagłówkach nie zmyśla wycinków", async () => {
    respondWith({
      ...FULL,
      country: report(["screenPageViews"], { rows: [row("Poland", 200)] }),
    });
    panel();
    await loaded();

    // Kontrakt: ZERO SERII, a nie wycinki policzone z przypadkowej metryki.
    // Silnik rysuje wtedy ramkę z komunikatem o braku danych - czyli mówi
    // wprost to, co panel wie: tego pomiaru w raporcie nie ma.
    const pusty = configOf("adminAnalytics.ga4.charts.countriesTitle");
    expect(pusty.series).toEqual([]);
    expect(pusty.categories).toEqual([]);
  });

  it("pierścień podaje sumę obserwacji, z której silnik liczy udziały", async () => {
    panel();
    await loaded();

    // UDZIAŁ LICZY SILNIK, nie panel: własny formater dymka był drugą
    // implementacją tej samej arytmetyki i mógł rozjechać się z tabelą klucza
    // rysowaną obok. Panel oddaje więc surowe wartości i LICZBĘ OBSERWACJI do
    // podpisu, a procenty powstają w jednym miejscu.
    const o = configOf("adminAnalytics.ga4.charts.sourcesTitle");
    expect(o.kind).toBe("donut");
    // Osiem wycinków plus „Inne" - suma jest sumą CAŁEGO raportu (500).
    expect(o.sampleSize).toBe(500);
    expect(slices(o).find((d) => d.name === "google")?.value).toBe(150);
  });

  // RADAR WYSZEDŁ Z PANELU. Powierzchnia wielokąta zależy od arbitralnie
  // wybranej kolejności osi, więc ten sam zestaw pięciu wskaźników wygląda
  // dobrze albo źle w zależności od tego, jak je wypisano - to nie jest
  // kwestia stylu, to strukturalne kłamstwo formy. Do tego promień koduje
  // wartość powierzchnią, jednym z najsłabszych kanałów percepcyjnych.
  //
  // Zamiennik: SŁUPKI POZIOME, POSORTOWANE (pozycja na wspólnej skali).
  // Dane, normalizacja i tabela danych zostały BEZ ZMIAN - dlatego te trzy
  // przypadki sprawdzają dokładnie te same liczby, tylko czytane z serii
  // słupkowej i w kolejności MALEJĄCEJ: nasz silnik rysuje kategorie słupków
  // poziomych od góry w kolejności tablicy, więc ranking czyta się z góry na
  // dół. (ECharts układał oś Y od dołu i wymagał sortowania odwrotnego - ta
  // sama intencja, inny kierunek.)
  it("słupki zaangażowania czytają raport i normalizują pięć wskaźników do 0-100", async () => {
    panel();
    await loaded();

    const s = seriesOf(configOf("adminAnalytics.ga4.charts.engagementTitle"));
    const values = numList(s[0].values);
    // 0,9 -> 90; 150 s / 3 -> 50; 3 odsłony * 20 -> 60; retencja 100 - 25 -> 75;
    // 2500 eventów / 50 -> 50. Posortowane malejąco: 90, 75, 60, 50, 50.
    expect(values).toEqual([90, 75, 60, 50, 50]);
  });

  it("słupki zaangażowania przycinają skalę do 0-100 zamiast wyjść poza wykres", async () => {
    respondWith({
      ...FULL,
      engagement: report(ENGAGE_METRICS, { totals: [1, 9000, 40, 1, 999_999] }),
    });
    panel();
    await loaded();

    const config = configOf("adminAnalytics.ga4.charts.engagementTitle");
    const values = numList(seriesOf(config)[0].values);
    // Wartość 3000 wypchnęłaby słupek poza obszar, a ujemna retencja - w lewo
    // za oś. Przycięcie do 0-100 jest więc po stronie DANYCH i zostaje.
    expect(values).toEqual([100, 100, 100, 100, 0]);
    // SKALA NIE MA STAŁEGO KOŃCA, bo silnik liczy ją z danych - i dlatego
    // liczba stoi NA SŁUPKU wraz z jednostką („pkt"). Bez niej 40 punktów przy
    // osi dociągniętej do maksimum czytałoby się jak słupek prawie pełny;
    // z nią czytelnik ma wartość wprost, a nie z długości.
    expect(config.showValues).toBe(true);
    expect(config.unit).toBe(realT("pl")("adminAnalytics.ga4.radar.unit"));
  });

  it("słupki zaangażowania bez raportu pokazują zera, nie NaN", async () => {
    respondWith({ ...FULL, engagement: report([], { totals: [] }) });
    panel();
    await loaded();

    const s = seriesOf(configOf("adminAnalytics.ga4.charts.engagementTitle"));
    const values = numList(s[0].values);
    expect(values).toEqual([100, 0, 0, 0, 0]);
    expect(values.some(Number.isNaN)).toBe(false);
  });

  it("rank stron idzie malejąco od góry i niesie PEŁNE adresy, nie ucięte etykiety", async () => {
    panel();
    await loaded();

    const o = configOf("adminAnalytics.ga4.charts.topPagesTitle");
    expect(LONG_PATH.length).toBeGreaterThan(40);
    // Najmocniejsza strona jest PIERWSZA: silnik rysuje kategorie od góry
    // w kolejności tablicy, więc ranking czyta się z góry na dół.
    expect(o.categories).toEqual([LONG_PATH, "/o-nas", "/kontakt"]);
    expect(numList(seriesOf(o)[0].values)).toEqual([120, 40, 10]);
    // ADRES W CAŁOŚCI, a nie ucięty do 40 znaków. Przycinanie należy do
    // renderu etykiet osi; wpisane do danych szło tą samą drogą do tabeli
    // danych i do eksportu, gdzie ucięty adres prowadzi na 404.
    expect(o.categories[0]).toBe(LONG_PATH);
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

    const labels = configOf("adminAnalytics.ga4.charts.topPagesTitle").categories;
    expect(labels).toHaveLength(15);
    expect(labels[0]).toBe("/strona-18");
    expect(labels[14]).toBe("/strona-04");
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

    const s = seriesOf(configOf("adminAnalytics.ga4.charts.trendTitle"));
    expect(numList(s[2].values)).toEqual([0, 60]);
    expect(numList(s[2].values).some(Number.isNaN)).toBe(false);
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

    expect(configOf("adminAnalytics.ga4.charts.trendTitle").categories).toEqual([
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
    expect(slices(configOf("adminAnalytics.ga4.charts.countriesTitle")).map((d) => d.name)).toEqual(
      ["?", "Germany"],
    );
    expect(configOf("adminAnalytics.ga4.charts.topPagesTitle").categories).toEqual(["/"]);
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
    expect(configOf("adminAnalytics.ga4.charts.trendTitle").categories).toEqual([]);
    expect(slices(configOf("adminAnalytics.ga4.charts.sourcesTitle"))).toEqual([]);
    expect(configOf("adminAnalytics.ga4.charts.topPagesTitle").categories).toEqual([]);
  });

  it("raport z `configured: false` mówi o braku dostępu, a nie o zerze ruchu", async () => {
    // PILNUJE PRZYPADKU POŚREDNIEGO, najgroźniejszego z całej czwórki stanów.
    // `runGa4Report` oddaje `EMPTY_GA4_REPORT` (czyli `configured: false`, BEZ
    // pola `error`), gdy zabraknie property albo gdy odświeżenie tokenu Google
    // padnie w locie - a prop `configured` pochodzi ze statusu liczonego z ENV
    // i jest wtedy nadal `true`. Panel czyta pole `configured` Z ODPOWIEDZI,
    // bo „nie mam dostępu do właściwości" wymaga interwencji admina, a
    // „właściwość nie miała ruchu" nie wymaga niczego - a siatka zer pokazywała
    // oba stany identycznie.
    respondWith(NOT_CONFIGURED_ON_SERVER);
    const { container } = panel();
    await waitFor(() => expect(h.runReport.mock.calls.length).toBeGreaterThanOrEqual(7));

    await waitFor(() =>
      expect(container.textContent ?? "").toContain(
        realT("pl")("adminAnalytics.ga4.notConfiguredPre"),
      ),
    );
    // Komunikat WYPIERA wykresy - inaczej zera stałyby obok ostrzeżenia.
    expect(document.querySelectorAll("figure.neh-chart")).toHaveLength(0);
  });

  it("przy zerze ruchu panel mówi „brak danych w oknie”, a nie tylko rysuje zera", async () => {
    // PILNUJE NAZWANIA ZMIERZONEGO ZERA. `adminAnalytics.common.noDataWindow`
    // znaczy w tym module dokładnie „okno odczytane, po prostu bez zdarzeń" -
    // i tylko w tym jednym stanie siatka zer jest prawdą. Bez tego napisu
    // właściwość bez ani jednej sesji wygląda identycznie jak taka, której dane
    // nie dojechały, choć pierwsza nie wymaga żadnej interwencji.
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
      categoryIndex: 1,
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

    await clickChart(chartOf("adminAnalytics.ga4.charts.trendTitle"), { categoryIndex: 99 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wskazanie BEZ kategorii - rozkład, który nie wskazuje wiersza - nie otwiera okna", async () => {
    panel();
    await loaded();

    // Kontrakt wskazania dopuszcza `categoryIndex: null`: tak wygląda wskazanie
    // na rodzajach, które nie mają czego wskazać (histogram, boxplot,
    // beeswarm), i tak wygląda wyczyszczenie zaznaczenia. Bez bramki panel
    // otwierałby okno z danymi PIERWSZEGO dnia okna.
    await clickChart(chartOf("adminAnalytics.ga4.charts.trendTitle"), {
      categoryIndex: null,
      seriesName: realT("pl")("adminAnalytics.ga4.sessions"),
    });
    await clickChart(chartOf("adminAnalytics.ga4.charts.topPagesTitle"), {
      categoryIndex: null,
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie poza słupkami rankingu nie otwiera pustego okna", async () => {
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.topPagesTitle"), { categoryIndex: 42 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie wycinka donuta pokazuje sesje i udział liczony z CAŁEGO raportu", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.sourcesTitle"), {
      category: "google",
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

  it("wskazanie wycinka niesie NAZWĘ i WARTOŚĆ - jedno bez drugiego nie otwiera okna", async () => {
    panel();
    await loaded();

    // Silnik oddaje wskazanie tarczy zawsze w komplecie: kategoria plus
    // wartość. Ładunek okrojony - a taki potrafi przyjść z czyszczenia
    // zaznaczenia - musi zgasić drążenie, a nie otworzyć okno z tytułem
    // „undefined" albo z udziałem policzonym z niczego.
    await clickChart(chartOf("adminAnalytics.ga4.charts.countriesTitle"), {
      category: "Germany",
      value: null,
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await clickChart(chartOf("adminAnalytics.ga4.charts.countriesTitle"), {
      category: "Germany",
      value: 150,
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Germany" })).toBeInTheDocument();
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
      category: "Poland",
      value: 0,
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("0.0%")).toBeInTheDocument();
    expect(dialog.textContent ?? "").not.toContain("NaN");
  });

  it("wskazanie pierścienia bez wartości liczbowej nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(chartOf("adminAnalytics.ga4.charts.countriesTitle"), { category: "legenda" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie słupka rankingu prowadzi do PEŁNEJ ścieżki, nie do skróconej etykiety", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    // Indeks 0 to najmocniejsza strona - ranking jedzie do silnika malejąco.
    await clickChart(chartOf("adminAnalytics.ga4.charts.topPagesTitle"), { categoryIndex: 0 });

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

  it("słupki zaangażowania nie są klikalne - nie ma w nich czego drążyć", async () => {
    panel();
    await loaded();

    expect(chartOf("adminAnalytics.ga4.charts.engagementTitle").onSelect).toBeUndefined();
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

  it("klucz cache niesie warsztat, więc panel B nie maluje ruchu warsztatu A", async () => {
    // PILNUJE IZOLACJI PRZEZ CACHE. `QueryClient` stoi w KORZENIU aplikacji,
    // więc przeżywa przelogowanie do innego warsztatu, a wpisy poprzedniego są
    // jeszcze świeże (`staleTime: 60_000`). Klucz bez identyfikatora warsztatu
    // oddawał je panelowi warsztatu B Z CACHE, bez ani jednego zapytania -
    // wyciek niewidoczny w ruchu sieciowym, widoczny wyłącznie na ekranie.
    // Dlatego klucz niesie `tenantId`, a zapytanie czeka na rozwiązanie
    // warsztatu (`enabled`), zamiast pytać „bez warsztatu".
    //
    // RÓŻNICA WOBEC PIERWOTNEJ ASERCJI: pierwotna montowała oba panele dla TEGO
    // SAMEGO warsztatu, więc wspólny wpis cache był poprawnym trafieniem, a nie
    // wyciekiem - spełnić dałoby się ją tylko przez wyłączenie cache, czyli
    // regres. Tutaj warsztat zmienia się MIĘDZY montowaniami, dokładnie jak
    // w aplikacji, i to jest właściwy kontrakt.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.tenantId = "warsztat-a";
    const first = panel({ client });
    await loaded();
    first.unmount();

    respondWith({
      ...ZERO_TRAFFIC,
      source: report(["sessions"], { rows: [row("beta.example.org", 7)] }),
    });
    const before = h.runReport.mock.calls.length;
    h.tenantId = "warsztat-b";
    const second = panel({ client });
    // DRUGI panel na tym samym kliencie: czekamy na jego własne sześć nazw
    // regionów, a nie na liczbę elementów o roli obrazka - te liczą też
    // wycinki pierścienia OBU paneli naraz.
    await waitFor(() => {
      const nazwy = h.charts.map((c) => c.ariaLabel);
      for (const key of CHART_TITLE_KEYS) expect(nazwy).toContain(regionName("pl", key));
    });

    // Siedem zapytań PONOWNIE: przy wspólnym kluczu panel B nie wysłałby ani
    // jednego i pokazałby ruch warsztatu A.
    await waitFor(() => expect(h.runReport.mock.calls.length).toBe(before + 7));
    await waitFor(() => expect(second.container.textContent ?? "").toContain("beta.example.org"));
    expect(second.container.textContent ?? "").not.toContain("google (150)");
  });
});

describe("Ga4BiDashboard - dostępność", () => {
  it("każdy z sześciu wykresów ma region ARIA nazwany tytułem swojej karty", async () => {
    panel();
    await loaded();

    // NAZWA KAŻDEJ KARTY, a nie LICZBA elementów o roli obrazka: wycinki
    // pierścienia też ją mają (każdy jest osobnym celem tabulacji z własną
    // nazwą), więc suma zależy od liczby kategorii w danych. Tarcza dostaje
    // przy tym rolę „group", bo jej wycinki są fokusowalne - stąd oba zbiory.
    const nazwy = [...screen.getAllByRole("img"), ...screen.getAllByRole("group")].map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    for (const key of CHART_TITLE_KEYS) expect(nazwy).toContain(regionName("pl", key));
    expect(nazwy.filter((n) => n.trim() === "")).toEqual([]);
  });

  it("karta niepodłączonej integracji jest wolna od naruszeń axe", async () => {
    const { container } = panel({ configured: false });

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("panel z danymi nie ma ANI JEDNEGO naruszenia axe - bez wyjątków od reguł", async () => {
    const { container } = panel();
    await loaded();

    // Przebieg BEZ wyłączania czegokolwiek. Wcześniej `button-name` musiała tu
    // być wygaszona, żeby jeden znany defekt (bezimienne wyzwalacze menu
    // eksportu) nie przykrywał wszystkiego innego - kolejności nagłówków,
    // poprawności ARIA i semantyki list. Defekt jest zamknięty, więc wyjątek
    // zniknął: pełny zestaw reguł na pełnym pulpicie.
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("każdy z sześciu wykresów ma tabelę danych i podpowiedź obsługi", async () => {
    // PILNUJE DOSTĘPU DO DANYCH BEZ WZROKU. Sam `role="img"` z tytułem mówi
    // tylko „tu jest wykres X" - treść niesie tabela tych samych liczb, którą
    // silnik rysuje przy KAŻDYM rodzaju, oraz opis obsługi klawiatury wiszący
    // na regionie przez `aria-describedby`. Asercja idzie na OBA końce tego
    // powiązania: wskazany identyfikator musi istnieć w dokumencie, bo sam
    // atrybut bez elementu jest gorszy niż jego brak - czytnik obiecuje opis
    // i milknie.
    panel();
    await loaded();

    for (const key of CHART_TITLE_KEYS) {
      const region = screen.getByLabelText(regionName("pl", key));
      const id = region.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(id), `wiszące aria-describedby: ${key}`).not.toBeNull();
      const wiersze = dataTableOf(key).querySelectorAll("tbody tr");
      expect(wiersze.length, `pusta tabela danych: ${key}`).toBeGreaterThan(0);
    }
  });

  it("pole wyboru okna i przyciski kart mają dostępne nazwy, nie same ikony", async () => {
    // PILNUJE NAZW KONKRETNYCH KONTROLEK. Etykieta „Okno" jest widoczna, ale
    // wyzwalacz Radiksa to `<button role="combobox">` - element
    // NIEETYKIETOWALNY, więc `htmlFor` by go nie nazwał i wiązanie idzie przez
    // `aria-labelledby` na tym samym widocznym napisie. Sześć wyzwalaczy menu
    // eksportu to sama ikona `MoreHorizontal` i nazwę bierze ze słownika, tak
    // samo jak sąsiedni przełącznik pełnego ekranu.
    //
    // RÓŻNICA WOBEC PIERWOTNEJ ASERCJI: tam stało zbiorcze `axeViolations` na
    // całym panelu, czyli to samo, czego pilnuje przypadek wyżej. Tutaj
    // sprawdzamy NAZWY WPROST - agregat nie powiedziałby, KTÓRA kontrolka
    // odzyskała nazwę ani czy nie jest nią przypadkiem tekst wartości.
    const t = realT("pl");
    panel();
    await loaded();

    expect(
      screen.getByRole("combobox", { name: t("adminAnalytics.ga4.window") }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: t("adminAnalytics.chartCard.exportMenu") }),
    ).toHaveLength(6);
    expect(
      screen.getAllByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") }),
    ).toHaveLength(6);
  });
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
    const nazwy = [...screen.getAllByRole("img"), ...screen.getAllByRole("group")].map((el) =>
      el.getAttribute("aria-label"),
    );
    for (const key of CHART_TITLE_KEYS) expect(nazwy).toContain(regionName("pl", key));
  });

  it("ten sam panel po EN mówi po angielsku, bez ani jednego polskiego tytułu", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const pl = realT("pl");
    const { container } = panel();
    await loaded("en");

    // REGIONY PO ROLI „img" I „group": silnik daje rysunkom kartezjańskim
    // pierwszą, a tarczy drugą - jej wycinki są fokusowalne, więc rola obrazka
    // uczyniłaby je prezentacyjnymi dla czytnika ekranu.
    const nazwy = [...screen.getAllByRole("img"), ...screen.getAllByRole("group")].map((el) =>
      el.getAttribute("aria-label"),
    );
    for (const key of CHART_TITLE_KEYS) expect(nazwy).toContain(regionName("en", key));
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
    await loaded("en");

    // LEGENDĘ RYSUJE SILNIK Z NAZW SERII, więc dwujęzyczność sprawdza się na
    // nich - osobnej listy `legend.data` po prostu nie ma i nie ma jak jej
    // rozjechać z seriami.
    const trend = configOf("adminAnalytics.ga4.charts.trendTitle", "en");
    expect(seriesOf(trend).map((one) => one.name)).toEqual([
      en("adminAnalytics.ga4.sessions"),
      en("adminAnalytics.ga4.activeUsers"),
      en("adminAnalytics.ga4.views"),
    ]);
    // Nazwy wskaźników są teraz kategoriami słupków, a nie nazwami osi radaru -
    // te same klucze słownika, inne miejsce konfiguracji. Kolejność jest
    // POSORTOWANA po wartości, więc czytamy ją jako zbiór, nie jako listę.
    const engagement = configOf("adminAnalytics.ga4.charts.engagementTitle", "en");
    const categories = engagement.categories;
    expect([...categories].sort()).toEqual(
      [
        en("adminAnalytics.ga4.radar.engagement"),
        en("adminAnalytics.ga4.radar.sessionTime"),
        en("adminAnalytics.ga4.radar.viewsPerSession"),
        en("adminAnalytics.ga4.radar.retention"),
        en("adminAnalytics.ga4.radar.events"),
      ].sort(),
    );
    expect(seriesOf(engagement)[0].values).toEqual([90, 75, 60, 50, 50]);
  });

  it("wycinek „Inne” w donucie jest tłumaczony, a nie zaszyty po polsku", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    panel();
    await loaded("en");

    const data = slices(configOf("adminAnalytics.ga4.charts.sourcesTitle", "en"));
    expect(data[8]).toEqual({ name: en("adminAnalytics.ga4.other"), value: 10 });
    expect(data[8].name).not.toBe(realT("pl")("adminAnalytics.ga4.other"));
  });
});
