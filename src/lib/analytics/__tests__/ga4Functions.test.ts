// PO CO TEN PLIK. `ga4.functions.ts` to dwie serwerowe funkcje, przez które
// panel BI ODCZYTUJE liczby z płatnego Data API Google'a (`runGa4Report`)
// i WYSYŁA zdarzenia po stronie serwera (`sendGa4Event`). Wchodzi tu z zerem
// pokrycia (0 z 38 linii), mimo że warstwa niżej (`ga4.server.ts`, podpisy JWT
// i cache tokenów) ma własny komplet testów. To najgorszy możliwy podział:
// silnik dowiedziony, okablowanie - nie.
//
// Pięć klas defektów, których nikt tu dotąd nie łapał:
//
//  1) BRAMKA PO ODCZYCIE ALBO PO WYSYŁCE. Kolejność w handlerze jest
//     kontraktem: `requireAnalyticsAdmin` MUSI zamknąć drogę zanim poleci
//     odczyt ustawień najemcy, zanim powstanie token do Google i zanim
//     `sendGa4Event` wyśle cokolwiek do GA4. Odwrócenie tej kolejności nie
//     wywala niczego - odmowa nadal wraca do przeglądarki, tyle że po
//     zapisaniu zdarzenia w cudzej własności GA4. Testy niżej dowodzą pustki:
//     zero odczytów, zero `fetch`, zero prób tokenu.
//
//  2) BRAK KONFIGURACJI JAKO AWARIA. Świeża instalacja nie ma ani property,
//     ani sekretów. Kontrakt: `EMPTY_GA4_REPORT` z `configured: false`
//     i pustymi tablicami, nie rzut - inaczej pierwszy widget wywraca cały
//     dashboard, zanim ktokolwiek zdąży cokolwiek podłączyć. To samo dla
//     wysyłki: `{ ok: false, configured: false }` z podpowiedzią, nie wyjątek.
//
//  3) KILL SWITCH, KTÓRY NIE WYŁĄCZA. `ga4_enabled === false` to „Odłącz"
//     kliknięte przez admina TEGO najemcy. Musi zatrzymać przepływ PRZED
//     pobraniem tokenu - inaczej odłączenie jest kosmetyczne, a Google i tak
//     dostaje kwerendę.
//
//  4) SEKRET W ODPOWIEDZI. Do Google leci bearer token w nagłówku
//     `Authorization` i `api_secret` w URL-u Measurement Protocol. Odpowiedź
//     błędu jest sklejana z tekstu od Google i wraca DO PRZEGLĄDARKI - więc
//     każda z tych dwóch ścieżek to potencjalny wyciek materiału
//     uwierzytelniającego do konsoli admina i do logów frontendu. Testy
//     sprawdzają CAŁĄ zserializowaną odpowiedź, nie samo pole `error`.
//
//  5) GRANICE WEJŚCIA. `limit` i liczba wymiarów jadą wprost do płatnego API.
//     Brak granicy to kwerenda, której nikt nie zamawiał; zły domyślny zakres
//     dat to cichy fałsz na kafelkach KPI.
//
// IZOLACJA NAJEMCÓW. Property GA4 pochodzi z `site_settings` KONKRETNEGO
// najemcy, czytanych klientem wołającego (czyli przez RLS). Testy przepuszczają
// dwóch adminów dwóch najemców przez tę samą funkcję w jednym przebiegu
// i sprawdzają, że każdy zapytał Google o SWOJE property - pomyłka na tym
// poziomie to pokazanie jednemu klientowi liczb drugiego.
//
// CO JEST ATRAPĄ, A CO PRAWDĄ. Atrapą jest WYŁĄCZNIE `resolveGa4AccessToken`
// (jedyna funkcja wymagająca materiału uwierzytelniającego) oraz `fetch`.
// `runGa4DataApiReport`, `resolveGa4PropertyId`, `EMPTY_GA4_REPORT` i cała
// bramka (`gateway.server.ts`) są PRAWDZIWE - bo pytanie „czy błąd Google
// dojeżdża do panelu jako pole `error`, a nie jako wywrotka" ma sens tylko
// wtedy, gdy przechodzi przez prawdziwy kod mapujący odpowiedź. Testy samej
// warstwy `ga4.server.ts` (podpis JWT, cache, wymiana tokenu) mieszkają
// w `__tests__/ga4Server.test.ts` i nie są tu powtarzane.
//
// CZEGO TU NIE MA. Middleware `requireSupabaseAuth` nie jest uruchamiane
// (`serverFnStubModule` go nie wykonuje), więc zieleń tego pliku mówi „handler
// robi to, co obiecuje", a nie „obcy się nie dostanie".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callServerFn, validateServerFnInput, type ServerFnContext } from "@/test/serverFnHarness";
import type { Ga4AuthSource, Ga4Report } from "../ga4.server";
import type { Ga4MpResult } from "../ga4.functions";

const H = vi.hoisted(() => ({
  resolveGa4AccessToken: vi.fn<() => Promise<{ token: string; source: Ga4AuthSource } | null>>(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/analytics/ga4.server", async () => {
  const actual = await vi.importActual<typeof import("../ga4.server")>(
    "@/lib/analytics/ga4.server",
  );
  return { ...actual, resolveGa4AccessToken: H.resolveGa4AccessToken };
});

const { runGa4Report, sendGa4Event } = await import("../ga4.functions");

// ---------------------------------------------------------------------------
// Stałe
// ---------------------------------------------------------------------------

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";
const REDAKTOR_A = "55555555-5555-4555-8555-555555555555";

/** Kto jest adminem i W KTÓRYM najemcy - odpowiednik filtra `current_tenant_id()`. */
const ROLA_ADMINA: Record<string, string> = { [ADMIN_A]: TENANT_A, [ADMIN_B]: TENANT_B };

const PROPERTY_A = "100000001";
const PROPERTY_B = "100000002";

/** Jawnie testowe napisy - w repozytorium nie ma i nie może być prawdziwych. */
const TOKEN = "bearer-tylko-do-testu-3f9a";
const MP_SECRET = "sekret-mp-tylko-do-testu-77b2";
const MEASUREMENT_ID = "G-TESTOWY";

/** Wszystko, co ten przepływ czyta ze środowiska. */
const KLUCZE_ENV = [
  "GA4_PROPERTY_ID",
  "GA4_MEASUREMENT_ID",
  "GA4_API_SECRET",
  "GA4_SERVICE_ACCOUNT_JSON",
  "GA4_OAUTH_CLIENT_ID",
  "GA4_OAUTH_CLIENT_SECRET",
  "GA4_OAUTH_REFRESH_TOKEN",
] as const;

const PUSTY_RAPORT: Ga4Report = {
  configured: false,
  dimensionHeaders: [],
  metricHeaders: [],
  rows: [],
  totals: [],
};

const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

// ---------------------------------------------------------------------------
// Klienci najemców
// ---------------------------------------------------------------------------

interface StoredAnalytics {
  ga4_enabled?: boolean;
  ga4_property_id?: string;
  ga4_measurement_id?: string;
}

interface OpcjeNajemcy {
  readonly settings?: StoredAnalytics | null;
  readonly settingsError?: string;
  readonly hasRoleError?: string;
}

interface Najemca {
  readonly ctx: ServerFnContext;
  readonly odczyty: Array<{ table: string; columns: string; filtr: [string, string] }>;
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
}

function najemca(tenant: string, userId: string, opcje: OpcjeNajemcy = {}): Najemca {
  const odczyty: Najemca["odczyty"] = [];
  const rpcCalls: Najemca["rpcCalls"] = [];

  const supabase = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          odczyty.push({ table, columns, filtr: [column, value] });
          if (opcje.settingsError) {
            return Promise.resolve({ data: null, error: { message: opcje.settingsError } });
          }
          return Promise.resolve({ data: [{ value: opcje.settings ?? null }], error: null });
        },
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (opcje.hasRoleError) {
        return Promise.resolve({ data: null, error: { message: opcje.hasRoleError } });
      }
      return Promise.resolve({
        data: ROLA_ADMINA[String(args._user_id)] === tenant && args._role === "admin",
        error: null,
      });
    },
  };

  return { ctx: { supabase, userId }, odczyty, rpcCalls };
}

/** Admin najemcy A z property zapisanym w bazie - najczęstszy układ. */
function adminZProperty(property = PROPERTY_A, over: StoredAnalytics = {}): Najemca {
  return najemca(TENANT_A, ADMIN_A, { settings: { ga4_property_id: property, ...over } });
}

// ---------------------------------------------------------------------------
// Atrapa sieci
// ---------------------------------------------------------------------------

function odpowiedz(status: number, body: string): Response {
  return new Response(body, { status });
}

/**
 * Ciało `Response` czyta się DOKŁADNIE RAZ, a część przypadków woła sieć dwa
 * razy (dwóch najemców). Atrapa buduje odpowiedź przy KAŻDYM wywołaniu -
 * wspólna instancja padałaby na „Body has already been used" i udawała defekt
 * kodu produkcyjnego.
 */
function zawsze(buduj: () => Response): void {
  fetchMock.mockImplementation(() => Promise.resolve(buduj()));
}

function json(body: unknown, status = 200): void {
  zawsze(() => odpowiedz(status, JSON.stringify(body)));
}

function zadanie(i = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url: String(url), init };
}

function cialo(i = 0): Record<string, unknown> {
  return JSON.parse(String(zadanie(i).init.body)) as Record<string, unknown>;
}

/** Odpowiedź Data API w kształcie, jaki zwraca `properties/{id}:runReport`. */
const ODPOWIEDZ_DATA_API = {
  dimensionHeaders: [{ name: "date" }],
  metricHeaders: [{ name: "sessions" }, { name: "activeUsers" }],
  rows: [
    { dimensionValues: [{ value: "20260801" }], metricValues: [{ value: "120" }, { value: "88" }] },
    { dimensionValues: [{ value: "20260802" }], metricValues: [{ value: "97" }, { value: "71" }] },
  ],
  totals: [{ metricValues: [{ value: "217" }, { value: "159" }] }],
};

async function przechwycBlad(promise: Promise<unknown>): Promise<Error> {
  const wynik = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(wynik, "oczekiwano wyjątku, a wywołanie się powiodło").toBeInstanceOf(Error);
  return wynik as Error;
}

function raport(n: Najemca, data?: unknown): Promise<Ga4Report> {
  return callServerFn<Ga4Report>(runGa4Report, { data, context: n.ctx });
}

function wyslij(n: Najemca, data?: unknown): Promise<Ga4MpResult> {
  return callServerFn<Ga4MpResult>(sendGa4Event, { data, context: n.ctx });
}

beforeEach(() => {
  for (const klucz of KLUCZE_ENV) vi.stubEnv(klucz, undefined);
  fetchMock.mockReset();
  json(ODPOWIEDZ_DATA_API);
  vi.stubGlobal("fetch", fetchMock);
  H.resolveGa4AccessToken.mockReset();
  H.resolveGa4AccessToken.mockResolvedValue({ token: TOKEN, source: "sa" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ===========================================================================
describe("runGa4Report - bramka roli", () => {
  it("redaktor nie pobierze raportu GA4", async () => {
    const blad = await przechwycBlad(raport(najemca(TENANT_A, REDAKTOR_A)));

    expect(blad.message).toBe("Forbidden: admin role required");
  });

  it("odmowa jest PRZED odczytem ustawień, przed tokenem i przed siecią", async () => {
    const redaktor = najemca(TENANT_A, REDAKTOR_A, { settings: { ga4_property_id: PROPERTY_A } });

    await przechwycBlad(raport(redaktor));

    expect(redaktor.odczyty).toEqual([]);
    expect(H.resolveGa4AccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin OBCEGO najemcy nie pobierze raportu tego najemcy", async () => {
    const obcy = najemca(TENANT_A, ADMIN_B, { settings: { ga4_property_id: PROPERTY_A } });

    const blad = await przechwycBlad(raport(obcy));

    expect(blad.message).toBe("Forbidden: admin role required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(obcy.rpcCalls).toEqual([
      { fn: "has_role", args: { _user_id: ADMIN_B, _role: "admin" } },
    ]);
  });

  it("błąd bazy przy sprawdzaniu roli zamyka bramkę zamiast otwierać", async () => {
    const blad = await przechwycBlad(
      raport(najemca(TENANT_A, ADMIN_A, { hasRoleError: "JWT expired" })),
    );

    expect(blad.message).toBe("JWT expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("runGa4Report - walidacja wejścia", () => {
  function waliduj(input: unknown): unknown {
    return validateServerFnInput(runGa4Report, input);
  }

  it("brak wejścia daje udokumentowany komplet wartości domyślnych", () => {
    expect(waliduj(undefined)).toEqual({
      startDate: "28daysAgo",
      endDate: "today",
      metrics: ["sessions", "activeUsers", "screenPageViews"],
      dimensions: ["date"],
      limit: 100,
    });
  });

  it("pusty obiekt jest równoważny brakowi wejścia", () => {
    expect(waliduj({})).toEqual(waliduj(undefined));
  });

  it("odrzuca limit spoza zakresu 1-1000 i limit ułamkowy", () => {
    expect(() => waliduj({ limit: 0 })).toThrow();
    expect(() => waliduj({ limit: 1001 })).toThrow();
    expect(() => waliduj({ limit: 12.5 })).toThrow();
    expect(() => waliduj({ limit: -1 })).toThrow();
  });

  it("przyjmuje skrajne dopuszczalne limity", () => {
    expect(() => waliduj({ limit: 1 })).not.toThrow();
    expect(() => waliduj({ limit: 1000 })).not.toThrow();
  });

  it("odrzuca więcej niż trzy wymiary - Data API i tak by odmówiło", () => {
    expect(() => waliduj({ dimensions: ["date", "country", "city", "browser"] })).toThrow();
    expect(() => waliduj({ dimensions: ["date", "country", "city"] })).not.toThrow();
  });

  it("odrzuca pustą nazwę wymiaru i pustą nazwę metryki", () => {
    expect(() => waliduj({ dimensions: [""] })).toThrow();
    expect(() => waliduj({ metrics: [""] })).toThrow();
  });

  it("odrzuca raport bez ani jednej metryki - to kwerenda bez sensu", () => {
    expect(() => waliduj({ metrics: [] })).toThrow();
  });

  it("dopuszcza raport BEZ wymiarów - suma okresu jest poprawnym pytaniem", () => {
    expect(() => waliduj({ dimensions: [] })).not.toThrow();
  });

  it("odrzuca metryki i wymiary podane czymś innym niż tablica napisów", () => {
    expect(() => waliduj({ metrics: "sessions" })).toThrow();
    expect(() => waliduj({ dimensions: [{ name: "date" }] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("runGa4Report - stany bez konfiguracji", () => {
  it("brak property oddaje pusty raport z configured=false, a nie wyjątek", async () => {
    await expect(raport(najemca(TENANT_A, ADMIN_A))).resolves.toEqual(PUSTY_RAPORT);
  });

  it("brak property nie kosztuje ani tokenu, ani wywołania sieci", async () => {
    await raport(najemca(TENANT_A, ADMIN_A));

    expect(H.resolveGa4AccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("samo białe znaki w zapisanym property to BRAK property", async () => {
    const wynik = await raport(najemca(TENANT_A, ADMIN_A, { settings: { ga4_property_id: "  " } }));

    expect(wynik).toEqual(PUSTY_RAPORT);
  });

  it("property jest, ale nie ma z czego zrobić tokenu - też pusty raport, nie rzut", async () => {
    H.resolveGa4AccessToken.mockResolvedValue(null);

    const wynik = await raport(adminZProperty());

    expect(wynik).toEqual(PUSTY_RAPORT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("błąd odczytu ustawień degraduje do pustego raportu zamiast wywracać panel", async () => {
    const zepsuty = najemca(TENANT_A, ADMIN_A, { settingsError: "permission denied" });

    await expect(raport(zepsuty)).resolves.toEqual(PUSTY_RAPORT);
  });

  it("pusty raport ma WSZYSTKIE cztery tablice puste - komponent robi na nich .map", async () => {
    const wynik = await raport(najemca(TENANT_A, ADMIN_A));

    expect(wynik.rows).toEqual([]);
    expect(wynik.totals).toEqual([]);
    expect(wynik.dimensionHeaders).toEqual([]);
    expect(wynik.metricHeaders).toEqual([]);
    expect(wynik.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("runGa4Report - kill switch najemcy", () => {
  it("ga4_enabled=false zatrzymuje raport z jawnym komunikatem dla admina", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", PROPERTY_A);
    const odlaczony = najemca(TENANT_A, ADMIN_A, { settings: { ga4_enabled: false } });

    await expect(raport(odlaczony)).resolves.toEqual({
      ...PUSTY_RAPORT,
      error: "GA4 wyłączone przez administratora",
    });
  });

  it("odłączenie działa PRZED tokenem i przed siecią - Google nie dostaje kwerendy", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", PROPERTY_A);

    await raport(najemca(TENANT_A, ADMIN_A, { settings: { ga4_enabled: false } }));

    expect(H.resolveGa4AccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("odłączenie u jednego najemcy nie zatrzymuje raportu drugiego", async () => {
    const a = najemca(TENANT_A, ADMIN_A, {
      settings: { ga4_enabled: false, ga4_property_id: PROPERTY_A },
    });
    const b = najemca(TENANT_B, ADMIN_B, {
      settings: { ga4_enabled: true, ga4_property_id: PROPERTY_B },
    });

    const wynikA = await raport(a);
    const wynikB = await raport(b);

    expect(wynikA.error).toBe("GA4 wyłączone przez administratora");
    expect(wynikB.configured).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(zadanie(0).url).toContain(`properties/${PROPERTY_B}:runReport`);
  });
});

// ---------------------------------------------------------------------------
describe("runGa4Report - kształt żądania do Data API", () => {
  it("pyta o property najemcy i przenosi komplet parametrów raportu", async () => {
    await raport(adminZProperty(), {
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      metrics: ["sessions", "activeUsers"],
      dimensions: ["date", "country"],
      limit: 250,
    });

    expect(zadanie().url).toBe(
      `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_A}:runReport`,
    );
    expect(cialo()).toEqual({
      dateRanges: [{ startDate: "2026-08-01", endDate: "2026-08-28" }],
      dimensions: [{ name: "date" }, { name: "country" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      limit: "250",
    });
  });

  it("wartości domyślne walidatora dojeżdżają do Google w niezmienionej postaci", async () => {
    await raport(adminZProperty());

    expect(cialo()).toEqual({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }],
      limit: "100",
    });
  });

  it("uwierzytelnia się tokenem z resolwera, nie własnym nagłówkiem", async () => {
    await raport(adminZProperty());

    const naglowki = zadanie().init.headers as Record<string, string>;
    expect(naglowki.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(naglowki["Content-Type"]).toBe("application/json");
  });

  it("sekret GA4_PROPERTY_ID ma pierwszeństwo nad property z bazy", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "900000009");

    await raport(adminZProperty());

    expect(zadanie().url).toContain("properties/900000009:runReport");
  });

  it("KAŻDY najemca pyta o SWOJE property - odczyt idzie klientem wołającego", async () => {
    const a = najemca(TENANT_A, ADMIN_A, { settings: { ga4_property_id: PROPERTY_A } });
    const b = najemca(TENANT_B, ADMIN_B, { settings: { ga4_property_id: PROPERTY_B } });

    const wynikA = await raport(a);
    const wynikB = await raport(b);

    expect(zadanie(0).url).toContain(`properties/${PROPERTY_A}:runReport`);
    expect(zadanie(1).url).toContain(`properties/${PROPERTY_B}:runReport`);
    expect(wynikA.propertyId).toBe(PROPERTY_A);
    expect(wynikB.propertyId).toBe(PROPERTY_B);
    // Ustawienia czytał klient KAŻDEGO z nich z osobna, filtrem po kluczu.
    expect(a.odczyty).toEqual([
      { table: "site_settings", columns: "value", filtr: ["key", "analytics"] },
    ]);
    expect(b.odczyty).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("runGa4Report - mapowanie odpowiedzi", () => {
  it("nagłówki, wiersze i totale lądują w udokumentowanym kształcie", async () => {
    const wynik = await raport(adminZProperty());

    expect(wynik).toEqual({
      configured: true,
      propertyId: PROPERTY_A,
      dimensionHeaders: ["date"],
      metricHeaders: ["sessions", "activeUsers"],
      rows: [
        { dims: ["20260801"], metrics: ["120", "88"] },
        { dims: ["20260802"], metrics: ["97", "71"] },
      ],
      totals: ["217", "159"],
    });
  });

  it("odpowiedź bez wierszy (okres bez ruchu) daje puste tablice, nie undefined", async () => {
    json({ dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }] });

    const wynik = await raport(adminZProperty());

    expect(wynik).toEqual({
      configured: true,
      propertyId: PROPERTY_A,
      dimensionHeaders: ["date"],
      metricHeaders: ["sessions"],
      rows: [],
      totals: [],
    });
  });

  it("całkowicie pusta odpowiedź Data API nadal jest raportem skonfigurowanym", async () => {
    json({});

    const wynik = await raport(adminZProperty());

    expect(wynik.configured).toBe(true);
    expect(wynik.error).toBeUndefined();
    expect(wynik.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("runGa4Report - błąd nie wywraca dashboardu", () => {
  it("odmowa Google trafia do pola error, a wywołanie NIE rzuca", async () => {
    zawsze(() => odpowiedz(403, "User does not have sufficient permissions for this property."));

    const wynik = await raport(adminZProperty());

    expect(wynik.error).toBe(
      "GA4 403: User does not have sufficient permissions for this property.",
    );
    expect(wynik.configured).toBe(true);
    expect(wynik.propertyId).toBe(PROPERTY_A);
    expect(wynik.rows).toEqual([]);
  });

  it("zerwana sieć też kończy się polem error, a nie wyjątkiem", async () => {
    fetchMock.mockRejectedValue(new Error("workerd: subrequest failed"));

    await expect(raport(adminZProperty())).resolves.toMatchObject({
      error: "workerd: subrequest failed",
      configured: true,
    });
  });

  it("zdeformowana odpowiedź (HTML zamiast JSON) też degraduje do pola error", async () => {
    zawsze(() => odpowiedz(200, "<html>503</html>"));

    const wynik = await raport(adminZProperty());

    expect(wynik.error).toBeTruthy();
    expect(wynik.rows).toEqual([]);
  });

  it("BEARER TOKEN nie wycieka do odpowiedzi na żadnej ścieżce błędu", async () => {
    zawsze(() => odpowiedz(401, "Request had invalid authentication credentials."));

    const wynik = await raport(adminZProperty());

    // Dowód, że token NAPRAWDĘ był w grze - inaczej jego brak w odpowiedzi
    // nie znaczyłby nic.
    expect((zadanie().init.headers as Record<string, string>).Authorization).toContain(TOKEN);
    expect(JSON.stringify(wynik)).not.toContain(TOKEN);
  });
});

// ===========================================================================
describe("sendGa4Event - bramka roli", () => {
  it("redaktor nie wyśle zdarzenia do GA4", async () => {
    const blad = await przechwycBlad(wyslij(najemca(TENANT_A, REDAKTOR_A)));

    expect(blad.message).toBe("Forbidden: admin role required");
  });

  it("odmowa jest PRZED odczytem ustawień i przed wysyłką", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    vi.stubEnv("GA4_API_SECRET", MP_SECRET);
    const redaktor = najemca(TENANT_A, REDAKTOR_A);

    await przechwycBlad(wyslij(redaktor));

    expect(redaktor.odczyty).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin OBCEGO najemcy nie wyśle zdarzenia w imieniu tego najemcy", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    vi.stubEnv("GA4_API_SECRET", MP_SECRET);

    const blad = await przechwycBlad(wyslij(najemca(TENANT_A, ADMIN_B)));

    expect(blad.message).toBe("Forbidden: admin role required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("sendGa4Event - walidacja wejścia", () => {
  function waliduj(input: unknown): unknown {
    return validateServerFnInput(sendGa4Event, input);
  }

  it("brak wejścia daje udokumentowany komplet wartości domyślnych", () => {
    expect(waliduj(undefined)).toEqual({
      clientId: "admin-test",
      eventName: "admin_test_event",
      params: {},
      debug: false,
    });
  });

  it("odrzuca nazwę zdarzenia dłuższą niż 40 znaków - GA4 takiej nie przyjmie", () => {
    expect(() => waliduj({ eventName: "z".repeat(41) })).toThrow();
    expect(() => waliduj({ eventName: "z".repeat(40) })).not.toThrow();
  });

  it("odrzuca pustą nazwę zdarzenia i pusty identyfikator klienta", () => {
    expect(() => waliduj({ eventName: "" })).toThrow();
    expect(() => waliduj({ clientId: "" })).toThrow();
  });

  it("parametry przyjmują wyłącznie wartości skalarne", () => {
    expect(() =>
      waliduj({ params: { kampania: "wiosna", liczba: 3, czyTest: true } }),
    ).not.toThrow();
    expect(() => waliduj({ params: { zagniezdzone: { a: 1 } } })).toThrow();
    expect(() => waliduj({ params: { pusty: null } })).toThrow();
    expect(() => waliduj({ params: { lista: ["a"] } })).toThrow();
  });

  it("odrzuca flagę debug podaną napisem", () => {
    expect(() => waliduj({ debug: "true" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("sendGa4Event - brak konfiguracji", () => {
  it("bez Measurement ID i bez sekretu oddaje stan nieskonfigurowany z podpowiedzią", async () => {
    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A));

    expect(wynik).toEqual({
      ok: false,
      configured: false,
      error: "Brak Measurement ID (ustawienia analityki) lub GA4_API_SECRET (sekret)",
    });
  });

  it("stan nieskonfigurowany nie kosztuje ani jednego wywołania sieci", async () => {
    await wyslij(najemca(TENANT_A, ADMIN_A));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sam Measurement ID bez sekretu API to nadal brak konfiguracji", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);

    await expect(wyslij(najemca(TENANT_A, ADMIN_A))).resolves.toMatchObject({
      configured: false,
      ok: false,
    });
  });

  it("sam sekret API bez Measurement ID to nadal brak konfiguracji", async () => {
    vi.stubEnv("GA4_API_SECRET", MP_SECRET);

    await expect(wyslij(najemca(TENANT_A, ADMIN_A))).resolves.toMatchObject({
      configured: false,
    });
  });

  it("podpowiedź o braku konfiguracji nie zdradza wartości sekretu", async () => {
    vi.stubEnv("GA4_API_SECRET", MP_SECRET);

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A));

    expect(JSON.stringify(wynik)).not.toContain(MP_SECRET);
  });
});

// ---------------------------------------------------------------------------
describe("sendGa4Event - wysyłka", () => {
  beforeEach(() => {
    vi.stubEnv("GA4_API_SECRET", MP_SECRET);
    zawsze(() => odpowiedz(204, ""));
  });

  it("wysyła zdarzenie na produkcyjny endpoint Measurement Protocol", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A), {
      clientId: "klient-123",
      eventName: "test_panelu",
      params: { zrodlo: "admin", liczba: 7 },
    });

    expect(wynik).toEqual({ ok: true, configured: true });
    expect(zadanie().url).toBe(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(MP_SECRET)}`,
    );
    expect(zadanie().init.method).toBe("POST");
    expect(cialo()).toEqual({
      client_id: "klient-123",
      events: [{ name: "test_panelu", params: { zrodlo: "admin", liczba: 7 } }],
    });
  });

  it("koduje Measurement ID i sekret w adresie - znak specjalny nie rozjeżdża zapytania", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", "G-A&B=C");

    await wyslij(najemca(TENANT_A, ADMIN_A));

    expect(zadanie().url).toContain("measurement_id=G-A%26B%3DC");
  });

  it("Measurement ID z ustawień najemcy działa bez sekretu środowiskowego", async () => {
    const najemcaZId = najemca(TENANT_A, ADMIN_A, {
      settings: { ga4_measurement_id: "G-NAJEMCA-A" },
    });

    const wynik = await wyslij(najemcaZId);

    expect(wynik.configured).toBe(true);
    expect(zadanie().url).toContain("measurement_id=G-NAJEMCA-A");
  });

  it("sekret GA4_MEASUREMENT_ID ma pierwszeństwo nad wpisem najemcy", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    const najemcaZId = najemca(TENANT_A, ADMIN_A, {
      settings: { ga4_measurement_id: "G-NAJEMCA-A" },
    });

    await wyslij(najemcaZId);

    expect(zadanie().url).toContain(`measurement_id=${MEASUREMENT_ID}`);
  });

  it("KAŻDY najemca wysyła na SWÓJ strumień - identyfikatory się nie mieszają", async () => {
    const a = najemca(TENANT_A, ADMIN_A, { settings: { ga4_measurement_id: "G-NAJEMCA-A" } });
    const b = najemca(TENANT_B, ADMIN_B, { settings: { ga4_measurement_id: "G-NAJEMCA-B" } });

    await wyslij(a);
    await wyslij(b);

    expect(zadanie(0).url).toContain("measurement_id=G-NAJEMCA-A");
    expect(zadanie(1).url).toContain("measurement_id=G-NAJEMCA-B");
  });

  it("tryb debug idzie na endpoint walidacyjny i oddaje odpowiedź Google", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    const walidacja = JSON.stringify({ validationMessages: [] });
    zawsze(() => odpowiedz(200, walidacja));

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A), { debug: true });

    expect(zadanie().url).toContain("/debug/mp/collect?");
    expect(wynik).toEqual({ ok: true, configured: true, debug: walidacja });
  });

  it("debug z odmową Google oddaje ok=false razem z treścią walidacji", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    zawsze(() => odpowiedz(400, "invalid measurement id"));

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A), { debug: true });

    expect(wynik).toEqual({ ok: false, configured: true, debug: "invalid measurement id" });
  });

  it("odmowa produkcyjna trafia do pola error i NIE rzuca", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    zawsze(() => odpowiedz(400, "invalid api secret"));

    await expect(wyslij(najemca(TENANT_A, ADMIN_A))).resolves.toEqual({
      ok: false,
      configured: true,
      error: "MP 400: invalid api secret",
    });
  });

  it("długa odpowiedź błędu jest przycinana do 300 znaków", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    zawsze(() => odpowiedz(500, "y".repeat(4000)));

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A));

    expect(wynik.error).toBe(`MP 500: ${"y".repeat(300)}`);
  });

  it("zerwana sieć kończy się polem error, a nie wyjątkiem", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    fetchMock.mockRejectedValue(new Error("workerd: subrequest failed"));

    await expect(wyslij(najemca(TENANT_A, ADMIN_A))).resolves.toEqual({
      ok: false,
      configured: true,
      error: "workerd: subrequest failed",
    });
  });

  it("wyjątek, który nie jest Errorem, też nie wywraca panelu", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    fetchMock.mockRejectedValue("workerd: subrequest limit");

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A));

    expect(wynik).toEqual({
      ok: false,
      configured: true,
      error: "workerd: subrequest limit",
    });
  });

  it("SEKRET MP nie wycieka do odpowiedzi na żadnej ścieżce błędu", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    zawsze(() => odpowiedz(401, "unauthorized"));

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A));

    // Dowód, że sekret NAPRAWDĘ był w grze: poleciał w adresie do Google.
    expect(zadanie().url).toContain(encodeURIComponent(MP_SECRET));
    expect(JSON.stringify(wynik)).not.toContain(MP_SECRET);
  });

  it("sekret MP nie wycieka także przez odpowiedź trybu debug", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", MEASUREMENT_ID);
    zawsze(() => odpowiedz(200, JSON.stringify({ validationMessages: [] })));

    const wynik = await wyslij(najemca(TENANT_A, ADMIN_A), { debug: true });

    expect(JSON.stringify(wynik)).not.toContain(MP_SECRET);
  });
});
