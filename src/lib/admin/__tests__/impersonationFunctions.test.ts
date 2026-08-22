// PODSZYWANIE SIĘ POD KONTO - WARSTWA SERWEROWA
// (`src/lib/admin/impersonation.functions.ts`). 113 linii, dwie funkcje,
// ZERO wykonanych linii przed tym plikiem.
//
// CO TEN PLIK DOWODZI I DLACZEGO WŁAŚNIE TO. To jedyne miejsce w platformie,
// które WYSTAWIA CUDZY TOKEN LOGOWANIA: `generateLink({ type: "magiclink" })`
// pod kluczem service_role, czyli poza RLS. Kto przejdzie tę funkcję, jest
// dowolnym użytkownikiem - z jego zgodami, jego danymi osobowymi i jego
// subskrypcją. Dlatego przedmiotem dowodu jest KOLEJNOŚĆ ODMÓW, a nie kształt
// odpowiedzi:
//
//   1. BRAMKA ROLI (`is_super_admin`) jest PIERWSZA i przy każdej odmowie
//      handler NIE TYKA niczego dalej: żadnego odczytu konta celu, żadnego
//      tokenu, żadnego wiersza audytu. Odmowa musi wyprzedzić pracę.
//   2. BRAK TOKENU BEZ ŚLADU. Gdy zapis do `impersonation_sessions` padnie,
//      handler MUSI odmówić - token magic link już istnieje, ale bez wiersza
//      audytowego nikt nie wie, kto się pod kogo podszył. Osobna asercja
//      pilnuje, że w tej sytuacji token NIE wychodzi z funkcji.
//   3. ZAMKNIĘCIE SESJI JEST ZAWĘŻONE DO AKTORA. `endImpersonation` nie ma
//      bramki roli (świadomie - patrz komentarz produkcyjny), więc jej jedyną
//      obroną są DWA filtry: `id` ORAZ `actor_user_id = context.userId`.
//      Bez drugiego każdy zalogowany użytkownik zamykałby dowolny wiersz
//      audytu, czyli fałszował ślad. Test czyta ogniwa łańcucha, nie wynik.
//   4. WARTOŚCI FAŁSZYWE, ALE PRAWIDŁOWE: konto z adresem `""`, token `""`,
//      powód `""`, błąd z komunikatem `""`. To tutaj `??` i `?.` decydują,
//      czy funkcja odmówi, czy wpuści.
//
// CZEGO TEN HARNESS NIE UDAJE - I DLACZEGO TO NIE JEST LUKA.
// `@/test/serverFnHarness` NIE URUCHAMIA middleware (patrz jego nagłówek),
// więc „brak sesji” nie jest tu dowodzony jako zachowanie handlera, a jako
// DEKLARACJA `requireSupabaseAuth` na obu eksportach (sekcja 1). Test, który
// udawałby jedno drugim, dawałby fałszywą pewność co do warstwy, której
// w ogóle nie dotyka. Kompletności zestawu middleware pilnuje osobno bramka
// `check:authz-snapshot`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY: czy `is_super_admin()` mówi prawdę, czy RLS na
//   `impersonation_sessions` przepuszcza odczyt tylko super adminowi i czy
//   najemca jest zawężony - `role_management_test.sql`,
//   `rls_tenant_isolation_test.sql`, `security_definer_tenant_scope_test.sql`,
//   `tenant_isolation_three_tenants_test.sql`. Na atrapie nie ma RLS, więc
//   żaden test tutaj nie może o tym mówić.
// - KONTRAKTU RPC (sygnatura i typ zwrotny `is_super_admin`):
//   bramki `check:rpc-contract` i `check:db-contract`.
// - KLIENTA PODSZYCIA (`src/lib/admin/impersonation.ts`: sessionStorage,
//   `verifyOtp`, przywrócenie sesji) - to osobny moduł i osobna praca.
//
// RODO: żadnych realnych danych osobowych. Adresy wyłącznie w `example.com`,
// identyfikatory umowne, zero adresów IP. Osobna asercja pilnuje, że wynik
// funkcji nie wynosi NIC PONAD to, co potrzebne (dokładny zestaw kluczy),
// i że token nie jest zbudowany z adresu e-mail celu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

/** Ustalona „teraz” - `endImpersonation` stempluje `ended_at`. */
const BASE_NOW = new Date("2026-03-15T12:00:00.000Z");
const BASE_NOW_ISO = "2026-03-15T12:00:00.000Z";

/** Odpowiedź `auth.admin.getUserById` w kształcie, jaki czyta handler. */
interface AdminUserResponse {
  data: { user: { email: string | null } | null } | null;
  error: { message?: string } | null;
}

/** Odpowiedź `auth.admin.generateLink`. */
interface GenerateLinkResponse {
  data: { properties: { hashed_token: string } | null } | null;
  error: { message?: string } | null;
}

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Kroki warstwy auth w KOLEJNOŚCI wywołania - z argumentami. */
  authCalls: [] as { step: "getUserById" | "generateLink"; args: unknown }[],
  /** Wynik odczytu konta celu. */
  userResponse: null as AdminUserResponse | null,
  /** Wynik generowania tokenu magic link. */
  linkResponse: null as GenerateLinkResponse | null,
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
    auth: {
      admin: {
        getUserById: (userId: string) => {
          h.authCalls.push({ step: "getUserById", args: userId });
          if (!h.userResponse) throw new Error("test: brak zaplanowanego odczytu konta celu");
          return Promise.resolve(h.userResponse);
        },
        generateLink: (payload: unknown) => {
          h.authCalls.push({ step: "generateLink", args: payload });
          if (!h.linkResponse) throw new Error("test: brak zaplanowanej odpowiedzi generateLink");
          return Promise.resolve(h.linkResponse);
        },
      },
    },
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));

import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";
import { endImpersonation, startImpersonation } from "@/lib/admin/impersonation.functions";

const IDS = {
  actor: "11111111-1111-4111-8111-111111111111",
  target: "22222222-2222-4222-8222-222222222222",
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  session: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

const TARGET_EMAIL = "cel.podszycia@example.com";
const TOKEN_HASH = "hashed-token-abc123";

/** Wywołania RPC klienta użytkownika (nie service_role) - nazwa + argumenty. */
let rpcCalls: { name: string; args: unknown }[] = [];
/** Wynik `is_super_admin`. `data` jest `unknown`, bo testujemy też nie-logiczne. */
let rpcResult: { data: unknown; error: { message: string } | null } = { data: true, error: null };

function db(): SupabaseFromStub {
  const value = h.db;
  if (!value) throw new Error("test: atrapa bazy nieustawiona");
  return value;
}

function chain(table: string): RecordedChain {
  const last = db().lastChain(table);
  if (!last) throw new Error(`test: brak zapytania do tabeli "${table}"`);
  return last;
}

/** Strażnik runtime zamiast rzutowania - wzorzec z `src/test/routeHarness.tsx`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pole specyfikacji server fn (metoda, walidator) czytane STRAŻNIKIEM, nie
 * rzutowaniem: `serverFnStubModule()` oddaje zwykły obiekt, więc `isRecord`
 * wystarcza i nie musimy udawać, że znamy pełny kształt typu z TanStacka.
 */
function specField(fn: unknown, field: string): unknown {
  if (!isRecord(fn)) throw new Error("test: eksport nie jest specyfikacją server fn");
  return fn[field];
}

/**
 * Przechwytuje odmowę handlera jako WARTOŚĆ. Dzięki temu asercja na treści
 * komunikatu nie wymaga rzutowania na typ błędu - dowodzimy jej strażnikiem
 * `err instanceof Error`.
 */
async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err: unknown) {
    return err;
  }
  throw new Error("test: handler NIE odmówił, choć miał odmówić");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : `nie-Error: ${String(err)}`;
}

/** Wiersz wstawiany do `impersonation_sessions`, zawężony strażnikiem. */
function insertedRow(): Record<string, unknown> {
  const args = chain("impersonation_sessions").argsOf("insert");
  const row = args?.[0];
  if (!isRecord(row)) throw new Error("test: `insert` nie dostał obiektu wiersza");
  return row;
}

/** Ładunek `update(...)`, zawężony strażnikiem. */
function updatedRow(): Record<string, unknown> {
  const args = chain("impersonation_sessions").argsOf("update");
  const row = args?.[0];
  if (!isRecord(row)) throw new Error("test: `update` nie dostał obiektu wiersza");
  return row;
}

function context(userId: string = IDS.actor): ServerFnContext {
  return {
    supabase: {
      rpc: (name: string, args?: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    userId,
  };
}

/** Ustawia całą szczęśliwą ścieżkę: super admin, konto z adresem, token, zapis. */
function happyPath(options: { tenantId?: string | null; profile?: SupabaseResult } = {}): void {
  rpcResult = { data: true, error: null };
  h.userResponse = { data: { user: { email: TARGET_EMAIL } }, error: null };
  h.linkResponse = { data: { properties: { hashed_token: TOKEN_HASH } }, error: null };
  db().setResponse(
    "profiles",
    options.profile ?? ok({ tenant_id: options.tenantId ?? IDS.tenant }),
  );
  db().setResponse("impersonation_sessions", ok({ id: IDS.session }));
}

/** Minimalne poprawne wejście `startImpersonation`. */
function startInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { targetUserId: IDS.target, ...overrides };
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.authCalls = [];
  h.userResponse = null;
  h.linkResponse = null;
  rpcCalls = [];
  rpcResult = { data: true, error: null };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BASE_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA - bramka strukturalna dla obu eksportów.
// ---------------------------------------------------------------------------

describe("podszycie - obudowa server functions", () => {
  const EXPORTS: readonly { name: string; fn: unknown }[] = [
    { name: "startImpersonation", fn: startImpersonation },
    { name: "endImpersonation", fn: endImpersonation },
  ];

  it.each(EXPORTS)("$name deklaruje `requireSupabaseAuth`", ({ fn }) => {
    // Jedyne miejsce, w którym da się to dowieść: harness nie uruchamia
    // middleware. Zdjęcie go z `startImpersonation` otwiera wystawianie
    // cudzych tokenów logowania żądaniu bez sesji.
    expect(serverFnMiddlewareNames(fn)).toContain("requireSupabaseAuth");
  });

  it.each(EXPORTS)("$name jest metodą POST, nie GET", ({ fn }) => {
    // `GET` dałoby się wywołać z `<img src>` na obcej stronie - metoda jest
    // częścią obrony przed CSRF, nie kosmetyką.
    expect(specField(fn, "method")).toBe("POST");
  });

  it.each(EXPORTS)("$name waliduje wejście", ({ fn }) => {
    expect(specField(fn, "validator")).toBeTypeOf("function");
  });
});

// ---------------------------------------------------------------------------
// 2. WALIDATOR `startImpersonation`.
// ---------------------------------------------------------------------------

describe("podszycie - walidator startImpersonation", () => {
  const REJECTED: readonly { label: string; input: unknown }[] = [
    { label: "brak wejścia (undefined)", input: undefined },
    { label: "wejście `null`", input: null },
    { label: "pusty obiekt - brak `targetUserId`", input: {} },
    { label: "`targetUserId` liczbą, nie napisem", input: { targetUserId: 12345678 } },
    { label: "`targetUserId` jako `null`", input: { targetUserId: null } },
    { label: "`targetUserId` krótszy niż 8 znaków", input: { targetUserId: "1234567" } },
    { label: "`targetUserId` pusty napis", input: { targetUserId: "" } },
  ];

  it.each(REJECTED)("odrzuca: $label", ({ input }) => {
    expect(() => validateServerFnInput(startImpersonation, input)).toThrow("targetUserId required");
  });

  it("przepuszcza identyfikator o granicznej długości 8 znaków", () => {
    // Granica jest w produkcji dosłownie `< 8`. Test przypina ją z obu stron,
    // bo to jedyna walidacja kształtu celu - reszta jest po stronie bazy.
    const parsed = validateServerFnInput<{ targetUserId: string }>(startImpersonation, {
      targetUserId: "12345678",
    });
    expect(parsed.targetUserId).toBe("12345678");
  });

  const REASONS: readonly { label: string; reason: unknown; expected: string | undefined }[] = [
    { label: "powód podany", reason: "audyt zgłoszenia 42", expected: "audyt zgłoszenia 42" },
    { label: "powód pusty (FAŁSZYWY, ale PRAWIDŁOWY)", reason: "", expected: "" },
    { label: "brak powodu", reason: undefined, expected: undefined },
    { label: "powód jako `null`", reason: null, expected: undefined },
    { label: "powód liczbą - odrzucany jako nie-napis", reason: 7, expected: undefined },
    {
      label: "powód obiektem - odrzucany jako nie-napis",
      reason: { text: "x" },
      expected: undefined,
    },
  ];

  it.each(REASONS)("$label", ({ reason, expected }) => {
    // Powód jest treścią wpisu audytowego. `typeof === "string"` jest tu
    // jedyną zaporą: obiekt wstawiony do kolumny tekstowej wywaliłby zapis
    // audytu, czyli zablokował podszycie z komunikatem o niczym.
    const parsed = validateServerFnInput<{ reason?: string }>(startImpersonation, {
      targetUserId: IDS.target,
      reason,
    });
    expect(parsed.reason).toBe(expected);
  });

  it("obcina powód do 500 znaków", () => {
    const parsed = validateServerFnInput<{ reason?: string }>(startImpersonation, {
      targetUserId: IDS.target,
      reason: "x".repeat(900),
    });
    expect(parsed.reason).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// 3. BRAMKA ROLI - granica bezpieczeństwa.
// ---------------------------------------------------------------------------

describe("podszycie - bramka roli super_admin", () => {
  const DENIALS: readonly {
    label: string;
    result: { data: unknown; error: null | { message: string } };
  }[] = [
    { label: "RPC padło", result: { data: null, error: { message: "permission denied" } } },
    { label: "`false` - nie jest super adminem", result: { data: false, error: null } },
    { label: "`null` - brak odpowiedzi", result: { data: null, error: null } },
    { label: "`undefined` - brak pola", result: { data: undefined, error: null } },
    { label: "`0` (wartość FAŁSZYWA, ale PRAWIDŁOWA)", result: { data: 0, error: null } },
    { label: "pusty napis (wartość FAŁSZYWA, ale PRAWIDŁOWA)", result: { data: "", error: null } },
  ];

  it.each(DENIALS)("odmawia, gdy $label", async ({ result }) => {
    rpcResult = result;
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow("Forbidden: super_admin required");
  });

  it.each(DENIALS)("przy odmowie ($label) NIE tyka niczego dalej", async ({ result }) => {
    // Najważniejsza asercja w tym pliku: odmowa musi wyprzedzić PRACĘ.
    // Gdyby handler najpierw wygenerował token, a potem sprawdził rolę, token
    // i tak by już istniał - a magic link jest ważny niezależnie od tego, czy
    // funkcja zwróci go wywołującemu.
    rpcResult = result;
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow();
    expect(h.authCalls).toEqual([]);
    expect(db().chains).toEqual([]);
    expect(rpcCalls.map((call) => call.name)).toEqual(["is_super_admin"]);
  });

  it("bramka roli jest PRZED zakazem podszycia się pod siebie", async () => {
    // Kolejność ma znaczenie dla komunikatu: nie-super-admin nie ma się
    // dowiedzieć, że jego identyfikator jest rozpoznawany - dostaje odmowę
    // roli, nie „nie możesz siebie”.
    rpcResult = { data: false, error: null };
    await expect(
      callServerFn(startImpersonation, {
        data: startInput({ targetUserId: IDS.actor }),
        context: context(),
      }),
    ).rejects.toThrow("Forbidden: super_admin required");
  });

  it("super admin NIE MOŻE podszyć się pod samego siebie", async () => {
    // Wpis audytowy „aktor = cel” jest bez sensu, a wymiana sesji na własną
    // rozwala klientowi zapisany token powrotny.
    happyPath();
    await expect(
      callServerFn(startImpersonation, {
        data: startInput({ targetUserId: IDS.actor }),
        context: context(),
      }),
    ).rejects.toThrow("Cannot impersonate yourself");
    expect(h.authCalls).toEqual([]);
    expect(db().chains).toEqual([]);
  });

  it("wartość PRAWDZIWA, ale nie logiczna, przechodzi - autorytetem jest kontrakt RPC", () => {
    // Stan faktyczny, przypięty świadomie: `!isSuper` przepuści każdą wartość
    // prawdziwą. Że `is_super_admin()` oddaje BOOLEAN, pilnują bramki
    // `check:rpc-contract` / `check:db-contract` i pgTAP
    // (`role_management_test.sql`) - nie ten plik. Test istnieje, żeby nikt nie
    // czytał tej linii jako walidacji typu.
    rpcResult = { data: "yes", error: null };
    happyPath();
    return expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).resolves.toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 4. ODCZYT KONTA CELU.
// ---------------------------------------------------------------------------

describe("podszycie - konto celu", () => {
  const MISSING: readonly { label: string; response: AdminUserResponse }[] = [
    {
      label: "odczyt padł",
      response: { data: null, error: { message: "user not found" } },
    },
    { label: "brak `data`", response: { data: null, error: null } },
    { label: "`data.user` jest `null`", response: { data: { user: null }, error: null } },
    {
      label: "konto bez adresu (`null`)",
      response: { data: { user: { email: null } }, error: null },
    },
    {
      label: "adres pusty (wartość FAŁSZYWA, ale PRAWIDŁOWA)",
      response: { data: { user: { email: "" } }, error: null },
    },
  ];

  it.each(MISSING)("odmawia, gdy $label", async ({ response }) => {
    happyPath();
    h.userResponse = response;
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow("Target user not found or has no email");
  });

  it.each(MISSING)(
    "przy odmowie ($label) NIE generuje tokenu i NIE pisze audytu",
    async ({ response }) => {
      // Konto bez adresu nie może dostać magic linku - ale ważniejsze jest to,
      // że nie powstaje wtedy ŻADEN wiersz w `impersonation_sessions`. Wpis
      // audytowy bez podszycia zaśmieca dowód i podnosi fałszywy alarm.
      happyPath();
      h.userResponse = response;
      await expect(
        callServerFn(startImpersonation, { data: startInput(), context: context() }),
      ).rejects.toThrow();
      expect(h.authCalls.map((call) => call.step)).toEqual(["getUserById"]);
      expect(db().chainsFor("impersonation_sessions")).toEqual([]);
    },
  );

  it("pyta o DOKŁADNIE ten identyfikator, który przyszedł na wejściu", async () => {
    happyPath();
    await callServerFn(startImpersonation, { data: startInput(), context: context() });
    expect(h.authCalls[0]).toEqual({ step: "getUserById", args: IDS.target });
  });
});

// ---------------------------------------------------------------------------
// 5. NAJEMCA AKTORA W WIERSZU AUDYTU.
// ---------------------------------------------------------------------------

describe("podszycie - najemca aktora we wpisie audytowym", () => {
  const TENANTS: readonly { label: string; profile: SupabaseResult; expected: string | null }[] = [
    {
      label: "profil aktora z najemcą",
      profile: ok({ tenant_id: IDS.tenant }),
      expected: IDS.tenant,
    },
    { label: "profil z `tenant_id: null`", profile: ok({ tenant_id: null }), expected: null },
    { label: "brak wiersza profilu", profile: ok(null), expected: null },
    {
      label: "odczyt profilu PADŁ - handler i tak kontynuuje",
      profile: fail("connection reset"),
      expected: null,
    },
  ];

  it.each(TENANTS)("$label daje `tenant_id` = $expected", async ({ profile, expected }) => {
    // `actorProfile?.tenant_id ?? null` - trzy różne kształty odczytu dają
    // ten sam zapis. Czwarty przypadek to świadomy stan faktyczny: błąd
    // odczytu profilu NIE blokuje podszycia, tylko odbiera wpisowi zakres
    // najemcy. Wpis powstaje - i to jest tu ważniejsze niż jego kompletność.
    happyPath({ profile });
    await callServerFn(startImpersonation, { data: startInput(), context: context() });
    expect(insertedRow().tenant_id).toBe(expected);
  });

  it("czyta profil AKTORA, nie celu - po `id` z kontekstu", async () => {
    // Pomyłka tutaj wpisałaby do audytu najemcę osoby, pod którą się
    // podszywamy, czyli wskazywała nie tego, kto ponosi odpowiedzialność.
    happyPath();
    await callServerFn(startImpersonation, { data: startInput(), context: context() });
    const profiles = chain("profiles");
    expect(profiles.argsOf("select")).toEqual(["tenant_id"]);
    expect(profiles.argsOf("eq")).toEqual(["id", IDS.actor]);
    expect(profiles.has("maybeSingle")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. TOKEN MAGIC LINK.
// ---------------------------------------------------------------------------

describe("podszycie - token magic link", () => {
  it("prosi o magic link DLA ADRESU CELU", async () => {
    happyPath();
    await callServerFn(startImpersonation, { data: startInput(), context: context() });
    expect(h.authCalls[1]).toEqual({
      step: "generateLink",
      args: { type: "magiclink", email: TARGET_EMAIL },
    });
  });

  const LINK_FAILURES: readonly { label: string; response: GenerateLinkResponse }[] = [
    { label: "brak `data`", response: { data: null, error: null } },
    {
      label: "`properties` jest `null`",
      response: { data: { properties: null }, error: null },
    },
    {
      label: "token pusty (wartość FAŁSZYWA, ale PRAWIDŁOWA)",
      response: { data: { properties: { hashed_token: "" } }, error: null },
    },
    {
      label: "błąd bez komunikatu",
      response: { data: null, error: {} },
    },
  ];

  it.each(LINK_FAILURES)("odmawia z komunikatem domyślnym, gdy $label", async ({ response }) => {
    // `linkErr?.message ?? "Could not generate impersonation token"` - te
    // cztery kształty mają dać JEDEN czytelny komunikat, nie „undefined”.
    happyPath();
    h.linkResponse = response;
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow("Could not generate impersonation token");
  });

  it("przy braku tokenu NIE powstaje wiersz audytu", async () => {
    happyPath();
    h.linkResponse = { data: null, error: null };
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow();
    expect(db().chainsFor("impersonation_sessions")).toEqual([]);
  });

  it("przekazuje komunikat błędu z warstwy auth", async () => {
    happyPath();
    h.linkResponse = { data: null, error: { message: "email rate limit exceeded" } };
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow("email rate limit exceeded");
  });

  it("stan faktyczny: błąd z komunikatem PUSTYM daje wyjątek bez treści", async () => {
    // KONTROLA DODATNIA do defektu niżej - przypina to, co jest dziś.
    happyPath();
    h.linkResponse = { data: null, error: { message: "" } };
    const err = await rejection(() =>
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    );
    expect(err).toBeInstanceOf(Error);
    expect(errorMessage(err)).toBe("");
  });

  it.fails("DEFEKT: błąd z komunikatem PUSTYM gubi treść odmowy", async () => {
    // CO JEST ZŁE: `linkErr?.message ?? "Could not generate impersonation token"`
    // używa `??`, które łapie tylko `null`/`undefined`. Komunikat `""` jest
    // wartością FAŁSZYWĄ, ALE PRAWIDŁOWĄ - przechodzi na wyjście i staje się
    // treścią wyjątku.
    //
    // SKUTEK DLA UŻYTKOWNIKA: super admin klika „Zaloguj jako”, podszycie się
    // nie udaje, a toast jest PUSTY - nie ma czego wkleić do zgłoszenia i nie
    // wiadomo, czy to limit wysyłki, czy konto bez adresu.
    //
    // DLACZEGO NAPRAWA TO OSOBNA PRACA: to samo `??` na komunikacie błędu
    // powtarza się w kilku funkcjach serwerowych, więc poprawka to decyzja
    // o jednym helperze („komunikat albo domyślny”) i przejrzenie wszystkich
    // miejsc, a nie zmiana jednej linii w tym pliku.
    happyPath();
    h.linkResponse = { data: null, error: { message: "" } };
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow("Could not generate impersonation token");
  });
});

// ---------------------------------------------------------------------------
// 7. WIERSZ AUDYTU I WYNIK.
// ---------------------------------------------------------------------------

describe("podszycie - wpis audytowy i wynik", () => {
  it("wstawia DOKŁADNIE cztery pola i pyta o `id`", async () => {
    happyPath();
    await callServerFn(startImpersonation, {
      data: startInput({ reason: "zgłoszenie 42" }),
      context: context(),
    });
    expect(insertedRow()).toEqual({
      actor_user_id: IDS.actor,
      target_user_id: IDS.target,
      tenant_id: IDS.tenant,
      reason: "zgłoszenie 42",
    });
    const sessions = chain("impersonation_sessions");
    expect(sessions.argsOf("select")).toEqual(["id"]);
    expect(sessions.has("single")).toBe(true);
  });

  const REASON_ROWS: readonly { label: string; reason: unknown; stored: string | null }[] = [
    {
      label: "powód podany trafia do audytu",
      reason: "kontrola zgłoszenia",
      stored: "kontrola zgłoszenia",
    },
    { label: "brak powodu zapisuje `null`", reason: undefined, stored: null },
    { label: "powód PUSTY zapisuje pusty napis, nie `null`", reason: "", stored: "" },
  ];

  it.each(REASON_ROWS)("$label", async ({ reason, stored }) => {
    // `data.reason ?? null`: pusty napis jest wartością FAŁSZYWĄ, ale
    // PRAWIDŁOWĄ, więc idzie do bazy jako `""`. Rozróżnienie „nie podano”
    // (`null`) od „podano nic” (`""`) jest w audycie realną różnicą.
    happyPath();
    await callServerFn(startImpersonation, {
      data: startInput(reason === undefined ? {} : { reason }),
      context: context(),
    });
    expect(insertedRow().reason).toBe(stored);
  });

  const AUDIT_FAILURES: readonly { label: string; response: SupabaseResult }[] = [
    { label: "zapis audytu padł", response: fail("insert violates policy", "42501") },
    { label: "zapis nie oddał wiersza", response: ok(null) },
  ];

  it.each(AUDIT_FAILURES)("odmawia, gdy $label", async ({ response }) => {
    happyPath();
    db().setResponse("impersonation_sessions", response);
    await expect(
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    ).rejects.toThrow("Could not record impersonation session");
  });

  it.each(AUDIT_FAILURES)("gdy $label, token NIE WYCHODZI z funkcji", async ({ response }) => {
    // NAJWAŻNIEJSZA WŁASNOŚĆ BEZPIECZEŃSTWA tej funkcji: bez śladu nie ma
    // podszycia. Token magic link w tym momencie już istnieje w Supabase, ale
    // handler nie może go oddać - inaczej powstałaby sesja pod cudzym kontem,
    // o której nie ma ani jednego wiersza dowodu.
    happyPath();
    db().setResponse("impersonation_sessions", response);
    const err = await rejection(() =>
      callServerFn(startImpersonation, { data: startInput(), context: context() }),
    );
    expect(errorMessage(err)).toBe("Could not record impersonation session");
    expect(errorMessage(err)).not.toContain(TOKEN_HASH);
    expect(JSON.stringify(err)).not.toContain(TOKEN_HASH);
  });

  it("wynik ma DOKŁADNIE pięć pól - nic ponad to, co potrzebne klientowi", async () => {
    // RODO/minimalizacja: klient potrzebuje tokenu, adresu (do etykiety
    // banera), identyfikatora celu i sesji audytowej. Cokolwiek więcej
    // (rola celu, jego najemca, metadane konta) wyciekałoby do przeglądarki.
    happyPath();
    const result = await callServerFn<Record<string, unknown>>(startImpersonation, {
      data: startInput(),
      context: context(),
    });
    expect(Object.keys(result).sort()).toEqual([
      "email",
      "ok",
      "sessionId",
      "targetUserId",
      "tokenHash",
    ]);
    expect(result).toEqual({
      ok: true,
      tokenHash: TOKEN_HASH,
      email: TARGET_EMAIL,
      targetUserId: IDS.target,
      sessionId: IDS.session,
    });
  });

  it("token NIE jest zbudowany z adresu e-mail celu", async () => {
    // Gdyby „hash” zawierał adres, sam token stawałby się nośnikiem danych
    // osobowych w sessionStorage przeglądarki i w logach.
    happyPath();
    const result = await callServerFn<{ tokenHash: string }>(startImpersonation, {
      data: startInput(),
      context: context(),
    });
    expect(result.tokenHash).not.toContain(TARGET_EMAIL);
    expect(result.tokenHash).not.toContain("example.com");
  });

  it("kolejność kroków: rola, konto celu, profil aktora, token, audyt", async () => {
    // Kolejność JEST regułą, nie szczegółem: każdy krok dalej jest droższy
    // i bardziej nieodwracalny od poprzedniego.
    happyPath();
    await callServerFn(startImpersonation, { data: startInput(), context: context() });
    expect(rpcCalls.map((call) => call.name)).toEqual(["is_super_admin"]);
    expect(h.authCalls.map((call) => call.step)).toEqual(["getUserById", "generateLink"]);
    expect(db().chains.map((entry) => entry.table)).toEqual(["profiles", "impersonation_sessions"]);
  });
});

// ---------------------------------------------------------------------------
// 8. `endImpersonation` - zamknięcie śladu.
// ---------------------------------------------------------------------------

describe("podszycie - endImpersonation", () => {
  const REJECTED: readonly { label: string; input: unknown }[] = [
    { label: "brak wejścia", input: undefined },
    { label: "wejście `null`", input: null },
    { label: "pusty obiekt", input: {} },
    { label: "`sessionId` liczbą", input: { sessionId: 1 } },
    { label: "`sessionId` jako `null`", input: { sessionId: null } },
  ];

  it.each(REJECTED)("walidator odrzuca: $label", ({ input }) => {
    expect(() => validateServerFnInput(endImpersonation, input)).toThrow("sessionId required");
  });

  it("stan faktyczny: PUSTY `sessionId` przechodzi walidator", () => {
    // Przypięcie faktu, nie pochwała: walidator sprawdza TYP, nie treść.
    // Skutek jest niegroźny (filtr `id = ''` nie trafia w nic i baza odrzuci
    // rzutowanie na uuid), ale test ma to mówić wprost, żeby nikt nie zakładał
    // walidacji formatu tam, gdzie jej nie ma.
    const parsed = validateServerFnInput<{ sessionId: string }>(endImpersonation, {
      sessionId: "",
    });
    expect(parsed.sessionId).toBe("");
  });

  it("zamyka wiersz ZAWĘŻONY do aktora - trzy filtry, nie jeden", async () => {
    // TU JEST CAŁA OBRONA TEJ FUNKCJI. Nie ma bramki roli (świadomie), więc
    // gdyby zniknął `eq("actor_user_id", …)`, każdy zalogowany użytkownik
    // mógłby oznaczyć dowolną sesję podszycia jako zakończoną - czyli
    // sfałszować ślad audytowy cudzej operacji.
    db().setResponse("impersonation_sessions", ok(null));
    await callServerFn(endImpersonation, {
      data: { sessionId: IDS.session },
      context: context(),
    });
    const sessions = chain("impersonation_sessions");
    expect(sessions.calls.map((call) => call.method)).toEqual(["update", "eq", "eq", "is"]);
    expect(sessions.calls[1]?.args).toEqual(["id", IDS.session]);
    expect(sessions.calls[2]?.args).toEqual(["actor_user_id", IDS.actor]);
    expect(sessions.calls[3]?.args).toEqual(["ended_at", null]);
  });

  it("nie zamyka wiersza JUŻ zamkniętego (`is ended_at null`)", async () => {
    // Bez tego filtra powtórne kliknięcie „Wróć do siebie” przesunęłoby
    // stempel zakończenia, czyli skróciło udokumentowany czas podszycia.
    db().setResponse("impersonation_sessions", ok(null));
    await callServerFn(endImpersonation, {
      data: { sessionId: IDS.session },
      context: context(),
    });
    expect(chain("impersonation_sessions").argsOf("is")).toEqual(["ended_at", null]);
  });

  it("stempluje `ended_at` USTALONYM czasem, bez innych pól", async () => {
    db().setResponse("impersonation_sessions", ok(null));
    await callServerFn(endImpersonation, {
      data: { sessionId: IDS.session },
      context: context(),
    });
    expect(updatedRow()).toEqual({ ended_at: BASE_NOW_ISO });
  });

  it("NIE pyta o rolę - bramką jest zawężenie do aktora", async () => {
    // Świadoma asymetria wobec `startImpersonation`. Test pilnuje, żeby nikt
    // nie „poprawił” tego dokładaniem `is_super_admin`: super admin, który
    // JEST w trakcie podszycia, ma w tym momencie sesję CELU, więc bramka
    // roli zablokowałaby mu powrót do własnego konta.
    db().setResponse("impersonation_sessions", ok(null));
    await callServerFn(endImpersonation, {
      data: { sessionId: IDS.session },
      context: context(),
    });
    expect(rpcCalls).toEqual([]);
  });

  it("nie tyka żadnej innej tabeli", async () => {
    db().setResponse("impersonation_sessions", ok(null));
    await callServerFn(endImpersonation, {
      data: { sessionId: IDS.session },
      context: context(),
    });
    expect(new Set(db().chains.map((entry) => entry.table))).toEqual(
      new Set(["impersonation_sessions"]),
    );
  });

  it("stan faktyczny: oddaje `ok: true` także wtedy, gdy NIC nie zamknął", async () => {
    // Handler nie czyta ani błędu, ani liczby zmienionych wierszy - zawsze
    // `{ ok: true }`. To jest zamierzone (klient woła to jako best-effort
    // w `finally`), ale znaczy, że sukces w odpowiedzi NIE JEST dowodem
    // zamknięcia śladu. Test mówi to wprost, żeby nikt nie budował na tym
    // sukcesie interfejsu „ślad zamknięty”.
    db().setResponse("impersonation_sessions", fail("row not found"));
    const result = await callServerFn(endImpersonation, {
      data: { sessionId: IDS.session },
      context: context("99999999-9999-4999-8999-999999999999"),
    });
    expect(result).toEqual({ ok: true });
  });
});
