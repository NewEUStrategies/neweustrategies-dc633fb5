// Organizmy warstwy semantycznej: słownik metryk i panel uzgodnienia liczb.
// Pierwszy test obu - `SemanticReconciliationPanel` stał na zerze (0/27 linii,
// 0/14 funkcji), a to on jest wejściem całej warstwy do panelu admina.
//
// PO CO. Panel jest miejscem, w którym sześć strumieni o sześciu różnych
// definicjach „odsłony” zamienia się w JEDNĄ liczbę do raportu zarządczego.
// Reguły liczenia mają własne, pełne pokrycie; tutaj przedmiotem dowodu jest to,
// czego tamte testy nie widzą, a co decyduje o zaufaniu do panelu:
//
//   1. KOLEJNOŚĆ SEKCJI I WIERSZY. Okno pomiaru stoi PRZED liczbami, bo bez
//      granic okna żadna liczba nie ma sensu. Wiersze wymagające decyzji
//      (`divergent`, `order_inverted`) idą na górę - `orderedEntries` sortuje
//      je jawnie, a sortowanie jest ciche: przestawiony znak porównania nie
//      wywraca ekranu, tylko chowa rozjazd pod dwudziestoma spokojnymi wierszami.
//   2. ROZRÓŻNIENIE STANÓW. „Ładowanie”, „brak migawki” i „migawka z zerami”
//      to TRZY różne komunikaty, a wszystkie trzy da się pomylić z jednym:
//      zerami w kafelkach. Panel ma dla nich osobne gałęzie i test pilnuje,
//      żeby żadna nie udawała pomiaru.
//   3. POCHODZENIE OKNA. Panel pokazuje okno OPTYMISTYCZNE (ten sam resolwer
//      po stronie klienta) w trakcie ładowania, a po odpowiedzi - okno
//      SERWERA. Gdyby nagłówek został przy oknie optymistycznym, liczby
//      pochodziłyby z innego przedziału niż podpis pod nimi.
//   4. OKABLOWANIE PRESETU. Zmiana okna ma zmienić WEJŚCIE funkcji serwerowej,
//      nie samo renderowanie - dlatego asercje idą na argument wywołania.
//   5. IZOLACJA WARSZTATÓW. Migawkę liczy `getSemanticSnapshot`, który bierze
//      `tenant_id` z profilu wywołującego, NIE z parametru ani z nagłówka
//      hosta. Klient nie ma prawa podać warsztatu - test dowodzi tego na
//      kształcie argumentu - a dane jednego warsztatu nie mają prawa pojawić
//      się w panelu drugiego.
//   6. METRYKI ZŁOŻONE. `null` z `safeRatio` znaczy „nie ma podstawy do
//      wyliczenia”, nie „0 %”. Panel musi pokazać powód, nie zero.
//
// `getSemanticSnapshot` jest ATRAPOWANY (ma własny, pełny test serwerowy):
// tutaj interesuje nas wyłącznie to, co panel z jego odpowiedzią robi.
// `useServerFn` staje się tożsamością, a mock `@tanstack/react-start` jest
// CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu `createIsomorphicFn`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  SemanticDelta,
  SemanticRatio,
  SemanticSnapshotResult,
  SemanticStreamHealth,
  SemanticWindowDto,
} from "@/lib/analytics/semantic/snapshot.functions";
import {
  METRICS,
  STREAMS,
  metricById,
  reconcileMetric,
  resolveWindow,
  streamById,
  type CanonicalWindow,
  type MetricId,
  type ReconciliationEntry,
  type StreamObservation,
} from "@/lib/analytics/semantic";

const h = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  /** Warsztat, w którym stoi panel - zmiana tej wartości to przejście do innego. */
  tenantId: "tenant-alfa" as string | null,
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

// Najemca jest ATRAPĄ, a nie prawdziwym `useCurrentTenantId`: tamten ciągnie
// klienta Supabase i sesję `useAuth`, a przedmiotem dowodu jest tylko to, że
// identyfikator warsztatu WCHODZI DO KLUCZA react-query (do funkcji serwerowej
// NIE JEDZIE - ta bierze warsztat z profilu wywołującego). Sterowanie nim z
// testu (`h.tenantId`) daje jedyny sposób odegrania przejścia między
// warsztatami na TYM SAMYM kliencie cache - tak samo jak w
// `__tests__/gscBiDashboard.test.tsx`.
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

vi.mock("@/lib/analytics/semantic/snapshot.functions", () => ({
  getSemanticSnapshot: (...args: unknown[]) => h.fetchSnapshot(...args),
}));

// `react-i18next` NIE JEST atrapowany: panel jest dwujęzyczny, a przedmiotem
// dowodu jest to, że napisy przychodzą ZE SŁOWNIKA (patrz `src/test/i18nReal.ts`).
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-analytics";
import "@/lib/i18n-admin-semantic";
import { MetricDictionary } from "../organisms/MetricDictionary";
import { SemanticReconciliationPanel } from "../organisms/SemanticReconciliationPanel";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

const NOW_A = Date.parse("2026-07-15T14:37:00.000Z");
const NOW_B = Date.parse("2026-03-10T09:12:00.000Z");
const TENANT_A = "tenant-alfa";
const TENANT_B = "tenant-beta";
/** Komunikat błędu GA4 - taki, jaki serwer podaje adminowi wprost. */
const GA4_ERROR = "GA4: brak uprawnien do property 123456";

function windowDto(w: CanonicalWindow): SemanticWindowDto {
  return {
    presetId: w.presetId,
    sinceIso: w.sinceIso,
    untilIso: w.untilIso,
    days: w.days,
    grain: w.grain,
    crossStreamSafe: w.crossStreamSafe,
    notes: w.notes,
    ga4: w.ga4,
  };
}

function obs(streamId: StreamObservation["streamId"], value: number | null): StreamObservation {
  return { streamId, value };
}

/** Uzgodnienie policzone PRAWDZIWYMI regułami - werdykt nie jest wpisany ręcznie. */
function entry(
  metricId: MetricId,
  observations: readonly StreamObservation[],
  window: CanonicalWindow,
): ReconciliationEntry {
  return reconcileMetric(metricId, observations, { window });
}

interface SnapshotOverrides {
  readonly nowMs?: number;
  readonly pageViews?: number;
  readonly firstPartyPageViews?: number;
  readonly entries?: readonly ReconciliationEntry[];
  readonly deltas?: readonly SemanticDelta[];
  readonly ratios?: readonly SemanticRatio[];
  readonly streams?: readonly SemanticStreamHealth[];
  readonly ga4Configured?: boolean;
  readonly ga4Error?: string;
  readonly includeOpenDay?: boolean;
}

/**
 * Migawka warsztatu. Domyślnie: rozjazd na odsłonach (wymaga decyzji), dryf
 * oczekiwany na sesjach, luka na użytkownikach i jedno źródło na klikach CTA -
 * czyli po jednym wierszu na każdą gałąź prezentacji.
 */
function snapshot(over: SnapshotOverrides = {}): SemanticSnapshotResult {
  const nowMs = over.nowMs ?? NOW_A;
  const current = resolveWindow({
    presetId: "28d",
    nowMs,
    includeOpenDay: over.includeOpenDay ?? false,
  });
  const previous = resolveWindow({ presetId: "28d", nowMs: nowMs - 28 * 86_400_000 });
  const ga4Views = over.pageViews ?? 12_345;
  const fpViews = over.firstPartyPageViews ?? 24_690;

  return {
    window: windowDto(current),
    previous: { sinceIso: previous.sinceIso, untilIso: previous.untilIso },
    entries: over.entries ?? [
      // Spokojny wiersz stoi PIERWSZY w odpowiedzi - panel ma go zejść niżej.
      entry("sessions", [obs("ga4", 1000), obs("first_party", 1100)], current),
      entry("visitors", [obs("ga4", null), obs("first_party", 500)], current),
      entry("page_views", [obs("ga4", ga4Views), obs("first_party", fpViews)], current),
      entry("cta_clicks", [obs("first_party", 4200)], current),
    ],
    deltas: over.deltas ?? [
      { metricId: "sessions", current: 1000, previous: 889, deltaPct: 12.5 },
      { metricId: "page_views", current: ga4Views, previous: ga4Views + 500, deltaPct: -4.2 },
    ],
    ratios: over.ratios ?? [
      { metricId: "ad_ctr", value: 0.037 },
      { metricId: "email_ctr", value: null, reason: "denominator is zero or unavailable" },
    ],
    streams:
      over.streams ??
      STREAMS.map((s) =>
        s.id === "ga4" || s.id === "first_party"
          ? { streamId: s.id, available: true }
          : { streamId: s.id, available: false, reason: "no_data" as const },
      ),
    ga4Configured: over.ga4Configured ?? true,
    ...(over.ga4Error ? { ga4Error: over.ga4Error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

/** Tłumacz przypięty do języka, który instancja i18next ma W TEJ CHWILI. */
function tNow() {
  return realT(i18n.language?.toLowerCase().startsWith("en") ? "en" : "pl");
}

function panel(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <SemanticReconciliationPanel />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/** Czeka, aż migawka dojdzie i zniknie wskaźnik ładowania. */
async function loaded(): Promise<void> {
  await waitFor(() => expect(h.fetchSnapshot.mock.calls.length).toBeGreaterThanOrEqual(1));
  await waitFor(() =>
    expect(screen.queryByText(tNow()("adminAnalytics.common.loadingData"))).toBeNull(),
  );
  await screen.findByText(tNow()("adminAnalytics.semantic.canonicalLabel"));
}

/** Karta panelu rozpoznana po swoim nagłówku. */
function cardOf(headingText: string): HTMLElement {
  const card = screen.getByText(headingText).closest("div.rounded-xl");
  if (!(card instanceof HTMLElement)) throw new Error(`test: brak karty „${headingText}”`);
  return card;
}

/** Nazwy metryk w kolejności, w jakiej panel ułożył wiersze uzgodnienia. */
function canonicalRowLabels(): string[] {
  const list = cardOf(tNow()("adminAnalytics.semantic.canonicalLabel")).querySelector("ul");
  if (!list) throw new Error("test: karta wartości kanonicznych nie ma listy wierszy");
  return Array.from(list.children).map((li) => li.querySelector("span")?.textContent ?? "");
}

/** Kafelek metryki złożonej wraz z jego wartością. */
function ratioTile(metricId: MetricId): HTMLElement {
  const label = metricById(metricId);
  const isEn = i18n.language?.toLowerCase().startsWith("en");
  const tile = screen.getByText(isEn ? label.labelEn : label.labelPl).closest("li");
  if (!tile) throw new Error(`test: brak kafelka metryki złożonej ${metricId}`);
  return tile;
}

/** Argumenty `data` przekazane funkcji serwerowej. */
function snapshotInputs(): Array<Record<string, unknown>> {
  return h.fetchSnapshot.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
}

/** Otwiera listę Radiksa klawiaturą - pointer events nie działają w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.tenantId = TENANT_A;
  h.fetchSnapshot.mockReset();
  h.fetchSnapshot.mockResolvedValue(snapshot());
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("MetricDictionary - słownik metryk kanonicznych", () => {
  it("jest PRAWDZIWĄ tabelą z czterema nagłówkami kolumn ze słownika", () => {
    const t = realT("pl");
    render(<MetricDictionary />);

    // Tabela, nie siatka `div`-ów: czytnik ekranu musi móc powiązać komórkę z
    // nagłówkiem kolumny, inaczej „Definicja” i „Czego nie wolno” zlewają się.
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      t("adminAnalytics.semantic.dictionary.colMetric"),
      t("adminAnalytics.semantic.dictionary.colDefinition"),
      t("adminAnalytics.semantic.dictionary.colSource"),
      t("adminAnalytics.semantic.dictionary.colGuards"),
    ]);
  });

  it("ma dokładnie jeden wiersz na metrykę rejestru, w kolejności rejestru", () => {
    render(<MetricDictionary />);

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(METRICS.length);
    expect(rows.map((r) => r.querySelector("th")?.querySelector("span")?.textContent)).toEqual(
      METRICS.map((m) => m.labelPl),
    );
  });

  it("nazwa metryki jest nagłówkiem WIERSZA i niesie jednostkę", () => {
    const t = realT("pl");
    render(<MetricDictionary />);

    const rowHeaders = within(screen.getByRole("table")).getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(METRICS.length);
    for (const metric of METRICS) {
      const header = rowHeaders.find((th) => (th.textContent ?? "").startsWith(metric.labelPl));
      expect(header?.textContent).toContain(
        t(`adminAnalytics.semantic.dictionary.unit.${metric.unit}`),
      );
    }
  });

  it("pokazuje wzór STRUMIENIA AUTORYTATYWNEGO, nie pierwszego z listy powiązań", () => {
    render(<MetricDictionary />);

    // Raport cytuje wyłącznie źródło autorytatywne - słownik musi pokazać JEGO
    // wzór, inaczej czytelnik przepisze wzór strumienia potwierdzającego.
    const sessions = metricById("sessions");
    const authoritative = sessions.bindings.find((b) => b.role === "authoritative");
    const corroborating = sessions.bindings.find((b) => b.role === "corroborating");
    const row = screen.getByText(sessions.labelPl).closest("tr");
    if (!row) throw new Error("test: brak wiersza metryki „Sesje”");

    expect(row.querySelector("code")?.textContent).toBe(authoritative?.formula);
    expect(row.querySelector("code")?.textContent).not.toBe(corroborating?.formula);
  });

  it("kolumna źródła wymienia WSZYSTKIE strumienie metryki i bramkę autorytatywnego", () => {
    const t = realT("pl");
    render(<MetricDictionary />);

    const sessions = metricById("sessions");
    const row = screen.getByText(sessions.labelPl).closest("tr");
    if (!row) throw new Error("test: brak wiersza metryki „Sesje”");

    for (const binding of sessions.bindings) {
      expect(row.textContent).toContain(streamById(binding.streamId).labelPl);
    }
    expect(row.textContent).toContain(
      t(`adminAnalytics.semantic.consentGate.${streamById("ga4").consentGate}`),
    );
  });

  it("definicja i lista „czego nie wolno” jadą z rejestru dla każdej metryki", () => {
    render(<MetricDictionary />);

    const table = screen.getByRole("table");
    for (const metric of METRICS) {
      expect(within(table).getByText(metric.definitionPl)).toBeInTheDocument();
      for (const guard of metric.guards) {
        expect(within(table).getByText(guard)).toBeInTheDocument();
      }
    }
  });

  it("w EN etykiety i definicje są angielskie, bez polskiej awaryjnej treści", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const { container } = render(<MetricDictionary />);

    expect(container.textContent).toContain(en("adminAnalytics.semantic.dictionary.title"));
    expect(container.textContent).toContain(metricById("sessions").labelEn);
    expect(container.textContent).toContain(metricById("sessions").definitionEn);
    expect(container.textContent).not.toContain(metricById("sessions").definitionPl);
  });

  it("tabela przewija się we WŁASNYM kontenerze, więc strona nie dostaje paska", () => {
    render(<MetricDictionary />);

    // Szeroka tabela w panelu admina bez własnego przewijania zmusza całą
    // stronę do przewijania w poziomie - na telefonie to psuje każdy inny panel.
    const wrapper = screen.getByRole("table").parentElement;
    expect(wrapper?.className).toContain("overflow-x-auto");
  });

  it("słownik jest wolny od naruszeń axe", async () => {
    const { container } = render(<MetricDictionary />);

    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("SemanticReconciliationPanel - stany odczytu", () => {
  it("w trakcie pobierania pokazuje wskaźnik ładowania ze słownika", async () => {
    h.fetchSnapshot.mockImplementation(() => new Promise<SemanticSnapshotResult>(() => {}));
    panel();

    expect(
      await screen.findByText(realT("pl")("adminAnalytics.common.loadingData")),
    ).toBeInTheDocument();
    // Ładowanie NIE MOŻE udawać pomiaru - żadnej wartości kanonicznej.
    expect(screen.queryByText(realT("pl")("adminAnalytics.semantic.canonicalLabel"))).toBeNull();
  });

  it("okno pomiaru jest widoczne JUŻ w trakcie ładowania, z tego samego resolwera", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockImplementation(() => new Promise<SemanticSnapshotResult>(() => {}));
    const optimistic = resolveWindow({ presetId: "28d" });
    const { container } = panel();

    await screen.findByText(t("adminAnalytics.common.loadingData"));
    // Nagłówek nie „skacze” po dojściu odpowiedzi, bo klient liczy to samo okno.
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.window.range", {
        since: optimistic.sinceIso.slice(0, 10),
        until: optimistic.untilIso.slice(0, 10),
      }),
    );
  });

  it("brak migawki to komunikat, nie siatka zer", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockRejectedValue(new Error("RPC padł"));
    const { container } = panel();

    expect(await screen.findByText(t("adminAnalytics.semantic.empty"))).toBeInTheDocument();
    expect(container.textContent).not.toContain(t("adminAnalytics.semantic.canonicalLabel"));
    expect(container.textContent).not.toContain(t("adminAnalytics.semantic.ratios.title"));
  });

  it("po dojściu migawki nagłówek pokazuje okno SERWERA, nie okno optymistyczne", async () => {
    const t = realT("pl");
    // Serwer oddaje okno z INNEGO momentu niż „teraz” klienta: podpis pod
    // liczbami musi opisywać przedział, z którego te liczby pochodzą.
    const server = snapshot({ nowMs: NOW_B });
    h.fetchSnapshot.mockResolvedValue(server);
    const { container } = panel();
    await loaded();

    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.window.range", {
        since: server.window.sinceIso.slice(0, 10),
        until: server.window.untilIso.slice(0, 10),
      }),
    );
    expect(container.textContent).toContain(
      t("adminAnalytics.semantic.window.ga4Range", {
        start: server.window.ga4.startDate,
        end: server.window.ga4.endDate,
      }),
    );
    // Okno poprzednie jest ROZŁĄCZNE z bieżącym i też jest podpisane.
    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.previous"));
    expect(container.textContent).toContain(server.previous.sinceIso.slice(0, 10));
  });

  it("błąd GA4 jest pokazany adminowi, a nie połknięty", async () => {
    h.fetchSnapshot.mockResolvedValue(snapshot({ ga4Error: GA4_ERROR }));
    panel();
    await loaded();

    const message = await screen.findByText(GA4_ERROR);
    expect(message).toBeInTheDocument();
    // Komunikat stoi przy wartościach kanonicznych i jest pomalowany na
    // destrukcyjnie - to nie jest nota informacyjna, to zerwany odczyt.
    expect(message.className).toContain("text-destructive");
  });

  it("migawka bez błędu GA4 nie rysuje komunikatu o błędzie", async () => {
    panel();
    await loaded();

    // Brak `ga4Error` w odpowiedzi znaczy, że odczyt się udał - panel nie może
    // wyświetlać wtedy ani pustego komunikatu, ani zapamiętanego poprzedniego.
    expect(screen.queryByText(GA4_ERROR)).toBeNull();
  });
});

describe("SemanticReconciliationPanel - kolejność i treść liczb", () => {
  it("wiersze wymagające decyzji idą na GÓRĘ, mimo innej kolejności w odpowiedzi", async () => {
    const server = snapshot();
    h.fetchSnapshot.mockResolvedValue(server);
    panel();
    await loaded();

    const divergent = server.entries.find((e) => e.verdict === "divergent");
    expect(divergent?.metricId).toBe("page_views");
    // W odpowiedzi „Odsłony stron” są TRZECIE - na ekranie muszą być pierwsze,
    // bo tylko one wymagają reakcji człowieka.
    expect(canonicalRowLabels()[0]).toBe(metricById("page_views").labelPl);
    expect(canonicalRowLabels()).toHaveLength(server.entries.length);
  });

  it("każdy wiersz niesie werdykt i wartość, a luka mówi „brak danych”", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockResolvedValue(snapshot());
    panel();
    await loaded();

    const card = cardOf(t("adminAnalytics.semantic.canonicalLabel"));
    expect(card.textContent).toContain(t("adminAnalytics.semantic.verdict.divergent"));
    expect(card.textContent).toContain(t("adminAnalytics.semantic.verdict.expected_drift"));
    expect(card.textContent).toContain(t("adminAnalytics.semantic.verdict.single_source"));
    expect(card.textContent).toContain(t("adminAnalytics.semantic.verdict.unavailable"));
    // Metryka bez wartości autorytatywnej nie dostaje zera.
    expect(card.textContent).toContain(t("adminAnalytics.semantic.noValue"));
  });

  it("zmiana wobec okna poprzedniego trafia do wiersza właściwej metryki", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const card = cardOf(t("adminAnalytics.semantic.canonicalLabel"));
    const deltaTitle = t("adminAnalytics.semantic.deltaVsPrevious");

    // Delta czytana Z WIERSZA konkretnej metryki, nie z całej karty. Agregat po
    // karcie („jest jedna dodatnia i jedna ujemna”) przechodzi także wtedy, gdy
    // panel przypnie deltę sesji do odsłon i odwrotnie - a to jest właśnie ten
    // błąd, który przekłamuje raport zarządczy, nie zaś brak delty.
    const deltaOf = (metricId: MetricId): string | null => {
      const label = metricById(metricId).labelPl;
      const row = Array.from(card.querySelector("ul")?.children ?? []).find(
        (r) => r.querySelector("span")?.textContent === label,
      );
      if (!row) throw new Error(`test: brak wiersza metryki ${metricId}`);
      return row.querySelector(`[title="${deltaTitle}"]`)?.textContent ?? null;
    };

    // Migawka daje sesjom +12,5 %, a odsłonom -4,2 % - wartości RÓŻNE i RÓŻNEGO
    // ZNAKU, więc odwrócenie parowania metryka-delta wywraca oba te odczyty.
    expect(deltaOf("sessions")).toBe("+12,5 %");
    expect(deltaOf("page_views")).toBe("-4,2 %");

    // Dwie delty w migawce - i tylko dwie na ekranie.
    expect(card.querySelectorAll(`[title="${deltaTitle}"]`)).toHaveLength(2);
  });

  it("metryka bez delty w migawce nie dostaje zmyślonej zmiany", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const rows = Array.from(
      cardOf(t("adminAnalytics.semantic.canonicalLabel")).querySelector("ul")?.children ?? [],
    );
    const ctaRow = rows.find((r) =>
      (r.textContent ?? "").includes(metricById("cta_clicks").labelPl),
    );
    expect(
      ctaRow?.querySelector(`[title="${t("adminAnalytics.semantic.deltaVsPrevious")}"]`),
    ).toBeNull();
  });

  it("metryka złożona bez podstawy pokazuje POWÓD, nie zero procent", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const undefinedTile = ratioTile("email_ctr");
    expect(undefinedTile.textContent).toContain(t("adminAnalytics.semantic.ratios.undefinedValue"));
    expect(undefinedTile.textContent).toContain("denominator is zero or unavailable");
    expect(undefinedTile.textContent).not.toContain("0 %");

    // Wskaźnik policzony wewnątrz jednego strumienia pokazuje się jako procent.
    expect(ratioTile("ad_ctr").textContent).toMatch(/3[.,]7\s?%/);
  });

  it("dostępność strumieni pokazuje, czego w liczbach NIE MA", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const card = cardOf(t("adminAnalytics.semantic.streams.title"));
    expect(within(card).getAllByRole("listitem")).toHaveLength(STREAMS.length);
    expect(card.textContent).toContain(t("adminAnalytics.semantic.streams.available"));
    expect(card.textContent).toContain(t("adminAnalytics.semantic.streams.no_data"));
  });

  it("migawka bez ani jednej metryki nie rysuje widmowych wierszy", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockResolvedValue(snapshot({ entries: [], deltas: [], ratios: [] }));
    panel();
    await loaded();

    // Migawka pusta, ale ISTNIEJĄCA, to inny stan niż brak migawki: nagłówki
    // sekcji zostają (admin widzi, czego szukał), listy są puste, a interpretacja
    // nadal potrafi się policzyć - `orderedEntries` nie może się przy tym wywrócić.
    expect(
      cardOf(t("adminAnalytics.semantic.canonicalLabel")).querySelector("ul")?.children,
    ).toHaveLength(0);
    expect(
      cardOf(t("adminAnalytics.semantic.ratios.title")).querySelector("ul")?.children,
    ).toHaveLength(0);
    expect(screen.queryByText(t("adminAnalytics.semantic.empty"))).toBeNull();
    // Strumienie i okno nadal opisują TEN SAM przedział.
    expect(
      within(cardOf(t("adminAnalytics.semantic.streams.title"))).getAllByRole("listitem"),
    ).toHaveLength(STREAMS.length);
  });

  it("interpretacja powstaje dla rozjazdu i braku GA4, a nie dla dryfu oczekiwanego", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockResolvedValue(snapshot({ ga4Configured: false }));
    panel();
    await loaded();

    // `buildSemanticInsights` produkuje wpis TYLKO wtedy, gdy jest decyzja.
    expect(
      await screen.findByText(t("adminAnalytics.semantic.insights.ga4MissingTitle")),
    ).toBeInTheDocument();
    // Rozjazd 100 % na odsłonach (12 345 vs 24 690) przy pasmie 30 % z
    // definicji metryki - tytuł niesie i metrykę, i policzoną skalę rozjazdu.
    expect(
      screen.getByText(
        t("adminAnalytics.semantic.insights.divergentTitle", {
          metric: metricById("page_views").labelPl,
          spread: "100",
        }),
      ),
    ).toBeInTheDocument();
    // Dryf oczekiwany na sesjach NIE produkuje wpisu - inaczej prawdziwa
    // rozbieżność zginęłaby w stałym szumie.
    expect(
      screen.queryByText(
        t("adminAnalytics.semantic.insights.divergentTitle", {
          metric: metricById("sessions").labelPl,
          spread: "10",
        }),
      ),
    ).toBeNull();
  });

  it("okno z dniem otwartym wywołuje ostrzeżenie o nieuczciwym porównaniu", async () => {
    const t = realT("pl");
    h.fetchSnapshot.mockResolvedValue(snapshot({ includeOpenDay: true }));
    const { container } = panel();
    await loaded();

    expect(container.textContent).toContain(t("adminAnalytics.semantic.window.unsafe"));
    expect(container.textContent).toContain(t("adminAnalytics.semantic.insights.windowTitle"));
  });

  it("w EN cały panel jest angielski, bez polskiej awaryjnej treści", async () => {
    await i18n.changeLanguage("en");
    const en = realT("en");
    const pl = realT("pl");
    const { container } = panel();
    await loaded();

    expect(container.textContent).toContain(en("adminAnalytics.semantic.panelTitle"));
    expect(container.textContent).toContain(en("adminAnalytics.semantic.canonicalLabel"));
    expect(container.textContent).toContain(en("adminAnalytics.semantic.ratios.title"));
    expect(container.textContent).toContain(metricById("page_views").labelEn);
    expect(container.textContent).not.toContain(pl("adminAnalytics.semantic.canonicalLabel"));
    expect(container.textContent).not.toContain(metricById("page_views").labelPl);
  });
});

describe("SemanticReconciliationPanel - okablowanie okna i odświeżania", () => {
  it("domyślnie pyta o preset 28-dniowy - jedyny bezpieczny do uzgadniania", async () => {
    panel();
    await loaded();

    expect(snapshotInputs()[0]).toEqual({ presetId: "28d" });
  });

  it("preset `24h` nie jest w ogóle oferowany - na nim nie da się uzgadniać", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const listbox = openSelect(screen.getByRole("combobox"));
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      t("adminAnalytics.timeRange.preset7d"),
      t("adminAnalytics.timeRange.preset28d"),
      t("adminAnalytics.timeRange.preset30d"),
      t("adminAnalytics.timeRange.preset90d"),
    ]);
    expect(within(listbox).queryByText(t("adminAnalytics.timeRange.preset24h"))).toBeNull();
  });

  it("zmiana presetu zmienia WEJŚCIE funkcji serwerowej, nie samo renderowanie", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const before = h.fetchSnapshot.mock.calls.length;

    const listbox = openSelect(screen.getByRole("combobox"));
    fireEvent.click(
      within(listbox).getByRole("option", { name: t("adminAnalytics.timeRange.preset90d") }),
    );

    await waitFor(() => expect(h.fetchSnapshot.mock.calls.length).toBeGreaterThan(before));
    expect(snapshotInputs().at(-1)).toEqual({ presetId: "90d" });
  });

  it("odświeżenie ponawia odczyt migawki", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const before = h.fetchSnapshot.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.common.refresh") }));

    await waitFor(() => expect(h.fetchSnapshot.mock.calls.length).toBeGreaterThan(before));
    expect(snapshotInputs().at(-1)).toEqual({ presetId: "28d" });
  });

  it("słownik metryk jest zwinięty domyślnie i rozwija się przyciskiem", async () => {
    const t = realT("pl");
    panel();
    await loaded();

    const toggle = screen.getByRole("button", {
      name: t("adminAnalytics.semantic.dictionary.title"),
    });
    // Referencja, nie treść pierwszego planu: tabela osiemnastu metryk nie
    // może przykryć werdyktów przy pierwszym wejściu na zakładkę.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("rowheader")).toHaveLength(
      METRICS.length,
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("SemanticReconciliationPanel - izolacja warsztatów", () => {
  it("klient NIE podaje warsztatu - wejście to wyłącznie opis okna", async () => {
    const t = realT("pl");
    panel();
    await loaded();
    const listbox = openSelect(screen.getByRole("combobox"));
    fireEvent.click(
      within(listbox).getByRole("option", { name: t("adminAnalytics.timeRange.preset7d") }),
    );
    await waitFor(() => expect(h.fetchSnapshot.mock.calls.length).toBeGreaterThan(1));

    // Gdyby wejście niosło `tenantId` albo nagłówek hosta, wystarczyłoby
    // podmienić je w narzędziach deweloperskich, żeby przeczytać liczby
    // cudzego warsztatu. `getSemanticSnapshot` bierze warsztat z profilu
    // wywołującego, a kontrakt klienta jest tu widoczny w całości.
    for (const input of snapshotInputs()) {
      expect(Object.keys(input)).toEqual(["presetId"]);
    }
    expect(JSON.stringify(h.fetchSnapshot.mock.calls)).not.toContain("tenant");
    expect(JSON.stringify(h.fetchSnapshot.mock.calls)).not.toContain("host");
  });

  it("panel drugiego warsztatu pokazuje WYŁĄCZNIE własne liczby", async () => {
    const first = panel();
    await loaded();
    expect(first.container.textContent).toMatch(/12\s?345/);
    first.unmount();
    cleanup();

    h.fetchSnapshot.mockReset();
    h.fetchSnapshot.mockResolvedValue(
      snapshot({ nowMs: NOW_B, pageViews: 77, firstPartyPageViews: 90 }),
    );
    const second = panel();
    await loaded();

    expect(second.container.textContent).toContain("77");
    expect(second.container.textContent).not.toMatch(/12\s?345/);
    expect(second.container.textContent).not.toMatch(/24\s?690/);
  });

  it("klucz cache niesie warsztat, więc panel B nie maluje liczb warsztatu A", async () => {
    // NAJOSTRZEJSZY przypadek izolacji. Przy stałym
    // `queryKey: ["semantic-snapshot", presetId]` klucz nie nosił ani
    // tenanta, ani użytkownika, a `staleTime: 60_000` trzyma odpowiedź świeżą
    // przez minutę. `QueryClient` stoi w korzeniu aplikacji i PRZEŻYWA zmianę
    // warsztatu, więc panel warsztatu B dostawał migawkę warsztatu A Z CACHE
    // i NIE WYSYŁAŁ ani jednego zapytania. Wyciek jest cichy: nie widać go w
    // ruchu sieciowym, widać go wyłącznie na ekranie - dlatego asercja idzie
    // na treść panelu B, a nie na liczbę zapytań.
    //
    // Przejście między warsztatami odgrywamy tak, jak wygląda w aplikacji:
    // zmienia się najemca (`h.tenantId`) ORAZ to, co bramka oddaje dla niego,
    // a klient cache zostaje TEN SAM.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = panel(client);
    await loaded();
    first.unmount();
    cleanup();

    h.tenantId = TENANT_B;
    h.fetchSnapshot.mockReset();
    h.fetchSnapshot.mockResolvedValue(
      snapshot({ nowMs: NOW_B, pageViews: 77, firstPartyPageViews: 90 }),
    );
    const second = panel(client);
    await screen.findByText(realT("pl")("adminAnalytics.semantic.canonicalLabel"));

    expect(second.container.textContent).not.toMatch(/12\s?345/);
    // ...i nie chodzi o pustą kartę: własne liczby warsztatu B dojeżdżają.
    expect(second.container.textContent).toContain("77");
  });
});

describe("SemanticReconciliationPanel - dostępność", () => {
  // Wyłączenie `button-name` zostaje w trzech testach niżej jako WARTOWNIK
  // zakresu: to przypadek na końcu tej grupy (pełny zestaw reguł) odpowiada za
  // nazwę przełącznika okna, a te trzy pilnują wszystkiego innego - kolejności
  // nagłówków, poprawności ARIA i semantyki list - także wtedy, gdy nazwa
  // przycisku znów się zgubi.
  const KNOWN = { "button-name": { enabled: false } };

  it("wczytany panel nie ma naruszeń axe poza regułą nazwy przycisku", async () => {
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container, KNOWN))).toBe("");
  });

  it("panel z rozwiniętym słownikiem też nie ma innych naruszeń axe", async () => {
    const t = realT("pl");
    const { container } = panel();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: t("adminAnalytics.semantic.dictionary.title") }),
    );

    expect(summarize(await axeViolations(container, KNOWN))).toBe("");
  });

  it("komunikat o braku migawki jest wolny od naruszeń axe", async () => {
    h.fetchSnapshot.mockRejectedValue(new Error("RPC padł"));
    const { container } = panel();
    await screen.findByText(realT("pl")("adminAnalytics.semantic.empty"));

    // Nagłówek panelu (a z nim przełącznik okna) renderuje się także bez
    // danych, więc ten sam wartownik zakresu obowiązuje i tutaj.
    expect(summarize(await axeViolations(container, KNOWN))).toBe("");
  });

  it("przełącznik okna pomiaru ma dostępną nazwę - czytnik nie ogłasza pustego pola", async () => {
    // Wyzwalacz to `<button role="combobox">28 dni</button>`. Rola
    // `combobox` NIE wylicza nazwy z zawartości (inaczej niż `button`), więc
    // widoczne „28 dni” samo nie staje się nazwą dostępną: bez `aria-label`
    // czytnik ekranu ogłaszał „pole listy” bez informacji, CZEGO dotyczy i co
    // jest wybrane. To jedyny element panelu, który zmienia okno wszystkich
    // liczb. Asercja idzie na PEŁNY zestaw reguł axe (bez wyłączeń z `KNOWN`),
    // więc pilnuje też, żeby nazwa nie zniknęła razem z inną zmianą nagłówka.
    const { container } = panel();
    await loaded();

    expect(summarize(await axeViolations(container))).toBe("");
  });
});
