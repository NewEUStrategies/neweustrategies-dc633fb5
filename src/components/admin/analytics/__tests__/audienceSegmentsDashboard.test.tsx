// `AudienceSegmentsDashboard` - pulpit "zalogowani vs anonimowi": progi
// interpretacji, trzy stany, okno czasu i izolacja warsztatow.
//
// PO CO. Plik stal na zerze. Agregacja tego pulpitu siedzi w server function
// (`audience.functions.ts`) i testuja ja inni - TUTAJ przedmiotem dowodu jest
// to, czego tamten plik nie widzi, a co decyduje o tym, czy administrator
// czyta POMIAR, czy atrape pomiaru:
//
//   1. TRZY STANY, JEDEN EKRAN. "Jeszcze nie wiem", "zapytanie padlo" i "w
//      oknie naprawde nie bylo odslon" konczy sie tu tym samym obrazem:
//      cztery kafelki z zerem. Gorzej - przy braku `q.data` lista wnioskow
//      jest pusta, a `InsightSection` maluje wtedy zielone "nie znaleziono
//      krytycznych zagadnien". Awaria odczytu `post_views` melduje sie wiec
//      jako dobra wiadomosc. Dwa `it.fails` nizej przypinaja dokladnie to.
//   2. PROGI INTERPRETACJI. 5%, 60% i "4 wpisy na zalogowanego" to granice
//      miedzy trzema roznymi ZALECENIAMI dla redakcji (CTA rejestracji vs
//      personalizacja vs nic). Przesuniecie granicy albo zamiana galezi
//      `if`/`else if` nie wywraca panelu - podmienia polecenie przy
//      niezmienionym wygladzie karty. Asercje ida na napisy ze slownika.
//   3. SEGMENT MUSI TRAFIC DO SWOJEJ SERII. Wykres to dwa slupki w stosie
//      `views`. Zamiana `logged` z `anon` (albo podpiecie tej samej tablicy
//      dwa razy) daje wykres, ktory sie rysuje i klamie. Dlatego sprawdzamy
//      PARE nazwa-dane w opcji oddanej kanwie, nie sam fakt renderu.
//   4. OKNO CZASU. Zmiana presetu ma przestawic WEJSCIE funkcji serwerowej
//      (`{ days }`), nie tylko etykiete w selekcie.
//   5. IZOLACJA WARSZTATOW. `queryKey: ["admin","audience-segments", days]`
//      nie niesie ani tenanta, ani uzytkownika, ani znacznika czasu - dwa
//      montowania z tym samym oknem trafiaja w JEDEN wpis cache. Przy
//      `staleTime: 60_000` drugi warsztat widzi tytuly pierwszego i nie leci
//      przy tym ani jedno zadanie. Przypiete `it.fails`.
//   6. SLOWNIK I FORMAT LICZB. Napisy sa asertowane przez `realT("pl")` /
//      `realT("en")`, czyli te sama instancje i18next, ktora widzi uzytkownik.
//      Osobno: liczby sa tu formatowane zaszytym `"pl-PL"`, wiec angielski
//      administrator dostaje polskie grupowanie tysiecy - przypiete.
//
// ECHARTS JEST TU ZAKAZANY (patrz naglowek `EChart.tsx`): podmieniamy `EChart`
// atrapa, ktora PRZECHWYTUJE `option`. Dzieki temu serie i legenda sa badane na
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
  charts: [] as Array<{ option: Record<string, unknown>; height?: number | string }>,
}));

// `useServerFn` staje sie tozsamoscia - wywolanie idzie prosto do atrapy.
// Mock CZESCIOWY, bo `@/lib/i18n` ciagnie z tego samego pakietu
// `createIsomorphicFn`, a pelna atrapa wywracalaby inicjalizacje slownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/audience.functions", () => ({
  getAudienceSegments: (...args: unknown[]) => h.fetchAudience(...args),
}));

// Atrapa odwzorowuje to, co daje PRAWDZIWY `EChart`: element bez zadnej nazwy
// dostepnej (na serwerze `aria-hidden` szkielet, na kliencie kanwa). Dzieki
// temu asercja o braku tekstowej alternatywy mierzy panel, nie atrape.
vi.mock("../EChart", () => ({
  EChart: ({ option, height }: { option: Record<string, unknown>; height?: number | string }) => {
    h.charts.push({ option, height });
    return <div data-testid="echart" />;
  },
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujezyczny, a przedmiotem
// dowodu jest to, ze napisy przychodza ZE SLOWNIKA.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { AudienceSegmentsDashboard } from "../AudienceSegmentsDashboard";

// ---------------------------------------------------------------------------
// Slownik
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
 * Raport z JEDNYM zrodlem prawdy o proporcjach: KPI liczy sie z podanych
 * odslon, wiec test nie moze przypadkiem asertowac udzialu, ktorego w danych
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

/** Okno bez ani jednej odslony - dokladnie to, co zwraca `EMPTY` w server fn. */
const EMPTY = result({});

/** Zdrowe okno: udzial zalogowanych 50%, wiec ZADEN prog nie jest przekroczony. */
const NEUTRAL = result({
  logged: 500,
  anon: 500,
  uniqueLogged: 200,
  uniqueAnon: 400,
  series: [day("2026-08-01", 300, 200), day("2026-08-02", 200, 300)],
  topLogged: [post("p-log", "Energia w regionie", 120, 40)],
  topAnon: [post("p-anon", "Klimat i miasta", 300, 250)],
});

/** Raport "warsztatu A" - kazdy napis niesie rozpoznawalny prefiks. */
const WORKSPACE_A = result({
  logged: 100,
  anon: 100,
  series: [day("2026-08-01", 100, 100)],
  topLogged: [post("a-1", "ALFA analiza energetyczna", 100, 10)],
  topAnon: [post("a-2", "ALFA raport klimatyczny", 100, 90)],
});

/** Raport "warsztatu B" - rozlaczny z A na kazdym napisie. */
const WORKSPACE_B = result({
  logged: 7,
  anon: 7,
  series: [day("2026-08-01", 7, 7)],
  topLogged: [post("b-1", "BETA notatka transportowa", 7, 3)],
  topAnon: [post("b-2", "BETA przeglad rynku", 7, 6)],
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
function numList(v: unknown): number[] {
  return Array.isArray(v) ? (v as unknown[]).map(Number) : [];
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map(String) : [];
}

/** Ostatnia opcja oddana kanwie - panel ma dokladnie jeden wykres. */
function chartOption(): Opt {
  const last = h.charts[h.charts.length - 1];
  if (!last) throw new Error("test: panel nie oddal kanwie zadnej opcji");
  return last.option as Opt;
}

/** Kafelek KPI stojacy przy podanej etykiecie. */
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

/** Karta listy "Top ..." - naglowek jest jej wnukiem, wiec dwa poziomy w gore. */
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

/** Wejscia, ktore panel podal funkcji serwerowej, w kolejnosci wywolan. */
function queriedDays(): number[] {
  return h.fetchAudience.mock.calls.map((c) => (c[0] as { data: { days: number } }).data.days);
}

/** Radix Select otwiera liste klawiszem - w happy-dom to najpewniejsza droga. */
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

/** Czeka, az raport dojedzie: znika wskaznik `isFetching`. */
/**
 * Czeka, az raport DOJEDZIE do panelu.
 *
 * SWIADOMIE NIE OPIERA SIE na zniknieciu wskaznika postepu. Wskaznik pokazuje
 * `isFetching`, a przy obciazonej maszynie pierwszy render moze wypasc PRZED
 * startem zapytania: wskaznika nie ma jeszcze wcale, wiec asercja "nie ma
 * wskaznika" przechodzi na PUSTYM panelu i test mierzy stan przejsciowy.
 * Dokladnie tak oblewaly sie cztery przypadki przy `load average` 34. Dlatego
 * czekamy na rozstrzygniecie obietnic, ktore atrapa naprawde oddala, wewnatrz
 * `act` - i tylko dla porzadku domykamy spokojnym paskiem narzedzi.
 */
async function loaded(): Promise<void> {
  await waitFor(() => expect(h.fetchAudience).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(h.fetchAudience.mock.results.map((r) => r.value));
  });
  await waitFor(() => expect(document.querySelector(".animate-spin")).toBeNull());
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.charts.length = 0;
  h.fetchAudience.mockReset();
  h.fetchAudience.mockResolvedValue(NEUTRAL);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - trzy stany panelu", () => {
  it("w trakcie pobierania miga wskaznik postepu obok selektora okna", async () => {
    h.fetchAudience.mockImplementation(() => new Promise<AudienceSegmentsResult>(() => {}));
    const { container } = panel();

    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeNull());
    // Naglowek i selektor zyja od pierwszej klatki - operator moze zmienic okno,
    // nie czekajac na odpowiedz.
    expect(screen.getByRole("heading", { name: aud("title") })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeEnabled();
  });

  it.fails(
    "DEFEKT: w trakcie pobierania cztery kafelki melduja ZERO odslon jako pomiar",
    async () => {
      // `q.data?.kpi.views_total ?? 0` nie odroznia "nie wiem" od "nie bylo".
      // Zero na pulpicie audytorium czyta sie jako twierdzenie o ruchu, ktorego
      // pomiar sie jeszcze nie odbyl - i jest to twierdzenie falszywe.
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
    },
  );

  it.fails("DEFEKT: w trakcie pobierania panel oglasza brak krytycznych zagadnien", async () => {
    // `if (!q.data) return out` daje puste `insights`, a `InsightSection` z
    // pusta lista maluje zielona karte "nie znaleziono krytycznych
    // zagadnien - utrzymaj obecna strategie". To zaliczenie audytu przed
    // audytem.
    h.fetchAudience.mockImplementation(() => new Promise<AudienceSegmentsResult>(() => {}));
    const { container } = panel();
    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeNull());

    expect(screen.queryByText(insightChrome("emptyDefault"))).toBeNull();
  });

  it("okno bez odslon pokazuje wniosek ze slownika, a nie puste karty", async () => {
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    const title = aud("insights.empty.title");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightCard(title)).toHaveTextContent(aud("insights.empty.detail"));
    expect(insightFixes(title)).toEqual(audList("insights.empty.fixes"));
    // Element, do ktorego wniosek jest przypiety - inaczej operator nie wie,
    // czego dotyczy zalecenie.
    expect(insightCard(title)).toHaveTextContent(aud("insights.empty.element"));
  });

  it("okno bez odslon daje dwie listy top z komunikatem o braku danych", async () => {
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(screen.getAllByText(common("noDataWindow"))).toHaveLength(2);
    expect(topCard(aud("topLogged")).querySelector("ol")).toBeNull();
    expect(topCard(aud("topAnon")).querySelector("ol")).toBeNull();
  });

  it("po awarii odczytu pasek narzedzi zyje - operator moze zmienic okno", async () => {
    h.fetchAudience.mockRejectedValue(new Error("post_views read failed: 500"));
    panel();
    await loaded();

    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.getByRole("heading", { name: aud("title") })).toBeInTheDocument();
  });

  it.fails("DEFEKT: awaria odczytu wyglada DOKLADNIE jak okno bez ruchu", async () => {
    // `q.isError` i `q.error` nie sa w tym pliku czytane ani raz. Panel maluje
    // cztery zera i zielone "brak krytycznych zagadnien", czyli kaze szukac
    // problemu w ruchu tam, gdzie padl odczyt tabeli `post_views`.
    h.fetchAudience.mockRejectedValue(new Error("post_views read failed: 500"));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toMatch(/500|b[lł][aą]d|error/i);
  });

  it.fails("DEFEKT: awaria odczytu koncza sie zielonym zaliczeniem audytu", async () => {
    h.fetchAudience.mockRejectedValue(new Error("post_views read failed: 500"));
    panel();
    await loaded();

    expect(screen.queryByText(insightChrome("emptyDefault"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - kafelki KPI", () => {
  it("kazdy kafelek bierze WLASNE pole raportu, bez przeliczania na miejscu", async () => {
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

  it("podpowiedz o unikalnych nie jest zamieniona miedzy segmentami", async () => {
    // Oba kafelki uzywaja TEGO SAMEGO klucza `uniqueHint` - jedyna roznica jest
    // w przekazanym `count`. Zamiana argumentow jest niewidoczna na oko.
    h.fetchAudience.mockResolvedValue(
      result({ logged: 10, anon: 10, uniqueLogged: 3, uniqueAnon: 9 }),
    );
    panel();
    await loaded();

    expect(kpiHint(aud("kpi.logged"))).toBe(aud("uniqueHint", { count: 3 }));
    expect(kpiHint(aud("kpi.anon"))).toBe(aud("uniqueHint", { count: 9 }));
  });

  it("kafelki laczne nie maja podpowiedzi - nie ma tam czego doliczac", async () => {
    panel();
    await loaded();

    expect(kpiCard(aud("kpi.viewsTotal")).children).toHaveLength(2);
    expect(kpiCard(aud("kpi.uniqueReaders")).children).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - progi interpretacji", () => {
  it("udzial zalogowanych ponizej 5% daje ostrzezenie z udzialem w procentach", async () => {
    // 40 / 1000 = 4,0%
    h.fetchAudience.mockResolvedValue(result({ logged: 40, anon: 960, uniqueLogged: 20 }));
    panel();
    await loaded();

    const title = aud("insights.lowLogged.title", { pct: "4.0" });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.lowLogged.fixes"));
    // Galezie sa rozlaczne - ostrzezenie NIE moze przyjsc razem z pochwala.
    // Rozroznikiem jest `detail`, bo obie galezie maja IDENTYCZNY `element`
    // ("Segment zalogowanych") - asercja na plakietce nie odroznilaby ich.
    expect(screen.queryByText(aud("insights.highLogged.detail"))).toBeNull();
  });

  it("dokladnie 5% NIE jest jeszcze ostrzezeniem - prog jest ostry", async () => {
    // 50 / 1000 = 0,05, a warunek to `loggedShare < 0.05`.
    h.fetchAudience.mockResolvedValue(result({ logged: 50, anon: 950, uniqueLogged: 40 }));
    panel();
    await loaded();

    expect(screen.queryByText(aud("insights.lowLogged.detail"))).toBeNull();
    expect(screen.queryByText(aud("insights.highLogged.detail"))).toBeNull();
    expect(screen.getByText(insightChrome("emptyDefault"))).toBeInTheDocument();
  });

  it("udzial powyzej 60% daje pochwale, a nie ostrzezenie", async () => {
    // 700 / 1000 = 70,0%
    h.fetchAudience.mockResolvedValue(result({ logged: 700, anon: 300, uniqueLogged: 600 }));
    panel();
    await loaded();

    const title = aud("insights.highLogged.title", { pct: "70.0" });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightCard(title)).toHaveTextContent(aud("insights.highLogged.detail"));
    expect(screen.queryByText(aud("insights.lowLogged.detail"))).toBeNull();
  });

  it("dokladnie 60% nie przekracza progu pochwaly", async () => {
    // 600 / 1000 = 0,6, a warunek to `loggedShare > 0.6`.
    h.fetchAudience.mockResolvedValue(result({ logged: 600, anon: 400, uniqueLogged: 500 }));
    panel();
    await loaded();

    expect(screen.queryByText(aud("insights.highLogged.detail"))).toBeNull();
    expect(screen.queryByText(aud("insights.lowLogged.detail"))).toBeNull();
  });

  it("powyzej czterech wpisow na zalogowanego dochodzi wniosek o retencji", async () => {
    // 500 / 100 = 5,0 wpisow na zalogowanego; udzial 50% nie odpala pozostalych
    // galezi, wiec ten wniosek stoi na liscie sam.
    h.fetchAudience.mockResolvedValue(
      result({ logged: 500, anon: 500, uniqueLogged: 100, uniqueAnon: 300 }),
    );
    panel();
    await loaded();

    const title = aud("insights.loyalLogged.title", { count: "5.0" });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.loyalLogged.fixes"));
  });

  it("dokladnie cztery wpisy na zalogowanego to jeszcze nie retencja", async () => {
    h.fetchAudience.mockResolvedValue(
      result({ logged: 400, anon: 400, uniqueLogged: 100, uniqueAnon: 300 }),
    );
    panel();
    await loaded();

    expect(screen.queryByText(aud("insights.loyalLogged.element"))).toBeNull();
  });

  it("zero unikalnych zalogowanych nie produkuje dzielenia przez zero", async () => {
    // `kpi.unique_logged > 0` jest jedyna oslona przed `Infinity` w tytule.
    h.fetchAudience.mockResolvedValue(
      result({ logged: 90, anon: 10, uniqueLogged: 0, uniqueAnon: 5 }),
    );
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toMatch(/Infinity|NaN/);
    expect(screen.queryByText(aud("insights.loyalLogged.element"))).toBeNull();
  });

  it("przycieta proba daje i plakietke przy wykresie, i osobny wniosek", async () => {
    h.fetchAudience.mockResolvedValue(result({ logged: 500, anon: 500, truncated: true }));
    panel();
    await loaded();

    expect(screen.getByText(aud("sampleTruncated"))).toBeInTheDocument();
    const title = aud("insights.trunc.title");
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.trunc.fixes"));
  });

  it("bez przyciecia plakietka przy wykresie NIE powstaje", async () => {
    panel();
    await loaded();

    expect(screen.queryByText(aud("sampleTruncated"))).toBeNull();
    expect(screen.queryByText(aud("insights.trunc.title"))).toBeNull();
  });

  it("pusty raport zatrzymuje sie na jednym wniosku - reszta galezi nie wchodzi", async () => {
    // `total === 0` konczy funkcje `return out`, wiec przy zerze nie moze
    // pojawic sie ani ostrzezenie o udziale, ani wniosek o retencji.
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
  it("kazdy segment trafia do swojej serii, z nazwa ze slownika", async () => {
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
    // Rozne tablice, nie ta sama podpieta dwa razy.
    expect(numList(s[0].data)).not.toEqual(numList(s[1].data));
  });

  it("slupki stoja w JEDNYM stosie - inaczej wykres nie pokazuje sumy odslon", async () => {
    panel();
    await loaded();

    const s = seriesOf(chartOption());
    expect(s.map((x) => x.stack)).toEqual(["views", "views"]);
    expect(s.map((x) => x.type)).toEqual(["bar", "bar"]);
  });

  it("os X niesie dni raportu w kolejnosci, ktora dal serwer", async () => {
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

  it("brak danych daje wykres z pustymi seriami, a nie wyjatek", async () => {
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    const s = seriesOf(chartOption());
    expect(numList(s[0].data)).toEqual([]);
    expect(strList(rec(chartOption().xAxis).data)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - listy topowych wpisow", () => {
  it("wpis niesie tytul, sciezke i obie liczby - odslony oraz unikalnych", async () => {
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

  it("wpis bez sluga nie renderuje samotnego ukosnika", async () => {
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

  it("dwie listy sa rozlaczne - wpisy anonimowych nie wyciekaja do zalogowanych", async () => {
    panel();
    await loaded();

    expect(topRows(aud("topLogged")).join("|")).toContain("Energia w regionie");
    expect(topRows(aud("topLogged")).join("|")).not.toContain("Klimat i miasta");
    expect(topRows(aud("topAnon")).join("|")).toContain("Klimat i miasta");
    expect(topRows(aud("topAnon")).join("|")).not.toContain("Energia w regionie");
  });

  it("numeracja pozycji jest ciagla od jednego", async () => {
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
  it("startowe okno to 30 dni i taka liczba trafia do WEJSCIA funkcji", async () => {
    panel();
    await loaded();

    expect(queriedDays()).toEqual([30]);
  });

  it("wybor krotszego okna przestawia WEJSCIE zapytania, nie tylko etykiete", async () => {
    panel();
    await loaded();

    await pickRange(preset(7));
    await waitFor(() => expect(queriedDays()).toEqual([30, 7]));
  });

  it("wybor najdluzszego okna daje dziewiecdziesiat dni", async () => {
    panel();
    await loaded();

    await pickRange(preset(90));
    await waitFor(() => expect(queriedDays()).toEqual([30, 90]));
  });

  it("selektor oferuje dokladnie trzy okna, kazde z etykieta ze slownika", async () => {
    panel();
    await loaded();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    const labels = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(labels).toEqual([preset(7), preset(30), preset(90)]);
  });

  it("zmiana okna nie gubi danych poprzedniego - kazde okno ma wlasny wpis cache", async () => {
    h.fetchAudience.mockResolvedValueOnce(result({ logged: 1000, anon: 1000 }));
    h.fetchAudience.mockResolvedValueOnce(result({ logged: 10, anon: 10 }));
    panel();
    await loaded();
    expect(kpiValue(aud("kpi.viewsTotal"))).toBe((2000).toLocaleString("pl-PL"));

    await pickRange(preset(7));
    await waitFor(() => expect(kpiValue(aud("kpi.viewsTotal"))).toBe("20"));

    await pickRange(preset(30));
    // Powrot do okna 30 dni czyta cache, a nie serwer.
    await waitFor(() =>
      expect(kpiValue(aud("kpi.viewsTotal"))).toBe((2000).toLocaleString("pl-PL")),
    );
    expect(queriedDays()).toEqual([30, 7]);
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - izolacja warsztatow", () => {
  it("panel warsztatu B pokazuje WYLACZNIE wpisy warsztatu B", async () => {
    h.fetchAudience.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("BETA notatka transportowa");
    expect(container.textContent ?? "").not.toContain("ALFA");
    // Dni jada takze do kanwy - wyciek moze siedziec w samych danych wykresu.
    expect(JSON.stringify(h.charts)).not.toContain("ALFA");
  });

  it("swiezy klient react-query nie przenosi raportu miedzy warsztatami", async () => {
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

  it.fails(
    "DEFEKT: klucz cache nie niesie warsztatu - drugi panel z tym samym oknem widzi cudze wpisy",
    async () => {
      // `queryKey: ["admin", "audience-segments", days]` sklada sie z dwoch
      // stalych i liczby dni. Nie ma w nim ani tenanta, ani uzytkownika, ani -
      // inaczej niz w `VitalsBiDashboard` - znacznika czasu okna. Dwa
      // montowania z domyslnym oknem 30 dni trafiaja wiec ZAWSZE w ten sam wpis
      // cache, a `staleTime: 60_000` sprawia, ze react-query nie ponawia
      // zapytania. Administrator warsztatu B czyta tytuly warsztatu A i nie
      // leci przy tym ani jedno zadanie sieciowe - wyciek jest cichy.
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      h.fetchAudience.mockResolvedValue(WORKSPACE_A);
      const first = panel(client);
      await loaded();
      first.unmount();
      h.charts.length = 0;

      h.fetchAudience.mockResolvedValue(WORKSPACE_B);
      const second = panel(client);
      await loaded();

      expect(second.container.textContent ?? "").not.toContain("ALFA");
    },
  );
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - slownik PL/EN", () => {
  it("po przelaczeniu na angielski naglowek i etykiety KPI przychodza z galezi EN", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded();

    expect(screen.getByRole("heading", { name: aud("title", {}, "en") })).toBeInTheDocument();
    expect(screen.getByText(aud("kpi.viewsTotal", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(aud("kpi.uniqueReaders", {}, "en"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: aud("dailyViews", {}, "en") })).toBeInTheDocument();
  });

  it("angielskie wnioski nie spadaja na polski fallback", async () => {
    await i18n.changeLanguage("en");
    h.fetchAudience.mockResolvedValue(result({ logged: 40, anon: 960, uniqueLogged: 20 }));
    panel();
    await loaded();

    const title = aud("insights.lowLogged.title", { pct: "4.0" }, "en");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(insightFixes(title)).toEqual(audList("insights.lowLogged.fixes", "en"));
    // Ten sam klucz po polsku brzmi inaczej - gdyby EN spadl na fallback,
    // asercja wyzej przeszlaby, a ta by oblala.
    expect(title).not.toBe(aud("insights.lowLogged.title", { pct: "4.0" }));
  });

  it("nazwy serii wykresu tez sa tlumaczone, nie wpisane po polsku", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded();

    expect(seriesOf(chartOption()).map((s) => String(s.name))).toEqual([
      aud("logged", {}, "en"),
      aud("anon", {}, "en"),
    ]);
  });

  it("okno bez odslon po angielsku uzywa angielskiego komunikatu list top", async () => {
    await i18n.changeLanguage("en");
    h.fetchAudience.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(screen.getAllByText(common("noDataWindow", "en"))).toHaveLength(2);
  });

  it.fails("DEFEKT: liczby sa formatowane zaszytym pl-PL takze po angielsku", async () => {
    // `value.toLocaleString("pl-PL")` w `KpiCard` i w `TopPosts` ignoruje jezyk
    // interfejsu. `ClientErrorsDashboard` w tym samym katalogu robi to poprawnie
    // (`i18n.language === "en" ? "en-GB" : "pl-PL"`), wiec to nie jest decyzja
    // produktowa, tylko rozjazd. Angielski administrator widzi "12 345" tam,
    // gdzie jego locale pisze "12,345".
    await i18n.changeLanguage("en");
    h.fetchAudience.mockResolvedValue(result({ logged: 12_345, anon: 1 }));
    panel();
    await loaded();

    expect(kpiValue(aud("kpi.logged", {}, "en"))).toBe((12_345).toLocaleString("en-GB"));
  });
});

// ---------------------------------------------------------------------------

describe("AudienceSegmentsDashboard - dostepnosc", () => {
  it("caly dlug dostepnosci wypelnionego panelu to JEDEN bezimienny przycisk", async () => {
    // Asercja jest na PELNEJ liscie naruszen, nie na jej podzbiorze: dopisanie
    // dowolnego drugiego problemu (obrazek bez alt, plakietka bez nazwy, zla
    // kolejnosc naglowkow, lista poza `ul`/`ol`) oblewa ten test. Jedyny wpis,
    // ktory tu stoi, jest przypiety osobno nizej.
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
    ).toEqual(["button-name"]);
    expect(violations[0].nodes).toHaveLength(1);
  });

  it("naglowki panelu sa w poprawnej hierarchii, a listy maja semantyke listy", async () => {
    // Ten sam przebieg axe, ale na panelu BEZ danych: znika wykres z plakietka i
    // obie listy top, wiec zestaw regul, ktore maja co sprawdzac, jest inny.
    h.fetchAudience.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
  });

  it.fails("DEFEKT: selektor okna czasu nie ma zadnej nazwy dostepnej", async () => {
    // `SelectTrigger` renderuje `<button role="combobox">` bez `aria-label` i
    // bez `<label>`. `SelectValue` nie ma nawet `placeholder`, wiec do
    // pierwszego otwarcia listy przycisk jest PUSTY - czytnik ekranu oglasza
    // "combobox" bez ani jednego slowa o tym, czym on jest. Slownik ma juz
    // klucz `adminAnalytics.gsc.window` ("Okno" / "Window") na taka etykiete.
    h.fetchAudience.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("listy topowych wpisow sa numerowane semantycznie, nie divami", async () => {
    panel();
    await loaded();

    // `ol` niesie kolejnosc dla czytnika ekranu; numer w `span` jest tylko
    // ozdoba, wiec bez listy uporzadkowanej ranking przestaje byc rankingiem.
    expect(topCard(aud("topLogged")).querySelector("ol")).not.toBeNull();
    expect(topCard(aud("topAnon")).querySelector("ol")).not.toBeNull();
  });

  it.fails("DEFEKT: wykres dzienny nie ma zadnej tekstowej alternatywy", async () => {
    // Karty przechodzace przez `ChartCard` dostaja `role="img"` z nazwa z
    // tytulu i `aria-describedby` do tabeli danych. Ten panel montuje `EChart`
    // wprost w `Card`, wiec kanwa - dla czytnika ekranu pusty prostokat - nie
    // ma ani nazwy, ani rownowaznika tabelarycznego. Naglowek `h4` obok nie
    // jest z nia powiazany zadnym atrybutem.
    panel();
    await loaded();

    expect(screen.queryAllByRole("img").length).toBeGreaterThan(0);
  });
});
