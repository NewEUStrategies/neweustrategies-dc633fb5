// SERWEROWY SYSTEM ZAPROSZEŃ (`src/lib/admin/invitations.functions.ts`):
// 790 linii, dziewięć eksportowanych funkcji, ZERO wykonanych funkcji.
//
// CO TEN PLIK DOWODZI. Własny komentarz modułu obiecuje, że „wszystkie server
// functions są chronione `requireSupabaseAuth` + weryfikacją roli
// admin/super_admin per tenant wywołującego" - i NIC tego nie dowodziło. To
// jedyna droga w całej platformie, przez którą powstają KONTA i nadawane są
// ROLE bez udziału bazy jako autorytetu (`supabaseAdmin` omija RLS), więc luka
// w tej warstwie nie jest usterką, a zdarzeniem prawnym.
//
// Dowodzimy trzech rzeczy, w tej kolejności:
//
//   1. OBUDOWA. Każda z dziewięciu funkcji DEKLARUJE `requireSupabaseAuth`
//      i ma walidator wejścia. To bramka strukturalna, nie behawioralna -
//      patrz „czego nie udaje harness" niżej.
//   2. BRAMKA ROLI I NAJEMCY W CIELE HANDLERA (`assertAdmin`). Trzy różne
//      odmowy (brak najemcy, awaria odczytu ról, brak roli admina) i - co
//      najważniejsze - ZAWĘŻENIE ZAPYTANIA O ROLE DO NAJEMCY wywołującego.
//      Bez tego ostatniego admin z najemcy A byłby adminem u najemcy B.
//      Przy każdej odmowie dowodzimy dodatkowo, że handler NIE TKNĄŁ żadnej
//      tabeli poza `profiles`/`user_roles` - odmowa musi wyprzedzić pracę.
//   3. ORKIESTRACJĘ: parsowanie widgetów zespołu, kształt wstawianych wierszy,
//      kolejność kroków wysyłki, ślad audytowy, i CO SIĘ DZIEJE, gdy któryś
//      krok padnie.
//
// CZEGO TEN HARNESS NIE UDAJE - I DLACZEGO TO NIE JEST LUKA.
// `@/test/serverFnHarness` nie uruchamia middleware (patrz nagłówek harnessu),
// więc test handlera NIE dowodzi, że nieuwierzytelnione żądanie zostanie
// odrzucone - tego pilnują `requireSupabaseAuth` w runtime i bramka statyczna
// `check:authz-snapshot`. Dlatego „brak sesji" jest tu sprawdzany jako
// DEKLARACJA middleware (punkt 1), a nie jako zachowanie handlera: test, który
// udawałby jedno drugim, dawałby fałszywą pewność co do warstwy, której
// w ogóle nie dotyka.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY: `role_management_test.sql` (11 asercji: `change_user_role`
//   wymaga `admin`/`super_admin`, zabrania zmiany własnej roli, pilnuje najemcy
//   celu, pisze do `role_audit_log`, a pisanie wprost do `user_roles` jest
//   zamknięte), `rls_tenant_isolation_test.sql`,
//   `tenant_isolation_three_tenants_test.sql`,
//   `security_definer_tenant_scope_test.sql`.
// - INTERFEJSU MODALEK: `src/components/admin/users/__tests__/userDialogs.test.tsx`.
// - BRAMKI POCZTY: `enqueueRawEmail` ma własny test; tutaj jest atrapą
//   i sprawdzamy WYŁĄCZNIE, co system zaproszeń robi z jej odmową.
//
// RODO: żadnych realnych danych osobowych. Adresy wyłącznie w `example.org`,
// imiona umowne, żadnego adresu IP. Osobna asercja pilnuje, że hasło
// tymczasowe NIE WYCIEKA do śladu audytowego ani do `last_error`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
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

const h = vi.hoisted(() => ({
  /** Wywołania `auth.admin.*` - kolejność i argumenty tworzenia kont. */
  authCalls: [] as { kind: string; email: string; payload: unknown }[],
  /** Identyfikator, jaki oddaje warstwa auth; `null` = „konto bez id". */
  authUserId: "aaaa1111-2222-4333-8444-555566667777" as string | null,
  /**
   * Błąd z warstwy auth przy tworzeniu konta. Typ `unknown`, bo `auth.admin`
   * potrafi oddać kształt bez `message` - a to jest osobna gałąź w obsłudze
   * wyjątku (`err instanceof Error ? … : String(err)`).
   */
  authError: null as unknown,
  /** Zapisy przez `supabaseAdmin` (omijające RLS) - tabela + wiersz + opcje. */
  adminWrites: [] as { table: string; row: unknown; options?: unknown }[],
  /** Wiersze, jakie `supabaseAdmin` oddaje przy odczycie profili do dowiązania. */
  adminProfiles: [] as { id: string; email: string | null; slug: string | null }[],
  /** Gdy `true`, odczyt profili oddaje `data: null` (kształt realnie możliwy). */
  adminProfilesNull: false,
  /**
   * Gdy `true`, `createUser` pada TYLKO przy pierwszym wywołaniu. Sterowanie
   * stanem, a nie `vi.spyOn` na zamockowanym module: podszycie się pod
   * `PostgrestQueryBuilder`/`AdminUserAttributes` wymagałoby rzutowania,
   * a rzutowania są w tym repo pod ratchetem (`check:unknown-casts`).
   */
  authFailsFirstOnly: false,
  /** Wysłane wiadomości - atrapa bramki poczty. */
  emails: [] as { to: string; subject: string; html: string }[],
  emailOk: true,
  /** Awaria generatora linku aktywacyjnego. */
  linkError: null as Error | null,
  emailError: "smtp down",
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, payload: unknown) => {
          h.authCalls.push({ kind: "invite", email, payload });
          if (h.authError) return { data: { user: null }, error: h.authError };
          return {
            data: { user: h.authUserId ? { id: h.authUserId } : null },
            error: null,
          };
        },
        generateLink: async (payload: { type: string; email: string }) => {
          h.authCalls.push({ kind: `link:${payload.type}`, email: payload.email, payload });
          if (h.linkError) return { data: null, error: h.linkError };
          return {
            data: { properties: { action_link: "https://example.test/activate?token=abc" } },
            error: null,
          };
        },
        createUser: async (payload: { email: string }) => {
          h.authCalls.push({ kind: "create", email: payload.email, payload });
          if (h.authFailsFirstOnly) {
            const isFirst = h.authCalls.filter((call) => call.kind === "create").length === 1;
            if (isFirst) {
              return { data: { user: null }, error: new Error("User already registered") };
            }
          } else if (h.authError) {
            return { data: { user: null }, error: h.authError };
          }
          return {
            data: { user: h.authUserId ? { id: h.authUserId } : null },
            error: null,
          };
        },
      },
    },
    from: (table: string) => ({
      upsert: (row: unknown, options?: unknown) => {
        h.adminWrites.push({ table, row, options });
        return Promise.resolve({ data: null, error: null });
      },
      select: () => ({
        in: () =>
          Promise.resolve({ data: h.adminProfilesNull ? null : h.adminProfiles, error: null }),
      }),
    }),
  },
}));

vi.mock("@/lib/email/transactional.server", () => ({
  enqueueRawEmail: async (input: { to: string; subject: string; html: string }) => {
    h.emails.push(input);
    return h.emailOk ? { ok: true } : { ok: false, error: h.emailError };
  },
}));

import {
  createInvitations,
  linkTeamWidgets,
  listInvitations,
  previewTeamImport,
  provisionTeamMembers,
  resendInvitationsForEmails,
  revokeInvitation,
  sendInvitation,
  sendInvitationsBulk,
} from "@/lib/admin/invitations.functions";

const IDS = {
  caller: "11111111-1111-4111-8111-111111111111",
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherTenant: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  invitation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  invitationB: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  page: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  existingUser: "ffffffff-ffff-4fff-8fff-ffffffffffff",
} as const;

const BASE_ISO = "2026-01-15T10:00:00.000Z";
const OLDER_ISO = "2025-06-01T08:30:00.000Z";

let db: ReturnType<typeof supabaseFromStub>;
/**
 * Wywołania RPC zapisane przez atrapę klienta. `admin_list_users` jest JEDYNYM
 * miejscem w platformie zwracającym adresy e-mail kont, więc test musi widzieć,
 * czy moduł w ogóle o nie pyta (i kiedy tego NIE robi - patrz test „strona bez
 * `builder_data` … NIE pyta o użytkowników").
 */
let rpcCalls: { name: string; args: unknown }[] = [];
/** Wynik `admin_list_users` - lista kont w najemcy wywołującego. */
let rpcUsers: { id: string; email: string | null; slug?: string | null }[] = [];

/**
 * Klient w kształcie, jakiego oczekuje handler: `from()` z atrapy łańcucha
 * PLUS `rpc()`. `supabaseFromStub()` celowo nie zna RPC (jest atomem łańcucha
 * PostgREST), więc składamy je tutaj, zamiast rozszerzać wspólny harness dla
 * jednego modułu.
 */
function client(): { from: (table: string) => unknown; rpc: (name: string) => Promise<unknown> } {
  return {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: rpcUsers, error: null });
    },
  };
}

function context(): ServerFnContext {
  return { supabase: client(), userId: IDS.caller };
}

/**
 * Ustawia bramkę `assertAdmin` na „przechodzi": profil wywołującego ma
 * najemcę, a jego wiersz roli należy DO TEGO SAMEGO najemcy.
 */
function grantAdmin(tenantId: string = IDS.tenant): void {
  db.setResponse("profiles", ok({ tenant_id: tenantId }));
  db.setResponse("user_roles", ok([{ role: "admin" }]));
}

/** Widget `team-member` w kształcie, w jakim leży w `builder_data`. */
function teamWidget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { id, ...content } = overrides;
  return {
    id: id ?? "w-1",
    type: "team-member",
    content: {
      email: "nowa@example.org",
      name: "Nowa Osoba",
      position_pl: "Analityczka",
      position_en: "Analyst",
      ...content,
    },
  };
}

/** Dokument buildera z podanymi widgetami - zagnieżdżony jak w produkcji. */
function builderDoc(widgets: Record<string, unknown>[]): Record<string, unknown> {
  return { sections: [{ id: "s-1", columns: [{ id: "c-1", widgets }] }] };
}

interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  role: string;
  mode: string;
  status: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
  auth_user_id: string | null;
  created_at: string;
}

function invitationRow(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: IDS.invitation,
    tenant_id: IDS.tenant,
    email: "nowa@example.org",
    display_name: "Nowa Osoba",
    role: "author",
    mode: "magic_link",
    status: "pending",
    source: "manual",
    metadata: {},
    auth_user_id: null,
    created_at: BASE_ISO,
    ...overrides,
  };
}

beforeEach(() => {
  db = supabaseFromStub();
  rpcCalls = [];
  rpcUsers = [];
  h.authCalls = [];
  h.authUserId = "aaaa1111-2222-4333-8444-555566667777";
  h.authError = null;
  h.adminWrites = [];
  h.adminProfiles = [];
  h.adminProfilesNull = false;
  h.authFailsFirstOnly = false;
  h.emails = [];
  h.emailOk = true;
  h.linkError = null;
  h.emailError = "smtp down";
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA - bramka strukturalna dla wszystkich dziewięciu funkcji.
// ---------------------------------------------------------------------------

describe("system zaproszeń - obudowa server functions", () => {
  const EXPORTS: readonly { name: string; fn: unknown; method: string; validator: boolean }[] = [
    { name: "previewTeamImport", fn: previewTeamImport, method: "POST", validator: true },
    { name: "createInvitations", fn: createInvitations, method: "POST", validator: true },
    { name: "sendInvitation", fn: sendInvitation, method: "POST", validator: true },
    { name: "sendInvitationsBulk", fn: sendInvitationsBulk, method: "POST", validator: true },
    {
      name: "resendInvitationsForEmails",
      fn: resendInvitationsForEmails,
      method: "POST",
      validator: true,
    },
    { name: "revokeInvitation", fn: revokeInvitation, method: "POST", validator: true },
    { name: "linkTeamWidgets", fn: linkTeamWidgets, method: "POST", validator: true },
    // Odczyt listy nie przyjmuje wejścia - i to jest zamierzone: filtrowanie
    // robi interfejs, a nie parametr, którym dałoby się wyjść z najemcy.
    { name: "listInvitations", fn: listInvitations, method: "GET", validator: false },
    { name: "provisionTeamMembers", fn: provisionTeamMembers, method: "POST", validator: true },
  ];

  it.each(EXPORTS)("$name deklaruje `requireSupabaseAuth`", ({ fn }) => {
    // Bramka strukturalna: harness NIE uruchamia middleware, więc to jedyne
    // miejsce, w którym da się dowieść, że funkcja w ogóle je ma. Usunięcie
    // middleware z którejkolwiek z nich otwiera tworzenie kont anonimowi.
    expect(serverFnMiddlewareNames(fn)).toContain("requireSupabaseAuth");
  });

  it.each(EXPORTS)("$name ma metodę $method", ({ fn, method }) => {
    // `GET` na funkcji tworzącej konta dałby się wywołać z `<img src>` -
    // metoda jest częścią obrony przed CSRF, nie kosmetyką.
    expect(Reflect.get(fn as object, "method")).toBe(method);
  });

  it.each(EXPORTS.filter((entry) => entry.validator))("$name waliduje wejście", ({ fn }) => {
    expect(Reflect.get(fn as object, "validator")).toBeTypeOf("function");
  });

  it("`listInvitations` NIE przyjmuje wejścia - filtrowanie należy do interfejsu", () => {
    expect(Reflect.get(listInvitations as object, "validator")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. BRAMKA ROLI I NAJEMCY (`assertAdmin`) - dla KAŻDEJ funkcji.
// ---------------------------------------------------------------------------

describe("system zaproszeń - bramka roli i najemcy", () => {
  /** Wywołania każdej funkcji z minimalnym poprawnym wejściem. */
  const CALLS: readonly { name: string; run: () => Promise<unknown> }[] = [
    {
      name: "previewTeamImport",
      run: () =>
        callServerFn(previewTeamImport, { data: { pageSlug: "o-nas" }, context: context() }),
    },
    {
      name: "createInvitations",
      run: () =>
        callServerFn(createInvitations, {
          data: {
            items: [
              {
                email: "nowa@example.org",
                display_name: "Nowa Osoba",
                role: "author",
                mode: "magic_link",
              },
            ],
          },
          context: context(),
        }),
    },
    {
      name: "sendInvitation",
      run: () => callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() }),
    },
    {
      name: "sendInvitationsBulk",
      run: () =>
        callServerFn(sendInvitationsBulk, { data: { ids: [IDS.invitation] }, context: context() }),
    },
    {
      name: "resendInvitationsForEmails",
      run: () =>
        callServerFn(resendInvitationsForEmails, {
          data: { emails: ["nowa@example.org"] },
          context: context(),
        }),
    },
    {
      name: "revokeInvitation",
      run: () =>
        callServerFn(revokeInvitation, { data: { id: IDS.invitation }, context: context() }),
    },
    {
      name: "linkTeamWidgets",
      run: () => callServerFn(linkTeamWidgets, { data: { pageSlug: "o-nas" }, context: context() }),
    },
    {
      name: "listInvitations",
      run: () => callServerFn(listInvitations, { context: context() }),
    },
    {
      name: "provisionTeamMembers",
      run: () =>
        callServerFn(provisionTeamMembers, { data: { pageSlug: "o-nas" }, context: context() }),
    },
  ];

  it.each(CALLS)(
    "$name odmawia BEZ kontekstu najemcy - i nie tyka innych tabel",
    async ({ run }) => {
      // Profil bez `tenant_id` to konto poza jakimkolwiek najemcą. Wszystko, co
      // dalej, byłoby zapisem bez zakresu izolacji.
      db.setResponse("profiles", ok({ tenant_id: null }));
      await expect(run()).rejects.toThrow("Forbidden: no tenant context");
      const touched = new Set(db.chains.map((chain) => chain.table));
      expect(touched).toEqual(new Set(["profiles"]));
    },
  );

  it.each(CALLS)("$name odmawia, gdy profilu wywołującego NIE MA", async ({ run }) => {
    db.setResponse("profiles", ok(null));
    await expect(run()).rejects.toThrow("Forbidden: no tenant context");
  });

  it.each(CALLS)("$name odmawia, gdy odczyt profilu PADŁ", async ({ run }) => {
    // Awaria odczytu nie może być czytana jako „brak uprawnień do sprawdzenia,
    // więc pewnie wolno" - odmowa jest jedynym bezpiecznym domyślnym.
    db.setResponse("profiles", fail("connection reset"));
    await expect(run()).rejects.toThrow("Forbidden: no tenant context");
  });

  it.each(CALLS)(
    "$name odmawia, gdy odczyt RÓL padł - z powodem w komunikacie",
    async ({ run }) => {
      db.setResponse("profiles", ok({ tenant_id: IDS.tenant }));
      db.setResponse("user_roles", fail("permission denied for table user_roles"));
      await expect(run()).rejects.toThrow(/Forbidden: role lookup failed/);
      const touched = new Set(db.chains.map((chain) => chain.table));
      expect(touched).toEqual(new Set(["profiles", "user_roles"]));
    },
  );

  it.each(CALLS)("$name odmawia roli NIEWYSTARCZAJĄCEJ (pusty zbiór ról)", async ({ run }) => {
    // `/admin` przepuszcza `editor` i `author`; ta warstwa NIE.
    db.setResponse("profiles", ok({ tenant_id: IDS.tenant }));
    db.setResponse("user_roles", ok([]));
    await expect(run()).rejects.toThrow("Forbidden: admin role required");
    const touched = new Set(db.chains.map((chain) => chain.table));
    expect(touched).toEqual(new Set(["profiles", "user_roles"]));
  });

  it.each(CALLS)("$name odmawia, gdy odczyt ról zwrócił `null`", async ({ run }) => {
    db.setResponse("profiles", ok({ tenant_id: IDS.tenant }));
    db.setResponse("user_roles", ok(null));
    await expect(run()).rejects.toThrow("Forbidden: admin role required");
  });

  it("zapytanie o role jest ZAWĘŻONE do najemcy wywołującego i do dwóch ról", async () => {
    // TO JEST NAJWAŻNIEJSZA ASERCJA TEGO OPISU. Bez `.eq("tenant_id", …)`
    // admin najemcy A miałby admina u najemcy B - a `supabaseAdmin` niżej
    // omija RLS, więc baza już by tego nie zatrzymała. Zakresu po stronie
    // bazy pilnują `rls_tenant_isolation_test.sql` i
    // `tenant_isolation_three_tenants_test.sql`; tu dowodzimy, że aplikacja
    // w ogóle o ten zakres pyta.
    grantAdmin();
    db.setResponse("user_invitations", ok([]));
    await callServerFn(listInvitations, { context: context() });

    const rolesChain = db.lastChain("user_roles");
    expect(rolesChain).toBeTruthy();
    const eqArgs = rolesChain?.calls
      .filter((call) => call.method === "eq")
      .map((call) => call.args);
    expect(eqArgs).toEqual([
      ["user_id", IDS.caller],
      ["tenant_id", IDS.tenant],
    ]);
    // Zbiór ról jest DOMKNIĘTY: `editor`/`author` nie mogą tu wejść przez
    // rozszerzenie enumu w bazie.
    expect(rolesChain?.argsOf("in")).toEqual(["role", ["admin", "super_admin"]]);

    // Profil wywołującego czytany po JEGO identyfikatorze, nie po niczym innym.
    expect(db.lastChain("profiles")?.argsOf("eq")).toEqual(["id", IDS.caller]);
  });

  it("rola `super_admin` też przechodzi bramkę", async () => {
    db.setResponse("profiles", ok({ tenant_id: IDS.tenant }));
    db.setResponse("user_roles", ok([{ role: "super_admin" }]));
    db.setResponse("user_invitations", ok([]));
    await expect(callServerFn(listInvitations, { context: context() })).resolves.toEqual({
      invitations: [],
    });
  });

  it("najemca WYWOŁUJĄCEGO trafia do zapisu - nie żaden z wejścia", async () => {
    // Zaproszenie nie ma parametru najemcy i nie może go mieć: najemca jest
    // wyprowadzany z sesji, więc admin nie zaprosi nikogo do obcej organizacji.
    grantAdmin(IDS.otherTenant);
    db.setResponse("user_invitations", ok([{ id: IDS.invitation }]));
    await callServerFn(createInvitations, {
      data: {
        items: [
          {
            email: "nowa@example.org",
            display_name: "Nowa Osoba",
            role: "author",
            mode: "magic_link",
          },
        ],
      },
      context: context(),
    });
    const insert = db.lastChain("user_invitations")?.argsOf("insert");
    const rows = insert?.[0] as { tenant_id: string }[];
    expect(rows[0].tenant_id).toBe(IDS.otherTenant);
  });
});

// ---------------------------------------------------------------------------
// 3. PARSOWANIE WIDGETÓW ZESPOŁU (`previewTeamImport`).
// ---------------------------------------------------------------------------

describe("previewTeamImport - parsowanie strony i wykrywanie duplikatów", () => {
  beforeEach(() => {
    grantAdmin();
  });

  /** Zaplanuj stronę o podanym `builder_data`. */
  function withPage(builderData: unknown): void {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderData }));
  }

  async function preview(slug = "o-nas"): Promise<{ candidates: { email: string }[] }> {
    return callServerFn(previewTeamImport, { data: { pageSlug: slug }, context: context() });
  }

  it("strona jest szukana po slugu, W NAJEMCY i tylko nieusunięta", async () => {
    // Trzy warunki naraz i każdy niesie regułę: sam slug byłby globalny,
    // brak `deleted_at IS NULL` importowałby zespół ze strony w koszu.
    withPage(builderDoc([teamWidget()]));
    db.setResponse("user_invitations", ok([]));
    await preview("zespol");
    const chain = db.lastChain("pages");
    const eqArgs = chain?.calls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(eqArgs).toEqual([
      ["slug", "zespol"],
      ["tenant_id", IDS.tenant],
    ]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("brak strony to jawny błąd, nie pusta lista", async () => {
    // Pusta lista mówiłaby „na tej stronie nie ma zespołu"; administrator ma
    // wiedzieć, że pomylił slug.
    db.setResponse("pages", ok(null));
    await expect(preview()).rejects.toThrow("Page not found");
  });

  it("awaria odczytu strony przenosi komunikat bazy", async () => {
    db.setResponse("pages", fail("statement timeout"));
    await expect(preview()).rejects.toThrow("statement timeout");
  });

  it("strona BEZ `builder_data` daje pustą listę i NIE pyta o użytkowników", async () => {
    // Brak dalszych zapytań to nie optymalizacja: `admin_list_users` zwraca
    // adresy e-mail wszystkich kont w najemcy, więc nie wolno go wołać bez
    // potrzeby.
    withPage(null);
    await expect(preview()).resolves.toEqual({ candidates: [] });
    expect(db.chainsFor("user_invitations")).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("`builder_data` BEZ widgetów `team-member` daje pustą listę", async () => {
    withPage(builderDoc([{ id: "w-9", type: "heading", content: { text: "Zespół" } }]));
    await expect(preview()).resolves.toEqual({ candidates: [] });
  });

  it("widget bez ADRESU jest pomijany", async () => {
    withPage(builderDoc([teamWidget({ email: "" }), teamWidget({ id: "w-2" })]));
    db.setResponse("user_invitations", ok([]));
    const result = await preview();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].email).toBe("nowa@example.org");
  });

  it("widget bez NAZWY jest pomijany - konto bez nazwy jest nieużywalne", async () => {
    withPage(builderDoc([teamWidget({ email: "bez-nazwy@example.org", name: "" })]));
    await expect(preview()).resolves.toEqual({ candidates: [] });
  });

  it("adres z samych spacji liczy się jako BRAK adresu", async () => {
    withPage(builderDoc([teamWidget({ email: "   " })]));
    await expect(preview()).resolves.toEqual({ candidates: [] });
  });

  it("adres jest normalizowany do MAŁYCH LITER i obcinany ze spacji", async () => {
    // Unikalność adresu w bazie jest bez wielkości litery, więc parser musi
    // porównywać tak samo - inaczej `Jan@` i `jan@` to dwa konta.
    withPage(builderDoc([teamWidget({ email: "  NOWA@Example.ORG  " })]));
    db.setResponse("user_invitations", ok([]));
    const result = await preview();
    expect(result.candidates[0].email).toBe("nowa@example.org");
  });

  it("DUPLIKAT adresu w obrębie jednej strony wchodzi TYLKO RAZ", async () => {
    // Dwa widgety z tym samym adresem to typowa sytuacja (osoba w dwóch
    // sekcjach); bez odsiania powstałyby dwa zaproszenia i dwa konta.
    withPage(
      builderDoc([
        teamWidget({ id: "w-1" }),
        teamWidget({ id: "w-2", name: "Nowa Osoba (druga sekcja)" }),
      ]),
    );
    db.setResponse("user_invitations", ok([]));
    const result = await preview();
    expect(result.candidates).toHaveLength(1);
    // Wygrywa PIERWSZY widget - kolejność w dokumencie jest rozstrzygająca.
    expect(result.candidates[0]).toMatchObject({ widgetId: "w-1" });
  });

  it("`builder_data` o NIEZNANYM kształcie nie może rzucić", async () => {
    // Parser chodzi po dowolnym drzewie; dokument z innej wersji buildera,
    // z `null`-ami, liczbami i cyklem po tablicach nie może wywalić panelu.
    for (const shape of [
      42,
      "łańcuch",
      true,
      [],
      [null, undefined, 1, "x"],
      { sections: null },
      { sections: [{ columns: [{ widgets: null }] }] },
      { type: "team-member" }, // bez `content`
      { type: "team-member", content: null },
      { type: "team-member", content: "nie obiekt" },
      { nested: { deeper: { deepest: [{ type: "team-member", content: {} }] } } },
    ]) {
      db = supabaseFromStub();
      grantAdmin();
      withPage(shape);
      db.setResponse("user_invitations", ok([]));
      await expect(preview(), `kształt ${JSON.stringify(shape)}`).resolves.toEqual({
        candidates: [],
      });
    }
  });

  it("widget zagnieżdżony GŁĘBOKO nadal jest znajdowany", async () => {
    withPage({ a: [{ b: { c: [[{ d: teamWidget() }]] } }] });
    db.setResponse("user_invitations", ok([]));
    const result = await preview();
    expect(result.candidates).toHaveLength(1);
  });

  it('puste ciągi w polach opcjonalnych stają się `null`, nie `""`', async () => {
    // `""` w kolumnie profilu to wartość „ustawiona na pustą"; `null` to
    // „nieustawiona". Różnica decyduje o tym, czy `??` w interfejsie zadziała.
    withPage(builderDoc([teamWidget({ position_pl: "   ", phone: "", bio_en: "Bio" })]));
    db.setResponse("user_invitations", ok([]));
    const result = await preview();
    expect(result.candidates[0]).toMatchObject({
      position_pl: null,
      phone: null,
      bio_en: "Bio",
    });
  });

  it("pola nie-tekstowe w widgetcie są traktowane jak brak", async () => {
    withPage(builderDoc([teamWidget({ phone: 123456, linkedin: { url: "x" } })]));
    db.setResponse("user_invitations", ok([]));
    const result = await preview();
    expect(result.candidates[0]).toMatchObject({ phone: null, linkedin: null });
  });

  it("widget bez `id` daje `widgetId: null` - i to nie blokuje importu", async () => {
    withPage(builderDoc([{ type: "team-member", content: teamWidget().content }]));
    db.setResponse("user_invitations", ok([]));
    const result = await preview();
    expect(result.candidates[0]).toMatchObject({ widgetId: null });
  });

  it("ISTNIEJĄCE KONTO jest wykrywane BEZ WZGLĘDU na wielkość liter adresu", async () => {
    // Unikalność adresu w bazie jest bez wielkości litery, więc dopasowanie
    // też musi być - inaczej import zrobi drugie konto dla `Nowa@` obok `nowa@`.
    withPage(builderDoc([teamWidget({ email: "nowa@example.org" })]));
    db.setResponse("user_invitations", ok([]));
    rpcUsers = [{ id: IDS.existingUser, email: "NOWA@Example.ORG" }];
    const result = await callServerFn<{
      candidates: { existingUserId: string | null }[];
    }>(previewTeamImport, { data: { pageSlug: "o-nas" }, context: context() });
    expect(rpcCalls.map((call) => call.name)).toEqual(["admin_list_users"]);
    expect(result.candidates[0].existingUserId).toBe(IDS.existingUser);
  });

  it("konto BEZ adresu w wyniku RPC nie wchodzi do mapy dopasowań", async () => {
    withPage(builderDoc([teamWidget()]));
    db.setResponse("user_invitations", ok([]));
    rpcUsers = [{ id: IDS.existingUser, email: null }];
    const result = await callServerFn<{ candidates: { existingUserId: string | null }[] }>(
      previewTeamImport,
      { data: { pageSlug: "o-nas" }, context: context() },
    );
    expect(result.candidates[0].existingUserId).toBeNull();
  });

  it("ISTNIEJĄCE ZAPROSZENIE jest wykrywane po adresie, bez wielkości liter", async () => {
    withPage(builderDoc([teamWidget()]));
    db.setResponse("user_invitations", ok([{ id: IDS.invitation, email: "NOWA@EXAMPLE.ORG" }]));
    const result = await callServerFn<{
      candidates: { existingInvitationId: string | null }[];
    }>(previewTeamImport, { data: { pageSlug: "o-nas" }, context: context() });
    expect(result.candidates[0].existingInvitationId).toBe(IDS.invitation);
  });

  it("zapytanie o zaproszenia jest zawężone do ADRESÓW ZE STRONY", async () => {
    // `select *` bez `in(email, …)` wyciągałby całą tabelę zaproszeń najemcy.
    withPage(builderDoc([teamWidget(), teamWidget({ id: "w-2", email: "druga@example.org" })]));
    db.setResponse("user_invitations", ok([]));
    await preview();
    expect(db.lastChain("user_invitations")?.argsOf("in")).toEqual([
      "email",
      ["nowa@example.org", "druga@example.org"],
    ]);
  });

  it("wynik RPC `null` i lista zaproszeń `null` nie wywracają podglądu", async () => {
    withPage(builderDoc([teamWidget()]));
    db.setResponse("user_invitations", ok(null));
    const nullRpcContext: ServerFnContext = {
      supabase: {
        from: (table: string) => db.from(table),
        rpc: async () => ({ data: null, error: null }),
      },
      userId: IDS.caller,
    };
    const result = await callServerFn<{
      candidates: { existingUserId: string | null; existingInvitationId: string | null }[];
    }>(previewTeamImport, { data: { pageSlug: "o-nas" }, context: nullRpcContext });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].existingUserId).toBeNull();
    expect(result.candidates[0].existingInvitationId).toBeNull();
  });

  it("walidator odrzuca PUSTY slug strony", () => {
    expect(() => validateServerFnInput(previewTeamImport, { pageSlug: "" })).toThrow();
    expect(() => validateServerFnInput(previewTeamImport, {})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. TWORZENIE ZAPROSZEŃ.
// ---------------------------------------------------------------------------

describe("createInvitations - kształt wstawianych wierszy i walidacja", () => {
  beforeEach(() => {
    grantAdmin();
  });

  const ITEM = {
    email: "nowa@example.org",
    display_name: "Nowa Osoba",
    role: "author",
    mode: "magic_link",
  } as const;

  it("wiersz niesie najemcę, autora zaproszenia, status `pending` i puste metadane", async () => {
    db.setResponse("user_invitations", ok([{ id: IDS.invitation }]));
    const result = await callServerFn<{ created: number; skipped: number; ids: string[] }>(
      createInvitations,
      { data: { items: [ITEM] }, context: context() },
    );
    const rows = db.lastChain("user_invitations")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toEqual({
      tenant_id: IDS.tenant,
      email: "nowa@example.org",
      display_name: "Nowa Osoba",
      role: "author",
      mode: "magic_link",
      status: "pending",
      // Brak źródła to `null`, nie `undefined` - kolumna ma być jawnie pusta.
      source: null,
      metadata: {},
      invited_by: IDS.caller,
    });
    expect(result).toEqual({ created: 1, skipped: 0, ids: [IDS.invitation] });
  });

  it("źródło i metadane przechodzą bez zmian", async () => {
    db.setResponse("user_invitations", ok([{ id: IDS.invitation }]));
    await callServerFn(createInvitations, {
      data: {
        items: [{ ...ITEM, source: "team_import:o-nas", metadata: { widgetId: "w-7" } }],
      },
      context: context(),
    });
    const rows = db.lastChain("user_invitations")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >[];
    expect(rows[0].source).toBe("team_import:o-nas");
    expect(rows[0].metadata).toEqual({ widgetId: "w-7" });
  });

  it("adres jest sprowadzany do MAŁYCH LITER przez walidator, nie przez wywołującego", () => {
    // Unikalność adresu w bazie jest bez wielkości litery, więc normalizacja
    // MUSI być po stronie serwera - klient da się obejść.
    const parsed = validateServerFnInput<{ items: { email: string }[] }>(createInvitations, {
      items: [{ ...ITEM, email: "NOWA@Example.ORG" }],
    });
    expect(parsed.items[0].email).toBe("nowa@example.org");
  });

  it("adres ze SPACJAMI jest ODRZUCANY, nie obcinany - `.trim()` jest tu bez wpływu", () => {
    // Schemat to `z.string().email().transform(v => v.trim().toLowerCase())`.
    // `.transform()` biegnie PO `.email()`, a `.email()` już odrzuca spacje,
    // więc obcięcie nigdy nie ma czego naprawić. Zapisujemy to jako
    // ZACHOWANIE, nie jako defekt: odmowa jest tu bezpieczniejsza od cichej
    // korekty (adres z niewidoczną spacją to zwykle błąd kopiowania, a konto
    // powstaje raz). Test pilnuje, żeby nikt nie „naprawił" tego przez
    // przestawienie ogniw bez decyzji.
    expect(() =>
      validateServerFnInput(createInvitations, { items: [{ ...ITEM, email: " a@example.org" }] }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(createInvitations, { items: [{ ...ITEM, email: "a@example.org " }] }),
    ).toThrow();
  });

  it("walidator odrzuca adres, który nie jest adresem", () => {
    expect(() =>
      validateServerFnInput(createInvitations, { items: [{ ...ITEM, email: "to-nie-adres" }] }),
    ).toThrow();
  });

  it("walidator odrzuca rolę SPOZA zbioru zaproszeń - w tym `super_admin`", () => {
    // `super_admin` nadaje się wyłącznie na karcie użytkownika, przez RPC
    // z osobnym uprawnieniem. Zaproszenie nie jest drogą do tej roli.
    for (const role of ["super_admin", "owner", ""]) {
      expect(() =>
        validateServerFnInput(createInvitations, { items: [{ ...ITEM, role }] }),
      ).toThrow();
    }
  });

  it("walidator odrzuca tryb wysyłki spoza zbioru", () => {
    expect(() =>
      validateServerFnInput(createInvitations, { items: [{ ...ITEM, mode: "sms" }] }),
    ).toThrow();
  });

  it("walidator odrzuca PUSTĄ listę i listę ponad 200 pozycji", () => {
    expect(() => validateServerFnInput(createInvitations, { items: [] })).toThrow();
    const many = Array.from({ length: 201 }, (_, index) => ({
      ...ITEM,
      email: `osoba${index}@example.org`,
    }));
    expect(() => validateServerFnInput(createInvitations, { items: many })).toThrow();
    // Dokładnie 200 przechodzi - granica jest inkluzywna.
    expect(() =>
      validateServerFnInput(createInvitations, { items: many.slice(0, 200) }),
    ).not.toThrow();
  });

  it("walidator odrzuca pustą nazwę i nazwę ponad 200 znaków", () => {
    expect(() =>
      validateServerFnInput(createInvitations, { items: [{ ...ITEM, display_name: "" }] }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(createInvitations, {
        items: [{ ...ITEM, display_name: "x".repeat(201) }],
      }),
    ).toThrow();
  });

  it("walidator odrzuca źródło ponad 80 znaków", () => {
    expect(() =>
      validateServerFnInput(createInvitations, {
        items: [{ ...ITEM, source: "s".repeat(81) }],
      }),
    ).toThrow();
  });

  it("odmowa wstawienia przenosi komunikat bazy", async () => {
    // Unikalny indeks na (tenant_id, email) daje tu 23505 - komunikat musi
    // dojść do interfejsu, bo to on tłumaczy administratorowi, co się stało.
    db.setResponse("user_invitations", fail("duplicate key value violates unique constraint"));
    await expect(
      callServerFn(createInvitations, { data: { items: [ITEM] }, context: context() }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("wstawienie zwracające `null` daje zero utworzonych, nie wyjątek", async () => {
    db.setResponse("user_invitations", ok(null));
    await expect(
      callServerFn(createInvitations, { data: { items: [ITEM] }, context: context() }),
    ).resolves.toEqual({ created: 0, skipped: 0, ids: [] });
  });

  it("wiele pozycji naraz daje wiele wierszy w JEDNYM wstawieniu", async () => {
    db.setResponse("user_invitations", ok([{ id: IDS.invitation }, { id: IDS.invitationB }]));
    const result = await callServerFn<{ created: number; ids: string[] }>(createInvitations, {
      data: {
        items: [ITEM, { ...ITEM, email: "druga@example.org", display_name: "Druga Osoba" }],
      },
      context: context(),
    });
    expect(db.chainsFor("user_invitations")).toHaveLength(1);
    expect(result.created).toBe(2);
    expect(result.ids).toEqual([IDS.invitation, IDS.invitationB]);
  });
});

// ---------------------------------------------------------------------------
// 5. WYSYŁKA ZAPROSZENIA (`performSend`) - najgłębsza ścieżka modułu.
// ---------------------------------------------------------------------------

describe("sendInvitation - tworzenie konta, hydracja profilu, ślad audytowy", () => {
  beforeEach(() => {
    grantAdmin();
  });

  /** Zaplanuj tabelę zaproszeń: odczyt daje wiersz, zapisy przechodzą. */
  function withInvitation(row: InvitationRow | null, readError?: string): void {
    db.setResponse("user_invitations", (chain) => {
      if (chain.has("update")) return ok(null);
      if (readError) return fail(readError);
      return ok(row);
    });
    db.setResponse("audit_log", ok(null));
  }

  async function send(id: string = IDS.invitation): Promise<{
    ok: boolean;
    email: string;
    error?: string;
    tempPassword?: string;
  }> {
    return callServerFn(sendInvitation, { data: { id }, context: context() });
  }

  it("brak zaproszenia to wynik `ok: false`, nie wyjątek", async () => {
    // Zbiorcza wysyłka nie może przerwać się na jednym brakującym rekordzie -
    // dlatego to wynik, a nie rzut.
    withInvitation(null);
    await expect(send()).resolves.toEqual({ ok: false, email: "?", error: "not_found" });
    expect(h.authCalls).toHaveLength(0);
  });

  it("awaria odczytu zaproszenia oddaje komunikat bazy jako powód", async () => {
    withInvitation(null, "statement timeout");
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("statement timeout");
  });

  it("tryb odnośnika jednorazowego zakłada konto i WYSYŁA własny e-mail z linkiem", async () => {
    withInvitation(invitationRow({ mode: "magic_link" }));
    const result = await send();
    expect(result.ok).toBe(true);
    expect(h.authCalls.map((call) => call.kind)).toEqual(["create", "link:invite"]);
    expect(h.authCalls[0].email).toBe("nowa@example.org");
    // Hasła tymczasowego NIE MA - w tym trybie logowanie idzie odnośnikiem.
    expect(result.tempPassword).toBeUndefined();
    // Wiadomość wychodzi z NASZEJ bramki i niesie link aktywacyjny.
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].html).toContain("https://example.test/activate?token=abc");
  });

  it("odnośnik jednorazowego dostępu niesie najemcę i nazwę w metadanych konta", async () => {
    withInvitation(invitationRow({ mode: "magic_link" }));
    await send();
    expect(h.authCalls[0].payload).toMatchObject({
      user_metadata: { display_name: "Nowa Osoba", tenant_id: IDS.tenant },
    });
  });

  it("tryb hasła tymczasowego tworzy konto z POTWIERDZONYM adresem i wymuszoną zmianą hasła", async () => {
    withInvitation(invitationRow({ mode: "temp_password" }));
    const result = await send();
    expect(h.authCalls[0].kind).toBe("create");
    expect(h.authCalls[0].payload).toMatchObject({
      email_confirm: true,
      user_metadata: { must_change_password: true, tenant_id: IDS.tenant },
    });
    expect(result.tempPassword).toBeTypeOf("string");
  });

  it("hasło tymczasowe ma 16 znaków z alfabetu BEZ mylących glifów", async () => {
    // `0/O/1/l/I` odpada, bo hasło jest przepisywane z ekranu albo z e-maila.
    // Nie asertujemy WARTOŚCI (jest losowa z założenia) - tylko kontrakt.
    withInvitation(invitationRow({ mode: "temp_password" }));
    const result = await send();
    expect(result.tempPassword).toHaveLength(16);
    expect(result.tempPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
  });

  it("dwa wywołania dają RÓŻNE hasła", async () => {
    withInvitation(invitationRow({ mode: "temp_password" }));
    const first = await send();
    const second = await send();
    expect(first.tempPassword).not.toBe(second.tempPassword);
  });

  it("konto JUŻ POWIĄZANE (ponowna wysyłka) nie jest tworzone drugi raz", async () => {
    // To jest sens ponowienia: rekord zaproszenia ma `auth_user_id`, więc
    // wysyłka pomija warstwę auth i tylko uzupełnia profil.
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser }));
    const result = await send();
    expect(h.authCalls.every((call) => call.kind.startsWith("link:"))).toBe(true);
    expect(result.ok).toBe(true);
    const profileWrite = h.adminWrites.find((write) => write.table === "profiles");
    expect(profileWrite?.row).toMatchObject({ id: IDS.existingUser });
  });

  it("błąd warstwy auth kończy się statusem `failed` i powodem w `last_error`", async () => {
    withInvitation(invitationRow());
    h.authError = new Error("User already registered");
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("User already registered");
    const update = db
      .chainsFor("user_invitations")
      .find((chain) => chain.has("update"))
      ?.argsOf("update")?.[0] as { status: string; last_error: string };
    expect(update.status).toBe("failed");
    expect(update.last_error).toBe("User already registered");
    // Żadnej hydracji profilu - konto nie powstało.
    expect(h.adminWrites).toHaveLength(0);
  });

  it("warstwa auth bez identyfikatora konta kończy się `no_auth_user_id`", async () => {
    withInvitation(invitationRow());
    h.authUserId = null;
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_auth_user_id");
  });

  it("tryb hasła: warstwa auth bez identyfikatora konta też daje `no_auth_user_id`", async () => {
    // Ta sama obrona na DRUGIEJ ścieżce tworzenia konta. Bez niej hydracja
    // poleciałaby z `id: null` i wstawiła wiersz-śmieć do `profiles`.
    withInvitation(invitationRow({ mode: "temp_password" }));
    h.authUserId = null;
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_auth_user_id");
    expect(h.adminWrites).toHaveLength(0);
  });

  it("`last_error` jest OBCINANY do 500 znaków - kolumna ma limit", async () => {
    withInvitation(invitationRow());
    h.authError = new Error("x".repeat(900));
    await send();
    const update = db
      .chainsFor("user_invitations")
      .find((chain) => chain.has("update"))
      ?.argsOf("update")?.[0] as { last_error: string };
    expect(update.last_error).toHaveLength(500);
  });

  it("hydracja pisze do TRZECH tabel przez `supabaseAdmin`, w ustalonej kolejności", async () => {
    // Kolejność nie jest dowolna: `user_roles` na końcu, bo rola bez profilu
    // daje konto widoczne w panelu bez nazwy i bez adresu.
    withInvitation(invitationRow());
    await send();
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
  });

  it("hydracja profilu przenosi metadane widgetu i wylicza slug z nazwy", async () => {
    withInvitation(
      invitationRow({
        display_name: "Zażółć Gęślą Jaźń",
        metadata: {
          photo: "https://example.org/p.jpg",
          bio_pl: "Bio PL",
          phone: "+48000000000",
          position_pl: "Analityczka",
          linkedin: "https://example.org/in",
        },
      }),
    );
    await send();
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as Record<
      string,
      unknown
    >;
    // Znaki z ogonkami i kreskami schodzą przez `NFD` + usunięcie znaków
    // diakrytycznych. `ł` NIE schodzi - patrz `it.fails` na końcu pliku.
    expect(profile.slug).toBe("zazo-c-gesla-jazn");
    expect(profile).toMatchObject({
      tenant_id: IDS.tenant,
      email: "nowa@example.org",
      avatar_url: "https://example.org/p.jpg",
      bio_pl: "Bio PL",
      phone: "+48000000000",
      job_title: "Analityczka",
      linkedin_url: "https://example.org/in",
    });
  });

  it("slug jest obcinany do 60 znaków i nie kończy się kreską", async () => {
    withInvitation(invitationRow({ display_name: `${"a".repeat(70)} b` }));
    await send();
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      slug: string;
    };
    expect(profile.slug).toHaveLength(60);
    expect(profile.slug.endsWith("-")).toBe(false);
  });

  it("stanowisko degraduje z wersji polskiej na angielską", async () => {
    withInvitation(invitationRow({ metadata: { position_en: "Analyst" } }));
    await send();
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      job_title: string | null;
    };
    expect(profile.job_title).toBe("Analyst");
  });

  it("brak metadanych daje profil z `null`-ami, nie z `undefined`", async () => {
    withInvitation(invitationRow({ metadata: null }));
    await send();
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as Record<
      string,
      unknown
    >;
    expect(profile.avatar_url).toBeNull();
    expect(profile.job_title).toBeNull();
  });

  it("brak nazwy w zaproszeniu zastępuje ją ADRESEM", async () => {
    withInvitation(invitationRow({ display_name: null }));
    await send();
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      display_name: string;
    };
    expect(profile.display_name).toBe("nowa@example.org");
  });

  it("etykieta programu wchodzi do `org_functions`, brak etykiety daje pustą tablicę", async () => {
    withInvitation(invitationRow({ metadata: { programLabel_pl: "Program Wschodni" } }));
    await send();
    let author = h.adminWrites.find((write) => write.table === "author_profiles")?.row as {
      org_functions: { pl: string; en: string }[];
    };
    expect(author.org_functions).toEqual([{ pl: "Program Wschodni", en: "" }]);

    h.adminWrites = [];
    db = supabaseFromStub();
    grantAdmin();
    withInvitation(invitationRow({ metadata: {} }));
    await send();
    author = h.adminWrites.find((write) => write.table === "author_profiles")?.row as {
      org_functions: { pl: string; en: string }[];
    };
    expect(author.org_functions).toEqual([]);
  });

  it("etykieta programu tylko po angielsku też tworzy wpis", async () => {
    withInvitation(invitationRow({ metadata: { programLabel_en: "Eastern Programme" } }));
    await send();
    const author = h.adminWrites.find((write) => write.table === "author_profiles")?.row as {
      org_functions: { pl: string; en: string }[];
    };
    expect(author.org_functions).toEqual([{ pl: "", en: "Eastern Programme" }]);
  });

  it("upsert profilu NADPISUJE, a upsert roli NIE - dwie różne reguły", async () => {
    // Profil ma się uzupełniać przy ponowieniu; rola dopisana ręcznie przez
    // admina nie może zostać zdjęta ponowną wysyłką zaproszenia.
    withInvitation(invitationRow());
    await send();
    expect(h.adminWrites.find((write) => write.table === "profiles")?.options).toEqual({
      onConflict: "id",
      ignoreDuplicates: false,
    });
    expect(h.adminWrites.find((write) => write.table === "user_roles")?.options).toEqual({
      onConflict: "user_id,role",
      ignoreDuplicates: true,
    });
  });

  it("rola z zaproszenia trafia do `user_roles` razem z najemcą", async () => {
    withInvitation(invitationRow({ role: "editor" }));
    await send();
    expect(h.adminWrites.find((write) => write.table === "user_roles")?.row).toEqual({
      user_id: "aaaa1111-2222-4333-8444-555566667777",
      role: "editor",
      tenant_id: IDS.tenant,
    });
  });

  it("wiadomość z hasłem idzie TYLKO w trybie hasła tymczasowego", async () => {
    withInvitation(invitationRow({ mode: "temp_password" }));
    const result = await send();
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("nowa@example.org");
    // Hasło MUSI być w treści - to jedyny kanał, którym trafia do osoby.
    expect(h.emails[0].html).toContain(result.tempPassword);
    // I musi być odnośnik do logowania z wypełnionym adresem.
    expect(h.emails[0].html).toContain(encodeURIComponent("nowa@example.org"));
  });

  it("PONOWIENIE w trybie hasła wysyła wiadomość, ale BEZ nowego hasła", async () => {
    // Konto istnieje, więc nowe hasło nie powstaje - wiadomość przypomina
    // tylko adres logowania.
    withInvitation(invitationRow({ mode: "temp_password", auth_user_id: IDS.existingUser }));
    const result = await send();
    expect(h.emails).toHaveLength(1);
    expect(result.tempPassword).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("ODMOWA BRAMKI POCZTY: konto powstało, ale zaproszenie NIE jest oznaczone jako wysłane", async () => {
    // TO JEST ZACHOWANIE, KTÓRE MUSI MIEĆ TEST. Konto w `auth.users` już
    // istnieje i profil jest zhydratowany, ale status zaproszenia zostaje
    // `failed` z powodem `email_failed:*` - i to jest właściwa decyzja: bez
    // wiadomości osoba nie zna hasła, więc „wysłane" byłoby kłamstwem.
    // Hasło wraca w wyniku, żeby administrator mógł przekazać je ręcznie.
    withInvitation(invitationRow({ mode: "temp_password" }));
    h.emailOk = false;
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("email_failed:smtp down");
    expect(result.tempPassword).toBeTypeOf("string");
    // Hydracja PRZESZŁA - konto istnieje.
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
    // Ale statusu `sent` NIE MA i śladu audytowego wysyłki też nie.
    const updates = db
      .chainsFor("user_invitations")
      .filter((chain) => chain.has("update"))
      .map((chain) => chain.argsOf("update")?.[0] as { status?: string });
    expect(updates.some((update) => update.status === "sent")).toBe(false);
    expect(db.chainsFor("audit_log")).toHaveLength(0);
  });

  it("powodzenie oznacza zaproszenie jako wysłane, wiąże konto i CZYŚCI dawny błąd", async () => {
    withInvitation(invitationRow({ mode: "magic_link" }));
    await send();
    const update = db
      .chainsFor("user_invitations")
      .find((chain) => chain.has("update"))
      ?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(update).toMatchObject({
      status: "sent",
      auth_user_id: "aaaa1111-2222-4333-8444-555566667777",
      // Wyczyszczenie `last_error` jest częścią powodzenia: inaczej panel
      // pokazuje przy wysłanym zaproszeniu błąd z poprzedniej próby.
      last_error: null,
    });
    expect(update.sent_at).toBeTypeOf("string");
    // Aktualizacja celuje w JEDEN rekord.
    const updateChain = db.chainsFor("user_invitations").find((chain) => chain.has("update"));
    expect(updateChain?.argsOf("eq")).toEqual(["id", IDS.invitation]);
  });

  it("ślad audytowy niesie aktora, akcję, najemcę - i NIE niesie hasła", async () => {
    // RODO/bezpieczeństwo: `audit_log` jest czytany szerzej niż tabela
    // zaproszeń. Hasło tymczasowe w metadanych audytu byłoby trwałym wyciekiem.
    withInvitation(invitationRow({ mode: "temp_password" }));
    const result = await send();
    const insert = db.lastChain("audit_log")?.argsOf("insert")?.[0] as {
      actor_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      tenant_id: string;
      metadata: Record<string, unknown>;
    };
    expect(insert).toMatchObject({
      actor_id: IDS.caller,
      action: "user_invitation_sent",
      entity_type: "user_invitation",
      entity_id: IDS.invitation,
      tenant_id: IDS.tenant,
    });
    const serialized = JSON.stringify(insert);
    expect(serialized).not.toContain(String(result.tempPassword));
  });

  it("wyjątek NIE-`Error` w wysyłce ląduje w `last_error` jako tekst", async () => {
    // `supabaseAdmin.auth.admin` oddaje w polu `error` obiekt biblioteki, nie
    // zawsze `Error` - a `throw error` przenosi go dalej takim, jakim jest.
    withInvitation(invitationRow());
    h.authError = { status: 429, name: "AuthRetryableFetchError" };
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("[object Object]");
    const update = db
      .chainsFor("user_invitations")
      .find((chain) => chain.has("update"))
      ?.argsOf("update")?.[0] as { status: string };
    expect(update.status).toBe("failed");
  });

  it("walidator wymaga identyfikatora w postaci UUID", () => {
    expect(() => validateServerFnInput(sendInvitation, { id: "nie-uuid" })).toThrow();
    expect(() => validateServerFnInput(sendInvitation, { id: IDS.invitation })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. WYSYŁKA ZBIORCZA I PONOWIENIE PO ADRESIE.
// ---------------------------------------------------------------------------

describe("sendInvitationsBulk - wysyłka partii", () => {
  beforeEach(() => {
    grantAdmin();
  });

  it("każdy identyfikator dostaje własny wynik, w kolejności wejścia", async () => {
    let read = 0;
    db.setResponse("user_invitations", (chain) => {
      if (chain.has("update")) return ok(null);
      read += 1;
      return ok(
        read === 1
          ? invitationRow({ id: IDS.invitation, email: "pierwsza@example.org" })
          : invitationRow({ id: IDS.invitationB, email: "druga@example.org" }),
      );
    });
    db.setResponse("audit_log", ok(null));

    const result = await callServerFn<{ results: { ok: boolean; email: string }[] }>(
      sendInvitationsBulk,
      { data: { ids: [IDS.invitation, IDS.invitationB] }, context: context() },
    );
    expect(result.results.map((entry) => entry.email)).toEqual([
      "pierwsza@example.org",
      "druga@example.org",
    ]);
    expect(result.results.every((entry) => entry.ok)).toBe(true);
  });

  it("porażka jednego rekordu NIE przerywa partii", async () => {
    let read = 0;
    db.setResponse("user_invitations", (chain) => {
      if (chain.has("update")) return ok(null);
      read += 1;
      // Pierwszego rekordu nie ma; drugi jest poprawny.
      return read === 1 ? ok(null) : ok(invitationRow({ id: IDS.invitationB }));
    });
    db.setResponse("audit_log", ok(null));
    const result = await callServerFn<{ results: { ok: boolean }[] }>(sendInvitationsBulk, {
      data: { ids: [IDS.invitation, IDS.invitationB] },
      context: context(),
    });
    expect(result.results.map((entry) => entry.ok)).toEqual([false, true]);
  });

  it("walidator odrzuca pustą listę, listę ponad 100 i identyfikator nie-UUID", () => {
    expect(() => validateServerFnInput(sendInvitationsBulk, { ids: [] })).toThrow();
    expect(() =>
      validateServerFnInput(sendInvitationsBulk, {
        ids: Array.from({ length: 101 }, () => IDS.invitation),
      }),
    ).toThrow();
    expect(() => validateServerFnInput(sendInvitationsBulk, { ids: ["x"] })).toThrow();
  });
});

describe("resendInvitationsForEmails - dopasowanie po adresie", () => {
  beforeEach(() => {
    grantAdmin();
  });

  async function resend(emails: string[]): Promise<{
    results: { ok: boolean; email: string }[];
    missing: string[];
  }> {
    return callServerFn(resendInvitationsForEmails, { data: { emails }, context: context() });
  }

  it("bierze NAJŚWIEŻSZE zaproszenie dla adresu - kolejność zapytania jest regułą", async () => {
    // Zapytanie sortuje `created_at DESC`, a pętla bierze PIERWSZE trafienie
    // per adres. Bez sortowania ponowienie trafiałoby w losowy stary rekord.
    let read = 0;
    db.setResponse("user_invitations", (chain) => {
      if (chain.has("update")) return ok(null);
      read += 1;
      if (read === 1) {
        return ok([
          { id: IDS.invitationB, email: "nowa@example.org", created_at: BASE_ISO },
          { id: IDS.invitation, email: "nowa@example.org", created_at: OLDER_ISO },
        ]);
      }
      return ok(invitationRow({ id: IDS.invitationB }));
    });
    db.setResponse("audit_log", ok(null));

    const result = await resend(["nowa@example.org"]);
    expect(result.missing).toEqual([]);
    expect(result.results).toHaveLength(1);
    expect(db.lastChain("user_invitations")?.table).toBe("user_invitations");
    const listChain = db.chainsFor("user_invitations")[0];
    expect(listChain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("adresy BEZ zaproszenia wracają w `missing`, nie jako porażka wysyłki", async () => {
    // „Nie było czego ponowić" i „ponowienie się nie udało" to dwie różne
    // informacje dla administratora - i dwa różne komunikaty w panelu.
    db.setResponse("user_invitations", (chain) => (chain.has("update") ? ok(null) : ok([])));
    const result = await resend(["brak@example.org", "tez-brak@example.org"]);
    expect(result.results).toEqual([]);
    expect(result.missing).toEqual(["brak@example.org", "tez-brak@example.org"]);
  });

  it("powtórzony adres na wejściu jest ODSIEWANY przed zapytaniem", async () => {
    db.setResponse("user_invitations", (chain) => (chain.has("update") ? ok(null) : ok([])));
    await resend(["nowa@example.org", "NOWA@example.org", "nowa@example.org"]);
    // Walidator normalizuje do małych liter, `Set` odsiewa - do bazy idzie
    // JEDEN adres, a nie trzy.
    expect(db.chainsFor("user_invitations")[0].argsOf("in")).toEqual([
      "email",
      ["nowa@example.org"],
    ]);
  });

  it("awaria odczytu zaproszeń przenosi komunikat bazy", async () => {
    db.setResponse("user_invitations", fail("statement timeout"));
    await expect(resend(["nowa@example.org"])).rejects.toThrow("statement timeout");
  });

  it("odczyt zwracający `null` daje wszystkie adresy jako brakujące", async () => {
    db.setResponse("user_invitations", (chain) => (chain.has("update") ? ok(null) : ok(null)));
    const result = await resend(["nowa@example.org"]);
    expect(result.missing).toEqual(["nowa@example.org"]);
  });

  it("walidator normalizuje adresy i odrzuca listę pustą, >100 oraz nie-adresy", () => {
    const parsed = validateServerFnInput<{ emails: string[] }>(resendInvitationsForEmails, {
      emails: ["NOWA@Example.ORG"],
    });
    expect(parsed.emails).toEqual(["nowa@example.org"]);
    // Spacje odrzuca `.email()` przed `.transform()` - jak w `createInvitations`.
    expect(() =>
      validateServerFnInput(resendInvitationsForEmails, { emails: [" a@example.org"] }),
    ).toThrow();
    expect(() => validateServerFnInput(resendInvitationsForEmails, { emails: [] })).toThrow();
    expect(() =>
      validateServerFnInput(resendInvitationsForEmails, { emails: ["to-nie-adres"] }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(resendInvitationsForEmails, {
        emails: Array.from({ length: 101 }, (_, index) => `osoba${index}@example.org`),
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. WYCOFANIE I ODCZYT LISTY.
// ---------------------------------------------------------------------------

describe("revokeInvitation - miękkie wycofanie", () => {
  beforeEach(() => {
    grantAdmin();
  });

  it("ustawia status `revoked` na WSKAZANYM rekordzie - i nic nie usuwa", async () => {
    // Usunięcie rekordu zabrałoby ślad, że zaproszenie kiedykolwiek było -
    // a to jest informacja audytowa.
    db.setResponse("user_invitations", ok(null));
    await expect(
      callServerFn(revokeInvitation, { data: { id: IDS.invitation }, context: context() }),
    ).resolves.toEqual({ ok: true });
    const chain = db.lastChain("user_invitations");
    expect(chain?.argsOf("update")).toEqual([{ status: "revoked" }]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.invitation]);
    expect(chain?.has("delete")).toBe(false);
  });

  it("odmowa aktualizacji przenosi komunikat bazy", async () => {
    db.setResponse("user_invitations", fail("permission denied"));
    await expect(
      callServerFn(revokeInvitation, { data: { id: IDS.invitation }, context: context() }),
    ).rejects.toThrow("permission denied");
  });

  it("walidator wymaga UUID", () => {
    expect(() => validateServerFnInput(revokeInvitation, { id: "1" })).toThrow();
  });
});

describe("listInvitations - odczyt listy", () => {
  beforeEach(() => {
    grantAdmin();
  });

  it("sortuje najnowsze pierwsze i ogranicza wynik do 500 wierszy", async () => {
    // Limit jest obroną przed odczytem całej tabeli do przeglądarki; brak
    // sortowania kazałby administratorowi szukać ostatniego zaproszenia.
    db.setResponse("user_invitations", ok([invitationRow()]));
    const result = await callServerFn<{ invitations: unknown[] }>(listInvitations, {
      context: context(),
    });
    expect(result.invitations).toHaveLength(1);
    const chain = db.lastChain("user_invitations");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([500]);
  });

  it("odczyt zwracający `null` daje pustą listę", async () => {
    db.setResponse("user_invitations", ok(null));
    await expect(callServerFn(listInvitations, { context: context() })).resolves.toEqual({
      invitations: [],
    });
  });

  it("awaria odczytu przenosi komunikat bazy", async () => {
    db.setResponse("user_invitations", fail("statement timeout"));
    await expect(callServerFn(listInvitations, { context: context() })).rejects.toThrow(
      "statement timeout",
    );
  });
});

// ---------------------------------------------------------------------------
// 8. DOWIĄZANIE WIDGETÓW.
// ---------------------------------------------------------------------------

describe("linkTeamWidgets - dowiązanie widgetów do kont", () => {
  beforeEach(() => {
    grantAdmin();
  });

  async function link(slug = "o-nas"): Promise<{
    updated: number;
    matched: number;
    unmatched: string[];
  }> {
    return callServerFn(linkTeamWidgets, { data: { pageSlug: slug }, context: context() });
  }

  it("brak strony to jawny błąd", async () => {
    db.setResponse("pages", ok(null));
    await expect(link()).rejects.toThrow("Page not found");
  });

  it("awaria odczytu strony przenosi komunikat bazy", async () => {
    db.setResponse("pages", fail("statement timeout"));
    await expect(link()).rejects.toThrow("statement timeout");
  });

  it("strona bez widgetów zespołu kończy się zerami i NIE zapisuje strony", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([]) }));
    await expect(link()).resolves.toEqual({ updated: 0, matched: 0, unmatched: [] });
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
  });

  it("adres BEZ konta ląduje w `unmatched`, a strona zostaje nietknięta", async () => {
    // Zapis dokumentu bez żadnej zmiany podbijałby wersję strony i unieważniał
    // cache treści publicznej za nic.
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    const result = await link();
    expect(result).toEqual({ updated: 0, matched: 0, unmatched: ["nowa@example.org"] });
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
  });

  it("ten sam nietrafiony adres wchodzi do `unmatched` TYLKO RAZ", async () => {
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([teamWidget({ id: "w-1" }), teamWidget({ id: "w-2" })]),
      }),
    );
    const result = await link();
    expect(result.unmatched).toEqual(["nowa@example.org"]);
  });

  it("widget z pustym adresem jest pomijany bez wpisu do `unmatched`", async () => {
    db.setResponse(
      "pages",
      ok({ id: IDS.page, builder_data: builderDoc([teamWidget({ email: "   " })]) }),
    );
    // Parser nie widzi takiego widgetu, więc lista adresów jest pusta.
    await expect(link()).resolves.toEqual({ updated: 0, matched: 0, unmatched: [] });
  });

  it("TRAFIONY adres dopisuje identyfikator i slug do widgetu, a stronę ZAPISUJE", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    rpcUsers = [{ id: IDS.existingUser, email: "NOWA@Example.ORG", slug: "nowa-osoba" }];
    const result = await link();
    expect(result).toEqual({ updated: 1, matched: 1, unmatched: [] });

    const updateChain = db.chainsFor("pages").find((chain) => chain.has("update"));
    expect(updateChain?.argsOf("eq")).toEqual(["id", IDS.page]);
    const doc = JSON.stringify(
      (updateChain?.argsOf("update")?.[0] as { builder_data: unknown }).builder_data,
    );
    expect(doc).toContain(IDS.existingUser);
    expect(doc).toContain("nowa-osoba");
  });

  it("dopasowanie NIE MUTUJE dokumentu wejściowego - zapis idzie z kopii", async () => {
    // `JSON.parse(JSON.stringify(...))` to głęboka kopia i to jest reguła:
    // mutacja wiersza z odczytu przy nieudanym zapisie zostawiałaby w cache
    // dokument, którego w bazie nie ma.
    const original = builderDoc([teamWidget()]);
    db.setResponse("pages", (chain) =>
      chain.has("update") ? ok(null) : ok({ id: IDS.page, builder_data: original }),
    );
    rpcUsers = [{ id: IDS.existingUser, email: "nowa@example.org", slug: "nowa-osoba" }];
    await link();
    expect(JSON.stringify(original)).not.toContain(IDS.existingUser);
  });

  it("konto BEZ sluga dostaje tylko identyfikator - pusty slug dałby odnośnik do 404", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    rpcUsers = [{ id: IDS.existingUser, email: "nowa@example.org", slug: null }];
    await link();
    const updateChain = db.chainsFor("pages").find((chain) => chain.has("update"));
    const doc = JSON.stringify(
      (updateChain?.argsOf("update")?.[0] as { builder_data: unknown }).builder_data,
    );
    expect(doc).toContain(IDS.existingUser);
    expect(doc).not.toContain("authorSlug");
  });

  it("konto bez adresu w wyniku RPC nie wchodzi do mapy dopasowań", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    rpcUsers = [{ id: IDS.existingUser, email: null, slug: "s" }];
    const result = await link();
    expect(result.updated).toBe(0);
    expect(result.unmatched).toEqual(["nowa@example.org"]);
  });

  it("wynik RPC `null` nie wywraca dowiązania", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    // Atrapa RPC zwraca `rpcUsers`; puste to nie to samo co `null`, więc
    // podmieniamy klient na oddający `data: null`.
    const nullRpcContext: ServerFnContext = {
      supabase: {
        from: (table: string) => db.from(table),
        rpc: async () => ({ data: null, error: null }),
      },
      userId: IDS.caller,
    };
    const result = await callServerFn<{ updated: number; unmatched: string[] }>(linkTeamWidgets, {
      data: { pageSlug: "o-nas" },
      context: nullRpcContext,
    });
    expect(result.updated).toBe(0);
    expect(result.unmatched).toEqual(["nowa@example.org"]);
  });

  it("CZĘŚCIOWE dopasowanie liczy trafienia i nietrafienia rozdzielnie", async () => {
    // `matched` liczy się jako `drafts.length - unmatched.length`, a `updated`
    // to liczba PODMIENIONYCH widgetów - dwie różne liczby, które przy jednej
    // osobie w dwóch sekcjach się rozjeżdżają. Panel pokazuje `updated`.
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({
            id: IDS.page,
            builder_data: builderDoc([
              teamWidget({ id: "w-1" }),
              teamWidget({ id: "w-2" }),
              teamWidget({ id: "w-3", email: "obca@example.org", name: "Obca Osoba" }),
            ]),
          }),
    );
    rpcUsers = [{ id: IDS.existingUser, email: "nowa@example.org", slug: "nowa-osoba" }];
    const result = await link();
    // Dwa widgety tej samej osoby -> dwie podmiany; parser zwrócił dwie osoby.
    expect(result.updated).toBe(2);
    expect(result.unmatched).toEqual(["obca@example.org"]);
    expect(result.matched).toBe(1);
  });

  it("odmowa ZAPISU strony przenosi komunikat bazy - i nie kłamie o powodzeniu", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? fail("permission denied for table pages")
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    rpcUsers = [{ id: IDS.existingUser, email: "nowa@example.org", slug: "nowa-osoba" }];
    await expect(link()).rejects.toThrow("permission denied for table pages");
  });

  it("walidator odrzuca pusty slug", () => {
    expect(() => validateServerFnInput(linkTeamWidgets, { pageSlug: "" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. TWORZENIE KONT BEZ WYSYŁKI (`provisionTeamMembers`).
// ---------------------------------------------------------------------------

describe("provisionTeamMembers - konta od razu, bez poczty", () => {
  beforeEach(() => {
    grantAdmin();
  });

  async function provision(data: Record<string, unknown> = { pageSlug: "o-nas" }): Promise<{
    created: number;
    skipped: number;
    linked: number;
    errors: { email: string; error: string }[];
  }> {
    return callServerFn(provisionTeamMembers, { data, context: context() });
  }

  it("walidator ma DOMYŚLNE rola=`author` i dowiązanie=włączone", () => {
    // Domyślna rola musi być najmniejszym uprawnieniem: pominięcie parametru
    // nie może wyprodukować adminów.
    const parsed = validateServerFnInput<{ role: string; autoLink: boolean }>(
      provisionTeamMembers,
      { pageSlug: "o-nas" },
    );
    expect(parsed.role).toBe("author");
    expect(parsed.autoLink).toBe(true);
  });

  it("walidator odrzuca rolę `super_admin` również tutaj", () => {
    expect(() =>
      validateServerFnInput(provisionTeamMembers, { pageSlug: "o-nas", role: "super_admin" }),
    ).toThrow();
  });

  it("brak strony to jawny błąd; awaria odczytu przenosi komunikat", async () => {
    db.setResponse("pages", ok(null));
    await expect(provision()).rejects.toThrow("Page not found");

    db = supabaseFromStub();
    grantAdmin();
    db.setResponse("pages", fail("statement timeout"));
    await expect(provision()).rejects.toThrow("statement timeout");
  });

  it("strona bez widgetów zespołu nie tworzy ŻADNEGO konta", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([]) }));
    await expect(provision()).resolves.toEqual({
      created: 0,
      skipped: 0,
      linked: 0,
      errors: [],
    });
    expect(h.authCalls).toHaveLength(0);
  });

  it("nowa osoba: konto powstaje, profil jest hydratowany, ślad audytowy zapisany", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok(null)));
    const result = await provision({ pageSlug: "o-nas", role: "editor", autoLink: false });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(h.authCalls[0].kind).toBe("create");
    // Konto powstaje z hasłem tymczasowym i wymuszoną zmianą - ale BEZ maila.
    expect(h.authCalls[0].payload).toMatchObject({
      email_confirm: true,
      user_metadata: { must_change_password: true, provisioned: true, tenant_id: IDS.tenant },
    });
    expect(h.emails).toHaveLength(0);
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
    expect(h.adminWrites.find((write) => write.table === "user_roles")?.row).toMatchObject({
      role: "editor",
    });

    // Ślad audytowy: status `accepted` i źródło ze slugiem strony.
    const insert = db
      .chainsFor("user_invitations")
      .find((chain) => chain.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      tenant_id: IDS.tenant,
      email: "nowa@example.org",
      status: "accepted",
      source: "provision:o-nas",
      invited_by: IDS.caller,
    });
    // Metadane niosą widget, żeby dało się odtworzyć, skąd konto się wzięło.
    expect(insert.metadata).toEqual({ widgetId: "w-1", provisioned: true });
  });

  it("osoba z ISTNIEJĄCYM kontem jest POMIJANA w tworzeniu, ale profil i tak uzupełniony", async () => {
    // `skipped` to nie „nic nie zrobiono": profil, profil autora i rola są
    // uzupełniane, bo import zespołu ma doprowadzić stronę do stanu spójnego
    // także dla osób, które konto już miały.
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    rpcUsers = [{ id: IDS.existingUser, email: "NOWA@Example.ORG" }];
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result).toMatchObject({ created: 0, skipped: 1, errors: [] });
    expect(h.authCalls).toHaveLength(0);
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
    expect(h.adminWrites[0].row).toMatchObject({ id: IDS.existingUser });
  });

  it("konto bez adresu w wyniku RPC nie jest uznane za istniejące", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    rpcUsers = [{ id: IDS.existingUser, email: null }];
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.created).toBe(1);
  });

  it("wyjątek NIE-`Error` w pętli osób ląduje w `errors` jako tekst", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.authError = { status: 429 };
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.errors).toEqual([{ email: "nowa@example.org", error: "[object Object]" }]);
  });

  it("odczyt profili do dowiązania zwracający `null` nie wywraca kroku", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfilesNull = true;
    const result = await provision({ pageSlug: "o-nas", autoLink: true });
    expect(result.linked).toBe(0);
  });

  it("ISTNIEJĄCE zaproszenie NIE jest dublowane", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", (chain) =>
      chain.has("insert") ? ok(null) : ok({ id: IDS.invitation }),
    );
    await provision({ pageSlug: "o-nas", autoLink: false });
    expect(db.chainsFor("user_invitations").some((chain) => chain.has("insert"))).toBe(false);
  });

  it("zapytanie o istniejące zaproszenie jest zawężone do NAJEMCY i adresu", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok(null)));
    await provision({ pageSlug: "o-nas", autoLink: false });
    const lookup = db.chainsFor("user_invitations").find((chain) => !chain.has("insert"));
    const eqArgs = lookup?.calls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(eqArgs).toEqual([
      ["tenant_id", IDS.tenant],
      ["email", "nowa@example.org"],
    ]);
  });

  it("błąd tworzenia konta ląduje w `errors` i NIE przerywa pozostałych osób", async () => {
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([
          teamWidget({ id: "w-1", email: "pierwsza@example.org", name: "Pierwsza" }),
          teamWidget({ id: "w-2", email: "druga@example.org", name: "Druga" }),
        ]),
      }),
    );
    db.setResponse("user_invitations", () => ok(null));
    // Pierwsze tworzenie pada, drugie przechodzi - sterowane stanem atrapy.
    h.authFailsFirstOnly = true;
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    // Druga osoba MUSI przejść: jeden zajęty adres nie może zablokować importu
    // całego zespołu.
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      { email: "pierwsza@example.org", error: "User already registered" },
    ]);
    // Hydracja przeszła wyłącznie dla drugiej osoby.
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
  });

  it("konto bez zwróconego identyfikatora ląduje w `errors`", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.authUserId = null;
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.created).toBe(0);
    expect(result.errors).toEqual([{ email: "nowa@example.org", error: "no_auth_user_id" }]);
  });

  it("dowiązanie WŁĄCZONE dopisuje identyfikator i slug do widgetu i zapisuje stronę", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfiles = [{ id: IDS.existingUser, email: "nowa@example.org", slug: "nowa-osoba" }];
    const result = await provision({ pageSlug: "o-nas", autoLink: true });
    expect(result.linked).toBe(1);
    const updateChain = db.chainsFor("pages").find((chain) => chain.has("update"));
    expect(updateChain).toBeTruthy();
    expect(updateChain?.argsOf("eq")).toEqual(["id", IDS.page]);
    const doc = (updateChain?.argsOf("update")?.[0] as { builder_data: unknown }).builder_data;
    expect(JSON.stringify(doc)).toContain(IDS.existingUser);
    expect(JSON.stringify(doc)).toContain("nowa-osoba");
  });

  it("profil BEZ sluga dostaje tylko identyfikator - pustego sluga nie wpisujemy", async () => {
    // `authorSlug: ""` w widgetcie dałby odnośnik do `/author/` - czyli 404.
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfiles = [{ id: IDS.existingUser, email: "nowa@example.org", slug: null }];
    await provision({ pageSlug: "o-nas", autoLink: true });
    const updateChain = db.chainsFor("pages").find((chain) => chain.has("update"));
    const doc = JSON.stringify(
      (updateChain?.argsOf("update")?.[0] as { builder_data: unknown }).builder_data,
    );
    expect(doc).toContain(IDS.existingUser);
    expect(doc).not.toContain("authorSlug");
  });

  it("dowiązanie bez ANI JEDNEGO trafienia nie zapisuje strony", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfiles = [];
    const result = await provision({ pageSlug: "o-nas", autoLink: true });
    expect(result.linked).toBe(0);
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
  });

  it("dowiązanie WYŁĄCZONE nie czyta profili i nie zapisuje strony", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.linked).toBe(0);
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
  });

  it("widget z pustym adresem jest pomijany w dowiązaniu", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({
            id: IDS.page,
            builder_data: builderDoc([
              teamWidget(),
              { id: "w-2", type: "team-member", content: {} },
            ]),
          }),
    );
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfiles = [{ id: IDS.existingUser, email: "nowa@example.org", slug: "s" }];
    const result = await provision({ pageSlug: "o-nas", autoLink: true });
    expect(result.linked).toBe(1);
  });

  it("profil bez adresu w odczycie nie wchodzi do mapy dopasowań", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfiles = [{ id: IDS.existingUser, email: null, slug: "s" }];
    const result = await provision({ pageSlug: "o-nas", autoLink: true });
    expect(result.linked).toBe(0);
  });

  it("hydracja przenosi dane WPROST z widgetu, bez metadanych zaproszenia", async () => {
    // To jest różnica wobec `performSend`: tam dane idą z `metadata` rekordu
    // zaproszenia, tu wprost z dokumentu strony. Pomyłka dałaby konta
    // bez zdjęć i stanowisk.
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([
          teamWidget({
            photo: "https://example.org/p.jpg",
            bio_pl: "Bio PL",
            phone: "+48000000000",
            programLabel_pl: "Program Wschodni",
          }),
        ]),
      }),
    );
    db.setResponse("user_invitations", () => ok(null));
    await provision({ pageSlug: "o-nas", autoLink: false });
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as Record<
      string,
      unknown
    >;
    expect(profile).toMatchObject({
      avatar_url: "https://example.org/p.jpg",
      bio_pl: "Bio PL",
      phone: "+48000000000",
      job_title: "Analityczka",
      slug: "nowa-osoba",
    });
    const author = h.adminWrites.find((write) => write.table === "author_profiles")?.row as {
      org_functions: { pl: string; en: string }[];
      is_public: boolean;
    };
    expect(author.org_functions).toEqual([{ pl: "Program Wschodni", en: "" }]);
    // Profil autora jest PUBLICZNY - inaczej import zespołu nie pokazuje nikogo.
    expect(author.is_public).toBe(true);
  });

  it("stanowisko degraduje z polskiego na angielskie także w tej ścieżce", async () => {
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([teamWidget({ position_pl: "", position_en: "Analyst" })]),
      }),
    );
    db.setResponse("user_invitations", () => ok(null));
    await provision({ pageSlug: "o-nas", autoLink: false });
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      job_title: string | null;
    };
    expect(profile.job_title).toBe("Analyst");
  });

  it("etykieta programu nieobecna daje pustą listę funkcji", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    await provision({ pageSlug: "o-nas", autoLink: false });
    const author = h.adminWrites.find((write) => write.table === "author_profiles")?.row as {
      org_functions: unknown[];
    };
    expect(author.org_functions).toEqual([]);
  });

  it("etykieta programu tylko po angielsku też tworzy wpis", async () => {
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([teamWidget({ programLabel_en: "Eastern Programme" })]),
      }),
    );
    db.setResponse("user_invitations", () => ok(null));
    await provision({ pageSlug: "o-nas", autoLink: false });
    const author = h.adminWrites.find((write) => write.table === "author_profiles")?.row as {
      org_functions: { pl: string; en: string }[];
    };
    expect(author.org_functions).toEqual([{ pl: "", en: "Eastern Programme" }]);
  });

  it("strona z `builder_data: null` przy włączonym dowiązaniu nie wywala się", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: null }));
    await expect(provision({ pageSlug: "o-nas", autoLink: true })).resolves.toEqual({
      created: 0,
      skipped: 0,
      linked: 0,
      errors: [],
    });
  });
});

// ---------------------------------------------------------------------------
// 10. RODO - fixture'y i wycieki.
// ---------------------------------------------------------------------------

describe("system zaproszeń - higiena danych osobowych", () => {
  it("żaden fixture nie używa adresu poza domeną `example.org`", () => {
    // Bramka na własnych danych testowych: adres z realnej domeny w teście
    // kończy się kiedyś prawdziwym e-mailem z CI.
    const fixtures = JSON.stringify([invitationRow(), teamWidget(), builderDoc([teamWidget()])]);
    const emails = fixtures.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email, `adres poza domeną testową: ${email}`).toMatch(/@example\.(org|com)$/);
    }
  });

  it("hasło tymczasowe NIE trafia do żadnego zapisu w bazie", async () => {
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow({ mode: "temp_password" })),
    );
    db.setResponse("audit_log", ok(null));
    const result = await callServerFn<{ tempPassword?: string }>(sendInvitation, {
      data: { id: IDS.invitation },
      context: context(),
    });
    const password = String(result.tempPassword);
    expect(password).toHaveLength(16);

    // Ani do `user_invitations`, ani do `audit_log`, ani do profilu.
    const everything = JSON.stringify([db.chains.map((chain) => chain.calls), h.adminWrites]);
    expect(everything).not.toContain(password);
    // Jedyne miejsce, w którym hasło ma prawo być, to treść wiadomości.
    expect(h.emails[0].html).toContain(password);
  });
});

// ---------------------------------------------------------------------------
// 11. DEFEKT ZGŁOSZONY, NIE NAPRAWIONY (konwencja repo: produkcja bez zmian).
// ---------------------------------------------------------------------------

describe("system zaproszeń - defekt zgłoszony", () => {
  it.fails("DEFEKT: `slugify` gubi polskie `ł` - slug profilu wychodzi kaleki", async () => {
    // `slugify` (`invitations.functions.ts:36-44`) robi
    // `.normalize("NFD").replace(/\p{Diacritic}/gu, "")`. To działa dla znaków
    // ROZKŁADALNYCH (`ą ę ó ć ś ń ż ź` = litera + znak diakrytyczny), ale `ł`
    // i `Ł` (U+0142 / U+0141) NIE MAJĄ rozkładu kanonicznego - nie są literą
    // z diakrytykiem, są osobnymi literami. `NFD` ich nie rusza, więc wpadają
    // w `[^a-z0-9]+` i zamieniają się w KRESKĘ.
    //
    // Zmierzone skutki dla realnych, bardzo częstych polskich imion:
    //   „Michał Kowalski"       -> „micha-kowalski"
    //   „Paweł Nowak"           -> „pawe-nowak"
    //   „Małgorzata Wiśniewska" -> „ma-gorzata-wisniewska"
    //   „Łukasz Dąbrowski"      -> „ukasz-dabrowski"   (pierwsza litera GINIE)
    //
    // KONSEKWENCJA. Slug jest publicznym adresem profilu autora
    // (`/author/<slug>`), więc jest widoczny, cytowany i indeksowany. Ta sama
    // funkcja tworzy slugi w `performSend` i w `provisionTeamMembers`, czyli na
    // OBU ścieżkach powstawania kont - a produkt jest polskojęzyczny, więc
    // dotyczy to dużej części zespołu. Poprawka to jedna mapa znaków przed
    // `NFD` (`ł->l`, `Ł->L`), ale zmiana slugów istniejących kont wymaga
    // migracji i przekierowań, więc jest decyzją, nie poprawką w teście.
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow({ display_name: "Michał Kowalski" })),
    );
    db.setResponse("audit_log", ok(null));
    await callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      slug: string;
    };
    expect(profile.slug).toBe("michal-kowalski");
  });
});

/**
 * Kanarek atrapy: gdyby `SupabaseResult` przestał być kształtem, którego ten
 * plik używa w responderach, testy przestałyby cokolwiek dowodzić i milczały.
 */
describe("kanarek harnessu", () => {
  it("responder tabeli dostaje zapisany łańcuch i może odpowiedzieć różnie", async () => {
    const result: SupabaseResult = ok({ tenant_id: IDS.tenant });
    expect(result.error).toBeNull();
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok({ updated: true }) : ok([]),
    );
    await callServerFn(listInvitations, { context: context() });
    expect(db.lastChain("user_invitations")?.has("select")).toBe(true);
  });
});
