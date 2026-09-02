// `RelatedPostsAnalytics` - pulpit silnika rekomendacji: stany, agregacja,
// interpretacja i izolacja warsztatow.
//
// PO CO. Plik stal na zerze (0/111 linii, 0/40 funkcji). Panel nie liczy nic,
// co dalo by sie sprawdzic okiem: bierze JEDEN raport z RPC i rozklada go na
// szesc wykresow oraz siedem regul interpretacyjnych. Kazda z tych operacji
// psuje sie CICHO - wykres dalej sie rysuje, kafelek dalej pokazuje liczbe,
// a administrator dostaje odwrotna rekomendacje przy niezmienionym wygladzie
// ekranu.
//
// KLASY DEFEKTOW, KTORE TEN PLIK LAPIE:
//   * ZERO UDAJACE POMIAR. „Jeszcze nie wiem", „zapytanie padlo" i „w oknie
//     naprawde nie ma danych" to trzy rozne informacje dla operatora. Panel ma
//     na nie JEDEN komunikat, wiec kazdy z tych stanow jest tu asertowany
//     osobno - a tam, gdzie sie zlewaja, stoi `it.fails`.
//   * ODWROCONA AGREGACJA. Slupki poziome sa odwracane (`.reverse()`), listy
//     przycinane (15 kategorii / 20 tagow / 25 par / 40 wpisow / 12 hubow),
//     a heatmapa symetryzowana. Przestawiony `.reverse()` daje wykres, ktory
//     wyglada poprawnie i klamie o kolejnosci.
//   * PROGI INTERPRETACJI. Siedem regul, kazda z wlasnym progiem liczbowym
//     (100 wyswietlen, CTR 3% / 1%, „mniej niz 3 wpisy" razy 3 kategorie,
//     50 wyswietlen, srednia 2 wspolnych wpisow, 5 klikniec huba, 3 wpisy
//     rozjazdu). Zamieniony znak porownania nie wywraca panelu - podsuwa
//     odwrotne dzialanie naprawcze.
//   * OKABLOWANIE FILTRA OKNA. Zmiana zakresu ma przestawic WEJSCIE zapytania,
//     nie tylko etykiete, dlatego asercje ida na argument funkcji serwerowej.
//   * IZOLACJA WARSZTATOW. Klucz cache to `["related-insights", days]` - nie ma
//     w nim ani tenanta, ani uzytkownika. Test dowodzi, ze przy swiezym
//     kliencie panel warsztatu B nie widzi wierszy warsztatu A, i przypina
//     `it.fails` sytuacje, w ktorej klient react-query przezywa przelaczenie.
//   * SLOWNIK. Asercje ida przez `realT("pl")` i `realT("en")`, czyli te sama
//     instancje i18next, ktora widzi uzytkownik: usuniety klucz wypada surowym
//     `adminAnalytics.…`, a brak klucza EN cicho spada na polski fallback.
//
// ECHARTS JEST TU ZAKAZANY (patrz naglowek `EChart.tsx`): podmieniamy `EChart`
// atrapa, ktora PRZECHWYTUJE `option`. Dzieki temu asercje o kolejnosci,
// przycinaniu i podpowiedziach ida na strukture danych oddana wykresowi, a nie
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
  charts: [] as Array<{ option: Record<string, unknown> }>,
}));

// `useServerFn` staje sie tozsamoscia - wywolanie idzie prosto do atrapy.
// Mock CZESCIOWY, bo `@/lib/i18n` ciagnie z tego samego pakietu
// `createIsomorphicFn`, a pelna atrapa wywracalaby inicjalizacje slownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/relatedInsights.functions", () => ({
  getRelatedInsights: (...args: unknown[]) => h.fetchInsights(...args),
}));

// Atrapa wykresu zapisuje `option`. To jedyne miejsce, w ktorym widac, CO panel
// policzyl - i jedyny sposob na dowiedzenie kolejnosci bez wciagania echarts.
vi.mock("../EChart", () => ({
  EChart: ({ option }: { option: Record<string, unknown> }) => {
    h.charts.push({ option });
    return <div data-testid="echart" />;
  },
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujezyczny, a przedmiotem
// dowodu jest to, ze napisy przychodza ZE SLOWNIKA. Jezyk przestawia sie przez
// `i18n.changeLanguage`.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { RelatedPostsAnalytics } from "../RelatedPostsAnalytics";

// ---------------------------------------------------------------------------
// Slownik
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

/** Nadpisanie raportu; `summary` jest CZESCIOWE, bo prawie kazdy prog
 *  interpretacji zalezy od jednej albo dwoch liczb z podsumowania. */
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

/** Raport „warsztatu A" - kazdy napis jest unikalny, zeby wyciek bylo widac. */
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

/** Raport „warsztatu B" - rozlaczny z A na kazdym napisie. */
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
function numList(v: unknown): number[] {
  return Array.isArray(v) ? (v as unknown[]).map(Number) : [];
}

/** OSTATNI przechwycony wykres pasujacy do predykatu - czyli stan po ostatnim renderze. */
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

/** Formater podpowiedzi, ktory panel oddaje wykresowi. */
function tooltipFormatter(o: Opt): (raw: unknown) => string {
  const f = rec(o.tooltip).formatter;
  if (typeof f !== "function") throw new Error("test: wykres nie ma formatera podpowiedzi");
  return f as (raw: unknown) => string;
}

/** Wejscia, z jakimi panel wolal funkcje serwerowa. */
function queryInputs(): Array<{ days: number }> {
  return h.fetchInsights.mock.calls.map((c) => (c[0] as { data: { days: number } }).data);
}

/** Wartosc kafelka KPI stojaca przy podanej etykiecie. */
function kpiValue(label: string): string {
  const box = screen.getByText(label).closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI „${label}"`);
  return box.lastElementChild?.textContent ?? "";
}

/** Karta „Interpretacja i rekomendacje" - jedyne miejsce z wnioskami panelu. */
function insightCard(): HTMLElement {
  // `getByText`, nie `getByRole("heading")`: w stanie PUSTYM `InsightSection`
  // renderuje tytul zwyklym `div`-em, wiec szukanie roli gubiloby dokladnie te
  // przypadki, w ktorych dowodzimy, ze zaden prog sie nie zapalil.
  const card = screen.getByText(dict("insightsTitle")).closest("div.p-4");
  if (!card) throw new Error("test: nie znaleziono karty interpretacji");
  return card as HTMLElement;
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

/** Czeka az raport dojedzie i panel przelaczy sie z komunikatu na siatke KPI. */
async function loaded(lang: AppLang = "pl"): Promise<void> {
  await screen.findByText(dict("kpi.posts", {}, lang));
}

/** Czeka az zapytanie sie rozstrzygnie - takze wtedy, gdy padlo. */
async function settled(): Promise<void> {
  await waitFor(() => expect(h.fetchInsights).toHaveBeenCalled());
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
  h.fetchInsights.mockReset();
  h.fetchInsights.mockResolvedValue(WORKSPACE_A);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - stany panelu", () => {
  it("w trakcie pobierania pokazuje wskaznik ladowania i ANI JEDNEGO kafelka KPI", async () => {
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    panel();

    expect(await screen.findByText(common("loading"))).toBeInTheDocument();
    // Zero i „jeszcze nie wiem" to dwie rozne informacje - dopoki raport nie
    // dojedzie, panel nie ma prawa narysowac ani kafelka, ani wykresu.
    expect(screen.queryByText(dict("kpi.posts"))).toBeNull();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it.fails("DEFEKT: w trakcie ladowania panel twierdzi, ze w oknie NIE MA danych", async () => {
    // `!report` obsluguje jednym komunikatem dwa rozne stany: „jeszcze nie
    // wiem" i „wiem, ze pusto". Operator patrzacy na „Brak danych w oknie."
    // w pierwszej sekundzie po wejsciu dostaje twierdzenie o pomiarze, ktory
    // sie jeszcze nie odbyl. Wskaznik ladowania stoi obok, ale to on jest
    // dopiskiem, a nie tamten komunikat.
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    panel();
    await screen.findByText(common("loading"));

    expect(screen.queryByText(common("noDataWindow"))).toBeNull();
  });

  it("brak raportu pokazuje komunikat o braku danych ze slownika", async () => {
    // Panel bez raportu to JEDEN komunikat - zadnego kafelka, zadnego wykresu.
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    panel();

    expect(await screen.findByText(common("noDataWindow"))).toBeInTheDocument();
  });

  it("PUSTY raport to zera z pomiaru, a nie zmyslone wezly wykresow", async () => {
    // Tenant bez ruchu ma prawo zobaczyc zera - to jest pomiar. Czego NIE MA
    // prawa zobaczyc, to wykresow z wymyslonymi punktami.
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
    // Zaden prog interpretacji sie nie zapala, wiec sekcja jest w stanie pustym.
    expect(
      screen.getByText(realT("pl")("adminAnalytics.insightSection.emptyDefault")),
    ).toBeInTheDocument();
  });

  it("po awarii zapytania pasek narzedzi zyje - operator moze zmienic okno i ponowic", async () => {
    h.fetchInsights.mockRejectedValue(new Error("RPC 500: related_posts_signals failed"));
    panel();
    await settled();

    expect(screen.getByRole("button", { name: common("refresh") })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset7d") }),
    ).toBeInTheDocument();
  });

  it.fails("DEFEKT: awaria zapytania wyglada DOKLADNIE jak pusty raport", async () => {
    // Blizniaczy pulpit GA4 z tego samego modulu renderuje w tej sytuacji karte
    // bledu. Tutaj `query.error` nie jest w ogole czytany: panel rysuje
    // „Brak danych w oknie.", czyli twierdzi o pomiarze, ktorego nie bylo.
    // Administrator widzi „silnik rekomendacji nie ma danych" tam, gdzie w
    // rzeczywistosci padlo RPC.
    h.fetchInsights.mockRejectedValue(new Error("RPC 500: related_posts_signals failed"));
    const { container } = panel();
    await settled();

    expect(container.textContent ?? "").toMatch(/500|b[lł][aą]d|error/i);
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - okno czasu i wejscie zapytania", () => {
  it("startowe okno to 30 dni i tyle trafia do WEJSCIA funkcji serwerowej", async () => {
    panel();
    await loaded();

    expect(queryInputs()).toEqual([{ days: 30 }]);
  });

  it("zmiana presetu na 7 dni przestawia WEJSCIE zapytania, nie tylko etykiete", async () => {
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
    // `days` idzie do walidatora `z.number().int().min(1)` - okno krotsze niz
    // doba musi zaokraglic sie w gore, inaczej zapytanie zostanie odrzucone.
    panel();
    await loaded();
    const before = h.fetchInsights.mock.calls.length;

    fireEvent.click(
      screen.getByRole("button", { name: realT("pl")("adminAnalytics.timeRange.preset24h") }),
    );

    await waitFor(() => expect(h.fetchInsights.mock.calls.length).toBeGreaterThan(before));
    expect(queryInputs().slice(before)).toEqual([{ days: 1 }]);
  });

  it("„Odswiez” ponawia zapytanie z tym samym oknem", async () => {
    panel();
    await loaded();
    const before = h.fetchInsights.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: common("refresh") }));

    await waitFor(() => expect(h.fetchInsights.mock.calls.length).toBe(before + 1));
    expect(queryInputs()[before]).toEqual({ days: 30 });
  });

  it("podpis okna bierze liczbe dni Z RAPORTU, a nie z ustawienia filtra", async () => {
    // Serwer moze zwrocic wezsze okno niz zamowione (np. tenant ma krotsza
    // historie). Podpis ma mowic, co POKAZUJE wykres, a nie co zamowiono.
    h.fetchInsights.mockResolvedValue(report({ summary: { window_days: 14 } }));
    panel();
    await loaded();

    expect(screen.getByText(dict("windowInfo", { days: 14 }))).toBeInTheDocument();
    expect(screen.queryByText(dict("windowInfo", { days: 30 }))).toBeNull();
  });

  it("przed odpowiedzia podpis okna pokazuje okno filtra, a nie puste miejsce", async () => {
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    panel();

    expect(await screen.findByText(dict("windowInfo", { days: 30 }))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - agregacja danych w wykresach", () => {
  it("slupki kategorii ida ROSNACO ku gorze wykresu poziomego", async () => {
    // ECharts rysuje kategorie osi Y od dolu, wiec panel odwraca liste. Bez
    // `.reverse()` najmocniejsza kategoria ladowalaby na dole - wykres wyglada
    // tak samo i klamie o rankingu.
    h.fetchInsights.mockResolvedValue(
      report({ top_categories: [cat("Pierwsza", 30), cat("Druga", 20), cat("Trzecia", 10)] }),
    );
    panel();
    await loaded();

    const o = topCatsOption();
    expect(strList(rec(o.yAxis).data)).toEqual(["Trzecia", "Druga", "Pierwsza"]);
    expect(numList(firstSeries(o).data)).toEqual([10, 20, 30]);
  });

  it("ranking kategorii przycina sie do 15 pozycji i zostawia te najmocniejsze", async () => {
    const cats = Array.from({ length: 18 }, (_, i) => cat(`Kategoria ${18 - i}`, 100 - i));
    h.fetchInsights.mockResolvedValue(report({ top_categories: cats }));
    panel();
    await loaded();

    const names = strList(rec(topCatsOption().yAxis).data);
    expect(names).toHaveLength(15);
    // Odciete sa OSTATNIE trzy (najslabsze), nie pierwsze.
    expect(names).toContain("Kategoria 18");
    expect(names).not.toContain("Kategoria 3");
  });

  it("ranking tagow przycina sie do 20 pozycji", async () => {
    const tags = Array.from({ length: 24 }, (_, i) => tag(`t${i}`, `tag-${i}`, 100 - i));
    h.fetchInsights.mockResolvedValue(report({ top_tags: tags }));
    panel();
    await loaded();

    expect(strList(rec(topTagsOption().yAxis).data)).toHaveLength(20);
  });

  it("heatmapa jest SYMETRYCZNA i tlumaczy identyfikatory tagow na nazwy", async () => {
    // Wspolwystepowanie nie ma kierunku, wiec kazda para musi dac dwie komorki.
    // Tag spoza `top_tags` nie ma nazwy - panel pokazuje sesc znakow id zamiast
    // pustki, i to tez jest kontrakt.
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
    // Osie sa tozsame - macierz kwadratowa.
    expect(rec(o.yAxis).data).toEqual(rec(o.xAxis).data);
    expect(dataOf(o)).toEqual([
      [0, 1, 5],
      [1, 0, 5],
      [0, 2, 1],
      [2, 0, 1],
      [3, 1, 2],
      [1, 3, 2],
    ]);
    // Skala koloru siega najsilniejszej pary, nie stalej.
    expect(rec(o.visualMap).max).toBe(5);
  });

  it("pusta heatmapa dostaje skale 1, a nie zero - inaczej `visualMap` sie degeneruje", async () => {
    h.fetchInsights.mockResolvedValue(report({ tag_cooccurrence: [] }));
    panel();
    await loaded();

    expect(rec(coocOption().visualMap).max).toBe(1);
  });

  it("heatmapa tnie sie do 25 tagow i NIE zostawia komorek wskazujacych poza macierz", async () => {
    // Indeks spoza przycietej listy to `undefined` - gdyby trafil do komorki,
    // ECharts narysowalby ja w rogu macierzy jako fałszywe wspolwystepowanie.
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

  it("scatter popularnosci niesie pare (wyswietlenia, unikalni) i przycina sie do 40 wpisow", async () => {
    const rows = Array.from({ length: 45 }, (_, i) => pop(`p${i}`, `Wpis ${i}`, 100 - i, 50 - i));
    h.fetchInsights.mockResolvedValue(report({ popularity: rows }));
    panel();
    await loaded();

    const data = dataOf(popularityOption()) as Array<{ name: string; value: [number, number] }>;
    expect(data).toHaveLength(40);
    expect(data[0]).toEqual({ name: "Wpis 0", value: [100, 50] });
  });

  it("wpis BEZ tytulu pokazuje osiem znakow identyfikatora, a nie „undefined”", async () => {
    h.fetchInsights.mockResolvedValue(
      report({ popularity: [pop("abcdefgh-ijkl-mnop", null, 10, 5)] }),
    );
    panel();
    await loaded();

    const data = dataOf(popularityOption()) as Array<{ name: string }>;
    expect(data[0].name).toBe("abcdefgh");
  });

  it("rozmiar punktu rosnie z pierwiastka wyswietlen i miesci sie w [6, 28]", async () => {
    h.fetchInsights.mockResolvedValue(report({ popularity: [pop("p", "Wpis", 100, 10)] }));
    panel();
    await loaded();

    const size = firstSeries(popularityOption()).symbolSize;
    if (typeof size !== "function") throw new Error("test: scatter nie ma funkcji rozmiaru");
    const fn = size as (v: number[]) => number;
    expect(fn([100, 10])).toBe(15); // sqrt(100) * 1.5
    expect(fn([0, 0])).toBe(6); // dolne ograniczenie - punkt musi byc widoczny
    expect(fn([1_000_000, 0])).toBe(28); // gorne ograniczenie - nie zaslania wykresu
  });

  it("sankey rozdziela ten sam wpis na wezel ZRODLA i wezel CELU", async () => {
    // Bez prefiksow `s:` / `t:` wpis bedacy jednoczesnie zrodlem i celem
    // zamknalby cykl, a ECharts odmawia narysowania sankeya z cyklem - wykres
    // znikalby bez sladu w konsoli.
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

  it("para klikniec BEZ tytulow buduje wezly ze skroconych identyfikatorow", async () => {
    // RPC oddaje `source_title` / `target_title` jako `null` dla wpisow
    // usunietych albo nieopublikowanych. Wezel musi wtedy dostac szesc znakow
    // identyfikatora, inaczej sankey rysuje dwa wezly o nazwie „undefined"
    // i skleja w nie ruch z roznych wpisow.
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

  it("etykieta wezla sankeya obcina sie do 32 znakow", async () => {
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
    // Nazwa bez separatora nie ma prawa dac „undefined" na osi.
    expect(fn({ name: "s:A" })).toBe("");
  });

  it("hub-posty przycinaja sie do 12 i ida rosnaco ku gorze", async () => {
    const hubs = Array.from({ length: 15 }, (_, i) => hub(`h${i}`, `Hub ${i}`, 100 - i, 5));
    h.fetchInsights.mockResolvedValue(report({ hub_targets: hubs }));
    panel();
    await loaded();

    const o = hubOption();
    const names = strList(rec(o.yAxis).data);
    expect(names).toHaveLength(12);
    expect(names[0]).toBe("Hub 11"); // najslabszy z dwunastki na dole
    expect(names[11]).toBe("Hub 0"); // najmocniejszy na gorze
    expect(numList(firstSeries(o).data)[11]).toBe(100);
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - podpowiedzi wykresow", () => {
  it("podpowiedz heatmapy sklada obie nazwy tagow i liczbe wspolnych wpisow", async () => {
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

  it("podpowiedz scatteru podaje wyswietlenia i unikalnych ze slownika", async () => {
    h.fetchInsights.mockResolvedValue(report({ popularity: [pop("p", "Wpis X", 90, 40)] }));
    panel();
    await loaded();

    const html = tooltipFormatter(popularityOption())({ name: "Wpis X", value: [90, 40] });
    expect(html).toBe(`Wpis X<br/>${dict("views")}: <b>90</b><br/>${dict("uniques")}: <b>40</b>`);
  });

  it("podpowiedz sankeya rozroznia krawedz od wezla", async () => {
    h.fetchInsights.mockResolvedValue(report({ click_pairs: [clickPair("A", "B", 7)] }));
    panel();
    await loaded();

    const fmt = tooltipFormatter(sankeyOption());
    // Krawedz mowi o liczbie klikniec...
    expect(fmt({ dataType: "edge", value: 7 })).toBe(`7 ${dict("clicksShort")}`);
    // ...a wezel o tytule wpisu, bez technicznego prefiksu i identyfikatora.
    expect(fmt({ dataType: "node", name: "s:A|Zrodlo A" })).toBe("Zrodlo A");
    // Wezel bez nazwy nie ma prawa wypisac „undefined".
    expect(fmt({ dataType: "node" })).toBe("");
  });

  it("podpowiedz hub-postow laczy klikniecia i liczbe zrodel z TEGO slupka", async () => {
    h.fetchInsights.mockResolvedValue(
      report({ hub_targets: [hub("h1", "Hub pierwszy", 40, 6), hub("h2", "Hub drugi", 10, 2)] }),
    );
    panel();
    await loaded();

    const fmt = tooltipFormatter(hubOption());
    // Lista jest odwrocona, wiec indeks 0 to SLABSZY hub - podpowiedz musi
    // czytac ten sam odwrocony porzadek co os, inaczej pokaze cudze liczby.
    expect(fmt([{ dataIndex: 0, value: 10, name: "Hub drugi" }])).toBe(
      `Hub drugi<br/>${dict("hubClicksLabel")}<b>10</b><br/>${dict("hubSourcesLabel")}2`,
    );
    expect(fmt([{ dataIndex: 1, value: 40, name: "Hub pierwszy" }])).toContain("<b>40</b>");
  });

  it("podpowiedz huba BEZ tytulu pokazuje osiem znakow identyfikatora", async () => {
    // Ta sama zasada co na osi: brak tytulu ma dac skrocony identyfikator, a
    // nie „undefined" w dymku nad slupkiem.
    h.fetchInsights.mockResolvedValue(
      report({ hub_targets: [hub("abcdefgh-1234-5678", null, 12, 3)] }),
    );
    panel();
    await loaded();

    expect(tooltipFormatter(hubOption())([{ dataIndex: 0, value: 12, name: "" }])).toContain(
      "abcdefgh<br/>",
    );
  });

  it("podpowiedz hub-postow bez wiersza nie zmysla tresci", async () => {
    h.fetchInsights.mockResolvedValue(report({ hub_targets: [hub("h1", "Hub", 1, 1)] }));
    panel();
    await loaded();

    expect(tooltipFormatter(hubOption())([])).toBe("");
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - kafelki KPI", () => {
  it("liczby powyzej tysiaca skracaja sie do „k”, a mniejsze ida doslownie", async () => {
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

  it("wartosc spoza zakresu liczb pokazuje kreske, a nie „NaN”", async () => {
    // RPC oddaje jsonb - pole, ktorego zabraklo w agregacie SQL, dojedzie jako
    // `null` i po arytmetyce w kafelku zrobi sie z niego `NaN`. Kreska mowi
    // „nie wiem"; „NaN" na pulpicie mowi tylko, ze cos jest zepsute.
    h.fetchInsights.mockResolvedValue(report({ summary: { total_posts: Number.NaN } }));
    panel();
    await loaded();

    expect(kpiValue(dict("kpi.posts"))).toBe("-");
    expect(document.body.textContent ?? "").not.toContain("NaN");
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - interpretacja sygnalow", () => {
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
    // Odznaka „krytycznych" wystawia licznik - kolor paska to za malo.
    expect(
      within(card).getByText(
        realT("pl")("adminAnalytics.insightSection.badgeCritical", { count: 1 }),
      ),
    ).toBeInTheDocument();
    for (const fix of dictList("insights.noClicks.fixes")) {
      expect(within(card).getByText(fix)).toBeInTheDocument();
    }
  });

  it("DOKLADNIE 100 wyswietlen bez klikow nie zapala ani ostrzezenia, ani CTR", async () => {
    // Prog to `> 100`, nie `>= 100`. Jeden wiersz mniej i panel milczy o CTR -
    // to jest swiadoma luka w regule, a nie przeoczenie testu.
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

  it("CTR 1% to OBSERWACJA, ale juz z lista naprawcza", async () => {
    // Dwa lancuchy `if` nad ta sama liczba: severity lamie sie na 3 i 1, a
    // lista fiksow TYLKO na 3. Prog 1% jest wiec granica, na ktorej te dwie
    // decyzje sie rozjezdzaja - i dlatego ma wlasny przypadek.
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

  it("CTR ponizej 1% to OSTRZEZENIE", async () => {
    const card = await withSummary({
      summary: { total_views: 1000, total_clicks: 9, total_reads: 40 },
    });

    expect(within(card).getByText(dict("insights.ctr.title", { ctr: "0.90" }))).toBeInTheDocument();
    expect(
      within(card).getByText(realT("pl")("adminAnalytics.insightSection.badgeWarn", { count: 1 })),
    ).toBeInTheDocument();
  });

  it("trzy kategorie z mniej niz trzema wpisami zapalaja ostrzezenie o strukturze", async () => {
    const card = await withSummary({
      top_categories: [cat("A", 1), cat("B", 2), cat("C", 1), cat("D", 9)],
    });

    expect(
      within(card).getByText(dict("insights.smallCats.title", { count: 3 })),
    ).toBeInTheDocument();
  });

  it("kategoria PUSTA i kategoria z trzema wpisami nie licza sie do ostrzezenia", async () => {
    // Prog to `posts_count > 0 && < 3`. Kategoria bez wpisow jest problemem
    // innego rodzaju (do usuniecia, nie do scalenia), a trzy wpisy to juz
    // minimum, ktore silnik obsluzy.
    const card = await withSummary({
      top_categories: [cat("A", 0), cat("B", 0), cat("C", 3), cat("D", 1), cat("E", 1)],
    });

    expect(within(card).queryByText(dict("insights.smallCats.element"))).toBeNull();
  });

  it("brak historii czytania przy ruchu powyzej 50 wyswietlen to obserwacja", async () => {
    const card = await withSummary({ summary: { total_views: 51, total_reads: 0 } });

    expect(within(card).getByText(dict("insights.noReads.title"))).toBeInTheDocument();
  });

  it("przy 50 wyswietleniach panel jeszcze NIE wnioskuje o personalizacji", async () => {
    const card = await withSummary({ summary: { total_views: 50, total_reads: 0 } });

    expect(within(card).queryByText(dict("insights.noReads.element"))).toBeNull();
  });

  it("srednia ponizej 2 wspolnych wpisow to RZADKI graf tagow", async () => {
    const card = await withSummary({
      tag_cooccurrence: [coPair("a", "b", 1), coPair("b", "c", 2)], // srednia 1.5
    });

    expect(
      within(card).getByText(dict("insights.sparseTags.detail", { avg: "1.5" })),
    ).toBeInTheDocument();
    expect(within(card).queryByText(dict("insights.healthyTags.title"))).toBeNull();
  });

  it("srednia DOKLADNIE 2 to juz graf ZDROWY - bez listy dzialan", async () => {
    const card = await withSummary({
      tag_cooccurrence: [coPair("a", "b", 1), coPair("b", "c", 3)], // srednia 2.0
    });

    expect(within(card).getByText(dict("insights.healthyTags.title"))).toBeInTheDocument();
    expect(
      within(card).getByText(dict("insights.healthyTags.detail", { avg: "2.0" })),
    ).toBeInTheDocument();
  });

  it("hub z pieciu klikniec zapala wpis o wchlanianiu ruchu", async () => {
    const card = await withSummary({ hub_targets: [hub("h1", "Wielki hub", 5, 3)] });

    expect(
      within(card).getByText(dict("insights.hub.title", { name: "Wielki hub" })),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(dict("insights.hub.detail", { clicks: 5, sources: 3 })),
    ).toBeInTheDocument();
  });

  it("hub BEZ tytulu pokazuje osiem znakow identyfikatora, nie „undefined”", async () => {
    const card = await withSummary({ hub_targets: [hub("abcdefgh-1234", null, 9, 2)] });

    expect(
      within(card).getByText(dict("insights.hub.title", { name: "abcdefgh" })),
    ).toBeInTheDocument();
  });

  it("cztery klikniecia to za malo na wpis o hubie", async () => {
    const card = await withSummary({ hub_targets: [hub("h1", "Prawie hub", 4, 3)] });

    expect(within(card).queryByText(dict("insights.hub.element"))).toBeNull();
  });

  it("trzy popularne wpisy spoza hubow to ostrzezenie o rozjezdzie", async () => {
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

  it("dwa popularne wpisy spoza hubow to jeszcze nie rozjazd", async () => {
    const card = await withSummary({
      popularity: [pop("p1", "Pop 1", 100, 50), pop("p2", "Pop 2", 90, 40), pop("h1", "Hub", 5, 2)],
      hub_targets: [hub("h1", "Hub", 20, 4)],
    });

    expect(within(card).queryByText(dict("insights.mismatch.element"))).toBeNull();
  });

  it("bez hub-postow regula rozjazdu w ogole sie nie uruchamia", async () => {
    // `pop.length > 0 && hubs.length > 0` - bez celow klikniec nie ma z czym
    // porownac popularnosci, wiec panel nie ma prawa oskarzyc silnika.
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

  it("kazdy wpis interpretacji jest GOTOWYM tekstem - bez surowych kluczy, „{{}}” i NaN", async () => {
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

describe("RelatedPostsAnalytics - izolacja warsztatow", () => {
  it("panel warsztatu B pokazuje WYLACZNIE wiersze warsztatu B", async () => {
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
    // Takze w danych oddanych wykresom - wyciek moze siedziec w kanwie.
    expect(JSON.stringify(h.charts)).not.toContain("Alfa");
  });

  it("swiezy klient react-query nie przenosi raportu miedzy warsztatami", async () => {
    // Sciezka produkcyjna przy przeladowaniu panelu: nowy klient, nowy odczyt.
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

  it.fails(
    "DEFEKT: klucz cache nie niesie warsztatu, wiec panel B maluje raport warsztatu A",
    async () => {
      // `queryKey: ["related-insights", range.days]` nie zawiera ani tenanta,
      // ani uzytkownika. Gdy klient react-query przezywa przelaczenie warsztatu
      // (a przezywa - jest tworzony raz na aplikacje), panel warsztatu B trafia
      // w TEN SAM wpis cache. Przy `staleTime: 60_000` dane sa jeszcze swieze,
      // wiec react-query NIE ponawia zapytania: administrator warsztatu B widzi
      // kategorie, tagi, huby i tytuly wpisow warsztatu A, i to bez ani jednego
      // zadania sieciowego. Wyciek jest calkowicie cichy - widac go wylacznie
      // na ekranie.
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      h.fetchInsights.mockResolvedValue(WORKSPACE_A);
      const first = panel(client);
      await loaded();
      first.unmount();

      h.fetchInsights.mockResolvedValue(WORKSPACE_B);
      const second = panel(client);
      await loaded();

      expect(second.container.textContent ?? "").not.toContain("Alfa hub wlasny");
    },
  );
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - dostepnosc", () => {
  it("kazdy z szesciu wykresow ma nazwe regionu zbudowana z tytulu karty", async () => {
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

  it("poza nienazwanymi przyciskami panel nie ma innych naruszen axe", async () => {
    const { container } = panel();
    await loaded();

    // Regule `button-name` wylaczamy TYLKO tutaj i tylko po to, zeby jeden
    // znany defekt (test nizej) nie przykrywal wszystkiego innego: kolejnosci
    // naglowkow, poprawnosci ARIA i semantyki list.
    expect(summarize(await axeViolations(container, { "button-name": { enabled: false } }))).toBe(
      "",
    );
  });

  it("karta braku danych jest wolna od naruszen axe", async () => {
    h.fetchInsights.mockImplementation(() => new Promise<RelatedInsightsResult>(() => {}));
    const { container } = panel();
    await screen.findByText(common("noDataWindow"));

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it.fails("DEFEKT: przyciski „wiecej” na kartach wykresow nie maja dostepnej nazwy", async () => {
    // `ChartCard` daje `aria-label` przyciskowi pelnego ekranu, ale przycisk
    // menu obok to sama ikona `MoreHorizontal`. Szesc wykresow = szesc
    // bezimiennych przyciskow, przez ktore chodzi eksport PNG/CSV.
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it.fails("DEFEKT: zaden wykres panelu nie dostaje tekstowej alternatywy", async () => {
    // `ChartCard` UMIE zbudowac tabele danych z `csv` i podpiac ja przez
    // `aria-describedby`. Ten panel nie podaje `csv` ANI RAZU, wiec dla
    // czytnika ekranu wszystkie szesc wykresow to pusty prostokat z sama
    // nazwa. Slownik ma nawet gotowy komunikat na te sytuacje
    // (`chartCard.dataTableMissing`), ktorego nikt nie uzywa.
    panel();
    await loaded();

    const withoutText = screen
      .getAllByRole("img")
      .filter((el) => !el.getAttribute("aria-describedby"));
    expect(withoutText.map((el) => el.getAttribute("aria-label"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - dwujezycznosc", () => {
  const TITLE_KEYS = [
    "charts.topCatsTitle",
    "charts.topTagsTitle",
    "charts.coocTitle",
    "charts.popularityTitle",
    "charts.hubTitle",
    "charts.sankeyTitle",
  ] as const;

  it("wszystkie szesc kart wykresow nazywa sie ze slownika PL", async () => {
    panel();
    await loaded();

    for (const key of TITLE_KEYS) {
      expect(screen.getByText(dict(key))).toBeInTheDocument();
      expect(screen.getByText(dict(`${key.replace("Title", "Subtitle")}`))).toBeInTheDocument();
    }
  });

  it("ten sam panel po EN mowi po angielsku, bez ani jednego polskiego tytulu", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded("en");

    for (const key of TITLE_KEYS) {
      expect(screen.getByText(dict(key, {}, "en"))).toBeInTheDocument();
      expect(screen.queryByText(dict(key, {}, "pl"))).toBeNull();
    }
    // Kafelki i podpis okna tez, nie tylko naglowki kart.
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

  it("slownik EN ma DOKLADNIE te same klucze i tak samo dlugie listy co PL", async () => {
    // Brakujacy klucz EN nie wywala aplikacji - cicho spada na polski tekst na
    // angielskim ekranie. Krotsza lista `fixes` gubi jedno dzialanie naprawcze.
    const pl = shape(subtree("pl", ["adminAnalytics", "related"]));
    const en = shape(subtree("en", ["adminAnalytics", "related"]));

    expect(pl.size).toBeGreaterThan(30);
    expect(Object.fromEntries(en)).toEqual(Object.fromEntries(pl));
  });
});

// ---------------------------------------------------------------------------

describe("RelatedPostsAnalytics - odswiezanie", () => {
  it("w trakcie ponowienia przycisk „Odswiez” NIE blokuje sie na stale", async () => {
    // `disabled={isLoading}` patrzy na PIERWSZE ladowanie, nie na `isFetching`.
    // Po odpowiedzi przycisk ma byc znowu klikalny, inaczej operator utknie.
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
