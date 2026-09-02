// PO CO TEN PLIK. `src/lib/analytics/audience.functions.ts` (190 linii, jedna
// server fn) wchodzi tu z ZEREM wykonanych linii, a jest jedynym źródłem
// zakładki „audytorium" w panelu BI: dzieli ruch na zalogowanych i anonimowych,
// liczy unikalnych czytelników i pokazuje top posty. Handler czyta przez
// `supabaseAdmin`, czyli klienta SERVICE ROLE, który OMIJA RLS - jedyna granica
// najemcy jest tu ręcznie dopisanym `.eq("tenant_id", …)`. Skasowanie tego
// jednego ogniwa przechodzi przez `tsc`, przez lintera i przez oczy recenzenta,
// a w produkcji oznacza, że admin najemcy A czyta odsłony (i tytuły!) najemcy B.
// Ten plik jest jedynym miejscem, które taki błąd zatrzymuje.
//
// Klasy defektów, które te testy łapią:
//
//  1. BRAMKA ROLI, KTÓRA WPUSZCZA. `has_role` oddaje `{ data, error }`.
//     Potraktowanie błędu jak „nie wiem, przepuść", uznanie `null` za prawdę
//     albo zapytanie o CUDZĄ tożsamość otwiera panel bez zmiany logiki
//     biznesowej. Dowodzimy odmowy PRZED jakimkolwiek odczytem tabeli - odmowa
//     ma wyprzedzić pracę, a nie ją posprzątać.
//  2. UCIECZKA POZA NAJEMCĘ. Atrapa PostgREST oddaje wiersze OBU najemców, gdy
//     w łańcuchu nie ma filtra `tenant_id` - dokładnie tak zachowuje się
//     service role. Dwóch adminów, dwa najemce, te same identyfikatory postów:
//     każdy widzi wyłącznie swoje liczby i swoje tytuły.
//  3. GRANICE OKNA. Walidator (1..365, całkowite, domyślnie 28) oraz `since`
//     liczone od `Date.now()` - wiersz starszy o godzinę od granicy NIE MOŻE
//     wejść do KPI.
//  4. MAPOWANIE AGREGATU. Podział logged/anon po `user_id`, unikalność po
//     `user_id` (zalogowani) i `viewer_hash` (anonimowi), seria z zerami dla
//     dni bez ruchu, top-10 posortowany malejąco, fallback tytułu
//     (`title_pl` -> `title_en` -> „(bez tytułu)").
//  5. DEGRADACJA ZAMIAST WYWROTKI. Awaria odczytu `post_views` ma oddać pusty
//     wynik z zachowanym `window_days`, a NIE 500-kę na całym panelu - i nie
//     wolno jej pociągnąć za sobą drugiego zapytania.
//
// CZEGO TEN PLIK NIE UDAJE. Harness `@/test/serverFnHarness` nie uruchamia
// middleware, więc „nieuwierzytelniony nie wejdzie" nie jest tu dowodzone -
// od tego jest runtime i bramka statyczna `check:authz-snapshot`. Tutaj
// dowodzimy DEKLARACJI middleware (test strukturalny) oraz bramki roli, która
// żyje w ciele handlera. RLS tabel `post_views`/`posts` to domena pgTAP.
//
// RODO: zero prawdziwych danych. Identyfikatory są umowne, hashe czytelników
// syntetyczne, żadnego adresu e-mail ani IP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

/**
 * Uchwyt na atrapę klienta service role. `vi.mock` jest hoistowane nad importy,
 * więc fabryka nie może zamknąć się na obiekcie zbudowanym niżej - czyta więc
 * mutowalne pole, które `beforeEach` podstawia przed każdym testem.
 */
const h = vi.hoisted(() => ({ adminFrom: null as ((table: string) => unknown) | null }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.adminFrom) throw new Error("test: atrapa supabaseAdmin nie zostala podstawiona");
      return h.adminFrom(table);
    },
  },
}));

import { getAudienceSegments, type AudienceSegmentsResult } from "../audience.functions";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";

/** Zamrożony „teraz" - seria dni i granica okna muszą być deterministyczne. */
const NOW = new Date("2026-03-15T12:00:00.000Z");

interface ViewRow {
  tenant_id: string;
  post_id: string;
  user_id: string | null;
  viewer_hash: string;
  viewed_at: string;
}

interface PostRow {
  tenant_id: string;
  id: string;
  title_pl: string | null;
  title_en: string | null;
  slug: string | null;
}

/** Katalog ról - kto jest adminem. Modeluje `has_role(_user_id, 'admin')`. */
const ADMINI = new Set<string>([ADMIN_A, ADMIN_B]);
/** Przypisanie użytkownik -> najemca, czytane z `profiles` jak w produkcji. */
const NAJEMCA: Record<string, string> = { [ADMIN_A]: TENANT_A, [ADMIN_B]: TENANT_B };

interface WywolanieRpc {
  readonly fn: string;
  readonly args: unknown;
}

const stub = supabaseFromStub();
const rpcCalls: WywolanieRpc[] = [];

/** Stan sterujący odpowiedzią bramki roli - osobno dla błędu i dla wartości. */
const gate = {
  value: null as unknown,
  error: null as string | null,
};

/**
 * Klient najemcy wstrzykiwany przez middleware. Ma WYŁĄCZNIE `rpc` - gdyby
 * handler kiedykolwiek sięgnął po `from()` na tym kliencie, test wywali się
 * z komunikatem, a nie po cichu przejdzie.
 */
function klientNajemcy(): ServerFnContext["supabase"] {
  return {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (gate.error) return { data: null, error: new Error(gate.error) };
      const explicit = gate.value;
      if (explicit !== null) return { data: explicit, error: null };
      const userId = (args as { _user_id?: string })?._user_id ?? "";
      return { data: ADMINI.has(userId), error: null };
    },
    from: (table: string) => {
      throw new Error(`test: handler siegnal po klienta najemcy dla tabeli "${table}"`);
    },
  };
}

function kontekst(userId: string): ServerFnContext {
  return { supabase: klientNajemcy(), userId, claims: { sub: userId } };
}

/** Zbiór wierszy „bazy": oba najemce naraz, żeby wyciek było widać. */
let widoki: ViewRow[] = [];
let posty: PostRow[] = [];

/**
 * Odpowiedź dla `post_views` odtwarzająca zachowanie PostgREST: filtr `eq`,
 * granica `gte`, sortowanie `order` i `limit`. BRAK filtra `tenant_id` oddaje
 * wiersze WSZYSTKICH najemców - dokładnie tak, jak zrobiłby to service role.
 */
function odpowiedzWidokow(): void {
  stub.setResponse("post_views", (chain): SupabaseResult => {
    const eq = chain.argsOf("eq");
    const gte = chain.argsOf("gte");
    const limit = chain.argsOf("limit");
    let rows = [...widoki];
    if (eq && eq[0] === "tenant_id") rows = rows.filter((r) => r.tenant_id === eq[1]);
    if (gte && gte[0] === "viewed_at") rows = rows.filter((r) => r.viewed_at >= String(gte[1]));
    rows.sort((a, b) => (a.viewed_at < b.viewed_at ? 1 : -1));
    if (typeof limit?.[0] === "number") rows = rows.slice(0, limit[0]);
    return ok(rows.map(({ tenant_id: _t, ...rest }) => rest));
  });
}

function odpowiedzPostow(): void {
  stub.setResponse("posts", (chain): SupabaseResult => {
    const eq = chain.argsOf("eq");
    const inArgs = chain.argsOf("in");
    let rows = [...posty];
    if (eq && eq[0] === "tenant_id") rows = rows.filter((r) => r.tenant_id === eq[1]);
    if (inArgs && inArgs[0] === "id" && Array.isArray(inArgs[1])) {
      const ids = new Set(inArgs[1].map(String));
      rows = rows.filter((r) => ids.has(r.id));
    }
    return ok(rows.map(({ tenant_id: _t, ...rest }) => rest));
  });
}

function odpowiedzProfili(): void {
  stub.setResponse("profiles", (chain): SupabaseResult => {
    const eq = chain.argsOf("eq");
    const userId = eq && eq[0] === "id" ? String(eq[1]) : "";
    const tenant = NAJEMCA[userId];
    return ok(tenant ? { tenant_id: tenant } : null);
  });
}

/** Znacznik czasu przesunięty o `hours` godzin wstecz od zamrożonego „teraz". */
function godzinTemu(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

async function wywolaj(userId: string, data?: unknown): Promise<AudienceSegmentsResult> {
  return callServerFn<AudienceSegmentsResult>(getAudienceSegments, {
    data,
    context: kontekst(userId),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  stub.reset();
  rpcCalls.length = 0;
  gate.value = null;
  gate.error = null;
  widoki = [];
  posty = [];
  h.adminFrom = stub.from;
  odpowiedzProfili();
  odpowiedzWidokow();
  odpowiedzPostow();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getAudienceSegments - obudowa server fn", () => {
  it("deklaruje uwierzytelnienie, metodę POST i walidator wejścia", () => {
    expect(serverFnMiddlewareNames(getAudienceSegments)).toContain("requireSupabaseAuth");
    expect(Reflect.get(getAudienceSegments as object, "method")).toBe("POST");
    expect(validateServerFnInput(getAudienceSegments, {})).toEqual({ days: 28 });
  });
});

describe("getAudienceSegments - walidator okna", () => {
  it("brak wejścia oznacza okno 28 dni, a nie brak okna", () => {
    expect(validateServerFnInput(getAudienceSegments, undefined)).toEqual({ days: 28 });
    expect(validateServerFnInput(getAudienceSegments, null)).toEqual({ days: 28 });
  });

  it("przyjmuje skrajne dopuszczalne okna 1 i 365", () => {
    expect(validateServerFnInput(getAudienceSegments, { days: 1 })).toEqual({ days: 1 });
    expect(validateServerFnInput(getAudienceSegments, { days: 365 })).toEqual({ days: 365 });
  });

  it.each([
    ["zero", 0],
    ["ujemne", -1],
    ["ponad rok", 366],
    ["ulamkowe", 2.5],
  ])("odrzuca okno %s", (_nazwa, days) => {
    expect(() => validateServerFnInput(getAudienceSegments, { days })).toThrow();
  });

  it("odrzuca liczbę podaną jako tekst - brak cichej koercji", () => {
    expect(() => validateServerFnInput(getAudienceSegments, { days: "30" })).toThrow();
  });
});

describe("getAudienceSegments - bramka roli admina", () => {
  it("pyta o rolę WOŁAJĄCEGO i o rolę admin", async () => {
    await wywolaj(ADMIN_A, { days: 7 });
    expect(rpcCalls).toEqual([{ fn: "has_role", args: { _user_id: ADMIN_A, _role: "admin" } }]);
  });

  it("brak roli admina kończy się odmową PRZED jakimkolwiek odczytem tabeli", async () => {
    gate.value = false;
    await expect(wywolaj("55555555-5555-4555-8555-555555555555")).rejects.toThrow(
      "Forbidden: admin role required",
    );
    expect(stub.chains).toHaveLength(0);
  });

  it("puste `data` z has_role (brak wiersza roli) nie otwiera panelu", async () => {
    gate.value = null;
    // Katalog ról nie zna tego użytkownika - has_role oddaje `false`.
    await expect(wywolaj("66666666-6666-4666-8666-666666666666")).rejects.toThrow("Forbidden");
    expect(stub.chains).toHaveLength(0);
  });

  it("błąd odczytu roli jest awarią, a nie domyślnym „przepuść”", async () => {
    gate.error = "role lookup exploded";
    await expect(wywolaj(ADMIN_A)).rejects.toThrow("role lookup exploded");
    expect(stub.chains).toHaveLength(0);
  });
});

describe("getAudienceSegments - izolacja najemców", () => {
  beforeEach(() => {
    widoki = [
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: "user-a",
        viewer_hash: "ha1",
        viewed_at: godzinTemu(2),
      },
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: null,
        viewer_hash: "ha2",
        viewed_at: godzinTemu(3),
      },
      {
        tenant_id: TENANT_B,
        post_id: "post-1",
        user_id: "user-b",
        viewer_hash: "hb1",
        viewed_at: godzinTemu(2),
      },
      {
        tenant_id: TENANT_B,
        post_id: "post-1",
        user_id: null,
        viewer_hash: "hb2",
        viewed_at: godzinTemu(3),
      },
      {
        tenant_id: TENANT_B,
        post_id: "post-9",
        user_id: null,
        viewer_hash: "hb3",
        viewed_at: godzinTemu(4),
      },
    ];
    posty = [
      {
        tenant_id: TENANT_A,
        id: "post-1",
        title_pl: "Analiza najemcy A",
        title_en: null,
        slug: "a-1",
      },
      {
        tenant_id: TENANT_B,
        id: "post-1",
        title_pl: "Analiza najemcy B",
        title_en: null,
        slug: "b-1",
      },
      { tenant_id: TENANT_B, id: "post-9", title_pl: "Tylko u B", title_en: null, slug: "b-9" },
    ];
  });

  it("odczyt odsłon jest zawężony do najemcy WOŁAJĄCEGO, ustalonego z profiles", async () => {
    const wynik = await wywolaj(ADMIN_A, { days: 7 });

    const profil = stub.lastChain("profiles");
    expect(profil?.argsOf("eq")).toEqual(["id", ADMIN_A]);

    const widok = stub.lastChain("post_views");
    expect(widok?.argsOf("eq")).toEqual(["tenant_id", TENANT_A]);
    expect(widok?.argsOf("limit")).toEqual([50_000]);
    expect(widok?.argsOf("order")).toEqual(["viewed_at", { ascending: false }]);

    expect(wynik.kpi.views_total).toBe(2);
  });

  it("admin najemcy A nie widzi ANI JEDNEJ odsłony najemcy B", async () => {
    const a = await wywolaj(ADMIN_A, { days: 7 });
    expect(a.kpi).toMatchObject({ views_total: 2, views_logged: 1, views_anon: 1 });
    expect(a.top_anon.map((p) => p.post_id)).toEqual(["post-1"]);
    expect(a.top_anon.map((p) => p.post_id)).not.toContain("post-9");
  });

  it("admin najemcy B widzi wyłącznie swoje liczby - ta sama atrapa, inny kontekst", async () => {
    const b = await wywolaj(ADMIN_B, { days: 7 });
    expect(b.kpi).toMatchObject({ views_total: 3, views_logged: 1, views_anon: 2 });
    expect(b.top_anon.map((p) => p.post_id).sort()).toEqual(["post-1", "post-9"]);
  });

  it("tytuły top postów też są czytane z najemcy wołającego - ten sam id, inny tytuł", async () => {
    const a = await wywolaj(ADMIN_A, { days: 7 });
    const b = await wywolaj(ADMIN_B, { days: 7 });

    expect(a.top_logged[0]).toMatchObject({
      post_id: "post-1",
      title: "Analiza najemcy A",
      slug: "a-1",
    });
    expect(b.top_logged[0]).toMatchObject({
      post_id: "post-1",
      title: "Analiza najemcy B",
      slug: "b-1",
    });

    const zapytaniaPostow = stub.chainsFor("posts");
    expect(zapytaniaPostow[0].argsOf("eq")).toEqual(["tenant_id", TENANT_A]);
    expect(zapytaniaPostow[1].argsOf("eq")).toEqual(["tenant_id", TENANT_B]);
    expect(zapytaniaPostow[0].argsOf("in")).toEqual(["id", ["post-1"]]);
  });

  it("użytkownik bez najemcy nie dostaje odczytu bez filtra, tylko odmowę", async () => {
    ADMINI.add("77777777-7777-4777-8777-777777777777");
    try {
      await expect(wywolaj("77777777-7777-4777-8777-777777777777")).rejects.toThrow(
        "No tenant for current user",
      );
      expect(stub.chainsFor("post_views")).toHaveLength(0);
    } finally {
      ADMINI.delete("77777777-7777-4777-8777-777777777777");
    }
  });
});

describe("getAudienceSegments - granica okna", () => {
  it("`since` odcina wiersz starszy o godzinę od granicy okna", async () => {
    widoki = [
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: null,
        viewer_hash: "h1",
        viewed_at: godzinTemu(7 * 24 - 1),
      },
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: null,
        viewer_hash: "h2",
        viewed_at: godzinTemu(7 * 24 + 1),
      },
    ];
    const wynik = await wywolaj(ADMIN_A, { days: 7 });

    expect(stub.lastChain("post_views")?.argsOf("gte")).toEqual([
      "viewed_at",
      new Date(NOW.getTime() - 7 * 86_400_000).toISOString(),
    ]);
    expect(wynik.kpi.views_total).toBe(1);
    expect(wynik.kpi.unique_anon).toBe(1);
  });

  it("długość serii równa się długości okna, a ostatni punkt to dzisiaj", async () => {
    const wynik = await wywolaj(ADMIN_A, { days: 5 });
    expect(wynik.series).toHaveLength(5);
    expect(wynik.series.map((p) => p.day)).toEqual([
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ]);
    expect(wynik.kpi.window_days).toBe(5);
  });
});

describe("getAudienceSegments - mapowanie agregatu", () => {
  beforeEach(() => {
    widoki = [
      // Zalogowany: dwie odsłony tego samego użytkownika = jeden unikalny.
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: "user-1",
        viewer_hash: "h1",
        viewed_at: godzinTemu(2),
      },
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: "user-1",
        viewer_hash: "h1",
        viewed_at: godzinTemu(3),
      },
      // Anonimowi: dwa hashe na post-2 i jeden powtórzony hash na post-1.
      {
        tenant_id: TENANT_A,
        post_id: "post-2",
        user_id: null,
        viewer_hash: "h2",
        viewed_at: godzinTemu(28),
      },
      {
        tenant_id: TENANT_A,
        post_id: "post-2",
        user_id: null,
        viewer_hash: "h3",
        viewed_at: godzinTemu(29),
      },
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: null,
        viewer_hash: "h2",
        viewed_at: godzinTemu(52),
      },
    ];
    posty = [
      {
        tenant_id: TENANT_A,
        id: "post-1",
        title_pl: "Pierwsza analiza",
        title_en: "First",
        slug: "pierwsza",
      },
      {
        tenant_id: TENANT_A,
        id: "post-2",
        title_pl: null,
        title_en: "Second analysis",
        slug: null,
      },
    ];
  });

  it("dzieli odsłony po obecności user_id i liczy unikalnych po właściwym kluczu", async () => {
    const wynik = await wywolaj(ADMIN_A, { days: 7 });
    expect(wynik.kpi).toEqual({
      views_total: 5,
      views_logged: 2,
      views_anon: 3,
      unique_readers: 3,
      unique_logged: 1,
      unique_anon: 2,
      window_days: 7,
    });
  });

  it("seria rozkłada odsłony na właściwe dni i zeruje dni bez ruchu", async () => {
    const wynik = await wywolaj(ADMIN_A, { days: 4 });
    expect(wynik.series).toEqual([
      { day: "2026-03-12", logged: 0, anon: 0 },
      { day: "2026-03-13", logged: 0, anon: 1 },
      { day: "2026-03-14", logged: 0, anon: 2 },
      { day: "2026-03-15", logged: 2, anon: 0 },
    ]);
  });

  it("top anonimowych jest posortowany malejąco, a `uniques` liczy hashe, nie odsłony", async () => {
    const wynik = await wywolaj(ADMIN_A, { days: 7 });
    expect(wynik.top_anon).toEqual([
      { post_id: "post-2", title: "Second analysis", slug: null, views: 2, uniques: 2 },
      { post_id: "post-1", title: "Pierwsza analiza", slug: "pierwsza", views: 1, uniques: 1 },
    ]);
  });

  it("tytuł zalogowanych bierze title_pl przed title_en", async () => {
    const wynik = await wywolaj(ADMIN_A, { days: 7 });
    expect(wynik.top_logged).toEqual([
      { post_id: "post-1", title: "Pierwsza analiza", slug: "pierwsza", views: 2, uniques: 1 },
    ]);
    expect(wynik.truncated).toBe(false);
  });

  it("pusty i białoznakowy tytuł spadają na fallback, tak jak brak wiersza posta", async () => {
    widoki = [
      {
        tenant_id: TENANT_A,
        post_id: "post-puste",
        user_id: null,
        viewer_hash: "h1",
        viewed_at: godzinTemu(1),
      },
      {
        tenant_id: TENANT_A,
        post_id: "post-spacje",
        user_id: null,
        viewer_hash: "h2",
        viewed_at: godzinTemu(1),
      },
      {
        tenant_id: TENANT_A,
        post_id: "post-brak",
        user_id: null,
        viewer_hash: "h3",
        viewed_at: godzinTemu(1),
      },
    ];
    posty = [
      { tenant_id: TENANT_A, id: "post-puste", title_pl: "", title_en: "", slug: null },
      {
        tenant_id: TENANT_A,
        id: "post-spacje",
        title_pl: "   ",
        title_en: "Ignorowany",
        slug: "s",
      },
    ];
    const wynik = await wywolaj(ADMIN_A, { days: 2 });
    const wgId = Object.fromEntries(wynik.top_anon.map((p) => [p.post_id, p]));
    expect(wgId["post-puste"]).toMatchObject({ title: "(bez tytułu)", slug: null });
    expect(wgId["post-spacje"]).toMatchObject({ title: "(bez tytułu)", slug: "s" });
    expect(wgId["post-brak"]).toMatchObject({ title: "(bez tytułu)", slug: null });
  });

  it("top jest przycięty do dziesięciu postów mimo dwunastu w oknie", async () => {
    widoki = Array.from({ length: 12 }, (_v, i) => ({
      tenant_id: TENANT_A,
      post_id: `post-${i}`,
      user_id: null,
      viewer_hash: `h-${i}`,
      viewed_at: godzinTemu(i + 1),
    }));
    posty = [];
    const wynik = await wywolaj(ADMIN_A, { days: 3 });
    expect(wynik.top_anon).toHaveLength(10);
    expect(wynik.kpi.views_anon).toBe(12);
  });

  it("nie pyta o tytuły, gdy okno nie ma ani jednej odsłony", async () => {
    widoki = [];
    const wynik = await wywolaj(ADMIN_A, { days: 3 });
    expect(stub.chainsFor("posts")).toHaveLength(0);
    expect(wynik.top_logged).toEqual([]);
    expect(wynik.series).toHaveLength(3);
  });

  it("`data: null` z odczytu odsłon to puste okno, a nie wyjątek", async () => {
    stub.setResponse("post_views", () => ok(null));

    const wynik = await wywolaj(ADMIN_A, { days: 3 });
    expect(wynik.kpi.views_total).toBe(0);
    expect(wynik.truncated).toBe(false);
    expect(wynik.series).toHaveLength(3);
  });

  it("błąd odczytu tytułów nie wywraca raportu - zostają same identyfikatory", async () => {
    stub.setResponse("posts", () => fail("posts read denied"));
    const wynik = await wywolaj(ADMIN_A, { days: 7 });
    expect(wynik.kpi.views_total).toBe(5);
    expect(wynik.top_logged[0]).toMatchObject({
      post_id: "post-1",
      title: "(bez tytułu)",
      slug: null,
    });
  });

  it("`truncated` podnosi się dokładnie na limicie 50 000 wierszy", async () => {
    const przyciete = Array.from({ length: 50_000 }, (_v, i) => ({
      post_id: "post-1",
      user_id: null,
      viewer_hash: `h-${i % 3}`,
      viewed_at: godzinTemu(1),
    }));
    stub.setResponse("post_views", () => ok(przyciete));
    const wynik = await wywolaj(ADMIN_A, { days: 2 });
    expect(wynik.truncated).toBe(true);
    expect(wynik.kpi.views_anon).toBe(50_000);
    expect(wynik.top_anon[0].uniques).toBe(3);
  });
});

describe("getAudienceSegments - degradacja przy awarii odczytu", () => {
  it("awaria post_views oddaje puste okno zamiast wyjątku i nie pyta o tytuły", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub.setResponse("post_views", () => fail("post_views unavailable"));

    const wynik = await wywolaj(ADMIN_A, { days: 14 });

    expect(wynik).toEqual({
      kpi: {
        views_total: 0,
        views_logged: 0,
        views_anon: 0,
        unique_readers: 0,
        unique_logged: 0,
        unique_anon: 0,
        window_days: 14,
      },
      series: [],
      top_logged: [],
      top_anon: [],
      truncated: false,
    });
    expect(stub.chainsFor("posts")).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("[audience-segments] read failed:", "post_views unavailable");
  });

  it("degradacja nie może przeciec do kolejnego wywołania - poprawny odczyt znów działa", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stub.setResponse("post_views", () => fail("chwilowa awaria"));
    expect((await wywolaj(ADMIN_A, { days: 3 })).kpi.views_total).toBe(0);

    widoki = [
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: "user-1",
        viewer_hash: "h1",
        viewed_at: godzinTemu(1),
      },
    ];
    odpowiedzWidokow();
    expect((await wywolaj(ADMIN_A, { days: 3 })).kpi.views_total).toBe(1);
  });
});

describe("getAudienceSegments - defekt: KPI i wykres liczą inne okno", () => {
  // KPI liczy WSZYSTKO od `since` (= teraz minus days*24h, godzina w godzinę),
  // ale seria ma dokładnie `days` punktów liczonych od DZISIAJ wstecz, czyli
  // zaczyna się od `today - (days-1)`. Wiersz z pierwszej, częściowej doby okna
  // wchodzi więc do `views_total`, ale nie ma go na wykresie - suma słupków
  // rozjeżdża się z liczbą nad wykresem i nie da się tego wyjaśnić użytkownikowi.
  it.fails("suma serii równa się views_total dla wiersza z częściowej pierwszej doby", async () => {
    widoki = [
      {
        tenant_id: TENANT_A,
        post_id: "post-1",
        user_id: null,
        viewer_hash: "h1",
        viewed_at: godzinTemu(7 * 24 - 6),
      },
    ];
    const wynik = await wywolaj(ADMIN_A, { days: 7 });
    const sumaSerii = wynik.series.reduce((acc, p) => acc + p.logged + p.anon, 0);
    expect(wynik.kpi.views_total).toBe(1);
    expect(sumaSerii).toBe(wynik.kpi.views_total);
  });
});
