// `AudienceSegmentsDashboard` - pulpit "zalogowani vs anonimowi": progi
// interpretacji, trzy stany, okno czasu i izolacja warsztatów.
//
// PO CO. Plik stał na zerze. Agregacja tego pulpitu siedzi w server function
// (`audience.functions.ts`) i testują ją inni - TUTAJ przedmiotem dowodu jest
// to, czego tamten plik nie widzi, a co decyduje o tym, czy administrator
// czyta POMIAR, czy atrapę pomiaru:
//
//   1. TRZY STANY, TRZY OBRAZY. "Jeszcze nie wiem", "zapytanie padło" i "w
//      oknie naprawdę nie było odsłon" kończyły się tu JEDNYM obrazem: cztery
//      kafelki z zerem. Gorzej - przy braku `q.data` lista wniosków była pusta,
//      a `InsightSection` maluje wtedy zielone "nie znaleziono krytycznych
//      zagadnień", więc awaria odczytu `post_views` meldowała się jako dobra
//      wiadomość o treści. Dziś każdy z tych stanów ma własny napis na miejscu
//      liczby, własny wpis audytu, a dwa pierwsze także własną kartę
//      (`role="status"` z `aria-busy` w pomiarze, `role="alert"` z przyczyną po
//      awarii). Cztery przypadki niżej pilnują, że stany się nie zlewają.
//   2. PROGI INTERPRETACJI. 5%, 60% i "4 wpisy na zalogowanego" to granice
//      między trzema różnymi ZALECENIAMI dla redakcji (CTA rejestracji vs
//      personalizacja vs nic). Przesunięcie granicy albo zamiana gałęzi
//      `if`/`else if` nie wywraca panelu - podmienia polecenie przy
//      niezmienionym wyglądzie karty. Asercje idą na napisy ze słownika.
//   3. SEGMENT MUSI TRAFIĆ DO SWOJEJ SERII. Wykres to dwa słupki w stosie
//      `views`. Zamiana `logged` z `anon` (albo podpięcie tej samej tablicy
//      dwa razy) daje wykres, który się rysuje i kłamie. Dlatego sprawdzamy
//      PARĘ nazwa-dane w opcji oddanej kanwie, nie sam fakt renderu.
//   4. OKNO CZASU. Zmiana presetu ma przestawić WEJŚCIE funkcji serwerowej
//      (`{ days }`), nie tylko etykietę w selekcie.
//   5. IZOLACJA WARSZTATOW. `queryKey: ["admin","audience-segments", days]` nie
//      niósł ani tenanta, ani użytkownika, ani znacznika czasu - dwa
//      montowania z tym samym oknem trafiały w JEDEN wpis cache, a przy
//      `staleTime: 60_000` drugi warsztat widział tytuły pierwszego bez ani
//      jednego żądania. Dziś klucz niesie najemcę (atrapa `h.tenantId`), a
//      zapytanie jest wstrzymane do jego rozwiązania; dowodzą tego dwa
//      przypadki na WSPÓŁDZIELONYM kliencie cache.
//   6. SŁOWNIK I FORMAT LICZB. Napisy są asertowane przez `realT("pl")` /
//      `realT("en")`, czyli tę samą instancję i18next, którą widzi użytkownik.
//      Osobno: liczby idą przez locale JĘZYKA INTERFEJSU, nie przez zaszyte
//      `"pl-PL"` - inaczej angielski administrator dostawał polskie grupowanie
//      tysięcy.
//
//   7. DOSTĘPNOŚĆ BEZ ULG. Oba przebiegi axe (panel z danymi i bez) asertują
//      PEŁNĄ listę naruszeń równą pustej. Selektor okna ma nazwę ze słownika, a
//      wykres - `role="img"` z nazwą i tabelę danych powiązaną przez
//      `aria-describedby`, bo idzie przez `ChartCard` z `csv`.
//
// ECHARTS JEST TU ZAKAZANY (patrz nagłówek `EChart.tsx`): podmieniamy `EChart`
// atrapą, która PRZECHWYTUJE `option`. Dzięki temu serie i legenda są badane na
// strukturze danych oddanej wykresowi, a nie na pikselach - i ~1 MB biblioteki
// nigdy nie wchodzi do procesu testowego.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AudienceSegmentsResult,
  AudienceTopPost,
  AudienceDayPoint,
} from "@/lib/analytics/audience.functions";
import type { AppLang } from "@/lib/i18n/localePath";

type Opt = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fetchAudience: vi.fn(),
  tenantId: "tenant-alfa" as string | null,
  charts: [] as Array<{ option: Record<string, unknown>; height?: number | string }>,
}));

// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy.
// Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywracałaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/audience.functions", () => ({
  getAudienceSegments: (...args: unknown[]) => h.fetchAudience(...args),
}));

// Najemca jest ATRAPĄ, a nie prawdziwym `useCurrentTenantId`: tamten ciągnie
// klienta Supabase i sesję `useAuth`, a przedmiotem dowodu jest tylko to, że
// identyfikator warsztatu WCHODZI DO KLUCZA react-query. Sterowanie nim z testu
// (`h.tenantId`) daje jedyny sposób odegrania przejścia między warsztatami na
// TYM SAMYM kliencie cache.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

// Atrapa odwzorowuje to, co daje PRAWDZIWY `EChart`: element bez żadnej nazwy
// dostępnej (na serwerze `aria-hidden` szkielet, na kliencie kanwa). Dzięki
// temu asercja o braku tekstowej alternatywy mierzy panel, nie atrapę.
vi.mock("../EChart", () => ({
  EChart: ({ option, height }: { option: Record<string, unknown>; height?: number | string }) => {
    h.charts.push({ option, height });
    return <div data-testid="echart" />;
  },
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujęzyczny, a przedmiotem
// dowodu jest to, że napisy przychodzą ZE SŁOWNIKA.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { AudienceSegmentsDashboard } from "../AudienceSegmentsDashboard";

// ---------------------------------------------------------------------------
// Słownik
// ---------------------------------------------------------------------------

function aud(path: string, vars: Record<string, unknown> = {}, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.audience.${path}`, vars);
}

function audList(path: string, lang: AppLang = "pl"): string[] {
  return realT(lang)(`adminAnalytics.audience.${path}`, { returnObjects: true }) as string[];
}

function common(path: string, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.common.${path}`);
}

/** Wspólny napis Z INTERPOLACJĄ - osobno, bo `common` bierze język na drugiej pozycji. */
function commonVars(path: string, vars: Record<string, unknown>, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.common.${path}`, vars);
}

function insightChrome(
  path: string,
  vars: Record<string, unknown> = {},
  lang: AppLang = "pl",
): string {
  return realT(lang)(`adminAnalytics.insightSection.${path}`, vars);
}

function preset(days: 7 | 30 | 90, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.timeRange.preset${days}d`);
}

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

function post(id: string, title: string, views: number, uniques: number): AudienceTopPost {
  return { post_id: id, title, slug: id, views, uniques };
}

function day(d: string, logged: number, anon: number): AudienceDayPoint {
  return { day: d, logged, anon };
}

/**
 * Raport z JEDNYM źródłem prawdy o proporcjach: KPI liczy się z podanych
 * odsłon, więc test nie może przypadkiem asertować udziału, którego w danych
 * nie ma.
 */
function result(over: {
  logged?: number;
  anon?: number;
  uniqueLogged?: number;
  uniqueAnon?: number;
  series?: AudienceDayPoint[];
  topLogged?: AudienceTopPost[];
  topAnon?: AudienceTopPost[];
  truncated?: boolean;
  days?: number;
}): AudienceSegmentsResult {
  const viewsLogged = over.logged ?? 0;
  const viewsAnon = over.anon ?? 0;
  const uniqueLogged = over.uniqueLogged ?? Math.min(viewsLogged, 1);
  const uniqueAnon = over.uniqueAnon ?? Math.min(viewsAnon, 1);
  return {
    kpi: {
      views_total: viewsLogged + viewsAnon,
      views_logged: viewsLogged,
      views_anon: viewsAnon,
      unique_readers: uniqueLogged + uniqueAnon,
      unique_logged: uniqueLogged,
      unique_anon: uniqueAnon,
      window_days: over.days ?? 30,
    },
    series: over.series ?? [],
    top_logged: over.topLogged ?? [],
    top_anon: over.topAnon ?? [],
    truncated: over.truncated ?? false,
  };
}

/** Okno bez ani jednej odsłony - dokładnie to, co zwraca `EMPTY` w server fn. */
const EMPTY = result({});

/** Zdrowe okno: udział zalogowanych 50%, więc ŻADEN próg nie jest przekroczony. */
const NEUTRAL = result({
  logged: 500,
  anon: 500,
  uniqueLogged: 200,
  uniqueAnon: 400,
  series: [day("2026-08-01", 300, 200), day("2026-08-02", 200, 300)],
  topLogged: [post("p-log", "Energia w regionie", 120, 40)],
  topAnon: [post("p-anon", "Klimat i miasta", 300, 250)],
});

/** Dwa rozłączne warsztaty - identyfikator wchodzi do klucza cache. */
const TENANT_A = "tenant-alfa";
const TENANT_B = "tenant-beta";

/** Raport "warsztatu A" - każdy napis niesie rozpoznawalny prefiks. */
const WORKSPACE_A = result({
  logged: 100,
  anon: 100,
  series: [day("2026-08-01", 100, 100)],
  topLogged: [post("a-1", "ALFA analiza energetyczna", 100, 10)],
  topAnon: [post("a-2", "ALFA raport klimatyczny", 100, 90)],
});

/** Raport "warsztatu B" - rozłączny z A na każdym napisie. */
const WORKSPACE_B = result({
  logged: 7,
  anon: 7,
  series: [day("2026-08-01", 7, 7)],
  topLogged: [post("b-1", "BETA notatka transportowa", 7, 3)],
  topAnon: [post("b-2", "BETA przeglad rynku", 7, 6)],
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
function numList(v: unknown): number[] {
  return Array.isArray(v) ? (v as unknown[]).map(Number) : [];
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map(String) : [];
}

/** Ostatnia opcja oddana kanwie - panel ma dokładnie jeden wykres. */
function chartOption(): Opt {
  const last = h.charts[h.charts.length - 1];
  if (!last) throw new Error("test: panel nie oddal kanwie zadnej opcji");
  return last.option as Opt;
}

/** Kafelek KPI stojący przy podanej etykiecie. */
function kpiCard(label: string): HTMLElement {
  const parent = screen.getByText(label).parentElement?.parentElement;
  if (!parent) throw new Error(`test: nie znaleziono kafelka KPI "${label}"`);
  return parent as HTMLElement;
}
function kpiValue(label: string): string {
  return kpiCard(label).children[1]?.textContent ?? "";
}
function kpiHint(label: string): string {
  return kpiCard(label).children[2]?.textContent ?? "";
}

/** Karta listy "Top ..." - nagłówek jest jej wnukiem, więc dwa poziomy w górę. */
function topCard(title: string): HTMLElement {
  const parent = screen.getByRole("heading", { name: title }).parentElement?.parentElement;
  if (!parent) throw new Error(`test: nie znaleziono karty "${title}"`);
  return parent as HTMLElement;
}
function topRows(title: string): string[] {
  return Array.from(topCard(title).querySelectorAll("ol > li")).map((li) => li.textContent ?? "");
}

/** Karta wniosku o podanym tytule - `InsightSection` renderuje `li` per wpis. */
function insightCard(title: string): HTMLElement {
  const li = screen.getByText(title).closest("li");
  if (!li) throw new Error(`test: nie znaleziono wniosku "${title}"`);
  return li as HTMLElement;
}
function insightFixes(title: string): string[] {
  return Array.from(insightCard(title).querySelectorAll("ul > li")).map((li) =>
    (li.textContent ?? "").replace(/^→/, "").trim(),
  );
}

/** Wejścia, które panel podał funkcji serwerowej, w kolejności wywołań. */
function queriedDays(): number[] {
  return h.fetchAudience.mock.calls.map((c) => (c[0] as { data: { days: number } }).data.days);
}

/** Radix Select otwiera listę klawiszem - w happy-dom to najpewniejsza droga. */
async function pickRange(label: string): Promise<void> {
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

function panel(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <AudienceSegmentsDashboard />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/**
 * Czeka, aż raport DOJEDZIE do panelu.
 *
 * ŚWIADOMIE NIE OPIERA SIĘ na zniknięciu samego wskaźnika postępu. Wskaźnik
 * pokazuje `isFetching`, a przy obciążonej maszynie pierwszy render może wypaść
 * PRZED startem zapytania: wskaźnika nie ma jeszcze wcale, więc asercja "nie ma
 * wskaźnika" przechodzi na PUSTYM panelu i test mierzy stan przejściowy.
 * Dokładnie tak oblewały się cztery przypadki przy `load average` 34. Dlatego
 * czekamy na rozstrzygnięcie obietnic, które atrapa naprawdę oddała, wewnątrz
 * `act`.
 *
 * DOMKNIĘCIE IDZIE NA DWA SYGNAŁY NIEZALEŻNE OD JĘZYKA: znika pasek `isFetching`
 * ORAZ ustępuje karta pomiaru, którą panel znaczy `aria-busy="true"`. Bramka na
 * napisie ("Trwa pomiar...") przechodziłaby jałowo w przypadkach angielskich, a
 * bramka na samym `animate-spin` nie odróżnia "wskaźnika już nie ma" od
 * "wskaźnika jeszcze nie było".
 */
async function loaded(): Promise<void> {
  await waitFor(() => expect(h.fetchAudience).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(h.fetchAudience.mock.results.map((r) => r.value));
  });
  await waitFor(() => {
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.charts.length = 0;
  h.tenantId = TENANT_A;
  h.fetchAudience.mockReset();
  h.fetchAudience.mockResolvedValue(NEUTRAL);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - trzy stany panelu", () => {
  it("w trakcie pobierania miga wskaźnik postępu obok selektora okna", async () => {
    h.fetchAudience.mockImplementation(() => new Promise<AudienceSegmentsResult>(() => {}));
    const { container } = panel();

    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeNull());
    // Nagłówek i selektor żyją od pierwszej klatki - operator może zmienić okno,
    // nie czekając na odpowiedź.
    expect(screen.getByRole("heading", { name: aud("title") })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeEnabled();
  });

  it("w trakcie pobierania kafelki NIE meldują zera odsłon jako pomiaru", async () => {
    // Zero na pulpicie audytorium czyta się jako twierdzenie o ruchu, a przed
    // odczytem takiego twierdzenia postawić nie wolno. Na miejsce liczby wchodzi
    // więc napis o STANIE (`common.measuringShort`) - `q.data?.kpi.x ?? 0` nie
    // odróżniało "nie wiem" od "nie było".
    h.fetchAudience.mockImplementation(() => new Promise<AudienceSegmentsResult>(() => {}));
    const { container } = panel();
    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeNull());

    const shown = [
      kpiValue(aud("kpi.viewsTotal")),
      kpiValue(aud("kpi.logged")),
      kpiValue(aud("kpi.anon")),
      kpiValue(aud("kpi.uniqueReaders")),
    ];
    expect(shown).not.toEqual(["0", "0", "0", "0"]);
    // ...i nie chodzi o dowolną inną liczbę: wszystkie cztery kafelki mówią, że
    // pomiar trwa.
    expect(shown).toEqual(Array<string>(4).fill(common("measuringShort")));
    // Karta stanu jest ogłoszona i oznaczona jako "w toku" - stąd bramka
    // pomocnika `loaded()`.
    expect(screen.getByRole("status")).toHaveTextContent(common("measuring"));
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    // Listy "Top ..." też nie twierdzą o oknie: `noDataWindow` znaczy w tym
    // słowniku ZMIERZONE ZERO, więc przed odczytem jest tam napis o pomiarze.
    expect(screen.queryByText(common("noDataWindow"))).toBeNull();
  });

  it("w trakcie pobierania panel NIE ogłasza braku krytycznych zagadnień", async () => {
    // Pusta lista wniosków każe `InsightSection` namalować zieloną kartę "nie
    // znaleziono krytycznych zagadnień - utrzymaj obecną strategię", czyli
    // zaliczyć audyt przed audytem. Dopóki pomiaru nie ma, na liście stoi
    // wniosek o POMIARZE W TOKU, nie cisza.
    h.fetchAudience.mockImplementation(() => new Promise<AudienceSegmentsResult>(() => {}));
    const { container } = panel();
    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeNull());

    expect(screen.queryByText(insightChrome("emptyDefault"))).toBeNull();
    // Lokalizacja przez `li.rounded-md`, a nie przez napis: ten sam komunikat
    // stoi ŚWIADOMIE w dwóch miejscach - w ogłoszonej karcie stanu na górze i
    // we wpisie audytu na dole - więc `getByText` miałby dwa trafienia.
    const items = container.querySelectorAll("ul > li.rounded-md");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(common("measuring"));
    expect(items[0]).toHaveTextContent(common("measuringHint"));
  });

  it("okno bez odsłon pokazuje wniosek ze słownika, a nie puste karty", async () => {
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    const title = aud("insights.empty.title");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightCard(title)).toHaveTextContent(aud("insights.empty.detail"));
    expect(insightFixes(title)).toEqual(audList("insights.empty.fixes"));
    // Element, do którego wniosek jest przypięty - inaczej operator nie wie,
    // czego dotyczy zalecenie.
    expect(insightCard(title)).toHaveTextContent(aud("insights.empty.element"));
  });

  it("okno bez odsłon daje dwie listy top z komunikatem o braku danych", async () => {
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(screen.getAllByText(common("noDataWindow"))).toHaveLength(2);
    expect(topCard(aud("topLogged")).querySelector("ol")).toBeNull();
    expect(topCard(aud("topAnon")).querySelector("ol")).toBeNull();
  });

  it("po awarii odczytu pasek narzędzi żyje - operator może zmienić okno", async () => {
    h.fetchAudience.mockRejectedValue(new Error("post_views read failed: 500"));
    panel();
    await loaded();

    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.getByRole("heading", { name: aud("title") })).toBeInTheDocument();
  });

  it("awaria odczytu NIE wygląda jak okno bez ruchu - panel podaje przyczynę", async () => {
    // `q.isError` / `q.error` nie były w tym pliku czytane ani raz, więc panel
    // malował cztery zera i zielone "brak krytycznych zagadnień", czyli kazał
    // szukać problemu w RUCHU tam, gdzie padł odczyt tabeli `post_views`.
    h.fetchAudience.mockRejectedValue(new Error("post_views read failed: 500"));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toMatch(/500|b[lł][aą]d|error/i);
    // Komunikat jest OGŁOSZONY (`role="alert"`) i niesie DOSŁOWNĄ przyczynę -
    // sama informacja "coś padło" nie prowadzi do żadnej decyzji.
    expect(screen.getByRole("alert")).toHaveTextContent(
      commonVars("readFailedReason", { reason: "post_views read failed: 500" }),
    );
    // Kafelki mówią o awarii, nie o zerze odsłon.
    expect(kpiValue(aud("kpi.viewsTotal"))).toBe(common("readFailedShort"));
    expect(kpiValue(aud("kpi.uniqueReaders"))).toBe(common("readFailedShort"));
    // Zmierzone zero brzmi INACZEJ niż awaria - inaczej obie sytuacje znów
    // zlałyby się w jeden obraz. Dotyczy to także pustych list "Top ...".
    expect(screen.queryByText(aud("insights.empty.title"))).toBeNull();
    expect(screen.queryByText(common("noDataWindow"))).toBeNull();
    expect(screen.getAllByText(common("readFailed"))).toHaveLength(2);
  });

  it("awaria odczytu NIE kończy się zielonym zaliczeniem audytu", async () => {
    h.fetchAudience.mockRejectedValue(new Error("post_views read failed: 500"));
    const { container } = panel();
    await loaded();

    expect(screen.queryByText(insightChrome("emptyDefault"))).toBeNull();
    // Wpis audytu niesie przyczynę i podpowiedź, co z nią zrobić.
    const items = container.querySelectorAll("ul > li.rounded-md");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(
      commonVars("readFailedReason", { reason: "post_views read failed: 500" }),
    );
    expect(items[0]).toHaveTextContent(common("readFailedHint"));
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - kafelki KPI", () => {
  it("każdy kafelek bierze WŁASNE pole raportu, bez przeliczania na miejscu", async () => {
    h.fetchAudience.mockResolvedValue(
      result({ logged: 12_345, anon: 6_789, uniqueLogged: 111, uniqueAnon: 222 }),
    );
    panel();
    await loaded();

    expect(kpiValue(aud("kpi.viewsTotal"))).toBe((19_134).toLocaleString("pl-PL"));
    expect(kpiValue(aud("kpi.logged"))).toBe((12_345).toLocaleString("pl-PL"));
    expect(kpiValue(aud("kpi.anon"))).toBe((6_789).toLocaleString("pl-PL"));
    expect(kpiValue(aud("kpi.uniqueReaders"))).toBe((333).toLocaleString("pl-PL"));
  });

  it("podpowiedź o unikalnych nie jest zamieniona między segmentami", async () => {
    // Oba kafelki używają TEGO SAMEGO klucza `uniqueHint` - jedyna różnica jest
    // w przekazanym `count`. Zamiana argumentów jest niewidoczna na oko.
    h.fetchAudience.mockResolvedValue(
      result({ logged: 10, anon: 10, uniqueLogged: 3, uniqueAnon: 9 }),
    );
    panel();
    await loaded();

    expect(kpiHint(aud("kpi.logged"))).toBe(aud("uniqueHint", { count: 3 }));
    expect(kpiHint(aud("kpi.anon"))).toBe(aud("uniqueHint", { count: 9 }));
  });

  it("kafelki łączne nie mają podpowiedzi - nie ma tam czego doliczać", async () => {
    panel();
    await loaded();

    expect(kpiCard(aud("kpi.viewsTotal")).children).toHaveLength(2);
    expect(kpiCard(aud("kpi.uniqueReaders")).children).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - progi interpretacji", () => {
  it("udział zalogowanych poniżej 5% daje ostrzeżenie z udziałem w procentach", async () => {
    // 40 / 1000 = 4,0%
    h.fetchAudience.mockResolvedValue(result({ logged: 40, anon: 960, uniqueLogged: 20 }));
    panel();
    await loaded();

    const title = aud("insights.lowLogged.title", { pct: "4.0" });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.lowLogged.fixes"));
    // Gałęzie są rozłączne - ostrzeżenie NIE może przyjść razem z pochwałą.
    // Rozróżnikiem jest `detail`, bo obie gałęzie mają IDENTYCZNY `element`
    // ("Segment zalogowanych") - asercja na plakietce nie odróżniłaby ich.
    expect(screen.queryByText(aud("insights.highLogged.detail"))).toBeNull();
  });

  it("dokładnie 5% NIE jest jeszcze ostrzeżeniem - próg jest ostry", async () => {
    // 50 / 1000 = 0,05, a warunek to `loggedShare < 0.05`.
    h.fetchAudience.mockResolvedValue(result({ logged: 50, anon: 950, uniqueLogged: 40 }));
    panel();
    await loaded();

    expect(screen.queryByText(aud("insights.lowLogged.detail"))).toBeNull();
    expect(screen.queryByText(aud("insights.highLogged.detail"))).toBeNull();
    expect(screen.getByText(insightChrome("emptyDefault"))).toBeInTheDocument();
  });

  it("udział powyżej 60% daje pochwałę, a nie ostrzeżenie", async () => {
    // 700 / 1000 = 70,0%
    h.fetchAudience.mockResolvedValue(result({ logged: 700, anon: 300, uniqueLogged: 600 }));
    panel();
    await loaded();

    const title = aud("insights.highLogged.title", { pct: "70.0" });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightCard(title)).toHaveTextContent(aud("insights.highLogged.detail"));
    expect(screen.queryByText(aud("insights.lowLogged.detail"))).toBeNull();
  });

  it("dokładnie 60% nie przekracza progu pochwały", async () => {
    // 600 / 1000 = 0,6, a warunek to `loggedShare > 0.6`.
    h.fetchAudience.mockResolvedValue(result({ logged: 600, anon: 400, uniqueLogged: 500 }));
    panel();
    await loaded();

    expect(screen.queryByText(aud("insights.highLogged.detail"))).toBeNull();
    expect(screen.queryByText(aud("insights.lowLogged.detail"))).toBeNull();
  });

  it("powyżej czterech wpisów na zalogowanego dochodzi wniosek o retencji", async () => {
    // 500 / 100 = 5,0 wpisów na zalogowanego; udział 50% nie odpala pozostałych
    // gałęzi, więc ten wniosek stoi na liście sam.
    h.fetchAudience.mockResolvedValue(
      result({ logged: 500, anon: 500, uniqueLogged: 100, uniqueAnon: 300 }),
    );
    panel();
    await loaded();

    const title = aud("insights.loyalLogged.title", { count: "5.0" });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.loyalLogged.fixes"));
  });

  it("dokładnie cztery wpisy na zalogowanego to jeszcze nie retencja", async () => {
    h.fetchAudience.mockResolvedValue(
      result({ logged: 400, anon: 400, uniqueLogged: 100, uniqueAnon: 300 }),
    );
    panel();
    await loaded();

    expect(screen.queryByText(aud("insights.loyalLogged.element"))).toBeNull();
  });

  it("zero unikalnych zalogowanych nie produkuje dzielenia przez zero", async () => {
    // `kpi.unique_logged > 0` jest jedyną osłoną przed `Infinity` w tytule.
    h.fetchAudience.mockResolvedValue(
      result({ logged: 90, anon: 10, uniqueLogged: 0, uniqueAnon: 5 }),
    );
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toMatch(/Infinity|NaN/);
    expect(screen.queryByText(aud("insights.loyalLogged.element"))).toBeNull();
  });

  it("przycięta próba daje i plakietkę przy wykresie, i osobny wniosek", async () => {
    h.fetchAudience.mockResolvedValue(result({ logged: 500, anon: 500, truncated: true }));
    panel();
    await loaded();

    expect(screen.getByText(aud("sampleTruncated"))).toBeInTheDocument();
    const title = aud("insights.trunc.title");
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.trunc.fixes"));
  });

  it("bez przycięcia plakietka przy wykresie NIE powstaje", async () => {
    panel();
    await loaded();

    expect(screen.queryByText(aud("sampleTruncated"))).toBeNull();
    expect(screen.queryByText(aud("insights.trunc.title"))).toBeNull();
  });

  it("pusty raport zatrzymuje się na jednym wniosku - reszta gałęzi nie wchodzi", async () => {
    // `total === 0` kończy funkcję `return out`, więc przy zerze nie może
    // pojawić się ani ostrzeżenie o udziale, ani wniosek o retencji.
    h.fetchAudience.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const items = container.querySelectorAll("ul > li.rounded-md");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(aud("insights.empty.title"));
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - dane oddane wykresowi", () => {
  it("każdy segment trafia do swojej serii, z nazwą ze słownika", async () => {
    h.fetchAudience.mockResolvedValue(
      result({
        logged: 500,
        anon: 500,
        series: [day("2026-08-01", 300, 200), day("2026-08-02", 200, 300)],
      }),
    );
    panel();
    await loaded();

    const s = seriesOf(chartOption());
    expect(s).toHaveLength(2);
    expect(s[0].name).toBe(aud("logged"));
    expect(numList(s[0].data)).toEqual([300, 200]);
    expect(s[1].name).toBe(aud("anon"));
    expect(numList(s[1].data)).toEqual([200, 300]);
    // Różne tablice, nie ta sama podpięta dwa razy.
    expect(numList(s[0].data)).not.toEqual(numList(s[1].data));
  });

  it("słupki stoją w JEDNYM stosie - inaczej wykres nie pokazuje sumy odsłon", async () => {
    panel();
    await loaded();

    const s = seriesOf(chartOption());
    expect(s.map((x) => x.stack)).toEqual(["views", "views"]);
    expect(s.map((x) => x.type)).toEqual(["bar", "bar"]);
  });

  it("oś X niesie dni raportu w kolejności, którą dał serwer", async () => {
    h.fetchAudience.mockResolvedValue(
      result({
        logged: 3,
        anon: 3,
        series: [day("2026-07-30", 1, 1), day("2026-07-31", 1, 1), day("2026-08-01", 1, 1)],
      }),
    );
    panel();
    await loaded();

    expect(strList(rec(chartOption().xAxis).data)).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
  });

  it("legenda wykresu jest dwuelementowa i zgodna z nazwami serii", async () => {
    panel();
    await loaded();

    const opt = chartOption();
    expect(strList(rec(opt.legend).data)).toEqual([aud("logged"), aud("anon")]);
    expect(seriesOf(opt).map((s) => String(s.name))).toEqual([aud("logged"), aud("anon")]);
  });

  it("brak danych daje wykres z pustymi seriami, a nie wyjątek", async () => {
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    const s = seriesOf(chartOption());
    expect(numList(s[0].data)).toEqual([]);
    expect(strList(rec(chartOption().xAxis).data)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - listy topowych wpisów", () => {
  it("wpis niesie tytuł, ścieżkę i obie liczby - odsłony oraz unikalnych", async () => {
    h.fetchAudience.mockResolvedValue(
      result({
        logged: 1234,
        anon: 1,
        topLogged: [post("energia-w-regionie", "Energia w regionie", 1234, 56)],
      }),
    );
    panel();
    await loaded();

    const rows = topRows(aud("topLogged"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Energia w regionie");
    expect(rows[0]).toContain("/energia-w-regionie");
    expect(rows[0]).toContain((1234).toLocaleString("pl-PL"));
    expect(rows[0]).toContain(`56 ${aud("uniqShort")}`);
  });

  it("wpis bez sluga nie renderuje samotnego ukośnika", async () => {
    h.fetchAudience.mockResolvedValue(
      result({
        logged: 5,
        anon: 1,
        topLogged: [{ post_id: "x", title: "Bez sluga", slug: null, views: 5, uniques: 2 }],
      }),
    );
    panel();
    await loaded();

    const rows = topRows(aud("topLogged"));
    expect(rows[0]).toContain("Bez sluga");
    expect(rows[0]).not.toContain("/");
  });

  it("dwie listy są rozłączne - wpisy anonimowych nie wyciekają do zalogowanych", async () => {
    panel();
    await loaded();

    expect(topRows(aud("topLogged")).join("|")).toContain("Energia w regionie");
    expect(topRows(aud("topLogged")).join("|")).not.toContain("Klimat i miasta");
    expect(topRows(aud("topAnon")).join("|")).toContain("Klimat i miasta");
    expect(topRows(aud("topAnon")).join("|")).not.toContain("Energia w regionie");
  });

  it("numeracja pozycji jest ciągła od jednego", async () => {
    h.fetchAudience.mockResolvedValue(
      result({
        logged: 6,
        anon: 1,
        topLogged: [
          post("a", "Pierwszy", 3, 1),
          post("b", "Drugi", 2, 1),
          post("c", "Trzeci", 1, 1),
        ],
      }),
    );
    panel();
    await loaded();

    const rows = topRows(aud("topLogged"));
    expect(rows[0].startsWith("1")).toBe(true);
    expect(rows[1].startsWith("2")).toBe(true);
    expect(rows[2].startsWith("3")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - okno czasu", () => {
  it("startowe okno to 30 dni i taka liczba trafia do WEJŚCIA funkcji", async () => {
    panel();
    await loaded();

    expect(queriedDays()).toEqual([30]);
  });

  it("wybór krótszego okna przestawia WEJŚCIE zapytania, nie tylko etykietę", async () => {
    panel();
    await loaded();

    await pickRange(preset(7));
    await waitFor(() => expect(queriedDays()).toEqual([30, 7]));
  });

  it("wybór najdłuższego okna daje dziewięćdziesiąt dni", async () => {
    panel();
    await loaded();

    await pickRange(preset(90));
    await waitFor(() => expect(queriedDays()).toEqual([30, 90]));
  });

  it("selektor oferuje dokładnie trzy okna, każde z etykietą ze słownika", async () => {
    panel();
    await loaded();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    const labels = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(labels).toEqual([preset(7), preset(30), preset(90)]);
  });

  it("zmiana okna nie gubi danych poprzedniego - każde okno ma własny wpis cache", async () => {
    h.fetchAudience.mockResolvedValueOnce(result({ logged: 1000, anon: 1000 }));
    h.fetchAudience.mockResolvedValueOnce(result({ logged: 10, anon: 10 }));
    panel();
    await loaded();
    expect(kpiValue(aud("kpi.viewsTotal"))).toBe((2000).toLocaleString("pl-PL"));

    await pickRange(preset(7));
    await waitFor(() => expect(kpiValue(aud("kpi.viewsTotal"))).toBe("20"));

    await pickRange(preset(30));
    // Powrót do okna 30 dni czyta cache, a nie serwer.
    await waitFor(() =>
      expect(kpiValue(aud("kpi.viewsTotal"))).toBe((2000).toLocaleString("pl-PL")),
    );
    expect(queriedDays()).toEqual([30, 7]);
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - izolacja warsztatów", () => {
  it("panel warsztatu B pokazuje WYŁĄCZNIE wpisy warsztatu B", async () => {
    h.fetchAudience.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("BETA notatka transportowa");
    expect(container.textContent ?? "").not.toContain("ALFA");
    // Dni jadą także do kanwy - wyciek może siedzieć w samych danych wykresu.
    expect(JSON.stringify(h.charts)).not.toContain("ALFA");
  });

  it("świeży klient react-query nie przenosi raportu między warsztatami", async () => {
    h.fetchAudience.mockResolvedValue(WORKSPACE_A);
    const first = panel();
    await loaded();
    expect(first.container.textContent ?? "").toContain("ALFA analiza energetyczna");
    first.unmount();
    h.charts.length = 0;

    h.fetchAudience.mockResolvedValue(WORKSPACE_B);
    const second = panel();
    await loaded();

    expect(second.container.textContent ?? "").not.toContain("ALFA");
    expect(second.container.textContent ?? "").toContain("BETA");
  });

  it("klucz cache niesie warsztat, więc drugi panel z tym samym oknem nie widzi cudzych wpisów", async () => {
    // NAJOSTRZEJSZY PRZYPADEK IZOLACJI. `queryKey: ["admin",
    // "audience-segments", days]` składał się z dwóch stałych i liczby dni:
    // nie było w nim ani tenanta, ani użytkownika, ani - inaczej niż w
    // `VitalsBiDashboard` - znacznika czasu okna. Dwa montowania z domyślnym
    // oknem 30 dni trafiały więc ZAWSZE w ten sam wpis cache, a
    // `staleTime: 60_000` blokował ponowienie: administrator warsztatu B
    // czytał tytuły warsztatu A i nie leciało przy tym ani jedno żądanie
    // sieciowe. Wyciek był CICHY - nie widać go w ruchu, tylko na ekranie,
    // dlatego klient react-query jest tu WSPÓŁDZIELONY i przeżywa zmianę
    // warsztatu, tak jak w aplikacji.
    //
    // Przejście odgrywamy tak, jak wygląda naprawdę: zmienia się najemca
    // (`h.tenantId`) ORAZ to, co serwer oddaje dla niego.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.fetchAudience.mockResolvedValue(WORKSPACE_A);
    const first = panel(client);
    await loaded();
    expect(first.container.textContent ?? "").toContain("ALFA analiza energetyczna");
    first.unmount();
    h.charts.length = 0;

    h.tenantId = TENANT_B;
    h.fetchAudience.mockResolvedValue(WORKSPACE_B);
    const second = panel(client);
    await loaded();

    expect(second.container.textContent ?? "").not.toContain("ALFA");
    // ...i nie chodzi o pustą kartę: własne dane warsztatu B dojeżdżają,
    // a odczyt dla nich REALNIE poleciał (dwa wywołania, nie jedno z cache).
    expect(second.container.textContent ?? "").toContain("BETA notatka transportowa");
    expect(h.fetchAudience.mock.calls).toHaveLength(2);
    expect(JSON.stringify(h.charts)).not.toContain("ALFA");
  });

  it("panel bez rozwiązanego najemcy NIE odpytuje serwera", async () => {
    // Odczyt puszczony przed rozwiązaniem warsztatu wpadłby do cache pod
    // kluczem z pustym najemcą i stamtąd przeciekał do pierwszego warsztatu,
    // który trafi w ten sam klucz. Dopóki najemcy nie ma, panel stoi w stanie
    // POMIARU, a nie w stanie "zmierzone zero".
    h.tenantId = null;
    const { container } = panel();

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(h.fetchAudience).not.toHaveBeenCalled();
    expect(kpiValue(aud("kpi.viewsTotal"))).toBe(common("measuringShort"));
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - słownik PL/EN", () => {
  it("po przełączeniu na angielski nagłówek i etykiety KPI przychodzą z gałęzi EN", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded();

    expect(screen.getByRole("heading", { name: aud("title", {}, "en") })).toBeInTheDocument();
    expect(screen.getByText(aud("kpi.viewsTotal", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(aud("kpi.uniqueReaders", {}, "en"))).toBeInTheDocument();
    // Tytuł wykresu jedzie dziś przez `ChartCard`, więc nie stoi w konspekcie
    // nagłówków - stoi w NAZWIE DOSTĘPNEJ regionu kanwy i w podpisie tabeli
    // danych. Asercja idzie na oba, czyli mocniej niż na sam `role="heading"`:
    // dowodzi i angielskiego napisu, i tego, że alternatywa tekstowa jest z nim
    // powiązana.
    expect(screen.getByText(aud("dailyViews", {}, "en"))).toBeInTheDocument();
    const regionName = realT("en")("adminAnalytics.chartCard.chartRegion", {
      title: aud("dailyViews", {}, "en"),
    });
    expect(screen.getByRole("img", { name: regionName })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: regionName })).toBeInTheDocument();
  });

  it("angielskie wnioski nie spadają na polski fallback", async () => {
    await i18n.changeLanguage("en");
    h.fetchAudience.mockResolvedValue(result({ logged: 40, anon: 960, uniqueLogged: 20 }));
    panel();
    await loaded();

    const title = aud("insights.lowLogged.title", { pct: "4.0" }, "en");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.lowLogged.fixes", "en"));
    // Ten sam klucz po polsku brzmi inaczej - gdyby EN spadł na fallback,
    // asercja wyżej przeszłaby, a ta by oblała.
    expect(title).not.toBe(aud("insights.lowLogged.title", { pct: "4.0" }));
  });

  it("nazwy serii wykresu też są tłumaczone, nie wpisane po polsku", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded();

    expect(seriesOf(chartOption()).map((s) => String(s.name))).toEqual([
      aud("logged", {}, "en"),
      aud("anon", {}, "en"),
    ]);
  });

  it("okno bez odsłon po angielsku używa angielskiego komunikatu list top", async () => {
    await i18n.changeLanguage("en");
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(screen.getAllByText(common("noDataWindow", "en"))).toHaveLength(2);
  });

  it("liczby są formatowane locale JĘZYKA INTERFEJSU, nie zaszytym pl-PL", async () => {
    // `value.toLocaleString("pl-PL")` w `KpiCard` i w `TopPosts` ignorował język
    // interfejsu. `ClientErrorsDashboard` w tym samym katalogu robi to poprawnie
    // (`i18n.language === "en" ? "en-GB" : "pl-PL"`), więc nie była to decyzja
    // produktowa, tylko rozjazd: angielski administrator widział "12 345" tam,
    // gdzie jego locale pisze "12,345".
    await i18n.changeLanguage("en");
    h.fetchAudience.mockResolvedValue(
      result({
        logged: 12_345,
        anon: 1,
        topLogged: [post("p", "Energy in the region", 12_345, 6_789)],
      }),
    );
    panel();
    await loaded();

    expect(kpiValue(aud("kpi.logged", {}, "en"))).toBe((12_345).toLocaleString("en-GB"));
    // Grupowanie tysięcy w OBU locale musi się realnie różnić - inaczej asercja
    // przechodziłaby także na zaszytym "pl-PL".
    expect((12_345).toLocaleString("en-GB")).not.toBe((12_345).toLocaleString("pl-PL"));
    // Lista top idzie tą samą drogą, bo `TopPosts` formatowało osobno.
    const rows = topRows(aud("topLogged", {}, "en"));
    expect(rows[0]).toContain((12_345).toLocaleString("en-GB"));
    expect(rows[0]).toContain((6_789).toLocaleString("en-GB"));
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - dostępność", () => {
  it("wypełniony panel nie ma ANI JEDNEGO naruszenia dostępności", async () => {
    // Asercja jest na PEŁNEJ liście naruszeń, nie na jej podzbiorze i bez ani
    // jednej ulgi: dopisanie dowolnego problemu (przycisk bez nazwy, obrazek bez
    // alt, plakietka bez nazwy, zła kolejność nagłówków, lista poza `ul`/`ol`)
    // oblewa ten test. Do 2026-09-02 stał tu wpis `button-name` - selektor okna
    // czasu renderował `<button role="combobox">` bez nazwy dostępnej; dziś
    // pełna lista jest pusta, więc test pilnuje BRAKU długu, a nie jego rozmiaru.
    h.fetchAudience.mockResolvedValue(
      result({
        logged: 700,
        anon: 300,
        uniqueLogged: 100,
        series: [day("2026-08-01", 400, 200), day("2026-08-02", 300, 100)],
        topLogged: [post("a", "Energia w regionie", 400, 90)],
        topAnon: [post("b", "Klimat i miasta", 300, 250)],
        truncated: true,
      }),
    );
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual([]);
  });

  it("nagłówki panelu są w poprawnej hierarchii, a listy mają semantykę listy", async () => {
    // Ten sam przebieg axe, ale na panelu BEZ danych: znika plakietka przy
    // wykresie, tabela danych i obie listy top, więc zestaw reguł, które mają co
    // sprawdzać, jest inny. Lista naruszeń również bez ulg.
    h.fetchAudience.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual([]);
  });

  it("selektor okna czasu ma nazwę dostępną ze słownika", async () => {
    // `SelectTrigger` renderuje `<button role="combobox">`, a etykiety wizualnej
    // ten pasek nie ma wcale - ani `<label>`, ani `placeholder` w `SelectValue`.
    // Do pierwszego otwarcia listy przycisk był więc PUSTY i czytnik ekranu
    // ogłaszał samo "combobox", bez ani jednego słowa o tym, czym on jest.
    h.fetchAudience.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
    // Nazwa idzie ZE SŁOWNIKA, a nie z zaszytego napisu - inaczej angielski
    // administrator usłyszałby polską etykietę.
    expect(screen.getByRole("combobox")).toHaveAccessibleName(common("windowSelector"));
    await i18n.changeLanguage("en");
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveAccessibleName(common("windowSelector", "en")),
    );
  });

  it("listy topowych wpisów są numerowane semantycznie, nie divami", async () => {
    panel();
    await loaded();

    // `ol` niesie kolejność dla czytnika ekranu; numer w `span` jest tylko
    // ozdobą, więc bez listy uporządkowanej ranking przestaje być rankingiem.
    expect(topCard(aud("topLogged")).querySelector("ol")).not.toBeNull();
    expect(topCard(aud("topAnon")).querySelector("ol")).not.toBeNull();
  });

  it("wykres dzienny ma nazwę regionu i tabelaryczny równoważnik", async () => {
    // Panel montował `EChart` wprost w `Card`, POMIJAJĄC `ChartCard`, więc kanwa
    // - dla czytnika ekranu pusty prostokąt - nie miała ani nazwy, ani
    // równoważnika tabelarycznego, a stojący obok nagłówek `h4` nie był z nią
    // powiązany żadnym atrybutem. Dziś wykres idzie przez `ChartCard` z `csv`:
    // region dostaje `role="img"` z nazwą z tytułu, a `aria-describedby`
    // prowadzi do tabeli z TYMI SAMYMI liczbami.
    panel();
    await loaded();

    expect(screen.queryAllByRole("img").length).toBeGreaterThan(0);
    const region = screen.getByRole("img", {
      name: realT("pl")("adminAnalytics.chartCard.chartRegion", { title: aud("dailyViews") }),
    });
    const tableId = region.getAttribute("aria-describedby");
    expect(tableId).toBeTruthy();
    expect(document.getElementById(tableId ?? "")).not.toBeNull();
    // Równoważnik niesie DANE, nie samą obietnicę: nagłówki kolumn i liczby
    // NEUTRAL-a z obu segmentów.
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(aud("logged"));
    expect(table).toHaveTextContent(aud("anon"));
    expect(table).toHaveTextContent("2026-08-01");
    expect(table).toHaveTextContent("300");
  });
});
