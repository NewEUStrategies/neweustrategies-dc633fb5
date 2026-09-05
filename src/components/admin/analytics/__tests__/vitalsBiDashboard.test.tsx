// `VitalsBiDashboard` - pulpit Core Web Vitals: progi, luki w danych, stany
// i izolacja warsztatów.
//
// PO CO. Plik stał na zerze (0/86 linii, 0/37 funkcji). Sama matematyka
// agregatu (`aggregate.ts`) i katalog progów (`vitalsThresholds.ts`) mają już
// pełne pokrycie - TUTAJ przedmiotem dowodu jest to, czego tamte pliki nie
// widzą, a co decyduje o tym, czy administrator patrzy na POMIAR, czy na
// atrapę pomiaru:
//
//   1. PROGI MUSZĄ DOJECHAĆ DO EKRANU. Pasma Good / Needs / Poor na każdym
//      wykresie trendu, linie progowe z podpisami i klasyfikacja w oknie
//      drążenia są budowane z `VITAL_THRESHOLDS`. Wpisana na sztywno liczba
//      albo zamieniona kolejność `if`-ów nie wywraca wykresu - przesuwa
//      granice między „zielono" a „czerwono" przy niezmienionym wyglądzie.
//      Dlatego asercje idą na `VITAL_THRESHOLDS`, a nie na literały.
//   2. ZMYŚLONE ZERO JEST GORSZE NIŻ LUKA. Metryka bez ani jednej próbki ma
//      być pokazana jako brak danych, a nie jako 0 ms - zero na pulpicie
//      wydajności czyta się jako „idealnie", czyli dokładnie odwrotnie niż
//      „nie wiem". Reguła obowiązuje w KAŻDYM nośniku tego samego pomiaru:
//      w kafelku, w iskrze pod nim, na wykresie trendu i w tabeli danych.
//   3. TRZY STANY, JEDEN KOMUNIKAT. „Jeszcze nie wiem", „zapytanie padło" i
//      „w oknie naprawdę nie było ruchu" kończyły się tym samym napisem.
//   4. OKABLOWANIE FILTRA. Zmiana okna ma przestawić WEJŚCIE zapytania
//      (`sinceIso` / `untilIso`), nie tylko etykietę.
//   5. IZOLACJA WARSZTATÓW. Klucz cache niesie NAJEMCĘ obok okna, a zapytanie
//      czeka na jego rozwiązanie. Testy dowodzą tego z trzech stron: świeży
//      klient, klient współdzielony z przesuniętym oknem i klient
//      współdzielony przy PRZEŁĄCZENIU WARSZTATU w tej samej klatce zegara.
//   6. ALTERNATYWA TEKSTOWA. Kanwa ECharts jest dla czytnika ekranu pustym
//      prostokątem, więc każdy wykres musi dostać tabelę tych samych danych
//      powiązaną z regionem przez `aria-describedby`.
//
// ECHARTS JEST TU ZAKAZANY (patrz nagłówek `EChart.tsx`): podmieniamy `EChart`
// atrapą, która PRZECHWYTUJE `option` oraz `onDataClick`. Dzięki temu progi,
// serie i drążenie sprawdzamy na strukturze danych oddanej wykresowi, a nie na
// pikselach - i ~1 MB biblioteki nigdy nie wchodzi do procesu testowego.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { VitalsSummaryResult } from "@/lib/observability/vitals.functions";
import { chartThemeSnapshot } from "../chartTheme";
import type {
  VitalMetricSummary,
  VitalPathRow,
  VitalTrendPoint,
} from "@/lib/observability/aggregate";
import { VITAL_THRESHOLDS, type VitalName } from "@/lib/observability/vitalsThresholds";
import type { AppLang } from "@/lib/i18n/localePath";
import type { ChartClickParams } from "../ChartDrillDialog";

type Opt = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fetchVitals: vi.fn(),
  tenantId: "tenant-rum" as string | null,
  charts: [] as Array<{
    option: Record<string, unknown>;
    onDataClick?: (params: unknown) => void;
  }>,
}));

// Najemca jest ATRAPĄ, a nie prawdziwym `useCurrentTenantId`: tamten ciągnie
// klienta Supabase i sesję `useAuth`, a przedmiotem dowodu jest tylko to, że
// identyfikator warsztatu WCHODZI DO KLUCZA react-query. Sterowanie nim z testu
// (`h.tenantId`) daje jedyny sposób odegrania przejścia między warsztatami na
// TYM SAMYM kliencie cache. Ten sam wzorzec: `gscBiDashboard.test.tsx`.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy.
// Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywracałaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/observability/vitals.functions", () => ({
  getVitalsSummary: (...args: unknown[]) => h.fetchVitals(...args),
}));

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
// dowodu jest to, że napisy przychodzą ZE SŁOWNIKA.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { VitalsBiDashboard } from "../VitalsBiDashboard";

// ---------------------------------------------------------------------------
// Słownik
// ---------------------------------------------------------------------------

function vit(path: string, vars: Record<string, unknown> = {}, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.vitals.${path}`, vars);
}
function vitList(path: string, lang: AppLang = "pl"): string[] {
  return realT(lang)(`adminAnalytics.vitals.${path}`, { returnObjects: true }) as string[];
}
function rating(key: "good" | "needs" | "poor", lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.drillDialog.rating.${key}`);
}
function common(path: string, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.common.${path}`);
}

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

function metric(
  name: VitalName,
  p75: number,
  over: Partial<VitalMetricSummary> = {},
): VitalMetricSummary {
  const [good, poor] = VITAL_THRESHOLDS[name];
  return {
    metric: name,
    count: 100,
    p75,
    p50: p75,
    min: p75,
    max: p75,
    good: 60,
    needsImprovement: 30,
    poor: 10,
    rating: p75 <= good ? "good" : p75 <= poor ? "needs-improvement" : "poor",
    ...over,
  };
}

function path(p: string, total: number, lcp: number | null): VitalPathRow {
  return {
    path: p,
    total,
    metrics:
      lcp === null
        ? []
        : [
            {
              metric: "LCP",
              count: total,
              p75: lcp,
              rating:
                lcp <= VITAL_THRESHOLDS.LCP[0]
                  ? "good"
                  : lcp <= VITAL_THRESHOLDS.LCP[1]
                    ? "needs-improvement"
                    : "poor",
            },
          ],
  };
}

function day(d: string, p75: Partial<Record<VitalName, number>>): VitalTrendPoint {
  return { day: d, p75 };
}

function summary(over: Partial<VitalsSummaryResult> = {}): VitalsSummaryResult {
  const metrics = over.metrics ?? [metric("LCP", 2000)];
  return {
    windowDays: 7,
    total: metrics.reduce((a, m) => a + m.count, 0),
    metrics,
    paths: [],
    trends: [],
    windowTotal: metrics.reduce((a, m) => a + m.count, 0),
    capped: false,
    ...over,
  };
}

/** Wszystkie pięć metryk w strefie Good - baza dla testów struktury panelu. */
const ALL_GOOD = summary({
  metrics: [
    metric("LCP", 2000),
    metric("INP", 150),
    metric("CLS", 0.05),
    metric("FCP", 1500),
    metric("TTFB", 600),
  ],
  paths: [path("/analizy/energia", 300, 2000), path("/o-nas", 120, 1800)],
  trends: [
    day("2026-08-01", { LCP: 2100, INP: 150, CLS: 0.05, FCP: 1500, TTFB: 600 }),
    day("2026-08-02", { LCP: 1900, INP: 140, CLS: 0.04, FCP: 1450, TTFB: 580 }),
  ],
});

/**
 * Raport „warsztatu A" - każda ścieżka jest unikalna, żeby wyciek było widać.
 * LCP celowo w strefie Poor: wtedy ścieżka trafia do listy rekomendacji, czyli
 * do TEKSTU strony, a nie tylko do danych oddanych kanwie.
 */
const WORKSPACE_A = summary({
  metrics: [metric("LCP", 6000)],
  paths: [path("/alfa-analizy/energia-w-regionie", 300, 6000)],
});

/** Raport „warsztatu B" - rozłączny z A na każdym napisie. */
const WORKSPACE_B = summary({
  metrics: [metric("INP", 180)],
  paths: [path("/beta-raporty/klimat", 80, null)],
});

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

function rec(v: unknown): Opt {
  return (v ?? {}) as Opt;
}
function seriesOf(o: Opt): Opt[] {
  return Array.isArray(o.series) ? (o.series as Opt[]) : [];
}
function firstSeries(o: Opt): Opt {
  return seriesOf(o)[0] ?? {};
}
function dataOf(o: Opt): unknown[] {
  const d = firstSeries(o).data;
  return Array.isArray(d) ? d : [];
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map(String) : [];
}

interface Captured {
  option: Opt;
  onDataClick?: (params: unknown) => void;
}

function lastChart(label: string, pred: (o: Opt) => boolean): Captured {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    if (pred(h.charts[i].option)) return h.charts[i];
  }
  throw new Error(`test: nie przechwycono wykresu „${label}”`);
}

const isTrend = (o: Opt) => Boolean(firstSeries(o).markArea);
const isSpark = (o: Opt) => rec(o.xAxis).show === false && firstSeries(o).type === "line";
const isRatingStack = (o: Opt) => seriesOf(o).length === 3 && firstSeries(o).stack === "rating";
const isPie = (o: Opt) => firstSeries(o).type === "pie";
const isTreemap = (o: Opt) => firstSeries(o).type === "treemap";

/** Wykres trendu ROZPOZNANY PO PROGACH - dwie liczby jednoznaczne dla metryki. */
function trendChart(m: VitalName): Captured {
  const [good, poor] = VITAL_THRESHOLDS[m];
  return lastChart(`trend ${m}`, (o) => {
    if (!isTrend(o)) return false;
    const line = rec(firstSeries(o).markLine).data;
    if (!Array.isArray(line)) return false;
    const ys = (line as Array<{ yAxis?: number }>).map((d) => d.yAxis);
    return ys[0] === good && ys[1] === poor;
  });
}

const ratingStack = () => lastChart("ratingi per metryka", isRatingStack);
const pieChart = () => lastChart("rating ogolem", isPie);
const treemap = () => lastChart("treemapa sciezek", isTreemap);
const sparkChart = () => lastChart("iskra KPI", isSpark);

function markAreaBands(o: Opt): Array<Array<{ yAxis?: number | string }>> {
  const data = rec(firstSeries(o).markArea).data;
  return Array.isArray(data) ? (data as Array<Array<{ yAxis?: number | string }>>) : [];
}

function markLineLabels(o: Opt): string[] {
  const data = rec(firstSeries(o).markLine).data;
  if (!Array.isArray(data)) return [];
  return (data as Array<{ label?: { formatter?: string } }>).map((d) => d.label?.formatter ?? "");
}

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

/** Pary [etykieta, wartość] z siatki metryk okna drążenia, w kolejności renderu. */
function drillMetrics(lang: AppLang = "pl"): Array<[string, string]> {
  const dialog = screen.getByRole("dialog");
  const head = within(dialog).getByText(realT(lang)("adminAnalytics.drillDialog.metrics"));
  const grid = head.nextElementSibling;
  if (!grid) throw new Error("test: okno drazenia nie ma siatki metryk");
  return Array.from(grid.children).map((cell) => [
    cell.children[0]?.textContent ?? "",
    cell.children[1]?.textContent ?? "",
  ]);
}

/** Klasa tonu przypisana wartości metryki - kolor jest tu nośnikiem oceny. */
function drillTone(index: number): string {
  const dialog = screen.getByRole("dialog");
  const head = within(dialog).getByText(realT("pl")("adminAnalytics.drillDialog.metrics"));
  const grid = head.nextElementSibling;
  if (!grid) throw new Error("test: okno drazenia nie ma siatki metryk");
  return grid.children[index]?.children[1]?.className ?? "";
}

/** Region wykresu po dostępnej nazwie, którą `ChartCard` buduje z tytułu. */
function chartRegion(title: string): HTMLElement {
  return screen.getByRole("img", {
    name: realT("pl")("adminAnalytics.chartCard.chartRegion", { title }),
  });
}

/** Tabela danych POWIĄZANA z regionem wykresu - alternatywa tekstowa kanwy. */
function dataTableOf(title: string): HTMLElement {
  const region = chartRegion(title);
  const id = region.getAttribute("aria-describedby") ?? "";
  const el = document.getElementById(id);
  if (!el) throw new Error(`test: wykres „${title}” nie ma tabeli danych`);
  return el;
}

function tableHeaders(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
}

function tableRows(table: HTMLElement): string[][] {
  return Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.children).map((cell) => (cell.textContent ?? "").trim()),
  );
}

interface VitalsInput {
  sinceIso: string;
  untilIso: string;
}

function queryInputs(): VitalsInput[] {
  return h.fetchVitals.mock.calls.map((c) => (c[0] as { data: VitalsInput }).data);
}

function spanDays(input: VitalsInput): number {
  return Math.round((Date.parse(input.untilIso) - Date.parse(input.sinceIso)) / 86_400_000);
}

/**
 * Wartość kafelka KPI stojąca przy podanej etykiecie.
 *
 * Etykieta szukana jest przez ROLĘ `term`, którą `KpiTile` nadaje swojemu
 * napisowi, a nie przez sam tekst: nazwa metryki („LCP") stoi dziś także w
 * tabeli danych wykresu ratingów, więc `getByText` miałby dwa trafienia i
 * wywracałby się na niejednoznaczności zamiast mierzyć kafelek.
 */
function kpiValue(label: string): string {
  const terms = screen.getAllByRole("term").filter((el) => (el.textContent ?? "").trim() === label);
  if (terms.length !== 1) {
    throw new Error(`test: kafelek KPI „${label}” ma ${terms.length} etykiet, oczekiwano jednej`);
  }
  const box = terms[0].closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI „${label}”`);
  return box.lastElementChild?.textContent ?? "";
}

function panel(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <VitalsBiDashboard />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Czeka aż raport dojedzie i panel przełączy się z komunikatu na siatkę KPI. */
/**
 * Czeka, aż panel WYJDZIE ZE STANU POMIARU - czyli aż odpowiedź dojedzie.
 *
 * POPRZEDNIA WERSJA TEGO POMOCNIKA BYŁA SKALIBROWANA NA DEFEKCIE i warto to
 * zapisać, bo jest to najbardziej podstępna klasa słabości testu, jaką znalazła
 * ta kampania. Brzmiała: „czekaj, aż zniknie napis `noSamples`". Działała
 * WYŁĄCZNIE dlatego, że panel mieszał trzy stany w jeden komunikat - „Brak
 * próbek RUM" wisiał na ekranie w trakcie pobierania, więc jego zniknięcie
 * PRZYPADKOWO oznaczało nadejście danych.
 *
 * Po naprawie tego zlania (trzy stany, trzy karty) napis nie pojawia się już
 * w trakcie pobierania wcale, więc stary pomocnik przechodził w PIERWSZEJ
 * KLATCE i 47 przypadków mierzyło panel bez danych - przy zielonym liczniku
 * przed naprawą. Innymi słowy: te 47 testów przechodziło DZIĘKI defektowi,
 * którego inny przypadek w tym samym pliku dokumentował jako defekt.
 *
 * Dzisiejsza wersja nie ma tej właściwości, bo bramkuje się na DWÓCH
 * niezależnych sygnałach: że zapytanie w ogóle poszło i że karta pomiaru
 * ustąpiła. Żaden z nich nie jest prawdziwy w pierwszej klatce.
 */
async function loaded(lang: AppLang = "pl"): Promise<void> {
  await waitFor(() => expect(h.fetchVitals).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(common("measuring", lang))).toBeNull());
}

async function settled(): Promise<void> {
  await waitFor(() => expect(h.fetchVitals).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(common("loading"))).toBeNull());
}

/** Kształt poddrzewa słownika: ścieżka -> „leaf" albo „array:N". */
function shape(node: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(node)) {
    out.set(prefix, `array:${node.length}`);
    return out;
  }
  if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      shape(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out.set(prefix, "leaf");
  return out;
}

function subtree(lang: AppLang, segments: string[]): unknown {
  let node: unknown = i18n.getResourceBundle(lang, "translation");
  for (const seg of segments) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.charts.length = 0;
  // Najemca wraca do wartości domyślnej, żeby przypadek przełączający warsztat
  // nie zostawiał swojego identyfikatora następnym.
  h.tenantId = "tenant-rum";
  h.fetchVitals.mockReset();
  h.fetchVitals.mockResolvedValue(ALL_GOOD);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - stany panelu", () => {
  it("w trakcie pobierania pokazuje wskaźnik ładowania i ANI JEDNEGO kafelka", async () => {
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    panel();

    expect(await screen.findByText(common("loading"))).toBeInTheDocument();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it("w trakcie pobierania przycisk odświeżania jest zablokowany i mówi o trwającym odczycie", async () => {
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    panel();

    const btn = await screen.findByRole("button", { name: vit("refreshAria") });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(vit("refreshing"));
  });

  it("w trakcie pomiaru panel NIE twierdzi, że w oknie nie ma próbek RUM", async () => {
    // NAPRAWIONE. `!report || report.total === 0` obsługiwało jednym komunikatem
    // dwa różne stany, więc operator czytający „Brak próbek RUM w wybranym
    // oknie" w pierwszej sekundzie po wejściu dostawał twierdzenie o pomiarze,
    // który się jeszcze nie odbył - wraz z instrukcją („otwórz kilka
    // podstron"), która była wtedy błędna.
    //
    // Dziś panel ma trzy karty na trzy stany. „Brak próbek" jest TWIERDZENIEM
    // O POMIARZE i wolno je postawić dopiero po odczycie.
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    panel();
    await screen.findByText(common("loading"));

    expect(screen.queryByText(vit("noSamples"))).toBeNull();
  });

  it("okno bez próbek pokazuje komunikat ze słownika zamiast siatki zer", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [], total: 0, windowTotal: 0 }));
    panel();

    expect(await screen.findByText(vit("noSamples"))).toBeInTheDocument();
    // Zero próbek to NIE jest wynik 0 ms - żaden kafelek ani wykres nie ma prawa
    // powstać, bo każda liczba na nim byłaby zmyślona.
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
    expect(screen.queryByText("LCP")).toBeNull();
  });

  it("po awarii zapytania pasek narzędzi żyje - operator może zmienić okno i ponowić", async () => {
    h.fetchVitals.mockRejectedValue(new Error("RUM 500: web_vitals read failed"));
    panel();
    await settled();

    expect(screen.getByRole("button", { name: vit("refreshAria") })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset30d") }),
    ).toBeInTheDocument();
  });

  it("awaria zapytania NIE wygląda jak okno bez ruchu - podaje przyczynę", async () => {
    // NAPRAWIONE. `curQ.error` nie był w ogóle czytany, więc panel rysował
    // „Brak próbek RUM…" i podpowiadał, żeby otworzyć kilka podstron - czyli
    // kazał administratorowi szukać problemu po stronie RUCHU tam, gdzie padł
    // odczyt tabeli `web_vitals`. Najgorszy wariant tej pomyłki to odmowa
    // uprawnień: panel zapewniał, że telemetria działa i po prostu nie ma
    // ruchu, w chwili gdy nie miał do niej dostępu.
    //
    // Dziś karta awarii niesie `role="alert"` i PRZYCZYNĘ z wyjątku, a instrukcja
    // dotyczy odczytu, nie ruchu.
    h.fetchVitals.mockRejectedValue(new Error("RUM 500: web_vitals read failed"));
    const { container } = panel();
    await settled();

    expect(container.textContent ?? "").toMatch(/500|b[lł][aą]d|error/i);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - okno czasu i wejście zapytania", () => {
  it("startowe okno to 7 dni i taki zakres trafia do WEJŚCIA funkcji serwerowej", async () => {
    panel();
    await loaded();

    const inputs = queryInputs();
    expect(inputs).toHaveLength(1);
    expect(spanDays(inputs[0])).toBe(7);
    // Oba końce są ISO - walidator server fn wymaga `z.string().datetime()`.
    expect(inputs[0].sinceIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(inputs[0].untilIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("zmiana presetu na 30 dni przestawia WEJŚCIE zapytania, nie tylko etykietę", async () => {
    panel();
    await loaded();
    const before = h.fetchVitals.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset30d") }),
    );

    await waitFor(() => expect(h.fetchVitals.mock.calls.length).toBeGreaterThan(before));
    expect(spanDays(queryInputs()[before])).toBe(30);
  });

  it("„Odśwież” ponawia zapytanie z tym samym oknem", async () => {
    panel();
    await loaded();
    const before = h.fetchVitals.mock.calls.length;
    const windowBefore = queryInputs()[0];

    fireEvent.click(screen.getByRole("button", { name: vit("refreshAria") }));

    await waitFor(() => expect(h.fetchVitals.mock.calls.length).toBe(before + 1));
    expect(queryInputs()[before]).toEqual(windowBefore);
  });

  it("licznik próbek bierze PEŁNE okno, a nie zagregowaną próbkę", async () => {
    // `windowTotal` to dokładny COUNT(*), `total` to liczba wierszy, na których
    // liczono percentyle (przycięta do 20 000). Pomylenie ich zaniża raport.
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [metric("LCP", 2000, { count: 20_000 })],
        windowTotal: 31_337,
        capped: true,
      }),
    );
    panel();
    await loaded();

    expect(
      screen.getByText(vit("samplesInWindow", { count: 31_337 }), { exact: false }),
    ).toBeInTheDocument();
  });

  it("przycięte okno dostaje dopisek o agregacji z najnowszych próbek", async () => {
    h.fetchVitals.mockResolvedValue(summary({ windowTotal: 31_337, capped: true }));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain(vit("cappedNote"));
  });

  it("nieprzycięte okno NIE dostaje dopisku o agregacji", async () => {
    h.fetchVitals.mockResolvedValue(summary({ windowTotal: 200, capped: false }));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toContain(vit("cappedNote"));
  });

  it("po odpowiedzi przycisk odświeżania podpowiada godzinę ostatniego odczytu", async () => {
    panel();
    await loaded();

    const prefix = vit("lastRefresh", { time: "" }).trim();
    const title = screen.getByRole("button", { name: vit("refreshAria") }).getAttribute("title");
    expect(title ?? "").toContain(prefix);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - progi Web Vitals docierają do wykresu", () => {
  it("pasma tła każdej metryki są zbudowane z KANONICZNYCH progów", async () => {
    // Nie z literałów w komponencie: gdyby ktoś wpisał 2500 ręcznie, zmiana
    // progu w `vitalsThresholds.ts` rozjechałaby wykres z oceną w agregacie.
    panel();
    await loaded();

    for (const m of ["LCP", "INP", "CLS", "FCP", "TTFB"] as const) {
      const [good, poor] = VITAL_THRESHOLDS[m];
      const bands = markAreaBands(trendChart(m).option);
      expect(bands.map((b) => [b[0].yAxis, b[1].yAxis])).toEqual([
        [0, good],
        [good, poor],
        [poor, "max"],
      ]);
    }
  });

  it("kolory pasm idą od zielonego przez bursztyn do czerwieni, a nie odwrotnie", async () => {
    panel();
    await loaded();

    const bands = rec(firstSeries(trendChart("LCP").option).markArea).data as Array<
      Array<{ itemStyle?: { color?: string } }>
    >;
    expect(bands.map((b) => b[0].itemStyle?.color)).toEqual(["#16a34a", "#f59e0b", "#dc2626"]);
  });

  it("linie progowe niosą podpis Good/Poor w jednostce tej metryki", async () => {
    // Sekundy dla LCP, milisekundy dla INP, ułamek bez jednostki dla CLS -
    // ta sama liczba w złej jednostce jest gorsza niż jej brak.
    panel();
    await loaded();

    expect(markLineLabels(trendChart("LCP").option)).toEqual(["Good 2.50 s", "Poor 4.00 s"]);
    expect(markLineLabels(trendChart("INP").option)).toEqual(["Good 200 ms", "Poor 500 ms"]);
    expect(markLineLabels(trendChart("CLS").option)).toEqual(["Good 0.100", "Poor 0.250"]);
    expect(markLineLabels(trendChart("TTFB").option)).toEqual(["Good 800 ms", "Poor 1.80 s"]);
  });

  it("oś wartości formatuje jednostkę inaczej dla CLS, sekund i milisekund", async () => {
    panel();
    await loaded();

    const fmtFor = (m: VitalName): ((v: number) => string) => {
      const f = rec(rec(trendChart(m).option.yAxis).axisLabel).formatter;
      if (typeof f !== "function") throw new Error("test: os nie ma formatera");
      return f as (v: number) => string;
    };
    expect(fmtFor("CLS")(0.125)).toBe("0.13");
    expect(fmtFor("LCP")(2500)).toBe("2.5s");
    expect(fmtFor("LCP")(900)).toBe("900ms");
  });

  it("podpowiedź trendu podaje p75 dnia, a dla dnia bez próbki kreskę", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [metric("LCP", 2400)],
        trends: [day("2026-08-01", { LCP: 2400 }), day("2026-08-02", {})],
      }),
    );
    panel();
    await loaded();

    const fmt = tooltipFormatter(trendChart("LCP").option);
    expect(fmt([{ axisValue: "2026-08-01", value: ["2026-08-01", 2400] }])).toBe(
      "2026-08-01<br/>LCP p75: <b>2.40 s</b>",
    );
    // Dzień bez próbki to KRESKA, nie „0 ms".
    expect(fmt([{ axisValue: "2026-08-02", value: ["2026-08-02", null] }])).toBe(
      "2026-08-02<br/>LCP p75: <b>-</b>",
    );
    expect(fmt([])).toBe("");
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - drążenie: ocena wraca do UI z tych samych progów", () => {
  async function drillTrend(m: VitalName, value: number): Promise<void> {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric(m, value)], trends: [day("2026-08-01", { [m]: value })] }),
    );
    panel();
    await loaded();
    await clickChart(trendChart(m), { dataIndex: 0 });
  }

  it("wartość DOKŁADNIE na progu Good jest oceniona jako dobra", async () => {
    const [good] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", good);

    const rows = drillMetrics();
    expect(rows[0]).toEqual(["LCP p75", "2.50 s"]);
    expect(rows[1]).toEqual([rating("good"), "<= 2.50 s"]);
    expect(rows[2]).toEqual([rating("poor"), "> 4.00 s"]);
    expect(rows[3]).toEqual([vit("samplesLabel"), rating("good")]);
    expect(drillTone(0)).toContain("text-emerald");
  });

  it("jedna milisekunda powyżej progu Good to już „do poprawy”", async () => {
    const [good] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", good + 1);

    expect(drillMetrics()[3]).toEqual([vit("samplesLabel"), rating("needs")]);
    expect(drillTone(0)).toContain("text-amber");
  });

  it("wartość DOKŁADNIE na progu Poor to wciąż „do poprawy”, a nie „słabo”", async () => {
    // `val <= poor` - granica należy do strefy ostrzegawczej. Przestawienie
    // tego znaku przesuwa całą interpretację o jeden przedział.
    const [, poor] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", poor);

    expect(drillMetrics()[3]).toEqual([vit("samplesLabel"), rating("needs")]);
  });

  it("wartość powyżej progu Poor jest oceniona jako słaba", async () => {
    const [, poor] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", poor + 1);

    expect(drillMetrics()[3]).toEqual([vit("samplesLabel"), rating("poor")]);
    expect(drillTone(0)).toContain("text-rose");
  });

  it("CLS drąży się w swojej własnej skali, nie w milisekundach", async () => {
    await drillTrend("CLS", 0.4);

    const rows = drillMetrics();
    expect(rows[0]).toEqual(["CLS p75", "0.400"]);
    expect(rows[1]).toEqual([rating("good"), "<= 0.100"]);
    expect(rows[3]).toEqual([vit("samplesLabel"), rating("poor")]);
  });

  it("kliknięcie w dzień BEZ próbki nie otwiera okna z wymyśloną wartością", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [metric("LCP", 2400)],
        trends: [day("2026-08-01", { LCP: 2400 }), day("2026-08-02", {})],
      }),
    );
    panel();
    await loaded();

    await clickChart(trendChart("LCP"), { dataIndex: 1 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie bez indeksu danych nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(trendChart("LCP"), {});

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie w słupek ratingów otwiera liczniki TEJ metryki", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [
          metric("LCP", 2000, { good: 70, needsImprovement: 20, poor: 10 }),
          metric("INP", 900, { good: 1, needsImprovement: 2, poor: 97 }),
        ],
      }),
    );
    panel();
    await loaded();

    // Indeks 1 to INP - kolejność osi idzie z METRIC_ORDER, nie z kolejności
    // wierszy w raporcie, więc pomyłka tutaj podstawia cudze liczby.
    await clickChart(ratingStack(), { dataIndex: 1, seriesName: "Poor" });

    expect(within(screen.getByRole("dialog")).getByText("INP")).toBeInTheDocument();
    expect(drillMetrics()).toEqual([
      [rating("good"), "1"],
      [rating("needs"), "2"],
      [rating("poor"), "97"],
      ["p75", "900 ms"],
    ]);
  });

  it("kliknięcie w słupek spoza zbioru metryk nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(ratingStack(), { dataIndex: 99 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie w słupek BEZ indeksu danych nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(ratingStack(), {});

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie poza nazwaną serią opisuje okno podtytułem karty", async () => {
    // ECharts nie zawsze poda `seriesName` (np. kliknięcie w oś kategorii).
    // Podtytuł musi wtedy dojechać ze słownika, a nie zostać pusty.
    panel();
    await loaded();

    await clickChart(ratingStack(), { dataIndex: 0 });

    expect(
      within(screen.getByRole("dialog")).getByText(vit("ratingsSubtitle")),
    ).toBeInTheDocument();
  });

  it("kliknięcie w kafel treemapy daje PEŁNĄ ścieżkę, próbki i odnośnik", async () => {
    const long = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
    h.fetchVitals.mockResolvedValue(summary({ paths: [path(long, 300, 5000)] }));
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: long, value: 300, lcp: 5000 } });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: long })).toBeInTheDocument();
    expect(drillMetrics()).toEqual([
      [vit("samplesLabel"), "300"],
      ["LCP p75", "5.00 s"],
    ]);
    expect(
      within(dialog).getByRole("link", {
        name: realT("pl")("adminAnalytics.drillDialog.openInNewTab"),
      }),
    ).toHaveAttribute("href", long);
  });

  it("kafel szybkiej ścieżki drąży się w tonie dobrym, średniej - w ostrzegawczym", async () => {
    // Ta sama trójka progów co na wykresie musi dojechać do okna drążenia,
    // inaczej kolor kafla i kolor liczby w oknie mówią dwie różne rzeczy.
    //
    // KOLOR JEST TU MIERZONY OBOK NAPISU, nie zamiast niego. `pathTreemapClick`
    // oddaje `tone`, który `ChartDrillDialog` zamienia na klasę z `TONE_CLS`, i
    // DODATKOWO wyraz oceny w `hint` - sprawdzamy oba kanały, bo rozjazd między
    // nimi (zielona liczba z podpisem „Słabo") byłby gorszy niż brak jednego.
    // Sąsiedni przypadek pilnuje samego istnienia nośnika tekstowego.
    const [good, poor] = VITAL_THRESHOLDS.LCP;
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/szybka", 40, good)] }));
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/szybka", value: 40, lcp: good } });
    expect(drillMetrics()).toEqual([
      [vit("samplesLabel"), "40"],
      ["LCP p75", "2.50 s"],
    ]);
    expect(drillTone(1)).toContain("text-emerald");
    expect(within(screen.getByRole("dialog")).getByText(rating("good"))).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await clickChart(treemap(), { data: { fullPath: "/srednia", value: 40, lcp: poor } });
    expect(drillMetrics()).toEqual([
      [vit("samplesLabel"), "40"],
      ["LCP p75", "4.00 s"],
    ]);
    expect(drillTone(1)).toContain("text-amber");
    expect(within(screen.getByRole("dialog")).getByText(rating("needs"))).toBeInTheDocument();
  });

  it("ocena kafla treemapy ma NOŚNIK TEKSTOWY, nie tylko kolor (WCAG 1.4.1)", async () => {
    // Drążenie TRENDU podaje ocenę napisem („Dobrze" / „Do poprawy" /
    // „Słabo") i dokłada kolor jako wzmocnienie. Drążenie TREEMAPY tego nie
    // robiło: `pathTreemapClick` ustawiał tylko `tone`, więc różnica między
    // ścieżką szybką a wolną dojeżdżała do użytkownika jako zieleń kontra
    // amber i nic więcej. Dla czytnika ekranu oba okna były identyczne, a
    // przy deuteranopii - nieodróżnialne. To naruszenie WCAG 1.4.1 („Use of
    // Color"): informacja nie może być przenoszona samym kolorem.
    //
    // Dziś wiersz „LCP p75" niesie `hint` z `drillDialog.rating.*`, czyli
    // z TEGO SAMEGO zestawu kluczy co bliźniaczy `buildTrendClick` - jedno
    // okno nie ma prawa nazywać tej samej oceny dwoma słownikami.
    const [, poor] = VITAL_THRESHOLDS.LCP;
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/srednia", 40, poor)] }));
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/srednia", value: 40, lcp: poor } });

    // Ocena „Do poprawy" musi być gdziekolwiek w oknie jako TEKST.
    expect(within(screen.getByRole("dialog")).getByText(rating("needs"))).toBeInTheDocument();
  });

  it("kafel BEZ ani jednej próbki LCP nie dostaje wyrazu oceny", async () => {
    // `hint` jest oceną POMIARU - ścieżka bez próbek LCP nie ma czego ocenić,
    // a wpisany tam wyraz byłby zmyśleniem. Kreska i ton neutralny mówią
    // „nie wiem"; „Dobrze" mówiłoby „szybko".
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/bez-lcp", 40, null)] }));
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/bez-lcp", value: 40, lcp: 0 } });

    const dialog = screen.getByRole("dialog");
    expect(drillMetrics()[1]).toEqual(["LCP p75", "-"]);
    for (const key of ["good", "needs", "poor"] as const) {
      expect(within(dialog).queryByText(rating(key))).toBeNull();
    }
  });

  it("kafel bez liczby próbek pokazuje zero, a nie puste pole", async () => {
    // `value` i `lcp` przychodzą z danych serii - kafel zbudowany ze ścieżki
    // bez metryk nie ma ich wcale. Puste pole w oknie drążenia wygląda jak
    // błąd renderu, zero mówi wprost „tyle zebrano".
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/pusta" } });

    expect(drillMetrics()).toEqual([
      [vit("samplesLabel"), "0"],
      ["LCP p75", "-"],
    ]);
  });

  it("kafel bez ścieżki nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(treemap(), { data: { value: 10 } });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - metryka bez próbek to LUKA, nie zero", () => {
  const ONLY_LCP = summary({
    metrics: [metric("LCP", 2400)],
    trends: [
      day("2026-08-01", { LCP: 2400 }),
      day("2026-08-02", {}),
      day("2026-08-03", { LCP: 2600 }),
    ],
  });

  it("metryka nieobecna w raporcie pokazuje KRESKĘ, a nie „0 ms”", async () => {
    // Zero na pulpicie wydajności czyta się jako „idealnie". Metryka, której
    // przeglądarki nie zaraportowały (np. INP bez interakcji), musi wyglądać
    // jak brak pomiaru.
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    expect(kpiValue("LCP")).toBe("2.40 s");
    for (const missing of ["INP", "CLS", "FCP", "TTFB"]) {
      expect(kpiValue(missing)).toBe("-");
      expect(kpiValue(missing)).not.toBe("0 ms");
    }
  });

  it("metryka bez próbek nie dostaje ani wykresu trendu, ani słupka ratingów", async () => {
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    expect(strList(rec(ratingStack().option.xAxis).data)).toEqual(["LCP"]);
    expect(() => trendChart("INP")).toThrow();
  });

  it("wykres trendu zostawia dzień bez próbki jako LUKĘ i łączy przez nią linie", async () => {
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    const o = trendChart("LCP").option;
    expect(strList(rec(o.xAxis).data)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(firstSeries(o).data).toEqual([2400, null, 2600]);
    expect(firstSeries(o).connectNulls).toBe(true);
  });

  it("iskra przy kafelku KPI POMIJA dzień bez próbki, a nie wstawia za niego zera", async () => {
    // NAPRAWIONE. `sparkForMetric` robiło `t.p75[metric] ?? 0`, podczas gdy
    // wykres trendu - z tego samego raportu i tego samego pola - robi `?? null`.
    // Skutek był taki, że miniatura pod kafelkiem LCP NURKOWAŁA DO ZERA w dniu,
    // w którym po prostu nie było ani jednej próbki, i pokazywała spadek czasu
    // ładowania do zera jako sukces. `filter(Number.isFinite)` tego nie ratował,
    // bo zero jest liczbą skończoną - odsiew musi iść po TYPIE, nie po wartości.
    //
    // Dziś dzień bez pomiaru WYPADA z serii. `KpiTileProps.series` przyjmuje
    // `number[]`, więc luki nie da się w niej wyrazić inaczej niż pominięciem
    // punktu - i to jest poprawne, bo iskra jest wskaźnikiem KSZTAŁTU, nie
    // datowanym wykresem. Sąsiedni przypadek pilnuje drugiej połowy tej samej
    // reguły: duży wykres trendu zostawia lukę JAWNIE, przez `null`
    // i `connectNulls`, bo tam oś X jest datowana i pominięcie punktu
    // przesunęłoby daty.
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    expect(firstSeries(sparkChart().option).data).toEqual([2400, 2600]);
  });

  it("ścieżka bez pomiaru LCP dostaje neutralny kolor, a nie zielony", async () => {
    // `colorFor(0)` musi dać slate. Zielony oznaczałby „szybko" na ścieżce,
    // której nikt nie zmierzył.
    h.fetchVitals.mockResolvedValue(
      summary({
        paths: [
          path("/bez-lcp", 40, null),
          path("/szybka", 40, 2000),
          path("/srednia", 40, 3000),
          path("/wolna", 40, 5000),
        ],
      }),
    );
    panel();
    await loaded();

    const cells = dataOf(treemap().option) as Array<{
      name: string;
      itemStyle: { color: string };
    }>;
    const theme = chartThemeSnapshot();
    expect(cells.map((c) => c.itemStyle.color)).toEqual([
      theme.muted,
      theme.success,
      theme.warning,
      theme.danger,
    ]);
  });

  it("podpowiedź treemapy dla ścieżki bez LCP pokazuje kreskę", async () => {
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/bez-lcp", 40, null)] }));
    panel();
    await loaded();

    const fmt = tooltipFormatter(treemap().option);
    expect(fmt({ name: "/bez-lcp", value: 40, data: { lcp: 0 } })).toBe(
      `/bez-lcp<br/>${vit("samplesLabel")}: <b>40</b><br/>LCP p75: -`,
    );
    expect(fmt({ name: "/z-lcp", value: 40, data: { lcp: 2000 } })).toContain("LCP p75: 2.00 s");
  });

  it("drążenie ścieżki bez LCP pokazuje kreskę w tonie neutralnym", async () => {
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/bez-lcp", 40, null)] }));
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/bez-lcp", value: 40, lcp: 0 } });

    expect(drillMetrics()[1]).toEqual(["LCP p75", "-"]);
    expect(drillTone(1)).toContain("text-foreground");
  });

  it("p75 spoza zakresu liczb pokazuje kreskę, a nie „NaN”", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric("LCP", Number.NaN, { count: 3 })], total: 3 }),
    );
    panel();
    await loaded();

    expect(kpiValue("LCP")).toBe("-");
    expect(document.body.textContent ?? "").not.toContain("NaN");
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - agregaty panelu", () => {
  it("koło ratingów sumuje WSZYSTKIE metryki, a nie tylko pierwszą", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [
          metric("LCP", 2000, { good: 10, needsImprovement: 2, poor: 1 }),
          metric("INP", 150, { good: 5, needsImprovement: 3, poor: 4 }),
        ],
      }),
    );
    panel();
    await loaded();

    const slices = dataOf(pieChart().option) as Array<{ name: string; value: number }>;
    expect(slices).toEqual([
      { name: "Good", value: 15, itemStyle: { color: "#16a34a" } },
      { name: "Needs improvement", value: 5, itemStyle: { color: "#f59e0b" } },
      { name: "Poor", value: 5, itemStyle: { color: "#dc2626" } },
    ]);
    // Etykieta w środku koła to suma trzech kubełków, ze słowem ze słownika.
    expect(String(rec(firstSeries(pieChart().option).label).formatter)).toBe(
      `{a|25}\n{b|${vit("samplesWord")}}`,
    );
  });

  it("oś słupków ratingów idzie kolejnością METRIC_ORDER, nie kolejnością raportu", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric("TTFB", 600), metric("LCP", 2000), metric("CLS", 0.05)] }),
    );
    panel();
    await loaded();

    expect(strList(rec(ratingStack().option.xAxis).data)).toEqual(["LCP", "CLS", "TTFB"]);
  });

  it("treemapa skraca długie ścieżki na etykiecie, ale zachowuje pełną w danych", async () => {
    const long = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
    h.fetchVitals.mockResolvedValue(summary({ paths: [path(long, 300, 2000)] }));
    panel();
    await loaded();

    const cells = dataOf(treemap().option) as Array<{
      name: string;
      value: number;
      fullPath: string;
    }>;
    expect(cells[0].name).toBe(long.slice(0, 26) + "…");
    expect(cells[0].name).toHaveLength(27);
    // Skrócenie jest TYLKO na etykiecie - drążenie musi znać pełną ścieżkę.
    expect(cells[0].fullPath).toBe(long);
    expect(cells[0].value).toBe(300);
  });

  it("treemapa przycina się do 25 ścieżek", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => path(`/sciezka-${i}`, 100 - i, 2000));
    h.fetchVitals.mockResolvedValue(summary({ paths }));
    panel();
    await loaded();

    expect(dataOf(treemap().option)).toHaveLength(25);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - interpretacja i rekomendacje", () => {
  it("wszystkie metryki w strefie Good kończą się kartą „bez znalezisk”", async () => {
    panel();
    await loaded();

    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
    expect(screen.getByText(vit("allGoodDetail"))).toBeInTheDocument();
  });

  it("metryka w strefie Poor dostaje playbook tej metryki, a nie ogólnik", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [metric("LCP", 6000)] }));
    panel();
    await loaded();

    expect(screen.getByText(vit("playbook.LCP.poor.title"))).toBeInTheDocument();
    for (const fix of vitList("playbook.LCP.poor.fixes")) {
      expect(screen.getByText(fix)).toBeInTheDocument();
    }
    // Playbook strefy ostrzegawczej NIE ma prawa się pokazać obok.
    expect(screen.queryByText(vit("playbook.LCP.ni.title"))).toBeNull();
  });

  it("metryka w strefie ostrzegawczej dostaje playbook „ni” i podsumowanie liczbowe", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [metric("LCP", 3000, { count: 100, good: 60, needsImprovement: 30, poor: 10 })],
      }),
    );
    panel();
    await loaded();

    expect(screen.getByText(vit("playbook.LCP.ni.title"))).toBeInTheDocument();
    expect(
      screen.getByText(
        vit("globalDetail", { p75: "3.00 s", good: 60, ni: 30, poor: 10, count: 100 }),
      ),
    ).toBeInTheDocument();
  });

  it("ścieżka w strefie Poor dostaje własne znalezisko z progiem ze słownika progów", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric("LCP", 2000)], paths: [path("/wolna-podstrona", 90, 6000)] }),
    );
    panel();
    await loaded();

    expect(
      screen.getByText(
        vit("pathTitle", { metric: "LCP", path: "/wolna-podstrona", value: "6.00 s" }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(vit("pathDetail", { total: 90, threshold: "4.00 s" })),
    ).toBeInTheDocument();
  });

  it("ścieżka jedynie „do poprawy” NIE zasmieca listy - per ścieżkę liczy się tylko Poor", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric("LCP", 2000)], paths: [path("/srednia-podstrona", 90, 3000)] }),
    );
    panel();
    await loaded();

    // Ścieżka stoi dziś w tabeli danych treemapy (alternatywa tekstowa kanwy),
    // czyli legalnie - i to nie o nią tu idzie. Negatywna asercja dotyczy KARTY
    // REKOMENDACJI: lista działań nie ma prawa jej wciągnąć, bo tylko „poor"
    // zasługuje na wniosek per ścieżka.
    const card = screen.getByText(vit("allGood")).closest("div.p-4");
    if (!card) throw new Error("test: nie znaleziono karty rekomendacji");
    expect(within(card as HTMLElement).queryByText(/\/srednia-podstrona/)).toBeNull();
    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - izolacja warsztatów", () => {
  it("panel warsztatu B pokazuje WYŁĄCZNIE ścieżki warsztatu B", async () => {
    h.fetchVitals.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toContain("alfa");
    // Ścieżki jadą także do kanwy - wyciek może siedzieć w samych danych.
    expect(JSON.stringify(h.charts)).not.toContain("alfa");
    expect(JSON.stringify(h.charts)).toContain("/beta-raporty/klimat");
  });

  it("bez rozwiązanego warsztatu panel nie odpytuje serwera, a klucz cache niesie PUSTY warsztat", async () => {
    // Warsztat rozwiązuje się ASYNCHRONICZNIE (profil plus sesja), więc
    // pierwsze klatki panelu widzą `null`. Bramka jest wtedy PODWÓJNA i ten
    // przypadek pilnuje obu jej połówek naraz.
    //
    // `enabled: Boolean(tenantId)` wstrzymuje odczyt - inaczej odpowiedź
    // wpadłaby do cache pod kluczem WSPÓLNYM dla wszystkich warsztatów, a
    // izolację trzymałby wyłącznie znacznik `Date.now()` z granic okna, czyli
    // dokładnie ten sam mechanizm, który przypadek niżej pokazuje jako
    // niewystarczający. `tenantId ?? ""` trzyma ten wpis ROZŁĄCZNIE z każdym
    // realnym warsztatem: react-query hashuje klucz przez `JSON.stringify`,
    // a `undefined` w tablicy serializuje się do `null`, więc bez tej wartości
    // domyślnej stan „warsztatu jeszcze nie znam" zlewałby się z innymi.
    h.tenantId = null;
    const { queryClient } = panel();
    await screen.findByText(common("measuring"));

    expect(h.fetchVitals).not.toHaveBeenCalled();
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((cached) => cached.queryKey);
    expect(keys).toHaveLength(1);
    expect(keys[0].slice(0, 3)).toEqual(["vitals-bi", "", "7d"]);
    // Nierozwiązany warsztat to POMIAR W TOKU, a nie „brak próbek RUM":
    // ten drugi komunikat jest twierdzeniem o oknie, którego nikt nie zmierzył.
    expect(screen.queryByText(vit("noSamples"))).toBeNull();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it("świeży klient react-query nie przenosi raportu między warsztatami", async () => {
    h.fetchVitals.mockResolvedValue(WORKSPACE_A);
    const first = panel();
    await loaded();
    expect(JSON.stringify(h.charts)).toContain("/alfa-analizy");
    first.unmount();
    h.charts.length = 0;

    h.fetchVitals.mockResolvedValue(WORKSPACE_B);
    const second = panel();
    await loaded();

    expect(second.container.textContent ?? "").not.toContain("alfa");
    expect(JSON.stringify(h.charts)).not.toContain("alfa");
  });

  it("współdzielony klient odświeża raport, gdy okno przesunęło się w czasie", async () => {
    // Klucz cache niesie granice okna, więc panel otwarty minutę później ma
    // INNY klucz i realnie odpytuje serwer zamiast malować poprzedni raport.
    const clock = vi.spyOn(Date, "now");
    const t0 = Date.parse("2026-08-20T10:00:00.000Z");
    clock.mockReturnValue(t0);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.fetchVitals.mockResolvedValue(WORKSPACE_A);
    const first = panel(client);
    await loaded();
    first.unmount();
    h.charts.length = 0;

    clock.mockReturnValue(t0 + 60_000);
    h.fetchVitals.mockResolvedValue(WORKSPACE_B);
    const second = panel(client);
    await loaded();

    expect(h.fetchVitals.mock.calls.length).toBe(2);
    expect(second.container.textContent ?? "").not.toContain("alfa");
    expect(JSON.stringify(h.charts)).not.toContain("alfa");
  });

  it("PRZEŁĄCZENIE WARSZTATU w tej samej klatce zegara nie dzieli jednego raportu", async () => {
    // `queryKey: ["vitals-bi", presetId, sinceIso, untilIso]` nie zawierał ani
    // tenanta, ani użytkownika. Izolację trzymał wtedy WYŁĄCZNIE znacznik
    // czasu: `buildPresetRange` woła `Date.now()` przy montowaniu, więc dwa
    // montowania prawie zawsze dawały różne granice okna. „Prawie" nie jest
    // gwarancją izolacji - wystarczyło, że oba panele policzyły to samo okno
    // (zegar zamrożony poniżej modeluje przełączenie warsztatu w tej samej
    // klatce), a przy `staleTime: 60_000` react-query NIE ponawia zapytania i
    // administrator warsztatu B widział ścieżki warsztatu A. Wyciek był cichy:
    // nie leciało przy nim ani jedno żądanie sieciowe.
    //
    // Dziś w kluczu stoi najemca, więc przy zamrożonym zegarze rozróżnia
    // panele TYLKO on - i to jest tu przedmiotem dowodu. Dowód jest
    // dwuczłonowy: brak napisów warsztatu A ORAZ drugi realny odczyt, bo bez
    // tego drugiego członu ten sam zielony wynik dałby panel, który po prostu
    // nic nie pokazuje.
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(Date.parse("2026-08-20T10:00:00.000Z"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.tenantId = "warsztat-a";
    h.fetchVitals.mockResolvedValue(WORKSPACE_A);
    const first = panel(client);
    await loaded();
    expect(JSON.stringify(h.charts)).toContain("/alfa-analizy");
    first.unmount();
    h.charts.length = 0;

    h.tenantId = "warsztat-b";
    h.fetchVitals.mockResolvedValue(WORKSPACE_B);
    const second = panel(client);
    await loaded();

    expect(h.fetchVitals.mock.calls.length).toBe(2);
    expect(second.container.textContent ?? "").not.toContain("alfa");
    expect(JSON.stringify(h.charts)).not.toContain("alfa");
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - raport z niepełną metryką", () => {
  // Odpowiedź funkcji serwerowej NIE JEST po stronie klienta walidowana:
  // `useServerFn` oddaje sparsowany JSON tak, jak przyszedł, a `curQ.data`
  // dostaje typ z sygnatury, nie z pomiaru. Kubełki ocen mają w panelu
  // strażnika `?? 0` w DWÓCH miejscach naraz (słupki i tabela danych pod nimi)
  // i to jest jawne przyznanie, że wiersz metryki bywa niepełny: sam agregat
  // `aggregate.ts` liczy je zawsze, ale `getVitalsSummary` podmienia część
  // raportu wierszami z RPC `web_vitals_daily_p75` przepuszczonymi przez
  // rzutowanie, a kolumna bez wartości przychodzi z Postgresa jako `null`.
  //
  // Ten blok pilnuje, żeby strażnik został i żeby OBA nośniki tej samej liczby
  // - kanwa i tabela - mówiły to samo. Bez niego pulpit wydajności wypisuje
  // `undefined` w tabeli i wywraca skalę słupków.
  const NULL_BUCKETS = {
    windowDays: 7,
    total: 100,
    windowTotal: 100,
    capped: false,
    metrics: [
      { metric: "LCP", count: 100, p75: 2000, p50: 2000, min: 2000, max: 2000, rating: "good" },
    ],
    paths: [],
    trends: [],
  };

  it("wiersz metryki bez kubełków daje ZERA na słupkach ratingów, a nie luki w serii", async () => {
    h.fetchVitals.mockResolvedValue(NULL_BUCKETS);
    panel();
    await loaded();

    const series = seriesOf(ratingStack().option);
    expect(series.map((one) => one.name)).toEqual(["Good", "Needs improvement", "Poor"]);
    // `undefined` w `data` ECharts rysuje jako przerwę w stosie, czyli słupek
    // BEZ jednego kubełka - a to wygląda identycznie jak zmierzone zero i
    // rozjeżdża wysokość całej kolumny względem sąsiednich metryk.
    expect(series.map((one) => one.data)).toEqual([[0], [0], [0]]);
  });

  it("tabela danych pod słupkami podaje te same zera co kanwa", async () => {
    // Tabela jest ALTERNATYWĄ TEKSTOWĄ kanwy, więc rozjazd między nią a
    // słupkami czyta osoba niewidząca jako inny pomiar. `undefined` w komórce
    // jedzie dodatkowo do eksportu CSV, gdzie nie da się go już odróżnić od
    // defektu arkusza.
    h.fetchVitals.mockResolvedValue(NULL_BUCKETS);
    panel();
    await loaded();

    const table = dataTableOf(vit("ratingsPerMetric"));
    expect(tableRows(table)).toEqual([["LCP", "0", "0", "0"]]);
  });

  it.fails(
    "DEFEKT: koło ratingów NIE ma strażnika słupków - niepełny wiersz daje „NaN próbek”",
    async () => {
      // PRZYCZYNA. `ratingStackOption` i `ratingStackCsv` czytają kubełki przez
      // `?? 0`, a `ratingTotals` sumuje je GOŁYM dodawaniem:
      // `rows.reduce((acc, m) => acc + m.good, 0)`. Jedno brakujące pole zamienia
      // sumę w `NaN`, a `NaN` idzie prosto do etykiety w środku koła
      // (`{a|NaN}`) i do wartości wszystkich trzech wycinków.
      //
      // SKUTEK W PRODUKCIE. Ten sam raport daje na jednym wykresie uczciwe zera,
      // a na sąsiednim napis „NaN próbek" - operator widzi dwa sprzeczne stany
      // tego samego pomiaru obok siebie i nie ma jak rozstrzygnąć, który jest
      // prawdziwy. Komentarz nad `ratingTotals` mówi wprost, że koło i jego
      // tabela „muszą podać te same trzy liczby"; strażnik jest w jednym z
      // trzech miejsc, w których te liczby powstają.
      //
      // NAPRAWA (poza zakresem tej porcji - to zmiana w kodzie produkcyjnym):
      // `acc + (m.good ?? 0)` w każdej z trzech redukcji `ratingTotals`.
      h.fetchVitals.mockResolvedValue(NULL_BUCKETS);
      panel();
      await loaded();

      const label = String(rec(firstSeries(pieChart().option).label).formatter);
      expect(label).toBe(`{a|0}\n{b|${vit("samplesWord")}}`);
    },
  );

  it.fails("DEFEKT: raport bez pola `trends` wywraca CAŁY pulpit", async () => {
    // PRZYCZYNA. `sparkForMetric` woła `report.trends.map(...)` BEZ strażnika,
    // a iskra pod kafelkiem KPI renderuje się PRZED wykresami trendu. Dwa
    // miejsca niżej ten sam odczyt ma już `report?.trends ?? []`
    // (`trendOption`, `trendCsv`), więc panel deklaruje odporność, której
    // faktycznie nie ma: do tych strażników sterowanie nigdy nie dolatuje.
    //
    // SKUTEK W PRODUKCIE. `TypeError: Cannot read properties of undefined
    // (reading 'map')` w trakcie renderu wysadza całą zakładkę
    // `/admin/analytics` do granicy błędu - nie tylko jeden wykres. Zamiast
    // pulpitu z częścią liczb administrator dostaje pustą stronę, i to przy
    // odpowiedzi, która niosła komplet metryk i ścieżek.
    //
    // NAPRAWA (poza zakresem tej porcji): `(report.trends ?? [])` w
    // `sparkForMetric` - dokładnie ten sam strażnik, który stoi już w
    // `trendOption` i `trendCsv`.
    //
    // KONSEKWENCJA DLA POKRYCIA: dopóki ten defekt żyje, gałęzie `?? []` w
    // `trendOption` (linia 150) i `trendCsv` (linia 369) są NIEOSIĄGALNE -
    // render umiera wcześniej. Nie da się ich domknąć testem bez zmiany kodu
    // produkcyjnego i nie należy tego robić rzutowaniem.
    h.fetchVitals.mockResolvedValue({
      windowDays: 7,
      total: 100,
      windowTotal: 100,
      capped: false,
      metrics: [metric("LCP", 2000)],
      paths: [],
    });
    panel();
    await loaded();

    expect(screen.getAllByTestId("echart").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - dostępność", () => {
  it("każdy wykres ma nazwę regionu zbudowaną z tytułu karty", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const names = screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    // Pięć trendów + ratingi + koło + treemapa.
    expect(names).toHaveLength(8);
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: vit("trendTitle", { metric: "LCP" }) }),
    );
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: vit("pathsBySamples") }),
    );
  });

  it("przycisk odświeżania ma dostępną nazwę ze słownika, nie samą ikonę", async () => {
    panel();
    await loaded();

    expect(screen.getByRole("button", { name: vit("refreshAria") })).toBeInTheDocument();
  });

  it("poza nienazwanymi przyciskami panel nie ma innych naruszeń axe", async () => {
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container, { "button-name": { enabled: false } }))).toBe(
      "",
    );
  });

  it("karta braku próbek jest wolna od naruszeń axe", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [], total: 0, windowTotal: 0 }));
    const { container } = panel();
    // `settled()` przed asercją, bo komunikat o braku próbek stoi na ekranie od
    // pierwszej klatki - bez tego odpowiedź zapytania aktualizowałaby stan już
    // w trakcie `axe.run`, poza `act`.
    await settled();
    await screen.findByText(vit("noSamples"));

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("KAŻDY przycisk panelu ma dostępną nazwę, także osiem przycisków menu eksportu", async () => {
    // NAPRAWIONE W KOMPONENCIE WSPÓŁDZIELONYM. `ChartCard` dawał `aria-label`
    // tylko przyciskowi pełnego ekranu, a przycisk menu obok był samą ikoną
    // `MoreHorizontal` - osiem wykresów tego panelu dawało osiem bezimiennych
    // przycisków, przez które chodzi cały eksport PNG i CSV. Dziś wyzwalacz
    // menu nosi `aria-label` ze słownika, więc axe nie zgłasza `button-name`.
    //
    // Ten przypadek zostaje TUTAJ, choć naprawa siedzi w `ChartCard`: liczba
    // wykresów jest własnością TEGO panelu, więc regres polegający na dodaniu
    // dziewiątego wykresu poza `ChartCard` (wprost `EChart` w `Card`, jak robił
    // to pulpit audytorium) zapali się właśnie tu, a nie w teście prymitywu.
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("KAŻDY z ośmiu wykresów ma tekstową alternatywę powiązaną z regionem", async () => {
    // ECharts maluje do kanwy, która dla czytnika ekranu jest pustym
    // prostokątem. `ChartCard` UMIE zbudować tabelę danych z `csv` i podpiąć ją
    // przez `aria-describedby`, ale panel nie podawał `csv` ANI RAZU - cały
    // pulpit wydajności był dla czytnika nieczytelny.
    //
    // Asercja idzie na OBA końce powiązania: region musi mieć
    // `aria-describedby`, a wskazany identyfikator musi istnieć w dokumencie.
    // Sam atrybut bez elementu jest gorszy niż jego brak - czytnik obiecuje
    // opis i milknie.
    panel();
    await loaded();

    const regions = screen.getAllByRole("img");
    expect(regions).toHaveLength(8);
    const withoutText = regions.filter((el) => !el.getAttribute("aria-describedby"));
    expect(withoutText.map((el) => el.getAttribute("aria-label"))).toEqual([]);
    for (const region of regions) {
      const id = region.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(id), `wiszące aria-describedby: ${id}`).not.toBeNull();
    }
    expect(screen.queryByText(realT("pl")("adminAnalytics.chartCard.dataTableMissing"))).toBeNull();
    expect(screen.getAllByText(realT("pl")("adminAnalytics.chartCard.dataTable"))).toHaveLength(8);
  });

  it("tabela trendu podaje p75 W JEDNOSTCE METRYKI, a dzień bez próbki jako kreskę", async () => {
    // Tabela jest jedynym nośnikiem tego pomiaru bez osi z formaterem, więc
    // sama liczba („2100") nie mówi, czy to milisekundy, sekundy, czy
    // bezwymiarowy CLS. Dzień bez próbki musi zostać LUKĄ - podstawione zero
    // rysowałoby czas ładowania spadający do zera, czyli sukces tam, gdzie
    // pomiaru nie było.
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [metric("LCP", 2400)],
        trends: [day("2026-08-01", { LCP: 2400 }), day("2026-08-02", {})],
      }),
    );
    panel();
    await loaded();

    const table = dataTableOf(vit("trendTitle", { metric: "LCP" }));
    expect(tableHeaders(table)).toEqual([
      realT("pl")("adminAnalytics.gsc.csvHeaders.date"),
      "LCP p75",
    ]);
    expect(tableRows(table)).toEqual([
      ["2026-08-01", "2.40 s"],
      ["2026-08-02", "-"],
    ]);
  });

  it("tabela treemapy niesie PEŁNĄ ścieżkę, liczbę próbek i LCP p75", async () => {
    const long = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
    h.fetchVitals.mockResolvedValue(
      summary({ paths: [path(long, 300, 5000), path("/bez-lcp", 40, null)] }),
    );
    panel();
    await loaded();

    const table = dataTableOf(vit("pathsBySamples"));
    expect(tableHeaders(table)).toEqual([vit("scopePath"), vit("samplesLabel"), "LCP p75"]);
    // Etykieta kafla jest przycięta do 26 znaków, tabela - nie: przycięty adres
    // nie identyfikuje podstrony, a tabela jest też materiałem do eksportu.
    expect(tableRows(table)).toEqual([
      [long, "300", "5.00 s"],
      ["/bez-lcp", "40", "-"],
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - dwujęzyczność", () => {
  const TITLE_KEYS = ["ratingsPerMetric", "ratingOverall", "pathsBySamples"] as const;

  it("nagłówki kart i pasek narzędzi mówią po polsku ze słownika", async () => {
    panel();
    await loaded();

    for (const key of TITLE_KEYS) expect(screen.getByText(vit(key))).toBeInTheDocument();
    expect(screen.getByText(vit("trendTitle", { metric: "LCP" }))).toBeInTheDocument();
    expect(
      screen.getByText(vit("samplesInWindow", { count: ALL_GOOD.windowTotal }), { exact: false }),
    ).toBeInTheDocument();
  });

  it("ten sam panel po EN mówi po angielsku, bez ani jednego polskiego nagłówka", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded("en");

    for (const key of TITLE_KEYS) {
      expect(screen.getByText(vit(key, {}, "en"))).toBeInTheDocument();
      expect(screen.queryByText(vit(key, {}, "pl"))).toBeNull();
    }
    expect(screen.getByRole("button", { name: vit("refreshAria", {}, "en") })).toBeInTheDocument();
  });

  it("playbook rekomendacji po EN nie spada na polski fallback", async () => {
    await i18n.changeLanguage("en");
    h.fetchVitals.mockResolvedValue(summary({ metrics: [metric("LCP", 6000)] }));
    panel();
    await loaded("en");

    expect(screen.getByText(vit("playbook.LCP.poor.title", {}, "en"))).toBeInTheDocument();
    expect(screen.queryByText(vit("playbook.LCP.poor.title", {}, "pl"))).toBeNull();
    for (const fix of vitList("playbook.LCP.poor.fixes", "en")) {
      expect(screen.getByText(fix)).toBeInTheDocument();
    }
  });

  it("komunikat o braku próbek istnieje w obu językach i się różni", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [], total: 0, windowTotal: 0 }));
    await i18n.changeLanguage("en");
    panel();

    expect(await screen.findByText(vit("noSamples", {}, "en"))).toBeInTheDocument();
    expect(vit("noSamples", {}, "en")).not.toBe(vit("noSamples", {}, "pl"));
  });

  it("słownik EN ma DOKŁADNIE te same klucze i tak samo długie listy co PL", async () => {
    // Brakujący klucz EN nie wywala aplikacji - cicho spada na polski tekst na
    // angielskim ekranie. Krótsza lista `fixes` gubi jedno działanie naprawcze
    // z playbooka wydajności.
    const pl = shape(subtree("pl", ["adminAnalytics", "vitals"]));
    const en = shape(subtree("en", ["adminAnalytics", "vitals"]));

    expect(pl.size).toBeGreaterThan(40);
    expect(Object.fromEntries(en)).toEqual(Object.fromEntries(pl));
  });
});
