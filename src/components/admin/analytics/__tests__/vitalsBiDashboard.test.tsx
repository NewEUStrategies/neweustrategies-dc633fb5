// `VitalsBiDashboard` - pulpit Core Web Vitals: progi, luki w danych, stany
// i izolacja warsztatow.
//
// PO CO. Plik stal na zerze (0/86 linii, 0/37 funkcji). Sama matematyka
// agregatu (`aggregate.ts`) i katalog progow (`vitalsThresholds.ts`) maja juz
// pelne pokrycie - TUTAJ przedmiotem dowodu jest to, czego tamte pliki nie
// widza, a co decyduje o tym, czy administrator patrzy na POMIAR, czy na
// atrape pomiaru:
//
//   1. PROGI MUSZA DOJECHAC DO EKRANU. Pasma Good / Needs / Poor na kazdym
//      wykresie trendu, linie progowe z podpisami i klasyfikacja w oknie
//      drazenia sa budowane z `VITAL_THRESHOLDS`. Wpisana na sztywno liczba
//      albo zamieniona kolejnosc `if`-ow nie wywraca wykresu - przesuwa
//      granice miedzy „zielono" a „czerwono" przy niezmienionym wygladzie.
//      Dlatego asercje ida na `VITAL_THRESHOLDS`, a nie na literaly.
//   2. ZMYSLONE ZERO JEST GORSZE NIZ LUKA. Metryka bez ani jednej probki ma
//      byc pokazana jako brak danych, a nie jako 0 ms - zero na pulpicie
//      wydajnosci czyta sie jako „idealnie", czyli dokladnie odwrotnie niz
//      „nie wiem". Panel robi to POLOWICZNIE i ta polowa jest tu przypieta
//      `it.fails`.
//   3. TRZY STANY, JEDEN KOMUNIKAT. „Jeszcze nie wiem", „zapytanie padlo" i
//      „w oknie naprawde nie bylo ruchu" konczyly sie tym samym napisem.
//   4. OKABLOWANIE FILTRA. Zmiana okna ma przestawic WEJSCIE zapytania
//      (`sinceIso` / `untilIso`), nie tylko etykiete.
//   5. IZOLACJA WARSZTATOW. Klucz cache niesie wylacznie okno - nie ma w nim
//      ani tenanta, ani uzytkownika. Test dowodzi izolacji przy swiezym
//      kliencie i przypina sytuacje, w ktorej ten brak zaczyna byc widoczny.
//
// ECHARTS JEST TU ZAKAZANY (patrz naglowek `EChart.tsx`): podmieniamy `EChart`
// atrapa, ktora PRZECHWYTUJE `option` oraz `onDataClick`. Dzieki temu progi,
// serie i drazenie sprawdzamy na strukturze danych oddanej wykresowi, a nie na
// pikselach - i ~1 MB biblioteki nigdy nie wchodzi do procesu testowego.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { VitalsSummaryResult } from "@/lib/observability/vitals.functions";
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
  charts: [] as Array<{
    option: Record<string, unknown>;
    onDataClick?: (params: unknown) => void;
  }>,
}));

// `useServerFn` staje sie tozsamoscia - wywolanie idzie prosto do atrapy.
// Mock CZESCIOWY, bo `@/lib/i18n` ciagnie z tego samego pakietu
// `createIsomorphicFn`, a pelna atrapa wywracalaby inicjalizacje slownika.
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

// `react-i18next` NIE JEST atrapowany: panel jest dwujezyczny, a przedmiotem
// dowodu jest to, ze napisy przychodza ZE SLOWNIKA.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { VitalsBiDashboard } from "../VitalsBiDashboard";

// ---------------------------------------------------------------------------
// Slownik
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

/** Wszystkie piec metryk w strefie Good - baza dla testow struktury panelu. */
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
 * Raport „warsztatu A" - kazda sciezka jest unikalna, zeby wyciek bylo widac.
 * LCP celowo w strefie Poor: wtedy sciezka trafia do listy rekomendacji, czyli
 * do TEKSTU strony, a nie tylko do danych oddanych kanwie.
 */
const WORKSPACE_A = summary({
  metrics: [metric("LCP", 6000)],
  paths: [path("/alfa-analizy/energia-w-regionie", 300, 6000)],
});

/** Raport „warsztatu B" - rozlaczny z A na kazdym napisie. */
const WORKSPACE_B = summary({
  metrics: [metric("INP", 180)],
  paths: [path("/beta-raporty/klimat", 80, null)],
});

// ---------------------------------------------------------------------------
// Narzedzia
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

/** Symuluje klikniecie w element wykresu - dokladnie tak, jak robi to ECharts. */
async function clickChart(chart: Captured, params: ChartClickParams): Promise<void> {
  await act(async () => {
    chart.onDataClick?.(params);
  });
}

/** Pary [etykieta, wartosc] z siatki metryk okna drazenia, w kolejnosci renderu. */
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

/** Klasa tonu przypisana wartosci metryki - kolor jest tu nosnikiem oceny. */
function drillTone(index: number): string {
  const dialog = screen.getByRole("dialog");
  const head = within(dialog).getByText(realT("pl")("adminAnalytics.drillDialog.metrics"));
  const grid = head.nextElementSibling;
  if (!grid) throw new Error("test: okno drazenia nie ma siatki metryk");
  return grid.children[index]?.children[1]?.className ?? "";
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

/** Wartosc kafelka KPI stojaca przy podanej etykiecie. */
function kpiValue(label: string): string {
  const box = screen.getByText(label).closest("div.min-w-0");
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

/** Czeka az raport dojedzie i panel przelaczy sie z komunikatu na siatke KPI. */
async function loaded(lang: AppLang = "pl"): Promise<void> {
  await waitFor(() => expect(screen.queryByText(vit("noSamples", {}, lang))).toBeNull());
}

async function settled(): Promise<void> {
  await waitFor(() => expect(h.fetchVitals).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(common("loading"))).toBeNull());
}

/** Ksztalt poddrzewa slownika: sciezka -> „leaf" albo „array:N". */
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
  h.fetchVitals.mockReset();
  h.fetchVitals.mockResolvedValue(ALL_GOOD);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - stany panelu", () => {
  it("w trakcie pobierania pokazuje wskaznik ladowania i ANI JEDNEGO kafelka", async () => {
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    panel();

    expect(await screen.findByText(common("loading"))).toBeInTheDocument();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it("w trakcie pobierania przycisk odswiezania jest zablokowany i mowi o trwajacym odczycie", async () => {
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    panel();

    const btn = await screen.findByRole("button", { name: vit("refreshAria") });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(vit("refreshing"));
  });

  it.fails("DEFEKT: w trakcie ladowania panel twierdzi, ze w oknie NIE MA probek RUM", async () => {
    // `!report || report.total === 0` obsluguje jednym komunikatem dwa rozne
    // stany. Operator czytajacy „Brak probek RUM w wybranym oknie" w pierwszej
    // sekundzie po wejsciu dostaje twierdzenie o pomiarze, ktory sie jeszcze
    // nie odbyl - i instrukcje („otworz kilka podstron"), ktora jest bledna.
    h.fetchVitals.mockImplementation(() => new Promise<VitalsSummaryResult>(() => {}));
    panel();
    await screen.findByText(common("loading"));

    expect(screen.queryByText(vit("noSamples"))).toBeNull();
  });

  it("okno bez probek pokazuje komunikat ze slownika zamiast siatki zer", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [], total: 0, windowTotal: 0 }));
    panel();

    expect(await screen.findByText(vit("noSamples"))).toBeInTheDocument();
    // Zero probek to NIE jest wynik 0 ms - zaden kafelek ani wykres nie ma prawa
    // powstac, bo kazda liczba na nim bylaby zmyslona.
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
    expect(screen.queryByText("LCP")).toBeNull();
  });

  it("po awarii zapytania pasek narzedzi zyje - operator moze zmienic okno i ponowic", async () => {
    h.fetchVitals.mockRejectedValue(new Error("RUM 500: web_vitals read failed"));
    panel();
    await settled();

    expect(screen.getByRole("button", { name: vit("refreshAria") })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset30d") }),
    ).toBeInTheDocument();
  });

  it.fails("DEFEKT: awaria zapytania wyglada DOKLADNIE jak okno bez ruchu", async () => {
    // `curQ.error` nie jest w ogole czytany. Panel rysuje „Brak probek RUM…"
    // i podpowiada, zeby otworzyc kilka podstron - czyli kaze administratorowi
    // szukac problemu po stronie ruchu tam, gdzie padl odczyt tabeli.
    h.fetchVitals.mockRejectedValue(new Error("RUM 500: web_vitals read failed"));
    const { container } = panel();
    await settled();

    expect(container.textContent ?? "").toMatch(/500|b[lł][aą]d|error/i);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - okno czasu i wejscie zapytania", () => {
  it("startowe okno to 7 dni i taki zakres trafia do WEJSCIA funkcji serwerowej", async () => {
    panel();
    await loaded();

    const inputs = queryInputs();
    expect(inputs).toHaveLength(1);
    expect(spanDays(inputs[0])).toBe(7);
    // Oba konce sa ISO - walidator server fn wymaga `z.string().datetime()`.
    expect(inputs[0].sinceIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(inputs[0].untilIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("zmiana presetu na 30 dni przestawia WEJSCIE zapytania, nie tylko etykiete", async () => {
    panel();
    await loaded();
    const before = h.fetchVitals.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset30d") }),
    );

    await waitFor(() => expect(h.fetchVitals.mock.calls.length).toBeGreaterThan(before));
    expect(spanDays(queryInputs()[before])).toBe(30);
  });

  it("„Odswiez” ponawia zapytanie z tym samym oknem", async () => {
    panel();
    await loaded();
    const before = h.fetchVitals.mock.calls.length;
    const windowBefore = queryInputs()[0];

    fireEvent.click(screen.getByRole("button", { name: vit("refreshAria") }));

    await waitFor(() => expect(h.fetchVitals.mock.calls.length).toBe(before + 1));
    expect(queryInputs()[before]).toEqual(windowBefore);
  });

  it("licznik probek bierze PELNE okno, a nie zagregowana probke", async () => {
    // `windowTotal` to dokladny COUNT(*), `total` to liczba wierszy, na ktorych
    // liczono percentyle (przycieta do 20 000). Pomylenie ich zaniza raport.
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

  it("przyciete okno dostaje dopisek o agregacji z najnowszych probek", async () => {
    h.fetchVitals.mockResolvedValue(summary({ windowTotal: 31_337, capped: true }));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain(vit("cappedNote"));
  });

  it("nieprzyciete okno NIE dostaje dopisku o agregacji", async () => {
    h.fetchVitals.mockResolvedValue(summary({ windowTotal: 200, capped: false }));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toContain(vit("cappedNote"));
  });

  it("po odpowiedzi przycisk odswiezania podpowiada godzine ostatniego odczytu", async () => {
    panel();
    await loaded();

    const prefix = vit("lastRefresh", { time: "" }).trim();
    const title = screen.getByRole("button", { name: vit("refreshAria") }).getAttribute("title");
    expect(title ?? "").toContain(prefix);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - progi Web Vitals docieraja do wykresu", () => {
  it("pasma tla kazdej metryki sa zbudowane z KANONICZNYCH progow", async () => {
    // Nie z literalow w komponencie: gdyby ktos wpisal 2500 recznie, zmiana
    // progu w `vitalsThresholds.ts` rozjechalaby wykres z ocena w agregacie.
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

  it("kolory pasm ida od zielonego przez bursztyn do czerwieni, a nie odwrotnie", async () => {
    panel();
    await loaded();

    const bands = rec(firstSeries(trendChart("LCP").option).markArea).data as Array<
      Array<{ itemStyle?: { color?: string } }>
    >;
    expect(bands.map((b) => b[0].itemStyle?.color)).toEqual(["#16a34a", "#f59e0b", "#dc2626"]);
  });

  it("linie progowe niosa podpis Good/Poor w jednostce tej metryki", async () => {
    // Sekundy dla LCP, milisekundy dla INP, ulamek bez jednostki dla CLS -
    // ta sama liczba w zlej jednostce jest gorsza niz jej brak.
    panel();
    await loaded();

    expect(markLineLabels(trendChart("LCP").option)).toEqual(["Good 2.50 s", "Poor 4.00 s"]);
    expect(markLineLabels(trendChart("INP").option)).toEqual(["Good 200 ms", "Poor 500 ms"]);
    expect(markLineLabels(trendChart("CLS").option)).toEqual(["Good 0.100", "Poor 0.250"]);
    expect(markLineLabels(trendChart("TTFB").option)).toEqual(["Good 800 ms", "Poor 1.80 s"]);
  });

  it("os wartosci formatuje jednostke inaczej dla CLS, sekund i milisekund", async () => {
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

  it("podpowiedz trendu podaje p75 dnia, a dla dnia bez probki kreske", async () => {
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
    // Dzien bez probki to KRESKA, nie „0 ms".
    expect(fmt([{ axisValue: "2026-08-02", value: ["2026-08-02", null] }])).toBe(
      "2026-08-02<br/>LCP p75: <b>-</b>",
    );
    expect(fmt([])).toBe("");
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - drazenie: ocena wraca do UI z tych samych progow", () => {
  async function drillTrend(m: VitalName, value: number): Promise<void> {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric(m, value)], trends: [day("2026-08-01", { [m]: value })] }),
    );
    panel();
    await loaded();
    await clickChart(trendChart(m), { dataIndex: 0 });
  }

  it("wartosc DOKLADNIE na progu Good jest oceniona jako dobra", async () => {
    const [good] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", good);

    const rows = drillMetrics();
    expect(rows[0]).toEqual(["LCP p75", "2.50 s"]);
    expect(rows[1]).toEqual([rating("good"), "<= 2.50 s"]);
    expect(rows[2]).toEqual([rating("poor"), "> 4.00 s"]);
    expect(rows[3]).toEqual([vit("samplesLabel"), rating("good")]);
    expect(drillTone(0)).toContain("text-emerald");
  });

  it("jedna milisekunda powyzej progu Good to juz „do poprawy”", async () => {
    const [good] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", good + 1);

    expect(drillMetrics()[3]).toEqual([vit("samplesLabel"), rating("needs")]);
    expect(drillTone(0)).toContain("text-amber");
  });

  it("wartosc DOKLADNIE na progu Poor to wciaz „do poprawy”, a nie „slabo”", async () => {
    // `val <= poor` - granica nalezy do strefy ostrzegawczej. Przestawienie
    // tego znaku przesuwa cala interpretacje o jeden przedzial.
    const [, poor] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", poor);

    expect(drillMetrics()[3]).toEqual([vit("samplesLabel"), rating("needs")]);
  });

  it("wartosc powyzej progu Poor jest oceniona jako slaba", async () => {
    const [, poor] = VITAL_THRESHOLDS.LCP;
    await drillTrend("LCP", poor + 1);

    expect(drillMetrics()[3]).toEqual([vit("samplesLabel"), rating("poor")]);
    expect(drillTone(0)).toContain("text-rose");
  });

  it("CLS drazy sie w swojej wlasnej skali, nie w milisekundach", async () => {
    await drillTrend("CLS", 0.4);

    const rows = drillMetrics();
    expect(rows[0]).toEqual(["CLS p75", "0.400"]);
    expect(rows[1]).toEqual([rating("good"), "<= 0.100"]);
    expect(rows[3]).toEqual([vit("samplesLabel"), rating("poor")]);
  });

  it("klikniecie w dzien BEZ probki nie otwiera okna z wymyslona wartoscia", async () => {
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

  it("klikniecie bez indeksu danych nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(trendChart("LCP"), {});

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("klikniecie w slupek ratingow otwiera liczniki TEJ metryki", async () => {
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

    // Indeks 1 to INP - kolejnosc osi idzie z METRIC_ORDER, nie z kolejnosci
    // wierszy w raporcie, wiec pomylka tutaj podstawia cudze liczby.
    await clickChart(ratingStack(), { dataIndex: 1, seriesName: "Poor" });

    expect(within(screen.getByRole("dialog")).getByText("INP")).toBeInTheDocument();
    expect(drillMetrics()).toEqual([
      [rating("good"), "1"],
      [rating("needs"), "2"],
      [rating("poor"), "97"],
      ["p75", "900 ms"],
    ]);
  });

  it("klikniecie w slupek spoza zbioru metryk nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(ratingStack(), { dataIndex: 99 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("klikniecie w slupek BEZ indeksu danych nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(ratingStack(), {});

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("klikniecie poza nazwana seria opisuje okno podtytulem karty", async () => {
    // ECharts nie zawsze poda `seriesName` (np. klikniecie w os kategorii).
    // Podtytul musi wtedy dojechac ze slownika, a nie zostac pusty.
    panel();
    await loaded();

    await clickChart(ratingStack(), { dataIndex: 0 });

    expect(
      within(screen.getByRole("dialog")).getByText(vit("ratingsSubtitle")),
    ).toBeInTheDocument();
  });

  it("klikniecie w kafel treemapy daje PELNA sciezke, probki i odnosnik", async () => {
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

  it("kafel szybkiej sciezki drazy sie w tonie dobrym, sredniej - w ostrzegawczym", async () => {
    // Ta sama trojka progow co na wykresie musi dojechac do okna drazenia,
    // inaczej kolor kafla i kolor liczby w oknie mowia dwie rozne rzeczy.
    const [good, poor] = VITAL_THRESHOLDS.LCP;
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/szybka", 40, good)] }));
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/szybka", value: 40, lcp: good } });
    expect(drillTone(1)).toContain("text-emerald");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await clickChart(treemap(), { data: { fullPath: "/srednia", value: 40, lcp: poor } });
    expect(drillTone(1)).toContain("text-amber");
  });

  it("kafel bez liczby probek pokazuje zero, a nie puste pole", async () => {
    // `value` i `lcp` przychodza z danych serii - kafel zbudowany ze sciezki
    // bez metryk nie ma ich wcale. Puste pole w oknie drazenia wyglada jak
    // blad renderu, zero mowi wprost „tyle zebrano".
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/pusta" } });

    expect(drillMetrics()).toEqual([
      [vit("samplesLabel"), "0"],
      ["LCP p75", "-"],
    ]);
  });

  it("kafel bez sciezki nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(treemap(), { data: { value: 10 } });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - metryka bez probek to LUKA, nie zero", () => {
  const ONLY_LCP = summary({
    metrics: [metric("LCP", 2400)],
    trends: [
      day("2026-08-01", { LCP: 2400 }),
      day("2026-08-02", {}),
      day("2026-08-03", { LCP: 2600 }),
    ],
  });

  it("metryka nieobecna w raporcie pokazuje KRESKE, a nie „0 ms”", async () => {
    // Zero na pulpicie wydajnosci czyta sie jako „idealnie". Metryka, ktorej
    // przegladarki nie zaraportowaly (np. INP bez interakcji), musi wygladac
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

  it("metryka bez probek nie dostaje ani wykresu trendu, ani slupka ratingow", async () => {
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    expect(strList(rec(ratingStack().option.xAxis).data)).toEqual(["LCP"]);
    expect(() => trendChart("INP")).toThrow();
  });

  it("wykres trendu zostawia dzien bez probki jako LUKE i laczy przez nia linie", async () => {
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    const o = trendChart("LCP").option;
    expect(strList(rec(o.xAxis).data)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(firstSeries(o).data).toEqual([2400, null, 2600]);
    expect(firstSeries(o).connectNulls).toBe(true);
  });

  it.fails("DEFEKT: iskra przy kafelku KPI wstawia 0 za dzien bez probki", async () => {
    // `sparkForMetric` robi `t.p75[metric] ?? 0`, podczas gdy wykres trendu -
    // z tego samego raportu i tego samego pola - robi `?? null`. Skutek:
    // miniatura pod kafelkiem LCP nurkuje do zera w dniu, w ktorym po prostu
    // nie bylo ani jednej probki, i pokazuje spadek czasu ladowania do zera
    // jako sukces. `filter(Number.isFinite)` tego nie ratuje - zero jest
    // liczba skonczona. To jest dokladnie ten przypadek, w ktorym zmyslone
    // zero jest gorsze niz luka.
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    expect(firstSeries(sparkChart().option).data).toEqual([2400, 2600]);
  });

  it("sciezka bez pomiaru LCP dostaje neutralny kolor, a nie zielony", async () => {
    // `colorFor(0)` musi dac slate. Zielony oznaczalby „szybko" na sciezce,
    // ktorej nikt nie zmierzyl.
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
    expect(cells.map((c) => c.itemStyle.color)).toEqual([
      "#64748b",
      "#16a34a",
      "#f59e0b",
      "#dc2626",
    ]);
  });

  it("podpowiedz treemapy dla sciezki bez LCP pokazuje kreske", async () => {
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/bez-lcp", 40, null)] }));
    panel();
    await loaded();

    const fmt = tooltipFormatter(treemap().option);
    expect(fmt({ name: "/bez-lcp", value: 40, data: { lcp: 0 } })).toBe(
      `/bez-lcp<br/>${vit("samplesLabel")}: <b>40</b><br/>LCP p75: -`,
    );
    expect(fmt({ name: "/z-lcp", value: 40, data: { lcp: 2000 } })).toContain("LCP p75: 2.00 s");
  });

  it("drazenie sciezki bez LCP pokazuje kreske w tonie neutralnym", async () => {
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/bez-lcp", 40, null)] }));
    panel();
    await loaded();

    await clickChart(treemap(), { data: { fullPath: "/bez-lcp", value: 40, lcp: 0 } });

    expect(drillMetrics()[1]).toEqual(["LCP p75", "-"]);
    expect(drillTone(1)).toContain("text-foreground");
  });

  it("p75 spoza zakresu liczb pokazuje kreske, a nie „NaN”", async () => {
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
  it("kolo ratingow sumuje WSZYSTKIE metryki, a nie tylko pierwsza", async () => {
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
    // Etykieta w srodku kola to suma trzech kubelkow, ze slowem ze slownika.
    expect(String(rec(firstSeries(pieChart().option).label).formatter)).toBe(
      `{a|25}\n{b|${vit("samplesWord")}}`,
    );
  });

  it("os slupkow ratingow idzie kolejnoscia METRIC_ORDER, nie kolejnoscia raportu", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric("TTFB", 600), metric("LCP", 2000), metric("CLS", 0.05)] }),
    );
    panel();
    await loaded();

    expect(strList(rec(ratingStack().option.xAxis).data)).toEqual(["LCP", "CLS", "TTFB"]);
  });

  it("treemapa skraca dlugie sciezki na etykiecie, ale zachowuje pelna w danych", async () => {
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
    // Skrocenie jest TYLKO na etykiecie - drazenie musi znac pelna sciezke.
    expect(cells[0].fullPath).toBe(long);
    expect(cells[0].value).toBe(300);
  });

  it("treemapa przycina sie do 25 sciezek", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => path(`/sciezka-${i}`, 100 - i, 2000));
    h.fetchVitals.mockResolvedValue(summary({ paths }));
    panel();
    await loaded();

    expect(dataOf(treemap().option)).toHaveLength(25);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - interpretacja i rekomendacje", () => {
  it("wszystkie metryki w strefie Good koncza sie karta „bez znalezisk”", async () => {
    panel();
    await loaded();

    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
    expect(screen.getByText(vit("allGoodDetail"))).toBeInTheDocument();
  });

  it("metryka w strefie Poor dostaje playbook tej metryki, a nie ogolnik", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [metric("LCP", 6000)] }));
    panel();
    await loaded();

    expect(screen.getByText(vit("playbook.LCP.poor.title"))).toBeInTheDocument();
    for (const fix of vitList("playbook.LCP.poor.fixes")) {
      expect(screen.getByText(fix)).toBeInTheDocument();
    }
    // Playbook strefy ostrzegawczej NIE ma prawa sie pokazac obok.
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

  it("sciezka w strefie Poor dostaje wlasne znalezisko z progiem ze slownika progow", async () => {
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

  it("sciezka jedynie „do poprawy” NIE zasmieca listy - per sciezke liczy sie tylko Poor", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric("LCP", 2000)], paths: [path("/srednia-podstrona", 90, 3000)] }),
    );
    panel();
    await loaded();

    expect(screen.queryByText(/\/srednia-podstrona/)).toBeNull();
    expect(screen.getByText(vit("allGood"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - izolacja warsztatow", () => {
  it("panel warsztatu B pokazuje WYLACZNIE sciezki warsztatu B", async () => {
    h.fetchVitals.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toContain("alfa");
    // Sciezki jada takze do kanwy - wyciek moze siedziec w samych danych.
    expect(JSON.stringify(h.charts)).not.toContain("alfa");
    expect(JSON.stringify(h.charts)).toContain("/beta-raporty/klimat");
  });

  it("swiezy klient react-query nie przenosi raportu miedzy warsztatami", async () => {
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

  it("wspoldzielony klient odswieza raport, gdy okno przesunelo sie w czasie", async () => {
    // Klucz cache niesie granice okna, wiec panel otwarty minute pozniej ma
    // INNY klucz i realnie odpytuje serwer zamiast malowac poprzedni raport.
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

  it.fails(
    "DEFEKT: klucz cache nie niesie warsztatu - dwa panele z tym samym oknem dziela jeden raport",
    async () => {
      // `queryKey: ["vitals-bi", presetId, sinceIso, untilIso]` nie zawiera ani
      // tenanta, ani uzytkownika. Dzis chroni to WYLACZNIE znacznik czasu:
      // `buildPresetRange` woła `Date.now()` przy montowaniu, wiec dwa
      // montowania prawie zawsze daja rozne granice okna. „Prawie" nie jest
      // gwarancja izolacji - wystarczy, ze oba panele policza to samo okno
      // (zegar zamrozony ponizej modeluje przelaczenie warsztatu w tej samej
      // klatce), a przy `staleTime: 60_000` react-query NIE ponawia zapytania i
      // administrator warsztatu B widzi sciezki warsztatu A. Wyciek jest cichy:
      // nie leci przy nim ani jedno zadanie sieciowe.
      const clock = vi.spyOn(Date, "now");
      clock.mockReturnValue(Date.parse("2026-08-20T10:00:00.000Z"));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      h.fetchVitals.mockResolvedValue(WORKSPACE_A);
      const first = panel(client);
      await loaded();
      first.unmount();
      h.charts.length = 0;

      h.fetchVitals.mockResolvedValue(WORKSPACE_B);
      const second = panel(client);
      await loaded();

      expect(second.container.textContent ?? "").not.toContain("alfa");
    },
  );
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - dostepnosc", () => {
  it("kazdy wykres ma nazwe regionu zbudowana z tytulu karty", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const names = screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    // Piec trendow + ratingi + kolo + treemapa.
    expect(names).toHaveLength(8);
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: vit("trendTitle", { metric: "LCP" }) }),
    );
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: vit("pathsBySamples") }),
    );
  });

  it("przycisk odswiezania ma dostepna nazwe ze slownika, nie sama ikone", async () => {
    panel();
    await loaded();

    expect(screen.getByRole("button", { name: vit("refreshAria") })).toBeInTheDocument();
  });

  it("poza nienazwanymi przyciskami panel nie ma innych naruszen axe", async () => {
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container, { "button-name": { enabled: false } }))).toBe(
      "",
    );
  });

  it("karta braku probek jest wolna od naruszen axe", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [], total: 0, windowTotal: 0 }));
    const { container } = panel();
    // `settled()` przed asercja, bo komunikat o braku probek stoi na ekranie od
    // pierwszej klatki - bez tego odpowiedz zapytania aktualizowalaby stan juz
    // w trakcie `axe.run`, poza `act`.
    await settled();
    await screen.findByText(vit("noSamples"));

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it.fails("DEFEKT: przyciski „wiecej” na kartach wykresow nie maja dostepnej nazwy", async () => {
    // `ChartCard` daje `aria-label` przyciskowi pelnego ekranu, ale przycisk
    // menu obok to sama ikona `MoreHorizontal`. Osiem wykresow = osiem
    // bezimiennych przyciskow, przez ktore chodzi eksport PNG.
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it.fails("DEFEKT: zaden wykres panelu nie dostaje tekstowej alternatywy", async () => {
    // ECharts maluje do kanwy, ktora dla czytnika ekranu jest pustym
    // prostokatem. `ChartCard` UMIE zbudowac tabele danych z `csv` i podpiac ja
    // przez `aria-describedby` - ten panel nie podaje `csv` ANI RAZU, wiec caly
    // pulpit wydajnosci jest dla czytnika nieczytelny.
    panel();
    await loaded();

    const withoutText = screen
      .getAllByRole("img")
      .filter((el) => !el.getAttribute("aria-describedby"));
    expect(withoutText.map((el) => el.getAttribute("aria-label"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("VitalsBiDashboard - dwujezycznosc", () => {
  const TITLE_KEYS = ["ratingsPerMetric", "ratingOverall", "pathsBySamples"] as const;

  it("naglowki kart i pasek narzedzi mowia po polsku ze slownika", async () => {
    panel();
    await loaded();

    for (const key of TITLE_KEYS) expect(screen.getByText(vit(key))).toBeInTheDocument();
    expect(screen.getByText(vit("trendTitle", { metric: "LCP" }))).toBeInTheDocument();
    expect(
      screen.getByText(vit("samplesInWindow", { count: ALL_GOOD.windowTotal }), { exact: false }),
    ).toBeInTheDocument();
  });

  it("ten sam panel po EN mowi po angielsku, bez ani jednego polskiego naglowka", async () => {
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

  it("komunikat o braku probek istnieje w obu jezykach i sie rozni", async () => {
    h.fetchVitals.mockResolvedValue(summary({ metrics: [], total: 0, windowTotal: 0 }));
    await i18n.changeLanguage("en");
    panel();

    expect(await screen.findByText(vit("noSamples", {}, "en"))).toBeInTheDocument();
    expect(vit("noSamples", {}, "en")).not.toBe(vit("noSamples", {}, "pl"));
  });

  it("slownik EN ma DOKLADNIE te same klucze i tak samo dlugie listy co PL", async () => {
    // Brakujacy klucz EN nie wywala aplikacji - cicho spada na polski tekst na
    // angielskim ekranie. Krotsza lista `fixes` gubi jedno dzialanie naprawcze
    // z playbooka wydajnosci.
    const pl = shape(subtree("pl", ["adminAnalytics", "vitals"]));
    const en = shape(subtree("en", ["adminAnalytics", "vitals"]));

    expect(pl.size).toBeGreaterThan(40);
    expect(Object.fromEntries(en)).toEqual(Object.fromEntries(pl));
  });
});
