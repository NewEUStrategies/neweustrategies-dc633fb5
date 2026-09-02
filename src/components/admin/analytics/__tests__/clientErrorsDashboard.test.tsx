// `ClientErrorsDashboard` - pulpit telemetrii błędów przeglądarki: zgodność z
// agregatorem, redakcja PII na ekranie, trzy stany i izolacja warsztatów.
//
// PO CO. Plik stał na zerze. Sama matematyka grupowania (`clientErrorsAggregate`)
// ma własne testy - TUTAJ przedmiotem dowodu jest to, czego tamten plik nie
// widzi, a co decyduje o tym, czy administrator czyta telemetrię, czy jej
// atrapę:
//
//   1. PANEL MUSI POKAZAĆ TO, CO POLICZYŁ AGREGATOR. Fixtury są tu budowane
//      PRAWDZIWYM `aggregateClientErrors`, nie ręcznie: gdyby panel liczył
//      cokolwiek u siebie (przeliczał udziały, sortował inaczej, gubił grupę
//      poza `maxGroups`), asercje rozjechałyby się z tym, co widzi baza. Dwa
//      pola są tu szczególnie łatwe do pomylenia: `total` to liczba PRÓBEK po
//      cap-ie, a `windowTotal` to prawdziwa liczba wierszy w oknie. Kafelek
//      "Błędy w oknie" musi brać drugie, a udział grupy - pierwsze.
//   2. PII NIE MOŻE WRÓCIĆ NA EKRAN. `redact.ts` czyści komunikaty i stacki na
//      ingestcie, więc panel dostaje tekst z markerami `[redacted-*]`. Panel
//      ma go pokazać DOKŁADNIE takim, jaki dostał, i ani nie składać go z
//      powrotem, ani nie interpretować jako znaczników HTML - stack to tekst
//      przysłany przez obcą przeglądarkę. Osobno: stack jest treści schowana,
//      więc w stanie zwiniętym nie ma go w DOM w ogóle.
//   3. TRZY STANY, JEDEN KOMUNIKAT. "Jeszcze nie wiem", "odczyt padł" i "w
//      oknie naprawdę nie było błędów" kończy się tym samym zielonym
//      "Brak błędów w wybranym oknie. To dobrze". Bramka roli w server function
//      RZUCA (`Forbidden: admin role required`), więc ten komunikat obsługuje
//      także odmowę dostępu. Przypięte `it.fails`.
//   4. IZOLACJA WARSZTATÓW. `queryKey` niesie wyłącznie granice okna - nie ma
//      w nim ani tenanta, ani użytkownika.
//   5. SŁOWNIK PL/EN. Napisy są asertowane przez `realT("pl")` / `realT("en")`.
//      Formatowanie liczb i dat jest tu zależne od języka (`en-GB` / `pl-PL`) -
//      i to jest sprawdzane, a nie deklarowane.
//
// ECHARTS JEST TU ZAKAZANY (patrz nagłówek `EChart.tsx`): podmieniamy `EChart`
// atrapą, która PRZECHWYTUJE `option`. Trend i iskra KPI są więc badane na
// strukturze danych oddanej wykresowi - i ~1 MB biblioteki nigdy nie wchodzi do
// procesu testowego. Atrapa łapie zarówno import `../EChart` z `ChartCard`, jak
// i z `KpiTile`, bo oba wskazują ten sam moduł.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  aggregateClientErrors,
  normalizeErrorMessage,
  type ClientErrorSample,
  type ClientErrorsReport,
} from "@/lib/observability/clientErrorsAggregate";
import { redactPii } from "@/lib/observability/redact";
import type { AppLang } from "@/lib/i18n/localePath";

type Opt = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fetchReport: vi.fn(),
  charts: [] as Array<{ option: Record<string, unknown> }>,
}));

// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy.
// Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywracałaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/observability/clientErrors.functions", () => ({
  getClientErrorsReport: (...args: unknown[]) => h.fetchReport(...args),
}));

vi.mock("../EChart", () => ({
  EChart: ({ option }: { option: Record<string, unknown> }) => {
    h.charts.push({ option });
    return <div data-testid="echart" />;
  },
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujęzyczny, a przedmiotem
// dowodu jest to, że napisy przychodzą ZE SŁOWNIKA.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { ClientErrorsDashboard } from "../ClientErrorsDashboard";

// ---------------------------------------------------------------------------
// Słownik
// ---------------------------------------------------------------------------

function ce(path: string, vars: Record<string, unknown> = {}, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.clientErrors.${path}`, vars);
}
function common(path: string, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.common.${path}`);
}
function chrome(path: string, vars: Record<string, unknown> = {}, lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.chartCard.${path}`, vars);
}
function presetLabel(id: "24h" | "7d" | "30d" | "90d", lang: AppLang = "pl"): string {
  return realT(lang)(`adminAnalytics.timeRange.preset${id}`);
}

// ---------------------------------------------------------------------------
// Dane - budowane PRAWDZIWYM agregatorem
// ---------------------------------------------------------------------------

/** Zamrożony punkt odniesienia: `last24h` i seria dzienna muszą być powtarzalne. */
const NOW_MS = Date.parse("2026-08-20T12:00:00.000Z");
const HOUR = 3_600_000;

function sample(message: string, over: Partial<ClientErrorSample> = {}): ClientErrorSample {
  return {
    message,
    stack: null,
    source: "onerror",
    path: "/analizy",
    created_at: new Date(NOW_MS - HOUR).toISOString(),
    ...over,
  };
}

function agg(
  samples: readonly ClientErrorSample[],
  over: Partial<{ windowDays: number; windowTotal: number; capped: boolean }> = {},
): ClientErrorsReport {
  return aggregateClientErrors(samples, {
    windowDays: 7,
    windowTotal: samples.length,
    capped: false,
    nowMs: NOW_MS,
    ...over,
  });
}

/**
 * Stack "z ingestu": surowa treść z obcej przeglądarki PRZEPUSZCZONA przez
 * `redactPii`, czyli dokładnie to, co trafia do kolumny `client_errors.stack`.
 * Surowe wartości są trzymane osobno, żeby test mógł dowieść ich BRAKU na
 * ekranie.
 */
const RAW_EMAIL = "jan.kowalski@example.com";
const RAW_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl";
const RAW_IP = "192.0.2.44";
const RAW_STACK = [
  "TypeError: Cannot read properties of null (reading 'id')",
  "    at submitForm (/assets/app.js:120:9)",
  `    reporter: ${RAW_EMAIL}`,
  `    header: Authorization: Bearer ${RAW_JWT}`,
  `    peer: ${RAW_IP}`,
].join("\n");
const SCRUBBED_STACK = redactPii(RAW_STACK) ?? "";

/** Warsztat A - każdy napis niesie rozpoznawalny prefiks. */
const WORKSPACE_A = agg([
  sample("ALFA: chunk 12 failed", { path: "/alfa/analizy", stack: "at alfaBoot (alfa.js:1:1)" }),
  sample("ALFA: chunk 44 failed", { path: "/alfa/analizy" }),
]);

/** Warsztat B - rozłączny z A na każdym napisie. */
const WORKSPACE_B = agg([
  sample("BETA: hydration mismatch", { path: "/beta/raporty", stack: "at betaBoot (beta.js:2:2)" }),
]);

const EMPTY = agg([]);

/**
 * Okno "roboze": trzy grupy o różnej liczności, dwa źródła, trzy ścieżki,
 * jeden stack. Wystarcza do sprawdzenia kolejności, udziałów i plakietek.
 */
const BUSY = agg([
  sample("Loading chunk 7 failed", {
    path: "/analizy/energia",
    stack: SCRUBBED_STACK,
    created_at: new Date(NOW_MS - HOUR).toISOString(),
  }),
  sample("Loading chunk 12 failed", {
    path: "/analizy/energia",
    created_at: new Date(NOW_MS - 2 * HOUR).toISOString(),
  }),
  sample("Loading chunk 99 failed", {
    path: "/o-nas",
    source: "unhandledrejection",
    created_at: new Date(NOW_MS - 3 * HOUR).toISOString(),
  }),
  sample("Hydration failed", {
    path: "/raporty",
    source: "react_error_boundary",
    created_at: new Date(NOW_MS - 30 * HOUR).toISOString(),
  }),
  sample("Hydration failed", {
    path: "/raporty",
    source: "react_error_boundary",
    created_at: new Date(NOW_MS - 31 * HOUR).toISOString(),
  }),
  sample("Script error.", {
    path: null,
    source: "onerror",
    created_at: new Date(NOW_MS - 50 * HOUR).toISOString(),
  }),
]);

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

/** Wykres trendu - jedyny słupkowy w panelu. */
function trendChart(): Opt {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    const o = h.charts[i].option as Opt;
    if (seriesOf(o)[0]?.type === "bar") return o;
  }
  throw new Error("test: nie przechwycono wykresu trendu");
}

/** Iskra kafelka KPI - jedyna linia z ukrytą osią. */
function sparkChart(): Opt {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    const o = h.charts[i].option as Opt;
    if (rec(o.xAxis).show === false && seriesOf(o)[0]?.type === "line") return o;
  }
  throw new Error("test: nie przechwycono iskry KPI");
}

/** Wartość kafelka KPI stojąca przy podanej etykiecie. */
function kpiValue(label: string): string {
  const box = screen.getByText(label).closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI "${label}"`);
  return box.children[1]?.textContent ?? "";
}

/** Karta "Problemy wg częstości". */
function groupsCard(lang: AppLang = "pl"): HTMLElement {
  const heading = screen.getByRole("heading", { name: ce("groupsTitle", {}, lang) });
  const card = heading.parentElement?.parentElement;
  if (!card) throw new Error("test: nie znaleziono karty grup bledow");
  return card as HTMLElement;
}

function groupRows(lang: AppLang = "pl"): HTMLElement[] {
  const list = groupsCard(lang).querySelector("ul");
  return list ? (Array.from(list.children) as HTMLElement[]) : [];
}

function rowToggle(row: HTMLElement): HTMLElement {
  const btn = row.querySelector("button");
  if (!btn) throw new Error("test: wiersz grupy nie ma przycisku rozwijania");
  return btn as HTMLElement;
}

/** Komunikat grupy - pierwszy `span` przycisku, ten z `font-mono`. */
function rowMessage(row: HTMLElement): string {
  return row.querySelector("span.font-mono")?.textContent ?? "";
}

/** Liczba wystąpień - drugi `span` przycisku, wyrównany do prawej. */
function rowCount(row: HTMLElement): string {
  return row.querySelector("span.justify-self-end")?.textContent ?? "";
}

/** Udział w procentach - jedyny `span` o szerokości `w-9`. */
function rowShare(row: HTMLElement): string {
  return row.querySelector("span.w-9")?.textContent ?? "";
}

function rowSources(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll("span.hidden > *")).map((b) => b.textContent ?? "");
}

function rowStack(row: HTMLElement): HTMLElement | null {
  return row.querySelector("pre");
}

function shortDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

interface RangeInput {
  sinceIso: string;
  untilIso: string;
}
function queryInputs(): RangeInput[] {
  return h.fetchReport.mock.calls.map((c) => (c[0] as { data: RangeInput }).data);
}
function spanDays(input: RangeInput): number {
  return Math.round((Date.parse(input.untilIso) - Date.parse(input.sinceIso)) / 86_400_000);
}

function panel(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ClientErrorsDashboard />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Czeka, aż raport dojedzie i karta grup przestanie meldować ładowanie. */
/**
 * Czeka, aż raport DOJEDZIE do panelu.
 *
 * ŚWIADOMIE NIE OPIERA SIĘ na zniknięciu wskaźnika postępu. Wskaźnik pokazuje
 * `isFetching`, a przy obciążonej maszynie pierwszy render może wypaść PRZED
 * startem zapytania: wskaźnika nie ma jeszcze wcale, więc asercja "nie ma
 * wskaźnika" przechodzi na PUSTYM panelu i test mierzy stan przejściowy.
 * Dokładnie tak oblewały się cztery przypadki przy `load average` 34. Dlatego
 * czekamy na rozstrzygnięcie obietnic, które atrapa naprawdę oddała, wewnątrz
 * `act` - i tylko dla porządku domykamy spokojnym paskiem narzędzi.
 */
async function loaded(lang: AppLang = "pl"): Promise<void> {
  await waitFor(() => expect(h.fetchReport).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(h.fetchReport.mock.results.map((r) => r.value));
  });
  await waitFor(() => expect(screen.queryByText(common("loadingData", lang))).toBeNull());
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.charts.length = 0;
  h.fetchReport.mockReset();
  h.fetchReport.mockResolvedValue(BUSY);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - wartownicy fixtur", () => {
  it("stack z fixtury JEST wyredagowany - inaczej test o PII nie mierzy niczego", () => {
    expect(SCRUBBED_STACK).not.toContain(RAW_EMAIL);
    expect(SCRUBBED_STACK).not.toContain(RAW_JWT);
    expect(SCRUBBED_STACK).not.toContain(RAW_IP);
    expect(SCRUBBED_STACK).toContain("[redacted-email]");
    expect(SCRUBBED_STACK).toContain("[redacted-jwt]");
    expect(SCRUBBED_STACK).toContain("[redacted-ip]");
  });

  it("agregator naprawdę składa warianty chunka w jedną grupę", () => {
    // Gdyby normalizacja przestała sklejać liczby, fixtura `BUSY` miałaby inną
    // liczbę grup i asercje o kolejności przestałyby cokolwiek znaczyć.
    expect(BUSY.groups).toHaveLength(3);
    expect(BUSY.groups[0].count).toBe(3);
    expect(BUSY.uniqueGroups).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - trzy stany panelu", () => {
  it("w trakcie pobierania karta grup melduje ładowanie i nie ma ani jednego stacka", async () => {
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    const { container } = panel();

    expect(await screen.findByText(common("loadingData"))).toBeInTheDocument();
    expect(groupRows()).toHaveLength(0);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("w trakcie pobierania przycisk odświeżania jest zablokowany", async () => {
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    panel();

    const btn = await screen.findByRole("button", { name: common("refresh") });
    expect(btn).toBeDisabled();
  });

  it.fails("DEFEKT: w trakcie pobierania cztery kafelki meldują ZERO błędów", async () => {
    // `(report?.windowTotal ?? 0).toLocaleString(locale)` nie odróżnia
    // "nie wiem" od "nie było". Zero na pulpicie błędów czyta się jako
    // twierdzenie o zdrowiu aplikacji, którego pomiar się nie odbył.
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    panel();
    await screen.findByText(common("loadingData"));

    const shown = [
      kpiValue(ce("kpiTotal")),
      kpiValue(ce("kpiGroups")),
      kpiValue(ce("kpiPaths")),
      kpiValue(ce("kpiLast24h")),
    ];
    expect(shown).not.toEqual(["0", "0", "0", "0"]);
  });

  it("okno bez błędów pokazuje komunikat ze słownika i zero wierszy", async () => {
    h.fetchReport.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(screen.getByText(ce("empty"))).toBeInTheDocument();
    expect(groupRows()).toHaveLength(0);
    expect(kpiValue(ce("kpiTotal"))).toBe("0");
  });

  it("po awarii odczytu pasek narzędzi żyje - operator może zmienić okno i ponowić", async () => {
    h.fetchReport.mockRejectedValue(new Error("Forbidden: admin role required"));
    panel();
    await loaded();

    expect(screen.getByRole("button", { name: common("refresh") })).toBeEnabled();
    expect(screen.getByRole("button", { name: presetLabel("30d") })).toBeInTheDocument();
  });

  it.fails("DEFEKT: odmowa dostępu melduje się jako dobra wiadomość", async () => {
    // `reportQuery.isError` i `.error` nie są w tym pliku czytane ani raz, a
    // server function RZUCA przy braku roli admina i przy padnięte
    // uwierzytelnieniu (degraduje do pustego raportu tylko brak tabeli). Panel
    // maluje wtedy "Brak błędów w wybranym oknie. To dobrze - beacony (...)
    // trafiają tu automatycznie" - czyli zapewnia, że telemetria działa, w
    // sytuacji, w której odczyt został odrzucony.
    h.fetchReport.mockRejectedValue(new Error("Forbidden: admin role required"));
    const { container } = panel();
    await loaded();

    expect(screen.queryByText(ce("empty"))).toBeNull();
    expect(container.textContent ?? "").toMatch(/Forbidden|b[lł][aą]d|error/i);
  });

  it("przycisk odświeżania ponawia odczyt tego samego okna", async () => {
    panel();
    await loaded();
    const before = queryInputs();

    fireEvent.click(screen.getByRole("button", { name: common("refresh") }));
    await waitFor(() => expect(h.fetchReport.mock.calls.length).toBe(2));

    const after = queryInputs();
    expect(after[1]).toEqual(before[0]);
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - zgodność z agregatorem", () => {
  it("liczba wierszy i ich kolejność odpowiadają grupom z agregatora", async () => {
    panel();
    await loaded();

    const rows = groupRows();
    expect(rows).toHaveLength(BUSY.groups.length);
    expect(rows.map(rowMessage)).toEqual(BUSY.groups.map((g) => g.message));
    // Agregator sortuje malejąco po liczności - panel nie ma prawa tego zmienić.
    expect(rows.map((r) => Number(rowCount(r)))).toEqual([3, 2, 1]);
  });

  it("wiersz pokazuje REPREZENTATYWNY komunikat, a nie odcisk z zasłonami", async () => {
    // Grupa "chunk" powstała z trzech różnych numerów. Odcisk brzmi
    // "Loading chunk <n> failed" i jest kluczem technicznym - operator ma
    // zobaczyć prawdziwy komunikat najświeższej próbki.
    panel();
    await loaded();

    const first = groupRows()[0];
    expect(rowMessage(first)).toBe("Loading chunk 7 failed");
    expect(rowMessage(first)).not.toBe(normalizeErrorMessage("Loading chunk 7 failed"));
    expect(groupsCard().textContent ?? "").not.toContain("<n>");
  });

  it("kafelki KPI biorą pola raportu, każde swoje", async () => {
    panel();
    await loaded();

    expect(kpiValue(ce("kpiTotal"))).toBe(String(BUSY.windowTotal));
    expect(kpiValue(ce("kpiGroups"))).toBe(String(BUSY.uniqueGroups));
    expect(kpiValue(ce("kpiPaths"))).toBe(String(BUSY.affectedPaths));
    expect(kpiValue(ce("kpiLast24h"))).toBe(String(BUSY.last24h));
    // Próbka bez ścieżki (`path: null`) nie może podnieść licznika ścieżek.
    expect(BUSY.affectedPaths).toBe(3);
    // Trzy próbki z ostatnich 24 h, przy sześciu w oknie.
    expect(BUSY.last24h).toBe(3);
  });

  it("kafelek liczby błędów bierze PRAWDZIWĄ liczbę wierszy, nie liczbę próbek", async () => {
    // To są dwa różne pola: `total` = próbki po cap-ie, `windowTotal` = COUNT.
    // Podmiana jednego na drugie zaniża pulpit o całą odciętą część okna i jest
    // niewidoczna, dopóki cap nie zadziała.
    const capped = agg([sample("Boom")], {
      windowTotal: 41_234,
      capped: true,
    });
    h.fetchReport.mockResolvedValue(capped);
    panel();
    await loaded();

    expect(kpiValue(ce("kpiTotal"))).toBe((41_234).toLocaleString("pl-PL"));
    expect(kpiValue(ce("kpiTotal"))).not.toBe(String(capped.total));
  });

  it("udział grupy liczy się względem PRÓBEK, a nie względem całego okna", async () => {
    // Grupy powstały z próbek, więc mianownikiem jest `total`. Użycie
    // `windowTotal` przy działającym cap-ie zgniotłoby wszystkie paski do 0%.
    const capped = agg([sample("Boom"), sample("Boom"), sample("Inny blad")], {
      windowTotal: 10_000,
      capped: true,
    });
    h.fetchReport.mockResolvedValue(capped);
    panel();
    await loaded();

    expect(rowShare(groupRows()[0])).toBe("67%");
    expect(rowShare(groupRows()[1])).toBe("33%");
  });

  it("plakietka o przycięciu podaje OBA liczniki, sformatowane wg języka", async () => {
    const capped = agg([sample("Boom")], { windowTotal: 41_234, capped: true });
    h.fetchReport.mockResolvedValue(capped);
    const { container } = panel();
    await loaded();

    // `toContain` na `textContent`, nie `getByText`: separator tysięcy w pl-PL
    // to twarda spacja (U+00A0), a normalizator testing-library zamienia ją na
    // zwykłą - porównanie przez `getByText` mierzyłoby wtedy normalizator, nie
    // panel.
    expect(container.textContent ?? "").toContain(
      ce("cappedNote", {
        cap: capped.total.toLocaleString("pl-PL"),
        total: (41_234).toLocaleString("pl-PL"),
      }),
    );
  });

  it("bez przycięcia plakietka o cap-ie NIE powstaje", async () => {
    panel();
    await loaded();

    expect(screen.queryByText(/41 234|41,234/)).toBeNull();
    expect(
      screen.queryByText(
        ce("cappedNote", { cap: String(BUSY.total), total: String(BUSY.windowTotal) }),
      ),
    ).toBeNull();
  });

  it("źródła grupy są tłumaczone, a nieznane źródło spada na wartość surową", async () => {
    h.fetchReport.mockResolvedValue(
      agg([
        sample("Z boundary", { source: "react_error_boundary" }),
        sample("Z boundary", { source: "unhandledrejection" }),
        sample("Z nowego zrodla", { source: "webworker_onerror" }),
      ]),
    );
    panel();
    await loaded();

    const rows = groupRows();
    expect(rowSources(rows[0])).toEqual([
      ce("sourceLabels.react_error_boundary"),
      ce("sourceLabels.unhandledrejection"),
    ]);
    // Bez `defaultValue` na ekranie stanęłaby surowa ścieżka klucza i18n.
    expect(rowSources(rows[1])).toEqual(["webworker_onerror"]);
  });

  it("trend dzienny oddaje kanwie DOKŁADNIE serię dzienną agregatora", async () => {
    panel();
    await loaded();

    const opt = trendChart();
    expect(numList(seriesOf(opt)[0].data)).toEqual(BUSY.daily.map((d) => d.count));
    // Etykieta osi jest skrócona do "MM-DD" - rok jest w oknie, nie w słupku.
    expect(strList(rec(opt.xAxis).data)).toEqual(BUSY.daily.map((d) => d.day.slice(5)));
    expect(BUSY.daily).toHaveLength(7);
    expect(seriesOf(opt)[0].name).toBe(ce("trendSeries"));
  });

  it("iskra kafelka KPI niesie tę samą serię dzienną co trend", async () => {
    panel();
    await loaded();

    expect(numList(seriesOf(sparkChart())[0].data)).toEqual(BUSY.daily.map((d) => d.count));
  });

  it("okno bez błędów daje trend z samymi zerami, a nie wykres bez danych", async () => {
    // Zero w dniu bez błędów to uczciwy pomiar; dziura w serii czytałaby się
    // jako "brak telemetrii".
    h.fetchReport.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(numList(seriesOf(trendChart())[0].data)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - redakcja PII na ekranie", () => {
  it("zwinięty wiersz NIE MA stacka w DOM - ani w treści, ani w atrybucie", async () => {
    panel();
    await loaded();

    const row = groupRows()[0];
    expect(rowStack(row)).toBeNull();
    expect(row.textContent ?? "").not.toContain("submitForm");
    // `title` zwiniętego wiersza to komunikat, nie stack - inaczej cała treść
    // wyjechałaby w podpowiedzi przeglądarki.
    expect(row.querySelector("span.font-mono")?.getAttribute("title")).toBe(
      "Loading chunk 7 failed",
    );
    expect(document.body.innerHTML).not.toContain("submitForm");
  });

  it("rozwinięty wiersz pokazuje stack DOKŁADNIE taki, jaki przyszedł z ingestu", async () => {
    panel();
    await loaded();

    const row = groupRows()[0];
    fireEvent.click(rowToggle(row));

    const pre = rowStack(row);
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(SCRUBBED_STACK);
  });

  it("rozwinięty stack niesie markery redakcji, a nie surowe dane osobowe", async () => {
    panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    const shown = rowStack(groupRows()[0])?.textContent ?? "";
    expect(shown).toContain("[redacted-email]");
    expect(shown).toContain("[redacted-jwt]");
    expect(shown).toContain("[redacted-ip]");
    // I to jest właściwa asercja: panel nie składa niczego z powrotem.
    expect(shown).not.toContain(RAW_EMAIL);
    expect(shown).not.toContain(RAW_JWT);
    expect(shown).not.toContain(RAW_IP);
    expect(document.body.innerHTML).not.toContain(RAW_EMAIL);
  });

  it("stack z zawartością HTML jest TEKSTEM, nie znacznikami", async () => {
    // Stack przychodzi z obcej przeglądarki i przechodzi przez `redactPii`,
    // które nie jest sanitizerem HTML. Jedyne, co go tu unieszkodliwia, to
    // renderowanie jako dziecko tekstowe - `dangerouslySetInnerHTML` w tym
    // miejscu byłoby XSS-em w panelu admina.
    const hostile = '<img src=x onerror="alert(1)"> at boot (app.js:1:1)';
    h.fetchReport.mockResolvedValue(agg([sample("Wrogi stack", { stack: hostile })]));
    panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    const pre = rowStack(groupRows()[0]);
    expect(pre?.querySelector("img")).toBeNull();
    expect(pre?.textContent).toBe(hostile);
  });

  it("zwinięcie wiersza usuwa stack z DOM, nie tylko go ukrywa", async () => {
    panel();
    await loaded();
    const row = groupRows()[0];

    fireEvent.click(rowToggle(row));
    expect(rowStack(row)).not.toBeNull();
    fireEvent.click(rowToggle(row));

    expect(rowStack(row)).toBeNull();
    expect(document.body.innerHTML).not.toContain("submitForm");
  });

  it("grupa bez stacka mówi to wprost, zamiast pokazywać pusty blok", async () => {
    panel();
    await loaded();
    // Druga grupa ("Hydration failed") nie ma ani jednej próbki ze stackiem.
    const row = groupRows()[1];
    fireEvent.click(rowToggle(row));

    expect(row).toHaveTextContent(ce("noStack"));
    expect(rowStack(row)).toBeNull();
  });

  it("grupa bez ścieżek nie renderuje pustej sekcji ścieżek", async () => {
    h.fetchReport.mockResolvedValue(agg([sample("Script error.", { path: null })]));
    panel();
    await loaded();
    const row = groupRows()[0];
    fireEvent.click(rowToggle(row));

    expect(row).not.toHaveTextContent(ce("topPaths"));
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - rozwijanie szczegółów", () => {
  it("przycisk wiersza ogłasza stan rozwinięcia i zmienia podpowiedź", async () => {
    panel();
    await loaded();
    const toggle = rowToggle(groupRows()[0]);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("title", ce("expand"));

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("title", ce("collapse"));
  });

  it("każdy wiersz ma WŁASNY stan - rozwinięcie jednego nie otwiera reszty", async () => {
    panel();
    await loaded();
    const rows = groupRows();

    fireEvent.click(rowToggle(rows[0]));

    expect(rowToggle(rows[0])).toHaveAttribute("aria-expanded", "true");
    expect(rowToggle(rows[1])).toHaveAttribute("aria-expanded", "false");
    expect(rowToggle(rows[2])).toHaveAttribute("aria-expanded", "false");
  });

  it("szczegóły podają pierwsze i ostatnie wystąpienie, sformatowane wg języka", async () => {
    panel();
    await loaded();
    const row = groupRows()[0];
    fireEvent.click(rowToggle(row));

    const g = BUSY.groups[0];
    expect(row).toHaveTextContent(shortDateTime(g.firstSeen, "pl-PL"));
    expect(row).toHaveTextContent(shortDateTime(g.lastSeen, "pl-PL"));
    expect(row).toHaveTextContent(ce("firstSeen"));
    expect(row).toHaveTextContent(ce("colLastSeen"));
  });

  it("najczęstsze ścieżki przychodzą z agregatora, z licznikiem wystąpień", async () => {
    panel();
    await loaded();
    const row = groupRows()[0];
    fireEvent.click(rowToggle(row));

    const paths = BUSY.groups[0].topPaths;
    expect(paths.length).toBeGreaterThan(0);
    expect(row).toHaveTextContent(ce("topPaths"));
    for (const p of paths) {
      expect(row).toHaveTextContent(p.path);
      expect(row).toHaveTextContent(`×${p.count}`);
    }
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - okno czasu", () => {
  it("startowe okno to 7 dni i oba końce są znacznikami ISO", async () => {
    panel();
    await loaded();

    const inputs = queryInputs();
    expect(inputs).toHaveLength(1);
    expect(spanDays(inputs[0])).toBe(7);
    // Walidator server fn wymaga `z.string().datetime()` - każdy inny format
    // wracałby błędem walidacji, a nie raportem.
    expect(inputs[0].sinceIso).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(inputs[0].untilIso).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("zmiana presetu przestawia WEJŚCIE zapytania, nie tylko etykietę", async () => {
    panel();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: presetLabel("30d") }));
    await waitFor(() => expect(h.fetchReport.mock.calls.length).toBe(2));

    expect(spanDays(queryInputs()[1])).toBe(30);
  });

  it("najkrótsze okno to jeden dzień - liczone w godzinach, nie w dniach", async () => {
    panel();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: presetLabel("24h") }));
    await waitFor(() => expect(h.fetchReport.mock.calls.length).toBe(2));

    expect(spanDays(queryInputs()[1])).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - izolacja warsztatów", () => {
  it("panel warsztatu B pokazuje WYŁĄCZNIE błędy warsztatu B", async () => {
    h.fetchReport.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    expect(container.textContent ?? "").toContain("BETA: hydration mismatch");
    expect(container.textContent ?? "").not.toContain("ALFA");
    expect(container.textContent ?? "").not.toContain("/alfa/");
    // Ścieżki i komunikaty jadą także do eksportu CSV i do kanwy.
    expect(JSON.stringify(h.charts)).not.toContain("ALFA");
  });

  it("świeży klient react-query nie przenosi raportu między warsztatami", async () => {
    h.fetchReport.mockResolvedValue(WORKSPACE_A);
    const first = panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));
    expect(first.container.textContent ?? "").toContain("alfaBoot");
    first.unmount();
    h.charts.length = 0;

    h.fetchReport.mockResolvedValue(WORKSPACE_B);
    const second = panel();
    await loaded();

    expect(second.container.textContent ?? "").not.toContain("ALFA");
    expect(second.container.textContent ?? "").not.toContain("alfaBoot");
  });

  it("współdzielony klient odpytuje ponownie, gdy okno przesunęło się w czasie", async () => {
    const clock = vi.spyOn(Date, "now");
    const t0 = Date.parse("2026-08-20T10:00:00.000Z");
    clock.mockReturnValue(t0);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.fetchReport.mockResolvedValue(WORKSPACE_A);
    const first = panel(client);
    await loaded();
    first.unmount();

    clock.mockReturnValue(t0 + 60_000);
    h.fetchReport.mockResolvedValue(WORKSPACE_B);
    const second = panel(client);
    await loaded();

    expect(h.fetchReport.mock.calls.length).toBe(2);
    expect(second.container.textContent ?? "").not.toContain("ALFA");
  });

  it.fails(
    "DEFEKT: klucz cache nie niesie warsztatu - to samo okno oznacza wspólny raport",
    async () => {
      // `queryKey: ["admin","client-errors", sinceIso, untilIso]` nie zawiera
      // ani tenanta, ani użytkownika. Dziś chroni to WYŁĄCZNIE znacznik czasu:
      // `buildPresetRange("7d")` woła `Date.now()` przy montowaniu, więc dwa
      // montowania prawie zawsze dają różne granice. "Prawie" nie jest
      // gwarancją - zamrożony zegar modeluje przełączenie warsztatu w tej samej
      // klatce, a przy `staleTime: 60_000` react-query NIE ponawia zapytania.
      // Administrator warsztatu B czyta wtedy komunikaty i stacki warsztatu A,
      // i nie leci przy tym ani jedno żądanie sieciowe.
      const clock = vi.spyOn(Date, "now");
      clock.mockReturnValue(Date.parse("2026-08-20T10:00:00.000Z"));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      h.fetchReport.mockResolvedValue(WORKSPACE_A);
      const first = panel(client);
      await loaded();
      first.unmount();

      h.fetchReport.mockResolvedValue(WORKSPACE_B);
      const second = panel(client);
      await loaded();

      expect(second.container.textContent ?? "").not.toContain("ALFA");
    },
  );
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - słownik PL/EN", () => {
  it("po przełączeniu na angielski etykiety KPI i nagłówki przychodzą z gałęzi EN", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded("en");

    expect(screen.getByText(ce("kpiTotal", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(ce("kpiGroups", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(ce("kpiPaths", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(ce("kpiLast24h", {}, "en"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ce("groupsTitle", {}, "en") })).toBeInTheDocument();
    // Ten sam klucz po polsku brzmi inaczej - gdyby EN spadł na fallback,
    // asercje wyżej przeszłyby, a ta oblałaby.
    expect(ce("kpiTotal", {}, "en")).not.toBe(ce("kpiTotal"));
  });

  it("angielski komunikat pustego okna nie spada na polski fallback", async () => {
    await i18n.changeLanguage("en");
    h.fetchReport.mockResolvedValue(EMPTY);
    panel();
    await loaded("en");

    expect(screen.getByText(ce("empty", {}, "en"))).toBeInTheDocument();
    expect(screen.queryByText(ce("empty"))).toBeNull();
  });

  it("angielski interfejs formatuje liczby i daty w locale en-GB", async () => {
    // To jest DZIAŁAJĄCA ścieżka, więc asercja jest pozytywna: panel wybiera
    // locale z `i18n.language`, a nie z zaszytego "pl-PL".
    await i18n.changeLanguage("en");
    const big = agg([sample("Boom")], { windowTotal: 41_234, capped: true });
    h.fetchReport.mockResolvedValue(big);
    panel();
    await loaded("en");

    expect(kpiValue(ce("kpiTotal", {}, "en"))).toBe((41_234).toLocaleString("en-GB"));
    fireEvent.click(rowToggle(groupRows("en")[0]));
    expect(groupRows("en")[0]).toHaveTextContent(shortDateTime(big.groups[0].lastSeen, "en-GB"));
  });

  it("angielskie źródła i podpowiedzi rozwijania przychodzą z gałęzi EN", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded("en");

    const toggle = rowToggle(groupRows("en")[0]);
    expect(toggle).toHaveAttribute("title", ce("expand", {}, "en"));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("title", ce("collapse", {}, "en"));
    expect(groupRows("en")[0]).toHaveTextContent(ce("stack", {}, "en"));
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - dostępność", () => {
  it("wykres trendu ma nazwę regionu zbudowaną z tytułu karty", async () => {
    panel();
    await loaded();

    const names = screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    expect(names).toContain(chrome("chartRegion", { title: ce("trendTitle") }));
  });

  it("wypełniony panel z rozwiniętą grupą nie ma naruszeń axe", async () => {
    // `button-name` wyłączone ŚWIADOMIE: jedyne naruszenie w tym poddrzewie to
    // wyzwalacz menu eksportu w `ChartCard` (sama ikona `MoreHorizontal` bez
    // `aria-label`), przypięty `it.fails` w `chartCard.test.tsx`. Nie należy do
    // tego panelu i nie ma sensu pinować go drugi raz. Wszystko, co ten pulpit
    // dodaje od siebie - przyciski rozwijania z `aria-expanded`, lista grup,
    // plakietki źródeł, blok `pre` ze stackiem - przechodzi bez ulg.
    const { container } = panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("panel bez błędów nie ma naruszeń axe", async () => {
    h.fetchReport.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("cały dług dostępności panelu to JEDEN przycisk, i to nie jego własny", async () => {
    // Kontrapunkt dla ulgi wyżej: bez wyłączonej reguły lista naruszeń ma
    // dokładnie jedną pozycję i jest nią wyzwalacz menu `ChartCard`. Dopisanie
    // przez ten panel własnego bezimiennego przycisku oblewa ten test.
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    expect(violations[0].nodes).toHaveLength(1);
  });

  it("lista grup jest listą - kolejność niesie znaczenie dla czytnika ekranu", async () => {
    panel();
    await loaded();

    const list = groupsCard().querySelector("ul");
    expect(list).not.toBeNull();
    expect(Array.from(list?.children ?? []).every((li) => li.tagName === "LI")).toBe(true);
  });
});
