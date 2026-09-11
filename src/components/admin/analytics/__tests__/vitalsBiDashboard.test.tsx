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
//   6. ALTERNATYWA TEKSTOWA. Rysunek nigdy nie jest jedyną drogą do liczby,
//      więc każdy wykres musi mieć tabelę tych samych danych, a jego region -
//      nazwę i opis obsługi klawiatury.
//
// PULPIT RYSUJE NASZYM SILNIKIEM, nie ECharts - i ten plik nie podmienia go
// atrapą, tylko PODGLĄDA. `Chart` jest opakowany szpiegiem, który zapisuje
// `config` i `onSelect`, a potem woła PRAWDZIWY komponent. Dzięki temu progi,
// serie i drążenie sprawdzamy na konfiguracji oddanej silnikowi, a nazwy
// regionów, tabele danych i podpisy - na tym, co silnik z niej naprawdę
// narysował. Atrapa dowodziłaby tylko, że panel woła funkcję.
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
import type { ChartConfig } from "@/lib/charts/types";
import type { ChartSelection } from "@/lib/charts/selection";

const h = vi.hoisted(() => ({
  fetchVitals: vi.fn(),
  tenantId: "tenant-rum" as string | null,
  charts: [] as Array<{
    config: ChartConfig;
    onSelect?: (selection: ChartSelection) => void;
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

// SILNIK NIE JEST ATRAPĄ - jest PODSŁUCHANY. Atrapa zabierałaby panelowi
// tabelę danych i nazwy regionów, czyli dokładnie to, czego pilnuje blok
// dostępności niżej; a sam `config` bez narysowanego wykresu nie dowodzi, że
// panel cokolwiek pokazuje. Opakowanie oddaje jedno i drugie: przechwytuje
// konfigurację ORAZ renderuje prawdziwy rysunek z prawdziwą alternatywą
// tekstową.
vi.mock("@/components/charts/Chart", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/charts/Chart")>();
  return {
    ...real,
    Chart: (props: {
      config: ChartConfig;
      lang: "pl" | "en";
      onSelect?: (selection: ChartSelection) => void;
    }) => {
      h.charts.push({ config: props.config, onSelect: props.onSelect });
      return real.Chart(props);
    },
  };
});

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

interface Captured {
  config: ChartConfig;
  onSelect?: (selection: ChartSelection) => void;
}

function lastChart(label: string, pred: (c: ChartConfig) => boolean): Captured {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    if (pred(h.charts[i].config)) return h.charts[i];
  }
  throw new Error(`test: nie przechwycono wykresu „${label}”`);
}

/** Wykres trendu ROZPOZNANY PO NAZWIE SERII - „LCP p75" i tak dalej. */
function trendChart(m: VitalName): Captured {
  return lastChart(`trend ${m}`, (c) => c.kind === "line" && c.series[0]?.name === `${m} p75`);
}

const ratingStack = () =>
  lastChart("ratingi per metryka", (c) => c.kind === "bar" && c.stacked && c.series.length === 3);
const pieChart = () => lastChart("rating ogolem", (c) => c.kind === "donut");
const pathScatter = () => lastChart("rozrzut sciezek", (c) => c.kind === "scatter");

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

/**
 * Region wykresu po dostępnej nazwie, którą `ChartCard` buduje z tytułu.
 *
 * Po NAZWIE, a nie po roli: silnik daje kartezjańskim rysunkom `role="img"`,
 * ale tarczy - `role="group"`, bo jej wycinki są fokusowalne i rola obrazka
 * uczyniłaby je prezentacyjnymi. Szukanie po roli „img" gubiłoby więc
 * dokładnie ten wykres, który ma najbogatszą obsługę klawiatury.
 */
function chartRegion(title: string): HTMLElement {
  return screen.getByLabelText(realT("pl")("adminAnalytics.chartCard.chartRegion", { title }));
}

/**
 * Tabela danych rysunku - alternatywa tekstowa, którą silnik rysuje pod
 * KAŻDYM rodzajem. Szukamy jej od regionu w górę, do ramki silnika: karta nie
 * wiąże już tabeli z rysunkiem przez `aria-describedby`, bo ten opis należy
 * teraz do podpowiedzi klawiatury, a tabela siedzi w rozwijanym panelu ramki.
 */
function dataTableOf(title: string): HTMLElement {
  const region = chartRegion(title);
  const frame = region.closest("figure");
  // PIERWSZA tabela panelu: rozrzut wypisuje DWIE (obserwacje i dopasowanie),
  // a nagłówki obu sklejone w jedną listę nie opisują żadnej z nich.
  const el = frame?.querySelector<HTMLElement>("[data-chart-table] table");
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

describe("VitalsBiDashboard - progi Web Vitals docierają do panelu", () => {
  // PROGI ZESZŁY Z RYSUNKU DO PODPISU i ten blok pilnuje ich w nowym miejscu.
  //
  // Poprzednia wersja malowała je trzema pasami tła (`markArea`) i dwiema
  // kreskowanymi liniami (`markLine`) - pięcioma elementami nie-danych na
  // wykresie o jednej serii. Specyfikacja mówi o tym dwa razy: rusztowanie ma
  // być ciągłe i ciche, a kreskowanie zostaje wyłącznie teksturą strefy
  // prognozy. Próg jest LICZBĄ i jako liczba czyta się dokładnie; jako
  // krawędź pasa - tylko z grubsza.
  //
  // Test sprawdza to, co sprawdzał wcześniej: że liczby są KANONICZNE (z
  // `vitalsThresholds.ts`, nie z literału w komponencie) i że stoją
  // w jednostce TEJ metryki. Zmieniło się miejsce, nie wymaganie.
  it("stopka każdej karty trendu niesie KANONICZNE progi w jednostce metryki", async () => {
    panel();
    await loaded();

    const stopki = screen.getAllByText(/Próg:/).map((el) => el.textContent ?? "");
    expect(stopki).toContain("Próg: dobrze do 2.50 s, słabo powyżej 4.00 s"); // LCP
    expect(stopki).toContain("Próg: dobrze do 200 ms, słabo powyżej 500 ms"); // INP
    expect(stopki).toContain("Próg: dobrze do 0.100, słabo powyżej 0.250"); // CLS
    expect(stopki).toContain("Próg: dobrze do 800 ms, słabo powyżej 1.80 s"); // TTFB
  });

  it("jednostka wykresu jest jednostką METRYKI, a CLS nie dostaje milisekund", async () => {
    // Ta sama liczba w złej jednostce jest gorsza niż jej brak: CLS jest
    // bezwymiarowy, więc „0,13 ms" byłoby zdaniem fałszywym o każdym punkcie.
    panel();
    await loaded();

    expect(trendChart("LCP").config.unit).toBe(" ms");
    expect(trendChart("CLS").config.unit).toBe("");
  });

  it("dzień bez próbki zostaje LUKĄ w danych, a nie zerem", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [metric("LCP", 2400)],
        trends: [day("2026-08-01", { LCP: 2400 }), day("2026-08-02", {})],
      }),
    );
    panel();
    await loaded();

    // `null`, nie `0`: zero znaczyłoby „zmierzono zero milisekund", czyli
    // najlepszy możliwy wynik w dniu, w którym nie zmierzono nic.
    expect(trendChart("LCP").config.series[0].values).toEqual([2400, null]);
  });

  it("liczba w podpisie to liczba DNI Z POMIAREM, nie długość okna", async () => {
    // Sekcja 8 każe podać `n`. Policzenie wszystkich dni zawyżałoby próbkę
    // o dni, w których nie zmierzono niczego.
    h.fetchVitals.mockResolvedValue(
      summary({
        metrics: [metric("LCP", 2400)],
        trends: [
          day("2026-08-01", { LCP: 2400 }),
          day("2026-08-02", {}),
          day("2026-08-03", { LCP: 2600 }),
        ],
      }),
    );
    panel();
    await loaded();

    expect(trendChart("LCP").config.sampleSize).toBe(2);
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
    await clickChart(trendChart(m), { categoryIndex: 0 });
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

    await clickChart(trendChart("LCP"), { categoryIndex: 1 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie bez indeksu danych nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(trendChart("LCP"), { categoryIndex: null });

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
    await clickChart(ratingStack(), { categoryIndex: 1, seriesName: "Poor" });

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

    await clickChart(ratingStack(), { categoryIndex: 99 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie w słupek BEZ indeksu danych nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(ratingStack(), { categoryIndex: null });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie poza nazwaną serią opisuje okno podtytułem karty", async () => {
    // ECharts nie zawsze poda `seriesName` (np. kliknięcie w oś kategorii).
    // Podtytuł musi wtedy dojechać ze słownika, a nie zostać pusty.
    panel();
    await loaded();

    await clickChart(ratingStack(), { categoryIndex: 0 });

    expect(
      within(screen.getByRole("dialog")).getByText(vit("ratingsSubtitle")),
    ).toBeInTheDocument();
  });

  it("kliknięcie w kafel treemapy daje PEŁNĄ ścieżkę, próbki i odnośnik", async () => {
    const long = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
    h.fetchVitals.mockResolvedValue(summary({ paths: [path(long, 300, 5000)] }));
    panel();
    await loaded();

    await clickChart(pathScatter(), { category: long });

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
    // OBIE ŚCIEŻKI MUSZĄ BYĆ W RAPORCIE. Stary ładunek kliknięcia niósł dane
    // kafla ze sobą (`fullPath`, `value`, `lcp`), więc okno otwierało się także
    // dla ścieżki, której w raporcie nie było. Nasz silnik oddaje WSKAZANIE -
    // rodzaj, kategorię, serię i wartość - a panel dociąga resztę z raportu.
    // To jest ta sama zasada, co w reszcie migracji: dane mieszkają w jednym
    // miejscu, a rysunek wskazuje, o który wiersz chodzi.
    h.fetchVitals.mockResolvedValue(
      summary({ paths: [path("/szybka", 40, good), path("/srednia", 40, poor)] }),
    );
    panel();
    await loaded();

    await clickChart(pathScatter(), { category: "/szybka" });
    expect(drillMetrics()).toEqual([
      [vit("samplesLabel"), "40"],
      ["LCP p75", "2.50 s"],
    ]);
    expect(drillTone(1)).toContain("text-emerald");
    expect(within(screen.getByRole("dialog")).getByText(rating("good"))).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await clickChart(pathScatter(), { category: "/srednia" });
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

    await clickChart(pathScatter(), { category: "/srednia" });

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

    await clickChart(pathScatter(), { category: "/bez-lcp" });

    const dialog = screen.getByRole("dialog");
    expect(drillMetrics()[1]).toEqual(["LCP p75", "-"]);
    for (const key of ["good", "needs", "poor"] as const) {
      expect(within(dialog).queryByText(rating(key))).toBeNull();
    }
  });

  it("punkt bez liczby próbek pokazuje zero, a nie puste pole", async () => {
    // Liczba próbek i LCP p75 przychodzą z wiersza raportu - ścieżka bez
    // żadnej metryki nie ma ich wcale. Puste pole w oknie drążenia wygląda jak
    // błąd renderu, zero mówi wprost „tyle zebrano".
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/pusta", 0, null)] }));
    panel();
    await loaded();

    await clickChart(pathScatter(), { category: "/pusta" });

    expect(drillMetrics()).toEqual([
      [vit("samplesLabel"), "0"],
      ["LCP p75", "-"],
    ]);
  });

  it("kafel bez ścieżki nie otwiera okna", async () => {
    panel();
    await loaded();

    await clickChart(pathScatter(), { category: null });

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

    expect(ratingStack().config.categories).toEqual(["LCP"]);
    expect(() => trendChart("INP")).toThrow();
  });

  it("wykres trendu zostawia dzień bez próbki jako LUKĘ i łączy przez nią linie", async () => {
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    const c = trendChart("LCP").config;
    // Etykieta osi to sam dzień i miesiąc - rok jest w filtrze okna nad
    // pulpitem, a powtarzany przy każdej podziałce zjadałby miejsce etykiet.
    expect(c.categories).toEqual(["08-01", "08-02", "08-03"]);
    // `null`, nie `0`: silnik rysuje przez lukę odcinkiem i NIE stawia w niej
    // punktu obserwacji, bo obserwacji tam nie było.
    expect(c.series[0].values).toEqual([2400, null, 2600]);
  });

  it("iskra przy kafelku KPI jest GLIFEM ukrytym przed czytnikiem ekranu", async () => {
    // ISKRA PRZESTAŁA BYĆ WYKRESEM i to jest zmiana świadoma. Rysunek
    // o wysokości czterdziestu pikseli nie ma osi, podziałek ani tabeli - a
    // rama silnika dokłada je wszystkie. Iskra pokazuje KSZTAŁT obok liczby,
    // którą czytelnik i tak widzi w kafelku, więc niesie zero informacji
    // własnej i jest przed czytnikiem ekranu ukryta.
    h.fetchVitals.mockResolvedValue(ONLY_LCP);
    panel();
    await loaded();

    const iskry = document.querySelectorAll('[data-role="sparkline"] path');
    expect(iskry.length).toBeGreaterThan(0);
    for (const iskra of iskry) {
      const d = iskra.getAttribute("d") ?? "";
      // Ścieżka z silnika (`pathFromPoints`), a nie własna matematyka kafelka.
      expect(d.startsWith("M")).toBe(true);
      expect(d).not.toContain("NaN");
    }
  });

  it("rozrzut ścieżek ma DWIE serie: próbki na osi X i LCP na osi Y", async () => {
    // TREEMAPA KODOWAŁA OCENĘ KOLOREM KAFLA (zielony / amber / czerwony), czyli
    // trzecim kanałem obok powierzchni i etykiety. Rozrzut nie potrzebuje
    // trzeciego kanału: „dużo próbek ORAZ wysokie LCP" to prawy górny róg,
    // a ocena wraca w oknie szczegółów - NAPISEM, nie samym kolorem.
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

    const c = pathScatter().config;
    expect(c.categories).toEqual(["/bez-lcp", "/szybka", "/srednia", "/wolna"]);
    expect(c.series).toHaveLength(2);
    expect(c.series[0].values).toEqual([40, 40, 40, 40]);
    // Ścieżka bez pomiaru LCP zostaje LUKĄ, a nie zerem: zero znaczyłoby
    // „zmierzono zero milisekund", czyli najszybszą stronę w zestawie.
    expect(c.series[1].values).toEqual([null, 2000, 3000, 5000]);
  });

  it("drążenie ścieżki bez LCP pokazuje kreskę w tonie neutralnym", async () => {
    h.fetchVitals.mockResolvedValue(summary({ paths: [path("/bez-lcp", 40, null)] }));
    panel();
    await loaded();

    await clickChart(pathScatter(), { category: "/bez-lcp" });

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

    const c = pieChart().config;
    expect(c.categories).toEqual([rating("good"), rating("needs"), rating("poor")]);
    expect(c.series[0].values).toEqual([15, 5, 5]);
    // Liczba w środku pierścienia jest SUMĄ i rysuje ją silnik - panel podaje
    // wyłącznie trzy kubełki, a suma nie jest osobną daną do przepisania.
    expect(c.sampleSize).toBe(25);
  });

  it("oś słupków ratingów idzie kolejnością METRIC_ORDER, nie kolejnością raportu", async () => {
    h.fetchVitals.mockResolvedValue(
      summary({ metrics: [metric("TTFB", 600), metric("LCP", 2000), metric("CLS", 0.05)] }),
    );
    panel();
    await loaded();

    expect(ratingStack().config.categories).toEqual(["LCP", "CLS", "TTFB"]);
  });

  it("rozrzut niesie PEŁNE ścieżki, bez skracania pod rozmiar kafla", async () => {
    // TREEMAPA SKRACAŁA ETYKIETĘ do 26 znaków, bo dłuższa nie mieściła się
    // w kaflu, i trzymała pełną ścieżkę osobno w danych. Rozrzut nie ma kafla,
    // więc nie ma czego przycinać - a okno szczegółów dostaje adres, a nie
    // jego początek.
    const long = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
    h.fetchVitals.mockResolvedValue(summary({ paths: [path(long, 300, 2000)] }));
    panel();
    await loaded();

    const c = pathScatter().config;
    expect(c.categories).toEqual([long]);
    expect(c.series[0].values).toEqual([300]);
  });

  it("treemapa przycina się do 25 ścieżek", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => path(`/sciezka-${i}`, 100 - i, 2000));
    h.fetchVitals.mockResolvedValue(summary({ paths }));
    panel();
    await loaded();

    expect(pathScatter().config.categories).toHaveLength(25);
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

    const series = ratingStack().config.series;
    // NAZWY SERII ZE SŁOWNIKA, nie surowe nazwy kubełków z API: legenda,
    // tabela danych i dymek biorą je wprost z konfiguracji, więc „Good" stałby
    // po angielsku na polskim pulpicie.
    expect(series.map((one) => one.name)).toEqual([
      rating("good"),
      rating("needs"),
      rating("poor"),
    ]);
    // `null` w wartościach silnik rysuje jako LUKĘ, czyli słupek BEZ jednego
    // kubełka - a to wygląda identycznie jak zmierzone zero i rozjeżdża
    // wysokość całej kolumny względem sąsiednich metryk.
    expect(series.map((one) => one.values)).toEqual([[0], [0], [0]]);
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

  it("pierścień ratingów ma strażnik kubełków - niepełny wiersz daje zera, nie NaN", async () => {
    // NAPRAWIONE W TEJ PORCJI. `ratingStackConfig` i eksport CSV czytały
    // kubełki przez `?? 0`, a `ratingTotals` sumował je GOŁYM dodawaniem:
    // `rows.reduce((acc, m) => acc + m.good, 0)`. Jedno brakujące pole
    // zamieniało sumę w `NaN`, a `NaN` szedł do wartości wszystkich trzech
    // wycinków i do podpisu w środku pierścienia.
    //
    // SKUTEK, KTÓRY TO ZNOSI. Ten sam raport dawał na jednym wykresie uczciwe
    // zera, a na sąsiednim „NaN próbek" - operator widział dwa sprzeczne stany
    // tego samego pomiaru obok siebie i nie miał jak rozstrzygnąć, który jest
    // prawdziwy. Pierścień i jego tabela muszą podać te same trzy liczby.
    //
    // ASERCJA NA KONFIGURACJI, nie na napisie: silnik i tak wypisałby `NaN`
    // jako kreskę, więc rysunek MASKOWAŁBY defekt, zamiast go pokazać - a do
    // eksportu CSV i tak poszłaby wartość, nie kreska.
    h.fetchVitals.mockResolvedValue(NULL_BUCKETS);
    panel();
    await loaded();

    const wartosci = pieChart().config.series[0]?.values ?? [];
    expect(wartosci).toEqual([0, 0, 0]);
    expect(wartosci.some((v) => Number.isNaN(v))).toBe(false);
  });

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

    // REGIONY ZBIERANE PO ROLI „img" I „group": silnik daje rysunkom
    // kartezjańskim pierwszą, a tarczy drugą - jej wycinki są fokusowalne,
    // więc rola obrazka uczyniłaby je prezentacyjnymi.
    const names = [...screen.getAllByRole("img"), ...screen.getAllByRole("group")].map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    // NAZWA KAŻDEJ KARTY, a nie ich LICZBA. Liczenie elementów o roli obrazka
    // było policzeniem nie tego, co trzeba: wycinki pierścienia też ją mają
    // (każdy jest osobnym celem tabulacji z własną nazwą), więc suma zależy od
    // liczby kategorii w danych, a nie od liczby wykresów na pulpicie.
    for (const metric of ["LCP", "INP", "CLS", "FCP", "TTFB"] as const) {
      expect(names).toContain(
        t("adminAnalytics.chartCard.chartRegion", {
          title: vit("trendTitle", { metric }),
        }),
      );
    }
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: vit("pathsBySamples") }),
    );
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: vit("ratingsPerMetric") }),
    );
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: vit("ratingOverall") }),
    );
    // ...i ani jednego regionu BEZ nazwy: bezimienny obrazek jest dla czytnika
    // ekranu przystankiem, który nic nie mówi.
    expect(names.filter((n) => n.trim() === "")).toEqual([]);
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

  it("KAŻDY z ośmiu wykresów ma tekstową alternatywę i podpowiedź obsługi", async () => {
    // ECharts malował do kanwy, która dla czytnika ekranu jest pustym
    // prostokątem, a tabelę trzeba było podać karcie osobno przez `csv` -
    // panel nie podał jej ANI RAZU, więc cały pulpit wydajności był dla
    // czytnika nieczytelny. Nasz silnik rysuje alternatywę tekstową przy
    // KAŻDYM rodzaju i nie da się jej pominąć z zewnątrz; ten przypadek
    // pilnuje, że żadna z ośmiu kart tego pulpitu nie wypada z tej reguły.
    //
    // Asercja idzie na OBA końce powiązania: region ma `aria-describedby`
    // z podpowiedzią klawiatury, a wskazany identyfikator musi istnieć.
    // Sam atrybut bez elementu jest gorszy niż jego brak - czytnik obiecuje
    // opis i milknie.
    panel();
    await loaded();

    const tytuly = [
      ...(["LCP", "INP", "CLS", "FCP", "TTFB"] as const).map((metric) =>
        vit("trendTitle", { metric }),
      ),
      vit("ratingsPerMetric"),
      vit("ratingOverall"),
      vit("pathsBySamples"),
    ];
    expect(tytuly).toHaveLength(8);

    for (const tytul of tytuly) {
      const region = chartRegion(tytul);
      const id = region.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(id), `wiszące aria-describedby: ${tytul}`).not.toBeNull();
      // Tabela z co najmniej jednym wierszem - pusta byłaby obietnicą
      // alternatywy, a nie alternatywą.
      expect(tableRows(dataTableOf(tytul)).length, `pusta tabela: ${tytul}`).toBeGreaterThan(0);
    }
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
    // Nagłówek kolumny kategorii jest silnika („Kategoria"), a nie panelu:
    // tabela danych należy do rysunku i ma tę samą postać pod wykresem
    // w artykule co pod kartą pulpitu.
    expect(tableHeaders(table)).toEqual([realT("pl")("charts.frame.category"), "LCP p75"]);
    // JEDNOSTKA PRZY KAŻDEJ LICZBIE, bo sama „2400" nie mówi, czy to
    // milisekundy, sekundy, czy bezwymiarowy CLS. Dzień bez próbki zostaje
    // KRESKĄ - podstawione zero rysowałoby czas ładowania spadający do zera,
    // czyli sukces tam, gdzie pomiaru nie było.
    expect(tableRows(table)).toEqual([
      // Oś dnia jest skrócona do „MM-DD": rok jest w zakresie dat paska
      // narzędzi i powtarzany przy każdej kategorii tylko zabierałby miejsce.
      ["08-01", "2400 ms"],
      ["08-02", "-"],
    ]);
  });

  it("tabela rozrzutu ścieżek niesie PEŁNY adres, liczbę próbek i LCP p75", async () => {
    const long = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
    h.fetchVitals.mockResolvedValue(
      summary({ paths: [path(long, 300, 5000), path("/bez-lcp", 40, null)] }),
    );
    panel();
    await loaded();

    const table = dataTableOf(vit("pathsBySamples"));
    // Tabela rozrzutu ma postać silnika: obserwacja, seria, X, Y - plus
    // kolumna przypisów, gdy któraś para wypadła z chmury.
    expect(tableHeaders(table).slice(0, 4)).toEqual([
      realT("pl")("charts.scatter.table.label"),
      realT("pl")("charts.scatter.table.series"),
      realT("pl")("charts.scatter.table.x"),
      realT("pl")("charts.scatter.table.y"),
    ]);
    const rows = tableRows(table);
    // Etykieta punktu bywa przycięta, tabela - nie: przycięty adres nie
    // identyfikuje podstrony, a tabela jest też materiałem do eksportu.
    expect(rows.map((r) => r[0])).toEqual([long, "/bez-lcp"]);
    expect(rows[0]?.slice(1, 4)).toEqual(["LCP p75", "300", "5000 ms"]);
    // Ścieżka bez pomiaru LCP zostaje KRESKĄ i wypada z chmury - podstawione
    // zero rysowałoby podstronę najszybszą z całego serwisu.
    expect(rows[1]?.slice(1, 4)).toEqual(["LCP p75", "40", "-"]);
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
