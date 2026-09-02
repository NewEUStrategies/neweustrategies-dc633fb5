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
//   * ODWRÓCONA AGREGACJA. Słupki poziome są odwracane (`.reverse()`), listy
//     przycinane (15 kategorii / 20 tagów / 25 par / 40 wpisów / 12 hubów),
//     a heatmapa symetryzowana. Przestawiony `.reverse()` daje wykres, który
//     wygląda poprawnie i kłamie o kolejności.
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
// ECHARTS JEST TU ZAKAZANY (patrz nagłówek `EChart.tsx`): podmieniamy `EChart`
// atrapą, która PRZECHWYTUJE `option`. Dzięki temu asercje o kolejności,
// przycinaniu i podpowiedziach idą na strukturę danych oddaną wykresowi, a nie
// na piksele - i ~1 MB biblioteki nigdy nie wchodzi do procesu testowego.
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

type Opt = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fetchInsights: vi.fn(),
  tenantId: "tenant-related" as string | null,
  charts: [] as Array<{ option: Record<string, unknown> }>,
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

// Atrapa wykresu zapisuje `option`. To jedyne miejsce, w którym widać, CO panel
// policzył - i jedyny sposób na dowiedzenie kolejności bez wciągania echarts.
vi.mock("../EChart", () => ({
  EChart: ({ option }: { option: Record<string, unknown> }) => {
    h.charts.push({ option });
    return <div data-testid="echart" />;
  },
}));

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
function numList(v: unknown): number[] {
  return Array.isArray(v) ? (v as unknown[]).map(Number) : [];
}

/** OSTATNI przechwycony wykres pasujący do predykatu - czyli stan po ostatnim renderze. */
function lastOption(label: string, pred: (o: Opt) => boolean): Opt {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    if (pred(h.charts[i].option)) return h.charts[i].option;
  }
  throw new Error(`test: nie przechwycono wykresu „${label}"`);
}

const barColor = (color: string) => (o: Opt) =>
  firstSeries(o).type === "bar" && rec(firstSeries(o).itemStyle).color === color;
const isType = (type: string) => (o: Opt) => firstSeries(o).type === type;

const topCatsOption = () => lastOption("top kategorie", barColor("#2a78d6"));
const topTagsOption = () => lastOption("top tagi", barColor("#1baf7a"));
const hubOption = () => lastOption("hub-posty", barColor("#4a3aa7"));
const coocOption = () => lastOption("heatmapa tagow", isType("heatmap"));
const popularityOption = () => lastOption("popularnosc", isType("scatter"));
const sankeyOption = () => lastOption("sankey", isType("sankey"));

/** Formater podpowiedzi, który panel oddaje wykresowi. */
function tooltipFormatter(o: Opt): (raw: unknown) => string {
  const f = rec(o.tooltip).formatter;
  if (typeof f !== "function") throw new Error("test: wykres nie ma formatera podpowiedzi");
  return f as (raw: unknown) => string;
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
 * PO CO ZAWĘŻENIE. Tytuł i podtytuł karty są jednocześnie nagłówkami kolumn w
 * tabeli danych wykresu (alternatywa tekstowa dla kanwy), więc ten sam napis
 * występuje w dokumencie DWA RAZY i `getByText` przestał być rozstrzygalny.
 * Asercja i tak dotyczyła zawsze nagłówka karty - tu jest to powiedziane
 * wprost, zamiast liczyć na jedyność napisu w całym panelu.
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
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
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
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it("PUSTY raport to zera z pomiaru, a nie zmyślone węzły wykresów", async () => {
    // Tenant bez ruchu ma prawo zobaczyć zera - to jest pomiar. Czego NIE MA
    // prawa zobaczyć, to wykresów z wymyślonymi punktami.
    h.fetchInsights.mockResolvedValue(report());
    panel();
    await loaded();

    expect(kpiValue(dict("kpi.posts"))).toBe("0");
    expect(kpiValue(dict("kpi.views"))).toBe("0");
    expect(dataOf(topCatsOption())).toEqual([]);
    expect(dataOf(coocOption())).toEqual([]);
    expect(dataOf(popularityOption())).toEqual([]);
    expect(firstSeries(sankeyOption()).data).toEqual([]);
    expect(firstSeries(sankeyOption()).links).toEqual([]);
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
  it("słupki kategorii idą ROSNĄCO ku górze wykresu poziomego", async () => {
    // ECharts rysuje kategorie osi Y od dołu, więc panel odwraca listę. Bez
    // `.reverse()` najmocniejsza kategoria lądowałaby na dole - wykres wygląda
    // tak samo i kłamie o rankingu.
    h.fetchInsights.mockResolvedValue(
      report({ top_categories: [cat("Pierwsza", 30), cat("Druga", 20), cat("Trzecia", 10)] }),
    );
    panel();
    await loaded();

    const o = topCatsOption();
    expect(strList(rec(o.yAxis).data)).toEqual(["Trzecia", "Druga", "Pierwsza"]);
    expect(numList(firstSeries(o).data)).toEqual([10, 20, 30]);
  });

  it("ranking kategorii przycina się do 15 pozycji i zostawia te najmocniejsze", async () => {
    const cats = Array.from({ length: 18 }, (_, i) => cat(`Kategoria ${18 - i}`, 100 - i));
    h.fetchInsights.mockResolvedValue(report({ top_categories: cats }));
    panel();
    await loaded();

    const names = strList(rec(topCatsOption().yAxis).data);
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

    expect(strList(rec(topTagsOption().yAxis).data)).toHaveLength(20);
  });

  it("heatmapa jest SYMETRYCZNA i tłumaczy identyfikatory tagów na nazwy", async () => {
    // Współwystępowanie nie ma kierunku, więc każda para musi dać dwie komórki.
    // Tag spoza `top_tags` nie ma nazwy - panel pokazuje sześć znaków id zamiast
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

    const o = coocOption();
    expect(strList(rec(o.xAxis).data)).toEqual(["Energia", "Klimat", "Bezpieczenstwo", "niezna"]);
    // Osie są tożsame - macierz kwadratowa.
    expect(rec(o.yAxis).data).toEqual(rec(o.xAxis).data);
    expect(dataOf(o)).toEqual([
      [0, 1, 5],
      [1, 0, 5],
      [0, 2, 1],
      [2, 0, 1],
      [3, 1, 2],
      [1, 3, 2],
    ]);
    // Skala koloru sięga najsilniejszej pary, nie stałej.
    expect(rec(o.visualMap).max).toBe(5);
  });

  it("pusta heatmapa dostaje skalę 1, a nie zero - inaczej `visualMap` się degeneruje", async () => {
    h.fetchInsights.mockResolvedValue(report({ tag_cooccurrence: [] }));
    panel();
    await loaded();

    expect(rec(coocOption().visualMap).max).toBe(1);
  });

  it("heatmapa tnie się do 25 tagów i NIE zostawia komórek wskazujących poza macierz", async () => {
    // Indeks spoza przyciętej listy to `undefined` - gdyby trafił do komórki,
    // ECharts narysowałby ją w rogu macierzy jako fałszywe współwystępowanie.
    const pairs = Array.from({ length: 30 }, (_, i) => coPair(`tag-${i}`, `tag-${i + 1}`, i + 1));
    h.fetchInsights.mockResolvedValue(report({ tag_cooccurrence: pairs }));
    panel();
    await loaded();

    const o = coocOption();
    expect(strList(rec(o.xAxis).data)).toHaveLength(25);
    const cells = dataOf(o) as Array<[number, number, number]>;
    expect(cells.length).toBeGreaterThan(0);
    for (const [i, j] of cells) {
      expect(i).toBeLessThan(25);
      expect(j).toBeLessThan(25);
    }
  });

  it("scatter popularności niesie parę (wyświetlenia, unikalni) i przycina się do 40 wpisów", async () => {
    const rows = Array.from({ length: 45 }, (_, i) => pop(`p${i}`, `Wpis ${i}`, 100 - i, 50 - i));
    h.fetchInsights.mockResolvedValue(report({ popularity: rows }));
    panel();
    await loaded();

    const data = dataOf(popularityOption()) as Array<{ name: string; value: [number, number] }>;
    expect(data).toHaveLength(40);
    expect(data[0]).toEqual({ name: "Wpis 0", value: [100, 50] });
  });

  it("wpis BEZ tytułu pokazuje osiem znaków identyfikatora, a nie „undefined”", async () => {
    h.fetchInsights.mockResolvedValue(
      report({ popularity: [pop("abcdefgh-ijkl-mnop", null, 10, 5)] }),
    );
    panel();
    await loaded();

    const data = dataOf(popularityOption()) as Array<{ name: string }>;
    expect(data[0].name).toBe("abcdefgh");
  });

  it("rozmiar punktu rośnie z pierwiastka wyświetleń i mieści się w [6, 28]", async () => {
    h.fetchInsights.mockResolvedValue(report({ popularity: [pop("p", "Wpis", 100, 10)] }));
    panel();
    await loaded();

    const size = firstSeries(popularityOption()).symbolSize;
    if (typeof size !== "function") throw new Error("test: scatter nie ma funkcji rozmiaru");
    const fn = size as (v: number[]) => number;
    expect(fn([100, 10])).toBe(15); // sqrt(100) * 1.5
    expect(fn([0, 0])).toBe(6); // dolne ograniczenie - punkt musi być widoczny
    expect(fn([1_000_000, 0])).toBe(28); // górne ograniczenie - nie zasłania wykresu
  });

  it("sankey rozdziela ten sam wpis na węzeł ŹRÓDŁA i węzeł CELU", async () => {
    // Bez prefiksów `s:` / `t:` wpis będący jednocześnie źródłem i celem
    // zamknąłby cykl, a ECharts odmawia narysowania sankeya z cyklem - wykres
    // znikałby bez śladu w konsoli.
    h.fetchInsights.mockResolvedValue(
      report({ click_pairs: [clickPair("A", "B", 7), clickPair("B", "C", 3)] }),
    );
    panel();
    await loaded();

    const o = sankeyOption();
    const nodes = (firstSeries(o).data ?? []) as Array<{ name: string }>;
    expect(nodes.map((n) => n.name)).toEqual([
      "s:A|Zrodlo A",
      "t:B|Cel B",
      "s:B|Zrodlo B",
      "t:C|Cel C",
    ]);
    const links = (firstSeries(o).links ?? []) as Array<{ value: number }>;
    expect(links.map((l) => l.value)).toEqual([7, 3]);
  });

  it("para kliknięć BEZ tytułów buduje węzły ze skróconych identyfikatorów", async () => {
    // RPC oddaje `source_title` / `target_title` jako `null` dla wpisów
    // usuniętych albo nieopublikowanych. Węzeł musi wtedy dostać sześć znaków
    // identyfikatora, inaczej sankey rysuje dwa węzły o nazwie „undefined"
    // i skleja w nie ruch z różnych wpisów.
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

    const nodes = (firstSeries(sankeyOption()).data ?? []) as Array<{ name: string }>;
    expect(nodes.map((n) => n.name)).toEqual(["s:aaaaaaaa-1111|aaaaaa", "t:bbbbbbbb-2222|bbbbbb"]);
    expect(JSON.stringify(nodes)).not.toContain("undefined");
  });

  it("etykieta węzła sankeya obcina się do 32 znaków", async () => {
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

    const labelFn = rec(firstSeries(sankeyOption()).label).formatter;
    if (typeof labelFn !== "function") throw new Error("test: sankey nie ma formatera etykiety");
    const fn = labelFn as (p: { name: string }) => string;
    expect(fn({ name: `s:A|${longTitle}` })).toBe(longTitle.slice(0, 32));
    expect(fn({ name: `s:A|${longTitle}` })).toHaveLength(32);
    // Nazwa bez separatora nie ma prawa dać „undefined" na osi.
    expect(fn({ name: "s:A" })).toBe("");
  });

  it("hub-posty przycinają się do 12 i idą rosnąco ku górze", async () => {
    const hubs = Array.from({ length: 15 }, (_, i) => hub(`h${i}`, `Hub ${i}`, 100 - i, 5));
    h.fetchInsights.mockResolvedValue(report({ hub_targets: hubs }));
    panel();
    await loaded();

    const o = hubOption();
    const names = strList(rec(o.yAxis).data);
    expect(names).toHaveLength(12);
    expect(names[0]).toBe("Hub 11"); // najsłabszy z dwunastki na dole
    expect(names[11]).toBe("Hub 0"); // najmocniejszy na górze
    expect(numList(firstSeries(o).data)[11]).toBe(100);
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - podpowiedzi wykresów", () => {
  it("podpowiedź heatmapy składa obie nazwy tagów i liczbę wspólnych wpisów", async () => {
    h.fetchInsights.mockResolvedValue(
      report({
        top_tags: [tag("t1", "Energia"), tag("t2", "Klimat")],
        tag_cooccurrence: [coPair("t1", "t2", 5)],
      }),
    );
    panel();
    await loaded();

    const html = tooltipFormatter(coocOption())({ value: [0, 1, 5] });
    expect(html).toBe(`Energia × Klimat<br/>${dict("coocLabel")}<b>5</b>`);
    expect(html).not.toContain("adminAnalytics.");
  });

  it("podpowiedź scatteru podaje wyświetlenia i unikalnych ze słownika", async () => {
    h.fetchInsights.mockResolvedValue(report({ popularity: [pop("p", "Wpis X", 90, 40)] }));
    panel();
    await loaded();

    const html = tooltipFormatter(popularityOption())({ name: "Wpis X", value: [90, 40] });
    expect(html).toBe(`Wpis X<br/>${dict("views")}: <b>90</b><br/>${dict("uniques")}: <b>40</b>`);
  });

  it("podpowiedź sankeya rozróżnia krawędź od węzła", async () => {
    h.fetchInsights.mockResolvedValue(report({ click_pairs: [clickPair("A", "B", 7)] }));
    panel();
    await loaded();

    const fmt = tooltipFormatter(sankeyOption());
    // Krawędź mówi o liczbie kliknięć...
    expect(fmt({ dataType: "edge", value: 7 })).toBe(`7 ${dict("clicksShort")}`);
    // ...a węzeł o tytule wpisu, bez technicznego prefiksu i identyfikatora.
    expect(fmt({ dataType: "node", name: "s:A|Zrodlo A" })).toBe("Zrodlo A");
    // Węzeł bez nazwy nie ma prawa wypisać „undefined".
    expect(fmt({ dataType: "node" })).toBe("");
  });

  it("podpowiedź hub-postów łączy kliknięcia i liczbę źródeł z TEGO słupka", async () => {
    h.fetchInsights.mockResolvedValue(
      report({ hub_targets: [hub("h1", "Hub pierwszy", 40, 6), hub("h2", "Hub drugi", 10, 2)] }),
    );
    panel();
    await loaded();

    const fmt = tooltipFormatter(hubOption());
    // Lista jest odwrócona, więc indeks 0 to SŁABSZY hub - podpowiedź musi
    // czytać ten sam odwrócony porządek co oś, inaczej pokaże cudze liczby.
    expect(fmt([{ dataIndex: 0, value: 10, name: "Hub drugi" }])).toBe(
      `Hub drugi<br/>${dict("hubClicksLabel")}<b>10</b><br/>${dict("hubSourcesLabel")}2`,
    );
    expect(fmt([{ dataIndex: 1, value: 40, name: "Hub pierwszy" }])).toContain("<b>40</b>");
  });

  it("podpowiedź huba BEZ tytułu pokazuje osiem znaków identyfikatora", async () => {
    // Ta sama zasada co na osi: brak tytułu ma dać skrócony identyfikator, a
    // nie „undefined" w dymku nad słupkiem.
    h.fetchInsights.mockResolvedValue(
      report({ hub_targets: [hub("abcdefgh-1234-5678", null, 12, 3)] }),
    );
    panel();
    await loaded();

    expect(tooltipFormatter(hubOption())([{ dataIndex: 0, value: 12, name: "" }])).toContain(
      "abcdefgh<br/>",
    );
  });

  it("podpowiedź hub-postów bez wiersza nie zmyśla treści", async () => {
    h.fetchInsights.mockResolvedValue(report({ hub_targets: [hub("h1", "Hub", 1, 1)] }));
    panel();
    await loaded();

    expect(tooltipFormatter(hubOption())([])).toBe("");
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
    // Także w danych oddanych wykresom - wyciek może siedzieć w kanwie.
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

describe("RelatedPostsAnalytics - dostępność", () => {
  it("każdy z sześciu wykresów ma nazwę regionu zbudowaną z tytułu karty", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const names = screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    expect(names).toHaveLength(6);
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: dict("charts.coocTitle") }),
    );
    expect(names).toContain(
      t("adminAnalytics.chartCard.chartRegion", { title: dict("charts.sankeyTitle") }),
    );
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
    // `ChartCard` UMIE zbudować tabelę danych z `csv` i podpiąć ją przez
    // `aria-describedby`, ale panel nie podawał `csv` ANI RAZU - dla czytnika
    // ekranu wszystkie sześć wykresów było pustym prostokątem z samą nazwą.
    //
    // Asercja idzie na OBA końce powiązania: region musi mieć
    // `aria-describedby`, a wskazany identyfikator musi istnieć w dokumencie.
    // Sam atrybut bez elementu jest gorszy niż jego brak - czytnik obiecuje
    // opis i milknie.
    panel();
    await loaded();

    const regions = screen.getAllByRole("img");
    expect(regions).toHaveLength(6);
    const withoutText = regions.filter((el) => !el.getAttribute("aria-describedby"));
    expect(withoutText.map((el) => el.getAttribute("aria-label"))).toEqual([]);
    for (const region of regions) {
      const id = region.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(id), `wiszące aria-describedby: ${id}`).not.toBeNull();
    }
    // Tabela niesie te same wiersze co wykres, nie zaślepkę ze słownika.
    expect(screen.queryByText(realT("pl")("adminAnalytics.chartCard.dataTableMissing"))).toBeNull();
    expect(screen.getAllByText(realT("pl")("adminAnalytics.chartCard.dataTable"))).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - dwujęzyczność", () => {
  const TITLE_KEYS = [
    "charts.topCatsTitle",
    "charts.topTagsTitle",
    "charts.coocTitle",
    "charts.popularityTitle",
    "charts.hubTitle",
    "charts.sankeyTitle",
  ] as const;

  it("wszystkie sześć kart wykresów nazywa się ze słownika PL", async () => {
    panel();
    await loaded();

    for (const key of TITLE_KEYS) {
      expect(cardHeaderTexts()).toContain(dict(key));
      expect(cardHeaderTexts()).toContain(dict(`${key.replace("Title", "Subtitle")}`));
    }
  });

  it("ten sam panel po EN mówi po angielsku, bez ani jednego polskiego tytułu", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded("en");

    for (const key of TITLE_KEYS) {
      expect(cardHeaderTexts()).toContain(dict(key, {}, "en"));
      expect(screen.queryByText(dict(key, {}, "pl"))).toBeNull();
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
