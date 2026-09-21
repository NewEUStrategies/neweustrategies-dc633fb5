// WARSTWA PORZĄDKUJĄCA DANE dashboardu RUM - `getVitalsSummary`.
// Do dziś: 0 z 33 linii, mimo że sama agregacja (`aggregate.ts`) ma 100%.
//
// PO CO. Agregator jest czystą matematyką i nie wie NIC o tym, czyje wiersze
// dostał. Cała reszta - kto ma prawo pytać, o jakie okno i o CZYJE dane -
// mieszka wyłącznie tutaj, w handlerze, i do tej pory nie była dotknięta
// żadnym testem. Ta klasa defektów jest cicha i kosztowna:
//
//   1. WYCIEK MIĘDZY WORKSPACE'AMI. `web_vitals` ma RLS bez polityk, więc
//      odczyt leci przez `supabaseAdmin` (service role OMIJA RLS). Jedyną
//      granicą tenanta jest jawne `.eq("tenant_id", …)` w DWÓCH zapytaniach
//      i argument `p_tenant` w RPC. Zgubienie któregokolwiek nie wywala
//      niczego - dashboard po prostu zaczyna pokazywać ŚCIEŻKI URL cudzego
//      serwisu, czyli dane użytkowników obcego workspace'u.
//   2. BRAMKA ADMINA PO ODCZYCIE. Gdyby `has_role` sprawdzało się dopiero po
//      pobraniu wierszy, odmowa i tak przeczytałaby cudzą telemetrię -
//      dlatego testy niżej dowodzą, że przy odmowie `supabaseAdmin` NIE
//      ZOSTAŁ TKNIĘTY (zero łańcuchów, zero RPC, zero rozwiązywania tenanta).
//   3. CICHA NIEPRAWDA W LICZBACH. `windowTotal` to COUNT z bazy, a nie
//      długość (przyciętej!) próbki - pomyłka tutaj zaniża raport o rzędy
//      wielkości i nikt tego nie zauważy, bo liczba nadal wygląda sensownie.
//   4. 500 ZAMIAST PUSTEGO RAPORTU. Handler świadomie połyka błędy ODCZYTU
//      (brak migracji na danej bazie), ale NIE błędy autoryzacji. Odwrócenie
//      tej reguły albo rozlewa 500-kę na cały panel, albo - gorzej - zamienia
//      odmowę dostępu w „brak danych".
//
// CZEGO TEN PLIK NIE DOWODZI: middleware. `requireSupabaseAuth` jest atrapą
// (patrz `src/test/serverFnHarness.ts`), a kompletu bramek pilnuje osobna
// bramka statyczna. Tu odpowiadamy na pytanie „czy handler porządkuje dane
// poprawnie", nie „czy ktoś obcy w ogóle wejdzie".
//
// HARNESS: `serverFnHarness` (styl specyfikacyjny), a nie `serverFn` -
// kontekst podaje się PRZY WYWOŁANIU, więc dwóch różnych wołających da się
// przepuścić przez tę samą funkcję w jednym teście. To warunek konieczny
// dowodu izolacji tenantów, którego wariant modułowy (`setServerFnContext`)
// nie daje bez przestawiania globalnego stanu między asercjami.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { callServerFn, validateServerFnInput, type ServerFnContext } from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  adminFrom: null as ((table: string) => unknown) | null,
  adminRpc: null as ((name: string, args?: Record<string, unknown>) => Promise<unknown>) | null,
  /** Mapa wołający -> tenant. Pusty wpis = użytkownik bez tenanta. */
  tenantOf: {} as Record<string, string>,
  /** Zapis wywołań `resolveUserTenantId` - dowód, KTO był pytany o tenant. */
  tenantCalls: [] as Array<{ client: unknown; userId: string }>,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => h.adminFrom?.(table),
    rpc: (name: string, args?: Record<string, unknown>) => h.adminRpc?.(name, args),
  },
}));
vi.mock("@/lib/server/userTenant.server", () => ({
  resolveUserTenantId: async (client: unknown, userId: string) => {
    h.tenantCalls.push({ client, userId });
    const tenant = h.tenantOf[userId];
    // Wierne odwzorowanie produkcji: brak tenanta ZAMYKA przepływ rzutem,
    // a nie zwraca `null`, na którym zapytanie poleciałoby bez zawężenia.
    if (!tenant) throw new Error("No tenant for current user");
    return tenant;
  },
}));

// Import atrapy modułu service role - potrzebny do asercji TOŻSAMOŚCI klienta,
// którym rozwiązywany jest tenant (patrz test niżej).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getVitalsSummary, type VitalsSummaryResult } from "@/lib/observability/vitals.functions";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";
const NOMAD = "55555555-5555-4555-8555-555555555555";

/** Zegar zamrożony na równej godzinie - okna liczą się w ms od TERAZ. */
const NOW = "2026-09-01T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY_MS = 86_400_000;
/** Ogranicznik agregacji zadeklarowany w handlerze. */
const SAMPLE_CAP = 20_000;

interface VitalsRow {
  metric: string;
  value: number;
  rating: string;
  path: string;
  created_at: string;
}

/** Próbki z DWÓCH dni - trend „w pamięci" ma z czego powstać. */
const ROWS: VitalsRow[] = [
  { metric: "LCP", value: 2000, rating: "good", path: "/", created_at: "2026-08-30T10:00:00.000Z" },
  {
    metric: "LCP",
    value: 3200,
    rating: "needs-improvement",
    path: "/o-nas",
    created_at: "2026-08-31T10:00:00.000Z",
  },
  {
    metric: "CLS",
    value: 0.05,
    rating: "good",
    path: "/",
    created_at: "2026-08-31T11:00:00.000Z",
  },
];

let admin: SupabaseFromStub;
let adminRpc: SupabaseRpcStub;
let userRpc: SupabaseRpcStub;
let warn: ReturnType<typeof vi.spyOn>;

/**
 * Zapytanie LICZĄCE i zapytanie WIERSZOWE idą do TEJ SAMEJ tabeli, więc
 * responder musi je rozróżnić. Rozróżnia je `head: true` w opcjach `select` -
 * dokładnie ta opcja, która sprawia, że PostgREST nie odsyła wierszy.
 */
function isCountQuery(chain: RecordedChain): boolean {
  const options = chain.argsOf("select")?.[1] as { head?: boolean } | undefined;
  return options?.head === true;
}

interface VitalsPlan {
  rows?: VitalsRow[] | null;
  count?: number | null;
  countError?: string;
  rowsError?: string;
}

function planVitals(plan: VitalsPlan = {}): void {
  const rows = plan.rows === undefined ? [] : plan.rows;
  admin.setResponse("web_vitals", (chain): SupabaseResult => {
    if (isCountQuery(chain)) {
      if (plan.countError) return fail(plan.countError);
      return {
        data: null,
        error: null,
        count: plan.count === undefined ? (rows?.length ?? 0) : plan.count,
      };
    }
    return plan.rowsError ? fail(plan.rowsError) : ok(rows);
  });
}

function context(userId: string): ServerFnContext {
  return { supabase: { rpc: userRpc.rpc }, userId };
}

function summary(data?: unknown, userId: string = ADMIN_A): Promise<VitalsSummaryResult> {
  return callServerFn<VitalsSummaryResult>(getVitalsSummary, { data, context: context(userId) });
}

/** Argumenty `eq` z każdego łańcucha `web_vitals`, w kolejności wywołań. */
function tenantFilters(): unknown[][] {
  return admin.chainsFor("web_vitals").map((c) => [...(c.argsOf("eq") ?? [])]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  admin = supabaseFromStub();
  adminRpc = supabaseRpcStub();
  userRpc = supabaseRpcStub();
  h.adminFrom = admin.from;
  h.adminRpc = adminRpc.rpc;
  h.tenantOf = { [ADMIN_A]: TENANT_A, [ADMIN_B]: TENANT_B };
  h.tenantCalls.length = 0;
  userRpc.setData("has_role", true);
  // Domyślnie baza jest „starsza" i nie zna funkcji trendu - handler ma wtedy
  // zostać przy trendzie liczonym w pamięci. Testy trendu nadpisują to jawnie.
  adminRpc.setError("web_vitals_daily_p75", "function web_vitals_daily_p75 does not exist");
  planVitals({ rows: ROWS });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// Bramka admina - musi zadziałać PRZED jakimkolwiek dotknięciem danych
// ---------------------------------------------------------------------------

describe("getVitalsSummary - bramka admina", () => {
  it("brak roli admina kończy się odmową, a nie pustym raportem", async () => {
    userRpc.setData("has_role", false);

    await expect(summary()).rejects.toThrow("Forbidden");
  });

  it("odmowa NIE tyka service role - zero zapytań, zero RPC, zero pytań o tenant", async () => {
    userRpc.setData("has_role", false);

    await expect(summary()).rejects.toThrow("Forbidden");
    // Gdyby bramka stała po odczycie, cudza telemetria byłaby już w pamięci
    // procesu - odmowa dotyczyłaby tylko odpowiedzi, nie dostępu.
    expect(admin.chains).toHaveLength(0);
    expect(adminRpc.calls).toHaveLength(0);
    expect(h.tenantCalls).toHaveLength(0);
  });

  it("błąd RPC bramki wychodzi WŁASNYM komunikatem, nie jako brak uprawnień", async () => {
    userRpc.setError("has_role", "permission denied for function has_role");

    // Rozróżnienie jest operacyjne: „Forbidden" to decyzja, a komunikat bazy
    // to awaria do naprawy. Zlanie ich w jedno chowa zepsutą bramkę.
    await expect(summary()).rejects.toThrow("permission denied for function has_role");
    expect(admin.chains).toHaveLength(0);
  });

  it("bramka pyta o rolę WOŁAJĄCEGO, nie o rolę z wejścia", async () => {
    await summary({ days: 7 }, ADMIN_B);

    expect(userRpc.lastCall("has_role")?.args).toEqual({ _user_id: ADMIN_B, _role: "admin" });
  });
});

// ---------------------------------------------------------------------------
// Izolacja tenantów - najważniejszy kontrakt tego pliku
// ---------------------------------------------------------------------------

describe("getVitalsSummary - izolacja tenantów", () => {
  it("OBA zapytania (liczące i wierszowe) są zawężone do tenanta wołającego", async () => {
    await summary();

    // Dwa łańcuchy: COUNT i odczyt wierszy. Każdy MUSI nieść filtr tenanta -
    // service role omija RLS, więc brak `eq` to odczyt całej bazy.
    expect(tenantFilters()).toEqual([
      ["tenant_id", TENANT_A],
      ["tenant_id", TENANT_A],
    ]);
  });

  it("tenant bierze się z profilu wołającego, a klientem pytającym jest service role", async () => {
    await summary();

    expect(h.tenantCalls).toHaveLength(1);
    expect(h.tenantCalls[0].userId).toBe(ADMIN_A);
    // Tenant MUSI być czytany DOKŁADNIE klientem service role: klient
    // użytkownika widzi `profiles` przez RLS i przy niepełnej polityce oddaje
    // pusty wiersz, po którym `resolveUserTenantId` rzuca, a handler cicho
    // degraduje do pustego raportu. Zamiana klienta zamienia więc granicę
    // tenanta w losową awarię dashboardu.
    expect(h.tenantCalls[0].client).toBe(supabaseAdmin);
  });

  it("RPC trendu też dostaje tenanta wołającego - inaczej trend miesza workspace'y", async () => {
    adminRpc.setData("web_vitals_daily_p75", []);

    await summary({}, ADMIN_B);

    expect(adminRpc.lastCall("web_vitals_daily_p75")?.arg("p_tenant")).toBe(TENANT_B);
  });

  it("DWÓCH wołających - filtr idzie za wołającym, nie za pierwszym wywołaniem", async () => {
    adminRpc.setData("web_vitals_daily_p75", []);

    await summary({ days: 7 }, ADMIN_A);
    await summary({ days: 7 }, ADMIN_B);

    const filters = tenantFilters();
    expect(filters.slice(0, 2)).toEqual([
      ["tenant_id", TENANT_A],
      ["tenant_id", TENANT_A],
    ]);
    expect(filters.slice(2)).toEqual([
      ["tenant_id", TENANT_B],
      ["tenant_id", TENANT_B],
    ]);
    // Dowód wprost: w odczytach B nie ma ANI JEDNEGO śladu tenanta A -
    // ścieżki URL workspace'u A są danymi jego użytkowników.
    expect(filters.slice(2).flat()).not.toContain(TENANT_A);
    expect(adminRpc.callsFor("web_vitals_daily_p75").map((c) => c.arg("p_tenant"))).toEqual([
      TENANT_A,
      TENANT_B,
    ]);
  });

  it("wołający BEZ tenanta nie czyta niczego - dostaje pusty raport", async () => {
    // Fail-closed: brak tenanta nie może się zdegradować do odczytu bez `eq`.
    await expect(summary({ days: 7 }, NOMAD)).resolves.toMatchObject({
      total: 0,
      windowTotal: 0,
      windowDays: 7,
    });
    expect(admin.chainsFor("web_vitals")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rozwiązanie okna
// ---------------------------------------------------------------------------

describe("getVitalsSummary - okno analityczne", () => {
  /** Granice okna, jakie handler wysłał do bazy w zapytaniu wierszowym. */
  function bounds(): { since: unknown; until: unknown } {
    const chain = admin.chainsFor("web_vitals").find((c) => !isCountQuery(c))!;
    return { since: chain.argsOf("gte")?.[1], until: chain.argsOf("lte")?.[1] };
  }

  it("brak wejścia to okno 7 dni - domyślka jest w handlerze, nie w UI", async () => {
    const report = await summary();

    expect(bounds().since).toBe(new Date(NOW_MS - 7 * DAY_MS).toISOString());
    expect(bounds().until).toBe(NOW);
    expect(report.windowDays).toBe(7);
  });

  it("`days` przesuwa dolną granicę o dokładnie tyle dób", async () => {
    const report = await summary({ days: 30 });

    expect(bounds().since).toBe(new Date(NOW_MS - 30 * DAY_MS).toISOString());
    expect(report.windowDays).toBe(30);
  });

  it("zakres własny WYGRYWA z `days` - inaczej wykres kłamie o swoim zakresie", async () => {
    const since = "2026-08-20T00:00:00.000Z";
    const until = "2026-08-25T00:00:00.000Z";

    const report = await summary({ days: 365, sinceIso: since, untilIso: until });

    expect(bounds()).toEqual({ since, until });
    expect(report.windowDays).toBe(5);
  });

  it("sam `sinceIso` zostawia górną granicę na TERAZ", async () => {
    const report = await summary({ sinceIso: "2026-08-30T00:00:00.000Z" });

    expect(bounds().until).toBe(NOW);
    // 2,5 doby rozpiętości to 3 dni okna - sufit, nie obcięcie.
    expect(report.windowDays).toBe(3);
  });

  it("okno zerowej rozpiętości ma 1 dzień, nie 0 - dzielnik trendu nie może zniknąć", async () => {
    const instant = "2026-08-25T09:30:00.000Z";

    const report = await summary({ sinceIso: instant, untilIso: instant });

    expect(report.windowDays).toBe(1);
  });

  it("odwrócony zakres nie daje UJEMNEGO okna", async () => {
    const report = await summary({
      sinceIso: "2026-08-25T00:00:00.000Z",
      untilIso: "2026-08-20T00:00:00.000Z",
    });

    expect(report.windowDays).toBe(1);
  });
});

describe("getVitalsSummary - granice walidatora", () => {
  it("przyjmuje skrajne dopuszczalne `days` (1 i 365)", () => {
    expect(validateServerFnInput(getVitalsSummary, { days: 1 })).toEqual({ days: 1 });
    expect(validateServerFnInput(getVitalsSummary, { days: 365 })).toEqual({ days: 365 });
  });

  it("odrzuca `days` poza zakresem i niecałkowite", () => {
    // Górna granica to nie kaprys: 366 dni okna to skan całej tabeli RUM.
    expect(() => validateServerFnInput(getVitalsSummary, { days: 0 })).toThrow();
    expect(() => validateServerFnInput(getVitalsSummary, { days: 366 })).toThrow();
    expect(() => validateServerFnInput(getVitalsSummary, { days: 7.5 })).toThrow();
  });

  it("odrzuca datę bez strefy - `Date.parse` inaczej zinterpretuje ją lokalnie", () => {
    expect(() => validateServerFnInput(getVitalsSummary, { sinceIso: "2026-08-20" })).toThrow();
    expect(() =>
      validateServerFnInput(getVitalsSummary, { untilIso: "wczoraj wieczorem" }),
    ).toThrow();
  });

  it("brak wejścia (undefined) jest równoważny pustemu obiektowi", () => {
    expect(validateServerFnInput(getVitalsSummary, undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Cap próbki kontra prawdziwa wielkość okna
// ---------------------------------------------------------------------------

describe("getVitalsSummary - cap i windowTotal", () => {
  it("cap jest egzekwowany po stronie BAZY, a wiersze idą od najnowszych", async () => {
    await summary();

    const rowsChain = admin.chainsFor("web_vitals").find((c) => !isCountQuery(c))!;
    expect(rowsChain.argsOf("limit")).toEqual([SAMPLE_CAP]);
    // Przycięcie musi zostawiać NAJNOWSZE próbki - inaczej „ostatnie 24 h"
    // na dashboardzie pokazywałoby najstarsze wiersze okna.
    expect(rowsChain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("windowTotal to COUNT z bazy, nawet gdy próbka jest przycięta", async () => {
    planVitals({ rows: ROWS, count: SAMPLE_CAP + 1 });

    const report = await summary();

    // `total` mówi „z ilu wierszy policzono", `windowTotal` - „ile ich było".
    expect(report.total).toBe(3);
    expect(report.windowTotal).toBe(SAMPLE_CAP + 1);
    expect(report.capped).toBe(true);
  });

  it("`capped` zapala się DOPIERO powyżej capa - równo na capie nic nie ucięto", async () => {
    planVitals({ rows: ROWS, count: SAMPLE_CAP });

    const report = await summary();

    expect(report.windowTotal).toBe(SAMPLE_CAP);
    expect(report.capped).toBe(false);
  });

  it("brak licznika z PostgREST spada na długość próbki, a nie na zero", async () => {
    planVitals({ rows: ROWS, count: null });

    const report = await summary();

    expect(report.windowTotal).toBe(3);
    expect(report.capped).toBe(false);
  });

  it("`null` zamiast tablicy wierszy daje raport zerowy, nie wyjątek", async () => {
    planVitals({ rows: null, count: 0 });

    const report = await summary();

    expect(report).toMatchObject({ total: 0, metrics: [], paths: [], windowTotal: 0 });
  });

  it("raport niesie agregat z pobranych próbek - handler nie gubi danych po drodze", async () => {
    const report = await summary();

    expect(report.total).toBe(3);
    expect(report.metrics.map((m) => m.metric)).toEqual(["LCP", "CLS"]);
    expect(report.paths.map((p) => p.path)).toEqual(["/", "/o-nas"]);
  });
});

// ---------------------------------------------------------------------------
// Degradacja bez 500-ki
// ---------------------------------------------------------------------------

describe("getVitalsSummary - degradacja odczytu", () => {
  it("błąd zapytania LICZĄCEGO daje pusty raport z zachowanym oknem", async () => {
    planVitals({ countError: 'relation "public.web_vitals" does not exist' });

    const report = await summary({ days: 30 });

    // Brak migracji na danej bazie nie może wywalić całego panelu - ale okno
    // MUSI zostać, bo inaczej wykres narysuje 7 dni tam, gdzie pytano o 30.
    expect(report).toEqual({
      windowDays: 30,
      total: 0,
      metrics: [],
      paths: [],
      trends: [],
      windowTotal: 0,
      capped: false,
    });
    expect(warn).toHaveBeenCalled();
  });

  it("błąd odczytu WIERSZY też degraduje do pustego raportu", async () => {
    planVitals({ rows: ROWS, rowsError: "statement timeout" });

    const report = await summary({ days: 14 });

    expect(report.windowDays).toBe(14);
    expect(report.windowTotal).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it("nieudany odczyt NIE woła już RPC trendu", async () => {
    planVitals({ countError: "boom" });

    await summary();

    expect(adminRpc.calls).toHaveLength(0);
  });

  it("rzut, który NIE jest `Error`, też degraduje - log nie może wysypać handlera", async () => {
    // Warstwy transportowe potrafią rzucić czystym obiektem/napisem. Gałąź
    // logowania `e instanceof Error` jest jedyną rzeczą między takim rzutem
    // a drugim wyjątkiem, tym razem już poza `try`.
    const rejection: unknown = { code: "PGRST205", hint: "brak tabeli" };
    h.adminFrom = () => {
      throw rejection;
    };

    const report = await summary({ days: 3 });

    expect(report.windowDays).toBe(3);
    expect(report.total).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[vitals]"), rejection);
  });

  it("pusty raport z degradacji zachowuje okno zakresu własnego", async () => {
    planVitals({ countError: "boom" });

    const report = await summary({
      sinceIso: "2026-08-20T00:00:00.000Z",
      untilIso: "2026-08-25T00:00:00.000Z",
    });

    expect(report.windowDays).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Trend: baza kontra pamięć
// ---------------------------------------------------------------------------

describe("getVitalsSummary - trend dzienny p75", () => {
  /** Dzień spoza próbki - dowód, że trend NAPRAWDĘ przyszedł z bazy. */
  const DB_TREND = [{ day: "2026-08-25", metric: "LCP", p75: 1800 }];

  it("udany RPC ZASTĘPUJE trend liczony z przyciętej próbki", async () => {
    adminRpc.setData("web_vitals_daily_p75", DB_TREND);

    const report = await summary();

    expect(report.trends).toEqual([{ day: "2026-08-25", p75: { LCP: 1800 } }]);
    expect(adminRpc.lastCall("web_vitals_daily_p75")?.arg("p_since")).toBe(
      new Date(NOW_MS - 7 * DAY_MS).toISOString(),
    );
  });

  it("błąd RPC zostawia trend z pamięci - starsza baza nie gasi wykresu", async () => {
    adminRpc.setError("web_vitals_daily_p75", "function web_vitals_daily_p75 does not exist");

    const report = await summary();

    expect(report.trends.map((t) => t.day)).toEqual(["2026-08-30", "2026-08-31"]);
  });

  it("RZUT z RPC też zostawia trend z pamięci, zamiast wywalać raport", async () => {
    h.adminRpc = async (name: string, args?: Record<string, unknown>) => {
      await adminRpc.rpc(name, args);
      throw new Error("connection reset");
    };

    const report = await summary();

    expect(report.trends.map((t) => t.day)).toEqual(["2026-08-30", "2026-08-31"]);
    expect(report.total).toBe(3);
  });

  it("odpowiedź RPC, która nie jest tablicą, nie kasuje trendu", async () => {
    adminRpc.setData("web_vitals_daily_p75", null);

    const report = await summary();

    expect(report.trends.map((t) => t.day)).toEqual(["2026-08-30", "2026-08-31"]);
  });

  it("jawne `untilIso` POMIJA RPC - funkcja bazy nie zna górnej granicy okna", async () => {
    adminRpc.setData("web_vitals_daily_p75", DB_TREND);

    const report = await summary({
      sinceIso: "2026-08-29T00:00:00.000Z",
      untilIso: "2026-08-31T23:59:59.000Z",
    });

    // Gałąź realna, nie kosmetyczna: RPC filtruje wyłącznie `created_at >=
    // p_since`, więc dla okna zamkniętego od góry dołożyłby dni SPOZA zakresu.
    expect(adminRpc.callsFor("web_vitals_daily_p75")).toHaveLength(0);
    expect(report.trends.map((t) => t.day)).toEqual(["2026-08-30", "2026-08-31"]);
  });

  it("sam `sinceIso` (okno otwarte do teraz) NADAL woła RPC", async () => {
    adminRpc.setData("web_vitals_daily_p75", DB_TREND);
    const since = "2026-08-29T00:00:00.000Z";

    await summary({ sinceIso: since });

    expect(adminRpc.lastCall("web_vitals_daily_p75")?.args).toEqual({
      p_since: since,
      p_tenant: TENANT_A,
    });
  });
});
