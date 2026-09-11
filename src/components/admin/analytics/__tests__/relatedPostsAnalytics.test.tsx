// `RelatedPostsAnalytics` - pulpit silnika rekomendacji: stany, agregacja,
// interpretacja i izolacja warsztatów.
//
// PO CO. Plik stał na zerze (0/111 linii, 0/40 funkcji). Panel nie liczy nic,
// co dało by się sprawdzić okiem: bierze JEDEN raport z RPC i rozkłada go na
// sześć wykresów oraz siedem reguł interpretacyjnych. Każda z tych operacji
// psuje się CICHO - wykres dalej się rysuje, kafelek dalej pokazuje liczbę,
// a administrator dostaje odwrotną rekomendację przy niezmienionym wyglądzie
// ekranu.
//
// KLASY DEFEKTÓW, KTÓRE TEN PLIK ŁAPIE:
//   * ZERO UDAJĄCE POMIAR. „Jeszcze nie wiem", „zapytanie padło" i „w oknie
//     naprawdę nie ma danych" to trzy różne informacje dla operatora, więc
//     każdy z tych stanów jest tu asertowany OSOBNO: panel ma na nie trzy
//     różne karty i żadna z nich nie ma prawa wystąpić w cudzym stanie.
//   * ROZJECHANA AGREGACJA. Rankingi są przycinane (15 kategorii / 20 tagów /
//     40 wpisów / 12 hubów / 15 przejść), sortowane malejąco, a macierz
//     współwystępowania symetryzowana i przycięta do `COOC_TAGS` tagów.
//     Przestawiona kolejność daje wykres, który wygląda poprawnie i kłamie
//     o rankingu.
//   * PROGI INTERPRETACJI. Siedem reguł, każda z własnym progiem liczbowym
//     (100 wyświetleń, CTR 3% / 1%, „mniej niż 3 wpisy" razy 3 kategorie,
//     50 wyświetleń, średnia 2 wspólnych wpisów, 5 kliknięć huba, 3 wpisy
//     rozjazdu). Zamieniony znak porównania nie wywraca panelu - podsuwa
//     odwrotne działanie naprawcze.
//   * OKABLOWANIE FILTRA OKNA. Zmiana zakresu ma przestawić WEJŚCIE zapytania,
//     nie tylko etykietę, dlatego asercje idą na argument funkcji serwerowej.
//   * IZOLACJA WARSZTATÓW. Klucz cache niesie NAJEMCĘ (`["related-insights",
//     tenantId, days]`), a zapytanie czeka na jego rozwiązanie. Testy dowodzą
//     tego z dwóch stron: przy świeżym kliencie panel warsztatu B nie widzi
//     wierszy warsztatu A, i to samo na kliencie WSPÓŁDZIELONYM, czyli tam,
//     gdzie cache przeżywa przełączenie warsztatu.
//   * SŁOWNIK. Asercje idą przez `realT("pl")` i `realT("en")`, czyli tę samą
//     instancję i18next, którą widzi użytkownik: usunięty klucz wypada surowym
//     `adminAnalytics.…`, a brak klucza EN cicho spada na polski fallback.
//
// PULPIT RYSUJE NASZYM SILNIKIEM, nie ECharts - i ten plik nie podmienia go
// atrapą, tylko PODGLĄDA. `Chart` jest opakowany szpiegiem, który zapisuje
// `config` i `onSelect`, a potem woła PRAWDZIWY komponent. Dzięki temu
// kolejność, przycinanie i drążenie sprawdzamy na konfiguracji oddanej
// silnikowi, a nazwy regionów, tabele danych i podpisy - na tym, co silnik
// z niej naprawdę narysował. Atrapa dowodziłaby tylko, że panel woła funkcję,
// a dawna atrapa `EChart` dowodziła tego o silniku, którego tu już nie ma.
//
// CZEGO TE PRZYPADKI JUŻ NIE SPRAWDZAJĄ - i dlaczego to nie jest ubytek.
// Formatery dymków, funkcja `symbolSize`, prefiksy węzłów sankeya i skracanie
// etykiet do 32 znaków były WNĘTRZEM ECharts: panel musiał je pisać sam, bo
// tamten silnik nie miał ani dymka z jednostką, ani tabeli danych, ani
// przycinania etykiet osi. Nasz silnik ma jedno i drugie i nie oddaje ich
// panelowi do konfiguracji, więc każdy taki przypadek ma tu ZAMIENNIK na tej
// samej prawdzie: albo asercję na konfiguracji oddanej silnikowi, albo na
// tabeli danych, którą silnik narysował.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ClickPair,
  CoTagPair,
  HubTarget,
  InsightsSummary,
  PopularityRow,
  RelatedInsightsResult,
  TopCategory,
  TopTag,
} from "@/lib/relatedInsights.functions";
import type { AppLang } from "@/lib/i18n/localePath";
import type { ChartConfig } from "@/lib/charts/types";
import type { ChartSelection } from "@/lib/charts/selection";

const h = vi.hoisted(() => ({
  fetchInsights: vi.fn(),
  tenantId: "tenant-related" as string | null,
  charts: [] as Array<{
    config: ChartConfig;
    onSelect?: (selection: ChartSelection) => void;
  }>,
}));

// Najemca jest ATRAPĄ, a nie prawdziwym `useCurrentTenantId`: tamten ciągnie
// klienta Supabase i sesję `useAuth`, a przedmiotem dowodu jest tylko to, że
// identyfikator warsztatu WCHODZI DO KLUCZA react-query. Sterowanie nim z testu
// (`h.tenantId`) daje jedyny sposób odegrania przejścia między warsztatami na
// TYM SAMYM kliencie cache. Ten sam wzorzec: `vitalsBiDashboard.test.tsx`.
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

vi.mock("@/lib/relatedInsights.functions", () => ({
  getRelatedInsights: (...args: unknown[]) => h.fetchInsights(...args),
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
// dowodu jest to, że napisy przychodzą ZE SŁOWNIKA. Język przestawia się przez
// `i18n.changeLanguage`.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RelatedPostsAnalytics } from "../RelatedPostsAnalytics";

// ---------------------------------------------------------------------------
// Słownik
// ---------------------------------------------------------------------------

const R = "adminAnalytics.related";

function dict(path: string, vars: Record<string, unknown> = {}, lang: AppLang = "pl"): string {
  return realT(lang)(`${R}.${path}`, vars);
}

function dictList(path: string, lang: AppLang = "pl"): string[] {
  return realT(lang)(`${R}.${path}`, { returnObjects: true }) as string[];
}

function common(path: string, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.common.${path}`);
}

/** Ile tagów wchodzi do macierzy - ta sama liczba, co `COOC_TAGS` w panelu. */
const COOC_TAGS = 12;
/** Ile par mieści ranking przejść - ta sama liczba, co `FLOWS_IN_RANKING`. */
const FLOWS_IN_RANKING = 15;

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

function cat(name: string, posts_count: number, id = `cat-${name}`): TopCategory {
  return { category_id: id, name, posts_count };
}
function tag(tag_id: string, name: string, posts_count = 5): TopTag {
  return { tag_id, name, posts_count };
}
function coPair(a: string, b: string, c: number): CoTagPair {
  return { a, b, c };
}
function pop(post_id: string, title: string | null, views: number, uniques: number): PopularityRow {
  return { post_id, title, views, uniques };
}
function clickPair(source: string, target: string, clicks: number): ClickPair {
  return {
    source_post_id: source,
    target_post_id: target,
    source_title: `Zrodlo ${source}`,
    target_title: `Cel ${target}`,
    clicks,
  };
}
function hub(post_id: string, title: string | null, clicks: number, sources: number): HubTarget {
  return { post_id, title, clicks, sources };
}

const EMPTY_REPORT: RelatedInsightsResult = {
  summary: { total_posts: 0, total_views: 0, total_clicks: 0, total_reads: 0, window_days: 30 },
  top_categories: [],
  top_tags: [],
  tag_cooccurrence: [],
  popularity: [],
  click_pairs: [],
  hub_targets: [],
};

/** Nadpisanie raportu; `summary` jest CZĘŚCIOWE, bo prawie każdy próg
 *  interpretacji zależy od jednej albo dwóch liczb z podsumowania. */
type ReportOverride = Partial<Omit<RelatedInsightsResult, "summary">> & {
  summary?: Partial<InsightsSummary>;
};

function report(over: ReportOverride = {}): RelatedInsightsResult {
  return {
    ...EMPTY_REPORT,
    ...over,
    summary: { ...EMPTY_REPORT.summary, ...(over.summary ?? {}) },
  };
}

/** Raport „warsztatu A" - każdy napis jest unikalny, żeby wyciek było widać. */
const WORKSPACE_A = report({
  summary: {
    total_posts: 1500,
    total_views: 4000,
    total_clicks: 120,
    total_reads: 90,
    window_days: 30,
  },
  top_categories: [cat("Alfa energetyka", 12), cat("Alfa klimat", 8)],
  top_tags: [tag("a1", "alfa-tag-jeden", 9), tag("a2", "alfa-tag-dwa", 7)],
  tag_cooccurrence: [coPair("a1", "a2", 6)],
  popularity: [pop("post-alfa", "Alfa wpis wlasny", 900, 500)],
  click_pairs: [clickPair("post-alfa", "post-alfa-cel", 40)],
  hub_targets: [hub("post-alfa-cel", "Alfa hub wlasny", 40, 6)],
});

/** Raport „warsztatu B" - rozłączny z A na każdym napisie. */
const WORKSPACE_B = report({
  summary: {
    total_posts: 3,
    total_views: 300,
    total_clicks: 9,
    total_reads: 4,
    window_days: 30,
  },
  top_categories: [cat("Beta bezpieczenstwo", 5)],
  top_tags: [tag("b1", "beta-tag-jeden", 4)],
  tag_cooccurrence: [coPair("b1", "b1", 4)],
  popularity: [pop("post-beta", "Beta wpis wlasny", 100, 60)],
  click_pairs: [clickPair("post-beta", "post-beta-cel", 5)],
  hub_targets: [hub("post-beta-cel", "Beta hub wlasny", 5, 2)],
});

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

interface Captured {
  config: ChartConfig;
  onSelect?: (selection: ChartSelection) => void;
}

/** OSTATNI przechwycony wykres pasujący do predykatu - czyli stan po ostatnim renderze. */
function lastChart(label: string, pred: (c: ChartConfig) => boolean): Captured {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    if (pred(h.charts[i].config)) return h.charts[i];
  }
  throw new Error(`test: nie przechwycono wykresu „${label}"`);
}

/**
 * Wykresy ROZPOZNAWANE PO NAZWIE SERII, a nie po kolejności renderu: cztery
 * rankingi tego panelu mają ten sam rodzaj (`bar-horizontal`), więc indeks
 * w tablicy przechwyceń rozstrzygałby o tożsamości wykresu wyłącznie przez
 * kolejność JSX - i milczałby, gdyby dwie karty zamieniły się danymi.
 */
const bars = (seriesName: string) => (c: ChartConfig) =>
  c.kind === "bar-horizontal" && c.series[0]?.name === seriesName;

const topCatsChart = () => lastChart("top kategorie", bars(dict("charts.topCatsSubtitle")));
const topTagsChart = () => lastChart("top tagi", bars(dict("charts.topTagsSubtitle")));
const hubChart = () => lastChart("hub-posty", bars(dict("series.hubClicks")));
const flowsChart = () => lastChart("przejscia zrodlo-cel", bars(dict("series.flowClicks")));
const coocChart = () => lastChart("macierz tagow", (c) => c.kind === "heatmap");
const popularityChart = () => lastChart("popularnosc", (c) => c.kind === "scatter");

/** Wartości pierwszej serii - liczby, które panel oddał silnikowi. */
function values(chart: Captured, index = 0): (number | null)[] {
  return chart.config.series[index]?.values ?? [];
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

/**
 * Region wykresu po dostępnej nazwie, którą `ChartCard` buduje z tytułu.
 *
 * Po NAZWIE, a nie po roli: silnik daje rysunkom kartezjańskim `role="img"`,
 * ale rodzajom z fokusowalnymi elementami - `role="group"`, bo rola obrazka
 * uczyniłaby je prezentacyjnymi. Szukanie po roli „img" gubiłoby więc
 * dokładnie te wykresy, które mają najbogatszą obsługę klawiatury.
 */
function chartRegion(title: string): HTMLElement {
  return screen.getByLabelText(realT("pl")("adminAnalytics.chartCard.chartRegion", { title }));
}

/**
 * Tabela danych rysunku - alternatywa tekstowa, którą silnik rysuje pod
 * KAŻDYM rodzajem. Szukamy jej od regionu w górę, do ramki silnika: karta nie
 * rysuje już własnej tabeli, bo dwie tabele pod jednym rysunkiem to te same
 * liczby dwa razy.
 */
function dataTableOf(title: string): HTMLElement {
  const region = chartRegion(title);
  const frame = region.closest("figure");
  // PIERWSZA tabela panelu: rozrzut wypisuje DWIE (obserwacje i dopasowanie),
  // a nagłówki obu sklejone w jedną listę nie opisują żadnej z nich.
  const el = frame?.querySelector<HTMLElement>("[data-chart-table] table");
  if (!el) throw new Error(`test: wykres „${title}" nie ma tabeli danych`);
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

/** Wejścia, z jakimi panel wołał funkcję serwerową. */
function queryInputs(): Array<{ days: number }> {
  return h.fetchInsights.mock.calls.map((c) => (c[0] as { data: { days: number } }).data);
}

/** Wartość kafelka KPI stojąca przy podanej etykiecie. */
function kpiValue(label: string): string {
  const box = screen.getByText(label).closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI „${label}"`);
  return box.lastElementChild?.textContent ?? "";
}

/** Karta „Interpretacja i rekomendacje" - jedyne miejsce z wnioskami panelu. */
function insightCard(): HTMLElement {
  // `getByText`, nie `getByRole("heading")`: w stanie PUSTYM `InsightSection`
  // renderuje tytuł zwykłym `div`-em, więc szukanie roli gubiłoby dokładnie te
  // przypadki, w których dowodzimy, że żaden próg się nie zapalił.
  const card = screen.getByText(dict("insightsTitle")).closest("div.p-4");
  if (!card) throw new Error("test: nie znaleziono karty interpretacji");
  return card as HTMLElement;
}

/**
 * Napisy z NAGŁÓWKÓW kart wykresów - tytuły i podtytuły.
 *
 * PO CO ZAWĘŻENIE. Nazwy serii i kategorie jadą do tabeli danych rysowanej
 * przez silnik, więc ten sam napis potrafi wystąpić w dokumencie dwa razy
 * i `getByText` przestaje być rozstrzygalny. Asercja i tak dotyczyła zawsze
 * nagłówka karty - tu jest to powiedziane wprost, zamiast liczyć na jedyność
 * napisu w całym panelu.
 */
function cardHeaderTexts(): string[] {
  // `div.border-b > div.min-w-0` to nagłówek karty wykresu; kafelek KPI ma
  // własne `div.min-w-0`, ale bez obramowania dolnego, więc tu nie wchodzi.
  return Array.from(document.querySelectorAll("div.border-b > div.min-w-0 > div")).map((el) =>
    (el.textContent ?? "").trim(),
  );
}

function panel(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RelatedPostsAnalytics />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Czeka aż raport dojedzie i panel przełączy się z komunikatu na siatkę KPI. */
async function loaded(lang: AppLang = "pl"): Promise<void> {
  await screen.findByText(dict("kpi.posts", {}, lang));
}

/** Czeka aż zapytanie się rozstrzygnie - także wtedy, gdy padło. */
async function settled(): Promise<void> {
  await waitFor(() => expect(h.fetchInsights).toHaveBeenCalled());
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

function subtree(lang: AppLang, path: string[]): unknown {
  let node: unknown = i18n.getResourceBundle(lang, "translation");
  for (const seg of path) {
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
  h.tenantId = "tenant-related";
  h.fetchInsights.mockReset();
  h.fetchInsights.mockResolvedValue(WORKSPACE_A);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - stany panelu", () => {
  it("w trakcie pobierania pokazuje wskaźnik ładowania i ANI JEDNEGO kafelka KPI", async () => {
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    panel();

    expect(await screen.findByText(common("loading"))).toBeInTheDocument();
    // Zero i „jeszcze nie wiem" to dwie różne informacje - dopóki raport nie
    // dojedzie, panel nie ma prawa narysować ani kafelka, ani wykresu.
    expect(screen.queryByText(dict("kpi.posts"))).toBeNull();
    expect(h.charts).toHaveLength(0);
  });

  it("w trakcie pomiaru panel NIE twierdzi, że w oknie NIE MA danych", async () => {
    // „Jeszcze nie wiem" i „wiem, że pusto" to dwie różne informacje, a
    // `!report` obsługiwał je jednym komunikatem: operator patrzący na „Brak
    // danych w oknie." w pierwszej sekundzie po wejściu dostawał twierdzenie o
    // pomiarze, który się jeszcze nie odbył. Wskaźnik ładowania stał obok, ale
    // to on był dopiskiem, a nie tamten komunikat.
    //
    // Dziś stan pomiaru ma własną kartę, a „Brak danych w oknie." jest
    // zarezerwowany dla odczytu, który się ODBYŁ i nic nie przyniósł.
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    panel();
    await screen.findByText(common("loading"));

    expect(screen.getByText(common("measuring"))).toBeInTheDocument();
    expect(screen.getByText(common("measuringHint"))).toBeInTheDocument();
    expect(screen.queryByText(common("noDataWindow"))).toBeNull();
  });

  it("odczyt BEZ raportu (RPC oddało null) pokazuje komunikat o braku danych", async () => {
    // Ten komunikat znaczy ZMIERZONE ZERO, więc odgrywany jest tu jedyny stan,
    // w którym wolno go postawić: zapytanie się rozstrzygnęło, nie padło, a
    // ładunek jest pusty (jsonb `null` z RPC). Wcześniej ten sam napis wisiał
    // także w trakcie pobierania - dlatego przypadek jedzie na ROZSTRZYGNIĘTYM
    // zapytaniu, a nie na obietnicy, która nigdy się nie kończy.
    h.fetchInsights.mockResolvedValue(null);
    panel();
    await settled();

    expect(screen.getByText(common("noDataWindow"))).toBeInTheDocument();
    // Żadnego kafelka i żadnego wykresu - nie ma z czego ich zbudować.
    expect(screen.queryByText(dict("kpi.posts"))).toBeNull();
    expect(h.charts).toHaveLength(0);
  });

  it("PUSTY raport to zera z pomiaru, a nie zmyślone kategorie wykresów", async () => {
    // Tenant bez ruchu ma prawo zobaczyć zera - to jest pomiar. Czego NIE MA
    // prawa zobaczyć, to wykresów z wymyślonymi kategoriami: pusta seria jest
    // uczciwa, a jedna podstawiona kategoria „brak" byłaby pomiarem, którego
    // nikt nie zrobił.
    h.fetchInsights.mockResolvedValue(report());
    panel();
    await loaded();

    expect(kpiValue(dict("kpi.posts"))).toBe("0");
    expect(kpiValue(dict("kpi.views"))).toBe("0");
    expect(topCatsChart().config.categories).toEqual([]);
    expect(values(topCatsChart())).toEqual([]);
    expect(coocChart().config.categories).toEqual([]);
    expect(coocChart().config.series).toEqual([]);
    expect(popularityChart().config.categories).toEqual([]);
    expect(flowsChart().config.categories).toEqual([]);
    expect(values(flowsChart())).toEqual([]);
    // Żaden próg interpretacji się nie zapala, więc sekcja jest w stanie pustym.
    expect(
      screen.getByText(realT("pl")("adminAnalytics.insightSection.emptyDefault")),
    ).toBeInTheDocument();
  });

  it("po awarii zapytania pasek narzędzi żyje - operator może zmienić okno i ponowić", async () => {
    h.fetchInsights.mockRejectedValue(new Error("RPC 500: related_posts_signals failed"));
    panel();
    await settled();

    expect(screen.getByRole("button", { name: common("refresh") })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset7d") }),
    ).toBeInTheDocument();
  });

  it("awaria zapytania NIE wygląda jak pusty raport - podaje przyczynę", async () => {
    // `query.error` nie był w ogóle czytany: panel rysował „Brak danych w
    // oknie.", czyli twierdził o pomiarze, którego nie było. Administrator
    // widział „silnik rekomendacji nie ma danych" tam, gdzie w rzeczywistości
    // padło RPC `related_posts_signals` - a to dwie różne decyzje naprawcze.
    // Bliźniaczy pulpit GA4 z tego samego modułu renderuje w tej sytuacji kartę
    // błędu; dziś ten też, z `role="alert"` i przyczyną z wyjątku.
    h.fetchInsights.mockRejectedValue(new Error("RPC 500: related_posts_signals failed"));
    const { container } = panel();
    await settled();

    expect(container.textContent ?? "").toMatch(/500|b[lł][aą]d|error/i);
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toContain("RPC 500: related_posts_signals failed");
    expect(within(alert).getByText(common("readFailedHint"))).toBeInTheDocument();
    // Awaria nie ma prawa udawać zmierzonego zera.
    expect(screen.queryByText(common("noDataWindow"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - okno czasu i wejście zapytania", () => {
  it("startowe okno to 30 dni i tyle trafia do WEJŚCIA funkcji serwerowej", async () => {
    panel();
    await loaded();

    expect(queryInputs()).toEqual([{ days: 30 }]);
  });

  it("zmiana presetu na 7 dni przestawia WEJŚCIE zapytania, nie tylko etykietę", async () => {
    panel();
    await loaded();
    const before = h.fetchInsights.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset7d") }),
    );

    await waitFor(() => expect(h.fetchInsights.mock.calls.length).toBeGreaterThan(before));
    expect(queryInputs().slice(before)).toEqual([{ days: 7 }]);
  });

  it("preset 24 godz. schodzi do JEDNEGO dnia, a nie do zera", async () => {
    // `days` idzie do walidatora `z.number().int().min(1)` - okno krótsze niż
    // doba musi zaokrąglić się w górę, inaczej zapytanie zostanie odrzucone.
    panel();
    await loaded();
    const before = h.fetchInsights.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset24h") }),
    );

    await waitFor(() => expect(h.fetchInsights.mock.calls.length).toBeGreaterThan(before));
    expect(queryInputs().slice(before)).toEqual([{ days: 1 }]);
  });

  it("„Odśwież” ponawia zapytanie z tym samym oknem", async () => {
    panel();
    await loaded();
    const before = h.fetchInsights.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: common("refresh") }));

    await waitFor(() => expect(h.fetchInsights.mock.calls.length).toBe(before + 1));
    expect(queryInputs()[before]).toEqual({ days: 30 });
  });

  it("podpis okna bierze liczbę dni Z RAPORTU, a nie z ustawienia filtra", async () => {
    // Serwer może zwrócić węższe okno niż zamówione (np. tenant ma krótszą
    // historię). Podpis ma mówić, co POKAZUJE wykres, a nie co zamówiono.
    h.fetchInsights.mockResolvedValue(report({ summary: { window_days: 14 } }));
    panel();
    await loaded();

    expect(screen.getByText(dict("windowInfo", { days: 14 }))).toBeInTheDocument();
    expect(screen.queryByText(dict("windowInfo", { days: 30 }))).toBeNull();
  });

  it("przed odpowiedzią podpis okna pokazuje okno filtra, a nie puste miejsce", async () => {
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    panel();

    expect(await screen.findByText(dict("windowInfo", { days: 30 }))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - agregacja danych w wykresach", () => {
  it("ranking kategorii czyta się z GÓRY NA DÓŁ, od najmocniejszej", async () => {
    // Silnik rysuje kategorie słupków poziomych od góry w kolejności tablicy,
    // więc ranking jedzie tu MALEJĄCO. (ECharts układał oś Y od dołu i panel
    // musiał listę odwracać - intencja ta sama, kierunek odwrotny, i dokładnie
    // tu widać, czy ktoś przeniósł odwrócenie razem z kodem.)
    h.fetchInsights.mockResolvedValue(
      report({ top_categories: [cat("Pierwsza", 30), cat("Druga", 20), cat("Trzecia", 10)] }),
    );
    panel();
    await loaded();

    expect(topCatsChart().config.categories).toEqual(["Pierwsza", "Druga", "Trzecia"]);
    expect(values(topCatsChart())).toEqual([30, 20, 10]);
    // Ta sama kolejność MUSI dojechać na ekran, nie tylko do konfiguracji.
    expect(tableRows(dataTableOf(dict("charts.topCatsTitle"))).map((r) => r[0])).toEqual([
      "Pierwsza",
      "Druga",
      "Trzecia",
    ]);
  });

  it("ranking kategorii przycina się do 15 pozycji i zostawia te najmocniejsze", async () => {
    const cats = Array.from({ length: 18 }, (_, i) => cat(`Kategoria ${18 - i}`, 100 - i));
    h.fetchInsights.mockResolvedValue(report({ top_categories: cats }));
    panel();
    await loaded();

    const names = topCatsChart().config.categories;
    expect(names).toHaveLength(15);
    // Odcięte są OSTATNIE trzy (najsłabsze), nie pierwsze.
    expect(names).toContain("Kategoria 18");
    expect(names).not.toContain("Kategoria 3");
  });

  it("ranking tagów przycina się do 20 pozycji", async () => {
    const tags = Array.from({ length: 24 }, (_, i) => tag(`t${i}`, `tag-${i}`, 100 - i));
    h.fetchInsights.mockResolvedValue(report({ top_tags: tags }));
    panel();
    await loaded();

    expect(topTagsChart().config.categories).toHaveLength(20);
  });

  it("macierz tagów jest SYMETRYCZNA i tłumaczy identyfikatory na nazwy", async () => {
    // Współwystępowanie nie ma kierunku, więc każda para musi wypełnić dwie
    // komórki: [wiersz a][kolumna b] i [wiersz b][kolumna a]. Seria jest
    // wierszem, kategoria kolumną - tak silnik czyta mapę ciepła. Tag spoza
    // `top_tags` nie ma nazwy, więc panel pokazuje sześć znaków id zamiast
    // pustki, i to też jest kontrakt.
    h.fetchInsights.mockResolvedValue(
      report({
        top_tags: [tag("t1", "Energia"), tag("t2", "Klimat"), tag("t3", "Bezpieczenstwo")],
        tag_cooccurrence: [
          coPair("t1", "t2", 5),
          coPair("t1", "t3", 1),
          coPair("nieznany-tag-999", "t2", 2),
        ],
      }),
    );
    panel();
    await loaded();

    const cfg = coocChart().config;
    expect(cfg.categories).toEqual(["Energia", "Klimat", "Bezpieczenstwo", "niezna"]);
    // Wiersze noszą te same nazwy co kolumny - macierz jest kwadratowa.
    expect(cfg.series.map((s) => s.name)).toEqual(cfg.categories);
    expect(cfg.series.map((s) => s.values)).toEqual([
      [null, 5, 1, null],
      [5, null, null, 2],
      [1, null, null, null],
      [null, 2, null, null],
    ]);
    // Najsilniejsza para dojeżdża na ekran, a nie tylko do konfiguracji.
    expect(dataTableOf(dict("charts.coocTitle", { count: COOC_TAGS })).textContent ?? "").toContain(
      "Energia",
    );
  });

  it("para, która nie wystąpiła, zostaje LUKĄ - nigdy zerem", async () => {
    // Zero znaczy „policzono i wyszło zero wspólnych wpisów", luka znaczy „tej
    // pary nie policzono". Silnik rysuje jedno i drugie inaczej (najjaśniejszy
    // stopień rampy kontra tekstura), więc podstawione zero byłoby fałszywym
    // najsłabszym współwystępowaniem w każdej pustej komórce macierzy.
    h.fetchInsights.mockResolvedValue(
      report({
        top_tags: [tag("t1", "Energia"), tag("t2", "Klimat")],
        tag_cooccurrence: [coPair("t1", "t2", 5)],
      }),
    );
    panel();
    await loaded();

    // Przekątna: tag sam ze sobą nie jest parą, więc też zostaje luką.
    expect(coocChart().config.series.map((s) => s.values)).toEqual([
      [null, 5],
      [5, null],
    ]);
  });

  it("pusta macierz nie dostaje ANI JEDNEJ zmyślonej komórki", async () => {
    h.fetchInsights.mockResolvedValue(report({ tag_cooccurrence: [] }));
    panel();
    await loaded();

    const cfg = coocChart().config;
    expect(cfg.categories).toEqual([]);
    expect(cfg.series).toEqual([]);
  });

  it("macierz tnie się do 12 tagów i NIE zostawia komórek wskazujących poza nią", async () => {
    // Para, której tag wypadł z przycięcia, musi ZNIKNĄĆ. Gdyby jej indeks
    // („undefined") trafił do siatki, wartość wylądowałaby w wierszu, którego
    // w macierzy nie ma - a przy poprzednim silniku rysowała się w rogu jako
    // fałszywe współwystępowanie. Macierz zostaje przy tym KWADRATOWA: tyle
    // samo wierszy co kolumn, każdy wiersz tej samej długości.
    const pairs = Array.from({ length: 30 }, (_, i) => coPair(`tag-${i}`, `tag-${i + 1}`, i + 1));
    h.fetchInsights.mockResolvedValue(report({ tag_cooccurrence: pairs }));
    panel();
    await loaded();

    const cfg = coocChart().config;
    expect(cfg.categories).toHaveLength(COOC_TAGS);
    expect(cfg.series).toHaveLength(COOC_TAGS);
    for (const s of cfg.series) expect(s.values).toHaveLength(COOC_TAGS);
    // Para tagów spoza dwunastki nie zostawia po sobie żadnej wartości.
    const wypelnione = cfg.series.flatMap((s) => s.values).filter((v) => v !== null);
    expect(wypelnione.length).toBeGreaterThan(0);
    expect(Math.max(...wypelnione.map(Number))).toBeLessThanOrEqual(COOC_TAGS);
  });

  it("rozrzut popularności niesie parę (wyświetlenia, unikalni) i przycina się do 40 wpisów", async () => {
    // Rozrzut zostaje rozrzutem: obie zmienne są liczbowe i niezależne, więc
    // pierwsza seria jest osią X, druga osią Y, a kategoria nazywa punkt.
    const rows = Array.from({ length: 45 }, (_, i) => pop(`p${i}`, `Wpis ${i}`, 100 - i, 50 - i));
    h.fetchInsights.mockResolvedValue(report({ popularity: rows }));
    panel();
    await loaded();

    const cfg = popularityChart().config;
    expect(cfg.categories).toHaveLength(40);
    expect(cfg.categories[0]).toBe("Wpis 0");
    expect(cfg.series.map((s) => s.name)).toEqual([dict("views"), dict("uniques")]);
    expect(values(popularityChart())[0]).toBe(100);
    expect(values(popularityChart(), 1)[0]).toBe(50);
    // Liczba obserwacji w podpisie to LICZBA PUNKTÓW, a nie suma wyświetleń -
    // inaczej podpis mówiłby o innym badaniu niż chmura nad nim.
    expect(cfg.sampleSize).toBe(40);
  });

  it("wpis BEZ tytułu pokazuje osiem znaków identyfikatora, a nie „undefined”", async () => {
    h.fetchInsights.mockResolvedValue(
      report({ popularity: [pop("abcdefgh-ijkl-mnop", null, 10, 5)] }),
    );
    panel();
    await loaded();

    expect(popularityChart().config.categories[0]).toBe("abcdefgh");
    expect(JSON.stringify(popularityChart().config)).not.toContain("undefined");
  });

  it("wielkość wyświetleń jedzie POŁOŻENIEM punktu, a nie jego średnicą", async () => {
    // Dawny silnik liczył promień z pierwiastka wyświetleń (`symbolSize`),
    // czyli kodował TĘ SAMĄ zmienną dwa razy: raz osią X, raz powierzchnią
    // plamki - a powierzchnia jest w hierarchii percepcyjnej jednym z
    // najsłabszych kanałów i przy dwóch kodowaniach czytelnik nie wie, które
    // czytać. Dziś wyświetlenia są WYŁĄCZNIE osią X, więc dowodem jest to, że
    // obie liczby wpisu stoją na osiach i obie dojeżdżają do tabeli.
    h.fetchInsights.mockResolvedValue(report({ popularity: [pop("p", "Wpis", 100, 10)] }));
    panel();
    await loaded();

    expect(values(popularityChart())).toEqual([100]);
    expect(values(popularityChart(), 1)).toEqual([10]);
    const wiersz = tableRows(dataTableOf(dict("charts.popularityTitle")))[0].join(" ");
    expect(wiersz).toContain("Wpis");
    expect(wiersz).toContain("100");
    expect(wiersz).toContain("10");
  });

  it("ranking przejść nazywa PARĘ „źródło → cel”, a nie pojedynczy wpis", async () => {
    // Elementem tego wykresu jest PRZEJŚCIE między dwoma wpisami - tak samo jak
    // na sankeyu elementem była wstęga, a nie węzeł. Wpis będący jednocześnie
    // celem jednej pary i źródłem drugiej ma więc wystąpić w DWÓCH różnych
    // kategoriach i nie zlewać się w jedną (sankey wymagał do tego prefiksów
    // `s:` / `t:`, bo cykl w grafie wywracał mu cały rysunek).
    h.fetchInsights.mockResolvedValue(
      report({ click_pairs: [clickPair("A", "B", 7), clickPair("B", "C", 3)] }),
    );
    panel();
    await loaded();

    expect(flowsChart().config.categories).toEqual(["Zrodlo A → Cel B", "Zrodlo B → Cel C"]);
    expect(values(flowsChart())).toEqual([7, 3]);
  });

  it("para kliknięć BEZ tytułów buduje kategorię ze skróconych identyfikatorów", async () => {
    // RPC oddaje `source_title` / `target_title` jako `null` dla wpisów
    // usuniętych albo nieopublikowanych. Kategoria musi wtedy dostać sześć
    // znaków identyfikatora, inaczej ranking pokazuje „undefined → undefined"
    // i skleja w jeden słupek ruch z różnych wpisów.
    h.fetchInsights.mockResolvedValue(
      report({
        click_pairs: [
          {
            source_post_id: "aaaaaaaa-1111",
            target_post_id: "bbbbbbbb-2222",
            source_title: null,
            target_title: null,
            clicks: 3,
          },
        ],
      }),
    );
    panel();
    await loaded();

    expect(flowsChart().config.categories).toEqual(["aaaaaa → bbbbbb"]);
    expect(JSON.stringify(flowsChart().config)).not.toContain("undefined");
  });

  it("ranking przejść idzie MALEJĄCO, choćby RPC oddało pary w innej kolejności", async () => {
    // Ranking, który nie jest posortowany, nie jest rankingiem - a kolejność
    // z agregatu SQL jest szczegółem implementacji zapytania, nie kontraktem.
    h.fetchInsights.mockResolvedValue(
      report({
        click_pairs: [clickPair("A", "B", 2), clickPair("C", "D", 9), clickPair("E", "F", 5)],
      }),
    );
    panel();
    await loaded();

    expect(values(flowsChart())).toEqual([9, 5, 2]);
    expect(flowsChart().config.categories[0]).toBe("Zrodlo C → Cel D");
  });

  it("ranking przejść pokazuje 15 najsilniejszych par i MÓWI, ile ich było", async () => {
    // Sankey brał wszystkie 25 par i topił je w plątaninie wstęg; ranking
    // mieści piętnaście. Obcięcie po cichu byłoby tym samym defektem co wykres
    // bez liczby obserwacji, więc podtytuł podaje OBIE liczby, a podpis `n` -
    // tę, którą widać.
    const pairs = Array.from({ length: 22 }, (_, i) => clickPair(`s${i}`, `t${i}`, 100 - i));
    h.fetchInsights.mockResolvedValue(report({ click_pairs: pairs }));
    panel();
    await loaded();

    const cfg = flowsChart().config;
    expect(cfg.categories).toHaveLength(FLOWS_IN_RANKING);
    expect(cfg.sampleSize).toBe(FLOWS_IN_RANKING);
    expect(cardHeaderTexts()).toContain(
      dict("charts.flowsSubtitle", { shown: FLOWS_IN_RANKING, total: 22 }),
    );
  });

  it("DŁUGI tytuł wpisu jedzie do danych w całości - skracanie należy do osi", async () => {
    // Poprzedni silnik kazał panelowi ciąć etykietę do 32 znaków, bo sam tego
    // nie umiał - i ucięty napis wchodził tą samą drogą do tabeli i do
    // eksportu, gdzie nie identyfikuje już wpisu. Przycinanie podpisu osi jest
    // dziś sprawą renderu, więc panel oddaje tytuł PEŁNY.
    const longTitle = "Bardzo dlugi tytul wpisu ktory nie zmiesci sie na osi wykresu";
    h.fetchInsights.mockResolvedValue(
      report({
        click_pairs: [
          { ...clickPair("A", "B", 1), source_title: longTitle, target_title: "Krotki" },
        ],
      }),
    );
    panel();
    await loaded();

    expect(flowsChart().config.categories).toEqual([`${longTitle} → Krotki`]);
  });

  it("hub-posty przycinają się do 12 i idą od najmocniejszego", async () => {
    const hubs = Array.from({ length: 15 }, (_, i) => hub(`h${i}`, `Hub ${i}`, 100 - i, 5));
    h.fetchInsights.mockResolvedValue(report({ hub_targets: hubs }));
    panel();
    await loaded();

    const cfg = hubChart().config;
    expect(cfg.categories).toHaveLength(12);
    expect(cfg.categories[0]).toBe("Hub 0"); // najmocniejszy na górze
    expect(cfg.categories[11]).toBe("Hub 11"); // najsłabszy z dwunastki na dole
    expect(values(hubChart())[0]).toBe(100);
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - drążenie i tabele danych", () => {
  it("tabela macierzy podaje obie nazwy tagów i liczbę wspólnych wpisów", async () => {
    // Dawny dymek ECharts składał ten napis sam (`formatter`), bo tamten silnik
    // nie miał alternatywy tekstowej. Nasz rysuje tabelę przy każdym rodzaju,
    // więc tę samą prawdę - że komórka wie, KTÓRE dwa tagi łączy i ILE wpisów -
    // niesie teraz tabela, i to dla czytnika ekranu, a nie tylko dla myszy.
    h.fetchInsights.mockResolvedValue(
      report({
        top_tags: [tag("t1", "Energia"), tag("t2", "Klimat")],
        tag_cooccurrence: [coPair("t1", "t2", 5)],
      }),
    );
    panel();
    await loaded();

    const table = dataTableOf(dict("charts.coocTitle", { count: COOC_TAGS }));
    expect(tableHeaders(table)).toContain("Klimat");
    const tekst = table.textContent ?? "";
    expect(tekst).toContain("Energia");
    expect(tekst).toContain("5");
    expect(tekst).not.toContain("adminAnalytics.");
  });

  it("tabela rozrzutu podaje wyświetlenia i unikalnych POD NAZWAMI ze słownika", async () => {
    h.fetchInsights.mockResolvedValue(report({ popularity: [pop("p", "Wpis X", 90, 40)] }));
    panel();
    await loaded();

    const table = dataTableOf(dict("charts.popularityTitle"));
    // Nagłówki tabeli rozrzutu są SILNIKA (obserwacja / seria / X / Y), a nazwa
    // chmury - panelu: to ona mówi, że oś X to wyświetlenia, a oś Y unikalni.
    expect(tableHeaders(table).slice(0, 4)).toEqual([
      realT("pl")("charts.scatter.table.label"),
      realT("pl")("charts.scatter.table.series"),
      realT("pl")("charts.scatter.table.x"),
      realT("pl")("charts.scatter.table.y"),
    ]);
    const wiersz = tableRows(table)[0];
    expect(wiersz[0]).toBe("Wpis X");
    expect(wiersz.join(" ")).toContain("90");
    expect(wiersz.join(" ")).toContain("40");
  });

  it("wskazanie przejścia otwiera parę w PEŁNYM brzmieniu - źródło, cel, kliknięcia", async () => {
    // Kategoria osi niesie podpisy skrócone do sześciu znaków (para musi się
    // zmieścić), więc to drążenie jest jedynym miejscem, w którym operator
    // dostaje oba tytuły osobno - dawniej robił to dymek sankeya, rozróżniający
    // krawędź od węzła.
    h.fetchInsights.mockResolvedValue(report({ click_pairs: [clickPair("A", "B", 7)] }));
    panel();
    await loaded();

    await clickChart(flowsChart(), { categoryIndex: 0, category: "Zrodlo A → Cel B" });

    expect(drillMetrics()).toEqual([
      [dict("drill.source"), "Zrodlo A"],
      [dict("drill.target"), "Cel B"],
      [dict("series.flowClicks"), "7"],
    ]);
  });

  it("wskazanie huba podaje kliknięcia i liczbę źródeł Z TEGO słupka", async () => {
    // Liczba RÓŻNYCH ŹRÓDEŁ nie jest zakodowana w słupku (ten koduje kliknięcia),
    // więc musi mieć nośnik - dawniej dymek, dziś okno szczegółów. Asercja idzie
    // na DRUGI wiersz rankingu, bo pomylony indeks pokazuje liczby sąsiada,
    // a wykres wygląda wtedy tak samo.
    h.fetchInsights.mockResolvedValue(
      report({ hub_targets: [hub("h1", "Hub pierwszy", 40, 6), hub("h2", "Hub drugi", 10, 2)] }),
    );
    panel();
    await loaded();

    await clickChart(hubChart(), { categoryIndex: 1, category: "Hub drugi" });

    expect(screen.getByRole("dialog").textContent ?? "").toContain("Hub drugi");
    expect(drillMetrics()).toEqual([
      [dict("series.hubClicks"), "10"],
      [dict("drill.sources"), "2"],
    ]);
  });

  it("wskazanie huba BEZ tytułu pokazuje osiem znaków identyfikatora", async () => {
    // Ta sama zasada co na osi: brak tytułu ma dać skrócony identyfikator, a
    // nie „undefined" w oknie szczegółów.
    h.fetchInsights.mockResolvedValue(
      report({ hub_targets: [hub("abcdefgh-1234-5678", null, 12, 3)] }),
    );
    panel();
    await loaded();

    await clickChart(hubChart(), { categoryIndex: 0, category: "abcdefgh" });

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent ?? "").toContain("abcdefgh");
    expect(dialog.textContent ?? "").not.toContain("undefined");
  });

  it("wskazanie BEZ wiersza nie otwiera okna i nie zmyśla treści", async () => {
    // Silnik oddaje wskazanie także wtedy, gdy kategoria wypadła poza zakres
    // (np. po zmianie danych w locie). `null` z obsługi znaczy „ten element nie
    // ma czego pokazać" i okno ma się wtedy NIE otworzyć.
    h.fetchInsights.mockResolvedValue(report({ hub_targets: [hub("h1", "Hub", 1, 1)] }));
    panel();
    await loaded();

    await clickChart(hubChart(), { categoryIndex: 9 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - kafelki KPI", () => {
  it("liczby powyżej tysiąca skracają się do „k”, a mniejsze idą dosłownie", async () => {
    h.fetchInsights.mockResolvedValue(
      report({
        summary: {
          total_posts: 1500,
          total_views: 999,
          total_clicks: 1000,
          total_reads: 12_345,
        },
      }),
    );
    panel();
    await loaded();

    expect(kpiValue(dict("kpi.posts"))).toBe("1.5k");
    expect(kpiValue(dict("kpi.views"))).toBe("999");
    expect(kpiValue(dict("kpi.clicks"))).toBe("1.0k");
    expect(kpiValue(dict("kpi.reads"))).toBe("12.3k");
  });

  it("wartość spoza zakresu liczb pokazuje kreskę, a nie „NaN”", async () => {
    // RPC oddaje jsonb - pole, którego zabrakło w agregacie SQL, dojedzie jako
    // `null` i po arytmetyce w kafelku zrobi się z niego `NaN`. Kreska mówi
    // „nie wiem"; „NaN" na pulpicie mówi tylko, że coś jest zepsute.
    h.fetchInsights.mockResolvedValue(report({ summary: { total_posts: Number.NaN } }));
    panel();
    await loaded();

    expect(kpiValue(dict("kpi.posts"))).toBe("-");
    expect(document.body.textContent ?? "").not.toContain("NaN");
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - interpretacja sygnałów", () => {
  async function withSummary(over: ReportOverride): Promise<HTMLElement> {
    h.fetchInsights.mockResolvedValue(report(over));
    panel();
    await loaded();
    return insightCard();
  }

  it("ruch bez ani jednego kliku w rekomendacje to wpis KRYTYCZNY", async () => {
    const card = await withSummary({ summary: { total_views: 101, total_clicks: 0 } });

    expect(within(card).getByText(dict("insights.noClicks.title"))).toBeInTheDocument();
    expect(
      within(card).getByText(dict("insights.noClicks.detail", { views: 101 })),
    ).toBeInTheDocument();
    // Odznaka „krytycznych" wystawia licznik - kolor paska to za mało.
    expect(
      within(card).getByText(
        realT("pl")("adminAnalytics.insightSection.badgeCritical", { count: 1 }),
      ),
    ).toBeInTheDocument();
    for (const fix of dictList("insights.noClicks.fixes")) {
      expect(within(card).getByText(fix)).toBeInTheDocument();
    }
  });

  it("DOKŁADNIE 100 wyświetleń bez klików nie zapala ani ostrzeżenia, ani CTR", async () => {
    // Próg to `> 100`, nie `>= 100`. Jeden wiersz mniej i panel milczy o CTR -
    // to jest świadoma luka w regule, a nie przeoczenie testu.
    const card = await withSummary({ summary: { total_views: 100, total_clicks: 0 } });

    expect(within(card).queryByText(dict("insights.noClicks.element"))).toBeNull();
    expect(within(card).queryByText(dict("insights.ctr.element"))).toBeNull();
  });

  it("CTR 3% to ocena DOBRA i lista „utrzymaj”, nie lista naprawcza", async () => {
    const card = await withSummary({
      summary: { total_views: 1000, total_clicks: 30, total_reads: 40 },
    });

    expect(within(card).getByText(dict("insights.ctr.title", { ctr: "3.00" }))).toBeInTheDocument();
    expect(
      within(card).getByText(realT("pl")("adminAnalytics.insightSection.badgeOk", { count: 1 })),
    ).toBeInTheDocument();
    for (const fix of dictList("insights.ctr.fixesGood")) {
      expect(within(card).getByText(fix)).toBeInTheDocument();
    }
    expect(within(card).queryByText(dictList("insights.ctr.fixesBad")[0])).toBeNull();
  });

  it("CTR 1% to OBSERWACJA, ale już z listą naprawczą", async () => {
    // Dwa łańcuchy `if` nad tą samą liczbą: severity łamie się na 3 i 1, a
    // lista fiksów TYLKO na 3. Próg 1% jest więc granicą, na której te dwie
    // decyzje się rozjeżdżają - i dlatego ma własny przypadek.
    const card = await withSummary({
      summary: { total_views: 1000, total_clicks: 10, total_reads: 40 },
    });

    expect(within(card).getByText(dict("insights.ctr.title", { ctr: "1.00" }))).toBeInTheDocument();
    expect(
      within(card).getByText(realT("pl")("adminAnalytics.insightSection.badgeInfo", { count: 1 })),
    ).toBeInTheDocument();
    for (const fix of dictList("insights.ctr.fixesBad")) {
      expect(within(card).getByText(fix)).toBeInTheDocument();
    }
  });

  it("CTR poniżej 1% to OSTRZEŻENIE", async () => {
    const card = await withSummary({
      summary: { total_views: 1000, total_clicks: 9, total_reads: 40 },
    });

    expect(within(card).getByText(dict("insights.ctr.title", { ctr: "0.90" }))).toBeInTheDocument();
    expect(
      within(card).getByText(realT("pl")("adminAnalytics.insightSection.badgeWarn", { count: 1 })),
    ).toBeInTheDocument();
  });

  it("trzy kategorie z mniej niż trzema wpisami zapalają ostrzeżenie o strukturze", async () => {
    const card = await withSummary({
      top_categories: [cat("A", 1), cat("B", 2), cat("C", 1), cat("D", 9)],
    });

    expect(
      within(card).getByText(dict("insights.smallCats.title", { count: 3 })),
    ).toBeInTheDocument();
  });

  it("kategoria PUSTA i kategoria z trzema wpisami nie liczą się do ostrzeżenia", async () => {
    // Próg to `posts_count > 0 && < 3`. Kategoria bez wpisów jest problemem
    // innego rodzaju (do usunięcia, nie do scalenia), a trzy wpisy to już
    // minimum, które silnik obsłuży.
    const card = await withSummary({
      top_categories: [cat("A", 0), cat("B", 0), cat("C", 3), cat("D", 1), cat("E", 1)],
    });

    expect(within(card).queryByText(dict("insights.smallCats.element"))).toBeNull();
  });

  it("brak historii czytania przy ruchu powyżej 50 wyświetleń to obserwacja", async () => {
    const card = await withSummary({ summary: { total_views: 51, total_reads: 0 } });

    expect(within(card).getByText(dict("insights.noReads.title"))).toBeInTheDocument();
  });

  it("przy 50 wyświetleniach panel jeszcze NIE wnioskuje o personalizacji", async () => {
    const card = await withSummary({ summary: { total_views: 50, total_reads: 0 } });

    expect(within(card).queryByText(dict("insights.noReads.element"))).toBeNull();
  });

  it("średnia poniżej 2 wspólnych wpisów to RZADKI graf tagów", async () => {
    const card = await withSummary({
      tag_cooccurrence: [coPair("a", "b", 1), coPair("b", "c", 2)], // średnia 1.5
    });

    expect(
      within(card).getByText(dict("insights.sparseTags.detail", { avg: "1.5" })),
    ).toBeInTheDocument();
    expect(within(card).queryByText(dict("insights.healthyTags.title"))).toBeNull();
  });

  it("średnia DOKŁADNIE 2 to już graf ZDROWY - bez listy działań", async () => {
    const card = await withSummary({
      tag_cooccurrence: [coPair("a", "b", 1), coPair("b", "c", 3)], // średnia 2.0
    });

    expect(within(card).getByText(dict("insights.healthyTags.title"))).toBeInTheDocument();
    expect(
      within(card).getByText(dict("insights.healthyTags.detail", { avg: "2.0" })),
    ).toBeInTheDocument();
  });

  it("hub z pięciu kliknięć zapala wpis o wchłanianiu ruchu", async () => {
    const card = await withSummary({ hub_targets: [hub("h1", "Wielki hub", 5, 3)] });

    expect(
      within(card).getByText(dict("insights.hub.title", { name: "Wielki hub" })),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(dict("insights.hub.detail", { clicks: 5, sources: 3 })),
    ).toBeInTheDocument();
  });

  it("hub BEZ tytułu pokazuje osiem znaków identyfikatora, nie „undefined”", async () => {
    const card = await withSummary({ hub_targets: [hub("abcdefgh-1234", null, 9, 2)] });

    expect(
      within(card).getByText(dict("insights.hub.title", { name: "abcdefgh" })),
    ).toBeInTheDocument();
  });

  it("cztery kliknięcia to za mało na wpis o hubie", async () => {
    const card = await withSummary({ hub_targets: [hub("h1", "Prawie hub", 4, 3)] });

    expect(within(card).queryByText(dict("insights.hub.element"))).toBeNull();
  });

  it("trzy popularne wpisy spoza hubów to ostrzeżenie o rozjeździe", async () => {
    const card = await withSummary({
      popularity: [
        pop("p1", "Popularny 1", 100, 50),
        pop("p2", "Popularny 2", 90, 40),
        pop("p3", "Popularny 3", 80, 30),
        pop("h1", "Jednoczesnie hub", 70, 20),
      ],
      hub_targets: [hub("h1", "Jednoczesnie hub", 20, 4)],
    });

    expect(
      within(card).getByText(dict("insights.mismatch.title", { count: 3 })),
    ).toBeInTheDocument();
  });

  it("dwa popularne wpisy spoza hubów to jeszcze nie rozjazd", async () => {
    const card = await withSummary({
      popularity: [pop("p1", "Pop 1", 100, 50), pop("p2", "Pop 2", 90, 40), pop("h1", "Hub", 5, 2)],
      hub_targets: [hub("h1", "Hub", 20, 4)],
    });

    expect(within(card).queryByText(dict("insights.mismatch.element"))).toBeNull();
  });

  it("bez hub-postów reguła rozjazdu w ogóle się nie uruchamia", async () => {
    // `pop.length > 0 && hubs.length > 0` - bez celów kliknięć nie ma z czym
    // porównać popularności, więc panel nie ma prawa oskarżyć silnika.
    const card = await withSummary({
      popularity: [
        pop("p1", "Pop 1", 100, 50),
        pop("p2", "Pop 2", 90, 40),
        pop("p3", "Pop 3", 80, 30),
      ],
      hub_targets: [],
    });

    expect(within(card).queryByText(dict("insights.mismatch.element"))).toBeNull();
  });

  it("każdy wpis interpretacji jest GOTOWYM tekstem - bez surowych kluczy, „{{}}” i NaN", async () => {
    const card = await withSummary({
      summary: { total_views: 4000, total_clicks: 120, total_reads: 0 },
      top_categories: [cat("A", 1), cat("B", 1), cat("C", 1)],
      tag_cooccurrence: [coPair("a", "b", 1)],
      popularity: [pop("p1", "P1", 9, 3), pop("p2", "P2", 8, 2), pop("p3", "P3", 7, 1)],
      hub_targets: [hub("h1", "Hub", 30, 5)],
    });

    const text = card.textContent ?? "";
    expect(text).not.toContain("adminAnalytics.");
    expect(text).not.toContain("{{");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - izolacja warsztatów", () => {
  it("panel warsztatu B pokazuje WYŁĄCZNIE wiersze warsztatu B", async () => {
    h.fetchInsights.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();

    expect(
      screen.getByText(dict("insights.hub.title", { name: "Beta hub wlasny" })),
    ).toBeInTheDocument();
    const text = container.textContent ?? "";
    for (const leak of [
      "Alfa energetyka",
      "alfa-tag-jeden",
      "Alfa wpis wlasny",
      "Alfa hub wlasny",
    ]) {
      expect(text).not.toContain(leak);
    }
    // Także w danych oddanych silnikowi - wyciek może siedzieć w konfiguracji.
    expect(JSON.stringify(h.charts)).not.toContain("Alfa");
  });

  it("świeży klient react-query nie przenosi raportu między warsztatami", async () => {
    // Ścieżka produkcyjna przy przeładowaniu panelu: nowy klient, nowy odczyt.
    h.fetchInsights.mockResolvedValue(WORKSPACE_A);
    const first = panel();
    await loaded();
    expect(
      screen.getByText(dict("insights.hub.title", { name: "Alfa hub wlasny" })),
    ).toBeInTheDocument();
    first.unmount();
    h.charts.length = 0;

    h.fetchInsights.mockResolvedValue(WORKSPACE_B);
    const second = panel();
    await loaded();

    expect(second.container.textContent ?? "").not.toContain("Alfa");
    expect(JSON.stringify(h.charts)).not.toContain("Alfa");
  });

  it("WSPÓŁDZIELONY klient nie przenosi raportu przez przełączenie warsztatu", async () => {
    // `queryKey: ["related-insights", days]` nie zawierał ani tenanta, ani
    // użytkownika. Klient react-query jest tworzony raz na aplikację, więc
    // PRZEŻYWA przełączenie warsztatu - a wtedy panel warsztatu B trafiał
    // w TEN SAM wpis cache. Przy `staleTime: 60_000` dane są jeszcze świeże,
    // więc react-query NIE ponawiał zapytania: administrator warsztatu B
    // widział kategorie, tagi, huby i tytuły wpisów warsztatu A, i to bez ani
    // jednego żądania sieciowego. Wyciek był całkowicie cichy - widać go było
    // wyłącznie na ekranie.
    //
    // Dziś najemca jest CZĘŚCIĄ KLUCZA, więc przełączenie warsztatu to inny
    // wpis cache i realny odczyt. Dowód jest dwuczłonowy: na ekranie nie ma
    // ani jednego napisu warsztatu A ORAZ poszło drugie żądanie - bez tego
    // drugiego członu ten sam zielony wynik dałby panel, który po prostu nic
    // nie pokazuje.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.tenantId = "warsztat-a";
    h.fetchInsights.mockResolvedValue(WORKSPACE_A);
    const first = panel(client);
    await loaded();
    expect(
      screen.getByText(dict("insights.hub.title", { name: "Alfa hub wlasny" })),
    ).toBeInTheDocument();
    first.unmount();
    h.charts.length = 0;

    h.tenantId = "warsztat-b";
    h.fetchInsights.mockResolvedValue(WORKSPACE_B);
    const second = panel(client);
    await loaded();

    expect(h.fetchInsights.mock.calls.length).toBe(2);
    expect(second.container.textContent ?? "").not.toContain("Alfa hub wlasny");
    expect(JSON.stringify(h.charts)).not.toContain("Alfa");
  });

  it("dopóki najemca się nie rozwiązał, panel NIE odpytuje serwera", async () => {
    // Odczyt puszczony przed rozwiązaniem warsztatu wpadłby do cache pod
    // kluczem z pustym najemcą - i stamtąd trafiłby do pierwszego, który zapyta.
    // Panel stoi wtedy na karcie pomiaru, bo nadal nie ma CZEGO pokazać.
    h.tenantId = null;
    panel();

    expect(await screen.findByText(common("measuring"))).toBeInTheDocument();
    expect(h.fetchInsights).not.toHaveBeenCalled();
    expect(screen.queryByText(common("noDataWindow"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/** Tytuły sześciu kart pulpitu, w kolejności renderu. */
function chartTitles(lang: AppLang = "pl"): string[] {
  return [
    dict("charts.topCatsTitle", {}, lang),
    dict("charts.topTagsTitle", {}, lang),
    dict("charts.coocTitle", { count: COOC_TAGS }, lang),
    dict("charts.popularityTitle", {}, lang),
    dict("charts.hubTitle", {}, lang),
    dict("charts.flowsTitle", {}, lang),
  ];
}

describe("RelatedPostsAnalytics - dostępność", () => {
  it("każdy z sześciu wykresów ma nazwę regionu zbudowaną z tytułu karty", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    // REGIONY ZBIERANE PO ROLI „img" I „group": silnik daje rysunkom
    // kartezjańskim pierwszą, a rodzajom z fokusowalnymi elementami drugą -
    // liczenie samych obrazków gubiłoby te drugie, a ich liczba zależy od
    // danych, nie od liczby kart.
    const names = [...screen.getAllByRole("img"), ...screen.queryAllByRole("group")].map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    for (const title of chartTitles()) {
      expect(names).toContain(t("adminAnalytics.chartCard.chartRegion", { title }));
    }
    // ...i ani jednego regionu BEZ nazwy: bezimienny obrazek jest dla czytnika
    // ekranu przystankiem, który nic nie mówi.
    expect(names.filter((n) => n.trim() === "")).toEqual([]);
  });

  it("poza nienazwanymi przyciskami panel nie ma innych naruszeń axe", async () => {
    const { container } = panel();
    await loaded();

    // Regułę `button-name` wyłączamy TYLKO tutaj i tylko po to, żeby jeden
    // znany defekt (test niżej) nie przykrywał wszystkiego innego: kolejności
    // nagłówków, poprawności ARIA i semantyki list.
    expect(summarize(await axeViolations(container, { "button-name": { enabled: false } }))).toBe(
      "",
    );
  });

  it("karta braku danych jest wolna od naruszeń axe", async () => {
    // Pusty ładunek z RPC, nie wisząca obietnica: „Brak danych w oknie." stoi
    // dziś wyłącznie po ROZSTRZYGNIĘTYM odczycie.
    h.fetchInsights.mockResolvedValue(null);
    const { container } = panel();
    await settled();
    await screen.findByText(common("noDataWindow"));

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("karta pomiaru i karta awarii są wolne od naruszeń axe", async () => {
    // Dwie karty, które doszły razem z rozdzieleniem stanów - obie wchodzą do
    // drzewa dostępności, a karta awarii dodatkowo jako `role="alert"`.
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    const measuring = panel();
    await screen.findByText(common("measuring"));
    expect(summarize(await axeViolations(measuring.container))).toBe("");
    measuring.unmount();

    h.fetchInsights.mockRejectedValue(new Error("RPC 500: related_posts_signals failed"));
    const failed = panel();
    await settled();

    expect(summarize(await axeViolations(failed.container))).toBe("");
  });

  it("KAŻDY przycisk panelu ma dostępną nazwę, także sześć przycisków menu eksportu", async () => {
    // NAPRAWIONE W KOMPONENCIE WSPÓŁDZIELONYM. `ChartCard` dawał `aria-label`
    // tylko przyciskowi pełnego ekranu, a przycisk menu obok był samą ikoną
    // `MoreHorizontal` - sześć wykresów tego panelu dawało sześć bezimiennych
    // przycisków, przez które chodzi cały eksport PNG i CSV. Dziś wyzwalacz
    // menu nosi `aria-label` ze słownika, więc axe nie zgłasza `button-name`.
    //
    // Przypadek zostaje TUTAJ, choć naprawa siedzi w `ChartCard`: liczba
    // wykresów jest własnością TEGO panelu, więc dodanie siódmego wykresu
    // z pominięciem `ChartCard` zapali się właśnie tu.
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("KAŻDY z sześciu wykresów ma tekstową alternatywę powiązaną z regionem", async () => {
    // Dawniej tabelę danych budowała karta z `csv`, a panel nie podawał go ANI
    // RAZU - dla czytnika ekranu wszystkie sześć kanw ECharts było pustym
    // prostokątem z samą nazwą. Nasz silnik rysuje alternatywę tekstową przy
    // KAŻDYM rodzaju i nie da się jej pominąć z zewnątrz; ten przypadek
    // pilnuje, że żadna z sześciu kart nie wypada z tej reguły.
    //
    // Asercja idzie na OBA końce powiązania: region ma `aria-describedby`,
    // a wskazany identyfikator musi istnieć w dokumencie. Sam atrybut bez
    // elementu jest gorszy niż jego brak - czytnik obiecuje opis i milknie.
    panel();
    await loaded();

    for (const title of chartTitles()) {
      const region = chartRegion(title);
      const id = region.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(id), `wiszące aria-describedby: ${title}`).not.toBeNull();
      // Tabela z co najmniej jednym wierszem - pusta byłaby obietnicą
      // alternatywy, a nie alternatywą.
      expect(tableRows(dataTableOf(title)).length, `pusta tabela: ${title}`).toBeGreaterThan(0);
    }
    // Zaślepka karty nie ma prawa wystąpić - tabele niosą wiersze raportu.
    expect(screen.queryByText(realT("pl")("adminAnalytics.chartCard.dataTableMissing"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - dwujęzyczność", () => {
  it("wszystkie sześć kart wykresów nazywa się ze słownika PL", async () => {
    panel();
    await loaded();

    for (const title of chartTitles()) {
      expect(cardHeaderTexts()).toContain(title);
    }
    expect(cardHeaderTexts()).toContain(dict("charts.topCatsSubtitle"));
    expect(cardHeaderTexts()).toContain(dict("charts.coocSubtitle", { count: COOC_TAGS }));
  });

  it("ten sam panel po EN mówi po angielsku, bez ani jednego polskiego tytułu", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded("en");

    for (const title of chartTitles("en")) {
      expect(cardHeaderTexts()).toContain(title);
    }
    for (const title of chartTitles("pl")) {
      expect(cardHeaderTexts()).not.toContain(title);
    }
    // Kafelki i podpis okna też, nie tylko nagłówki kart.
    expect(screen.getByText(dict("kpi.clicks", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(dict("windowInfo", { days: 30 }, "en"))).toBeInTheDocument();
  });

  it("interpretacja po EN nie spada na polski fallback", async () => {
    await i18n.changeLanguage("en");
    h.fetchInsights.mockResolvedValue(
      report({ summary: { total_views: 1000, total_clicks: 5, total_reads: 0 } }),
    );
    panel();
    await loaded("en");

    const card = screen
      .getByRole("heading", { name: dict("insightsTitle", {}, "en") })
      .closest("div.p-4");
    if (!card) throw new Error("test: brak karty interpretacji");
    const text = card.textContent ?? "";
    expect(text).toContain(dict("insights.ctr.title", { ctr: "0.50" }, "en"));
    expect(text).toContain(dict("insights.noReads.title", {}, "en"));
    expect(text).not.toContain(dict("insights.noReads.title", {}, "pl"));
  });

  it("słownik EN ma DOKŁADNIE te same klucze i tak samo długie listy co PL", async () => {
    // Brakujący klucz EN nie wywala aplikacji - cicho spada na polski tekst na
    // angielskim ekranie. Krótsza lista `fixes` gubi jedno działanie naprawcze.
    const pl = shape(subtree("pl", ["adminAnalytics", "related"]));
    const en = shape(subtree("en", ["adminAnalytics", "related"]));

    expect(pl.size).toBeGreaterThan(30);
    expect(Object.fromEntries(en)).toEqual(Object.fromEntries(pl));
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - odświeżanie", () => {
  it("w trakcie ponowienia przycisk „Odśwież” NIE blokuje się na stałe", async () => {
    // `disabled={isLoading}` patrzy na PIERWSZE ładowanie, nie na `isFetching`.
    // Po odpowiedzi przycisk ma być znowu klikalny, inaczej operator utknie.
    panel();
    await loaded();

    const btn = screen.getByRole("button", { name: common("refresh") });
    fireEvent.click(btn);
    await act(async () => {
      await Promise.resolve();
    });

    expect(btn).toBeEnabled();
  });
});
