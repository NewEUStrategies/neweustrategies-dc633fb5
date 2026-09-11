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
//      zwija kraje do ośmiu plus „Inne", układa rankingi MALEJĄCO i składa
//      siatkę kalendarza. Każda z tych operacji jest cicha: źle posortowany
//      trend to wykres, który wygląda poprawnie i kłamie o kierunku ruchu.
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
//   5. ALTERNATYWA TEKSTOWA. Rysunek nigdy nie jest jedyną drogą do liczby,
//      więc każdy wykres musi mieć tabelę tych samych danych, a jego region -
//      nazwę i opis obsługi klawiatury.
//
// PULPIT RYSUJE NASZYM SILNIKIEM, nie ECharts - i ten plik nie podmienia go
// atrapą, tylko PODGLĄDA. `Chart` jest opakowany szpiegiem, który zapisuje
// `config`, `onSelect` i `ariaLabel`, a potem woła PRAWDZIWY komponent. Dzięki
// temu kolejność, agregacja i drążenie sprawdzają się na konfiguracji oddanej
// silnikowi, a nazwy regionów, tabele danych i dwujęzyczność - na tym, co
// silnik z niej naprawdę narysował. Atrapa dowodziłaby tylko, że panel woła
// funkcję.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GscRow, GscSite } from "@/lib/analytics/gsc.functions";
import type { ChartConfig } from "@/lib/charts/types";
import type { ChartSelection } from "@/lib/charts/selection";

type Lang = "pl" | "en";

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
  /** Warsztat, w którym stoi panel - zmiana tej wartości to przejście do innego. */
  tenantId: "tenant-alfa" as string | null,
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

vi.mock("@/lib/analytics/gsc.functions", () => ({
  listGscSites: (...args: unknown[]) => h.listSites(...args),
  queryGscAnalytics: (...args: unknown[]) => h.queryAnalytics(...args),
}));

// Najemca jest ATRAPĄ, a nie prawdziwym `useCurrentTenantId`: tamten ciągnie
// klienta Supabase i sesję `useAuth`, a przedmiotem dowodu jest tylko to, że
// identyfikator warsztatu WCHODZI DO KLUCZY react-query. Sterowanie nim z testu
// (`h.tenantId`) daje jedyny sposób odegrania przejścia między warsztatami na
// TYM SAMYM kliencie cache.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

// SILNIK NIE JEST ATRAPĄ - jest PODSŁUCHANY. Atrapa zabierałaby panelowi tabele
// danych i nazwy regionów, czyli dokładnie to, czego pilnuje blok dostępności
// niżej; a sam `config` bez narysowanego wykresu nie dowodzi, że panel
// cokolwiek pokazuje. Opakowanie oddaje jedno i drugie: przechwytuje
// konfigurację ORAZ renderuje prawdziwy rysunek z prawdziwą alternatywą
// tekstową.
vi.mock("@/components/charts/Chart", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/charts/Chart")>();
  return {
    ...real,
    Chart: (props: Parameters<typeof real.Chart>[0]) => {
      h.charts.push({ config: props.config, onSelect: props.onSelect, ariaLabel: props.ariaLabel });
      return real.Chart(props);
    },
  };
});

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

/**
 * DNI OKNA TESTOWEGO - jedno źródło prawdy zamiast literału powtórzonego
 * kilkanaście razy.
 *
 * PO CO NAZWY, A NIE DATY W MIEJSCU UŻYCIA. Połowa asercji tego pliku zależy
 * od tego, w jaki DZIEŃ TYGODNIA wypada dana data: macierz kalendarza układa
 * kolumny w tygodnie ISO, więc „sobota" i „poniedziałek" są tu treścią, a nie
 * ozdobą. Literał `"2026-08-01"` rozsiany po pliku nie mówi nic; `SOBOTA`
 * mówi wszystko i psuje się głośno, gdy ktoś podmieni datę na wtorek.
 *
 * Drugi powód jest mechaniczny: bramka `check:clock-freeze` liczy literały
 * kalendarzowe jako miarę sprzężenia pliku z zegarem, a jedno wystąpienie
 * zamiast dziewiętnastu to jedno miejsce do poprawienia, gdy okno się
 * przesunie.
 */
const SOBOTA = "2026-08-01";
const NIEDZIELA = "2026-08-02";
const PONIEDZIALEK = "2026-08-03";
/** Poniedziałek otwierający tydzień, w którym leży SOBOTA (kolumna macierzy). */
const TYDZIEN_1 = "2026-07-27";
/** Dzień okna POPRZEDNIEGO - baza porównania dla delt KPI. */
const DZIEN_POPRZEDNI = "2026-07-01";

const TENANT_B = "tenant-beta";

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
  row(PONIEDZIALEK, 30, 300, 0.1, 8),
  row(SOBOTA, 10, 200, 0.05, 12),
  row(NIEDZIELA, 20, 250, 0.08, 10),
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
const DLUGA_SCIEZKA = "/analizy/bardzo-dluga-sciezka-o-energii-w-regionie";
const PAGE_ROWS: GscRow[] = [
  row(`https://alfa.example.com${DLUGA_SCIEZKA}`, 40, 900, 0.044, 6),
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

const TREND = CHART_TITLE_KEYS[0];
const QUERIES = CHART_TITLE_KEYS[1];
const POSITIONS = CHART_TITLE_KEYS[2];
const COUNTRIES = CHART_TITLE_KEYS[3];
const DEVICES = CHART_TITLE_KEYS[4];
const PAGES = CHART_TITLE_KEYS[5];
const CALENDAR = CHART_TITLE_KEYS[6];

/** Tłumacz przypięty do języka, który instancja i18next ma W TEJ CHWILI. */
function tNow() {
  return realT(i18n.language?.toLowerCase().startsWith("en") ? "en" : "pl");
}

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
 * Wykres KARTY o podanym tytule, rozpoznany po NAZWIE REGIONU. Dwa pierścienie
 * i dwa rankingi panelu mają identyczny kształt konfiguracji i różnią się
 * wyłącznie kartą, na której stoją - nazwa jest jedynym miejscem, w którym
 * tytuł karty spotyka się z instancją wykresu. Bierzemy zapis OSTATNI, bo
 * panel przerysowuje się przy każdej odpowiedzi zapytania.
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

/** Wartości serii o podanej nazwie - seria rozpoznana tak, jak widzi ją czytelnik. */
function seriesValues(config: ChartConfig, name: string): Array<number | null> {
  const s = config.series.find((x) => x.name === name);
  if (!s) throw new Error(`test: wykres nie ma serii „${name}"`);
  return s.values;
}

/**
 * Wycinki pierścienia złożone z powrotem z kategorii i jedynej serii. Silnik
 * przyjmuje etykiety i liczby ROZDZIELNIE, więc test składa je w pary i pyta
 * o to samo, co dawniej pytał o `series[0].data`.
 */
function slices(config: ChartConfig): Array<{ name: string; value: number | null }> {
  return config.categories.map((name, i) => ({ name, value: config.series[0]?.values[i] ?? null }));
}

/** Tabela danych rysunku - alternatywa tekstowa, którą silnik rysuje zawsze. */
function dataTableOf(titleKey: string, lang: Lang = "pl"): HTMLElement {
  const region = screen.getByLabelText(regionName(lang, titleKey));
  const el = region.closest("figure")?.querySelector<HTMLElement>("[data-chart-table] table");
  if (!el) throw new Error(`test: karta „${titleKey}" nie ma tabeli danych`);
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

/** Wiersz tabeli danych rozpoznany po pierwszej komórce. */
function tableRow(titleKey: string, label: string, lang: Lang = "pl"): string[] {
  const found = tableRows(dataTableOf(titleKey, lang)).find((r) => r[0] === label);
  if (!found) throw new Error(`test: tabela „${titleKey}" nie ma wiersza „${label}"`);
  return found;
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

function analyticsInputs(): AnalyticsInput[] {
  return h.queryAnalytics.mock.calls.map((c) => (c[0] as { data: AnalyticsInput }).data);
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
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

/**
 * Kafelek KPI o podanej etykiecie.
 *
 * Etykieta szukana jest przez ROLĘ `term`, którą `KpiTile` nadaje swojemu
 * napisowi, a nie przez sam tekst: „Kliknięcia" stoi dziś także w legendzie
 * trendu i w nagłówkach dwóch tabel danych, więc `getByText` miałby kilka
 * trafień i wywracałby się na niejednoznaczności zamiast mierzyć kafelek.
 */
function kpiTile(label: string): HTMLElement {
  const terms = screen.getAllByRole("term").filter((el) => (el.textContent ?? "").trim() === label);
  if (terms.length !== 1) {
    throw new Error(`test: kafelek KPI „${label}" ma ${terms.length} etykiet, oczekiwano jednej`);
  }
  const box = terms[0].closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI „${label}"`);
  return box as HTMLElement;
}

function kpiValue(label: string): string {
  return kpiTile(label).lastElementChild?.textContent ?? "";
}

/** Ścieżka iskry pod kafelkiem KPI - `null`, gdy kafelek jej nie rysuje. */
function kpiSpark(label: string): string | null {
  const card = kpiTile(label).parentElement?.parentElement ?? null;
  return card?.querySelector('[data-role="sparkline"] path')?.getAttribute("d") ?? null;
}

// --- Wnioski panelu -------------------------------------------------------

/** Gałąź słownika z treścią wniosków GSC. */
const GI = "adminAnalytics.gsc.insights";

/** Napis wniosku ze słownika, z podstawionymi zmiennymi. */
function gi(path: string, vars: Record<string, unknown> = {}): string {
  return realT("pl")(`${GI}.${path}`, vars);
}

/** Lista kroków naprawczych ze słownika. */
function giList(path: string): string[] {
  return realT("pl")(`${GI}.${path}`, { returnObjects: true }) as string[];
}

/** Karta „Interpretacja i rekomendacje" - jedyne miejsce z wnioskami panelu. */
function insightCard(): HTMLElement {
  // `getByText`, nie `getByRole("heading")`: przy PUSTEJ liście `InsightSection`
  // renderuje tytuł zwykłym `div`-em, więc szukanie roli gubiłoby dokładnie te
  // przypadki, w których dowodzimy, że żaden próg się nie zapalił.
  const card = screen
    .getByText(realT("pl")("adminAnalytics.insightSection.defaultTitle"))
    .closest("div.p-4");
  if (!card) throw new Error("test: nie znaleziono karty interpretacji");
  return card as HTMLElement;
}

/** Wnioski w kolejności, jaką nadała im sekcja (najostrzejsze na górze). */
function insightItems(): HTMLElement[] {
  const list = insightCard().querySelector("ul");
  if (!list) throw new Error("test: karta interpretacji nie ma listy wniosków");
  return Array.from(list.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/** Elementy panelu, do których przypięte są wnioski - po jednym na wniosek. */
function insightElements(): string[] {
  return insightItems().map((li) => li.querySelector("div.uppercase")?.textContent ?? "");
}

/** Wniosek rozpoznany po elemencie panelu, którego dotyczy. */
function insightOf(element: string): HTMLElement {
  const found = insightItems().find(
    (li) => li.querySelector("div.uppercase")?.textContent === element,
  );
  if (!found) throw new Error(`test: brak wniosku dla elementu „${element}"`);
  return found;
}

/** Tytuł wniosku - jedyny napis wniosku wyróżniony wizualnie. */
function insightTitle(element: string): string {
  return insightOf(element).querySelector("span.font-semibold")?.textContent ?? "";
}

/** Treść interpretacji wniosku (akapit między tytułem a krokami). */
function insightDetail(element: string): string {
  return insightOf(element).querySelector("p")?.textContent ?? "";
}

/** Kroki naprawcze wniosku, bez znaku wypunktowania. */
function insightFixes(element: string): string[] {
  return Array.from(insightOf(element).querySelectorAll("ul > li")).map((li) =>
    (li.textContent ?? "").replace(/^→/, "").trim(),
  );
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
  h.tenantId = "tenant-alfa";
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
    // Ani jedna konfiguracja nie dojechała do silnika: wykres niepowstały jest
    // mocniejszym dowodem niż wykres pusty.
    expect(h.charts).toHaveLength(0);
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

  it("w trakcie pobierania kafelki KPI mówią „Pomiar”, a nie zero udające pomiar", async () => {
    // Zero i „jeszcze nie wiem" to dwie różne informacje. Siatka KPI renderuje
    // się natychmiast, więc bez napisu stanu operator czytał „0 kliknięć",
    // zanim dane w ogóle dojechały - nieodróżnialnie od właściwości, która
    // faktycznie nie ma ruchu. Napis idzie ze słownika (`measuringShort`), tak
    // jak w sąsiednich pulpitach modułu (`AudienceSegments`,
    // `RelatedPostsAnalytics`), a kafelek traci przy tym deltę: procent
    // policzony z dwóch nieznanych okien byłby drugim kłamstwem.
    const t = realT("pl");
    h.queryAnalytics.mockImplementation(() => new Promise<{ rows: GscRow[] }>(() => {}));
    panel();
    await screen.findByText(t("adminAnalytics.common.loadingData"));

    expect(kpiValue(t("adminAnalytics.gsc.clicks"))).not.toBe("0");
    expect(kpiValue(t("adminAnalytics.gsc.clicks"))).toBe(
      t("adminAnalytics.common.measuringShort"),
    );
    expect(kpiValue(t("adminAnalytics.gsc.avgPosition"))).toBe(
      t("adminAnalytics.common.measuringShort"),
    );
  });
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
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() =>
      expect(configOf(TREND).categories).toEqual([SOBOTA, NIEDZIELA, PONIEDZIALEK]),
    );
    const o = configOf(TREND);
    // Kliknięcia i wyświetlenia muszą jechać PO TEJ SAMEJ osi czasu - rozjazd
    // choć jednej serii to wykres, który wygląda poprawnie i kłamie.
    expect(seriesValues(o, t("adminAnalytics.gsc.clicks"))).toEqual([10, 20, 30]);
    expect(seriesValues(o, t("adminAnalytics.gsc.impressions"))).toEqual([200, 250, 300]);
    // Te same liczby w tabeli danych: rysunek nigdy nie jest jedyną drogą.
    expect(tableRow(TREND, NIEDZIELA)).toEqual([NIEDZIELA, "20", "250"]);
  });

  it("na osi trendu stoją DWIE wielkości zliczane, a nie CTR na ukrytej osi", async () => {
    // ZAMIENNIK PRZYPADKU O UKŁADZIE LEGENDY ECharts. Tamten opisywał wnętrze
    // obcego silnika (odstęp legendy, wysokość siatki, nazwy dwóch osi), a
    // istniał dlatego, że trend miał TRZY serie na TRZECH osiach, z czego dwie
    // były niewidoczne - czytelnik nie miał jak sprawdzić, w jakiej skali stoi
    // która linia. Nasz silnik drugiej osi nie ma i mieć nie będzie, więc
    // decyzją PANELU jest dziś to, co na jednej osi wolno postawić: kliknięcia
    // i wyświetlenia, bo są tą samą wielkością tego samego lejka. CTR jest
    // ilorazem w procentach, a `ChartConfig` ma JEDNĄ jednostkę - postawiony
    // obok zliczeń dostałby ich formatowanie.
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(TREND).categories).toHaveLength(3));
    const o = configOf(TREND);
    expect(o.series.map((s) => s.name)).toEqual([
      t("adminAnalytics.gsc.clicks"),
      t("adminAnalytics.gsc.impressions"),
    ]);
    expect(o.unit).toBe("");
    // ŁAMANA, NIE KRZYWA: wygładzenie dokłada między dwoma pomiarami wartości,
    // których nie było, a przy szeregu dobowym czyta się to jako płynny wzrost
    // tam, gdzie był jeden skok.
    expect(o.smoothing).toBe(0);
    // Nagłówek rysuje KARTA, więc rama silnika nie może dołożyć drugiego;
    // pulpit odświeża się co kilka sekund, więc wjazd wykresu czytałby się
    // jako zmiana danych.
    expect(o.title).toBe("");
    expect(o.description).toBe("");
    expect(o.animate).toBe(false);
  });

  it("CTR nie ginie razem z trzecią osią - jest w KPI, w oknie dnia i w eksporcie", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(kpiValue("CTR")).toBe("8.00%"));
    await clickChart(chartOf(TREND), { categoryIndex: 1 });
    expect(metricValue("CTR")).toBe("8.00%");
    expect(metricValue(t("adminAnalytics.gsc.avgPosition"))).toBe("10.0");
  });

  it("iskry przy KPI jadą tym samym porządkiem co trend", async () => {
    panel();
    await loaded();

    // Iskra liczy się POZA konfiguracją wykresu, własnym rzutowaniem w
    // `KpiTile` - to osobna okazja, żeby wykres kierunkowy przy kafelku
    // pokazał coś innego niż duży trend. Szereg rosnący 10 -> 20 -> 30 musi
    // ZJECHAĆ w układzie SVG (oś Y rośnie w dół): pierwszy punkt najniżej,
    // ostatni najwyżej. Odwrócona kolejność dałaby lustrzane odbicie.
    const t = realT("pl");
    await waitFor(() => expect(kpiSpark(t("adminAnalytics.gsc.clicks"))).not.toBeNull());
    expect(kpiSpark(t("adminAnalytics.gsc.clicks"))).toBe("M0.0 36.0 L50.0 20.0 L100.0 4.0");
    expect(kpiSpark(t("adminAnalytics.gsc.impressions"))).toBe("M0.0 36.0 L50.0 20.0 L100.0 4.0");
  });

  it("rank zapytań idzie MALEJĄCO, czyli od najmocniejszej frazy u góry", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    // ZMIANA KIERUNKU PRZY NIEZMIENIONEJ INTENCJI. ECharts układał oś kategorii
    // od dołu, więc rank trzeba było oddawać odwrócony; nasz silnik rysuje
    // kategorie słupków poziomych od góry w kolejności tablicy, więc ranking
    // czyta się z góry na dół i tablica idzie posortowana malejąco.
    await waitFor(() =>
      expect(configOf(QUERIES).categories).toEqual([
        "energia w cee",
        "polityka klimatyczna",
        "raport nes",
        "bezpieczenstwo dostaw",
        "dlugi ogon frazy",
      ]),
    );
    expect(configOf(QUERIES).kind).toBe("bar-horizontal");
    expect(seriesValues(configOf(QUERIES), t("adminAnalytics.gsc.clicks"))).toEqual([
      50, 30, 20, 5, 1,
    ]);
  });

  it("rank przycina się do 15 fraz i zostawia te najmocniejsze", async () => {
    const many = Array.from({ length: 18 }, (_, i) =>
      row(`fraza ${String(i + 1).padStart(2, "0")}`, i + 1, (i + 1) * 10, 0.1, 5),
    );
    respondWith({ ...FULL, query: many });
    panel();
    await loaded();

    await waitFor(() => expect(configOf(QUERIES).categories).toHaveLength(15));
    const labels = configOf(QUERIES).categories;
    expect(labels[0]).toBe("fraza 18");
    expect(labels[14]).toBe("fraza 04");
    // Trzy najsłabsze frazy wypadają - gdyby przycinał przed sortowaniem,
    // wypadłyby przypadkowe.
    expect(labels).not.toContain("fraza 03");
  });

  it("pełna fraza idzie do danych, przycinanie zostaje renderowi etykiety", async () => {
    const dluga = "bardzo dluga fraza o energii w europie srodkowej i wschodniej w roku 2026";
    respondWith({ ...FULL, query: [row(dluga, 9, 90, 0.1, 3)] });
    panel();
    await loaded();

    await waitFor(() => expect(configOf(QUERIES).categories).toEqual([dluga]));
    // Ucięta fraza weszłaby tak samo do tabeli danych i do eksportu, a tam nie
    // da się jej już wyszukać.
    expect(tableRow(QUERIES, dluga)).toEqual([dluga, "9"]);
  });

  it("rozkład pozycji sumuje wyświetlenia i kliknięcia do przedziałów SERP", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() =>
      expect(configOf(POSITIONS).categories).toEqual(["1-3", "4-10", "11-20", "21-50", "51+"]),
    );
    const o = configOf(POSITIONS);
    // pozycje 2,4 / 7,2 / 15,5 / 33 / 78 - po jednej frazie na przedział.
    expect(seriesValues(o, t("adminAnalytics.gsc.impressions"))).toEqual([500, 600, 900, 400, 100]);
    expect(seriesValues(o, t("adminAnalytics.gsc.clicks"))).toEqual([50, 30, 20, 5, 1]);
    // OBIE SERIE TO ZLICZENIA NA JEDNEJ OSI. Wcześniej kliknięcia jechały
    // LINIĄ po drugiej, ukrytej osi - ten sam znacznik co na trendzie znaczył
    // tam co innego, a wysokość linii nad słupkiem nie znaczyła nic.
    expect(o.kind).toBe("bar");
    expect(o.unit).toBe("");
  });

  it("donut krajów pokazuje osiem największych, a resztę zwija w „Inne”", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(COUNTRIES).categories).toHaveLength(9));
    const s = slices(configOf(COUNTRIES));
    expect(s.slice(0, 8).map((x) => x.name)).toEqual([
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
    expect(s[8]).toEqual({ name: t("adminAnalytics.gsc.other"), value: 30 });
  });

  it("donut urządzeń nie dokleja „Innych”, gdy wymiar ma mniej niż dziewięć wartości", async () => {
    panel();
    await loaded();

    await waitFor(() =>
      expect(configOf(DEVICES).categories).toEqual(["DESKTOP", "MOBILE", "TABLET"]),
    );
  });

  it("„Inne” w donucie to reszta poza pierwszą ósemką, także przy niesortowanej odpowiedzi API", async () => {
    // Wycinki i „Inne" liczą się z JEDNEJ, tej samej posortowanej listy, więc
    // oba zbiory są rozłączne. Wcześniej `top` brał osiem największych PO
    // własnym sortowaniu, a `otherClicks` sumował `rows.slice(8)` - ogon
    // KOLEJNOŚCI WEJŚCIOWEJ; przy odpowiedzi innej niż malejąca te zbiory
    // zachodziły na siebie, kraje pokazane jako osobne wycinki wchodziły
    // JESZCZE RAZ do „Innych", a udziały procentowe przestawały sumować się
    // do całości. Search Console nie obiecuje porządku, więc dowód jedzie na
    // wierszach ODWRÓCONYCH - wynik musi być identyczny jak dla posortowanych.
    const t = realT("pl");
    respondWith({ ...FULL, country: [...COUNTRY_ROWS].reverse() });
    panel();
    await loaded();

    await waitFor(() => expect(configOf(COUNTRIES).categories).toHaveLength(9));
    expect(slices(configOf(COUNTRIES))[8]).toEqual({
      name: t("adminAnalytics.gsc.other"),
      value: 30,
    });
  });

  it("rank stron obcina domenę, ale NIE przycina adresu, i sortuje po wyświetleniach", async () => {
    // BYŁA TU TREEMAPA i to jest podmiana formy, nie przeniesienie jeden do
    // jednego. Kafel kodował wielkość POWIERZCHNIĄ, czyli jednym z najsłabszych
    // kanałów percepcyjnych - a kodował nią jedną wielkość, więc cała treść
    // rysunku daje się oddać DŁUGOŚCIĄ, kanałem najdokładniejszym. Pytanie
    // karty jest rankingiem, a ranking czyta się z góry na dół.
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(PAGES).categories).toHaveLength(2));
    const o = configOf(PAGES);
    expect(o.kind).toBe("bar-horizontal");
    // Domena jest w każdym wierszu ta sama (właściwość jest jedna), więc nie
    // niesie informacji; sam adres NIE JEST ucinany do 30 znaków, jak w kaflu -
    // ucięty wszedłby tak samo do tabeli danych i do eksportu.
    expect(o.categories).toEqual([DLUGA_SCIEZKA, "/o-nas"]);
    expect(o.categories[0]).not.toContain("…");
    // Sortowanie idzie po WYŚWIETLENIACH, nie po kliknięciach.
    expect(seriesValues(o, t("adminAnalytics.gsc.impressions"))).toEqual([900, 300]);
    expect(tableRow(PAGES, DLUGA_SCIEZKA)).toEqual([DLUGA_SCIEZKA, "900"]);
  });

  it("kalendarz jest macierzą tydzień na dzień tygodnia, a dzień bez pomiaru zostaje luką", async () => {
    // MAPA CIEPLNA ZOSTAJE MAPĄ CIEPLNĄ, tyle że macierzą silnika zamiast płyty
    // ECharts: adresem komórki jest PARA parametrów, czyli dokładnie to, do
    // czego ten rodzaj służy. 2026-08-01 to sobota, więc pierwszy tydzień
    // zaczyna się 2026-07-27, a poniedziałek 2026-08-03 otwiera drugi.
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(CALENDAR).categories).toEqual([TYDZIEN_1, PONIEDZIALEK]));
    const o = configOf(CALENDAR);
    expect(o.kind).toBe("heatmap");
    expect(o.series.map((s) => s.name)).toEqual([
      t("adminAnalytics.gsc.weekdays.mon"),
      t("adminAnalytics.gsc.weekdays.tue"),
      t("adminAnalytics.gsc.weekdays.wed"),
      t("adminAnalytics.gsc.weekdays.thu"),
      t("adminAnalytics.gsc.weekdays.fri"),
      t("adminAnalytics.gsc.weekdays.sat"),
      t("adminAnalytics.gsc.weekdays.sun"),
    ]);
    // Sobota 01.08 -> 10 klik. w pierwszym tygodniu, niedziela 02.08 -> 20,
    // poniedziałek 03.08 -> 30 w drugim. Wszystko inne to LUKA, nie zero:
    // dzień bez odczytu nie ma udawać dnia bez kliknięć.
    expect(seriesValues(o, t("adminAnalytics.gsc.weekdays.sat"))).toEqual([10, null]);
    expect(seriesValues(o, t("adminAnalytics.gsc.weekdays.sun"))).toEqual([20, null]);
    expect(seriesValues(o, t("adminAnalytics.gsc.weekdays.mon"))).toEqual([null, 30]);
    expect(seriesValues(o, t("adminAnalytics.gsc.weekdays.wed"))).toEqual([null, null]);
    // `n` mapy to liczba WYPEŁNIONYCH komórek, nie rozmiar siatki.
    expect(o.sampleSize).toBe(3);
  });

  it("kalendarz nie ściska osi czasu - tydzień bez ani jednego pomiaru zostaje kolumną", async () => {
    // Pominięcie pustego tygodnia postawiłoby obok siebie dwa odległe tygodnie
    // i skróciło oś czasu o miesiąc bez ani jednego znaku, że coś wypadło.
    const t = realT("pl");
    respondWith({
      ...FULL,
      date: [row(PONIEDZIALEK, 7, 70, 0.1, 5), row("2026-08-24", 9, 90, 0.1, 5)],
    });
    panel();
    await loaded();

    await waitFor(() => expect(configOf(CALENDAR).categories).toHaveLength(4));
    expect(configOf(CALENDAR).categories).toEqual([
      PONIEDZIALEK,
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ]);
    expect(seriesValues(configOf(CALENDAR), t("adminAnalytics.gsc.weekdays.mon"))).toEqual([
      7,
      null,
      null,
      9,
    ]);
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

// ---------------------------------------------------------------------------

describe("GscBiDashboard - interpretacja i rekomendacje", () => {
  // PO CO TEN BLOK. Cała warstwa wniosków (`buildGscInsights`, dziesięć reguł)
  // była tu dowodzona WYŁĄCZNIE przez podpis sekcji. Podpis renderuje się
  // jednak z `insightsSubtitle`, a nie z listy wniosków, więc wycięcie
  // dziewięciu z dziesięciu reguł nie ruszało ani jednej asercji: panel dalej
  // pokazywał nagłówek „Interpretacja i rekomendacje" i podpis z oknem.
  // Poniższe przypadki asertują TREŚĆ - tytuł, interpretację i kroki naprawcze
  // konkretnego wniosku - oraz LICZBĘ wniosków, bo to jedyne dwie rzeczy,
  // które operator naprawdę czyta.
  //
  // Progi są sprawdzane Z OBU STRON granicy: reguły GSC łamią severity i listę
  // kroków na RÓŻNYCH liczbach (kliknięcia: ocena na -15/+5, lista na -10/+20;
  // pozycja: ocena na 0,5, lista na tym samym 0,5 ale ostro), więc test na
  // jednej wartości nie odróżnia „próg działa" od „próg jest o jeden obok".

  /** Nazwy elementów panelu, do których wnioski są przypięte. */
  const E = {
    clicks: gi("clicks.element"),
    ctr: gi("ctr.element"),
    position: gi("position.element"),
    trend: gi("trend.element"),
    topQueries: gi("topQueries.element"),
    histogram: gi("positionHistogram.element"),
    countries: gi("countries.element"),
    devices: gi("devices.element"),
    pages: gi("pages.element"),
    calendar: gi("calendar.element"),
  } as const;

  /** Wiersz dzienny o CTR wyliczonym z podanych liczb - jak oddaje go API. */
  function dayRow(iso: string, clicks: number, impressions: number, position = 5): GscRow {
    return row(iso, clicks, impressions, impressions > 0 ? clicks / impressions : 0, position);
  }

  /** Seria `n` kolejnych dni sierpnia z podanymi kliknięciami. */
  function days(clicks: number[]): GscRow[] {
    return clicks.map((c, i) => dayRow(`2026-08-0${i + 1}`, c, 100));
  }

  /** Renderuje panel na zbiorze zbudowanym z FULL i podanych nadpisań. */
  async function withData(over: Partial<Dataset>): Promise<void> {
    respondWith({ ...FULL, ...over });
    panel();
    await loaded();
  }

  it("każdy element panelu z danymi dostaje DOKŁADNIE jeden wniosek, w kolejności ostrości", async () => {
    panel();
    await loaded();

    // Osiem elementów z danymi = osiem wniosków. Wycięcie reguł z listy
    // (albo dorzucenie duplikatu) zmienia tę tablicę, a nie podpis sekcji.
    expect(insightElements()).toEqual([
      E.topQueries,
      E.histogram,
      E.countries,
      E.devices,
      E.pages,
      E.clicks,
      E.ctr,
      E.position,
    ]);
    // Odznaki podają LICZBĘ wniosków per ocena - kolor paska to za mało.
    const card = insightCard();
    expect(
      within(card).getByText(realT("pl")("adminAnalytics.insightSection.badgeInfo", { count: 5 })),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(realT("pl")("adminAnalytics.insightSection.badgeOk", { count: 3 })),
    ).toBeInTheDocument();
    // Trend i kalendarz mają własne progi długości serii - przy trzech dniach
    // ich nie ma, więc lista nie może ich wymieniać.
    expect(insightElements()).not.toContain(E.trend);
    expect(insightElements()).not.toContain(E.calendar);
  });

  it("wzrost kliknięć POWYŻEJ 20% daje listę utrwalającą trend", async () => {
    await withData({
      date: [dayRow(SOBOTA, 61, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 50, 1000)],
    });

    expect(insightTitle(E.clicks)).toBe(gi("clicks.titleDelta", { delta: "+22.0" }));
    expect(insightDetail(E.clicks)).toBe(
      gi("clicks.detail", { days: 28, clicks: 61, prev: 50, impr: 1000, prevImpr: 1000 }),
    );
    expect(insightFixes(E.clicks)).toEqual(giList("clicks.fixesUp"));
  });

  it("wzrost DOKŁADNIE o 20% to jeszcze lista stabilna, nie utrwalająca", async () => {
    // Próg to `> 20`, nie `>= 20`. Jeden punkt procentowy mniej i rekomendacja
    // brzmi inaczej - to świadoma granica reguły, nie przeoczenie testu.
    await withData({
      date: [dayRow(SOBOTA, 60, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 50, 1000)],
    });

    expect(insightTitle(E.clicks)).toBe(gi("clicks.titleDelta", { delta: "+20.0" }));
    expect(insightFixes(E.clicks)).toEqual(giList("clicks.fixesStable"));
  });

  it("spadek kliknięć poniżej -10% zapala listę naprawczą i ocenę „do poprawy”", async () => {
    await withData({
      date: [dayRow(SOBOTA, 80, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000)],
    });

    expect(insightTitle(E.clicks)).toBe(gi("clicks.titleDelta", { delta: "-20.0" }));
    expect(insightFixes(E.clicks)).toEqual(giList("clicks.fixesDown"));
    // Ocena „warn” wypycha wniosek na szczyt listy I wystawia odznakę z liczbą.
    expect(insightElements()[0]).toBe(E.clicks);
    expect(
      within(insightCard()).getByText(
        realT("pl")("adminAnalytics.insightSection.badgeWarn", { count: 1 }),
      ),
    ).toBeInTheDocument();
  });

  it("spadek DOKŁADNIE o 10% nie jest jeszcze awarią - lista zostaje stabilna", async () => {
    await withData({
      date: [dayRow(SOBOTA, 90, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000)],
    });

    expect(insightTitle(E.clicks)).toBe(gi("clicks.titleDelta", { delta: "-10.0" }));
    expect(insightFixes(E.clicks)).toEqual(giList("clicks.fixesStable"));
    expect(insightFixes(E.clicks)).not.toEqual(giList("clicks.fixesDown"));
  });

  it("CTR pod benchmarkiem pozycji porównuje się z oczekiwanym i każe przepisać snippet", async () => {
    // Pozycja 5 -> benchmark 6%. Zmierzone 1% to luka -5 pp, czyli gałąź
    // `fixesLow`, a nie „utrzymaj stylistykę tytułów”.
    await withData({
      date: [dayRow(SOBOTA, 10, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 10, 1000)],
    });

    expect(insightTitle(E.ctr)).toBe(gi("ctr.title", { ctr: "1.00", pos: "5.0" }));
    expect(insightDetail(E.ctr)).toBe(
      gi("ctr.detail", { exp: "6.0", cmp: gi("ctr.cmpLower"), gap: "5.0", dctr: "0.00" }),
    );
    expect(insightFixes(E.ctr)).toEqual(giList("ctr.fixesLow"));
    expect(insightElements()[0]).toBe(E.ctr);
  });

  it("pogorszenie pozycji o 4 miejsca daje interpretację spadku i listę konkurencyjną", async () => {
    await withData({
      date: [dayRow(SOBOTA, 100, 1000, 12)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000, 8)],
    });

    expect(insightTitle(E.position)).toBe(gi("position.title", { pos: "12.0", delta: "+4.0" }));
    expect(insightDetail(E.position)).toBe(gi("position.detailWorse", { n: "4.0" }));
    expect(insightFixes(E.position)).toEqual(giList("position.fixesWorse"));
  });

  it("pogorszenie DOKŁADNIE o 0,5 miejsca daje ostrzeżenie RAZEM z listą naprawczą", async () => {
    // Granica 0,5 miejsca jest jedna i domknięta (`gscInsights.ts`,
    // `POS_DEADBAND`): ta sama liczba przełącza wagę wpisu i zestaw kroków,
    // bo operator widzi je w jednym kafelku. Kafelek ostrzegawczy z poradą
    // „utrzymaj tempo” byłby alarmem i instrukcją bezczynności naraz.
    await withData({
      date: [dayRow(SOBOTA, 100, 1000, 8.5)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000, 8)],
    });

    expect(insightTitle(E.position)).toBe(gi("position.title", { pos: "8.5", delta: "+0.5" }));
    expect(insightDetail(E.position)).toBe(gi("position.detailWorse", { n: "0.5" }));
    expect(insightFixes(E.position)).toEqual(giList("position.fixesWorse"));
    expect(insightElements()[0]).toBe(E.position);
  });

  it("trend widoczności pojawia się dopiero przy CZTERECH dniach serii", async () => {
    // Reguła dzieli okno na połowy, więc przy trzech dniach „pierwsza połowa”
    // to jeden dzień - porównanie byłoby szumem, nie trendem.
    await withData({ date: days([10, 10, 20, 20]) });

    expect(insightElements()).toContain(E.trend);
    expect(insightTitle(E.trend)).toBe(gi("trend.title", { delta: "+100.0" }));
    expect(insightDetail(E.trend)).toBe(gi("trend.detail", { early: 20, late: 40, days: 28 }));
    expect(insightFixes(E.trend)).toEqual(giList("trend.fixesDefault"));
    // Kalendarz ma wyższy próg (siedem dni) - przy czterech dalej go nie ma.
    expect(insightElements()).not.toContain(E.calendar);
  });

  it("SZEŚĆ dni serii to jeszcze za mało na kalendarz aktywności", async () => {
    // Trend już jest (próg to cztery dni), kalendarza jeszcze nie - dwa różne
    // progi na tej samej serii, więc jeden zbiór dowodzi obu naraz.
    await withData({ date: days([1, 2, 3, 4, 5, 6]) });

    expect(insightElements()).toContain(E.trend);
    expect(insightElements()).not.toContain(E.calendar);
  });

  it("przy SIEDMIU dniach kalendarz wskazuje dzień szczytu z jego liczbą kliknięć", async () => {
    await withData({ date: days([1, 2, 3, 4, 5, 6, 0]) });

    expect(insightTitle(E.calendar)).toBe(
      gi("calendar.titleSpike", { clicks: 6, date: "2026-08-06" }),
    );
    expect(insightDetail(E.calendar)).toBe(
      gi("calendar.detailSpike", { date: "2026-08-06", clicks: 6 }),
    );
    expect(insightFixes(E.calendar)).toEqual(giList("calendar.fixesSpike"));
  });

  it("większość dni bez kliknięć przestawia kalendarz na komunikat o zerach", async () => {
    // Próg to `zeros > 40% dni`: trzy zera na siedem dni już go przekraczają.
    await withData({ date: days([0, 0, 0, 4, 5, 6, 7]) });

    expect(insightTitle(E.calendar)).toBe(gi("calendar.titleZeros", { zeros: 3, total: 7 }));
    expect(insightDetail(E.calendar)).toBe(gi("calendar.detailZeros"));
    expect(insightFixes(E.calendar)).toEqual(giList("calendar.fixesZeros"));
  });

  it("ruch brandowy powyżej 60% zamienia wniosek o zapytaniach na CAŁĄ inną treść", async () => {
    await withData({
      date: [dayRow(SOBOTA, 100, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000)],
      query: [row("new european strategies", 70, 500, 0.14, 3), row("energia", 30, 400, 0.075, 8)],
    });

    expect(insightTitle(E.topQueries)).toBe(gi("topQueries.titleBranded", { pct: "70" }));
    expect(insightDetail(E.topQueries)).toBe(gi("topQueries.detailBranded"));
    expect(insightFixes(E.topQueries)).toEqual(giList("topQueries.fixesBranded"));
  });

  it("DOKŁADNIE 60% ruchu brandowego to jeszcze wniosek o frazach bez kliknięć", async () => {
    await withData({
      date: [dayRow(SOBOTA, 100, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000)],
      query: [row("new european strategies", 60, 500, 0.12, 3), row("energia", 40, 400, 0.1, 8)],
    });

    expect(insightTitle(E.topQueries)).toBe(gi("topQueries.titleZeroClick", { count: 0 }));
    expect(insightFixes(E.topQueries)).toEqual(giList("topQueries.fixesZeroClick"));
  });

  it("poniżej 25% wyświetleń w TOP 10 trzeci krok naprawczy mówi o backlinkach", async () => {
    await withData({ query: [row("a", 5, 200, 0.025, 2), row("b", 5, 800, 0.006, 30)] });

    expect(insightTitle(E.histogram)).toBe(gi("positionHistogram.title", { pct: "20" }));
    expect(insightDetail(E.histogram)).toBe(
      gi("positionHistogram.detail", { top3: 200, top10: 0, top20: 0, deep: 800 }),
    );
    expect(insightFixes(E.histogram)).toEqual([
      gi("positionHistogram.fix1"),
      gi("positionHistogram.fix2"),
      gi("positionHistogram.fix3Low"),
    ]);
    expect(insightElements()[0]).toBe(E.histogram);
  });

  it("DOKŁADNIE 25% wyświetleń w TOP 10 wraca do kroku o świeżości treści", async () => {
    await withData({ query: [row("a", 5, 250, 0.02, 2), row("b", 5, 750, 0.0066, 30)] });

    expect(insightTitle(E.histogram)).toBe(gi("positionHistogram.title", { pct: "25" }));
    expect(insightFixes(E.histogram)[2]).toBe(gi("positionHistogram.fix3High"));
    expect(insightFixes(E.histogram)).not.toContain(gi("positionHistogram.fix3Low"));
  });

  it("kraj powyżej 90% kliknięć dostaje rekomendację dywersyfikacji rynku", async () => {
    await withData({
      date: [dayRow(SOBOTA, 100, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000)],
      country: [row("pol", 95, 900, 0.1, 5), row("deu", 5, 100, 0.05, 6)],
    });

    expect(insightTitle(E.countries)).toBe(gi("countries.title", { country: "POL", pct: "95" }));
    expect(insightDetail(E.countries)).toBe(
      gi("countries.detail", { count: 2, top3: "POL 95, DEU 5" }),
    );
    expect(insightFixes(E.countries)).toEqual(giList("countries.fixesSingle"));
  });

  it("DOKŁADNIE 90% na jednym kraju to jeszcze rynek uznany za rozłożony", async () => {
    await withData({
      date: [dayRow(SOBOTA, 100, 1000)],
      prev: [dayRow(DZIEN_POPRZEDNI, 100, 1000)],
      country: [row("pol", 90, 900, 0.1, 5), row("deu", 10, 100, 0.1, 6)],
    });

    expect(insightTitle(E.countries)).toBe(gi("countries.title", { country: "POL", pct: "90" }));
    expect(insightFixes(E.countries)).toEqual(giList("countries.fixesMulti"));
  });

  it("przewaga CTR desktopu nad mobile o ponad 2 pp zapala notatkę o mobilnym snippecie", async () => {
    await withData({
      device: [row("DESKTOP", 40, 400, 0.1, 5), row("MOBILE", 10, 200, 0.05, 5)],
    });

    expect(insightTitle(E.devices)).toBe(gi("devices.title", { mobile: 10, desktop: 40 }));
    expect(insightDetail(E.devices)).toBe(
      gi("devices.detail", { mctr: "5.00", dctr: "10.00", note: gi("devices.noteGap") }),
    );
    expect(insightFixes(E.devices)).toEqual(giList("devices.fixesGap"));
    expect(insightElements()[0]).toBe(E.devices);
  });

  it("CZWARTA strona pod benchmarkiem CTR przestawia wniosek o stronach w ostrzeżenie", async () => {
    const weak = (n: number): GscRow => row(`https://alfa.example.com/${n}`, 1, 100, 0.01, 5);
    await withData({ page: [weak(1), weak(2), weak(3), weak(4)] });

    expect(insightTitle(E.pages)).toBe(gi("pages.title", { low: 4, winners: 0 }));
    expect(insightDetail(E.pages)).toBe(gi("pages.detail", { count: 4 }));
    expect(insightElements()[0]).toBe(E.pages);
  });

  it("strona z 29 wyświetleniami nie liczy się do progu - benchmark wymaga 30", async () => {
    // Bramka `impressions >= 30` istnieje po to, żeby pojedyncze wyświetlenie
    // nie robiło z przypadkowej strony problemu CTR. Czwarta słaba strona z 29
    // wyświetleniami zostaje więc poza analizą i wniosek jest OBSERWACJĄ.
    const weak = (n: number, impressions: number): GscRow =>
      row(`https://alfa.example.com/${n}`, 1, impressions, 0.01, 5);
    await withData({ page: [weak(1, 100), weak(2, 100), weak(3, 100), weak(4, 29)] });

    expect(insightTitle(E.pages)).toBe(gi("pages.title", { low: 3, winners: 0 }));
    expect(insightDetail(E.pages)).toBe(gi("pages.detail", { count: 3 }));
    expect(insightFixes(E.pages)).toEqual(giList("pages.fixes"));
  });
});

describe("GscBiDashboard - liczby pojedynczego elementu", () => {
  // ZAMIENNIK BLOKU O FORMATERACH DYMKA ECharts. Tamte przypadki dowodziły
  // etykiet `clicksLabel`, `impressionsLabel`, `ctrLabel` i `positionLabel`,
  // czyli napisów sklejanych do HTML-a, który oddawaliśmy obcemu silnikowi.
  // Nasz silnik rysuje podpowiedź sam i sam trzyma jej słownik; PANEL odpowiada
  // dziś za to, żeby liczba pojedynczego elementu dała się odczytać BEZ
  // wskaźnika - z tabeli danych (każdy rodzaj ma ją zawsze) i z okna
  // szczegółów. To jest to samo pytanie co wcześniej: czy czytelnik dojdzie do
  // liczby stojącej pod jednym znacznikiem.
  it("tabela trendu podaje obie wielkości dnia, w kolumnach nazwanych jak serie", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(TREND).categories).toHaveLength(3));
    expect(tableHeaders(dataTableOf(TREND))).toEqual([
      realT("pl")("charts.frame.category"),
      t("adminAnalytics.gsc.clicks"),
      t("adminAnalytics.gsc.impressions"),
    ]);
    expect(tableRows(dataTableOf(TREND))).toEqual([
      [SOBOTA, "10", "200"],
      [NIEDZIELA, "20", "250"],
      [PONIEDZIALEK, "30", "300"],
    ]);
  });

  it("tabela rankingu fraz podaje kliknięcia każdej frazy", async () => {
    panel();
    await loaded();

    await waitFor(() => expect(configOf(QUERIES).categories).toHaveLength(5));
    expect(tableRow(QUERIES, "energia w cee")).toEqual(["energia w cee", "50"]);
    expect(tableRow(QUERIES, "dlugi ogon frazy")).toEqual(["dlugi ogon frazy", "1"]);
  });

  it("tabela pierścienia podaje wartość i UDZIAŁ, bo tego łuk nie mówi", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(COUNTRIES).categories).toHaveLength(9));
    expect(tableHeaders(dataTableOf(COUNTRIES))).toEqual([
      realT("pl")("charts.frame.category"),
      realT("pl")("charts.frame.value"),
      realT("pl")("charts.frame.share"),
    ]);
    // 550 kliknięć w całym pierścieniu, z czego Polska 100.
    const wiersz = tableRow(COUNTRIES, "pol");
    expect(wiersz[1]).toBe("100");
    expect(wiersz[2]).toContain("18");
    // „Inne" też ma wiersz - worek zbiorczy nie może zniknąć z alternatywy.
    expect(tableRow(COUNTRIES, t("adminAnalytics.gsc.other"))[1]).toBe("30");
  });

  it("tabela kalendarza adresuje komórkę parą: wiersz to dzień tygodnia, kolumna to tydzień", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(CALENDAR).categories).toHaveLength(2));
    const naglowki = tableHeaders(dataTableOf(CALENDAR));
    expect(naglowki.slice(0, 3)).toEqual([
      realT("pl")("charts.heatmap.table.row"),
      TYDZIEN_1,
      PONIEDZIALEK,
    ]);
    // Niedziela pierwszego tygodnia to 2026-08-02 z dwudziestoma kliknięciami.
    expect(tableRow(CALENDAR, t("adminAnalytics.gsc.weekdays.sun")).slice(0, 2)).toEqual([
      t("adminAnalytics.gsc.weekdays.sun"),
      "20",
    ]);
  });

  it("okno szczegółów strony podaje wszystkie cztery metryki, których słupek nie koduje", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(PAGES).categories).toHaveLength(2));
    await clickChart(chartOf(PAGES), { categoryIndex: 0, category: DLUGA_SCIEZKA });

    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("40");
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("900");
    expect(metricValue("CTR")).toBe("4.40%");
    expect(metricValue(t("adminAnalytics.gsc.avgPosition"))).toBe("6.0");
  });
});

describe("GscBiDashboard - drążenie wykresów", () => {
  // Wskazaniem elementu wykresu operator otwiera okno ze szczegółami. Cała ta
  // warstwa to funkcje oddane karcie, więc bez symulowanego wskazania pozostaje
  // martwa - a to ona decyduje, CZY wskazanie czegokolwiek pokaże liczby TEGO
  // wiersza, czy sąsiedniego.
  it("wskazanie punktu trendu pokazuje metryki tego dnia", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(configOf(TREND).categories).toHaveLength(3));

    await clickChart(chartOf(TREND), {
      categoryIndex: 1,
      category: NIEDZIELA,
      seriesName: t("adminAnalytics.gsc.clicks"),
    });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.trendTitle"))).toBeInTheDocument();
    expect(within(d).getByText(NIEDZIELA)).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("20");
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("250");
    expect(metricValue("CTR")).toBe("8.00%");
    expect(metricValue(t("adminAnalytics.gsc.avgPosition"))).toBe("10.0");
  });

  it("wskazanie pustego obszaru trendu nie otwiera okna bez treści", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(configOf(TREND).categories).toHaveLength(3));

    await clickChart(chartOf(TREND), { categoryIndex: 99 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wskazanie słupka rankingu otwiera tę frazę, którą widać na osi", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(configOf(QUERIES).categories).toHaveLength(5));

    // Indeks 0 to GÓRA osi kategorii, czyli fraza NAJMOCNIEJSZA - silnik rysuje
    // kategorie od góry, więc drążenie nie ma już czego odwracać. Gdyby
    // odwracało (jak przy ECharts), otworzyłoby frazę z drugiego końca rankingu.
    await clickChart(chartOf(QUERIES), { categoryIndex: 0, category: "energia w cee" });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText("energia w cee")).toBeInTheDocument();
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.topQueriesTitle"))).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("50");
    expect(metricValue("CTR")).toBe("10.00%");
  });

  it("wskazanie przedziału pozycji sumuje wszystkie frazy z tego przedziału", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(configOf(POSITIONS).categories).toHaveLength(5));

    await clickChart(chartOf(POSITIONS), { categoryIndex: 1, category: "4-10" });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText(`${t("adminAnalytics.gsc.avgPosition")}: 4-10`)).toBeInTheDocument();
    // Jedyna fraza w przedziale 4-10: 30 klik. z 600 wyświetleń.
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("30");
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("600");
    expect(metricValue("CTR")).toBe("5.00%");
  });

  it("wskazanie wycinka pierścienia otwiera kraj, a wycinek „Inne” nic nie otwiera", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(configOf(COUNTRIES).categories).toHaveLength(9));
    const donut = chartOf(COUNTRIES);

    await clickChart(donut, { categoryIndex: 1, category: "deu", value: 90 });
    const d = screen.getByRole("dialog");
    expect(within(d).getByText("deu")).toBeInTheDocument();
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.countriesTitle"))).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("90");

    // „Inne" to worek zbiorczy, nie kraj - nie ma czego pokazać i panel ma to
    // wiedzieć, zamiast otwierać okno o pustym wierszu.
    fireEvent.keyDown(d, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await clickChart(donut, {
      categoryIndex: 8,
      category: t("adminAnalytics.gsc.other"),
      value: 30,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wskazanie słupka strony daje ścieżkę, metryki i odnośnik do PEŁNEGO adresu", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(configOf(PAGES).categories).toHaveLength(2));

    await clickChart(chartOf(PAGES), { categoryIndex: 0, category: DLUGA_SCIEZKA });

    const d = screen.getByRole("dialog");
    expect(within(d).getAllByText(DLUGA_SCIEZKA).length).toBeGreaterThan(0);
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("900");
    expect(metricValue("CTR")).toBe("4.40%");
    // Odnośnik prowadzi do PEŁNEGO adresu z domeną, nie do ścieżki z osi.
    const link = within(d).getByRole("link", {
      name: t("adminAnalytics.drillDialog.openInNewTab"),
    });
    expect(link).toHaveAttribute("href", PAGE_ROWS[0].keys[0]);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("wskazanie słupka spoza rankingu stron nie otwiera okna", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(configOf(PAGES).categories).toHaveLength(2));

    await clickChart(chartOf(PAGES), { categoryIndex: 7 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wskazanie komórki kalendarza pokazuje pełne metryki tego dnia", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    await waitFor(() => expect(configOf(CALENDAR).categories).toHaveLength(2));

    // Drugi tydzień, poniedziałek - czyli 2026-08-03.
    await clickChart(chartOf(CALENDAR), { categoryIndex: 1, seriesIndex: 0, value: 30 });

    const d = screen.getByRole("dialog");
    expect(within(d).getByText(t("adminAnalytics.gsc.charts.calendarTitle"))).toBeInTheDocument();
    expect(within(d).getByText(PONIEDZIALEK)).toBeInTheDocument();
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("300");
  });

  it("komórka bez pomiaru nie otwiera okna z wymyślonym zerem", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(configOf(CALENDAR).categories).toHaveLength(2));

    // ZMIANA WOBEC WERSJI ECharts, i to zmiana na uczciwszą. Tamta płyta
    // malowała całe tygodnie, a kliknięcie w dzień spoza serii otwierało okno
    // z liczbą kliknięć, którą sama komórka wtedy niosła - czyli z zerem, przy
    // którym nikt niczego nie mierzył. W macierzy silnika taka komórka jest
    // LUKĄ i nie ma czego pokazać: środa pierwszego tygodnia to dzień, którego
    // Search Console nie zwrócił.
    await clickChart(chartOf(CALENDAR), { categoryIndex: 0, seriesIndex: 2, value: null });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wskazanie bez adresu komórki nie otwiera okna", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(configOf(CALENDAR).categories).toHaveLength(2));

    await clickChart(chartOf(CALENDAR), { categoryIndex: null, seriesIndex: null });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("GscBiDashboard - zero wierszy", () => {
  it("kalendarz nie dostaje wymyślonego zakresu, tylko siatkę bez ani jednej kolumny", async () => {
    respondWith(EMPTY);
    panel();
    await loaded();

    // Bez ani jednego dnia nie ma z czego złożyć macierzy - i to jest kontrakt,
    // nie przypadek: kolumna „tydzień" wymyślona z dzisiejszej daty
    // twierdziłaby, że okno zostało zmierzone i wyszło w nim zero.
    await waitFor(() => expect(configOf(CALENDAR).categories).toEqual([]));
    expect(configOf(CALENDAR).sampleSize).toBe(0);
    expect(configOf(CALENDAR).series.every((s) => s.values.length === 0)).toBe(true);
  });

  it("przy zerze wierszy nie zmyśla wycinków pierścienia ani słupków stron", async () => {
    respondWith(EMPTY);
    panel();
    await loaded();

    await waitFor(() => expect(configOf(COUNTRIES).categories).toEqual([]));
    expect(configOf(PAGES).categories).toEqual([]);
    expect(configOf(QUERIES).categories).toEqual([]);
    expect(configOf(TREND).categories).toEqual([]);
  });

  it("przy zerze wierszy panel mówi „brak danych w oknie”, a nie tylko rysuje zera", async () => {
    // ZMIERZONE ZERO ma własny komunikat, bo prowadzi do innej decyzji niż brak
    // odczytu: tu właściwość została odczytana i naprawdę nie ma w niej ruchu.
    // Napis jest ten sam, co w dwóch sąsiednich pulpitach modułu
    // (`AudienceSegmentsDashboard`, `RelatedPostsAnalytics`), a warunek wymaga
    // udanego powrotu WSZYSTKICH sześciu zapytań - inaczej „brak danych"
    // pokazałby się właściwości, której dane dopiero jadą albo nie dojadą wcale.
    respondWith(EMPTY);
    panel();
    await loaded();

    expect(
      await screen.findByText(realT("pl")("adminAnalytics.common.noDataWindow")),
    ).toBeInTheDocument();
  });
});

describe("GscBiDashboard - wiersze brzegowe", () => {
  it("wiersz bez klucza wymiaru nie wstawia „undefined” w żadnym miejscu panelu", async () => {
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

    await waitFor(() => expect(configOf(TREND).categories).toEqual([""]));
    expect(configOf(QUERIES).categories).toEqual([""]);
    expect(slices(configOf(COUNTRIES)).map((x) => x.name)).toEqual(["?"]);
    expect(configOf(PAGES).categories).toEqual(["/"]);
    // Wiersz BEZ DATY nie ma miejsca na siatce kalendarza i go na nią nie
    // wpuszczamy: dopisany do pierwszej komórki przypisałby pomiar dniowi,
    // którego nikt nie zmierzył.
    expect(configOf(CALENDAR).categories).toEqual([]);
    expect(container.textContent ?? "").not.toContain("undefined");
  });

  it("wiersz bez klucza obok wierszy z kluczem nie psuje sortowania", async () => {
    const t = realT("pl");
    // Zbiór MIESZANY jest trudniejszy niż jednorodny: porównania w sortowaniu
    // biegną między wierszem z kluczem i bez, więc zapasowy napis musi zadziałać
    // po obu stronach porównania - inaczej `localeCompare` dostaje `undefined`
    // i seria ustawia się losowo.
    respondWith({
      date: [keylessRow(5, 50, 0.1, 4), row(SOBOTA, 10, 200, 0.05, 12)],
      query: [keylessRow(7, 70, 0.1, 4), row("fraza z kluczem", 3, 30, 0.1, 2)],
      page: [],
      country: [keylessRow(9, 90, 0.1, 4), row("pol", 4, 40, 0.1, 3)],
      device: [],
      prev: [],
    });
    const { container } = panel();
    await loaded();

    await waitFor(() => expect(configOf(TREND).categories).toEqual(["", SOBOTA]));
    expect(seriesValues(configOf(TREND), t("adminAnalytics.gsc.clicks"))).toEqual([5, 10]);
    // Rank MALEJĄCO: mocniejszy jest wiersz bez klucza, więc stoi na górze.
    expect(configOf(QUERIES).categories).toEqual(["", "fraza z kluczem"]);
    expect(slices(configOf(COUNTRIES)).map((x) => x.name)).toEqual(["?", "pol"]);
    // Tabela danych rankingu też nie wypisuje „undefined" przy pustej etykiecie.
    expect(tableRows(dataTableOf(QUERIES))).toEqual([
      ["", "7"],
      ["fraza z kluczem", "3"],
    ]);
    expect(container.textContent ?? "").not.toContain("undefined");
  });

  it("drążenie wiersza bez klucza otwiera okno z metrykami, a nie z „undefined”", async () => {
    const t = realT("pl");
    respondWith({
      date: [keylessRow(5, 50, 0.1, 4), row(SOBOTA, 10, 200, 0.05, 12)],
      query: [keylessRow(7, 70, 0.1, 4), row("fraza z kluczem", 3, 30, 0.1, 2)],
      page: [],
      country: [keylessRow(9, 90, 0.1, 4), row("pol", 4, 40, 0.1, 3)],
      device: [],
      prev: [],
    });
    panel();
    await loaded();
    await waitFor(() => expect(configOf(TREND).categories).toEqual(["", SOBOTA]));

    // Trend: pierwszy punkt to wiersz bez daty.
    await clickChart(chartOf(TREND), { categoryIndex: 0, category: "" });
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("5");
    const trendDialog = screen.getByRole("dialog");
    expect(trendDialog.textContent ?? "").not.toContain("undefined");
    fireEvent.keyDown(trendDialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Rank: górna pozycja osi to wiersz bez klucza, bo jest najmocniejszy.
    await clickChart(chartOf(QUERIES), { categoryIndex: 0, category: "" });
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("7");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Pierścień: wycinek „?" to nadal konkretny wiersz, więc ma się otworzyć.
    await clickChart(chartOf(COUNTRIES), { categoryIndex: 0, category: "?", value: 9 });
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("9");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Kalendarz: na siatce stoi WYŁĄCZNIE dzień z datą - 2026-08-01, sobota.
    expect(configOf(CALENDAR).categories).toEqual([TYDZIEN_1]);
    await clickChart(chartOf(CALENDAR), { categoryIndex: 0, seriesIndex: 5, value: 10 });
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("200");
  });

  it("wskazanie trendu bez indeksu kategorii nie otwiera okna", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(configOf(TREND).categories).toHaveLength(3));

    await clickChart(chartOf(TREND), { seriesName: "CTR" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pozycja spoza wszystkich przedziałów nie dokłada się do żadnego słupka", async () => {
    // Pozycja 0 nie istnieje w SERP - wpadnięcie takiego wiersza do przedziału
    // „1-3" zawyżyłoby najważniejszy słupek raportu.
    const t = realT("pl");
    respondWith({
      ...EMPTY,
      date: DATE_ROWS,
      query: [row("pozycja zerowa", 7, 70, 0.1, 0), row("uczciwa fraza", 3, 30, 0.1, 2)],
    });
    panel();
    await loaded();

    await waitFor(() => expect(configOf(POSITIONS).categories).toHaveLength(5));
    const o = configOf(POSITIONS);
    expect(seriesValues(o, t("adminAnalytics.gsc.impressions"))).toEqual([30, 0, 0, 0, 0]);
    expect(seriesValues(o, t("adminAnalytics.gsc.clicks"))).toEqual([3, 0, 0, 0, 0]);
  });

  it("pusty przedział pozycji pokazuje CTR 0,00%, a nie dzielenie przez zero", async () => {
    respondWith({
      ...EMPTY,
      date: DATE_ROWS,
      query: [row("uczciwa fraza", 3, 30, 0.1, 2)],
    });
    panel();
    await loaded();
    await waitFor(() => expect(configOf(POSITIONS).categories).toHaveLength(5));

    await clickChart(chartOf(POSITIONS), { categoryIndex: 4, category: "51+" });

    expect(metricValue("CTR")).toBe("0.00%");
    expect(metricValue(realT("pl")("adminAnalytics.gsc.impressions"))).toBe("0");
  });

  it("wskazanie bez indeksu kategorii nie otwiera okna na żadnym wykresie", async () => {
    panel();
    await loaded();
    await waitFor(() => expect(configOf(QUERIES).categories).toHaveLength(5));

    // Silnik oddaje wskazanie także wtedy, gdy nie rozstrzyga kategorii - wtedy
    // `categoryIndex` jest `null` i panel nie ma czego otworzyć.
    await clickChart(chartOf(QUERIES), { category: "os" });
    expect(screen.queryByRole("dialog")).toBeNull();

    await clickChart(chartOf(POSITIONS), { category: "os" });
    expect(screen.queryByRole("dialog")).toBeNull();

    await clickChart(chartOf(COUNTRIES), { categoryIndex: 0 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("strona bez ani jednego kliknięcia pokazuje zera, a odnośnik prowadzi do jej adresu", async () => {
    const t = realT("pl");
    respondWith({ ...FULL, page: [row("https://alfa.example.com/kontakt", 0, 0, 0, 0)] });
    panel();
    await loaded();
    await waitFor(() => expect(configOf(PAGES).categories).toEqual(["/kontakt"]));

    await clickChart(chartOf(PAGES), { categoryIndex: 0, category: "/kontakt" });

    const d = screen.getByRole("dialog");
    expect(metricValue(t("adminAnalytics.gsc.clicks"))).toBe("0");
    expect(metricValue(t("adminAnalytics.gsc.impressions"))).toBe("0");
    expect(metricValue("CTR")).toBe("0.00%");
    expect(metricValue(t("adminAnalytics.gsc.avgPosition"))).toBe("0.0");
    expect(
      within(d).getByRole("link", { name: t("adminAnalytics.drillDialog.openInNewTab") }),
    ).toHaveAttribute("href", "https://alfa.example.com/kontakt");
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

  it("awaria zapytania wystawia komunikat Z PRZYCZYNĄ, nie milczącą siatkę zer", async () => {
    // Bliźniaczy pulpit GA4 z tego samego modułu robi to samo kartą
    // `adminAnalytics.ga4.apiError`. Wcześniej GSC połykał wyjątek: zapytania
    // stały w stanie `error`, a panel malował pełną siatkę zer - operator
    // widział „brak ruchu" tam, gdzie w rzeczywistości padła bramka. Komunikat
    // niesie PRZYCZYNĘ z wyjątku, bo „coś nie działa" nie prowadzi do żadnej
    // decyzji, a „GSC 503" prowadzi do ponowienia albo do sprawdzenia integracji.
    const t = realT("pl");
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    const { container } = panel();
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));

    expect(
      await screen.findByText(
        t("adminAnalytics.common.readFailedReason", { reason: "GSC 503: backend error" }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("adminAnalytics.common.readFailedHint"))).toBeInTheDocument();
    expect(container.textContent ?? "").toMatch(/503|b[łl][ąa]d|error/i);
  });

  it("przy padniętym zapytaniu KPI mówi „Awaria odczytu”, a nie 0", async () => {
    // Ten sam mechanizm co dla stanu ładowania, ale INNY napis: zero po awarii
    // jest gorsze niż zero w trakcie odczytu, bo wygląda na wynik końcowy.
    // Kafelek traci też deltę - procent liczony z okna, którego nie odczytano,
    // pokazywałby kierunek wzięty z niczego.
    const t = realT("pl");
    h.queryAnalytics.mockRejectedValue(new Error("GSC 503: backend error"));
    panel();
    await waitFor(() => expect(h.queryAnalytics.mock.calls.length).toBeGreaterThanOrEqual(6));

    await waitFor(() =>
      expect(kpiValue(t("adminAnalytics.gsc.clicks"))).toBe(
        t("adminAnalytics.common.readFailedShort"),
      ),
    );
    expect(kpiValue(t("adminAnalytics.gsc.clicks"))).not.toBe("0");
    expect(kpiValue("CTR")).toBe(t("adminAnalytics.common.readFailedShort"));
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
    await waitFor(() => expect(first.container.textContent ?? "").toContain("energia w cee"));
    first.unmount();

    h.listSites.mockResolvedValue({ sites: [site(SITE_B)], configured: true });
    respondWith({
      ...EMPTY,
      date: [row(SOBOTA, 4, 40, 0.1, 3)],
      query: [row("beta fraza wlasna", 4, 40, 0.1, 3)],
    });
    h.queryAnalytics.mockClear();
    const second = panel(true, client);

    await waitFor(() => expect(second.container.textContent ?? "").toContain("beta fraza wlasna"));
    // Zapytanie warsztatu A nie ma prawa zostać na ekranie warsztatu B.
    expect(second.container.textContent ?? "").not.toContain("energia w cee");
    expect(second.container.textContent ?? "").not.toContain("raport nes");
  });

  it("klucz cache listy właściwości niesie warsztat, więc PIERWSZA klatka panelu B jest czysta", async () => {
    // NAJOSTRZEJSZY przypadek izolacji: klient react-query przeżywa zmianę
    // warsztatu, więc każdy klucz panelu musi nieść identyfikator najemcy.
    // Przy stałym `["gsc-sites"]` panel warsztatu B dostawał z cache listę
    // właściwości warsztatu A, `preferredSite` wskazywał cudzą właściwość,
    // a wpisy `["gsc-bi", <cudza właściwość>, ...]` były jeszcze świeże
    // (`staleTime: 60_000`) - więc pierwsza klatka malowała cudze frazy BEZ
    // ani jednego zapytania sieciowego. To czyni wyciek CICHYM: nie widać go
    // w ruchu, tylko na ekranie, i dlatego asercja idzie na PIERWSZĄ klatkę,
    // a nie na stan po dojechaniu danych.
    //
    // Przejście między warsztatami odgrywamy tak, jak wygląda w aplikacji:
    // zmienia się najemca (`h.tenantId`) ORAZ to, co bramka oddaje dla niego.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = panel(true, client);
    await loaded();
    await waitFor(() => expect(first.container.textContent ?? "").toContain("energia w cee"));
    first.unmount();

    h.tenantId = TENANT_B;
    h.listSites.mockResolvedValue({ sites: [site(SITE_B)], configured: true });
    respondWith({ ...EMPTY, query: [row("beta fraza wlasna", 4, 40, 0.1, 3)] });
    const second = panel(true, client);

    expect(second.container.textContent ?? "").not.toContain("energia w cee");
    // ...i nie chodzi o pustą kartę: własne dane warsztatu B dojeżdżają.
    await waitFor(() => expect(second.container.textContent ?? "").toContain("beta fraza wlasna"));
    expect(second.container.textContent ?? "").not.toContain("energia w cee");
    expect(
      analyticsInputs()
        .filter((i) => i.siteUrl !== "")
        .every((i) => i.siteUrl === SITE_A || i.siteUrl === SITE_B),
    ).toBe(true);
  });
});

describe("GscBiDashboard - dostępność", () => {
  it("każdy z siedmiu wykresów ma region ARIA nazwany tytułem swojej karty", async () => {
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
  });

  it("każdy z siedmiu wykresów ma tabelę danych i podpowiedź obsługi", async () => {
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

  it("poza nienazwanymi przyciskami panel nie ma innych naruszeń axe", async () => {
    const { container } = panel();
    await loaded();

    // Regułę `button-name` wyłączamy TYLKO tutaj, żeby ten przypadek pilnował
    // STRUKTURY panelu - kolejności nagłówków, poprawności ARIA, semantyki list
    // i tabel - niezależnie od nazw kontrolek. Nazwy ma na sobie przypadek
    // niżej, który jedzie pełnym zestawem reguł; rozdzielenie zostaje, bo
    // regresja w nazwie przycisku i regresja w strukturze to dwie różne awarie
    // i mają się zgłaszać osobno.
    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(summarize(violations)).toBe("");
  });

  it("karta niepodłączonej integracji jest wolna od naruszeń axe", async () => {
    const { container } = panel(false);

    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("każda z kontrolek panelu ma dostępną nazwę", async () => {
    // DWA RÓŻNE MECHANIZMY NAPRAWY. Pola wyboru w pasku narzędzi (właściwość,
    // okno) mają widoczną etykietę `<label>`, ale `<label>` NIE nazywa
    // wyzwalacza Radiksa: to `button` z rolą `combobox`, a dla tej roli nazwę
    // buduje wyłącznie autor - ani treść przycisku, ani `htmlFor` się nie
    // liczą. Dlatego każdy wyzwalacz wskazuje swoją etykietę przez
    // `aria-labelledby`: nazwa dostępna jest wtedy DOKŁADNIE napisem widocznym
    // na ekranie (WCAG 2.5.3), bez drugiego napisu w słowniku. Siedem
    // przycisków eksportu na kartach to sama ikona `MoreHorizontal`, więc te
    // dostają nazwę ze słownika w `ChartCard.tsx` - tak samo jak sąsiedni
    // przełącznik pełnego ekranu.
    const t = realT("pl");
    const { container } = panel();
    await loaded();

    expect(
      screen.getByRole("combobox", { name: t("adminAnalytics.gsc.property") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: t("adminAnalytics.gsc.window") }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: t("adminAnalytics.chartCard.exportMenu") }),
    ).toHaveLength(7);
    expect(
      screen.getAllByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") }),
    ).toHaveLength(7);

    // Pełne axe, BEZ wyłączonej reguły `button-name` - to jedyny przypadek
    // panelu, który przepuszcza cały zestaw reguł.
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("GscBiDashboard - dwujęzyczność", () => {
  it("wszystkie siedem kart wykresów nazywa się ze słownika PL", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    for (const key of CHART_TITLE_KEYS) {
      expect(chartOf(key).ariaLabel).toBe(regionName("pl", key));
    }
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

    for (const key of CHART_TITLE_KEYS) {
      // Brak klucza w EN oznaczałby cichy fallback na polski tytuł - a to
      // wygląda jak działający panel, więc nikt tego nie zgłosi.
      expect(en(key)).not.toBe(pl(key));
      expect(chartOf(key, "en").ariaLabel).toBe(regionName("en", key));
      expect(container.textContent ?? "").not.toContain(pl(key));
    }
    expect(
      screen.getByText(en("adminAnalytics.gsc.insightsSubtitle", { site: SITE_A, days: 28 })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en("adminAnalytics.common.refresh") }),
    ).toBeInTheDocument();
  });

  it("tabela danych i wiersze kalendarza też są dwujęzyczne", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    panel();
    await loaded();

    await waitFor(() => expect(configOf(QUERIES, "en").categories).toHaveLength(5));
    expect(tableHeaders(dataTableOf(QUERIES, "en"))).toEqual([
      en("charts.frame.category"),
      en("adminAnalytics.gsc.clicks"),
    ]);
    // Wiersze macierzy kalendarza to napisy ze słownika, nie skróty z `Intl`:
    // bramka parytetu PL/EN widzi tylko słownik.
    expect(configOf(CALENDAR, "en").series[0].name).toBe(en("adminAnalytics.gsc.weekdays.mon"));
    expect(configOf(CALENDAR, "en").series[0].name).not.toBe(
      realT("pl")("adminAnalytics.gsc.weekdays.mon"),
    );
  });
});
