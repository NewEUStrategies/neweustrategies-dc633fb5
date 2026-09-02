// WARSTWA PORZĄDKUJĄCA DANE telemetrii błędów przeglądarki -
// `getClientErrorsReport`. Do dziś: 0 z 25 linii, przy agregatorze
// (`clientErrorsAggregate.ts`) na 100%.
//
// PO CO. Agregator dostaje gotową tablicę próbek i grupuje je po odcisku
// komunikatu - jest czysty i nie wie, skąd te próbki są. Handler jest
// dokładnie tą częścią, która decyduje CZYJE to próbki, z jakiego okna i czy
// wołający ma prawo je zobaczyć. Zawartość tabeli `client_errors` to nie są
// anonimowe liczniki: każdy wiersz niesie ŚCIEŻKĘ URL i komunikat wyjątku
// z przeglądarki użytkownika, czyli materiał, po którym da się odtworzyć,
// czego ktoś szukał w cudzym serwisie.
//
// Klasy defektów, które ten plik ma łapać:
//   1. ODCZYT PONAD TENANTEM. `client_errors` ma RLS bez polityk, więc czyta
//      je service role, który RLS OMIJA. Jedyną granicą workspace'u są dwa
//      jawne `.eq("tenant_id", …)` - w zapytaniu liczącym i wierszowym.
//      Zgubienie jednego z nich nie psuje niczego widocznego.
//   2. BRAMKA PO ODCZYCIE. Odmowa wydana już PO pobraniu wierszy to nadal
//      odczyt cudzych danych - dlatego dowodzimy, że przy braku roli
//      `supabaseAdmin` nie zostaje tknięty w ogóle.
//   3. ZANIŻONA SKALA AWARII. `windowTotal` to COUNT z bazy, a `total` -
//      liczba próbek po przycięciu. Pomylenie ich sprawia, że dashboard
//      pokazuje 5 000 błędów tam, gdzie jest ich 200 000, i nikt nie eskaluje.
//   4. KOTWICA CZASU. „Ostatnie 24 h" liczy się względem KOŃCA OKNA, a nie
//      zegara serwera - inaczej raport historyczny zawsze pokazuje zero.
//   5. 500 ZAMIAST „BRAK DANYCH". Błędy odczytu są świadomie połykane (baza
//      bez migracji), błędy autoryzacji - nie. Odwrócenie tej reguły albo
//      wywala panel, albo zamienia odmowę w cichy pusty raport.
//
// CZEGO NIE DOWODZI: middleware `requireSupabaseAuth` (atrapa go nie
// uruchamia - patrz `src/test/serverFnHarness.ts`) ani polityk bazy.
//
// HARNESS: `serverFnHarness` (styl specyfikacyjny) zamiast `serverFn` -
// kontekst wędruje w argumencie wywołania, więc dwóch różnych wołających
// przechodzi przez tę samą funkcję w jednym teście. Bez tego nie da się
// pokazać, że filtr tenanta IDZIE ZA WOŁAJĄCYM, a nie za pierwszym żądaniem.
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
import type { ClientErrorsReport } from "@/lib/observability/clientErrorsAggregate";

const h = vi.hoisted(() => ({
  adminFrom: null as ((table: string) => unknown) | null,
  tenantOf: {} as Record<string, string>,
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
  supabaseAdmin: { from: (table: string) => h.adminFrom?.(table) },
}));
vi.mock("@/lib/server/userTenant.server", () => ({
  resolveUserTenantId: async (client: unknown, userId: string) => {
    h.tenantCalls.push({ client, userId });
    const tenant = h.tenantOf[userId];
    // Fail-closed jak w produkcji: brak tenanta rzuca, zamiast oddać `null`,
    // po którym zapytanie poleciałoby bez zawężenia.
    if (!tenant) throw new Error("No tenant for current user");
    return tenant;
  },
}));

// Atrapa modułu service role - do asercji TOŻSAMOŚCI klienta rozwiązującego tenant.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getClientErrorsReport } from "@/lib/observability/clientErrors.functions";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";
const NOMAD = "55555555-5555-4555-8555-555555555555";

const NOW = "2026-09-01T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY_MS = 86_400_000;
/** Ogranicznik agregacji zadeklarowany w handlerze. */
const SAMPLE_CAP = 5_000;

interface ClientErrorRow {
  message: string;
  stack: string | null;
  source: string | null;
  path: string | null;
  created_at: string;
}

/**
 * Trzy próbki, dwie grupy: oba „Loading chunk N failed" mają ten sam odcisk
 * (numer chunku jest zmienną częścią komunikatu), więc raport ma zobaczyć
 * JEDEN problem z licznikiem 2, a nie dwa osobne.
 */
const ROWS: ClientErrorRow[] = [
  {
    message: "Loading chunk 123 failed",
    stack: "at chunk.js:1:1",
    source: "onerror",
    path: "/",
    created_at: "2026-09-01T11:00:00.000Z",
  },
  {
    message: "Loading chunk 987 failed",
    stack: null,
    source: "boundary",
    path: "/kontakt",
    created_at: "2026-08-31T09:00:00.000Z",
  },
  {
    message: "TypeError: x is not a function",
    stack: null,
    source: "unhandledrejection",
    path: "/kontakt",
    created_at: "2026-08-28T09:00:00.000Z",
  },
];

let admin: SupabaseFromStub;
let userRpc: SupabaseRpcStub;
let warn: ReturnType<typeof vi.spyOn>;

/** COUNT i odczyt wierszy idą do tej samej tabeli - rozróżnia je `head: true`. */
function isCountQuery(chain: RecordedChain): boolean {
  const options = chain.argsOf("select")?.[1] as { head?: boolean } | undefined;
  return options?.head === true;
}

interface ErrorsPlan {
  rows?: ClientErrorRow[] | null;
  count?: number | null;
  countError?: string;
  rowsError?: string;
}

function planErrors(plan: ErrorsPlan = {}): void {
  const rows = plan.rows === undefined ? [] : plan.rows;
  admin.setResponse("client_errors", (chain): SupabaseResult => {
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

function report(data?: unknown, userId: string = ADMIN_A): Promise<ClientErrorsReport> {
  return callServerFn<ClientErrorsReport>(getClientErrorsReport, {
    data,
    context: context(userId),
  });
}

/** Argumenty `eq` z każdego łańcucha `client_errors`, w kolejności wywołań. */
function tenantFilters(): unknown[][] {
  return admin.chainsFor("client_errors").map((c) => [...(c.argsOf("eq") ?? [])]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  admin = supabaseFromStub();
  userRpc = supabaseRpcStub();
  h.adminFrom = admin.from;
  h.tenantOf = { [ADMIN_A]: TENANT_A, [ADMIN_B]: TENANT_B };
  h.tenantCalls.length = 0;
  userRpc.setData("has_role", true);
  planErrors({ rows: ROWS });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// Bramka admina - przed jakimkolwiek dotknięciem danych
// ---------------------------------------------------------------------------

describe("getClientErrorsReport - bramka admina", () => {
  it("brak roli admina to odmowa, a nie pusty raport", async () => {
    userRpc.setData("has_role", false);

    await expect(report()).rejects.toThrow("Forbidden");
  });

  it("odmowa NIE tyka service role - zero zapytań i zero pytań o tenant", async () => {
    userRpc.setData("has_role", false);

    await expect(report()).rejects.toThrow("Forbidden");
    expect(admin.chains).toHaveLength(0);
    expect(h.tenantCalls).toHaveLength(0);
  });

  it("błąd RPC bramki wychodzi WŁASNYM komunikatem, nie jako brak uprawnień", async () => {
    userRpc.setError("has_role", "permission denied for function has_role");

    await expect(report()).rejects.toThrow("permission denied for function has_role");
    expect(admin.chains).toHaveLength(0);
  });

  it("bramka pyta o rolę WOŁAJĄCEGO", async () => {
    await report({ days: 7 }, ADMIN_B);

    expect(userRpc.lastCall("has_role")?.args).toEqual({ _user_id: ADMIN_B, _role: "admin" });
  });

  it("odmowa autoryzacji NIE degraduje się do pustego raportu", async () => {
    userRpc.setData("has_role", false);

    // To jest odwrotność reguły degradacji niżej: gdyby bramka wpadła do tego
    // samego `try`, nieuprawniony wołający dostałby 200 i „brak danych",
    // a panel wyglądałby na sprawny.
    await expect(report()).rejects.toThrow("Forbidden");
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Izolacja tenantów
// ---------------------------------------------------------------------------

describe("getClientErrorsReport - izolacja tenantów", () => {
  it("OBA zapytania są zawężone do tenanta wołającego", async () => {
    await report();

    expect(tenantFilters()).toEqual([
      ["tenant_id", TENANT_A],
      ["tenant_id", TENANT_A],
    ]);
  });

  it("tenant pochodzi z profilu wołającego, a nie z wejścia", async () => {
    await report({ days: 7 }, ADMIN_B);

    expect(h.tenantCalls).toHaveLength(1);
    expect(h.tenantCalls[0].userId).toBe(ADMIN_B);
    // Pytającym o tenant jest service role, nie klient użytkownika - to on
    // czyta `profiles` z pominięciem RLS i tylko on daje odpowiedź, na której
    // wolno oprzeć zawężenie kolejnych zapytań.
    expect(h.tenantCalls[0].client).toBe(supabaseAdmin);
    expect(tenantFilters().flat()).not.toContain(TENANT_A);
  });

  it("DWÓCH wołających - filtr idzie za wołającym, nie za pierwszym wywołaniem", async () => {
    await report({ days: 7 }, ADMIN_A);
    await report({ days: 7 }, ADMIN_B);

    const filters = tenantFilters();
    expect(filters.slice(0, 2)).toEqual([
      ["tenant_id", TENANT_A],
      ["tenant_id", TENANT_A],
    ]);
    expect(filters.slice(2)).toEqual([
      ["tenant_id", TENANT_B],
      ["tenant_id", TENANT_B],
    ]);
    // Wiersz `client_errors` niesie ścieżkę URL i treść wyjątku - workspace B
    // nie ma prawa zobaczyć ANI JEDNEGO wiersza workspace'u A.
    expect(filters.slice(2).flat()).not.toContain(TENANT_A);
  });

  it("wołający BEZ tenanta nie czyta niczego - dostaje pusty raport", async () => {
    await expect(report({ days: 7 }, NOMAD)).resolves.toMatchObject({
      total: 0,
      windowTotal: 0,
      groups: [],
      windowDays: 7,
    });
    expect(admin.chainsFor("client_errors")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Okno analityczne
// ---------------------------------------------------------------------------

describe("getClientErrorsReport - okno analityczne", () => {
  function bounds(): { since: unknown; until: unknown } {
    const chain = admin.chainsFor("client_errors").find((c) => !isCountQuery(c))!;
    return { since: chain.argsOf("gte")?.[1], until: chain.argsOf("lte")?.[1] };
  }

  it("brak wejścia to okno 7 dni", async () => {
    const result = await report();

    expect(bounds()).toEqual({ since: new Date(NOW_MS - 7 * DAY_MS).toISOString(), until: NOW });
    expect(result.windowDays).toBe(7);
  });

  it("`days` przesuwa dolną granicę o dokładnie tyle dób", async () => {
    const result = await report({ days: 30 });

    expect(bounds().since).toBe(new Date(NOW_MS - 30 * DAY_MS).toISOString());
    expect(result.windowDays).toBe(30);
  });

  it("zakres własny WYGRYWA z `days`", async () => {
    const since = "2026-08-26T12:00:00.000Z";
    const until = "2026-08-31T12:00:00.000Z";

    const result = await report({ days: 90, sinceIso: since, untilIso: until });

    expect(bounds()).toEqual({ since, until });
    expect(result.windowDays).toBe(5);
  });

  it("windowDays to SUFIT rozpiętości, nie jej obcięcie", async () => {
    const result = await report({ sinceIso: "2026-08-30T00:00:00.000Z" });

    // 2,5 doby do zamrożonego „teraz" - okno ma 3 dni.
    expect(result.windowDays).toBe(3);
  });

  it("okno zerowej i ujemnej rozpiętości ma 1 dzień, nigdy 0 ani mniej", async () => {
    const instant = "2026-08-25T09:30:00.000Z";

    await expect(report({ sinceIso: instant, untilIso: instant })).resolves.toMatchObject({
      windowDays: 1,
    });
    await expect(
      report({ sinceIso: "2026-08-25T00:00:00.000Z", untilIso: "2026-08-20T00:00:00.000Z" }),
    ).resolves.toMatchObject({ windowDays: 1 });
  });

  it("okno „ostatnich 24 h” i oś dnia są kotwiczone KOŃCEM OKNA, nie zegarem serwera", async () => {
    // Raport historyczny: okno kończy się 31.08, a zegar stoi na 01.09.
    planErrors({ rows: [ROWS[1], ROWS[2]], count: 2 });

    const result = await report({
      sinceIso: "2026-08-26T12:00:00.000Z",
      untilIso: "2026-08-31T12:00:00.000Z",
    });

    // Wiersz z 31.08 09:00 ma 3 h względem końca okna, ale 27 h względem
    // zegara. Kotwica na `Date.now()` pokazałaby tu zero i sugerowała, że
    // awaria wygasła.
    expect(result.last24h).toBe(1);
    expect(result.daily).toHaveLength(5);
    expect(result.daily.at(-1)?.day).toBe("2026-08-31");
  });
});

describe("getClientErrorsReport - granice walidatora", () => {
  it("przyjmuje skrajne dopuszczalne `days` (1 i 90)", () => {
    expect(validateServerFnInput(getClientErrorsReport, { days: 1 })).toEqual({ days: 1 });
    expect(validateServerFnInput(getClientErrorsReport, { days: 90 })).toEqual({ days: 90 });
  });

  it("odrzuca `days` poza zakresem 1..90 i niecałkowite", () => {
    // Okno błędów jest KRÓTSZE niż okno RUM (90 vs 365): telemetria błędów
    // rośnie skokowo przy awarii, a agregacja idzie po tekście komunikatu.
    expect(() => validateServerFnInput(getClientErrorsReport, { days: 0 })).toThrow();
    expect(() => validateServerFnInput(getClientErrorsReport, { days: 91 })).toThrow();
    expect(() => validateServerFnInput(getClientErrorsReport, { days: 365 })).toThrow();
    expect(() => validateServerFnInput(getClientErrorsReport, { days: 2.5 })).toThrow();
  });

  it("odrzuca datę bez strefy i tekst niebędący datą", () => {
    expect(() =>
      validateServerFnInput(getClientErrorsReport, { sinceIso: "2026-08-20" }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(getClientErrorsReport, { untilIso: "przedwczoraj" }),
    ).toThrow();
  });

  it("brak wejścia (undefined) jest równoważny pustemu obiektowi", () => {
    expect(validateServerFnInput(getClientErrorsReport, undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Cap próbki kontra prawdziwa skala awarii
// ---------------------------------------------------------------------------

describe("getClientErrorsReport - cap i windowTotal", () => {
  it("cap jest egzekwowany po stronie BAZY, a wiersze idą od najnowszych", async () => {
    await report();

    const rowsChain = admin.chainsFor("client_errors").find((c) => !isCountQuery(c))!;
    expect(rowsChain.argsOf("limit")).toEqual([SAMPLE_CAP]);
    expect(rowsChain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("windowTotal to COUNT z bazy, nawet gdy próbka jest przycięta", async () => {
    planErrors({ rows: ROWS, count: SAMPLE_CAP + 1 });

    const result = await report();

    expect(result.total).toBe(3);
    expect(result.windowTotal).toBe(SAMPLE_CAP + 1);
    expect(result.capped).toBe(true);
  });

  it("`capped` zapala się DOPIERO powyżej capa", async () => {
    planErrors({ rows: ROWS, count: SAMPLE_CAP });

    const result = await report();

    expect(result.windowTotal).toBe(SAMPLE_CAP);
    expect(result.capped).toBe(false);
  });

  it("brak licznika z PostgREST spada na długość próbki, a nie na zero", async () => {
    planErrors({ rows: ROWS, count: null });

    const result = await report();

    expect(result.windowTotal).toBe(3);
    expect(result.capped).toBe(false);
  });

  it("`null` zamiast tablicy wierszy daje raport zerowy, nie wyjątek", async () => {
    planErrors({ rows: null, count: 0 });

    const result = await report({ days: 2 });

    expect(result).toMatchObject({ total: 0, uniqueGroups: 0, groups: [], windowDays: 2 });
  });

  it("handler oddaje AGREGAT pobranych próbek, nie surowe wiersze", async () => {
    const result = await report();

    // Dwa „Loading chunk N failed" to JEDEN problem - dowód, że handler
    // naprawdę przepuszcza próbki przez agregator, a nie odsyła ich wprost.
    expect(result.uniqueGroups).toBe(2);
    expect(result.groups[0]).toMatchObject({
      fingerprint: "Loading chunk <n> failed",
      count: 2,
      sources: ["boundary", "onerror"],
    });
    expect(result.affectedPaths).toBe(2);
    expect(result.last24h).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Degradacja bez 500-ki
// ---------------------------------------------------------------------------

describe("getClientErrorsReport - degradacja odczytu", () => {
  it("błąd zapytania LICZĄCEGO daje pusty raport z zachowanym oknem", async () => {
    planErrors({ countError: 'relation "public.client_errors" does not exist' });

    const result = await report({ days: 30 });

    expect(result).toEqual({
      windowDays: 30,
      total: 0,
      windowTotal: 0,
      capped: false,
      uniqueGroups: 0,
      affectedPaths: 0,
      last24h: 0,
      daily: [],
      groups: [],
    });
    expect(warn).toHaveBeenCalled();
  });

  it("błąd odczytu WIERSZY też degraduje do pustego raportu", async () => {
    planErrors({ rows: ROWS, rowsError: "statement timeout" });

    const result = await report({ days: 14 });

    expect(result.windowDays).toBe(14);
    expect(result.groups).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("pusty raport z degradacji zachowuje okno zakresu własnego", async () => {
    planErrors({ countError: "boom" });

    const result = await report({
      sinceIso: "2026-08-26T12:00:00.000Z",
      untilIso: "2026-08-31T12:00:00.000Z",
    });

    expect(result.windowDays).toBe(5);
  });

  it("rzut, który NIE jest `Error`, też degraduje - log nie może wysypać handlera", async () => {
    const rejection: unknown = { code: "PGRST205", hint: "brak tabeli" };
    h.adminFrom = () => {
      throw rejection;
    };

    const result = await report({ days: 3 });

    expect(result.windowDays).toBe(3);
    expect(result.total).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[client-errors]"), rejection);
  });
});
