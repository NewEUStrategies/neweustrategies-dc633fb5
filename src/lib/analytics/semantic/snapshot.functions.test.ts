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
  METRICS,
  STREAMS,
  authoritativeBinding,
  previousWindow,
  resolveCustomWindow,
  resolveWindow,
  streamById,
  windowsOverlap,
  type MetricId,
  type ReconciliationEntry,
  type StreamId,
} from ".";
import { asServerFn, callServerFn } from "@/test/serverFnHarness";
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
    signed_in_users: 90,
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
    const wlasne = METRICS.filter((m) => authoritativeBinding(m.id).streamId === "content_views");
    expect(wlasne.map((m) => m.id)).toEqual(["content_views", "related_clicks", "reads"]);
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
