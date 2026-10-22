// PO CO TEN PLIK. `snapshot.functions.ts` to JEDYNE miejsce, w którym sześć
// niezależnych strumieni analitycznych jest łączone w jedną migawkę - i weszło
// tu z ZEREM pokrycia (0 z 66 linii, 0 z 19 funkcji), mimo że pozostałe sześć
// plików warstwy semantycznej stoi na 97-100 %. Rejestr, słownik metryk, okno
// i reguły uzgadniania były więc dowiedzione, a OKABLOWANIE między nimi - nie.
// To najgorszy możliwy podział: każdy klocek poprawny, a raport zarządczy
// nadal mógł pokazać cudzą albo zmyśloną liczbę.
//
// Pięć klas defektów, których nikt tu dotąd nie łapał:
//
//  1) ZŁA PARA ODDANA DO UZGODNIENIA. `buildObservations` decyduje, KTÓRE
//     strumienie w ogóle spotykają się w jednej metryce. Dołożenie tam
//     obserwacji spod innej bramki zgody (np. `ad_events` do `page_views`)
//     przechodzi przez `tsc`, bo typ `StreamObservation` jest ten sam - a
//     `reconcile` zamiast liczby zwróciłby `incomparable` albo, co gorsza,
//     policzyłby rozjazd populacji reklamowej wobec ruchu. Testy niżej pinują
//     INWARIANT: żadna metryka nie dostaje obserwacji spoza swojej bramki zgody.
//
//  2) BRAK JAKO ZERO. `num()` ma zwracać `null`, nigdy `0`. Różnica jest
//     merytoryczna: "0 kliknięć CTA" to zdanie o użytkownikach, "brak danych"
//     to zdanie o rurze. Ta sama zasada rządzi `safeRatio` (null zamiast 0 %).
//
//  3) AWARIA JEDNEGO ŹRÓDŁA WYWRACAJĄCA CAŁOŚĆ. RPC first-party i dwa raporty
//     GA4 to trzy niezależne punkty awarii na jedno wywołanie. Kontrakt mówi,
//     że padnięcie jednego degraduje WYŁĄCZNIE jego metryki, a reszta migawki
//     dojeżdża z werdyktami.
//
//  4) IZOLACJA NAJEMCÓW. Odczyt idzie przez `ctx.supabase` wołającego, RPC
//     `analytics_semantic_snapshot` dostaje WYŁĄCZNIE granice okna (tenant
//     bierze się z profilu w bazie, nie z parametru ani z nagłówka hosta),
//     a property GA4 pochodzi z ustawień TEGO workspace'u. Pomyłka na którymś
//     z tych trzech poziomów to pokazanie jednemu klientowi liczb drugiego.
//
//  5) OKNO POPRZEDNIE. Delty procentowe liczą się na oknie ROZŁĄCZNYM z
//     bieżącym. Nakładka choćby jednego dnia systematycznie zaniża każdą deltę
//     na kafelkach KPI - i jest niewidoczna w logu.
//
// CZEGO TU NIE MA. Reguł `reconcile` (klasyfikacja rozjazdu ma własny plik),
// rozwiązywania okna (`window.test.ts`), podpisywania JWT i cache'u tokenów
// GA4 (`__tests__/ga4Server.test.ts`) ani middleware - `serverFnStubModule`
// z założenia go nie uruchamia, więc zieleń tego pliku mówi "logika jest
// poprawna", a nie "obcy się nie dostanie".
//
// ZERO SIECI. `runGa4DataApiReport` i `resolveGa4AccessToken` są atrapami -
// reszta modułu GA4 (`ga4TotalsMap`, `resolveGa4PropertyId`, `EMPTY_GA4_REPORT`)
// jest PRAWDZIWA, żeby mapowanie totali na metryki kanoniczne było dowiedzione,
// a nie zasymulowane. Bramka admina i odczyt ustawień też są prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HUB_METRIC_IDS,
  METRICS,
  STREAMS,
  authoritativeBinding,
  bindingFor,
  metricById,
  previousWindow,
  resolveCalendarWindow,
  resolveCustomWindow,
  resolveWindow,
  streamById,
  windowsOverlap,
  type MetricId,
  type ReconciliationEntry,
  type StreamId,
} from ".";
import { asServerFn, callServerFn } from "@/test/serverFnHarness";
import { keepPreviousData } from "@tanstack/react-query";
import { revenueKeys } from "@/lib/revenue/keys";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import type { RevenueRange } from "@/lib/revenue/window";
import {
  REVENUE_CLUBS_KEYS,
  REVENUE_EMAIL_KEYS,
  REVENUE_EVENTS_KEYS,
  REVENUE_FUNNEL_KEYS,
  REVENUE_SNAPSHOT_KEYS,
  REVENUE_SNAPSHOT_METRICS,
  parseRevenueClubsSummary,
  parseRevenueEmailHealth,
  parseRevenueEventsSummary,
  parseRevenueFunnel,
  parseRevenueSemanticSnapshot,
  revenueObservations,
  revenueRatios,
} from "./revenueRaw";
import type { RevenueDomainReads, RevenueSnapshotResult } from "./revenueSnapshot.functions";
import type { Ga4Report, Ga4ReportRequest } from "../ga4.server";
import type {
  SemanticDelta,
  SemanticSnapshotResult,
  SemanticStreamHealth,
} from "./snapshot.functions";

// ---------------------------------------------------------------------------
// Atrapy modułów
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const resolveGa4AccessToken =
    vi.fn<() => Promise<{ token: string; source: "sa" | "oauth" } | null>>();
  const runGa4DataApiReport = vi.fn<(req: Ga4ReportRequest, token: string) => Promise<Ga4Report>>();
  // Wartownik tożsamościowy: dowodzi, że funkcja deklaruje TO middleware,
  // a nie jakiekolwiek. Atrapa go nie wykonuje - patrz nagłówek.
  return {
    middleware: { nazwa: "requireSupabaseAuth" },
    resolveGa4AccessToken,
    runGa4DataApiReport,
  };
});

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: H.middleware,
}));

vi.mock("@/lib/analytics/ga4.server", async () => {
  const actual = await vi.importActual<typeof import("../ga4.server")>(
    "@/lib/analytics/ga4.server",
  );
  return {
    ...actual,
    resolveGa4AccessToken: H.resolveGa4AccessToken,
    runGa4DataApiReport: H.runGa4DataApiReport,
  };
});

const { getSemanticSnapshot } = await import("./snapshot.functions");
const {
  getRevenueSnapshot,
  isRevenueForbidden,
  revenueSnapshotHandler,
  revenueSnapshotQueryOptions,
  REVENUE_DOMAINS,
  REVENUE_DOMAIN_READS,
  REVENUE_DOMAIN_RPC,
} = await import("./revenueSnapshot.functions");

// ---------------------------------------------------------------------------
// Zegar i okna odniesienia
// ---------------------------------------------------------------------------

const TERAZ = Date.parse("2026-07-15T14:37:00.000Z");
const OKNO = resolveWindow({ presetId: "28d", nowMs: TERAZ });
const OKNO_POPRZEDNIE = previousWindow(OKNO);

const TOKEN = "token-ga4-tylko-do-testu";
const PROPERTY_A = "111111111";
const PROPERTY_B = "222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Nazwy metryk GA4, o które warstwa semantyczna ma pytać - kolejność jest kontraktem. */
const METRYKI_GA4 = ["sessions", "activeUsers", "screenPageViews", "engagementRate"] as const;

// ---------------------------------------------------------------------------
// Atrapa klienta Supabase najemcy
// ---------------------------------------------------------------------------

interface WywolanieRpc {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

interface OdczytTabeli {
  readonly table: string;
  readonly columns: string;
  readonly filtr: readonly [string, string];
}

interface OdpowiedzRpc {
  data: unknown;
  error: { message: string } | null;
}

type MigawkaResponder = (granice: { since: string; until: string }) => OdpowiedzRpc;

interface OpcjeNajemcy {
  readonly userId?: string;
  /** Wynik `has_role` - `false` znaczy "zalogowany, ale nie admin tego najemcy". */
  readonly admin?: boolean;
  readonly hasRoleError?: string;
  /** Wiersz `site_settings.value` dla klucza `analytics`. */
  readonly settings?: unknown;
  readonly settingsError?: string;
  readonly snapshot?: MigawkaResponder;
}

interface Najemca {
  readonly ctx: { supabase: unknown; userId: string };
  readonly rpcCalls: WywolanieRpc[];
  readonly odczyty: OdczytTabeli[];
  granice(): Array<{ since: string; until: string }>;
}

function ok(data: unknown): OdpowiedzRpc {
  return { data, error: null };
}

function blad(message: string): OdpowiedzRpc {
  return { data: null, error: { message } };
}

/**
 * Klient jednego workspace'u. Każdy najemca dostaje WŁASNĄ instancję - dzięki
 * temu "nie wyciekło" jest sprawdzalne przez pustkę w rejestrze wywołań drugiego
 * klienta, a nie przez wiarę w to, że handler użył właściwego obiektu.
 */
function najemca(opcje: OpcjeNajemcy = {}): Najemca {
  const rpcCalls: WywolanieRpc[] = [];
  const odczyty: OdczytTabeli[] = [];

  const supabase = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          odczyty.push({ table, columns, filtr: [column, value] });
          if (opcje.settingsError) return Promise.resolve(blad(opcje.settingsError));
          return Promise.resolve(ok([{ value: opcje.settings ?? {} }]));
        },
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "has_role") {
        if (opcje.hasRoleError) return Promise.resolve(blad(opcje.hasRoleError));
        return Promise.resolve(ok(opcje.admin ?? true));
      }
      if (fn === "analytics_semantic_snapshot") {
        const responder = opcje.snapshot ?? (() => ok({}));
        return Promise.resolve(
          responder({ since: String(args.p_since), until: String(args.p_until) }),
        );
      }
      return Promise.resolve(blad(`test: nieoczekiwane RPC "${fn}"`));
    },
  };

  return {
    ctx: { supabase, userId: opcje.userId ?? USER_A },
    rpcCalls,
    odczyty,
    granice: () =>
      rpcCalls
        .filter((c) => c.fn === "analytics_semantic_snapshot")
        .map((c) => ({ since: String(c.args.p_since), until: String(c.args.p_until) })),
  };
}

function wywolaj(n: Najemca, data?: unknown): Promise<SemanticSnapshotResult> {
  return callServerFn<SemanticSnapshotResult>(getSemanticSnapshot, { data, context: n.ctx });
}

// ---------------------------------------------------------------------------
// Ładunki RPC
// ---------------------------------------------------------------------------

/** Pełna migawka first-party dla okna bieżącego. */
const MIGAWKA_BIEZACA = {
  first_party: {
    events_total: 9000,
    page_views: 5200,
    entity_views: 300,
    cta_clicks: 240,
    searches: 130,
    sessions: 1400,
    visitors: 1100,
    signed_in_sessions: 90,
  },
  web_vitals: {
    samples: 800,
    metrics: {
      LCP: { p75: 2100, samples: 800 },
      INP: { p75: 180, samples: 640 },
      CLS: { p75: 0.07, samples: 800 },
    },
  },
  ad_events: { impressions: 12_000, clicks: 360 },
  newsletter: {
    opens: 4200,
    clicks: 510,
    distinct_openers: 3000,
    distinct_clickers: 400,
    campaigns: 3,
  },
  content_views: { content_views: 3100, unique_viewers: 2400, related_clicks: 260, reads: 1900 },
};

/** Ta sama struktura dla okna poprzedniego - liczby niższe, żeby delty były dodatnie. */
const MIGAWKA_POPRZEDNIA = {
  first_party: { page_views: 4400, cta_clicks: 200, searches: 110, sessions: 1200, visitors: 900 },
  web_vitals: { metrics: { LCP: { p75: 2400, samples: 700 } } },
  ad_events: { impressions: 10_000, clicks: 250 },
  newsletter: { opens: 3800, clicks: 430 },
  content_views: { content_views: 2500, related_clicks: 200, reads: 1500 },
};

/** Responder rozróżniający okna po dolnej granicy - dokładnie tak jak baza. */
function migawkaPoOknie(
  biezaca: unknown = MIGAWKA_BIEZACA,
  poprzednia: unknown = MIGAWKA_POPRZEDNIA,
): MigawkaResponder {
  return ({ since }) => ok(since === OKNO.sinceIso ? biezaca : poprzednia);
}

interface TotaleGa4 {
  readonly sessions: string;
  readonly activeUsers: string;
  readonly screenPageViews: string;
  readonly engagementRate: string;
}

function raportGa4(t: TotaleGa4, propertyId: string = PROPERTY_A): Ga4Report {
  return {
    configured: true,
    propertyId,
    dimensionHeaders: [],
    metricHeaders: [...METRYKI_GA4],
    rows: [],
    totals: [t.sessions, t.activeUsers, t.screenPageViews, t.engagementRate],
  };
}

const GA4_BIEZACY = raportGa4({
  sessions: "1200",
  activeUsers: "950",
  screenPageViews: "4600",
  engagementRate: "0.54",
});
const GA4_POPRZEDNI = raportGa4({
  sessions: "1000",
  activeUsers: "800",
  screenPageViews: "4000",
  engagementRate: "0.5",
});

/** Ustawienia workspace'u z włączonym GA4. */
function ustawieniaGa4(propertyId: string = PROPERTY_A): Record<string, unknown> {
  return { ga4_enabled: true, ga4_property_id: propertyId };
}

/** Włącza GA4 na poziomie atrap: token jest, raporty odpowiadają po dacie startu. */
function ga4Dziala(biezacy: Ga4Report = GA4_BIEZACY, poprzedni: Ga4Report = GA4_POPRZEDNI): void {
  H.resolveGa4AccessToken.mockResolvedValue({ token: TOKEN, source: "sa" });
  H.runGa4DataApiReport.mockImplementation((req) =>
    Promise.resolve(req.startDate === OKNO.ga4.startDate ? biezacy : poprzedni),
  );
}

// ---------------------------------------------------------------------------
// Skróty asercyjne
// ---------------------------------------------------------------------------

// Brak elementu jest BŁĘDEM struktury odpowiedzi, nie brakiem danych - dlatego
// rzucamy z nazwą metryki zamiast rzutować i padać potem na `undefined`.
function wpis(res: SemanticSnapshotResult, id: MetricId): ReconciliationEntry {
  const found = res.entries.find((e) => e.metricId === id);
  if (!found) throw new Error(`test: migawka nie zawiera metryki ${id}`);
  return found;
}

function zdrowie(res: SemanticSnapshotResult, id: StreamId): SemanticStreamHealth {
  const found = res.streams.find((s) => s.streamId === id);
  if (!found) throw new Error(`test: migawka nie zawiera strumienia ${id}`);
  return found;
}

function delta(res: SemanticSnapshotResult, id: MetricId): SemanticDelta {
  const found = res.deltas.find((d) => d.metricId === id);
  if (!found) throw new Error(`test: migawka nie zawiera delty ${id}`);
  return found;
}

let ostrzezenia: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TERAZ);
  // Globalny sekret property musi być NIEOBECNY: inaczej `resolveGa4PropertyId`
  // nadpisałby ustawienia workspace'u i test izolacji najemców nic by nie znaczył.
  vi.stubEnv("GA4_PROPERTY_ID", undefined);
  H.resolveGa4AccessToken.mockReset();
  H.resolveGa4AccessToken.mockResolvedValue(null);
  H.runGa4DataApiReport.mockReset();
  ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  ostrzezenia.mockRestore();
});

// ---------------------------------------------------------------------------

describe("obudowa serwerowej funkcji", () => {
  it("jest POST-em za `requireSupabaseAuth` i ma walidator wejścia", () => {
    const spec = asServerFn(getSemanticSnapshot);
    expect(spec.method).toBe("POST");
    // Tożsamość, nie liczność: dowolne inne middleware nie przeszłoby tej asercji.
    expect(spec.middleware).toEqual([H.middleware]);
    expect(typeof spec.validator).toBe("function");
  });

  it("brak wejścia znaczy okno 28 dni bez dnia otwartego", async () => {
    const n = najemca({ snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.window.presetId).toBe("28d");
    expect(res.window.days).toBe(28);
    expect(res.window.crossStreamSafe).toBe(true);
    expect(res.window.notes).toEqual(["ga4_property_timezone", "excludes_open_day"]);
  });

  it("odrzuca preset spoza listy - nie degraduje po cichu do domyślnego", () => {
    const spec = asServerFn(getSemanticSnapshot);
    expect(() => spec.validator?.({ presetId: "365d" })).toThrow();
  });

  it("odrzuca połowę zakresu własnego - `sinceIso` bez `untilIso` i odwrotnie", () => {
    const spec = asServerFn(getSemanticSnapshot);
    const since = "2026-07-01T00:00:00.000Z";
    expect(() => spec.validator?.({ sinceIso: since })).toThrow(/must be provided together/);
    expect(() => spec.validator?.({ untilIso: since })).toThrow(/must be provided together/);
    // Obie granice naraz przechodzą - to jest druga gałąź tego samego `refine`.
    expect(() => spec.validator?.({ sinceIso: since, untilIso: since })).not.toThrow();
  });

  it("odrzuca granicę, która nie jest znacznikiem czasu ISO", () => {
    const spec = asServerFn(getSemanticSnapshot);
    expect(() => spec.validator?.({ sinceIso: "2026-07-01", untilIso: "2026-07-10" })).toThrow();
  });
});

describe("bramka admina i izolacja najemców", () => {
  it("pyta `has_role` o WOŁAJĄCEGO, zanim dotknie jakichkolwiek danych", async () => {
    const n = najemca({ userId: USER_B, snapshot: migawkaPoOknie() });
    await wywolaj(n);
    expect(n.rpcCalls[0]).toEqual({
      fn: "has_role",
      args: { _user_id: USER_B, _role: "admin" },
    });
  });

  it("brak roli admina zatrzymuje wywołanie PRZED odczytem migawki", async () => {
    const n = najemca({ admin: false, snapshot: migawkaPoOknie() });
    await expect(wywolaj(n)).rejects.toThrow("Forbidden: admin role required");
    // Sedno: odmowa nie może zostawić śladu po odczycie danych najemcy.
    expect(n.granice()).toEqual([]);
    expect(n.odczyty).toEqual([]);
  });

  it("błąd sprawdzenia roli też blokuje odczyt - nie degraduje do dostępu", async () => {
    const n = najemca({ hasRoleError: "role check exploded", snapshot: migawkaPoOknie() });
    await expect(wywolaj(n)).rejects.toThrow("role check exploded");
    expect(n.granice()).toEqual([]);
  });

  it("RPC migawki dostaje WYŁĄCZNIE granice okna - tenant idzie z profilu", async () => {
    const n = najemca({ snapshot: migawkaPoOknie() });
    await wywolaj(n);
    const migawki = n.rpcCalls.filter((c) => c.fn === "analytics_semantic_snapshot");
    expect(migawki).toHaveLength(2);
    for (const c of migawki) {
      expect(Object.keys(c.args).sort()).toEqual(["p_since", "p_until"]);
    }
  });

  it("pola spoza schematu nie przeciekają do zapytania - zod je odcina", async () => {
    const n = najemca({ snapshot: migawkaPoOknie() });
    await wywolaj(n, { presetId: "7d", tenantId: "cudzy-najemca", host: "obcy.example.com" });
    for (const c of n.rpcCalls.filter((x) => x.fn === "analytics_semantic_snapshot")) {
      expect(Object.keys(c.args).sort()).toEqual(["p_since", "p_until"]);
      expect(JSON.stringify(c.args)).not.toContain("cudzy-najemca");
    }
  });

  it("dwa workspace'y czytają przez WŁASNE klienty - liczby się nie mieszają", async () => {
    const a = najemca({
      userId: USER_A,
      snapshot: () => ok({ first_party: { cta_clicks: 240, searches: 130 } }),
    });
    const b = najemca({
      userId: USER_B,
      snapshot: () => ok({ first_party: { cta_clicks: 7, searches: 2 } }),
    });

    const resA = await wywolaj(a);
    const resB = await wywolaj(b);

    expect(wpis(resA, "cta_clicks").canonicalValue).toBe(240);
    expect(wpis(resB, "cta_clicks").canonicalValue).toBe(7);
    // Klient A nie obsłużył ANI JEDNEGO zapytania w imieniu B (i odwrotnie).
    expect(a.rpcCalls.map((c) => c.args._user_id).filter(Boolean)).toEqual([USER_A]);
    expect(b.rpcCalls.map((c) => c.args._user_id).filter(Boolean)).toEqual([USER_B]);
    expect(a.granice()).toHaveLength(2);
    expect(b.granice()).toHaveLength(2);
  });

  it("ustawienia analityki czyta klient najemcy, filtrując po kluczu `analytics`", async () => {
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    ga4Dziala();
    await wywolaj(n);
    expect(n.odczyty).toEqual([
      { table: "site_settings", columns: "value", filtr: ["key", "analytics"] },
    ]);
  });

  it("property GA4 pochodzi z ustawień TEGO workspace'u, nie ze stałej", async () => {
    ga4Dziala();
    const a = najemca({
      userId: USER_A,
      settings: ustawieniaGa4(PROPERTY_A),
      snapshot: migawkaPoOknie(),
    });
    const b = najemca({
      userId: USER_B,
      settings: ustawieniaGa4(PROPERTY_B),
      snapshot: migawkaPoOknie(),
    });

    await wywolaj(a);
    const poA = H.runGa4DataApiReport.mock.calls.map((c) => c[0].propertyId);
    await wywolaj(b);
    const poB = H.runGa4DataApiReport.mock.calls.slice(poA.length).map((c) => c[0].propertyId);

    expect(poA).toEqual([PROPERTY_A, PROPERTY_A]);
    expect(poB).toEqual([PROPERTY_B, PROPERTY_B]);
  });
});

describe("okno: kolejność zapytań i rozłączność", () => {
  it("pyta dokładnie dwa razy: najpierw okno bieżące, potem poprzednie", async () => {
    const n = najemca({ snapshot: migawkaPoOknie() });
    await wywolaj(n);
    expect(n.rpcCalls.map((c) => c.fn)).toEqual([
      "has_role",
      "analytics_semantic_snapshot",
      "analytics_semantic_snapshot",
    ]);
    expect(n.granice()).toEqual([
      { since: OKNO.sinceIso, until: OKNO.untilIso },
      { since: OKNO_POPRZEDNIE.sinceIso, until: OKNO_POPRZEDNIE.untilIso },
    ]);
  });

  it("okno poprzednie jest ROZŁĄCZNE z bieżącym - baza delt nie jest zawyżona", async () => {
    const n = najemca({ snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.previous).toEqual({
      sinceIso: OKNO_POPRZEDNIE.sinceIso,
      untilIso: OKNO_POPRZEDNIE.untilIso,
    });
    expect(windowsOverlap(OKNO, OKNO_POPRZEDNIE)).toBe(false);
    // Konkretne daty, żeby test był oracle'em, a nie powtórzeniem resolwera.
    expect(res.window.sinceIso).toBe("2026-06-17T00:00:00.000Z");
    expect(res.window.untilIso).toBe("2026-07-14T23:59:59.999Z");
    expect(res.previous.untilIso).toBe("2026-06-16T23:59:59.999Z");
  });

  it("DTO okna niesie ten sam zakres dat, który poszedł do GA4", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.window.ga4).toEqual({ startDate: "2026-06-17", endDate: "2026-07-14" });
    expect(H.runGa4DataApiReport.mock.calls[0][0]).toEqual({
      propertyId: PROPERTY_A,
      startDate: OKNO.ga4.startDate,
      endDate: OKNO.ga4.endDate,
      dimensions: [],
      metrics: [...METRYKI_GA4],
      limit: 1,
    });
    expect(H.runGa4DataApiReport.mock.calls[0][1]).toBe(TOKEN);
    expect(H.runGa4DataApiReport.mock.calls[1][0].startDate).toBe(OKNO_POPRZEDNIE.ga4.startDate);
    expect(H.runGa4DataApiReport.mock.calls[1][0].endDate).toBe(OKNO_POPRZEDNIE.ga4.endDate);
  });

  it("zakres własny przycina granice do pełnych dób UTC i oznacza preset `custom`", async () => {
    const n = najemca({ snapshot: () => ok(MIGAWKA_BIEZACA) });
    const res = await wywolaj(n, {
      sinceIso: "2026-07-01T09:13:00.000Z",
      untilIso: "2026-07-10T21:45:00.000Z",
    });
    const oczekiwane = resolveCustomWindow(
      "2026-07-01T09:13:00.000Z",
      "2026-07-10T21:45:00.000Z",
      TERAZ,
    );
    expect(res.window.presetId).toBe("custom");
    expect(res.window.sinceIso).toBe("2026-07-01T00:00:00.000Z");
    expect(res.window.untilIso).toBe("2026-07-10T23:59:59.999Z");
    expect(res.window.days).toBe(10);
    expect(n.granice()[0]).toEqual({ since: oczekiwane.sinceIso, until: oczekiwane.untilIso });
    expect(n.granice()[1]).toEqual({
      since: previousWindow(oczekiwane).sinceIso,
      until: previousWindow(oczekiwane).untilIso,
    });
  });

  it("dzień otwarty przenosi się do `reconcile` i wyłącza orzekanie o rozjeździe", async () => {
    ga4Dziala();
    const otwarte = resolveWindow({ presetId: "28d", nowMs: TERAZ, includeOpenDay: true });
    const n = najemca({
      settings: ustawieniaGa4(),
      snapshot: ({ since }) =>
        ok(since === otwarte.sinceIso ? MIGAWKA_BIEZACA : MIGAWKA_POPRZEDNIA),
    });
    H.runGa4DataApiReport.mockImplementation((req) =>
      Promise.resolve(req.startDate === otwarte.ga4.startDate ? GA4_BIEZACY : GA4_POPRZEDNI),
    );

    const res = await wywolaj(n, { includeOpenDay: true });

    expect(res.window.crossStreamSafe).toBe(false);
    expect(res.window.notes).toContain("ga4_open_day");
    const sesje = wpis(res, "sessions");
    // Liczbę wolno pokazać, WERDYKTU nie - GA4 nie domknęło jeszcze doby.
    expect(sesje.canonicalValue).toBe(1200);
    expect(sesje.verdict).toBe("incomparable");
    expect(sesje.reasons).toContain("window_not_cross_stream_safe");
    expect(sesje.spread).toBeNull();
  });
});

describe("okablowanie uzgadniania", () => {
  it("oddaje szesnaście metryk w kolejności słownika, bez wskaźników złożonych", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.entries.map((e) => e.metricId)).toEqual([
      "sessions",
      "visitors",
      "page_views",
      "engagement_rate",
      "cta_clicks",
      "internal_searches",
      "lcp_p75",
      "inp_p75",
      "cls_p75",
      "ad_impressions",
      "ad_clicks",
      "email_opens",
      "email_clicks",
      "content_views",
      "related_clicks",
      "reads",
    ]);
    // `ad_ctr` / `email_ctr` są wskaźnikami - liczy je `safeRatio`, nie `reconcile`.
    expect(res.entries.map((e) => e.metricId)).not.toContain("ad_ctr");
    expect(res.ratios.map((r) => r.metricId)).toEqual(["ad_ctr", "email_ctr"]);
  });

  it("każdy wpis cytuje strumień autorytatywny ze słownika, nie pierwszy z brzegu", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    for (const e of res.entries) {
      expect(e.authoritativeStream, e.metricId).toBe(authoritativeBinding(e.metricId).streamId);
    }
  });

  it("sesje dostają PARĘ GA4 + first-party i werdykt przechodzi nietknięty", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    const sesje = wpis(res, "sessions");

    expect(sesje.observations.map((o) => [o.streamId, o.value])).toEqual([
      ["ga4", 1200],
      ["first_party", 1400],
    ]);
    // Cytujemy GA4 (sesjonizacja per użytkownik), a nie wyższą liczbę per karta.
    expect(sesje.canonicalValue).toBe(1200);
    expect(sesje.verdict).toBe("expected_drift");
    expect(sesje.spread).toBeCloseTo((1400 - 1200) / 1200, 6);
    expect(sesje.reasons).toContain("grain_mismatch");
  });

  it("odwrócenie relacji GA4 > first-party wychodzi z migawki jako `order_inverted`", async () => {
    // GA4 filtruje boty, więc NIE MOŻE mieć więcej odsłon niż nasz surowy licznik.
    ga4Dziala(
      raportGa4({
        sessions: "1200",
        activeUsers: "950",
        screenPageViews: "9000",
        engagementRate: "0.54",
      }),
    );
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    const odslony = wpis(res, "page_views");
    expect(odslony.canonicalValue).toBe(9000);
    expect(odslony.verdict).toBe("order_inverted");
    expect(odslony.reasons).toContain("expected_order_inverted");
    // Werdykt jednej metryki nie zabiera werdyktów pozostałym.
    expect(wpis(res, "sessions").verdict).toBe("expected_drift");
  });

  it("metryki jednostrumieniowe dostają `single_source`, a próbki RUM jadą z wartością", async () => {
    const n = najemca({ snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    const lcp = wpis(res, "lcp_p75");
    expect(lcp.canonicalValue).toBe(2100);
    expect(lcp.verdict).toBe("single_source");
    expect(lcp.observations[0].samples).toBe(800);
    expect(wpis(res, "cls_p75").canonicalValue).toBe(0.07);
    expect(wpis(res, "inp_p75").observations[0].samples).toBe(640);
  });

  it("brak licznika próbek zostaje `undefined`, a nie zerem", async () => {
    const n = najemca({
      snapshot: () => ok({ web_vitals: { metrics: { LCP: { p75: 2500 } } } }),
    });
    const res = await wywolaj(n);
    const lcp = wpis(res, "lcp_p75");
    expect(lcp.canonicalValue).toBe(2500);
    expect(lcp.observations[0].samples).toBeUndefined();
  });

  it("totale GA4 mapują się na właściwe metryki kanoniczne", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: () => ok({}) });
    const res = await wywolaj(n);
    expect(wpis(res, "sessions").canonicalValue).toBe(1200);
    expect(wpis(res, "visitors").canonicalValue).toBe(950);
    expect(wpis(res, "page_views").canonicalValue).toBe(4600);
    expect(wpis(res, "engagement_rate").canonicalValue).toBe(0.54);
  });
});

describe("bramka zgody", () => {
  it("żadna metryka nie dostaje obserwacji spoza swojej bramki zgody", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    for (const e of res.entries) {
      const bramka = streamById(e.authoritativeStream).consentGate;
      for (const o of e.observations) {
        expect(streamById(o.streamId).consentGate, `${e.metricId} <- ${o.streamId}`).toBe(bramka);
      }
    }
  });

  it("wskaźniki złożone zostają WEWNĄTRZ jednego strumienia i cytują liczby kanoniczne", async () => {
    const n = najemca({ snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    const pary: ReadonlyArray<[MetricId, MetricId, MetricId]> = [
      ["ad_ctr", "ad_clicks", "ad_impressions"],
      ["email_ctr", "email_clicks", "email_opens"],
    ];
    for (const [wskaznik, licznik, mianownik] of pary) {
      const s = authoritativeBinding(wskaznik).streamId;
      expect(authoritativeBinding(licznik).streamId).toBe(s);
      expect(authoritativeBinding(mianownik).streamId).toBe(s);
      const r = res.ratios.find((x) => x.metricId === wskaznik);
      const l = wpis(res, licznik).canonicalValue;
      const m = wpis(res, mianownik).canonicalValue;
      expect(r?.reason).toBeUndefined();
      expect(r?.value).toBeCloseTo((l ?? 0) / (m ?? 1), 10);
    }
    expect(res.ratios[0].value).toBeCloseTo(360 / 12_000, 10);
  });

  it("zerowy mianownik daje `null` z powodem, a nie 0 % ('nikt nie kliknął')", async () => {
    const n = najemca({
      snapshot: () => ok({ ad_events: { impressions: 0, clicks: 0 }, newsletter: { opens: 0 } }),
    });
    const res = await wywolaj(n);
    for (const r of res.ratios) {
      expect(r.value).toBeNull();
      expect(r.reason).toMatch(/denominator is zero or unavailable/);
    }
  });

  it("bez zgody analitycznej strumienie za tą bramką NIE dokładają liczb", async () => {
    // Scenariusz z produkcji: odwiedzający odrzuca analitykę i marketing.
    // Beacony `analytics_events`, `web_vitals` i `ad_events` w ogóle nie powstają,
    // a `content_views` (bez bramki w kodzie) zapisuje się dalej.
    const n = najemca({
      snapshot: () =>
        ok({ content_views: { content_views: 3100, related_clicks: 260, reads: 1900 } }),
    });
    const res = await wywolaj(n);

    const zaBramka: readonly MetricId[] = [
      "cta_clicks",
      "internal_searches",
      "lcp_p75",
      "inp_p75",
      "cls_p75",
      "ad_impressions",
      "ad_clicks",
      "email_opens",
      "email_clicks",
    ];
    for (const id of zaBramka) {
      const e = wpis(res, id);
      // BRAK to nie ZERO: „0 kliknięć" mówiłoby o ludziach, nie o wyłączonej rurze.
      expect(e.canonicalValue, id).toBeNull();
      expect(e.verdict, id).toBe("unavailable");
      expect(e.reasons, id).toContain("missing_authoritative");
    }
    // Strumień bez bramki zgody dowozi swoje liczby mimo odmowy.
    expect(wpis(res, "content_views").canonicalValue).toBe(3100);
    expect(wpis(res, "reads").canonicalValue).toBe(1900);
    expect(zdrowie(res, "content_views")).toEqual({ streamId: "content_views", available: true });
    for (const id of ["first_party", "web_vitals", "ad_events", "newsletter"] as const) {
      expect(zdrowie(res, id)).toEqual({ streamId: id, available: false, reason: "no_data" });
    }
  });
});

describe("GA4: konfiguracja i degradacja", () => {
  it("wyłącznik `ga4_enabled: false` nie wysyła ANI JEDNEGO raportu", async () => {
    H.resolveGa4AccessToken.mockResolvedValue({ token: TOKEN, source: "sa" });
    const n = najemca({
      settings: { ga4_enabled: false, ga4_property_id: PROPERTY_A },
      snapshot: migawkaPoOknie(),
    });
    const res = await wywolaj(n);
    expect(H.runGa4DataApiReport).not.toHaveBeenCalled();
    expect(res.ga4Configured).toBe(false);
    expect(zdrowie(res, "ga4")).toEqual({
      streamId: "ga4",
      available: false,
      reason: "not_configured",
    });
    // Metryki autorytatywnie GA4 są niedostępne, first-party dojeżdża normalnie.
    expect(wpis(res, "sessions").canonicalValue).toBeNull();
    expect(wpis(res, "cta_clicks").canonicalValue).toBe(240);
  });

  it("property z samych spacji znaczy brak konfiguracji, a nie puste property", async () => {
    H.resolveGa4AccessToken.mockResolvedValue({ token: TOKEN, source: "sa" });
    const n = najemca({
      settings: { ga4_enabled: true, ga4_property_id: "   " },
      snapshot: migawkaPoOknie(),
    });
    const res = await wywolaj(n);
    expect(H.runGa4DataApiReport).not.toHaveBeenCalled();
    expect(res.ga4Configured).toBe(false);
  });

  it("brak tokenu przy poprawnym property też znaczy brak konfiguracji", async () => {
    H.resolveGa4AccessToken.mockResolvedValue(null);
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(H.resolveGa4AccessToken).toHaveBeenCalledTimes(1);
    expect(H.runGa4DataApiReport).not.toHaveBeenCalled();
    expect(res.ga4Configured).toBe(false);
  });

  it("błąd Data API degraduje SAM strumień GA4 i wypisuje powód adminowi", async () => {
    const zepsuty: Ga4Report = { ...GA4_BIEZACY, error: "GA4 403: caller lacks property access" };
    ga4Dziala(zepsuty, zepsuty);
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);

    expect(res.ga4Configured).toBe(true);
    expect(res.ga4Error).toBe("GA4 403: caller lacks property access");
    expect(zdrowie(res, "ga4")).toEqual({
      streamId: "ga4",
      available: false,
      reason: "read_failed",
    });
    // Raport z błędem nie wnosi totali - metryki GA4 są puste, reszta stoi.
    expect(wpis(res, "sessions").canonicalValue).toBeNull();
    expect(wpis(res, "sessions").verdict).toBe("unavailable");
    expect(wpis(res, "cta_clicks").canonicalValue).toBe(240);
    expect(wpis(res, "content_views").canonicalValue).toBe(3100);
  });

  it("bez błędu GA4 pole `ga4Error` w ogóle nie występuje w odpowiedzi", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.ga4Configured).toBe(true);
    expect("ga4Error" in res).toBe(false);
    expect(zdrowie(res, "ga4")).toEqual({ streamId: "ga4", available: true });
  });

  it("awaria odczytu ustawień degraduje do braku konfiguracji, nie do wyjątku", async () => {
    H.resolveGa4AccessToken.mockResolvedValue({ token: TOKEN, source: "sa" });
    const n = najemca({ settingsError: "site_settings unreachable", snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.ga4Configured).toBe(false);
    expect(res.entries).toHaveLength(16);
    expect(wpis(res, "cta_clicks").canonicalValue).toBe(240);
  });
});

describe("awaria jednego źródła degraduje tylko jego metryki", () => {
  it("padnięcie RPC okna bieżącego zostawia GA4 i loguje ostrzeżenie", async () => {
    ga4Dziala();
    const n = najemca({
      settings: ustawieniaGa4(),
      snapshot: ({ since }) =>
        since === OKNO.sinceIso ? blad("permission denied for function") : ok(MIGAWKA_POPRZEDNIA),
    });
    const res = await wywolaj(n);

    expect(ostrzezenia).toHaveBeenCalledWith(
      "[semantic] snapshot RPC failed:",
      "permission denied for function",
    );
    // GA4 to osobna rura - jej liczby przeżywają awarię Postgresa.
    expect(wpis(res, "sessions").canonicalValue).toBe(1200);
    expect(wpis(res, "page_views").canonicalValue).toBe(4600);
    // Wszystkie strumienie first-party są oznaczone jako NIEODCZYTANE,
    // co jest czymś innym niż „brak danych w oknie".
    for (const s of STREAMS.filter((x) => x.id !== "ga4")) {
      expect(zdrowie(res, s.id)).toEqual({
        streamId: s.id,
        available: false,
        reason: "read_failed",
      });
    }
    expect(wpis(res, "cta_clicks").canonicalValue).toBeNull();
  });

  it("padnięcie RPC okna poprzedniego zeruje TYLKO bazę delt", async () => {
    const n = najemca({
      snapshot: ({ since }) =>
        since === OKNO.sinceIso ? ok(MIGAWKA_BIEZACA) : blad("statement timeout"),
    });
    const res = await wywolaj(n);

    expect(wpis(res, "cta_clicks").canonicalValue).toBe(240);
    expect(zdrowie(res, "first_party")).toEqual({ streamId: "first_party", available: true });
    const d = delta(res, "cta_clicks");
    expect(d.current).toBe(240);
    expect(d.previous).toBeNull();
    expect(d.deltaPct).toBeNull();
  });

  it("odpowiedź, która nie jest obiektem, czyta się jako brak danych, nie jako awaria", async () => {
    // `jsonb` może wrócić skalarem albo tablicą - `parseSnapshot` ma to znieść
    // bez rzutowań i bez wyjątku, a rozróżnienie „odczyt padł" vs „pusto" ma
    // zostać zachowane: odczyt się UDAŁ, po prostu nic nie zwrócił.
    for (const ladunek of [null, "brak", 42, [1, 2, 3]]) {
      const n = najemca({ snapshot: () => ok(ladunek) });
      const res = await wywolaj(n);
      expect(res.entries).toHaveLength(16);
      expect(wpis(res, "cta_clicks").canonicalValue).toBeNull();
      expect(zdrowie(res, "first_party").reason).toBe("no_data");
    }
  });

  it("liczby przysłane jako napisy są parsowane, śmieci są odrzucane do `null`", async () => {
    // Postgres potrafi oddać `bigint` w jsonb jako napis - to NIE jest brak danych.
    const n = najemca({
      snapshot: () =>
        ok({
          first_party: { cta_clicks: "240", searches: "nie-liczba" },
          ad_events: { impressions: "12000", clicks: true },
          content_views: { content_views: null, reads: "1900" },
        }),
    });
    const res = await wywolaj(n);
    expect(wpis(res, "cta_clicks").canonicalValue).toBe(240);
    expect(wpis(res, "internal_searches").canonicalValue).toBeNull();
    expect(wpis(res, "ad_impressions").canonicalValue).toBe(12_000);
    expect(wpis(res, "ad_clicks").canonicalValue).toBeNull();
    expect(wpis(res, "content_views").canonicalValue).toBeNull();
    expect(wpis(res, "reads").canonicalValue).toBe(1900);
  });
});

describe("delty wobec okna poprzedniego", () => {
  it("liczy zmianę dokładnie dla siedmiu metryk zarządczych, w stałej kolejności", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.deltas.map((d) => d.metricId)).toEqual([
      "sessions",
      "visitors",
      "page_views",
      "content_views",
      "engagement_rate",
      "cta_clicks",
      "related_clicks",
    ]);
  });

  it("procent liczy się z liczb KANONICZNYCH obu okien", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(delta(res, "sessions")).toEqual({
      metricId: "sessions",
      current: 1200,
      previous: 1000,
      deltaPct: 20,
    });
    expect(delta(res, "content_views").deltaPct).toBeCloseTo(((3100 - 2500) / 2500) * 100, 10);
    expect(delta(res, "cta_clicks").deltaPct).toBeCloseTo(((240 - 200) / 200) * 100, 10);
  });

  it("zerowa baza daje `null`, nie nieskończoność", async () => {
    const n = najemca({
      snapshot: ({ since }) =>
        ok(
          since === OKNO.sinceIso
            ? { first_party: { cta_clicks: 240 } }
            : { first_party: { cta_clicks: 0 } },
        ),
    });
    const res = await wywolaj(n);
    const d = delta(res, "cta_clicks");
    expect(d.previous).toBe(0);
    expect(d.deltaPct).toBeNull();
    expect(Number.isFinite(d.deltaPct ?? Number.NaN)).toBe(false);
  });

  it("brak liczby bieżącej przy obecnej poprzedniej też daje `null`", async () => {
    const n = najemca({
      snapshot: ({ since }) =>
        ok(since === OKNO.sinceIso ? {} : { first_party: { cta_clicks: 200 } }),
    });
    const res = await wywolaj(n);
    expect(delta(res, "cta_clicks")).toEqual({
      metricId: "cta_clicks",
      current: null,
      previous: 200,
      deltaPct: null,
    });
  });

  it("spadek jest ujemny - znak nie gubi się po drodze", async () => {
    const n = najemca({
      snapshot: ({ since }) =>
        ok(
          since === OKNO.sinceIso
            ? { content_views: { content_views: 750 } }
            : { content_views: { content_views: 1000 } },
        ),
    });
    const res = await wywolaj(n);
    expect(delta(res, "content_views").deltaPct).toBeCloseTo(-25, 10);
  });
});

describe("zdrowie strumieni", () => {
  it("raportuje wszystkie sześć strumieni w kolejności rejestru", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: migawkaPoOknie() });
    const res = await wywolaj(n);
    expect(res.streams.map((s) => s.streamId)).toEqual(STREAMS.map((s) => s.id));
    expect(res.streams.filter((s) => s.available)).toHaveLength(6);
    expect(res.streams.every((s) => s.reason === undefined)).toBe(true);
  });

  it("strumień, którego wszystkie metryki są zerowe, to `no_data`, nie awaria", async () => {
    const n = najemca({
      snapshot: () =>
        ok({
          first_party: { cta_clicks: 5, searches: 1 },
          newsletter: { opens: 0, clicks: 0 },
        }),
    });
    const res = await wywolaj(n);
    expect(zdrowie(res, "first_party")).toEqual({ streamId: "first_party", available: true });
    expect(zdrowie(res, "newsletter")).toEqual({
      streamId: "newsletter",
      available: false,
      reason: "no_data",
    });
  });

  it("o dostępności strumienia decydują metryki, dla których jest AUTORYTATYWNY", async () => {
    // Kontrola przeciwna do testu niżej: `content_views` ma trzy własne metryki,
    // więc jedna niezerowa wystarcza, żeby strumień był dostępny.
    const n = najemca({
      snapshot: () => ok({ content_views: { content_views: 0, related_clicks: 0, reads: 12 } }),
    });
    const res = await wywolaj(n);
    expect(zdrowie(res, "content_views")).toEqual({ streamId: "content_views", available: true });
    // Własne metryki strumienia W TEJ MIGAWCE. Rejestr zna jeszcze DAU/MAU
    // i WAU/MAU huba (ten sam strumień, ziarno konta), ale migawka analityczna
    // ich nie liczy - stąd filtr po wpisach odpowiedzi, nie po całym rejestrze.
    const wlasne = res.entries
      .filter((e) => authoritativeBinding(e.metricId).streamId === "content_views")
      .map((e) => e.metricId);
    expect(wlasne).toEqual(["content_views", "related_clicks", "reads"]);
    expect(
      METRICS.filter((m) => authoritativeBinding(m.id).streamId === "content_views").map(
        (m) => m.id,
      ),
    ).toEqual(["content_views", "related_clicks", "reads", "dau_mau", "wau_mau"]);
  });

  it("strumień dowożący odsłony jako obserwacja potwierdzająca jest dostępny, nie `no_data`", async () => {
    // Workspace bez CTA i bez wyszukiwarki wewnętrznej, ale z ruchem: RPC oddaje
    // 5 200 odsłon, 1 400 sesji i 1 100 wizytujących z `analytics_events`.
    // `available` liczy się z WSZYSTKICH obserwacji strumienia, nie tylko z
    // metryk, dla których jest AUTORYTATYWNY (`cta_clicks`,
    // `internal_searches`) - odsłony i sesje są autorytatywnie GA4, a
    // first-party jest tam obserwacją potwierdzającą. Gdyby liczyły się
    // wyłącznie metryki własne, TA SAMA odpowiedź pokazywałaby w `entries`
    // obserwacje first-party z tysiącami zdarzeń i jednocześnie ogłaszała w
    // `streams`, że tego strumienia „nie ma w liczbach" - panel podawałby
    // liczbę i zaprzeczał jej istnieniu w jednym widoku. Ten przypadek pilnuje
    // obu połów jednocześnie: obserwacji w `entries` i statusu w `streams`.
    ga4Dziala();
    const n = najemca({
      settings: ustawieniaGa4(),
      snapshot: () =>
        ok({
          first_party: {
            page_views: 5200,
            sessions: 1400,
            visitors: 1100,
            cta_clicks: 0,
            searches: 0,
          },
        }),
    });
    const res = await wywolaj(n);

    const fp = wpis(res, "page_views").observations.find((o) => o.streamId === "first_party");
    expect(fp?.value).toBe(5200);
    expect(zdrowie(res, "first_party").available).toBe(true);
  });
});

// ===========================================================================
// D13: okno własne z DAT kalendarzowych w `getSemanticSnapshot`
// ===========================================================================
//
// Kontrakt server fn się NIE zmienia (plik poza manifestem S6): konsument
// zamienia wybrane dni na okno `resolveCalendarWindow` i wysyła jego granice
// jako `sinceIso/untilIso`. Te granice leżą na północy UTC, więc serwer
// (`resolveCustomWindow`) odtwarza dokładnie wybrane dni - a nie dzień
// wcześniej, jak przy lokalnej północy z kalendarza.

describe("getSemanticSnapshot - okno z dat kalendarza (D13)", () => {
  it("granice z `resolveCalendarWindow` przechodzą przez serwer bez przesunięcia dnia", async () => {
    ga4Dziala();
    const n = najemca({ settings: ustawieniaGa4(), snapshot: () => ok(MIGAWKA_BIEZACA) });
    const dni = resolveCalendarWindow("2026-07-03", "2026-07-09", TERAZ);
    const res = await wywolaj(n, { sinceIso: dni.sinceIso, untilIso: dni.untilIso });

    expect(res.window.presetId).toBe("custom");
    expect(res.window.days).toBe(7);
    expect(res.window.ga4).toEqual({ startDate: "2026-07-03", endDate: "2026-07-09" });
    expect(n.granice()[0]).toEqual({
      since: "2026-07-03T00:00:00.000Z",
      until: "2026-07-09T23:59:59.999Z",
    });
    expect(H.runGa4DataApiReport.mock.calls[0][0]).toMatchObject({
      startDate: "2026-07-03",
      endDate: "2026-07-09",
    });
  });

  it("kontrakt odpowiedzi bez zmian: sześć strumieni i szesnaście wpisów", async () => {
    const n = najemca({ snapshot: () => ok(MIGAWKA_BIEZACA) });
    const dni = resolveCalendarWindow("2026-07-03", "2026-07-09", TERAZ);
    const res = await wywolaj(n, { sinceIso: dni.sinceIso, untilIso: dni.untilIso });
    expect(res.streams.map((s) => s.streamId)).toEqual(STREAMS.map((s) => s.id));
    expect(res.entries).toHaveLength(16);
  });
});

// ===========================================================================
// getRevenueSnapshot - migawka przychodu i lejka (S6, AD-19)
// ===========================================================================
//
// Te same klasy defektów co wyżej, w wersji huba: (1) editor NIE może nawet
// zapytać o finanse - dowodem jest rejestr wywołań atrapy, nie sam wynik;
// (2) brak funkcji z S1-S4 to „nie skonfigurowane”, nie wyjątek; (3) kwoty
// per waluta, nigdy suma; (4) `null` ≠ 0; (5) parsery trzymają kontrakt
// `*_KEYS` i gaszą tylko zepsute pola.

type RolaHuba = "admin" | "editor" | "brak";

interface OdpowiedzHuba {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface OpcjeHuba {
  readonly rola?: RolaHuba;
  readonly hasRoleError?: string;
  /** Odpowiedź RPC po nazwie i granicach okna; brak wpisu = dane okna bieżącego/poprzedniego. */
  readonly rpc?: Readonly<Record<string, (okno: "biezace" | "poprzednie") => OdpowiedzHuba>>;
}

/** Bieżący miesiąc (lipiec, granice na północy Warszawy) i poprzedni (czerwiec). */
const ZAKRES_HUBA: RevenueRange = {
  period: "month",
  current: { sinceIso: "2026-06-30T22:00:00.000Z", untilIso: "2026-07-31T22:00:00.000Z" },
  previous: { sinceIso: "2026-05-31T22:00:00.000Z", untilIso: "2026-06-30T22:00:00.000Z" },
  bucket: "day",
  offsetMinutes: 120,
  complete: false,
};

function wejscie(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    period: ZAKRES_HUBA.period,
    current: ZAKRES_HUBA.current,
    previous: ZAKRES_HUBA.previous,
    offsetMinutes: ZAKRES_HUBA.offsetMinutes,
    ...extra,
  };
}

const RPC_HUBA = [
  "admin_revenue_semantic_snapshot",
  "admin_revenue_funnel",
  "admin_revenue_events_summary",
  "admin_revenue_clubs_summary",
  "admin_revenue_email_health",
] as const;

const PLN = (amount_minor: number) => ({ currency: "PLN", amount_minor });
const EUR = (amount_minor: number) => ({ currency: "EUR", amount_minor });

const SNAPSHOT_HUBA = {
  data_since: "2025-01-01",
  computed_at: "2026-07-15T08:00:00.000Z",
  basis_mix: { provider: 0.8, catalog: 0.2 },
  mrr: [PLN(1_000_000), EUR(200_000)],
  arr: [PLN(12_000_000), EUR(2_400_000)],
  arpa: [PLN(10_000), EUR(2_000)],
  arpu: [PLN(8_000)],
  net_new_mrr: [PLN(100_000)],
  mrr_start: [PLN(900_000)],
  mrr_end: [PLN(1_000_000)],
  movements: {
    new: [PLN(80_000)],
    expansion: [PLN(40_000)],
    reactivation: [PLN(5_000)],
    contraction: [PLN(10_000)],
    churn: [PLN(15_000)],
  },
  revenue_realized: [PLN(900_000), EUR(100_000)],
  revenue_realized_orders: [PLN(600_000)],
  active_subscriptions: 120,
  active_customers: 100,
  customers_start: 100,
  customers_churned: "3",
  mrr_growth_mom: 0.11,
  saas_quick_ratio: "5",
  expansion_share_new_mrr: 0.32,
  annual_plan_share: 0.4,
  gross_revenue_churn: 0.028,
  net_revenue_retention: 1.04,
  gross_revenue_retention: 0.93,
  involuntary_churn_share: 0.25,
  dunning_recovery_rate: 0.6,
  winback_rate_12m: 0.08,
  returning_subscriber_share: 0.1,
  cohort_retention_m1: 0.9,
  cohort_retention_m3: 0.8,
  cohort_retention_m12: 0.6,
  trial_to_paid_rate: 0.4,
  price_realization: 0.92,
  average_discount: 0.15,
};

const SNAPSHOT_POPRZEDNI = { ...SNAPSHOT_HUBA, mrr: [PLN(900_000), EUR(250_000)] };

const LEJEK = {
  accounts: 500,
  paywall_hit_accounts: 200,
  active_accounts: 480,
  checkout_started: 50,
  checkout_paid: 30,
  checkout_abandoned: 20,
  first_payments: 30,
  registered_to_paid_rate: 0.06,
  paywall_conversion_rate: 0.03,
  paywall_hit_rate: 0.4,
  checkout_conversion_rate: 0.6,
  checkout_abandonment_rate: 0.4,
  signup_form_views: 1000,
  signup_form_submits: 50,
  coupon_redemption_rate: 0.1,
  visitors_first_party: 9000,
};

const WYDARZENIA = {
  by_currency: [{ currency: "PLN", ticket_revenue_net_minor: 300_000 }],
  registrations: 200,
  paid: 150,
  attended: 140,
  no_show: 60,
};

const KLUBY = {
  members: 80,
  active_members: 40,
  contributors: 10,
  applications: { submitted: 12, accepted: 6, rejected: 2 },
  decision_hours_median: 30.5,
};

const EMAIL = {
  delivered: 10_000,
  unique_opens: 4_000,
  unique_clicks: 500,
  hard_bounces: 50,
  soft_bounces: 150,
  complaints: 5,
  unsubscribes: 30,
  list_net_growth: "-20",
  list_base: 10_000,
  doi_started: 100,
  doi_confirmed: 70,
};

const DOMYSLNE: Readonly<
  Record<(typeof RPC_HUBA)[number], (o: "biezace" | "poprzednie") => unknown>
> = {
  admin_revenue_semantic_snapshot: (o) => (o === "biezace" ? SNAPSHOT_HUBA : SNAPSHOT_POPRZEDNI),
  admin_revenue_funnel: () => LEJEK,
  admin_revenue_events_summary: () => WYDARZENIA,
  admin_revenue_clubs_summary: () => KLUBY,
  admin_revenue_email_health: () => EMAIL,
};

interface KlientHuba {
  readonly ctx: { supabase: unknown; userId: string };
  /** Ten sam rejestrujący klient w kształcie `RpcCallable` - do wołania wpięć wprost. */
  readonly klient: RpcCallable;
  readonly wywolania: WywolanieRpc[];
  huba(): WywolanieRpc[];
}

function klientHuba(opcje: OpcjeHuba = {}): KlientHuba {
  const wywolania: WywolanieRpc[] = [];
  const rola = opcje.rola ?? "admin";
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      wywolania.push({ fn, args });
      if (fn === "has_role") {
        if (opcje.hasRoleError) return Promise.resolve(blad(opcje.hasRoleError));
        return Promise.resolve(ok(args._role === rola));
      }
      const okno = args.p_since === ZAKRES_HUBA.current.sinceIso ? "biezace" : "poprzednie";
      const wlasna = opcje.rpc?.[fn];
      if (wlasna) return Promise.resolve(wlasna(okno));
      if (fn in DOMYSLNE) {
        return Promise.resolve(ok(DOMYSLNE[fn as keyof typeof DOMYSLNE](okno)));
      }
      return Promise.resolve(blad(`test: nieoczekiwane RPC "${fn}"`));
    },
  };
  return {
    ctx: { supabase, userId: USER_A },
    klient: { rpc: (fn, args) => supabase.rpc(fn, args ?? {}) },
    wywolania,
    huba: () => wywolania.filter((c) => c.fn !== "has_role"),
  };
}

/**
 * DOCELOWE wpięcia RPC - stan po scaleniu S1-S4 i kontrakt dla wycinków-
 * właścicieli: dokładnie te wywołania (literał nazwy, klucze argumentów)
 * podmieniają `null` w `REVENUE_DOMAIN_READS`. Produkcja S6 nie woła jeszcze
 * żadnego z nich (funkcji nie ma w migracjach - kontrakt TS ⇄ SQL), więc
 * scalanie, role i rejestr wywołań dowodzimy na tym zestawie.
 */
const WPIECIA_DOCELOWE: RevenueDomainReads = {
  snapshot: (c, w) =>
    c.rpc("admin_revenue_semantic_snapshot", { p_since: w.sinceIso, p_until: w.untilIso }),
  funnel: (c, w) =>
    c.rpc("admin_revenue_funnel", {
      p_since: w.sinceIso,
      p_until: w.untilIso,
      p_segment: w.segment,
      p_track: "all",
    }),
  events: (c, w) =>
    c.rpc("admin_revenue_events_summary", { p_since: w.sinceIso, p_until: w.untilIso }),
  clubs: (c, w) =>
    c.rpc("admin_revenue_clubs_summary", { p_since: w.sinceIso, p_until: w.untilIso }),
  email: (c, w) =>
    c.rpc("admin_revenue_email_health", { p_since: w.sinceIso, p_until: w.untilIso }),
};

/** Funkcja huba z docelowymi wpięciami: ta sama walidacja i ten sam handler co produkcja. */
const HUB_DOCELOWY = {
  ...asServerFn(getRevenueSnapshot),
  handler: (ctx: Parameters<typeof revenueSnapshotHandler>[0]) =>
    revenueSnapshotHandler(ctx, WPIECIA_DOCELOWE),
};

function wywolajHub(
  k: KlientHuba,
  extra?: Record<string, unknown>,
): Promise<RevenueSnapshotResult> {
  return callServerFn<RevenueSnapshotResult>(HUB_DOCELOWY, {
    data: wejscie(extra),
    context: k.ctx,
  });
}

/** Funkcja huba w stanie PRODUKCYJNYM tego wycinka (wpięcia z `REVENUE_DOMAIN_READS`). */
function wywolajHubProdukcyjny(
  k: KlientHuba,
  extra?: Record<string, unknown>,
): Promise<RevenueSnapshotResult> {
  return callServerFn<RevenueSnapshotResult>(getRevenueSnapshot, {
    data: wejscie(extra),
    context: k.ctx,
  });
}

function wpisHuba(res: RevenueSnapshotResult, id: MetricId): ReconciliationEntry {
  const found = res.entries.find((e) => e.metricId === id);
  if (!found) throw new Error(`test: migawka huba nie zawiera metryki ${id}`);
  return found;
}

function bladKod(message: string, code: string): OdpowiedzHuba {
  return { data: null, error: { message, code } };
}

describe("getRevenueSnapshot - obudowa i wejście", () => {
  it("jest POST-em za `requireSupabaseAuth` z walidatorem", () => {
    const spec = asServerFn(getRevenueSnapshot);
    expect(spec.method).toBe("POST");
    expect(spec.middleware).toEqual([H.middleware]);
    expect(typeof spec.validator).toBe("function");
  });

  it("najemca NIE jest wejściem - nieznany klucz odrzuca żądanie, a nie znika po cichu", () => {
    const spec = asServerFn(getRevenueSnapshot);
    expect(() => spec.validator?.(wejscie())).not.toThrow();
    expect(() => spec.validator?.(wejscie({ tenantId: "cudzy-najemca" }))).toThrow();
    expect(() => spec.validator?.(wejscie({ tenant_id: "cudzy-najemca" }))).toThrow();
  });

  it("waliduje okres, walutę, segment i okna", () => {
    const spec = asServerFn(getRevenueSnapshot);
    expect(() => spec.validator?.(wejscie({ period: "decade" }))).toThrow();
    expect(() => spec.validator?.(wejscie({ currency: "pln" }))).toThrow();
    expect(() => spec.validator?.(wejscie({ currency: "PLN" }))).not.toThrow();
    expect(() => spec.validator?.(wejscie({ segment: "other" }))).toThrow();
    expect(() => spec.validator?.(wejscie({ segment: "b2b_institution" }))).not.toThrow();
    expect(() => spec.validator?.(wejscie({ offsetMinutes: 900 }))).toThrow();
    expect(() => spec.validator?.(wejscie({ previous: null }))).not.toThrow();
    // Okno na wspak, okno poprzednie zachodzące na bieżące, okno ponad limit.
    expect(() =>
      spec.validator?.(
        wejscie({
          current: {
            sinceIso: ZAKRES_HUBA.current.untilIso,
            untilIso: ZAKRES_HUBA.current.sinceIso,
          },
        }),
      ),
    ).toThrow(/precede/);
    expect(() =>
      spec.validator?.(
        wejscie({
          previous: { sinceIso: "2026-06-01T00:00:00.000Z", untilIso: "2026-07-05T00:00:00.000Z" },
        }),
      ),
    ).toThrow(/previous window/);
    expect(() =>
      spec.validator?.(
        wejscie({
          current: { sinceIso: "2024-01-01T00:00:00.000Z", untilIso: "2026-07-01T00:00:00.000Z" },
          previous: null,
        }),
      ),
    ).toThrow(/longer than/);
  });
});

describe("getRevenueSnapshot - role i wywołania", () => {
  it("admin: pięć RPC na okno, literalne nazwy, WYŁĄCZNIE granice okna (bez najemcy)", async () => {
    const k = klientHuba();
    await wywolajHub(k, { segment: "b2c_individual" });

    expect(k.wywolania[0]).toEqual({ fn: "has_role", args: { _user_id: USER_A, _role: "admin" } });
    // Admin rozpoznany za pierwszym razem - o editora nie pytamy.
    expect(k.wywolania.filter((c) => c.fn === "has_role")).toHaveLength(1);
    const huba = k.huba();
    expect(huba).toHaveLength(10);
    expect(new Set(huba.map((c) => c.fn))).toEqual(new Set(RPC_HUBA));
    for (const c of huba) {
      const klucze = Object.keys(c.args).sort();
      expect(klucze, c.fn).toEqual(
        c.fn === "admin_revenue_funnel"
          ? ["p_segment", "p_since", "p_track", "p_until"]
          : ["p_since", "p_until"],
      );
      expect(JSON.stringify(c.args)).not.toMatch(/tenant/i);
    }
    const lejek = huba.find((c) => c.fn === "admin_revenue_funnel");
    expect(lejek?.args).toMatchObject({ p_segment: "b2c_individual", p_track: "all" });
  });

  it("EDITOR NIGDY nie wywołuje RPC finansowego - rejestr wywołań atrapy", async () => {
    const k = klientHuba({ rola: "editor" });
    const res = await wywolajHub(k);

    expect(k.wywolania.filter((c) => c.fn === "has_role").map((c) => c.args._role)).toEqual([
      "admin",
      "editor",
    ]);
    expect(k.wywolania.some((c) => c.fn === "admin_revenue_semantic_snapshot")).toBe(false);
    expect(k.huba()).toHaveLength(8);
    expect(res.role).toBe("editor");
    expect(res.streams.find((s) => s.streamId === "billing")).toEqual({
      streamId: "billing",
      available: false,
      reason: "admin_only",
    });
    // Wpisy rozliczeń są puste, ale istnieją - kafel pokazuje „tylko admin”, nie dziurę.
    expect(wpisHuba(res, "mrr").canonicalValue).toBeNull();
    expect(wpisHuba(res, "mrr").verdict).toBe("unavailable");
    expect(res.dataSince).toBeNull();
    expect(res.basisMix).toBeNull();
    // Lejek, społeczność i e-mail są dla editora.
    expect(wpisHuba(res, "checkout_conversion_rate").canonicalValue).toBe(0.6);
    expect(wpisHuba(res, "event_attendance_rate").canonicalValue).toBe(0.7);
  });

  it("editor nie dostaje kwot nawet wtedy, gdy SQL przez pomyłkę je odda (obrona w głąb)", async () => {
    const k = klientHuba({ rola: "editor" });
    const res = await wywolajHub(k);
    expect(res.money).toEqual({});
    expect(wpisHuba(res, "event_ticket_revenue").canonicalValue).toBeNull();
  });

  it("brak roli admin i editor → odmowa 42501 PRZED jakimkolwiek odczytem danych", async () => {
    const k = klientHuba({ rola: "brak" });
    const blad = await wywolajHub(k).then(
      () => null,
      (e: unknown) => e,
    );
    expect(blad).toBeInstanceOf(Error);
    expect(blad).toMatchObject({ code: "42501" });
    expect(isRevenueForbidden(blad)).toBe(true);
    // Po serializacji zostaje sama treść - też ma być rozpoznana.
    expect(isRevenueForbidden({ message: (blad as Error).message })).toBe(true);
    expect(isRevenueForbidden(new Error("statement timeout"))).toBe(false);
    expect(k.huba()).toEqual([]);
  });

  it("błąd sprawdzenia roli to awaria, nie odmowa i nie dostęp", async () => {
    const k = klientHuba({ hasRoleError: "role check exploded" });
    await expect(wywolajHub(k)).rejects.toThrow("role check exploded");
    expect(k.huba()).toEqual([]);
  });

  it("bez okna poprzedniego - pięć wywołań i delty bez bazy", async () => {
    const k = klientHuba();
    const res = await wywolajHub(k, { previous: null });
    expect(k.huba()).toHaveLength(5);
    expect(res.previous).toBeNull();
    expect(res.deltas.every((d) => d.previous === null && d.deltaPct === null)).toBe(true);
  });
});

describe("getRevenueSnapshot - scalenie pięciu odczytów", () => {
  it("wpisy w kolejności rejestru, z liczbami z właściwych strumieni", async () => {
    const res = await wywolajHub(klientHuba());

    expect(res.entries.map((e) => e.metricId)).toEqual([...REVENUE_SNAPSHOT_METRICS]);
    expect(res.role).toBe("admin");
    expect(wpisHuba(res, "mrr").canonicalValue).toBe(1_000_000);
    expect(wpisHuba(res, "active_subscriptions").canonicalValue).toBe(120);
    expect(wpisHuba(res, "saas_quick_ratio").canonicalValue).toBe(5);
    expect(wpisHuba(res, "net_revenue_retention").canonicalValue).toBe(1.04);
    expect(wpisHuba(res, "checkout_conversion_rate").canonicalValue).toBe(0.6);
    expect(wpisHuba(res, "signup_form_conversion_rate").canonicalValue).toBe(0.05);
    expect(wpisHuba(res, "email_open_rate").canonicalValue).toBe(0.4);
    expect(wpisHuba(res, "email_ctr_delivered").canonicalValue).toBe(0.05);
    // Odbicia liczone od WYSŁANYCH (doręczone + odbicia), nie od doręczonych.
    expect(wpisHuba(res, "email_hard_bounce_rate").canonicalValue).toBeCloseTo(50 / 10_200, 12);
    expect(wpisHuba(res, "newsletter_list_growth_rate").canonicalValue).toBe(-0.002);
    expect(wpisHuba(res, "email_disaffection_rate").canonicalValue).toBeCloseTo(235 / 500, 12);
    expect(wpisHuba(res, "event_attendance_rate").canonicalValue).toBe(0.7);
    expect(wpisHuba(res, "no_show_rate").canonicalValue).toBe(0.3);
    expect(wpisHuba(res, "club_application_acceptance").canonicalValue).toBe(0.75);
    expect(wpisHuba(res, "club_decision_time").canonicalValue).toBe(30.5);
    expect(wpisHuba(res, "club_contributor_rate").canonicalValue).toBe(0.25);
    expect(res.streams).toEqual([
      { streamId: "billing", available: true },
      { streamId: "lifecycle", available: true },
      { streamId: "community", available: true },
      { streamId: "newsletter", available: true },
    ]);
    expect(res.dataSince).toBe("2025-01-01");
    expect(res.computedAt).toBe("2026-07-15T08:00:00.000Z");
    expect(res.basisMix).toEqual({ provider: 0.8, catalog: 0.2 });
    expect(res.window).toEqual({
      period: "month",
      sinceIso: ZAKRES_HUBA.current.sinceIso,
      untilIso: ZAKRES_HUBA.current.untilIso,
      offsetMinutes: 120,
      complete: false,
    });
  });

  it("churn miesięczny przeliczony z okna geometrycznie, roczny tylko na LTM", async () => {
    const res = await wywolajHub(klientHuba());
    const dni =
      (Date.parse(ZAKRES_HUBA.current.untilIso) - Date.parse(ZAKRES_HUBA.current.sinceIso)) /
      86_400_000;
    expect(wpisHuba(res, "logo_churn_monthly").canonicalValue).toBeCloseTo(
      1 - (1 - 0.03) ** (30.4375 / dni),
      12,
    );
    expect(wpisHuba(res, "logo_churn_annual").canonicalValue).toBeNull();

    const ltm = await wywolajHub(klientHuba(), { period: "ltm", previous: null });
    expect(wpisHuba(ltm, "logo_churn_annual").canonicalValue).toBe(0.03);
  });

  it("przychód zrealizowany: księga autorytatywna, zamówienia potwierdzają w TEJ SAMEJ walucie", async () => {
    const res = await wywolajHub(klientHuba());
    const wpis = wpisHuba(res, "revenue_realized");
    expect(wpis.canonicalValue).toBe(900_000);
    expect(wpis.authoritativeStream).toBe("billing");
    expect(wpis.observations.find((o) => o.streamId === "lifecycle")?.value).toBe(600_000);
    // Księga > zamówienia o udział odnowień - dryf oczekiwany, nie rozbieżność.
    expect(wpis.verdict).toBe("expected_drift");
  });

  it("zamówienia POWYŻEJ księgi to relacja odwrócona - zgubione dokumenty", async () => {
    const k = klientHuba({
      rpc: {
        admin_revenue_semantic_snapshot: () =>
          ok({ ...SNAPSHOT_HUBA, revenue_realized_orders: [PLN(1_200_000)] }),
      },
    });
    const res = await wywolajHub(k);
    expect(wpisHuba(res, "revenue_realized").verdict).toBe("order_inverted");
  });

  it("kwoty per waluta, NIGDY suma - wartość kanoniczna w walucie wiodącej", async () => {
    const res = await wywolajHub(klientHuba());
    expect(res.money.mrr).toEqual([
      { currency: "PLN", amountMinor: 1_000_000 },
      { currency: "EUR", amountMinor: 200_000 },
    ]);
    expect(res.money.event_ticket_revenue).toEqual([{ currency: "PLN", amountMinor: 300_000 }]);
    // Ani wpis, ani delta nie niesie sumy dwóch walut.
    expect(res.entries.some((e) => e.canonicalValue === 1_200_000)).toBe(false);
    expect(Object.keys(res.money).sort()).toEqual(
      [
        "arpa",
        "arpu",
        "arr",
        "event_ticket_revenue",
        "mrr",
        "net_new_mrr",
        "revenue_realized",
      ].sort(),
    );
  });

  it("waluta wiodąca jedzie w odpowiedzi (`ratioCurrency`, I9 - Z-S7-06)", async () => {
    // Bez filtra: pierwsza waluta danych bieżących (MRR) - ta sama, w której
    // liczą się wpisy i delty; panel podpisuje NRR/GRR tym polem.
    expect((await wywolajHub(klientHuba())).ratioCurrency).toBe("PLN");
    expect((await wywolajHub(klientHuba(), { currency: "EUR" })).ratioCurrency).toBe("EUR");
  });

  it("filtr waluty zmienia walutę wiodącą obu okien naraz", async () => {
    const res = await wywolajHub(klientHuba(), { currency: "EUR" });
    expect(res.ratioCurrency).toBe("EUR");
    expect(wpisHuba(res, "mrr").canonicalValue).toBe(200_000);
    const delta = res.deltas.find((d) => d.metricId === "mrr");
    // Euro do euro: 200 000 wobec 250 000 - nie złotówki do euro.
    expect(delta).toEqual({ metricId: "mrr", current: 200_000, previous: 250_000, deltaPct: -20 });
    // Zamówienia nie mają EUR: zmierzone zero w tej walucie, nie brak danych.
    const realized = wpisHuba(res, "revenue_realized");
    expect(realized.canonicalValue).toBe(100_000);
    expect(realized.observations.find((o) => o.streamId === "lifecycle")?.value).toBe(0);
  });

  it("delty liczą się w walucie wiodącej, w kolejności wpisów", async () => {
    const res = await wywolajHub(klientHuba());
    expect(res.deltas.map((d) => d.metricId)).toEqual(res.entries.map((e) => e.metricId));
    const mrr = res.deltas.find((d) => d.metricId === "mrr");
    expect(mrr?.current).toBe(1_000_000);
    expect(mrr?.previous).toBe(900_000);
    expect(mrr?.deltaPct).toBeCloseTo((100_000 / 900_000) * 100, 10);
  });

  it("ilorazy niosą powód braku wartości: zerowy mianownik to nie „brak danych”", async () => {
    const k = klientHuba({
      rpc: {
        admin_revenue_email_health: () => ok({ ...EMAIL, delivered: 0 }),
        admin_revenue_clubs_summary: () => ok({ members: 10 }),
      },
    });
    const res = await wywolajHub(k);
    const open = res.ratios.find((r) => r.metricId === "email_open_rate");
    expect(open).toEqual({
      metricId: "email_open_rate",
      value: null,
      reason: "denominator is zero",
    });
    const active = res.ratios.find((r) => r.metricId === "club_active_member_rate");
    expect(active?.value).toBeNull();
    expect(active?.reason).toBe("numerator or denominator unavailable");
    expect(wpisHuba(res, "email_open_rate").canonicalValue).toBeNull();
  });
});

describe("getRevenueSnapshot - degradacja źródeł", () => {
  it("brak funkcji w bazie (PGRST202 / 42883) to `not_configured`, bez ostrzeżenia w logu", async () => {
    const k = klientHuba({
      rpc: {
        admin_revenue_funnel: () => bladKod("Could not find the function", "PGRST202"),
        admin_revenue_email_health: () => bladKod("function does not exist", "42883"),
      },
    });
    const res = await wywolajHub(k);
    expect(res.streams.find((s) => s.streamId === "lifecycle")).toEqual({
      streamId: "lifecycle",
      available: false,
      reason: "not_configured",
    });
    expect(res.streams.find((s) => s.streamId === "newsletter")?.reason).toBe("not_configured");
    expect(wpisHuba(res, "checkout_conversion_rate").canonicalValue).toBeNull();
    // Reszta migawki stoi.
    expect(wpisHuba(res, "mrr").canonicalValue).toBe(1_000_000);
    expect(res.streams.find((s) => s.streamId === "billing")?.available).toBe(true);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("inny błąd to `read_failed` z wpisem w logu; drugie RPC tego strumienia nadal dowozi", async () => {
    const k = klientHuba({
      rpc: { admin_revenue_events_summary: () => blad("statement timeout") },
    });
    const res = await wywolajHub(k);
    expect(res.streams.find((s) => s.streamId === "community")?.reason).toBe("read_failed");
    expect(ostrzezenia).toHaveBeenCalledWith(
      "[revenue] admin_revenue_events_summary RPC failed:",
      "statement timeout",
    );
    expect(wpisHuba(res, "event_attendance_rate").canonicalValue).toBeNull();
    expect(wpisHuba(res, "club_application_acceptance").canonicalValue).toBe(0.75);
  });

  it("wyjątek klienta (odrzucona obietnica) degraduje jedno źródło, nie całą migawkę", async () => {
    const k = klientHuba();
    const rpc = (k.ctx.supabase as { rpc: (fn: string, args: Record<string, unknown>) => unknown })
      .rpc;
    (k.ctx.supabase as { rpc: unknown }).rpc = (fn: string, args: Record<string, unknown>) =>
      fn === "admin_revenue_clubs_summary"
        ? Promise.reject(new Error("socket hang up"))
        : rpc(fn, args);
    const res = await wywolajHub(k);
    expect(res.streams.find((s) => s.streamId === "community")?.reason).toBe("read_failed");
    expect(wpisHuba(res, "mrr").canonicalValue).toBe(1_000_000);
  });

  it("odpowiedź o złym kształcie to brak danych, nie awaria", async () => {
    const k = klientHuba({
      rpc: {
        admin_revenue_semantic_snapshot: () => ok("nie-obiekt"),
        admin_revenue_funnel: () => ok([1, 2, 3]),
      },
    });
    const res = await wywolajHub(k);
    expect(res.streams.find((s) => s.streamId === "billing")).toEqual({
      streamId: "billing",
      available: false,
      reason: "no_data",
    });
    expect(res.streams.find((s) => s.streamId === "lifecycle")?.reason).toBe("no_data");
    expect(wpisHuba(res, "mrr").canonicalValue).toBeNull();
    expect(res.money.mrr).toBeUndefined();
  });

  it("`null` ≠ 0: zmierzona pusta lista to zero, brak listy to brak danych", async () => {
    const zero = await wywolajHub(
      klientHuba({
        rpc: { admin_revenue_semantic_snapshot: () => ok({ ...SNAPSHOT_HUBA, mrr: [] }) },
      }),
    );
    // Waluta wiodąca (PLN) przychodzi z przychodu zrealizowanego; MRR zmierzony pusty = 0 zł.
    expect(zero.money.mrr).toEqual([]);
    expect(wpisHuba(zero, "mrr").canonicalValue).toBe(0);

    const brak = await wywolajHub(
      klientHuba({
        rpc: { admin_revenue_semantic_snapshot: () => ok({ ...SNAPSHOT_HUBA, mrr: null }) },
      }),
    );
    expect(brak.money.mrr).toBeUndefined();
    expect(wpisHuba(brak, "mrr").canonicalValue).toBeNull();
  });
});

describe("getRevenueSnapshot - wpięcia RPC odłożone do wycinków-właścicieli", () => {
  // S6 scala się przed migracjami S1-S4. Literał wywołania funkcji, której
  // nie tworzy żadna migracja, przewraca `check:rpc-contract` i pgTAP
  // `ts_sql_contract` całego PR - więc produkcja ma wpięcia `null`, a hub
  // i BI pokazują „brak danych”, nie błąd. Te testy pilnują obu stron:
  // stanu dzisiejszego i zgodności każdego przyszłego wpięcia z kontraktem.

  it("nazwy RPC domen = kontrakt §5.2; docelowe wpięcia wołają dokładnie te funkcje", async () => {
    expect(REVENUE_DOMAINS.map((d) => REVENUE_DOMAIN_RPC[d])).toEqual([...RPC_HUBA]);
    for (const domain of REVENUE_DOMAINS) {
      const k = klientHuba();
      const read = WPIECIA_DOCELOWE[domain];
      expect(read, domain).not.toBeNull();
      await read?.(k.klient, {
        sinceIso: ZAKRES_HUBA.current.sinceIso,
        untilIso: ZAKRES_HUBA.current.untilIso,
        segment: "all",
      });
      expect(k.wywolania.map((c) => c.fn)).toEqual([REVENUE_DOMAIN_RPC[domain]]);
    }
  });

  it("każde wpięcie produkcyjne (gdy właściciel je doda) woła SWOJĄ funkcję z kluczami kontraktu", async () => {
    for (const domain of REVENUE_DOMAINS) {
      const read = REVENUE_DOMAIN_READS[domain];
      if (read === null) continue;
      const okno = {
        sinceIso: ZAKRES_HUBA.current.sinceIso,
        untilIso: ZAKRES_HUBA.current.untilIso,
        segment: "b2c_individual" as const,
      };
      const produkcja = klientHuba();
      const docelowo = klientHuba();
      await read(produkcja.klient, okno);
      await WPIECIA_DOCELOWE[domain]?.(docelowo.klient, okno);
      expect(produkcja.wywolania, domain).toEqual(docelowo.wywolania);
    }
  });

  it("admin przed migracjami: zero RPC poza `has_role`, strumienie `not_configured`, bez ostrzeżeń", async () => {
    const k = klientHuba();
    const res = await wywolajHubProdukcyjny(k);
    const niewpiete = REVENUE_DOMAINS.filter((d) => REVENUE_DOMAIN_READS[d] === null);
    const wolane = new Set(k.huba().map((c) => c.fn));
    for (const domain of niewpiete) expect(wolane.has(REVENUE_DOMAIN_RPC[domain])).toBe(false);
    expect(res.role).toBe("admin");
    if (niewpiete.length === REVENUE_DOMAINS.length) {
      expect(k.huba()).toEqual([]);
      expect(res.streams).toEqual(
        ["billing", "lifecycle", "community", "newsletter"].map((streamId) => ({
          streamId,
          available: false,
          reason: "not_configured",
        })),
      );
      // Brak danych to `null`, nigdy zero - kafel pokaże kreskę, nie „0 zł”.
      expect(res.entries.every((e) => e.canonicalValue === null)).toBe(true);
      expect(res.money).toEqual({});
      expect(res.dataSince).toBeNull();
    }
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("editor przed migracjami: rozliczenia `admin_only`, reszta `not_configured`", async () => {
    const res = await wywolajHubProdukcyjny(klientHuba({ rola: "editor" }));
    expect(res.role).toBe("editor");
    expect(res.streams.find((s) => s.streamId === "billing")?.reason).toBe("admin_only");
    if (REVENUE_DOMAINS.every((d) => REVENUE_DOMAIN_READS[d] === null)) {
      expect(
        res.streams.filter((s) => s.reason === "not_configured").map((s) => s.streamId),
      ).toEqual(["lifecycle", "community", "newsletter"]);
    }
  });
});

describe("revenueRaw - parsery i kontrakt `*_KEYS`", () => {
  it("zdrowie poczty: kształt S1 (`campaigns`/`list`/`doi`) = ten sam wynik co płaski (Z-S7-10, Z-S6-17)", () => {
    const zagniezdzony = {
      since: "2026-10-01T00:00:00Z",
      until: "2026-11-01T00:00:00Z",
      campaigns: {
        sent: 10_100,
        delivered: 10_000,
        unique_opens: 4_000,
        unique_clicks: 500,
        hard_bounces: 50,
        soft_bounces: 150,
        complaints: 5,
        unsubscribes: 30,
      },
      list: { start: 10_000, end: 9_980, new: 10, unsubscribed: 30, net_growth: "-20" },
      doi: { started: 100, confirmed_7d: 70 },
    };
    expect(parseRevenueEmailHealth(zagniezdzony)).toEqual(parseRevenueEmailHealth(EMAIL));
    // Brak grupy = brak liczb tej grupy, nie zero.
    expect(parseRevenueEmailHealth({ campaigns: { delivered: 5 } })?.counts.list_base).toBeNull();
  });

  it("parsery trzymają kontrakt: pola wyniku = klucze `*_KEYS`", () => {
    const s = parseRevenueSemanticSnapshot(SNAPSHOT_HUBA);
    expect(Object.keys(s?.money ?? {})).toEqual([...REVENUE_SNAPSHOT_KEYS.money]);
    expect(Object.keys(s?.movements ?? {})).toEqual([...REVENUE_SNAPSHOT_KEYS.movements]);
    expect(Object.keys(s?.counts ?? {})).toEqual([...REVENUE_SNAPSHOT_KEYS.counts]);
    expect(Object.keys(s?.rates ?? {}).sort()).toEqual(
      [
        ...REVENUE_SNAPSHOT_KEYS.fractions,
        ...REVENUE_SNAPSHOT_KEYS.nonNegative,
        ...REVENUE_SNAPSHOT_KEYS.signed,
      ].sort(),
    );
    const f = parseRevenueFunnel(LEJEK);
    expect(Object.keys(f?.counts ?? {})).toEqual([...REVENUE_FUNNEL_KEYS.counts]);
    expect(Object.keys(f?.rates ?? {})).toEqual([...REVENUE_FUNNEL_KEYS.fractions]);
    expect(Object.keys(parseRevenueEventsSummary(WYDARZENIA)?.counts ?? {})).toEqual([
      ...REVENUE_EVENTS_KEYS.counts,
    ]);
    const c = parseRevenueClubsSummary(KLUBY);
    expect(Object.keys(c?.counts ?? {})).toEqual([...REVENUE_CLUBS_KEYS.counts]);
    expect(Object.keys(c?.applications ?? {})).toEqual([...REVENUE_CLUBS_KEYS.applications]);
    expect(Object.keys(parseRevenueEmailHealth(EMAIL)?.counts ?? {})).toEqual([
      ...REVENUE_EMAIL_KEYS.counts,
    ]);
  });

  it("kontrakt nazw kluczy jest przypięty literalnie (Z-S6-05)", () => {
    expect(REVENUE_SNAPSHOT_KEYS.meta).toEqual(["data_since", "computed_at", "basis_mix"]);
    expect(REVENUE_FUNNEL_KEYS.separate).toEqual(["visitors_first_party"]);
    expect(REVENUE_EVENTS_KEYS.byCurrency).toEqual(["currency", "ticket_revenue_net_minor"]);
    expect(REVENUE_CLUBS_KEYS.hours).toEqual(["decision_hours_median"]);
    expect(REVENUE_EMAIL_KEYS.signed).toEqual(["list_net_growth"]);
  });

  it("odpowiedź, która nie jest obiektem, to `null` u każdego parsera", () => {
    for (const raw of [null, undefined, "x", 42, [1, 2]]) {
      expect(parseRevenueSemanticSnapshot(raw)).toBeNull();
      expect(parseRevenueFunnel(raw)).toBeNull();
      expect(parseRevenueEventsSummary(raw)).toBeNull();
      expect(parseRevenueClubsSummary(raw)).toBeNull();
      expect(parseRevenueEmailHealth(raw)).toBeNull();
    }
  });

  it("zepsute pole gaśnie samo: ułamek > 1, ujemna liczność, połowa pary, waluta małymi literami", () => {
    const s = parseRevenueSemanticSnapshot({
      ...SNAPSHOT_HUBA,
      trial_to_paid_rate: 1.7,
      active_subscriptions: -4,
      customers_start: 10.5,
      basis_mix: { provider: 0.8 },
      mrr: [{ currency: "pln", amount_minor: 100 }],
      movements: "brak",
      data_since: "wczoraj",
    });
    expect(s?.rates.trial_to_paid_rate).toBeNull();
    expect(s?.counts.active_subscriptions).toBeNull();
    expect(s?.counts.customers_start).toBeNull();
    expect(s?.basisMix).toBeNull();
    expect(s?.money.mrr).toBeNull();
    expect(s?.movements).toBeNull();
    expect(s?.dataSince).toBeNull();
    // Pola zdrowe obok zostają.
    expect(s?.rates.net_revenue_retention).toBe(1.04);
    expect(s?.counts.customers_churned).toBe(3);
  });

  it("liczby z Postgresa jako napisy są liczbami; pusty napis i `true` nie", () => {
    const e = parseRevenueEmailHealth({
      ...EMAIL,
      delivered: "10000",
      complaints: "",
      unsubscribes: true,
    });
    expect(e?.counts.delivered).toBe(10_000);
    expect(e?.counts.complaints).toBeNull();
    expect(e?.counts.unsubscribes).toBeNull();
    expect(e?.listNetGrowth).toBe(-20);
  });

  it("bilety: kwota per waluta z `ticket_revenue_net_minor`; zła pozycja gasi całą listę", () => {
    expect(parseRevenueEventsSummary(WYDARZENIA)?.ticketRevenue).toEqual([
      { currency: "PLN", amountMinor: 300_000 },
    ]);
    expect(
      parseRevenueEventsSummary({
        ...WYDARZENIA,
        by_currency: [{ currency: "PLN", ticket_revenue_net_minor: 1.5 }],
      })?.ticketRevenue,
    ).toBeNull();
    // Editor dostaje `null` z SQL - brak kwot, nie zero.
    expect(
      parseRevenueEventsSummary({ ...WYDARZENIA, by_currency: null })?.ticketRevenue,
    ).toBeNull();
    expect(parseRevenueEventsSummary({ ...WYDARZENIA, by_currency: [] })?.ticketRevenue).toEqual(
      [],
    );
  });

  it("każda obserwacja pochodzi ze strumienia, który metryka ZNA, a autorytatywny jest zawsze obecny", () => {
    const pelny = {
      snapshot: parseRevenueSemanticSnapshot(SNAPSHOT_HUBA),
      funnel: parseRevenueFunnel(LEJEK),
      events: parseRevenueEventsSummary(WYDARZENIA),
      clubs: parseRevenueClubsSummary(KLUBY),
      email: parseRevenueEmailHealth(EMAIL),
      window: { days: 31, annual: false },
    };
    for (const { metricId, observations } of revenueObservations(pelny)) {
      expect(
        observations.some((o) => o.streamId === authoritativeBinding(metricId).streamId),
        metricId,
      ).toBe(true);
      for (const o of observations) {
        expect(bindingFor(metricId, o.streamId), `${metricId} <- ${o.streamId}`).toBeDefined();
      }
    }
    // Ilorazy liczone w TS też należą do rejestru i do migawki.
    for (const r of revenueRatios(pelny)) {
      expect(REVENUE_SNAPSHOT_METRICS as readonly string[]).toContain(r.metricId);
    }
  });

  it("metryki migawki to podciąg metryk huba w kolejności SPEC", () => {
    const pozycje = REVENUE_SNAPSHOT_METRICS.map((id) => HUB_METRIC_IDS.indexOf(id));
    expect(pozycje.every((p) => p >= 0)).toBe(true);
    expect([...pozycje].sort((a, b) => a - b)).toEqual(pozycje);
    // Metryki pieniężne niosą kwotę, reszta - liczbę; żadna nie jest spoza rejestru.
    for (const id of REVENUE_SNAPSHOT_METRICS) expect(metricById(id).id).toBe(id);
  });
});

describe("revenueSnapshotQueryOptions", () => {
  it("klucz z fabryki huba, z walutą i segmentem w stałych pozycjach", () => {
    const o = revenueSnapshotQueryOptions("t1", ZAKRES_HUBA, { currency: "EUR" });
    expect(o.queryKey).toEqual(
      revenueKeys.query("snapshot", "t1", ZAKRES_HUBA, { currency: "EUR", segment: null }),
    );
    expect(o.enabled).toBe(true);
    expect(o.retry).toBe(1);
    expect(o.gcTime).toBe(10 * 60_000);
    expect(o.placeholderData).toBe(keepPreviousData);
  });

  it("okno rosnące świeże minutę, domknięte - 30 minut", () => {
    expect(revenueSnapshotQueryOptions("t1", ZAKRES_HUBA).staleTime).toBe(60_000);
    expect(revenueSnapshotQueryOptions("t1", { ...ZAKRES_HUBA, complete: true }).staleTime).toBe(
      30 * 60_000,
    );
  });

  it("bez najemcy zapytanie nie rusza", () => {
    expect(revenueSnapshotQueryOptions(null, ZAKRES_HUBA).enabled).toBe(false);
  });
});
