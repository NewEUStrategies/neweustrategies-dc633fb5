// `ClientErrorsDashboard` - pulpit telemetrii bledow przegladarki: zgodnosc z
// agregatorem, redakcja PII na ekranie, trzy stany i izolacja warsztatow.
//
// PO CO. Plik stal na zerze. Sama matematyka grupowania (`clientErrorsAggregate`)
// ma wlasne testy - TUTAJ przedmiotem dowodu jest to, czego tamten plik nie
// widzi, a co decyduje o tym, czy administrator czyta telemetrie, czy jej
// atrape:
//
//   1. PANEL MUSI POKAZAC TO, CO POLICZYL AGREGATOR. Fixtury sa tu budowane
//      PRAWDZIWYM `aggregateClientErrors`, nie recznie: gdyby panel liczyl
//      cokolwiek u siebie (przeliczal udzialy, sortowal inaczej, gubil grupe
//      poza `maxGroups`), asercje rozjechalyby sie z tym, co widzi baza. Dwa
//      pola sa tu szczegolnie latwe do pomylenia: `total` to liczba PROBEK po
//      cap-ie, a `windowTotal` to prawdziwa liczba wierszy w oknie. Kafelek
//      "Bledy w oknie" musi brac drugie, a udzial grupy - pierwsze.
//   2. PII NIE MOZE WROCIC NA EKRAN. `redact.ts` czysci komunikaty i stacki na
//      ingestcie, wiec panel dostaje tekst z markerami `[redacted-*]`. Panel
//      ma go pokazac DOKLADNIE takim, jaki dostal, i ani nie skladac go z
//      powrotem, ani nie interpretowac jako znacznikow HTML - stack to tekst
//      przyslany przez obca przegladarke. Osobno: stack jest tresci schowana,
//      wiec w stanie zwinietym nie ma go w DOM w ogole.
//   3. TRZY STANY, JEDEN KOMUNIKAT. "Jeszcze nie wiem", "odczyt padl" i "w
//      oknie naprawde nie bylo bledow" konczy sie tym samym zielonym
//      "Brak bledow w wybranym oknie. To dobrze". Bramka roli w server function
//      RZUCA (`Forbidden: admin role required`), wiec ten komunikat obsluguje
//      takze odmowe dostepu. Przypiete `it.fails`.
//   4. IZOLACJA WARSZTATOW. `queryKey` niesie wylacznie granice okna - nie ma
//      w nim ani tenanta, ani uzytkownika.
//   5. SLOWNIK PL/EN. Napisy sa asertowane przez `realT("pl")` / `realT("en")`.
//      Formatowanie liczb i dat jest tu zalezne od jezyka (`en-GB` / `pl-PL`) -
//      i to jest sprawdzane, a nie deklarowane.
//
// ECHARTS JEST TU ZAKAZANY (patrz naglowek `EChart.tsx`): podmieniamy `EChart`
// atrapa, ktora PRZECHWYTUJE `option`. Trend i iskra KPI sa wiec badane na
// strukturze danych oddanej wykresowi - i ~1 MB biblioteki nigdy nie wchodzi do
// procesu testowego. Atrapa lapie zarowno import `../EChart` z `ChartCard`, jak
// i z `KpiTile`, bo oba wskazuja ten sam modul.
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

// `useServerFn` staje sie tozsamoscia - wywolanie idzie prosto do atrapy.
// Mock CZESCIOWY, bo `@/lib/i18n` ciagnie z tego samego pakietu
// `createIsomorphicFn`, a pelna atrapa wywracalaby inicjalizacje slownika.
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

// `react-i18next` NIE JEST atrapowany: panel jest dwujezyczny, a przedmiotem
// dowodu jest to, ze napisy przychodza ZE SLOWNIKA.
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { ClientErrorsDashboard } from "../ClientErrorsDashboard";

// ---------------------------------------------------------------------------
// Slownik
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

/** Zamrozony punkt odniesienia: `last24h` i seria dzienna musza byc powtarzalne. */
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
 * Stack "z ingestu": surowa tresc z obcej przegladarki PRZEPUSZCZONA przez
 * `redactPii`, czyli dokladnie to, co trafia do kolumny `client_errors.stack`.
 * Surowe wartosci sa trzymane osobno, zeby test mogl dowiesc ich BRAKU na
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

/** Warsztat A - kazdy napis niesie rozpoznawalny prefiks. */
const WORKSPACE_A = agg([
  sample("ALFA: chunk 12 failed", { path: "/alfa/analizy", stack: "at alfaBoot (alfa.js:1:1)" }),
  sample("ALFA: chunk 44 failed", { path: "/alfa/analizy" }),
]);

/** Warsztat B - rozlaczny z A na kazdym napisie. */
const WORKSPACE_B = agg([
  sample("BETA: hydration mismatch", { path: "/beta/raporty", stack: "at betaBoot (beta.js:2:2)" }),
]);

const EMPTY = agg([]);

/**
 * Okno "roboze": trzy grupy o roznej licznosci, dwa zrodla, trzy sciezki,
 * jeden stack. Wystarcza do sprawdzenia kolejnosci, udzialow i plakietek.
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

/** Wykres trendu - jedyny slupkowy w panelu. */
function trendChart(): Opt {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    const o = h.charts[i].option as Opt;
    if (seriesOf(o)[0]?.type === "bar") return o;
  }
  throw new Error("test: nie przechwycono wykresu trendu");
}

/** Iskra kafelka KPI - jedyna linia z ukryta osia. */
function sparkChart(): Opt {
  for (let i = h.charts.length - 1; i >= 0; i -= 1) {
    const o = h.charts[i].option as Opt;
    if (rec(o.xAxis).show === false && seriesOf(o)[0]?.type === "line") return o;
  }
  throw new Error("test: nie przechwycono iskry KPI");
}

/** Wartosc kafelka KPI stojaca przy podanej etykiecie. */
function kpiValue(label: string): string {
  const box = screen.getByText(label).closest("div.min-w-0");
  if (!box) throw new Error(`test: nie znaleziono kafelka KPI "${label}"`);
  return box.children[1]?.textContent ?? "";
}

/** Karta "Problemy wg czestosci". */
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

/** Liczba wystapien - drugi `span` przycisku, wyrownany do prawej. */
function rowCount(row: HTMLElement): string {
  return row.querySelector("span.justify-self-end")?.textContent ?? "";
}

/** Udzial w procentach - jedyny `span` o szerokosci `w-9`. */
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

/** Czeka, az raport dojedzie i karta grup przestanie meldowac ladowanie. */
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

  it("agregator naprawde sklada warianty chunka w jedna grupe", () => {
    // Gdyby normalizacja przestala sklejac liczby, fixtura `BUSY` mialaby inna
    // liczbe grup i asercje o kolejnosci przestalyby cokolwiek znaczyc.
    expect(BUSY.groups).toHaveLength(3);
    expect(BUSY.groups[0].count).toBe(3);
    expect(BUSY.uniqueGroups).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - trzy stany panelu", () => {
  it("w trakcie pobierania karta grup melduje ladowanie i nie ma ani jednego stacka", async () => {
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    const { container } = panel();

    expect(await screen.findByText(common("loadingData"))).toBeInTheDocument();
    expect(groupRows()).toHaveLength(0);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("w trakcie pobierania przycisk odswiezania jest zablokowany", async () => {
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    panel();

    const btn = await screen.findByRole("button", { name: common("refresh") });
    expect(btn).toBeDisabled();
  });

  it.fails("DEFEKT: w trakcie pobierania cztery kafelki melduja ZERO bledow", async () => {
    // `(report?.windowTotal ?? 0).toLocaleString(locale)` nie odroznia
    // "nie wiem" od "nie bylo". Zero na pulpicie bledow czyta sie jako
    // twierdzenie o zdrowiu aplikacji, ktorego pomiar sie nie odbyl.
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

  it("okno bez bledow pokazuje komunikat ze slownika i zero wierszy", async () => {
    h.fetchReport.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(screen.getByText(ce("empty"))).toBeInTheDocument();
    expect(groupRows()).toHaveLength(0);
    expect(kpiValue(ce("kpiTotal"))).toBe("0");
  });

  it("po awarii odczytu pasek narzedzi zyje - operator moze zmienic okno i ponowic", async () => {
    h.fetchReport.mockRejectedValue(new Error("Forbidden: admin role required"));
    panel();
    await loaded();

    expect(screen.getByRole("button", { name: common("refresh") })).toBeEnabled();
    expect(screen.getByRole("button", { name: presetLabel("30d") })).toBeInTheDocument();
  });

  it.fails("DEFEKT: odmowa dostepu melduje sie jako dobra wiadomosc", async () => {
    // `reportQuery.isError` i `.error` nie sa w tym pliku czytane ani raz, a
    // server function RZUCA przy braku roli admina i przy padniete
    // uwierzytelnieniu (degraduje do pustego raportu tylko brak tabeli). Panel
    // maluje wtedy "Brak bledow w wybranym oknie. To dobrze - beacony (...)
    // trafiaja tu automatycznie" - czyli zapewnia, ze telemetria dziala, w
    // sytuacji, w ktorej odczyt zostal odrzucony.
    h.fetchReport.mockRejectedValue(new Error("Forbidden: admin role required"));
    const { container } = panel();
    await loaded();

    expect(screen.queryByText(ce("empty"))).toBeNull();
    expect(container.textContent ?? "").toMatch(/Forbidden|b[lł][aą]d|error/i);
  });

  it("przycisk odswiezania ponawia odczyt tego samego okna", async () => {
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

describe("ClientErrorsDashboard - zgodnosc z agregatorem", () => {
  it("liczba wierszy i ich kolejnosc odpowiadaja grupom z agregatora", async () => {
    panel();
    await loaded();

    const rows = groupRows();
    expect(rows).toHaveLength(BUSY.groups.length);
    expect(rows.map(rowMessage)).toEqual(BUSY.groups.map((g) => g.message));
    // Agregator sortuje malejaco po licznosci - panel nie ma prawa tego zmienic.
    expect(rows.map((r) => Number(rowCount(r)))).toEqual([3, 2, 1]);
  });

  it("wiersz pokazuje REPREZENTATYWNY komunikat, a nie odcisk z zaslonami", async () => {
    // Grupa "chunk" powstala z trzech roznych numerow. Odcisk brzmi
    // "Loading chunk <n> failed" i jest kluczem technicznym - operator ma
    // zobaczyc prawdziwy komunikat najswiezszej probki.
    panel();
    await loaded();

    const first = groupRows()[0];
    expect(rowMessage(first)).toBe("Loading chunk 7 failed");
    expect(rowMessage(first)).not.toBe(normalizeErrorMessage("Loading chunk 7 failed"));
    expect(groupsCard().textContent ?? "").not.toContain("<n>");
  });

  it("kafelki KPI biora pola raportu, kazde swoje", async () => {
    panel();
    await loaded();

    expect(kpiValue(ce("kpiTotal"))).toBe(String(BUSY.windowTotal));
    expect(kpiValue(ce("kpiGroups"))).toBe(String(BUSY.uniqueGroups));
    expect(kpiValue(ce("kpiPaths"))).toBe(String(BUSY.affectedPaths));
    expect(kpiValue(ce("kpiLast24h"))).toBe(String(BUSY.last24h));
    // Probka bez sciezki (`path: null`) nie moze podniesc licznika sciezek.
    expect(BUSY.affectedPaths).toBe(3);
    // Trzy probki z ostatnich 24 h, przy szesciu w oknie.
    expect(BUSY.last24h).toBe(3);
  });

  it("kafelek liczby bledow bierze PRAWDZIWA liczbe wierszy, nie liczbe probek", async () => {
    // To sa dwa rozne pola: `total` = probki po cap-ie, `windowTotal` = COUNT.
    // Podmiana jednego na drugie zaniza pulpit o cala odcieta czesc okna i jest
    // niewidoczna, dopoki cap nie zadziala.
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

  it("udzial grupy liczy sie wzgledem PROBEK, a nie wzgledem calego okna", async () => {
    // Grupy powstaly z probek, wiec mianownikiem jest `total`. Uzycie
    // `windowTotal` przy dzialajacym cap-ie zgnioloby wszystkie paski do 0%.
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

  it("plakietka o przycieciu podaje OBA liczniki, sformatowane wg jezyka", async () => {
    const capped = agg([sample("Boom")], { windowTotal: 41_234, capped: true });
    h.fetchReport.mockResolvedValue(capped);
    const { container } = panel();
    await loaded();

    // `toContain` na `textContent`, nie `getByText`: separator tysiecy w pl-PL
    // to twarda spacja (U+00A0), a normalizator testing-library zamienia ja na
    // zwykla - porownanie przez `getByText` mierzyloby wtedy normalizator, nie
    // panel.
    expect(container.textContent ?? "").toContain(
      ce("cappedNote", {
        cap: capped.total.toLocaleString("pl-PL"),
        total: (41_234).toLocaleString("pl-PL"),
      }),
    );
  });

  it("bez przyciecia plakietka o cap-ie NIE powstaje", async () => {
    panel();
    await loaded();

    expect(screen.queryByText(/41 234|41,234/)).toBeNull();
    expect(
      screen.queryByText(
        ce("cappedNote", { cap: String(BUSY.total), total: String(BUSY.windowTotal) }),
      ),
    ).toBeNull();
  });

  it("zrodla grupy sa tlumaczone, a nieznane zrodlo spada na wartosc surowa", async () => {
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
    // Bez `defaultValue` na ekranie stanelaby surowa sciezka klucza i18n.
    expect(rowSources(rows[1])).toEqual(["webworker_onerror"]);
  });

  it("trend dzienny oddaje kanwie DOKLADNIE serie dzienna agregatora", async () => {
    panel();
    await loaded();

    const opt = trendChart();
    expect(numList(seriesOf(opt)[0].data)).toEqual(BUSY.daily.map((d) => d.count));
    // Etykieta osi jest skrocona do "MM-DD" - rok jest w oknie, nie w slupku.
    expect(strList(rec(opt.xAxis).data)).toEqual(BUSY.daily.map((d) => d.day.slice(5)));
    expect(BUSY.daily).toHaveLength(7);
    expect(seriesOf(opt)[0].name).toBe(ce("trendSeries"));
  });

  it("iskra kafelka KPI niesie te sama serie dzienna co trend", async () => {
    panel();
    await loaded();

    expect(numList(seriesOf(sparkChart())[0].data)).toEqual(BUSY.daily.map((d) => d.count));
  });

  it("okno bez bledow daje trend z samymi zerami, a nie wykres bez danych", async () => {
    // Zero w dniu bez bledow to uczciwy pomiar; dziura w serii czytalaby sie
    // jako "brak telemetrii".
    h.fetchReport.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(numList(seriesOf(trendChart())[0].data)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - redakcja PII na ekranie", () => {
  it("zwiniety wiersz NIE MA stacka w DOM - ani w tresci, ani w atrybucie", async () => {
    panel();
    await loaded();

    const row = groupRows()[0];
    expect(rowStack(row)).toBeNull();
    expect(row.textContent ?? "").not.toContain("submitForm");
    // `title` zwinietego wiersza to komunikat, nie stack - inaczej cala tresc
    // wyjechalaby w podpowiedzi przegladarki.
    expect(row.querySelector("span.font-mono")?.getAttribute("title")).toBe(
      "Loading chunk 7 failed",
    );
    expect(document.body.innerHTML).not.toContain("submitForm");
  });

  it("rozwiniety wiersz pokazuje stack DOKLADNIE taki, jaki przyszedl z ingestu", async () => {
    panel();
    await loaded();

    const row = groupRows()[0];
    fireEvent.click(rowToggle(row));

    const pre = rowStack(row);
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(SCRUBBED_STACK);
  });

  it("rozwiniety stack niesie markery redakcji, a nie surowe dane osobowe", async () => {
    panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    const shown = rowStack(groupRows()[0])?.textContent ?? "";
    expect(shown).toContain("[redacted-email]");
    expect(shown).toContain("[redacted-jwt]");
    expect(shown).toContain("[redacted-ip]");
    // I to jest wlasciwa asercja: panel nie sklada niczego z powrotem.
    expect(shown).not.toContain(RAW_EMAIL);
    expect(shown).not.toContain(RAW_JWT);
    expect(shown).not.toContain(RAW_IP);
    expect(document.body.innerHTML).not.toContain(RAW_EMAIL);
  });

  it("stack z zawartoscia HTML jest TEKSTEM, nie znacznikami", async () => {
    // Stack przychodzi z obcej przegladarki i przechodzi przez `redactPii`,
    // ktore nie jest sanitizerem HTML. Jedyne, co go tu unieszkodliwia, to
    // renderowanie jako dziecko tekstowe - `dangerouslySetInnerHTML` w tym
    // miejscu byloby XSS-em w panelu admina.
    const hostile = '<img src=x onerror="alert(1)"> at boot (app.js:1:1)';
    h.fetchReport.mockResolvedValue(agg([sample("Wrogi stack", { stack: hostile })]));
    panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    const pre = rowStack(groupRows()[0]);
    expect(pre?.querySelector("img")).toBeNull();
    expect(pre?.textContent).toBe(hostile);
  });

  it("zwiniecie wiersza usuwa stack z DOM, nie tylko go ukrywa", async () => {
    panel();
    await loaded();
    const row = groupRows()[0];

    fireEvent.click(rowToggle(row));
    expect(rowStack(row)).not.toBeNull();
    fireEvent.click(rowToggle(row));

    expect(rowStack(row)).toBeNull();
    expect(document.body.innerHTML).not.toContain("submitForm");
  });

  it("grupa bez stacka mowi to wprost, zamiast pokazywac pusty blok", async () => {
    panel();
    await loaded();
    // Druga grupa ("Hydration failed") nie ma ani jednej probki ze stackiem.
    const row = groupRows()[1];
    fireEvent.click(rowToggle(row));

    expect(row).toHaveTextContent(ce("noStack"));
    expect(rowStack(row)).toBeNull();
  });

  it("grupa bez sciezek nie renderuje pustej sekcji sciezek", async () => {
    h.fetchReport.mockResolvedValue(agg([sample("Script error.", { path: null })]));
    panel();
    await loaded();
    const row = groupRows()[0];
    fireEvent.click(rowToggle(row));

    expect(row).not.toHaveTextContent(ce("topPaths"));
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - rozwijanie szczegolow", () => {
  it("przycisk wiersza oglasza stan rozwiniecia i zmienia podpowiedz", async () => {
    panel();
    await loaded();
    const toggle = rowToggle(groupRows()[0]);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("title", ce("expand"));

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("title", ce("collapse"));
  });

  it("kazdy wiersz ma WLASNY stan - rozwiniecie jednego nie otwiera reszty", async () => {
    panel();
    await loaded();
    const rows = groupRows();

    fireEvent.click(rowToggle(rows[0]));

    expect(rowToggle(rows[0])).toHaveAttribute("aria-expanded", "true");
    expect(rowToggle(rows[1])).toHaveAttribute("aria-expanded", "false");
    expect(rowToggle(rows[2])).toHaveAttribute("aria-expanded", "false");
  });

  it("szczegoly podaja pierwsze i ostatnie wystapienie, sformatowane wg jezyka", async () => {
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

  it("najczestsze sciezki przychodza z agregatora, z licznikiem wystapien", async () => {
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
  it("startowe okno to 7 dni i oba konce sa znacznikami ISO", async () => {
    panel();
    await loaded();

    const inputs = queryInputs();
    expect(inputs).toHaveLength(1);
    expect(spanDays(inputs[0])).toBe(7);
    // Walidator server fn wymaga `z.string().datetime()` - kazdy inny format
    // wracalby bledem walidacji, a nie raportem.
    expect(inputs[0].sinceIso).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(inputs[0].untilIso).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("zmiana presetu przestawia WEJSCIE zapytania, nie tylko etykiete", async () => {
    panel();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: presetLabel("30d") }));
    await waitFor(() => expect(h.fetchReport.mock.calls.length).toBe(2));

    expect(spanDays(queryInputs()[1])).toBe(30);
  });

  it("najkrotsze okno to jeden dzien - liczone w godzinach, nie w dniach", async () => {
    panel();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: presetLabel("24h") }));
    await waitFor(() => expect(h.fetchReport.mock.calls.length).toBe(2));

    expect(spanDays(queryInputs()[1])).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("ClientErrorsDashboard - izolacja warsztatow", () => {
  it("panel warsztatu B pokazuje WYLACZNIE bledy warsztatu B", async () => {
    h.fetchReport.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    expect(container.textContent ?? "").toContain("BETA: hydration mismatch");
    expect(container.textContent ?? "").not.toContain("ALFA");
    expect(container.textContent ?? "").not.toContain("/alfa/");
    // Sciezki i komunikaty jada takze do eksportu CSV i do kanwy.
    expect(JSON.stringify(h.charts)).not.toContain("ALFA");
  });

  it("swiezy klient react-query nie przenosi raportu miedzy warsztatami", async () => {
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

  it("wspoldzielony klient odpytuje ponownie, gdy okno przesunelo sie w czasie", async () => {
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
    "DEFEKT: klucz cache nie niesie warsztatu - to samo okno oznacza wspolny raport",
    async () => {
      // `queryKey: ["admin","client-errors", sinceIso, untilIso]` nie zawiera
      // ani tenanta, ani uzytkownika. Dzis chroni to WYLACZNIE znacznik czasu:
      // `buildPresetRange("7d")` woła `Date.now()` przy montowaniu, wiec dwa
      // montowania prawie zawsze daja rozne granice. "Prawie" nie jest
      // gwarancja - zamrozony zegar modeluje przelaczenie warsztatu w tej samej
      // klatce, a przy `staleTime: 60_000` react-query NIE ponawia zapytania.
      // Administrator warsztatu B czyta wtedy komunikaty i stacki warsztatu A,
      // i nie leci przy tym ani jedno zadanie sieciowe.
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

describe("ClientErrorsDashboard - slownik PL/EN", () => {
  it("po przelaczeniu na angielski etykiety KPI i naglowki przychodza z galezi EN", async () => {
    await i18n.changeLanguage("en");
    panel();
    await loaded("en");

    expect(screen.getByText(ce("kpiTotal", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(ce("kpiGroups", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(ce("kpiPaths", {}, "en"))).toBeInTheDocument();
    expect(screen.getByText(ce("kpiLast24h", {}, "en"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ce("groupsTitle", {}, "en") })).toBeInTheDocument();
    // Ten sam klucz po polsku brzmi inaczej - gdyby EN spadl na fallback,
    // asercje wyzej przeszlyby, a ta oblalaby.
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
    // To jest DZIALAJACA sciezka, wiec asercja jest pozytywna: panel wybiera
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

  it("angielskie zrodla i podpowiedzi rozwijania przychodza z galezi EN", async () => {
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

describe("ClientErrorsDashboard - dostepnosc", () => {
  it("wykres trendu ma nazwe regionu zbudowana z tytulu karty", async () => {
    panel();
    await loaded();

    const names = screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    expect(names).toContain(chrome("chartRegion", { title: ce("trendTitle") }));
  });

  it("wypelniony panel z rozwinieta grupa nie ma naruszen axe", async () => {
    // `button-name` wylaczone SWIADOMIE: jedyne naruszenie w tym poddrzewie to
    // wyzwalacz menu eksportu w `ChartCard` (sama ikona `MoreHorizontal` bez
    // `aria-label`), przypiety `it.fails` w `chartCard.test.tsx`. Nie nalezy do
    // tego panelu i nie ma sensu pinowac go drugi raz. Wszystko, co ten pulpit
    // dodaje od siebie - przyciski rozwijania z `aria-expanded`, lista grup,
    // plakietki zrodel, blok `pre` ze stackiem - przechodzi bez ulg.
    const { container } = panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("panel bez bledow nie ma naruszen axe", async () => {
    h.fetchReport.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("caly dlug dostepnosci panelu to JEDEN przycisk, i to nie jego wlasny", async () => {
    // Kontrapunkt dla ulgi wyzej: bez wylaczonej reguly lista naruszen ma
    // dokladnie jedna pozycje i jest nia wyzwalacz menu `ChartCard`. Dopisanie
    // przez ten panel wlasnego bezimiennego przycisku oblewa ten test.
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    expect(violations[0].nodes).toHaveLength(1);
  });

  it("lista grup jest lista - kolejnosc niesie znaczenie dla czytnika ekranu", async () => {
    panel();
    await loaded();

    const list = groupsCard().querySelector("ul");
    expect(list).not.toBeNull();
    expect(Array.from(list?.children ?? []).every((li) => li.tagName === "LI")).toBe(true);
  });
});
