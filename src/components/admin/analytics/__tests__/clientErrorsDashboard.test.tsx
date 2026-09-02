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
//   3. TRZY STANY, TRZY KOMUNIKATY. "Jeszcze nie wiem", "odczyt padł" i "w
//      oknie naprawdę nie było błędów" to trzy różne decyzje operatora, więc
//      panel melduje je osobno: pomiar w toku (`common.measuring`), awaria z
//      PRZYCZYNĄ i `role="alert"` (`common.readFailedReason`) oraz zmierzone
//      zero (`clientErrors.empty`). Bramka roli w server function RZUCA
//      (`Forbidden: admin role required`), więc gałąź awarii jest tu także
//      gałęzią odmowy dostępu, a kafelki KPI nie mają prawa malować wtedy zera.
//   4. IZOLACJA WARSZTATÓW. `queryKey` niesie NAJEMCĘ obok granic okna, a
//      zapytanie czeka na jego rozwiązanie (`enabled`) - najemca jest tu
//      atrapą (`h.tenantId`), bo tylko tak da się odegrać przejście między
//      warsztatami na tym samym kliencie cache.
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

const TENANT_A = "tenant-alfa";
const TENANT_B = "tenant-beta";

const h = vi.hoisted(() => ({
  fetchReport: vi.fn(),
  /** Warsztat, w którym stoi panel - zmiana tej wartości to przejście do innego. */
  tenantId: "tenant-alfa" as string | null,
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

// Najemca jest ATRAPĄ, a nie prawdziwym `useCurrentTenantId`: tamten ciągnie
// klienta Supabase i sesję `useAuth`, a przedmiotem dowodu jest tylko to, że
// identyfikator warsztatu WCHODZI DO KLUCZA react-query. Sterowanie nim z testu
// (`h.tenantId`) daje jedyny sposób odegrania przejścia między warsztatami na
// TYM SAMYM kliencie cache.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
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

/**
 * Wartość pola wiersza wskazana PRZEZ NAZWĘ POLA, a nie przez klasę układu.
 *
 * Wiersz grupy jest listą definicji: każda wartość stoi w `<dd>` zaraz za
 * `<dt>` z nazwą pola ze słownika (`colMessage`, `colCount`, `colShare`,
 * `colSources`). Pomocnik idzie więc po RELACJI nazwa-wartość - tej samej,
 * której istnienia pilnuje przypadek „wiersz grupy wiąże każdą wartość z nazwą
 * pola". Wcześniej te same wartości wskazywały utility Tailwinda
 * (`font-mono`, `justify-self-end`, `w-9`, `hidden`), więc kilkanaście asercji
 * tego pliku wisiało na wyrównaniu i szerokości kolumny: refaktor CSS-a bez
 * zmiany zachowania oblewał je wszystkie, a test utrwalał brak semantyki jako
 * umowę. Zniknięcie nazwy pola nie da się tu przemilczeć - pomocnik RZUCA,
 * więc oblewa każdą asercję, która przez niego przechodzi.
 */
function rowField(row: HTMLElement, col: string, lang: AppLang = "pl"): HTMLElement {
  const name = ce(col, {}, lang);
  const term = Array.from(row.querySelectorAll("dt")).find(
    (dt) => (dt.textContent ?? "").trim() === name,
  );
  if (!term) throw new Error(`test: wiersz grupy nie ma pola o nazwie "${name}"`);
  const value = term.nextElementSibling;
  if (!value || value.tagName !== "DD") {
    throw new Error(`test: pole "${name}" nie ma wartości w <dd>`);
  }
  return value as HTMLElement;
}

/** Komunikat grupy - wartość pola „Komunikat". */
function rowMessage(row: HTMLElement, lang: AppLang = "pl"): string {
  return rowField(row, "colMessage", lang).textContent ?? "";
}

/** Liczba wystąpień - wartość pola „Wystąpienia". */
function rowCount(row: HTMLElement, lang: AppLang = "pl"): string {
  return rowField(row, "colCount", lang).textContent ?? "";
}

/**
 * Udział w procentach - wartość pola „Udział". Pasek postępu stojący w tym
 * samym `<dd>` jest ilustracją procentu (`aria-hidden`, zero treści), więc
 * `textContent` pola to sam procent.
 */
function rowShare(row: HTMLElement, lang: AppLang = "pl"): string {
  return rowField(row, "colShare", lang).textContent ?? "";
}

/** Plakietki źródeł - dzieci pola „Źródła". */
function rowSources(row: HTMLElement, lang: AppLang = "pl"): string[] {
  return Array.from(rowField(row, "colSources", lang).children).map((b) => b.textContent ?? "");
}

function rowStack(row: HTMLElement): HTMLElement | null {
  return row.querySelector("pre");
}

/**
 * Trzy pola wiersza jako ELEMENTY - wejście do asercji o drzewie dostępności.
 * Brak któregokolwiek oblewa najpierw asercje o kolejności wierszy i o
 * udziałach (idą tym samym pomocnikiem), więc ten rzut nie może zazielenić
 * przypadku o dostępności po cichu.
 */
function rowFieldElements(row: HTMLElement, lang: AppLang = "pl"): HTMLElement[] {
  return ["colMessage", "colCount", "colShare"].map((col) => rowField(row, col, lang));
}

/**
 * Nazwa nadana JAWNIE (`aria-label` / `aria-labelledby`) - jedyna, która nie
 * zależy od arkusza stylów. `title` się tu NIE liczy: na `span`-ie o roli
 * generycznej nie tworzy dostępnej nazwy, a w tym wierszu i tak powtarza
 * WARTOŚĆ pola, a nie jego nazwę.
 */
function explicitAriaName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label !== null) return label;
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
}

/**
 * Czy element leży w poddrzewie gaszonym poniżej breakpointu `sm`, czyli w
 * kontenerze z utility `hidden` odwracaną dopiero warunkiem `sm:*`.
 *
 * Świadectwem jest LISTA KLAS, a nie `getComputedStyle`: happy-dom nie wczytuje
 * arkusza Tailwinda i nie ma silnika layoutu, więc `display` takiego kontenera
 * jest w tym środowisku pustym napisem (zmierzone). To samo jest powodem, dla
 * którego axe-core uznaje plakietki źródeł za widoczne.
 */
function hiddenBelowSm(el: Element, root: Element): boolean {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    const classes = Array.from(node.classList);
    if (classes.includes("hidden") && classes.some((c) => c.startsWith("sm:"))) return true;
    if (node === root) break;
  }
  return false;
}

/**
 * Czy pole jest powiązane z JAKĄKOLWIEK nazwą w drzewie dostępności. Trzy
 * mechanizmy, bez preferencji dla żadnego: jawna nazwa ARIA na polu, para
 * `<dt>`/`<dd>` w liście definicji albo komórka wiersza tabeli/siatki, której
 * tabela ma nagłówek kolumny. Wystarczy jeden - asercja nie narzuca
 * implementacji, wymaga istnienia relacji.
 */
function fieldHasNameRelation(field: Element): boolean {
  if (explicitAriaName(field).trim() !== "") return true;

  const definitionList = field.closest("dd")?.closest("dl") ?? null;
  if (definitionList !== null && definitionList.querySelector("dt") !== null) return true;

  const cell = field.closest('[role="cell"], [role="gridcell"], [role="columnheader"], td, th');
  const rowScope = cell?.closest('[role="row"], tr') ?? null;
  const tableScope =
    rowScope?.closest('[role="table"], [role="grid"], [role="treegrid"], table') ?? null;
  return (tableScope?.querySelector('[role="columnheader"], thead th') ?? null) !== null;
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

/**
 * Czeka, aż raport DOJEDZIE do panelu.
 *
 * ŚWIADOMIE NIE OPIERA SIĘ na zniknięciu żadnego KOMUNIKATU O STANIE. Po
 * pierwsze dlatego, że asercja "nie ma napisu X" przechodzi też wtedy, gdy
 * napisu jeszcze nie ma: przy obciążonej maszynie pierwszy render może wypaść
 * PRZED startem zapytania i test mierzy wtedy pusty panel - dokładnie tak
 * oblewały się cztery przypadki przy `load average` 34. Po drugie dlatego, że
 * komunikat o stanie jest przedmiotem dowodu w tym pliku (pomiar / awaria /
 * zmierzone zero), a pomocnik bramkujący się na przedmiocie dowodu przechodzi
 * jałowo w chwili, w której ten przedmiot się zmieni.
 *
 * Zostają więc dwa sygnały niezależne od treści ekranu: rozstrzygnięcie
 * obietnic, które atrapa naprawdę oddała (wewnątrz `act`, żeby React zdążył
 * przemalować), i POZYTYWNY warunek na pasku narzędzi - przycisk odświeżania
 * jest zablokowany dokładnie tak długo, jak trwa `isFetching`, więc jego
 * odblokowanie nie może być prawdą w pierwszej klatce.
 */
async function loaded(lang: AppLang = "pl"): Promise<void> {
  await waitFor(() => expect(h.fetchReport).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(h.fetchReport.mock.results.map((r) => r.value));
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: common("refresh", lang) })).toBeEnabled(),
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.charts.length = 0;
  h.tenantId = TENANT_A;
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
  it("w trakcie pobierania panel melduje POMIAR i nie ma ani jednego stacka", async () => {
    // Komunikat stoi RAZ, w karcie stanu nad kafelkami, i mówi „trwa pomiar" -
    // nie „brak błędów". Lista grup nie dopisuje do niego drugiego napisu ani
    // nie renderuje wiersza, więc żaden stack nie ma jak wejść do DOM.
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    const { container } = panel();

    expect(await screen.findByText(common("measuring"))).toBeInTheDocument();
    expect(screen.getByText(common("measuringHint"))).toBeInTheDocument();
    expect(screen.queryByText(ce("empty"))).toBeNull();
    expect(groupRows()).toHaveLength(0);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("w trakcie pobierania przycisk odświeżania jest zablokowany", async () => {
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    panel();

    const btn = await screen.findByRole("button", { name: common("refresh") });
    expect(btn).toBeDisabled();
  });

  it("w trakcie pobierania kafelki NIE meldują zera - pomiaru jeszcze nie było", async () => {
    // `(report?.windowTotal ?? 0).toLocaleString(locale)` nie odróżniało "nie
    // wiem" od "nie było": cztery kafelki malowały zero, zanim cokolwiek
    // policzono. Zero na pulpicie BŁĘDÓW czyta się jako twierdzenie o zdrowiu
    // aplikacji, więc dopóki pomiar się nie odbył, kafelek pokazuje kreskę, a
    // powód stoi obok w karcie stanu.
    h.fetchReport.mockImplementation(() => new Promise<ClientErrorsReport>(() => {}));
    panel();
    await screen.findByText(common("measuring"));

    const shown = [
      kpiValue(ce("kpiTotal")),
      kpiValue(ce("kpiGroups")),
      kpiValue(ce("kpiPaths")),
      kpiValue(ce("kpiLast24h")),
    ];
    expect(shown).not.toEqual(["0", "0", "0", "0"]);
    // Zapadka na konkretny zamiennik: kreska jest znakiem, nie napisem, więc
    // nie wymaga klucza i18n, ale musi być JEDNA dla wszystkich czterech -
    // inaczej operator zgaduje, który kafelek jest pomiarem, a który brakiem.
    expect(shown).toEqual(["-", "-", "-", "-"]);
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

  it("odmowa dostępu melduje się jako AWARIA ODCZYTU, z przyczyną", async () => {
    // `reportQuery.isError` i `.error` nie były w panelu czytane ani raz, a
    // server function RZUCA przy braku roli admina i przy padniętym
    // uwierzytelnieniu (degraduje do pustego raportu tylko brak tabeli). Panel
    // malował wtedy "Brak błędów w wybranym oknie. To dobrze - beacony (...)
    // trafiają tu automatycznie", czyli ZAPEWNIAŁ, że telemetria działa, w
    // sytuacji, w której odczyt został odrzucony. Teraz odmowa idzie własną
    // gałęzią: komunikat pustego okna nie ma prawa się pokazać, a przyczyna
    // ("Forbidden: admin role required") musi dojść do operatora dosłownie -
    // to jedyna informacja, z którą może cokolwiek zrobić.
    h.fetchReport.mockRejectedValue(new Error("Forbidden: admin role required"));
    const { container } = panel();
    await loaded();

    expect(screen.queryByText(ce("empty"))).toBeNull();
    expect(container.textContent ?? "").toMatch(/Forbidden|b[lł][aą]d|error/i);
    // Napis przychodzi ZE SŁOWNIKA, nie z literału w JSX - podpowiedź obok
    // przyczyny nie ma zmiennych, więc nadaje się na wartownika klucza.
    expect(screen.getByText(common("readFailedHint"))).toBeInTheDocument();
    // Awaria jest OGŁASZANA, nie tylko wypisana: bez `role="alert"` operator
    // patrzący na kafelki nie dowiaduje się, że pomiaru nie było.
    expect(screen.getByRole("alert")).toHaveTextContent("Forbidden: admin role required");
    // I ta sama zasada co przy pomiarze w toku: kafelek nie maluje zera.
    expect(kpiValue(ce("kpiTotal"))).not.toBe("0");
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
    expect(rows.map((r) => rowMessage(r))).toEqual(BUSY.groups.map((g) => g.message));
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
    // `title` pola „Komunikat" to komunikat, nie stack - inaczej cała treść
    // wyjechałaby w podpowiedzi przeglądarki.
    expect(rowField(row, "colMessage").getAttribute("title")).toBe("Loading chunk 7 failed");
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

  it("klucz cache niesie WARSZTAT, więc to samo okno nie oznacza wspólnego raportu", async () => {
    // `queryKey: ["admin","client-errors", sinceIso, untilIso]` nie zawierał
    // ani tenanta, ani użytkownika. Izolację trzymał wtedy WYŁĄCZNIE znacznik
    // czasu: `buildPresetRange("7d")` woła `Date.now()` przy montowaniu, więc
    // dwa montowania prawie zawsze dawały różne granice. "Prawie" nie jest
    // gwarancją - zamrożony zegar modeluje przełączenie warsztatu w tej samej
    // klatce (a także dwa pulpity liczące to samo okno), i przy
    // `staleTime: 60_000` react-query NIE ponawiał zapytania. Administrator
    // warsztatu B czytał wtedy komunikaty i stacki warsztatu A, i nie leciało
    // przy tym ani jedno żądanie sieciowe - wyciek był CICHY, niewidoczny w
    // ruchu, widoczny tylko na ekranie.
    //
    // Odtąd klucz niesie najemcę, a zapytanie czeka na jego rozwiązanie
    // (`enabled`), więc przejście warsztatu jest zawsze INNYM wpisem cache.
    // Przejście odgrywamy tak, jak wygląda w aplikacji: zmienia się najemca
    // (`h.tenantId`) ORAZ to, co bramka oddaje dla niego.
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(Date.parse("2026-08-20T10:00:00.000Z"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.fetchReport.mockResolvedValue(WORKSPACE_A);
    const first = panel(client);
    await loaded();
    expect(first.container.textContent ?? "").toContain("ALFA: chunk 12 failed");
    first.unmount();

    h.tenantId = TENANT_B;
    h.fetchReport.mockResolvedValue(WORKSPACE_B);
    const second = panel(client);
    await loaded();

    expect(second.container.textContent ?? "").not.toContain("ALFA");
    // ...i nie chodzi o pustą kartę: własne dane warsztatu B dojeżdżają, a po
    // nie poleciało OSOBNE żądanie, mimo identycznych granic okna.
    expect(second.container.textContent ?? "").toContain("BETA: hydration mismatch");
    expect(h.fetchReport.mock.calls.length).toBe(2);
    expect(queryInputs()[0]).toEqual(queryInputs()[1]);
  });
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

  it("wypełniony panel z rozwiniętą grupą nie ma ŻADNEGO naruszenia axe", async () => {
    // BEZ ULG. Do 2026-09-02 stała tu wyłączona reguła `button-name`: jedynym
    // naruszeniem w tym poddrzewie był wtedy wyzwalacz menu eksportu w
    // `ChartCard` (sama ikona `MoreHorizontal` bez `aria-label`), czyli dług
    // prymitywu, nie tego panelu. Prymitywowi go naprawiono, a wiersz grupy ma
    // odtąd wyzwalacz z jawną nazwą, więc ulga nie miała już czego obchodzić -
    // zdjęcie jej jest zaostrzeniem zapadki, nie luzowaniem: własny bezimienny
    // przycisk tego pulpitu oblewa test natychmiast.
    const { container } = panel();
    await loaded();
    fireEvent.click(rowToggle(groupRows()[0]));

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("panel bez błędów nie ma naruszeń axe", async () => {
    h.fetchReport.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("karta awarii odczytu nie ma naruszeń axe", async () => {
    // Karta stanu jest NOWĄ powierzchnią z rolą (`role="alert"`), więc wchodzi
    // pod axe tak samo jak lista grup - inaczej gałąź, która powstała po to,
    // żeby operator dowiedział się o odmowie dostępu, byłaby jedyną
    // niesprawdzoną.
    h.fetchReport.mockRejectedValue(new Error("Forbidden: admin role required"));
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("panel zwinięty nie ma naruszeń axe - i żadna reguła nie jest tu wyłączana", async () => {
    // TEN PRZYPADEK ZMIENIŁ TREŚĆ DWA RAZY, bo dwa razy zmienił się stan
    // faktyczny, i oba razy są warte zapisania. Najpierw asercja brzmiała
    // „cały dług dostępności panelu to JEDEN przycisk, i to nie jego własny":
    // bez wyłączonej reguły lista naruszeń miała dokładnie jedną pozycję i był
    // nią bezimienny wyzwalacz menu eksportu w `ChartCard`. Ten dług naprawiono
    // w prymitywie, więc asercja opisująca go przestała opisywać cokolwiek -
    // utrzymywanie jej znaczyłoby wymaganie, żeby naruszenie ISTNIAŁO. Potem
    // ulgę na `button-name` zdjęto także w dwóch przypadkach wyżej, bo wiersz
    // grupy dostał semantykę i jawną nazwę wyzwalacza.
    //
    // Rola tego przypadku jest odtąd taka: mierzy panel ZWINIĘTY, czyli stan,
    // w którym na ekranie stoi cała lista grup i ani jednego rozwinięcia -
    // i robi to na liście identyfikatorów, więc komunikat porażki nazywa
    // regułę, a nie wypisuje węzły.
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual([]);
  });

  it("lista grup jest listą - kolejność niesie znaczenie dla czytnika ekranu", async () => {
    panel();
    await loaded();

    const list = groupsCard().querySelector("ul");
    expect(list).not.toBeNull();
    expect(Array.from(list?.children ?? []).every((li) => li.tagName === "LI")).toBe(true);
  });

  it("wartownik: pierwszy wiersz BUSY naprawdę wystawia plakietkę źródła", async () => {
    // Przypadek o dojściu do źródeł szuka NOŚNIKA etykiety "promise" i wnioskuje
    // z tego, gdzie ta etykieta leży. Warunek wstępny - że fixtura w ogóle taką
    // etykietę wystawia - stoi więc OSOBNO, w tym wartowniku: gdyby `BUSY`
    // przestało dawać źródło `unhandledrejection`, tamten przypadek mówiłby o
    // pustym zbiorze nośników, a ten oblewa się od razu i wskazuje fixturę.
    panel();
    await loaded();

    expect(rowSources(groupRows()[0])).toContain(ce("sourceLabels.unhandledrejection"));
  });

  it("wiersz grupy wiąże KAŻDĄ wartość z nazwą pola", async () => {
    // Wiersz grupy (`ErrorGroupRow`) był `<button>`-em z płaską siatką
    // `<span>`-ów: komunikat, liczba wystąpień, pasek udziału z procentem,
    // plakietki źródeł. Ani jednego `role`, ani jednej pary `<dt>`/`<dd>`, zero
    // `aria-label` i `aria-labelledby` w całym poddrzewie (zmierzone: 0
    // elementów). Dostępna nazwa przycisku była składana z TREŚCI i wychodziła
    // jednym ciągiem - "Loading chunk 7 failed 3 50% onerror promise" - więc
    // czytnik ekranu ogłaszał "trzy" i "pięćdziesiąt procent" bez informacji,
    // CZEGO te liczby są. `title` przycisku niósł tylko "Pokaż szczegóły" i dla
    // nazwy przegrywał z treścią, a `title` na komunikacie powtarzał wartość
    // pola, nie jego nazwę.
    //
    // PILNOWANY KONTRAKT: WCAG 2.2 SC 1.3.1 Info and Relationships (poziom A).
    // Relacja nazwa-wartość była w tym wierszu obecna WIZUALNIE - kolumny
    // siatki, wyrównanie, znak procentu - i nieobecna PROGRAMOWO. Odtąd wiersz
    // jest listą definicji: `<dt>` ze słownika (`colMessage`, `colCount`,
    // `colShare`, `colSources`) plus `<dd>` z wartością, a wyzwalacz stoi
    // OBOK danych (rozciągnięty na cały wiersz), nie wokół nich - bo drzewo
    // dostępności spłaszcza wnętrze przycisku do jednego napisu i pary schowane
    // w środku nie dotarłyby do czytnika ekranu.
    //
    // DLACZEGO AXE-CORE TEGO NIE ŁAPIŁ, i dlaczego jego zieleń nie była z tym
    // defektem sprzeczna: axe bada POPRAWNOŚĆ zadeklarowanej semantyki, nie
    // jej OBECNOŚĆ. `aria-required-children` i `aria-required-parent` odpalają
    // wyłącznie wtedy, gdy jakiś `role` już jest - tam nie było żadnego, więc
    // nie było czego weryfikować. `button-name` przechodziło, bo przycisk MIAŁ
    // nazwę; to, że była nierozdzielną sklejką czterech pól, nie narusza żadnej
    // reguły. Przypadki axe w tej sekcji były zielone i takie zostają: dowodzą,
    // że panel nie deklaruje niczego BŁĘDNIE. Brak modelu semantycznego jest
    // dla narzędzia automatycznego niewidzialny - to luka klasy "brak", a nie
    // "błąd", i dlatego pilnuje jej ta asercja, a nie axe.
    //
    // SKUTEK DLA ASERCJI CAŁEGO PLIKU: `rowMessage`, `rowCount`, `rowShare` i
    // `rowSources` przestały celować w utility Tailwinda (`font-mono`,
    // `justify-self-end`, `w-9`, `hidden`) i idą po nazwie pola. Kilkanaście
    // asercji - kolejność wierszy, udziały 67/33, tłumaczenia źródeł, formaty
    // en-GB - nie wisi już na wyrównaniu i szerokości kolumny, a zniknięcie
    // nazwy pola oblewa je wszystkie naraz.
    panel();
    await loaded();

    const row = groupRows()[0];
    const fields = rowFieldElements(row);

    expect(fields.map((field) => fieldHasNameRelation(field))).toEqual([true, true, true]);
    // Nazwa jest POWIĄZANA Z TĄ wartością, nie z sąsiednią.
    expect(rowField(row, "colCount").textContent).toBe("3");
    expect(rowField(row, "colShare").textContent).toBe("50%");
    // Wyzwalacz IDENTYFIKUJE wiersz nazwą nadaną JAWNIE, więc trzy przyciski
    // listy nie nazywają się tak samo i żaden nie jest sklejką wartości.
    expect(explicitAriaName(rowToggle(row))).toContain("Loading chunk 7 failed");
  });

  it("źródła błędu mają dojście niezależne od szerokości ekranu", async () => {
    // Plakietki źródeł siedziały w `<span className="hidden items-center gap-1
    // sm:flex">`. `hidden` to `display:none`, a `sm:flex` odwraca to dopiero od
    // 640 px: poniżej tej szerokości źródła BYŁY w DOM, ale wypadały z drzewa
    // dostępności, a więc i z dostępnej nazwy przycisku - ta była składana z
    // treści, `aria-label` nie było, `title` niósł tylko "Pokaż szczegóły". Na
    // telefonie czytnik ekranu ogłaszał "Loading chunk 7 failed 3 50%" i nie
    // było ŻADNEJ drogi do informacji, że błąd przyszedł z `onerror` i z
    // odrzuconej obietnicy. To nie ozdoba: źródło rozstrzyga, czy patrzymy na
    // błąd skryptu, czy na nieobsłużone odrzucenie - czyli gdzie szukać
    // przyczyny. Odtąd pole „Źródła" ZAWIJA SIĘ do kolejnego wiersza siatki
    // zamiast gasnąć, więc treść zostaje na każdej szerokości - i dla oka, i
    // dla czytnika ekranu.
    //
    // PILNOWANY KONTRAKT: WCAG 2.2 SC 1.4.10 Reflow (poziom AA) - przy 320 px
    // szerokości treść nie może ginąć bez zamiennika. Wtórnie znów SC 1.3.1: ta
    // sama informacja nie może być programowo dostępna na szerokim ekranie i
    // niedostępna na wąskim, bo wtedy model nie odwzorowuje treści.
    //
    // DLACZEGO AXE-CORE TEGO NIE ŁAPIE - dwa powody, oba twarde. (1) W tym
    // środowisku `hidden` NIE DZIAŁA: happy-dom nie wczytuje arkusza Tailwinda
    // i nie ma silnika layoutu, więc `getComputedStyle(kontener).display` jest
    // pustym napisem (zmierzone), axe widział plakietki jako widoczne i wliczał
    // je do nazwy. (2) Nawet w prawdziwej przeglądarce axe bada JEDEN stan
    // drzewa - ten przy aktualnej szerokości - i nie ma reguły "treść nie może
    // zniknąć między breakpointami". Zieleń przypadków axe w tej sekcji jest
    // więc prawdziwa i była niesprzeczna z tym defektem: mierzy poprawność
    // tego, co widać przy szerokości testowej, a nie zachowanie modelu przy
    // 320 px. Ta sama nieobecność CSS-a jest powodem, dla którego asercja pyta
    // `hiddenBelowSm` o LISTĘ KLAS, a nie o `display`.
    //
    // Asercja przyjmuje KAŻDE wyjście: plakietkę poza kontenerem gaszonym
    // poniżej `sm` (zwijanie zamiast ukrywania, kopia `sr-only`) albo jawną
    // nazwę przycisku niosącą źródła. Powrót do `hidden ... sm:flex` bez
    // żadnego z tych zamienników oblewa ją natychmiast.
    panel();
    await loaded();

    const row = groupRows()[0];
    const label = ce("sourceLabels.unhandledrejection");
    const carriers = Array.from(row.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && (el.textContent ?? "").trim() === label,
    );
    const reachableOnNarrow = carriers.some((el) => !hiddenBelowSm(el, row));
    const nameCarriesSource = explicitAriaName(rowToggle(row)).includes(label);

    expect(reachableOnNarrow || nameCarriesSource).toBe(true);
    // Źródła są PEŁNOPRAWNYM polem wiersza, a nie ozdobą przy nim - więc mają
    // nazwę na tych samych zasadach co komunikat, liczność i udział.
    expect(fieldHasNameRelation(rowField(row, "colSources"))).toBe(true);
  });
});
