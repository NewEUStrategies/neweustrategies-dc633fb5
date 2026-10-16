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
  claimError: null as { message: string } | null,
  inviteLinkFails: false,
  hashedToken: null as string | null,
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
  /**
   * `tenant_id` opcjonalne: odczyt dowiązania filtruje po najemcy, a atrapa
   * honoruje `.eq("tenant_id", …)` tylko dla wierszy, które go niosą.
   */
  adminProfiles: [] as {
    id: string;
    email: string | null;
    slug: string | null;
    tenant_id?: string;
  }[],
  /** Gdy `true`, odczyt profili oddaje `data: null` (kształt realnie możliwy). */
  adminProfilesNull: false,
  /**
   * Odpowiedź odczytu profili do dowiązania ZALEŻNA od porcji adresów - gdy
   * ustawiona, zastępuje stałe `adminProfiles`. Bez tego każda porcja
   * dostawałaby tę samą listę i test nie odróżniłby „scala wyniki wszystkich
   * porcji" od „bierze wynik jednej".
   */
  adminProfilesFor: null as
    ((emails: string[]) => { id: string; email: string | null; slug: string | null }[]) | null,
  /** Awaria odczytu profili do dowiązania (np. 414 z bramki przed PostgREST-em). */
  adminProfilesError: null as { message: string } | null,
  /** Listy adresów z kolejnych `.in("email", …)` odczytu profili - dowód na porcje. */
  adminProfileEmailBatches: [] as string[][],
  /**
   * Gdy `true`, `createUser` pada TYLKO przy pierwszym wywołaniu. Sterowanie
   * stanem, a nie `vi.spyOn` na zamockowanym module: podszycie się pod
   * `PostgrestQueryBuilder`/`AdminUserAttributes` wymagałoby rzutowania,
   * a rzutowania są w tym repo pod ratchetem (`check:unknown-casts`).
   */
  authFailsFirstOnly: false,
  /** Wysłane wiadomości - atrapa bramki poczty. */
  emails: [] as {
    to: string;
    lang: string;
    ctaUrl?: string;
    details?: { label: string; value: string }[];
  }[],
  emailOk: true,
  /** Awaria generatora linku aktywacyjnego. */
  linkError: null as Error | null,
  emailError: "smtp down",
  /** Wysyłka pominięta przez bramkę poczty (`sendTxEmail` -> `skipped`). */
  emailSkipped: null as "suppressed" | "duplicate" | null,
  /**
   * Konta istniejące w katalogu tożsamości - sprawdzane przed `createUser`.
   * `app_metadata` jak w GoTrue: pisze je wyłącznie klucz serwisowy, więc
   * tylko `app_metadata.tenant_id` poświadcza najemcę, dla którego konto
   * narodziło się z zaproszenia.
   */
  existingAuthUsers: [] as {
    id: string;
    email: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    /** Ostatnie logowanie - konto bez tego pola nigdy nie miało sesji. */
    last_sign_in_at?: string;
  }[],
  /**
   * Awaria `getUserById` inna niż „brak konta". `AuthError` w auth-js dziedziczy
   * po `Error` (z `status` i `code`) - atrapa też, inaczej komunikat w
   * `last_error` czytałby się jako „[object Object]".
   */
  getUserByIdError: null as (Error & { status?: number; code?: string }) | null,
  /** Identyfikatory, o które moduł pytał `getUserById`. */
  getUserByIdCalls: [] as string[],
  /** Wywołania `updateUserById` - nowe hasło tymczasowe przy ponowieniu. */
  passwordUpdates: [] as { id: string; password: unknown }[],
  /** Awaria `updateUserById`. */
  updateUserByIdError: null as Error | null,
  /**
   * Najemca domyślny (`tenants.is_default`) - tam `handle_new_user` zakłada
   * profil KAŻDEGO nowego konta. `null` = brak wiersza z flagą (wtedy moduł
   * pyta o slug `nes`, jak `handle_new_user`).
   */
  defaultTenantId: null as string | null,
  /** Najemca o slugu `nes` - drugi krok wyznaczania najemcy domyślnego. */
  nesTenantId: null as string | null,
  /** Awaria odczytu najemcy domyślnego. */
  defaultTenantError: null as { message: string } | null,
  /** Filtry `.eq()` odczytów `tenants` - dowód, o co moduł pytał. */
  tenantLookups: [] as [string, unknown][],
  /**
   * Profil, który `handle_new_user` zakłada kontu utworzonemu przez
   * `createUser` - w TEJ SAMEJ transakcji, w najemcy DOMYŚLNYM, bez względu na
   * metadane konta (20260805083149). To jest dokładnie stan, który atrapa
   * dawniej pomijała (nowe konto = „brak profilu"), i dlatego żaden test nie
   * zobaczył, że granica najemcy odrzuca każde zaproszenie nowej osoby do
   * organizacji innej niż domyślna. `tenant: undefined` = najemca domyślny;
   * `slug: null` = profil bez sluga, więc hydracja policzy go z nazwy.
   */
  newAccountProfile: { tenant: undefined, slug: null } as {
    tenant: string | null | undefined;
    slug: string | null;
  } | null,
  /** Identyfikatory kont założonych przez `createUser` w tym teście. */
  createdUserIds: [] as string[],
  /** Zapis stron, o które moduł poprosił katalog - dowód na stronicowanie. */
  listUsersPages: [] as { page: number; perPage: number }[],
  /** Awaria katalogu tożsamości (`listUsers`). */
  listUsersError: null as Error | null,
  /** Po odpowiedzi `listUsers` - np. konto założone w tym czasie przez inne żądanie. */
  afterListUsers: null as (() => void) | null,
  /**
   * Slug, który konto JUŻ MA w `profiles`. `null` = konto bez sluga (nowe),
   * więc hydracja policzy go z nazwy.
   */
  existingProfileSlug: null as string | null,
  /**
   * Najemca, do którego konto JUŻ należy (`profiles.tenant_id`). `null` =
   * profil bez najemcy albo brak profilu. Różny od najemcy zaproszenia =
   * konto z OBCEGO obszaru roboczego - hydracja ma wtedy odmówić.
   */
  existingProfileTenant: null as string | null,
  /** Awaria odczytu istniejącego profilu (slug + najemca). */
  existingProfileError: null as { message: string } | null,
  /** Odmowa zapisu hydracji per tabela (`profiles`, `author_profiles`, `user_roles`). */
  upsertErrors: {} as Record<string, { message: string }>,
  /**
   * Odmowa zapisu hydracji TYLKO przy pierwszym zapisie do danej tabeli
   * (potem wpis znika). `upsertErrors` odmawia każdemu zapisowi, więc nie
   * odróżni „porażka jednej osoby przerywa jej zapisy" od „porażka jednej
   * osoby zatrzymuje cały import" - a provisioning ma robić to pierwsze.
   */
  upsertErrorsOnce: {} as Record<string, { message: string }>,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        // Moduł najpierw sprawdza, czy konto o tym adresie już istnieje.
        //
        // Atrapa NAPRAWDĘ stronicuje: kroi `existingAuthUsers` po `page`
        // i `perPage`, zamiast oddawać całą listę na każde pytanie. Bez tego
        // test „konto leży na drugiej stronie" przechodziłby także dla wersji
        // czytającej wyłącznie stronę pierwszą - czyli nie dowodziłby niczego.
        listUsers: async (params?: { page?: number; perPage?: number }) => {
          const page = params?.page ?? 1;
          const perPage = params?.perPage ?? 50;
          h.listUsersPages.push({ page, perPage });
          if (h.listUsersError) return { data: { users: [] }, error: h.listUsersError };
          const all = h.existingAuthUsers ?? [];
          const users = all.slice((page - 1) * perPage, page * perPage);
          h.afterListUsers?.();
          return { data: { users }, error: null };
        },
        updateUserById: async (id: string, attributes: { password?: unknown }) => {
          h.passwordUpdates.push({ id, password: attributes.password });
          if (h.updateUserByIdError) return { data: { user: null }, error: h.updateUserByIdError };
          return { data: { user: { id } }, error: null };
        },
        // Konto po identyfikatorze - przypięte `auth_user_id` zaproszenia.
        // Brak konta GoTrue zgłasza błędem 404 `user_not_found`, nie `null`.
        getUserById: async (id: string) => {
          h.getUserByIdCalls.push(id);
          if (h.getUserByIdError) return { data: { user: null }, error: h.getUserByIdError };
          const user = h.existingAuthUsers.find((u) => u.id === id);
          if (!user) {
            return {
              data: { user: null },
              error: Object.assign(new Error("User not found"), {
                status: 404,
                code: "user_not_found",
              }),
            };
          }
          return { data: { user }, error: null };
        },
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
          if (h.linkError || (h.inviteLinkFails && payload.type === "invite"))
            return { data: null, error: h.linkError ?? new Error("already invited") };
          return {
            data: {
              properties: {
                action_link: "https://example.test/activate?token=abc",
                ...(h.hashedToken ? { hashed_token: h.hashedToken } : {}),
              },
            },
            error: null,
          };
        },
        createUser: async (payload: {
          email: string;
          app_metadata?: Record<string, unknown>;
          user_metadata?: Record<string, unknown>;
        }) => {
          h.authCalls.push({ kind: "create", email: payload.email, payload });
          if (h.authFailsFirstOnly) {
            const isFirst = h.authCalls.filter((call) => call.kind === "create").length === 1;
            if (isFirst) {
              return { data: { user: null }, error: new Error("User already registered") };
            }
          } else if (h.authError) {
            return { data: { user: null }, error: h.authError };
          }
          if (!h.authUserId) return { data: { user: null }, error: null };
          // GoTrue oddaje pełne konto - z adresem i z `app_metadata`, które
          // wołający ustawił (plus pola dostawcy, które GoTrue dokłada sam).
          h.createdUserIds.push(h.authUserId);
          return {
            data: {
              user: {
                id: h.authUserId,
                email: payload.email,
                app_metadata: { provider: "email", ...(payload.app_metadata ?? {}) },
                user_metadata: payload.user_metadata ?? {},
              },
            },
            error: null,
          };
        },
      },
    },
    from: (table: string) => ({
      upsert: (row: unknown, options?: unknown) => {
        h.adminWrites.push({ table, row, options });
        const once = h.upsertErrorsOnce[table];
        if (once) {
          delete h.upsertErrorsOnce[table];
          return Promise.resolve({ data: null, error: once });
        }
        return Promise.resolve({ data: null, error: h.upsertErrors[table] ?? null });
      },
      select: () => {
        // Łańcuch obsługuje dwa użycia: listę profili (`.in()` → wynik po await)
        // oraz wiersz subskrypcji zapraszanego (`.eq().in().order().limit().maybeSingle()`),
        // z którego wynika zakres obietnicy w treści maila. Każde ogniwo jest
        // jednocześnie obietnicą i łańcuchem, więc oba użycia działają.
        let emailBatch: string[] | null = null;
        const filters: [string, unknown][] = [];
        const result = () => {
          if (h.adminProfilesError)
            return Promise.resolve({ data: null, error: h.adminProfilesError });
          if (h.adminProfilesNull) return Promise.resolve({ data: null, error: null });
          const rows =
            h.adminProfilesFor && emailBatch ? h.adminProfilesFor(emailBatch) : h.adminProfiles;
          const tenantFilter = filters.find(([c]) => c === "tenant_id")?.[1];
          const scoped =
            tenantFilter === undefined
              ? rows
              : rows.filter(
                  (row) =>
                    !("tenant_id" in row) ||
                    row.tenant_id === undefined ||
                    row.tenant_id === tenantFilter,
                );
          return Promise.resolve({ data: scoped, error: null });
        };
        const chain: Record<string, unknown> = {};
        chain["eq"] = (column: string, value: unknown) => {
          filters.push([column, value]);
          if (table === "tenants") h.tenantLookups.push([column, value]);
          return Object.assign(result(), chain);
        };
        for (const method of ["order", "limit"]) {
          chain[method] = () => Object.assign(result(), chain);
        }
        chain["in"] = (column: string, values: string[]) => {
          if (column === "email") {
            emailBatch = values;
            h.adminProfileEmailBatches.push(values);
          }
          return Object.assign(result(), chain);
        };
        // `maybeSingle` obsługuje DWA odczyty i muszą się różnić po tabeli:
        // slug istniejącego profilu (hydracja czyta go, żeby NIE nadpisać
        // publicznego adresu) oraz wiersz subskrypcji zapraszanego.
        chain["maybeSingle"] = () => {
          if (table === "tenants") {
            if (h.defaultTenantError) {
              return Promise.resolve({ data: null, error: h.defaultTenantError });
            }
            const byFlag = filters.some(([c, v]) => c === "is_default" && v === true);
            const bySlug = filters.some(([c, v]) => c === "slug" && v === "nes");
            const id = byFlag ? h.defaultTenantId : bySlug ? h.nesTenantId : null;
            return Promise.resolve({ data: id ? { id } : null, error: null });
          }
          if (table === "profiles" && h.existingProfileError) {
            return Promise.resolve({ data: null, error: h.existingProfileError });
          }
          if (table !== "profiles") return Promise.resolve({ data: null, error: null });
          // Konto założone w tym teście przez `createUser`: profil z
          // `handle_new_user`, w najemcy domyślnym.
          const profileId = filters.find(([c]) => c === "id")?.[1];
          if (typeof profileId === "string" && h.createdUserIds.includes(profileId)) {
            const born = h.newAccountProfile;
            return Promise.resolve({
              data: born
                ? {
                    slug: born.slug,
                    tenant_id: born.tenant === undefined ? h.defaultTenantId : born.tenant,
                  }
                : null,
              error: null,
            });
          }
          // `profiles.tenant_id` jest NOT NULL - profil zawsze ma najemcę.
          return Promise.resolve({
            data:
              h.existingProfileTenant !== null
                ? { slug: h.existingProfileSlug, tenant_id: h.existingProfileTenant }
                : null,
            error: null,
          });
        };
        return chain;
      },
    }),
  },
}));

vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: async (input: {
    to: string;
    lang: string;
    ctaUrl?: string;
    details?: { label: string; value: string }[];
  }) => {
    h.emails.push(input);
    if (h.emailSkipped === "duplicate") return { ok: true, skipped: "duplicate" };
    if (h.emailSkipped) return { ok: false, skipped: h.emailSkipped, reason: "suppressed:bounce" };
    return h.emailOk ? { ok: true } : { ok: false, error: h.emailError };
  },
}));

import {
  createInvitations,
  searchCrmCompanies,
  createCrmCompany,
  sendActivationEmailForUser,
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
  /**
   * Najemca domyślny platformy - tam `handle_new_user` zakłada profil każdego
   * nowego konta. RÓŻNY od najemcy zaproszeń (`tenant`), bo to jest przypadek
   * każdej organizacji poza domyślną.
   */
  defaultTenant: "99999999-9999-4999-8999-999999999999",
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
 * Odpowiedź `admin_get_user` (e-mail adresata aktywacji). `profiles.email`
 * nie jest czytelne dla `authenticated`, więc handler czyta go funkcją
 * redakcji, a nie `select("email")` - atrapa tabeli przyjmowała oba.
 */
let adminGetUser: SupabaseResult | null = null;

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
      if (name === "admin_claim_invitation_send" && h.claimError)
        return Promise.resolve({ data: null, error: h.claimError });
      if (name === "admin_get_user" && adminGetUser) return Promise.resolve(adminGetUser);
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
  h.existingAuthUsers = [];
  h.getUserByIdError = null;
  h.getUserByIdCalls = [];
  h.passwordUpdates = [];
  h.updateUserByIdError = null;
  h.defaultTenantId = IDS.defaultTenant;
  h.nesTenantId = null;
  h.defaultTenantError = null;
  h.tenantLookups = [];
  h.newAccountProfile = { tenant: undefined, slug: null };
  h.createdUserIds = [];
  h.listUsersPages = [];
  h.listUsersError = null;
  h.afterListUsers = null;
  h.existingProfileSlug = null;
  h.existingProfileTenant = null;
  h.existingProfileError = null;
  h.upsertErrors = {};
  h.upsertErrorsOnce = {};
  h.claimError = null;
  h.inviteLinkFails = false;
  h.hashedToken = null;
  db = supabaseFromStub();
  rpcCalls = [];
  rpcUsers = [];
  adminGetUser = null;
  h.authCalls = [];
  h.authUserId = "aaaa1111-2222-4333-8444-555566667777";
  h.authError = null;
  h.adminWrites = [];
  h.adminProfiles = [];
  h.adminProfilesNull = false;
  h.adminProfilesFor = null;
  h.adminProfilesError = null;
  h.adminProfileEmailBatches = [];
  h.authFailsFirstOnly = false;
  h.emails = [];
  h.emailOk = true;
  h.linkError = null;
  h.emailError = "smtp down";
  h.emailSkipped = null;
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
    expect(h.emails[0].ctaUrl).toBe("https://example.test/activate?token=abc");
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

  it("konto z potwierdzeniem nadanym przez administratora niesie znacznik w `app_metadata` (R12)", async () => {
    // Potwierdzenie bez kliknięcia w skrzynce nie jest dowodem adresu: baza
    // (`_event_uid_owns_email`) czyta `provisioned_by_admin` i adres, dla
    // którego go nadano. Znacznik MUSI iść w `app_metadata` (zmienia go tylko
    // klucz serwisowy) i w TYM SAMYM wywołaniu - nie w `user_metadata`, które
    // posiadacz hasła tymczasowego nadpisuje sam.
    withInvitation(invitationRow({ mode: "temp_password", email: "Nowa@Example.org" }));
    await send();
    const payload = h.authCalls[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      email_confirm: true,
      app_metadata: { provisioned_by_admin: true, provisioned_email: "nowa@example.org" },
    });
    expect(payload.user_metadata).not.toHaveProperty("provisioned_by_admin");
  });

  it("tryb odnośnika (adres potwierdza dopiero klik) NIE dostaje znacznika administratora", async () => {
    withInvitation(invitationRow({ mode: "magic_link" }));
    await send();
    expect(h.authCalls[0].payload).toMatchObject({ email_confirm: false });
    // `app_metadata` niesie WYŁĄCZNIE najemcę narodzin - bez znacznika
    // potwierdzenia nadanego przez administratora.
    const payload = h.authCalls[0].payload as { app_metadata?: Record<string, unknown> };
    expect(payload.app_metadata).toEqual({ tenant_id: IDS.tenant });
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
    // wysyłka nie przechodzi katalogu i nie zakłada konta - pobiera konto po
    // identyfikatorze (który niczego nie poświadcza, patrz `getUserById`
    // niżej) i tylko uzupełnia profil.
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser }));
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.tenant;
    const result = await send();
    expect(h.authCalls.every((call) => call.kind.startsWith("link:"))).toBe(true);
    expect(h.listUsersPages).toEqual([]);
    expect(h.getUserByIdCalls).toEqual([IDS.existingUser]);
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
    // Znaki z ogonkami schodzą przez `NFD` + usunięcie znaków diakrytycznych,
    // a „ł" - które rozkładu kanonicznego NIE MA - przez `replaceStrokeLetters`
    // wołane PRZED `NFD`. Wcześniej dawało tu `zazo-c-gesla-jazn`: litera
    // zamieniała się w dywiz.
    expect(profile.slug).toBe("zazolc-gesla-jazn");
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
    //
    // CEL KONFLIKTU ROLI musi być zbiorem kolumn indeksu unikalnego z migracji
    // (`user_roles_unique_per_tenant` = `(tenant_id, user_id, role)`,
    // 20260531181120). Ta asercja przez długi czas UTRWALAŁA `user_id,role` -
    // cel po zdjętym `UNIQUE`, na którym Postgres odpowiada 42P10 i który
    // wywracał KAŻDĄ wysyłkę. Atrapa bazy tego nie zweryfikuje (przyjmie
    // dowolny napis); zgodność z migracjami pilnuje bramka kontraktowa
    // `check:on-conflict-arbiters`. Tu pilnujemy tylko, że kod wysyła cel
    // uzgodniony z tą bramką.
    withInvitation(invitationRow());
    await send();
    expect(h.adminWrites.find((write) => write.table === "profiles")?.options).toEqual({
      onConflict: "id",
      ignoreDuplicates: false,
    });
    expect(h.adminWrites.find((write) => write.table === "user_roles")?.options).toEqual({
      onConflict: "tenant_id,user_id,role",
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
    expect(JSON.stringify(h.emails[0].details)).toContain(result.tempPassword);
    // I musi być odnośnik do logowania z wypełnionym adresem.
    expect(h.emails[0].ctaUrl).toContain(encodeURIComponent("nowa@example.org"));
  });

  it("PONOWIENIE w trybie hasła wysyła wiadomość, ale BEZ nowego hasła", async () => {
    // Konto istnieje, więc nowe hasło nie powstaje - wiadomość przypomina
    // tylko adres logowania.
    withInvitation(invitationRow({ mode: "temp_password", auth_user_id: IDS.existingUser }));
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.tenant;
    const result = await send();
    expect(h.emails).toHaveLength(1);
    expect(result.tempPassword).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("adres na liście blokad daje własny kod `email_suppressed`, nie `email_failed:undefined`", async () => {
    // Pominięcie przez bramkę poczty nie niesie `error` - stary kod składał
    // z niego `email_failed:undefined`, a panel radził „spróbuj za chwilę",
    // choć ponowienie zostanie pominięte tak samo.
    withInvitation(invitationRow({ mode: "temp_password" }));
    h.emailSkipped = "suppressed";
    const result = await send();
    expect(result).toMatchObject({ ok: false, error: "email_suppressed" });
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

// ---------------------------------------------------------------------------
// 5a. GRANICA NAJEMCY W WYSYŁCE - naprawa defektu krytycznego wydania 12.
//
// `findAuthUserIdByEmail` przeszukuje CAŁY katalog kont, a hydracja pisze
// kluczem serwisowym `profiles.tenant_id`, profil autora i rolę w najemcy
// ZAPRASZAJĄCEGO. Do tej poprawki zaproszenie adresu osoby z obszaru B
// wysłane przez administratora obszaru A przenosiło jej konto do A.
// ---------------------------------------------------------------------------

describe("sendInvitation - konto z obcego najemcy nie jest przepinane", () => {
  beforeEach(() => {
    grantAdmin();
  });

  function withInvitation(row: InvitationRow): void {
    db.setResponse("user_invitations", (chain) => (chain.has("update") ? ok(null) : ok(row)));
    db.setResponse("audit_log", ok(null));
  }

  async function send(): Promise<{ ok: boolean; error?: string }> {
    return callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
  }

  function failedUpdate(): { status: string; last_error: string } | undefined {
    return db
      .chainsFor("user_invitations")
      .find((chain) => chain.has("update"))
      ?.argsOf("update")?.[0] as { status: string; last_error: string } | undefined;
  }

  it("konto znalezione w katalogu, ale należące do INNEGO najemcy - odmowa bez żadnego zapisu", async () => {
    withInvitation(invitationRow());
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.otherTenant;
    const result = await send();
    expect(result).toMatchObject({ ok: false, error: "account_in_other_tenant" });
    // Ani profil, ani profil autora, ani rola nie zostały dotknięte...
    expect(h.adminWrites).toEqual([]);
    // ...konto nie powstało drugi raz, a mail nie wyszedł.
    expect(h.authCalls.filter((call) => call.kind === "create")).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
    expect(failedUpdate()).toMatchObject({
      status: "failed",
      last_error: "account_in_other_tenant",
    });
  });

  it("ponowna wysyłka zaproszenia powiązanego z kontem, które PRZESZŁO do innego najemcy - też odmowa", async () => {
    // Konto istnieje i ma adres zaproszenia - przypięcie przechodzi
    // weryfikację, a odmawia dopiero granica najemcy (także przy poświadczeniu
    // narodzin dla TEGO najemcy: ono otwiera wyłącznie najemcę domyślnego).
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser }));
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", app_metadata: { tenant_id: IDS.tenant } },
    ];
    h.existingProfileTenant = IDS.otherTenant;
    const result = await send();
    expect(result.error).toBe("account_in_other_tenant");
    expect(h.getUserByIdCalls).toEqual([IDS.existingUser]);
    expect(h.adminWrites).toEqual([]);
    expect(h.authCalls).toEqual([]);
    expect(h.emails).toHaveLength(0);
    expect(failedUpdate()).toEqual({ status: "failed", last_error: "account_in_other_tenant" });
  });

  it("konto w TYM SAMYM najemcy jest dowiązywane jak dotąd (kontrola dodatnia)", async () => {
    withInvitation(invitationRow());
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.tenant;
    h.existingProfileSlug = "nowa-osoba";
    const result = await send();
    expect(result.ok).toBe(true);
    const profileWrite = h.adminWrites.find((write) => write.table === "profiles");
    expect(profileWrite?.row).toMatchObject({
      id: IDS.existingUser,
      tenant_id: IDS.tenant,
      slug: "nowa-osoba",
    });
  });

  // `profiles.tenant_id` jest NOT NULL, więc „profil bez najemcy" nie istnieje.
  // Istnieje konto BEZ PROFILU (np. profil usunięty ręcznie) - i ono należy do
  // kogoś: właściciela adresu z historią w innych tabelach. Dowiązać wolno je
  // wyłącznie wtedy, gdy narodziło się z zaproszenia TEGO najemcy.
  it("konto BEZ profilu, narodzone z zaproszenia tego najemcy (`app_metadata`) - dowiązywane", async () => {
    withInvitation(invitationRow());
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", app_metadata: { tenant_id: IDS.tenant } },
    ];
    const result = await send();
    expect(result.ok).toBe(true);
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
  });

  it("konto BEZ profilu i bez poświadczenia najemcy - odmowa bez żadnego zapisu", async () => {
    withInvitation(invitationRow());
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    const result = await send();
    expect(result).toMatchObject({ ok: false, error: "account_in_other_tenant" });
    expect(h.adminWrites).toEqual([]);
    expect(h.emails).toHaveLength(0);
  });

  it("awaria odczytu istniejącego profilu NIE czyta się jak „profilu nie ma” - nic nie jest zapisywane", async () => {
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser }));
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileError = { message: "permission denied for table profiles" };
    const result = await send();
    expect(result).toMatchObject({ ok: false, error: "permission denied for table profiles" });
    expect(h.adminWrites).toEqual([]);
    expect(h.emails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5a. NOWA OSOBA W ORGANIZACJI INNEJ NIŻ DOMYŚLNA - zgłoszony defekt.
//
// `handle_new_user` (20260805083149) zakłada profil KAŻDEGO nowego konta
// w najemcy domyślnym, w tej samej transakcji co `createUser`. Pierwsza wersja
// granicy najemcy porównywała ten profil z najemcą zaproszenia i rzucała
// `account_in_other_tenant` zaraz po tym, jak sama założyła konto - więc
// zaproszenie NOWEJ osoby do każdej organizacji poza domyślną odmawiało
// zawsze, a konto zostawało osierocone w najemcy domyślnym. Atrapa udawała
// wtedy, że nowe konto nie ma profilu, i żaden test tego nie zobaczył; teraz
// modeluje `handle_new_user` (`h.newAccountProfile`). Kontrakt po stronie bazy
// (profil rodzi się w najemcy domyślnym, a zapis kluczem serwisowym go
// przenosi) przypina `supabase/tests/invitation_new_account_tenant_birth_test.sql`.
// ---------------------------------------------------------------------------

describe("sendInvitation - nowa osoba w organizacji innej niż domyślna", () => {
  beforeEach(() => {
    grantAdmin();
  });

  let auditExecutions: Record<string, unknown>[] = [];

  function withInvitation(row: InvitationRow): void {
    db.setResponse("user_invitations", (chain) => (chain.has("update") ? ok(null) : ok(row)));
    // Odpowiedź liczy WYKONANIA (`then`), nie samo `insert`: `void insert()`
    // nie wysyła żądania, a atrapa zapisuje ogniwo już przy wywołaniu.
    auditExecutions = [];
    db.setResponse("audit_log", (chain) => {
      auditExecutions.push(chain.argsOf("insert")?.[0] as Record<string, unknown>);
      return ok(null);
    });
  }

  async function send(): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
    return callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
  }

  function invitationUpdates(): Record<string, unknown>[] {
    return db
      .chainsFor("user_invitations")
      .filter((chain) => chain.has("update"))
      .map((chain) => chain.argsOf("update")?.[0] as Record<string, unknown>);
  }

  it.each(["magic_link", "temp_password"] as const)(
    "tryb %s: konto powstaje, profil z najemcy domyślnego przechodzi do najemcy zaproszenia, mail wychodzi",
    async (mode) => {
      withInvitation(invitationRow({ mode }));
      const result = await send();
      expect(result).toMatchObject({ ok: true });
      expect(h.authCalls.filter((call) => call.kind === "create")).toHaveLength(1);
      // Poświadczenie najemcy narodzin - jedyne, które odróżnia to konto od
      // konta czytelnika z najemcy domyślnego.
      expect(h.authCalls[0].payload).toMatchObject({ app_metadata: { tenant_id: IDS.tenant } });
      expect(h.adminWrites.map((write) => write.table)).toEqual([
        "profiles",
        "author_profiles",
        "user_roles",
      ]);
      for (const write of h.adminWrites) {
        expect(write.row).toMatchObject({ tenant_id: IDS.tenant });
      }
      expect(h.emails).toHaveLength(1);
      expect(invitationUpdates()).toEqual([
        expect.objectContaining({ status: "sent", auth_user_id: h.authUserId }),
      ]);
      // Najemca domyślny wyznaczony jak w `handle_new_user`: flaga.
      expect(h.tenantLookups).toContainEqual(["is_default", true]);
    },
  );

  it("nowe konto zachowuje slug nadany przez `handle_new_user`", async () => {
    // Slug z wyzwalacza jest już unikalny (sufiks przy imienniku); liczenie
    // go drugi raz z nazwy mogłoby trafić w cudzy `profiles_slug_unique`.
    withInvitation(invitationRow());
    h.newAccountProfile = { tenant: undefined, slug: "nowa-osoba-7" };
    expect((await send()).ok).toBe(true);
    expect(h.adminWrites[0].row).toMatchObject({ slug: "nowa-osoba-7" });
  });

  it("zaproszenie do najemcy DOMYŚLNEGO nie pyta o najemcę domyślnego - profil już jest u zapraszającego", async () => {
    withInvitation(invitationRow({ tenant_id: IDS.defaultTenant }));
    const result = await send();
    expect(result.ok).toBe(true);
    expect(h.tenantLookups).toEqual([]);
    expect(h.adminWrites[0].row).toMatchObject({ tenant_id: IDS.defaultTenant });
  });

  it("PONOWIENIE po przerwanej pierwszej wysyłce dowiązuje konto narodzone z zaproszenia tego najemcy", async () => {
    // Pierwsza wysyłka założyła konto i padła przed hydracją: profil stoi
    // wciąż w najemcy domyślnym. „Spróbuj ponownie" ma to dokończyć, a nie
    // zakładać drugie konto ani odmawiać.
    withInvitation(invitationRow());
    h.existingAuthUsers = [
      {
        id: IDS.existingUser,
        email: "nowa@example.org",
        app_metadata: { provider: "email", tenant_id: IDS.tenant },
      },
    ];
    h.existingProfileTenant = IDS.defaultTenant;
    h.existingProfileSlug = "nowa-osoba";
    const result = await send();
    expect(result.ok).toBe(true);
    expect(h.authCalls.some((call) => call.kind === "create")).toBe(false);
    expect(h.adminWrites[0].row).toMatchObject({
      id: IDS.existingUser,
      tenant_id: IDS.tenant,
      slug: "nowa-osoba",
    });
  });

  // ---- hasło tymczasowe przy ponowieniu ------------------------------------

  /** Konto założone przez administratora dla tego adresu, nigdy nieużyte. */
  function provisionedAccount(overrides: Record<string, unknown> = {}): void {
    h.existingAuthUsers = [
      {
        id: IDS.existingUser,
        email: "nowa@example.org",
        app_metadata: {
          provisioned_by_admin: true,
          provisioned_email: "nowa@example.org",
          tenant_id: IDS.tenant,
        },
        ...overrides,
      },
    ];
  }

  it("ponowienie w trybie hasła nadaje NOWE hasło kontu założonemu przez administratora i nigdy nieużytemu", async () => {
    // Hasło z pierwszej (przerwanej) wysyłki istniało tylko w pamięci tamtego
    // wywołania - bez nowego mail niósłby sam adres logowania.
    withInvitation(invitationRow({ mode: "temp_password" }));
    provisionedAccount();
    h.existingProfileTenant = IDS.defaultTenant;
    const result = await send();
    expect(result.ok).toBe(true);
    expect(h.passwordUpdates).toHaveLength(1);
    const [{ id, password }] = h.passwordUpdates;
    expect(id).toBe(IDS.existingUser);
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
    expect(JSON.stringify(h.emails[0].details)).toContain(String(password));
    expect(h.authCalls.some((call) => call.kind === "create")).toBe(false);
  });

  it("nowe hasło idzie WYŁĄCZNIE do skrzynki konta - nigdy w wyniku dla wołającego", async () => {
    // Ponowić może każdy administrator najemcy, także dla konta z wyższą rolą,
    // które założył ktoś inny. Hasło w wyniku pozwoliłoby mu się na nie
    // zalogować (nieużyte konto nie ma MFA) - awans, którego mu odmawiają
    // `change_user_role` i `startImpersonation`.
    withInvitation(invitationRow({ mode: "temp_password" }));
    provisionedAccount();
    h.existingProfileTenant = IDS.tenant;
    const result = await send();
    expect(result.ok).toBe(true);
    expect(h.passwordUpdates).toHaveLength(1);
    expect(result.tempPassword).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(String(h.passwordUpdates[0].password));
  });

  it.each([
    ["awaria dostawcy poczty", { emailOk: false }, "email_failed:smtp down"],
    ["adres na liście blokad", { emailSkipped: "suppressed" as const }, "email_suppressed"],
  ])(
    "mail nie wyszedł (%s) - stare hasło zostaje, nowe nie wraca do wołającego",
    async (_label, mail, error) => {
      // Hasło z wcześniejszej wysyłki mogło dotrzeć albo zostać przekazane
      // ręcznie. Zmiana przed nieudanym mailem odebrałaby je, a nowego nikt
      // by nie dostał - więc hasło zmienia się dopiero po przyjęciu maila.
      withInvitation(invitationRow({ mode: "temp_password" }));
      provisionedAccount();
      h.existingProfileTenant = IDS.tenant;
      Object.assign(h, mail);
      const result = await send();
      expect(result).toMatchObject({ ok: false, error });
      expect(h.passwordUpdates).toEqual([]);
      expect(result.tempPassword).toBeUndefined();
    },
  );

  it("wysyłka obsłużona już wcześniej (`duplicate`) nie zmienia hasła - tamten mail niósł inne", async () => {
    withInvitation(invitationRow({ mode: "temp_password" }));
    provisionedAccount();
    h.existingProfileTenant = IDS.tenant;
    h.emailSkipped = "duplicate";
    expect((await send()).ok).toBe(true);
    expect(h.passwordUpdates).toEqual([]);
  });

  it.each([
    ["konto, na które ktoś się już zalogował", { last_sign_in_at: OLDER_ISO }],
    [
      "konto bez znacznika założenia przez administratora",
      { app_metadata: { tenant_id: IDS.tenant } },
    ],
    [
      "konto założone przez administratora dla INNEGO adresu",
      {
        app_metadata: {
          provisioned_by_admin: true,
          provisioned_email: "ktos-inny@example.org",
          tenant_id: IDS.tenant,
        },
      },
    ],
    [
      "konto założone przez administratora bez poświadczenia najemcy",
      { app_metadata: { provisioned_by_admin: true, provisioned_email: "nowa@example.org" } },
    ],
    [
      "konto założone przez administratora dla INNEGO najemcy",
      {
        app_metadata: {
          provisioned_by_admin: true,
          provisioned_email: "nowa@example.org",
          tenant_id: IDS.otherTenant,
        },
      },
    ],
  ] as const)("%s zachowuje swoje hasło", async (_label, overrides) => {
    withInvitation(invitationRow({ mode: "temp_password" }));
    provisionedAccount(overrides);
    h.existingProfileTenant = IDS.tenant;
    const result = await send();
    expect(result.ok).toBe(true);
    expect(result.tempPassword).toBeUndefined();
    expect(h.passwordUpdates).toEqual([]);
  });

  it("tryb odnośnika nie rusza hasła nawet kontu założonemu przez administratora", async () => {
    withInvitation(invitationRow({ mode: "magic_link" }));
    provisionedAccount();
    h.existingProfileTenant = IDS.tenant;
    expect((await send()).ok).toBe(true);
    expect(h.passwordUpdates).toEqual([]);
  });

  it("awaria nadania hasła PO przyjętym mailu - błąd, zaproszenie NIE jest `sent`", async () => {
    // Mail wyszedł z hasłem, które nie działa; poprzednie (jeśli było) działa
    // dalej, a ponowienie wyśle nowe. Wysyłka nie może udawać sukcesu.
    withInvitation(invitationRow({ mode: "temp_password" }));
    provisionedAccount();
    h.existingProfileTenant = IDS.tenant;
    h.updateUserByIdError = new Error("weak password");
    const result = await send();
    expect(result).toMatchObject({ ok: false, error: "password_reset_failed:weak password" });
    expect(h.emails).toHaveLength(1);
    expect(JSON.stringify(h.emails[0].details)).toContain(String(h.passwordUpdates[0].password));
    const updates = db
      .chainsFor("user_invitations")
      .filter((chain) => chain.has("update"))
      .map((chain) => chain.argsOf("update")?.[0] as { status?: string });
    expect(updates.some((update) => update.status === "sent")).toBe(false);
  });

  it("najemca domyślny bez flagi rozstrzyga się slugiem `nes` - jak w `handle_new_user`", async () => {
    withInvitation(invitationRow());
    h.defaultTenantId = null;
    h.nesTenantId = IDS.defaultTenant;
    h.newAccountProfile = { tenant: IDS.defaultTenant, slug: null };
    const result = await send();
    expect(result.ok).toBe(true);
    expect(h.tenantLookups).toEqual([
      ["is_default", true],
      ["slug", "nes"],
    ]);
  });

  // ---- odmowy: nic w koncie, żaden mail, jeden kod ------------------------

  function expectRefusedWithoutSideEffects(result: { ok: boolean; error?: string }): void {
    expect(result).toMatchObject({ ok: false, error: "account_in_other_tenant" });
    expect(h.adminWrites).toEqual([]);
    expect(h.emails).toHaveLength(0);
    // Ani `createUser`, ani link logowania do cudzego konta.
    expect(h.authCalls).toEqual([]);
  }

  it.each([
    ["konto czytelnika zarejestrowanego samodzielnie (bez `app_metadata.tenant_id`)", {}],
    [
      "konto narodzone z zaproszenia INNEGO najemcy",
      { tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ],
    ["`app_metadata.tenant_id` nie jest tekstem", { tenant_id: 42 }],
  ] as const)("profil w najemcy domyślnym, %s - odmowa", async (_label, appMetadata) => {
    withInvitation(invitationRow());
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", app_metadata: { ...appMetadata } },
    ];
    h.existingProfileTenant = IDS.defaultTenant;
    expectRefusedWithoutSideEffects(await send());
  });

  it("konto narodzone dla TEGO najemcy, ale już używane jako czytelnik najemcy domyślnego - odmowa", async () => {
    // Przerwana wysyłka nie dała ani linku, ani hasła; sesja w historii znaczy,
    // że właściciel dostał się do konta inną drogą („nie pamiętam hasła")
    // i zbudował w najemcy domyślnym swoje dane.
    withInvitation(invitationRow());
    h.existingAuthUsers = [
      {
        id: IDS.existingUser,
        email: "nowa@example.org",
        app_metadata: { tenant_id: IDS.tenant },
        last_sign_in_at: OLDER_ISO,
      },
    ];
    h.existingProfileTenant = IDS.defaultTenant;
    expectRefusedWithoutSideEffects(await send());
  });

  it("`user_metadata.tenant_id` NIE poświadcza najemcy - ustawia je sam rejestrujący się klient", async () => {
    withInvitation(invitationRow());
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", user_metadata: { tenant_id: IDS.tenant } },
    ];
    h.existingProfileTenant = IDS.defaultTenant;
    expectRefusedWithoutSideEffects(await send());
  });

  it("konto narodzone dla TEGO najemcy, ale przeniesione do innego - odmowa", async () => {
    // Poświadczenie narodzin otwiera wyłącznie wiersz najemcy DOMYŚLNEGO.
    // Konto, które operator przeniósł do najemcy B, należy do B.
    withInvitation(invitationRow());
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", app_metadata: { tenant_id: IDS.tenant } },
    ];
    h.existingProfileTenant = IDS.otherTenant;
    expectRefusedWithoutSideEffects(await send());
  });

  it("brak wiersza najemcy domyślnego to odmowa, nie dowiązanie (fail closed)", async () => {
    withInvitation(invitationRow());
    h.defaultTenantId = null;
    h.nesTenantId = null;
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", app_metadata: { tenant_id: IDS.tenant } },
    ];
    h.existingProfileTenant = IDS.defaultTenant;
    expectRefusedWithoutSideEffects(await send());
  });

  it("awaria odczytu najemcy domyślnego to BŁĄD - ani odmowa, ani dowiązanie", async () => {
    withInvitation(invitationRow());
    h.defaultTenantError = { message: "connection reset" };
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", app_metadata: { tenant_id: IDS.tenant } },
    ];
    h.existingProfileTenant = IDS.defaultTenant;
    const result = await send();
    expect(result).toMatchObject({
      ok: false,
      error: "default_tenant_lookup_failed:connection reset",
    });
    expect(h.adminWrites).toEqual([]);
    expect(h.emails).toHaveLength(0);
  });

  it("`handle_new_user` założyło profil w najemcy ani domyślnym, ani zaproszenia - odmowa przed hydracją", async () => {
    // Nie zdarza się dziś (rejestracja `staff` nie idzie przez zaproszenie),
    // ale reguła nie zgaduje: konto nowe czy stare, profil u obcego = odmowa.
    withInvitation(invitationRow());
    h.newAccountProfile = { tenant: IDS.otherTenant, slug: null };
    const result = await send();
    expect(result).toMatchObject({ ok: false, error: "account_in_other_tenant" });
    expect(h.adminWrites).toEqual([]);
    expect(h.emails).toHaveLength(0);
  });

  it("odmowa zapisuje `failed` z kodem, NIE przypina konta i zostawia ślad bez danych ofiary", async () => {
    withInvitation(invitationRow());
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.otherTenant;
    await send();
    expect(invitationUpdates()).toEqual([
      { status: "failed", last_error: "account_in_other_tenant" },
    ]);
    expect(auditExecutions).toEqual([
      {
        actor_id: IDS.caller,
        action: "user_invitation_refused",
        entity_type: "user_invitation",
        entity_id: IDS.invitation,
        tenant_id: IDS.tenant,
        metadata: { reason: "account_in_other_tenant" },
      },
    ]);
    const trail = JSON.stringify(auditExecutions);
    expect(trail).not.toContain(IDS.existingUser);
    expect(trail).not.toContain(IDS.otherTenant);
  });

  // ---- przypięte `auth_user_id` nie jest dowodem tożsamości ---------------

  it("przypięty identyfikator konta, którego nie ma - odmowa, przypięcie ZOSTAJE", async () => {
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser }));
    const result = await send();
    expectRefusedWithoutSideEffects(result);
    // Bez przejścia katalogu - przypięty identyfikator nie degraduje się do
    // szukania po adresie ani w tym przebiegu, ani w następnym (zapis statusu
    // nie dotyka `auth_user_id`).
    expect(h.listUsersPages).toEqual([]);
    expect(invitationUpdates()).toEqual([
      { status: "failed", last_error: "account_in_other_tenant" },
    ]);
  });

  it("przypięty identyfikator konta z INNYM adresem niż zaproszenie - odmowa, nawet w tym samym najemcy", async () => {
    // Administrator zapisuje `auth_user_id` wprost przez PostgREST: identyfikator
    // osoby ze swojego najemcy plus własny adres w zaproszeniu dałyby link
    // aktywacyjny na obcy adres i nadpisanie cudzego profilu.
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser, email: "obca@example.org" }));
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.tenant;
    const result = await send();
    expectRefusedWithoutSideEffects(result);
    expect(invitationUpdates()).toEqual([
      { status: "failed", last_error: "account_in_other_tenant" },
    ]);
  });

  it("PONOWNE kliknięcie po odmowie przypiętego konta odmawia tak samo - bez nowego konta i bez cudzego profilu", async () => {
    // Zdjęte przypięcie zamieniało drugie kliknięcie w szukanie po adresie
    // z wiersza: przy `profiles.email` rozjechanym z adresem konta (zmiana
    // adresu logowania nie synchronizuje profilu) aktywacja zakładała nowe
    // konto na nieaktualny adres z rolą członka albo dowiązywała INNEGO
    // członka z tym adresem. Wiersz jest stanowy: druga wysyłka widzi to, co
    // zapisała pierwsza.
    let row = invitationRow({ auth_user_id: IDS.existingUser, email: "stary@example.org" });
    db.setResponse("user_invitations", (chain) => {
      if (chain.has("update")) {
        row = { ...row, ...(chain.argsOf("update")?.[0] as Partial<InvitationRow>) };
        return ok(null);
      }
      return ok(row);
    });
    db.setResponse("audit_log", ok(null));
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowy@example.org" },
      { id: "eeee1111-2222-4333-8444-555566667777", email: "stary@example.org" },
    ];
    h.existingProfileTenant = IDS.tenant;
    const first = await send();
    const second = await send();
    expect(first).toMatchObject({ ok: false, error: "account_in_other_tenant" });
    expect(second).toMatchObject({ ok: false, error: "account_in_other_tenant" });
    expect(row.auth_user_id).toBe(IDS.existingUser);
    expect(h.authCalls).toEqual([]);
    expect(h.adminWrites).toEqual([]);
    expect(h.emails).toHaveLength(0);
  });

  it("adres przypiętego konta porównywany bez wielkości liter i spacji", async () => {
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser, email: "nowa@example.org" }));
    h.existingAuthUsers = [{ id: IDS.existingUser, email: " Nowa@Example.ORG " }];
    h.existingProfileTenant = IDS.tenant;
    expect((await send()).ok).toBe(true);
  });

  it("awaria `getUserById` inna niż brak konta to BŁĄD - bez zapisu i bez zdjęcia przypięcia", async () => {
    withInvitation(invitationRow({ auth_user_id: IDS.existingUser }));
    h.getUserByIdError = Object.assign(new Error("upstream timeout"), { status: 504 });
    const result = await send();
    expect(result).toMatchObject({ ok: false, error: "upstream timeout" });
    expect(h.adminWrites).toEqual([]);
    expect(h.emails).toHaveLength(0);
    expect(invitationUpdates()).toEqual([{ status: "failed", last_error: "upstream timeout" }]);
  });

  // ---- rola i ślad -------------------------------------------------------

  it.each(["super_admin", "moderator", ""])(
    "rola `%s` spoza zbioru zapraszalnych - odmowa PRZED claimem, bez konta i bez maila",
    async (role) => {
      // `user_invitations.role` to `app_role` bez ograniczenia, a administrator
      // zapisuje ją wprost przez PostgREST.
      withInvitation(invitationRow({ role }));
      const result = await send();
      expect(result).toMatchObject({ ok: false, error: "invitation_role_not_allowed" });
      expect(rpcCalls.some((call) => call.name === "admin_claim_invitation_send")).toBe(false);
      expect(h.authCalls).toEqual([]);
      expect(h.listUsersPages).toEqual([]);
      expect(h.adminWrites).toEqual([]);
      expect(h.emails).toHaveLength(0);
      expect(invitationUpdates()).toEqual([
        { status: "failed", last_error: "invitation_role_not_allowed" },
      ]);
    },
  );

  it.each(["user_invitation_sent", "user_invitation_refused"])(
    "ślad `%s` jest ZAKOŃCZONY, zanim wysyłka odda wynik (await, nie `void`)",
    async (action) => {
      // Odpowiedź rozstrzyga się dopiero w następnym makrozadaniu: zapis
      // odpalony bez `await` nie zdąży się zakończyć przed powrotem z
      // `send()`, a na środowisku bez `waitUntil` mógłby nie zakończyć się wcale.
      withInvitation(invitationRow());
      if (action === "user_invitation_refused") {
        h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
        h.existingProfileTenant = IDS.otherTenant;
      }
      const settled: string[] = [];
      db.setResponse("audit_log", (chain): SupabaseResult => {
        const row = chain.argsOf("insert")?.[0] as { action: string };
        settled.push(row.action);
        return ok(null);
      });
      const originalFrom = db.from;
      db.from = (table: string) => {
        const builder = originalFrom(table) as Record<string, unknown>;
        if (table !== "audit_log") return builder;
        const then = builder.then as PromiseLike<unknown>["then"];
        builder.then = (onOk: (value: unknown) => unknown, onKo?: (reason: unknown) => unknown) =>
          new Promise((resolve) => setTimeout(resolve, 0)).then(() => then(onOk, onKo));
        return builder;
      };
      try {
        await send();
      } finally {
        db.from = originalFrom;
      }
      expect(settled).toEqual([action]);
    },
  );

  it("ślad wysyłki WYKONUJE się (dawniej `void insert()` nie wysyłał żądania)", async () => {
    withInvitation(invitationRow());
    expect((await send()).ok).toBe(true);
    expect(auditExecutions).toHaveLength(1);
    expect(auditExecutions[0]).toMatchObject({
      action: "user_invitation_sent",
      tenant_id: IDS.tenant,
      metadata: { auth_user_id: h.authUserId },
    });
  });
});

// ---------------------------------------------------------------------------
// 5b. WYNIK ZAPISÓW HYDRACJI - odmowa bazy nie może kończyć się „wysłano".
// ---------------------------------------------------------------------------

describe("sendInvitation - odmowa zapisu hydracji przerywa wysyłkę", () => {
  beforeEach(() => {
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow()),
    );
    db.setResponse("audit_log", ok(null));
  });

  async function send(): Promise<{ ok: boolean; error?: string }> {
    return callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
  }

  it.each([
    ["profiles", "profile_write_failed", ["profiles"]],
    ["author_profiles", "author_write_failed", ["profiles", "author_profiles"]],
    ["user_roles", "role_write_failed", ["profiles", "author_profiles", "user_roles"]],
  ] as const)(
    "odmowa zapisu `%s` kończy się `%s`, bez maila i bez statusu „sent”",
    async (table, prefix, attempted) => {
      h.upsertErrors = { [table]: { message: "new row violates row-level security policy" } };
      const result = await send();
      expect(result.ok).toBe(false);
      expect(result.error).toBe(`${prefix}:new row violates row-level security policy`);
      // Zapisy PO odmowie nie są już próbowane.
      expect(h.adminWrites.map((write) => write.table)).toEqual(attempted);
      expect(h.emails).toHaveLength(0);
      const statuses = db
        .chainsFor("user_invitations")
        .filter((chain) => chain.has("update"))
        .map((chain) => (chain.argsOf("update")?.[0] as { status: string }).status);
      expect(statuses).toEqual(["failed"]);
    },
  );
});

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
    // R12: potwierdzenie z importu zespołu też nie dowodzi skrzynki - znacznik
    // w `app_metadata` (tylko klucz serwisowy), dla adresu z widgetu.
    // `tenant_id` w `app_metadata` poświadcza najemcę narodzin: przerwany
    // import zostawia profil w najemcy domyślnym, a `performSend` dowiąże takie
    // konto tylko z tym znacznikiem (`resolveInviteTarget`).
    expect(h.authCalls[0].payload).toMatchObject({
      app_metadata: {
        provisioned_by_admin: true,
        provisioned_email: (h.authCalls[0].payload as { email: string }).email,
        tenant_id: IDS.tenant,
      },
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
    // Profil SCALA (`DO UPDATE`), a nie pomija istniejącego wiersza: na tej
    // ścieżce opiera się zachowanie sluga - zastany wiersz dostaje dane
    // z widgetu, a kolumny spoza ładunku (slug) zostają nietknięte.
    expect(h.adminWrites.find((write) => write.table === "profiles")?.options).toEqual({
      onConflict: "id",
      ignoreDuplicates: false,
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
      // Ślad wskazuje konto, które `createUser` właśnie oddał.
      auth_user_id: h.authUserId,
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

  it("ISTNIEJĄCE konto BEZ zaproszenia dostaje DOKŁADNIE JEDEN ślad - z identyfikatorem TEGO konta", async () => {
    // `skipped` nie zwalnia ze śladu: import ma zostawić rekord, skąd osoba
    // trafiła do zespołu, także gdy jej konto powstało wcześniej innym
    // kanałem. Ślad nie może też zależeć od tego, czy w przebiegu powstało
    // JAKIEKOLWIEK nowe konto (warunek w rodzaju `created > 0`) - tu nie
    // powstało żadne. I musi wskazywać konto ZASTANE, a nie identyfikator,
    // który oddałby `createUser` (atrapa ma inny), gdyby go wywołano.
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    rpcUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    const result = await provision({ pageSlug: "o-nas", role: "editor", autoLink: false });
    expect(result).toEqual({ created: 0, skipped: 1, linked: 0, errors: [] });
    expect(h.authCalls).toHaveLength(0);
    const inserts = provisionAuditInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tenant_id: IDS.tenant,
      email: "nowa@example.org",
      role: "editor",
      status: "accepted",
      source: "provision:o-nas",
      auth_user_id: IDS.existingUser,
    });
  });

  it("konto bez adresu w wyniku RPC nie jest uznane za istniejące", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    rpcUsers = [{ id: IDS.existingUser, email: null }];
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.created).toBe(1);
  });

  it("błąd `createUser` bez komunikatu daje ogólny kod, a szczegół idzie do logu serwera", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.authError = { status: 429 };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await provision({ pageSlug: "o-nas", autoLink: false });
      expect(result.errors).toEqual([
        { email: "nowa@example.org", error: "account_create_failed" },
      ]);
      expect(log).toHaveBeenCalledWith("[provisionTeamMembers] createUser failed", {
        code: null,
        status: 429,
      });
    } finally {
      log.mockRestore();
    }
  });

  it("odczyt profili do dowiązania zwracający `null` nie wywraca kroku", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfilesNull = true;
    const result = await provision({ pageSlug: "o-nas", autoLink: true });
    expect(result.linked).toBe(0);
  });

  it("ISTNIEJĄCE zaproszenie NIE jest dublowane", async () => {
    // Odczyt istniejących zaproszeń jest jeden dla całej strony (lista
    // adresów), więc odpowiedź to lista wierszy, a nie pojedynczy rekord.
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", (chain) =>
      chain.has("insert") ? ok(null) : ok([{ email: "nowa@example.org" }]),
    );
    await provision({ pageSlug: "o-nas", autoLink: false });
    expect(db.chainsFor("user_invitations").some((chain) => chain.has("insert"))).toBe(false);
  });

  it("zapytanie o istniejące zaproszenia jest zawężone do NAJEMCY i adresów ze strony", async () => {
    // Adres z widgetu ma wielkie litery - do zapytania idzie postać
    // znormalizowana przez parser strony, tak jak dawniej w `eq("email", …)`.
    db.setResponse(
      "pages",
      ok({ id: IDS.page, builder_data: builderDoc([teamWidget({ email: "NOWA@Example.ORG" })]) }),
    );
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok(null)));
    await provision({ pageSlug: "o-nas", autoLink: false });
    const lookup = db.chainsFor("user_invitations").find((chain) => !chain.has("insert"));
    expect(lookup?.argsOf("select")).toEqual(["email"]);
    const eqArgs = lookup?.calls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(eqArgs).toEqual([["tenant_id", IDS.tenant]]);
    expect(lookup?.argsOf("in")).toEqual(["email", ["nowa@example.org"]]);
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
    // „Adres zajęty" bez konta w katalogu to ogólny kod - surowy komunikat
    // GoTrue nie trafia do panelu.
    expect(result.errors).toEqual([
      { email: "pierwsza@example.org", error: "account_create_failed" },
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

  // PRZERWANY IMPORT: konto z poprzedniego przebiegu, którego zapis profilu
  // padł, ma profil w najemcy domyślnym - `admin_list_users` go nie widzi,
  // a `createUser` odpowiada „adres zajęty" przy każdym ponowieniu.
  it("ponowiony import DOKAŃCZA konto narodzone dla tego najemcy zamiast padać na „adres zajęty”", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.authError = new Error("A user with this email address has already been registered");
    h.existingAuthUsers = [
      { id: IDS.existingUser, email: "nowa@example.org", app_metadata: { tenant_id: IDS.tenant } },
    ];
    h.existingProfileTenant = IDS.defaultTenant;
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result).toEqual({ created: 0, skipped: 1, linked: 0, errors: [] });
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
    for (const write of h.adminWrites) {
      expect(write.row).toMatchObject({ tenant_id: IDS.tenant });
    }
    expect(h.adminWrites[0].row).toMatchObject({ id: IDS.existingUser });
  });

  it("„adres zajęty” przez konto innej organizacji - neutralny kod odmowy, bez zapisów", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.authError = new Error("User already registered");
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.otherTenant;
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.errors).toEqual([
      { email: "nowa@example.org", error: "account_in_other_tenant" },
    ]);
    expect(h.adminWrites).toEqual([]);
  });

  it("błąd `createUser` inny niż „adres zajęty” nie przechodzi katalogu kont", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    db.setResponse("user_invitations", () => ok(null));
    h.authError = Object.assign(new Error("rate limit exceeded"), {
      code: "over_request_rate_limit",
      status: 429,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await provision({ pageSlug: "o-nas", autoLink: false });
      // Ogólny kod dla panelu (B3), szczegół wyłącznie w logu serwera.
      expect(result.errors).toEqual([
        { email: "nowa@example.org", error: "account_create_failed" },
      ]);
      expect(log).toHaveBeenCalledWith("[provisionTeamMembers] createUser failed", {
        code: "over_request_rate_limit",
        status: 429,
      });
    } finally {
      log.mockRestore();
    }
    expect(h.listUsersPages).toEqual([]);
    expect(h.adminWrites).toEqual([]);
  });

  it("kilka zajętych adresów w jednym imporcie czyta katalog kont JEDEN raz", async () => {
    // Bez pamięci na czas wywołania każda osoba przechodziła katalog od nowa.
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
    h.authError = new Error("User already registered");
    h.existingAuthUsers = [
      { id: "aaaa0000-0000-4000-8000-000000000001", email: "pierwsza@example.org" },
      { id: "aaaa0000-0000-4000-8000-000000000002", email: "druga@example.org" },
    ];
    h.existingProfileTenant = IDS.otherTenant;
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.errors.map((entry) => entry.error)).toEqual([
      "account_in_other_tenant",
      "account_in_other_tenant",
    ]);
    expect(h.listUsersPages).toEqual([{ page: 1, perPage: 200 }]);
  });

  it("konto założone przez INNE żądanie po pierwszym odczycie katalogu nie ginie w migawce", async () => {
    // `createUser` mówi „adres zajęty", a pamięć katalogu przeczytała już
    // stronę, na której to konto dziś leży. Pudło z migawki czyta katalog
    // jeszcze raz od pierwszej strony - inaczej import zgłosiłby
    // `account_create_failed` dla konta, które istnieje.
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
    h.authError = new Error("User already registered");
    h.existingAuthUsers = [
      { id: "aaaa0000-0000-4000-8000-000000000001", email: "pierwsza@example.org" },
    ];
    h.afterListUsers = () => {
      h.afterListUsers = null;
      h.existingAuthUsers.push({
        id: "aaaa0000-0000-4000-8000-000000000002",
        email: "druga@example.org",
      });
    };
    h.existingProfileTenant = IDS.otherTenant;
    const result = await provision({ pageSlug: "o-nas", autoLink: false });
    expect(result.errors.map((entry) => entry.error)).toEqual([
      "account_in_other_tenant",
      "account_in_other_tenant",
    ]);
    expect(h.listUsersPages).toEqual([
      { page: 1, perPage: 200 },
      { page: 1, perPage: 200 },
    ]);
  });

  it("dowiązanie bierze WYŁĄCZNIE profile tego najemcy - konto innej organizacji z tym adresem nie trafia na stronę", async () => {
    // Klucz serwisowy omija RLS, a `createUser` odmówił temu adresowi wyżej
    // („already registered"), bo konto należy do innego najemcy.
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }),
    );
    db.setResponse("user_invitations", () => ok(null));
    h.adminProfiles = [
      {
        id: IDS.existingUser,
        email: "nowa@example.org",
        slug: "obca-osoba",
        tenant_id: IDS.otherTenant,
      },
    ];
    const result = await provision({ pageSlug: "o-nas", autoLink: true });
    expect(result.linked).toBe(0);
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
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
    });
    // Slugu tu NIE MA - nadaje go baza (dowód i powód: sekcja 11).
    expect(profile).not.toHaveProperty("slug");
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

/** Strona z dwiema osobami - do dowodów „porażka jednej nie blokuje drugiej". */
function twoPeoplePage(): void {
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
}

/** Wiersze śladu audytowego (`user_invitations` ze statusem `accepted`), w kolejności. */
function provisionAuditInserts(): Record<string, unknown>[] {
  return db
    .chainsFor("user_invitations")
    .filter((chain) => chain.has("insert"))
    .map((chain) => chain.argsOf("insert")?.[0] as Record<string, unknown>);
}

async function provisionPage(
  data: Record<string, unknown> = { pageSlug: "o-nas", autoLink: false },
): Promise<{
  created: number;
  skipped: number;
  linked: number;
  errors: { email: string; error: string }[];
}> {
  return callServerFn(provisionTeamMembers, { data, context: context() });
}

// ---------------------------------------------------------------------------
// 9b. PROVISIONING: cel konfliktu roli i WYNIK zapisów hydracji.
// ---------------------------------------------------------------------------

describe("provisionTeamMembers - zapis roli i odmowa zapisu hydracji", () => {
  beforeEach(() => {
    grantAdmin();
    db.setResponse("user_invitations", () => ok(null));
  });

  it("upsert roli niesie TEN SAM cel konfliktu co wysyłka i wiersz z najemcą", async () => {
    // Druga kopia tego samego zapisu co w `performSend` - i ta sama pułapka:
    // `user_id,role` nie ma już indeksu unikalnego (42P10). Tu wynik nie był
    // nawet czytany, więc konta z provisioningu po cichu zostawały bez roli.
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    await provisionPage({ pageSlug: "o-nas", role: "editor", autoLink: false });
    const roleWrite = h.adminWrites.find((write) => write.table === "user_roles");
    expect(roleWrite?.options).toEqual({
      onConflict: "tenant_id,user_id,role",
      ignoreDuplicates: true,
    });
    expect(roleWrite?.row).toEqual({
      user_id: "aaaa1111-2222-4333-8444-555566667777",
      role: "editor",
      tenant_id: IDS.tenant,
    });
  });

  const NO_ARBITER =
    "there is no unique or exclusion constraint matching the ON CONFLICT specification";

  it.each([
    ["profiles", "profile_write_failed", ["profiles"]],
    ["author_profiles", "author_write_failed", ["profiles", "author_profiles"]],
    ["user_roles", "role_write_failed", ["profiles", "author_profiles", "user_roles"]],
  ] as const)(
    "odmowa zapisu `%s` ląduje w `errors` jako `%s:…`, bez dalszych zapisów tej osoby - druga osoba przechodzi",
    async (table, prefix, attempted) => {
      twoPeoplePage();
      // Odmowa TYLKO przy pierwszym zapisie do tabeli, czyli dla pierwszej
      // osoby; druga ma przejść całą hydrację.
      h.upsertErrorsOnce = { [table]: { message: NO_ARBITER } };
      const result = await provisionPage();

      expect(result.errors).toEqual([
        { email: "pierwsza@example.org", error: `${prefix}:${NO_ARBITER}` },
      ]);
      // Zapisy pierwszej osoby urywają się na odmowie; druga dostaje komplet.
      expect(h.adminWrites.map((write) => write.table)).toEqual([
        ...attempted,
        "profiles",
        "author_profiles",
        "user_roles",
      ]);
      expect(
        h.adminWrites
          .filter((write) => write.table === "profiles")
          .map((write) => (write.row as { email: string }).email),
      ).toEqual(["pierwsza@example.org", "druga@example.org"]);
      // Ślad `accepted` dostaje WYŁĄCZNIE osoba, której hydracja przeszła -
      // inaczej rekord audytowy twierdziłby, że konto jest gotowe.
      expect(provisionAuditInserts().map((row) => row.email)).toEqual(["druga@example.org"]);
      // `created` liczy konta auth: konto pierwszej osoby powstało (i zostaje),
      // nawet jeśli jej hydracja padła - stąd wpis w `errors` OBOK licznika.
      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
    },
  );

  it("odmowa zapisu przy ISTNIEJĄCYM koncie liczy osobę jako pominiętą i zgłasza błąd", async () => {
    db.setResponse("pages", ok({ id: IDS.page, builder_data: builderDoc([teamWidget()]) }));
    rpcUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.upsertErrors = { user_roles: { message: NO_ARBITER } };
    const result = await provisionPage();
    expect(result).toMatchObject({
      created: 0,
      skipped: 1,
      errors: [{ email: "nowa@example.org", error: `role_write_failed:${NO_ARBITER}` }],
    });
    expect(h.authCalls).toHaveLength(0);
    expect(provisionAuditInserts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9c. PROVISIONING: istniejące zaproszenia czytane PORCJAMI przed pętlą,
//     zamiast N+1 - i zamiast jednego GET-a, którego URL rośnie z zespołem.
// ---------------------------------------------------------------------------

describe("provisionTeamMembers - odczyt istniejących zaproszeń porcjami, przed pętlą osób", () => {
  beforeEach(() => {
    grantAdmin();
  });

  // Ta sama liczba co `INVITATION_LOOKUP_CHUNK_SIZE` w module - celowo
  // nieeksportowana, żeby nie poszerzać powierzchni modułu server functions.
  // Wynika z pomiaru długości URL-a (~52 znaki na adres), więc jej zmiana
  // tam ma być świadoma także tutaj.
  const CHUNK = 50;

  /** Strona z `n` osobami (`osoba<i>@example.org`); oddaje adresy w kolejności. */
  function bigTeamPage(n: number): string[] {
    const emails = Array.from({ length: n }, (_, i) => `osoba${i}@example.org`);
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc(
          emails.map((email, i) => teamWidget({ id: `w-${i}`, email, name: `Osoba ${i}` })),
        ),
      }),
    );
    return emails;
  }

  /** Listy adresów z kolejnych odczytów `user_invitations` (bez wstawień śladu). */
  function lookupBatches(): string[][] {
    return db
      .chainsFor("user_invitations")
      .filter((chain) => !chain.has("insert"))
      .map((chain) => chain.argsOf("in")?.[1] as string[]);
  }

  it("strona WIĘKSZA niż porcja: ceil(n/porcja) odczytów po najwyżej porcję adresów - trafienia z KAŻDEJ wyciszają ślad", async () => {
    // 2 * 50 + 1: dwie pełne porcje i reszta z jednego adresu - krawędź,
    // na której gubi się ostatnia osoba albo powstaje pusty odczyt.
    const emails = bigTeamPage(2 * CHUNK + 1);
    // Każda porcja oddaje jako „już zaproszony" swój OSTATNI adres. Gdyby
    // zbiór brał wynik tylko jednej porcji (np. pierwszej albo ostatniej),
    // osoby z pozostałych dostałyby drugi rekord śladu.
    db.setResponse("user_invitations", (chain) => {
      if (chain.has("insert")) return ok(null);
      const asked = chain.argsOf("in")?.[1] as string[];
      return ok([{ email: asked[asked.length - 1] }]);
    });
    const result = await provisionPage();
    expect(result.errors).toEqual([]);

    const batches = lookupBatches();
    expect(batches).toHaveLength(Math.ceil(emails.length / CHUNK));
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(CHUNK);
    // Razem dokładnie wszystkie adresy, każdy raz, w kolejności strony.
    expect(batches.flat()).toEqual(emails);
    // Każda porcja nadal zawężona do najemcy wywołującego.
    for (const chain of db.chainsFor("user_invitations").filter((c) => !c.has("insert"))) {
      expect(chain.calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
        ["tenant_id", IDS.tenant],
      ]);
    }

    const silenced = [emails[CHUNK - 1], emails[2 * CHUNK - 1], emails[2 * CHUNK]];
    expect(provisionAuditInserts().map((row) => row.email)).toEqual(
      emails.filter((email) => !silenced.includes(email)),
    );
  });

  it("awaria DRUGIEJ porcji odrzuca CAŁE wywołanie, zanim powstanie jakiekolwiek konto", async () => {
    // Pierwsza porcja przeszła i osoby z niej „wiadomo" - mimo to nikt nie
    // jest zakładany: pominięcie porcji, która padła, dałoby jej osobom dubel
    // śladu, a założonych kont nie da się już cofnąć.
    const emails = bigTeamPage(CHUNK + 1);
    db.setResponse("user_invitations", (chain) => {
      if (chain.has("insert")) return ok(null);
      const asked = chain.argsOf("in")?.[1] as string[];
      return asked.includes(emails[CHUNK]) ? fail("414 Request-URI Too Large") : ok([]);
    });
    await expect(provisionPage({ pageSlug: "o-nas", autoLink: true })).rejects.toThrow(
      "414 Request-URI Too Large",
    );
    expect(lookupBatches()).toHaveLength(2);
    expect(h.authCalls).toHaveLength(0);
    expect(h.adminWrites).toHaveLength(0);
    expect(provisionAuditInserts()).toHaveLength(0);
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
  });

  it("dowiązanie widgetów czyta profile TYMI SAMYMI porcjami i scala trafienia z każdej", async () => {
    // Odczyt profili do dowiązania też ma `.in("email", …)` w adresie GET -
    // jeden odczyt na stronę dawał na dużym zespole 414, a ten błąd nie był
    // czytany: konta powstawały, a wynik mówił `linked: 0`, `errors: []`.
    const emails = bigTeamPage(2 * CHUNK + 1);
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({
            id: IDS.page,
            builder_data: builderDoc(
              emails.map((email, i) => teamWidget({ id: `w-${i}`, email, name: `Osoba ${i}` })),
            ),
          }),
    );
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    // Każda porcja zna tylko SWÓJ pierwszy adres - wynik jednej porcji nie
    // wystarczy, żeby dowiązać wszystkie trzy osoby.
    h.adminProfilesFor = (asked) => [
      { id: `id-${asked[0]}`, email: asked[0], slug: `slug-${asked[0]}` },
    ];
    const result = await provisionPage({ pageSlug: "o-nas", autoLink: true });

    expect(result.errors).toEqual([]);
    expect(h.adminProfileEmailBatches).toHaveLength(Math.ceil(emails.length / CHUNK));
    for (const batch of h.adminProfileEmailBatches) {
      expect(batch.length).toBeLessThanOrEqual(CHUNK);
    }
    expect(h.adminProfileEmailBatches.flat()).toEqual(emails);
    expect(result.linked).toBe(3);
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(true);
  });

  it("awaria odczytu profili do dowiązania jest JAWNYM błędem - strona nie jest zapisywana", async () => {
    bigTeamPage(3);
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    h.adminProfilesError = { message: "414 Request-URI Too Large" };
    await expect(provisionPage({ pageSlug: "o-nas", autoLink: true })).rejects.toThrow(
      "link_lookup_failed:414 Request-URI Too Large",
    );
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
  });

  it("odmowa zapisu dowiązanej strony jest JAWNYM błędem, a nie `linked` bez skutku", async () => {
    const emails = bigTeamPage(1);
    db.setResponse("pages", (chain) =>
      chain.has("update")
        ? fail("new row violates row-level security policy")
        : ok({
            id: IDS.page,
            builder_data: builderDoc([
              teamWidget({ id: "w-0", email: emails[0], name: "Osoba 0" }),
            ]),
          }),
    );
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    h.adminProfiles = [{ id: IDS.existingUser, email: emails[0], slug: "osoba-0" }];
    await expect(provisionPage({ pageSlug: "o-nas", autoLink: true })).rejects.toThrow(
      "link_write_failed:new row violates row-level security policy",
    );
  });

  it("strona mieszcząca się w JEDNEJ porcji pyta `user_invitations` dokładnie RAZ", async () => {
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([
          teamWidget({ id: "w-1", email: "pierwsza@example.org", name: "Pierwsza" }),
          teamWidget({ id: "w-2", email: "druga@example.org", name: "Druga" }),
          teamWidget({ id: "w-3", email: "trzecia@example.org", name: "Trzecia" }),
        ]),
      }),
    );
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    const result = await provisionPage();
    expect(result.errors).toEqual([]);
    const lookups = db.chainsFor("user_invitations").filter((chain) => !chain.has("insert"));
    expect(lookups).toHaveLength(1);
    expect(lookups[0].argsOf("in")).toEqual([
      "email",
      ["pierwsza@example.org", "druga@example.org", "trzecia@example.org"],
    ]);
    expect(provisionAuditInserts().map((row) => row.email)).toEqual([
      "pierwsza@example.org",
      "druga@example.org",
      "trzecia@example.org",
    ]);
  });

  it("istniejące zaproszenie wycisza ślad TYLKO swojej osoby - hydracja idzie dla obu", async () => {
    twoPeoplePage();
    db.setResponse("user_invitations", (chain) =>
      chain.has("insert") ? ok(null) : ok([{ email: "pierwsza@example.org" }]),
    );
    const result = await provisionPage();
    expect(result.errors).toEqual([]);
    expect(provisionAuditInserts().map((row) => row.email)).toEqual(["druga@example.org"]);
    expect(h.adminWrites.map((write) => write.table)).toEqual([
      "profiles",
      "author_profiles",
      "user_roles",
      "profiles",
      "author_profiles",
      "user_roles",
    ]);
  });

  it("dwa widgety z tym samym adresem dają JEDEN rekord śladu", async () => {
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([
          teamWidget({ id: "w-1" }),
          teamWidget({ id: "w-2", email: "NOWA@example.org", name: "Nowa Osoba (kopia)" }),
        ]),
      }),
    );
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    await provisionPage();
    const inserts = provisionAuditInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ email: "nowa@example.org" });
    expect(inserts[0].metadata).toEqual({ widgetId: "w-1", provisioned: true });
  });

  it("awaria odczytu zaproszeń odrzuca CAŁE wywołanie, zanim powstanie jakiekolwiek konto", async () => {
    // Dawniej błąd odczytu czytał się jak „zaproszenia nie ma" i każdy dostawał
    // drugi rekord. Odmowa przed pętlą zostawia stan nietknięty - do ponowienia.
    twoPeoplePage();
    db.setResponse("user_invitations", (chain) =>
      chain.has("insert") ? ok(null) : fail("statement timeout"),
    );
    await expect(provisionPage({ pageSlug: "o-nas", autoLink: true })).rejects.toThrow(
      "statement timeout",
    );
    expect(h.authCalls).toHaveLength(0);
    expect(h.adminWrites).toHaveLength(0);
    expect(provisionAuditInserts()).toHaveLength(0);
    expect(db.chainsFor("pages").some((chain) => chain.has("update"))).toBe(false);
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
    expect(JSON.stringify(h.emails[0].details)).toContain(password);
  });
});

// ---------------------------------------------------------------------------
// 11. DEFEKT NAPRAWIONY: `slugify` transliteruje litery bez rozkładu Unicode.
// ---------------------------------------------------------------------------

describe("system zaproszeń - slug profilu autora", () => {
  // Było `it.fails`. `slugify` (`invitations.functions.ts`) robiło
  // `.normalize("NFD").replace(/\p{Diacritic}/gu, "")`. To działa dla znaków
  // ROZKŁADALNYCH (`ą ę ó ć ś ń ż ź` = litera + znak diakrytyczny), ale „ł"
  // i „Ł" (U+0142 / U+0141) rozkładu kanonicznego NIE MAJĄ - są osobnymi
  // literami. `NFD` ich nie ruszało, więc wpadały w `[^a-z0-9]+` i zamieniały
  // się w KRESKĘ. Naprawa: `replaceStrokeLetters` PRZED `NFD` - ta sama mapa,
  // której używa `slugifyTaxonomy`.
  //
  // Slug jest publicznym adresem profilu autora (`/author/<slug>`). `slugify`
  // liczy go już TYLKO w `performSend` (i tylko dla profilu bez sluga);
  // `provisionTeamMembers` nie wysyła sluga wcale i zostawia go bazie - patrz
  // ostatni test tej sekcji.
  it("„ł” staje się „l”, a nie dywizem - nazwisko nie jest okaleczone", async () => {
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

  it("„Ł” na POCZĄTKU nazwy nie znika - pierwsza litera adresu zostaje", async () => {
    // Najostrzejszy z przypadków: dywiz z krawędzi jest zdejmowany, więc przed
    // naprawą pierwsza litera ginęła bez śladu („Łukasz" -> `ukasz`).
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow({ display_name: "Łukasz Dąbrowski" })),
    );
    db.setResponse("audit_log", ok(null));
    await callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      slug: string;
    };
    expect(profile.slug).toBe("lukasz-dabrowski");
  });

  it("„ł” w środku wyrazu nie rozbija go na dwa człony", async () => {
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow({ display_name: "Małgorzata Wiśniewska" })),
    );
    db.setResponse("audit_log", ok(null));
    await callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      slug: string;
    };
    expect(profile.slug).toBe("malgorzata-wisniewska");
  });

  it("KONTO, KTÓRE JUŻ MA SLUG, zachowuje go - resend nie przenosi adresu autora", async () => {
    // Najważniejszy przypadek tej naprawy, i to on decyduje o jej zasięgu.
    // `performSend` robi UPSERT, który nadpisuje wymienione kolumny także przy
    // PONOWNYM wysłaniu zaproszenia. Gdyby slug był liczony z nazwy za każdym
    // razem, sama ta zmiana transliteracji przesunęłaby przy najbliższym
    // resendzie każdego „Michała" z `micha` na `michal` - zrywając
    // opublikowane linki, a przy kolizji wywracając cały resend na
    // `profiles_slug_unique`.
    grantAdmin();
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "nowa@example.org" }];
    h.existingProfileTenant = IDS.tenant;
    h.existingProfileSlug = "micha-kowalski";
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow({ display_name: "Michał Kowalski" })),
    );
    db.setResponse("audit_log", ok(null));
    await callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      slug: string;
    };
    expect(profile.slug).toBe("micha-kowalski");
  });

  it("transliteracja obejmuje też pozostałe litery bez rozkładu (ø, ß, đ)", async () => {
    // Katalog osób jest ogólnoeuropejski, a mapa `STROKE_LETTERS` obsługuje
    // całą tę klasę - nie samo „ł".
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow({ display_name: "Søren Weiß Đurić" })),
    );
    db.setResponse("audit_log", ok(null));
    await callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
    const profile = h.adminWrites.find((write) => write.table === "profiles")?.row as {
      slug: string;
    };
    expect(profile.slug).toBe("soren-weiss-duric");
  });

  it("provisioning NIE wysyła sluga - ani dla nowego konta, ani dla zastanego o zmienionej nazwie", async () => {
    // Dawniej `slug: slugify(d.name)` szło przy KAŻDYM przebiegu, a
    // `profiles_slug_unique` jest globalny: imiennik z dowolnego obszaru
    // wywracał osobę na `profile_write_failed` za każdym ponowieniem, a import
    // po zmianie nazwy w widgetcie przepisywał opublikowany adres autora.
    // Upsert JEDNEGO obiektu nie dotyka kolumn spoza jego kluczy, więc slug
    // nowego konta zostaje ten z `handle_new_user`, zastanego - nietknięty, a
    // profil osierocony dostaje unikalny z `profiles_0_ensure_slug_trg`
    // (sprawdzone na bazie z migracji - komentarz przy zapisie w module).
    // Asercja na KLUCZ, nie na wartość: `slug: null` też byłby błędem, bo
    // BEFORE INSERT `profiles_0_ensure_slug_trg` uzupełnia slug wiersza
    // proponowanego (EXCLUDED) z nowej nazwy, a `DO UPDATE SET slug =
    // EXCLUDED.slug` nadpisałby nim opublikowany adres.
    grantAdmin();
    db.setResponse(
      "pages",
      ok({
        id: IDS.page,
        builder_data: builderDoc([
          teamWidget({ id: "w-1", email: "nowa@example.org", name: "Michał Kowalski" }),
          teamWidget({ id: "w-2", email: "zastana@example.org", name: "Łucja Nowe Nazwisko" }),
        ]),
      }),
    );
    db.setResponse("user_invitations", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    rpcUsers = [{ id: IDS.existingUser, email: "zastana@example.org" }];
    const result = await callServerFn<{ created: number; skipped: number; errors: unknown[] }>(
      provisionTeamMembers,
      { data: { pageSlug: "o-nas", autoLink: false }, context: context() },
    );
    expect(result).toMatchObject({ created: 1, skipped: 1, errors: [] });
    const profileRows = h.adminWrites
      .filter((write) => write.table === "profiles")
      .map((write) => write.row as Record<string, unknown>);
    expect(profileRows.map((row) => row.id)).toEqual([
      "aaaa1111-2222-4333-8444-555566667777",
      IDS.existingUser,
    ]);
    for (const row of profileRows) expect(Object.keys(row)).not.toContain("slug");
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

describe("CRM company suggestions for invitations", () => {
  it.each([undefined, "", "  New%_  "])(
    "limits search to the administrator tenant (%s)",
    async (q) => {
      grantAdmin();
      db.setResponse("crm_companies", ok([{ id: "company", name: "New" }]));
      expect(await callServerFn(searchCrmCompanies, { data: { q }, context: context() })).toEqual({
        companies: [{ id: "company", name: "New" }],
      });
      const chain = db.chainsFor("crm_companies")[0];
      expect(chain.calls).toContainEqual({ method: "eq", args: ["tenant_id", IDS.tenant] });
      expect(chain.argsOf("limit")).toEqual([20]);
      if (q?.trim()) expect(chain.argsOf("ilike")).toEqual(["name", "%New%"]);
      else expect(chain.has("ilike")).toBe(false);
    },
  );
  it("returns an empty result for null data and propagates database errors", async () => {
    grantAdmin();
    db.setResponse("crm_companies", ok(null));
    expect(await callServerFn(searchCrmCompanies, { data: {}, context: context() })).toEqual({
      companies: [],
    });
    db.setResponse("crm_companies", fail("unavailable"));
    await expect(
      callServerFn(searchCrmCompanies, { data: {}, context: context() }),
    ).rejects.toThrow("unavailable");
  });
  it("reuses an existing company without inserting a duplicate", async () => {
    grantAdmin();
    db.setResponse("crm_companies", ok({ id: "company", name: "New" }));
    expect(
      await callServerFn(createCrmCompany, { data: { name: " New " }, context: context() }),
    ).toEqual({ id: "company", name: "New" });
    expect(db.chainsFor("crm_companies").some((c) => c.has("insert"))).toBe(false);
  });
  it("creates a missing company in the caller tenant and propagates insertion errors", async () => {
    grantAdmin();
    db.setResponse("crm_companies", (chain) =>
      chain.has("insert") ? ok({ id: "new-company", name: "New" }) : ok(null),
    );
    expect(
      await callServerFn(createCrmCompany, { data: { name: " New " }, context: context() }),
    ).toEqual({ id: "new-company", name: "New" });
    expect(db.chainsFor("crm_companies")[1].argsOf("insert")).toEqual([
      { tenant_id: IDS.tenant, name: "New", created_by: IDS.caller },
    ]);
    db.setResponse("crm_companies", (chain) =>
      chain.has("insert") ? fail("write denied") : ok(null),
    );
    await expect(
      callServerFn(createCrmCompany, { data: { name: "New" }, context: context() }),
    ).rejects.toThrow("write denied");
  });
});

describe("activation from the member directory", () => {
  function profile(result: SupabaseResult): void {
    grantAdmin();
    // `admin_get_user` zwraca TABLICĘ wierszy (zero albo jeden).
    adminGetUser = result.error ? result : ok(result.data === null ? [] : [result.data]);
  }
  it.each([fail("profile unavailable"), ok(null), ok({ email: "" })])(
    "rejects missing or unreadable recipient data",
    async (result) => {
      profile(result);
      await expect(
        callServerFn(sendActivationEmailForUser, {
          data: { userId: IDS.existingUser },
          context: context(),
        }),
      ).rejects.toThrow();
      expect(h.emails).toHaveLength(0);
    },
  );
  it("reads the recipient e-mail through admin_get_user, never select(email) on profiles", async () => {
    // `profiles.email` nie jest czytelne dla `authenticated` (grant kolumnowy) -
    // `select("email")` klientem admina kończył się w bazie 42501, a atrapa
    // tabeli go przyjmowała (kontrakt TS <-> SQL).
    profile(ok({ email: "member@example.org", display_name: "Member" }));
    db.setResponse("user_invitations", fail("stop after lookup"));
    await expect(
      callServerFn(sendActivationEmailForUser, {
        data: { userId: IDS.existingUser },
        context: context(),
      }),
    ).rejects.toThrow("stop after lookup");
    expect(rpcCalls.find((c) => c.name === "admin_get_user")?.args).toEqual({
      _user_id: IDS.existingUser,
    });
    expect(
      db.chainsFor("profiles").some((c) => String(c.argsOf("select")?.[0] ?? "").includes("email")),
    ).toBe(false);
  });
  it("propagates invitation lookup failure", async () => {
    profile(ok({ email: "member@example.org", display_name: "Member" }));
    db.setResponse("user_invitations", fail("lookup unavailable"));
    await expect(
      callServerFn(sendActivationEmailForUser, {
        data: { userId: IDS.existingUser },
        context: context(),
      }),
    ).rejects.toThrow("lookup unavailable");
  });
  /** Wiersz aktywacji w kształcie, jaki wstawia `sendActivationEmailForUser`. */
  function activationRow(overrides: Partial<InvitationRow> = {}): InvitationRow {
    return invitationRow({
      id: IDS.invitationB,
      email: "member@example.org",
      role: "editor",
      metadata: { activation_for_user_id: IDS.existingUser },
      auth_user_id: IDS.existingUser,
      ...overrides,
    });
  }

  /** Członek tego najemcy: konto z adresem profilu, profil u wołającego. */
  function memberAccount(authEmail = "member@example.org"): void {
    h.existingAuthUsers = [{ id: IDS.existingUser, email: authEmail }];
    h.existingProfileTenant = IDS.tenant;
  }

  const LOOKUP = "id, status, auth_user_id, role, metadata";
  /** Znacznik wiersza aktywacji TEGO członka. */
  const ACTIVATION_META = { activation_for_user_id: IDS.existingUser };

  it.each([
    null,
    {
      id: IDS.invitation,
      status: "accepted",
      auth_user_id: IDS.existingUser,
      role: "editor",
      metadata: { activation_for_user_id: IDS.existingUser },
    },
    // Wiersz przypięty do INNEGO konta (np. usuniętego) odmawiałby za każdym
    // razem - aktywacja zakłada świeży.
    {
      id: IDS.invitation,
      status: "failed",
      auth_user_id: IDS.otherTenant,
      role: "editor",
      metadata: { activation_for_user_id: IDS.otherTenant },
    },
    // `super_admin` zapisany przed bramką ról utknąłby na niej.
    {
      id: IDS.invitation,
      status: "failed",
      auth_user_id: IDS.existingUser,
      role: "super_admin",
      metadata: { activation_for_user_id: IDS.existingUser },
    },
    // ZWYKŁE zaproszenie tego członka (z dialogu albo importu) - przypięte, ale
    // bez znacznika aktywacji: `performSend` zhydratowałby nim profil.
    {
      id: IDS.invitation,
      status: "sent",
      auth_user_id: IDS.existingUser,
      role: "editor",
      metadata: { photo: "https://cdn.example/a.png" },
    },
    // Zwykłe zaproszenie na ten adres, jeszcze nieprzypięte.
    { id: IDS.invitation, status: "pending", auth_user_id: null, role: "author", metadata: {} },
  ])(
    "creates a new activation record when no reusable invitation exists (%j)",
    async (existing) => {
      profile(ok({ email: " MEMBER@example.org ", display_name: null }));
      memberAccount();
      db.setResponse("user_roles", (chain) =>
        chain.has("in") ? ok([{ role: "admin" }]) : ok([{ role: "editor" }]),
      );
      db.setResponse("user_invitations", (chain) =>
        chain.has("insert")
          ? ok({ id: IDS.invitationB })
          : chain.argsOf("select")?.[0] === LOOKUP
            ? ok(existing)
            : ok(activationRow()),
      );
      db.setResponse("audit_log", ok(null));
      const result = await callServerFn<{ ok: boolean }>(sendActivationEmailForUser, {
        data: { userId: IDS.existingUser },
        context: context(),
      });
      expect(result.ok).toBe(true);
      const inserted = db.chainsFor("user_invitations").find((c) => c.has("insert"));
      expect(inserted?.argsOf("insert")?.[0]).toMatchObject({
        tenant_id: IDS.tenant,
        email: "member@example.org",
        role: "editor",
        source: "admin_user_actions",
        auth_user_id: IDS.existingUser,
        metadata: { activation_for_user_id: IDS.existingUser },
      });
    },
  );

  it("aktywacja wysyła link, ale NIE nadpisuje profilu, profilu autora ani roli członka", async () => {
    // Metadane aktywacji nie niosą zdjęcia ani biogramu - upsert hydracji
    // wyzerowałby je osobie, która je ma (np. z importu zespołu), i wymusił
    // publiczny profil autora.
    profile(ok({ email: "member@example.org", display_name: "Member" }));
    memberAccount();
    db.setResponse("user_invitations", (chain) =>
      chain.argsOf("select")?.[0] === LOOKUP
        ? ok({
            id: IDS.invitationB,
            status: "sent",
            auth_user_id: IDS.existingUser,
            role: "editor",
            metadata: ACTIVATION_META,
          })
        : chain.has("update")
          ? ok(null)
          : ok(activationRow()),
    );
    db.setResponse("audit_log", ok(null));
    const result = await callServerFn<{ ok: boolean }>(sendActivationEmailForUser, {
      data: { userId: IDS.existingUser },
      context: context(),
    });
    expect(result.ok).toBe(true);
    expect(h.adminWrites).toEqual([]);
    expect(h.authCalls.some((call) => call.kind === "create")).toBe(false);
    expect(h.emails.map((mail) => mail.to)).toEqual(["member@example.org"]);
    expect(db.chainsFor("user_invitations").some((c) => c.has("insert"))).toBe(false);
  });

  it("aktywacja członka, który ma wyłącznie `super_admin`, przechodzi z etykietą `admin` i bez zapisu roli", async () => {
    // `change_user_role` usuwa role członka i wstawia jedną - po awansie jedynym
    // wierszem jest `super_admin`, a ta rola nie przechodzi bramki ról.
    profile(ok({ email: "member@example.org", display_name: "Member" }));
    memberAccount();
    db.setResponse("user_roles", (chain) =>
      chain.has("in") ? ok([{ role: "admin" }]) : ok([{ role: "super_admin" }]),
    );
    db.setResponse("user_invitations", (chain) =>
      chain.has("insert")
        ? ok({ id: IDS.invitationB })
        : chain.argsOf("select")?.[0] === LOOKUP
          ? ok(null)
          : ok(activationRow({ role: "admin" })),
    );
    db.setResponse("audit_log", ok(null));
    const result = await callServerFn<{ ok: boolean }>(sendActivationEmailForUser, {
      data: { userId: IDS.existingUser },
      context: context(),
    });
    expect(result.ok).toBe(true);
    expect(
      db
        .chainsFor("user_invitations")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ role: "admin" });
    expect(h.adminWrites).toEqual([]);
  });

  it("zwykłe zaproszenie członka NIE jest używane ponownie - aktywacja zakłada własny wiersz i niczego nie hydratuje", async () => {
    // Ponowne użycie zwykłego zaproszenia puszczało w `performSend` pełną
    // hydrację z JEGO metadanych - przy aktywacji zerowało członkowi biogram,
    // kontakt i linki.
    profile(ok({ email: "member@example.org", display_name: "Member" }));
    memberAccount();
    db.setResponse("user_invitations", (chain) =>
      chain.has("insert")
        ? ok({ id: IDS.invitationB })
        : chain.argsOf("select")?.[0] === LOOKUP
          ? ok({
              id: IDS.invitation,
              status: "sent",
              auth_user_id: IDS.existingUser,
              role: "author",
              metadata: { photo: "https://cdn.example/a.png" },
            })
          : chain.has("update")
            ? ok(null)
            : ok(activationRow()),
    );
    db.setResponse("audit_log", ok(null));
    const result = await callServerFn<{ ok: boolean }>(sendActivationEmailForUser, {
      data: { userId: IDS.existingUser },
      context: context(),
    });
    expect(result.ok).toBe(true);
    expect(db.chainsFor("user_invitations").some((c) => c.has("insert"))).toBe(true);
    // Żaden zapis nie dotknął cudzego (zwykłego) wiersza zaproszenia ani konta.
    const touched = db
      .chainsFor("user_invitations")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("eq")?.[1]);
    expect(touched).not.toContain(IDS.invitation);
    expect(h.adminWrites).toEqual([]);
  });

  it("wiersz zaproszenia szukany DOKŁADNIE po adresie, nie wzorcem `ilike`", async () => {
    // `_` i `%` w adresie są we wzorcu symbolami wieloznacznymi: `a_b@…`
    // wybierało zaproszenie `axb@…`.
    profile(ok({ email: "a_b@example.org", display_name: "A B" }));
    db.setResponse("user_invitations", fail("stop after lookup"));
    await expect(
      callServerFn(sendActivationEmailForUser, {
        data: { userId: IDS.existingUser },
        context: context(),
      }),
    ).rejects.toThrow("stop after lookup");
    const lookup = db.chainsFor("user_invitations")[0];
    expect(lookup.has("ilike")).toBe(false);
    expect(lookup.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "email",
      "a_b@example.org",
    ]);
  });

  it("aktywacja konta, którego adres logowania rozjechał się z `profiles.email` - odmowa bez maila (A2)", async () => {
    // Link logowania nie może pójść na adres, którego konto nie poświadcza.
    profile(ok({ email: "member@example.org", display_name: "Member" }));
    memberAccount("nowy-adres@example.org");
    db.setResponse("user_invitations", (chain) =>
      chain.argsOf("select")?.[0] === LOOKUP
        ? ok({
            id: IDS.invitationB,
            status: "failed",
            auth_user_id: IDS.existingUser,
            role: "editor",
            metadata: ACTIVATION_META,
          })
        : chain.has("update")
          ? ok(null)
          : ok(activationRow()),
    );
    db.setResponse("audit_log", ok(null));
    const result = await callServerFn<{ ok: boolean }>(sendActivationEmailForUser, {
      data: { userId: IDS.existingUser },
      context: context(),
    });
    expect(result).toMatchObject({ ok: false, error: "account_in_other_tenant" });
    expect(h.emails).toHaveLength(0);
    expect(h.authCalls).toEqual([]);
    expect(h.adminWrites).toEqual([]);
  });
});

describe("invitation delivery recovery branches", () => {
  function prepare(overrides: Partial<InvitationRow> = {}) {
    grantAdmin();
    db.setResponse("user_invitations", (chain) =>
      chain.has("update") ? ok(null) : ok(invitationRow(overrides)),
    );
  }
  it.each(["activation_send_limit_reached", "database unavailable"])(
    "does not send when the atomic claim fails (%s)",
    async (message) => {
      prepare();
      h.claimError = { message };
      const result = await callServerFn(sendInvitation, {
        data: { id: IDS.invitation },
        context: context(),
      });
      expect(result).toMatchObject({ ok: false, error: message, sendLimit: 5 });
      expect(h.emails).toHaveLength(0);
      expect(h.authCalls).toHaveLength(0);
    },
  );
  it("reuses an existing auth identity and skips contacts without email", async () => {
    prepare();
    h.existingAuthUsers = [
      { id: "invalid", email: null },
      { id: IDS.existingUser, email: "NOWA@example.org" },
    ];
    h.existingProfileTenant = IDS.tenant;
    const result = await callServerFn(sendInvitation, {
      data: { id: IDS.invitation },
      context: context(),
    });
    expect(result).toMatchObject({ ok: true });
    expect(h.authCalls.some((c) => c.kind === "create")).toBe(false);
  });

  // ---------------------------------------------------------------------
  // DEFEKT A2 NAPRAWIONY: katalog tożsamości był czytany JEDNĄ stroną.
  //
  // `listUsers` nie ma w tej wersji SDK filtru po adresie, a moduł pytał
  // wyłącznie o `{ page: 1, perPage: 200 }`. Od 201. konta istniejące konto
  // stawało się niewidoczne, sterowanie szło w `createUser`, GoTrue zwracał
  // „already been registered", wyjątek leciał do `catch` w `performSend`
  // i zaproszenie kończyło jako `failed`. Funkcja, która istnieje po to, żeby
  // nie zakładać duplikatu, przestawała działać dokładnie wtedy, kiedy
  // zaczynała być potrzebna.
  // ---------------------------------------------------------------------
  it("znajduje konto leżące na DRUGIEJ stronie katalogu i nie tworzy duplikatu", async () => {
    prepare();
    // 200 obcych kont wypełnia stronę pierwszą co do sztuki; szukane leży
    // zaraz za jej krawędzią.
    h.existingAuthUsers = [
      ...Array.from({ length: 200 }, (_, i) => ({
        id: `obce-${i}`,
        email: `obcy${i}@example.com`,
      })),
      { id: IDS.existingUser, email: "NOWA@example.org" },
    ];
    h.existingProfileTenant = IDS.tenant;

    const result = await callServerFn(sendInvitation, {
      data: { id: IDS.invitation },
      context: context(),
    });

    expect(result).toMatchObject({ ok: true });
    // Gałąź tworzenia konta NIE została tknięta - to jest istota naprawy.
    expect(h.authCalls.some((c) => c.kind === "create")).toBe(false);
    // I dowód mechanizmu: moduł faktycznie poprosił o drugą stronę.
    expect(h.listUsersPages.map((p) => p.page)).toEqual([1, 2]);
  });

  it("przestaje pytać na pierwszej niepełnej stronie - nie skanuje katalogu w kółko", async () => {
    prepare();
    h.existingAuthUsers = [{ id: "ktos-inny", email: "ktos@example.com" }];

    await callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });

    // Jedna strona, krótsza niż pełna, wystarcza za dowód „przeszliśmy całość".
    expect(h.listUsersPages).toEqual([{ page: 1, perPage: 200 }]);
  });

  it("awaria katalogu NIE czyta się jak „konta nie ma” - zaproszenie kończy jako `failed`", async () => {
    prepare();
    h.listUsersError = new Error("gotrue unavailable");

    const result = await callServerFn(sendInvitation, {
      data: { id: IDS.invitation },
      context: context(),
    });

    // Przed naprawą `error` było pomijane przy destrukturyzacji, więc awaria
    // katalogu wyglądała jak pusty katalog i prowadziła prosto w `createUser`.
    expect(result).toMatchObject({ ok: false });
    expect(h.authCalls.some((c) => c.kind === "create")).toBe(false);
  });
  it.each([false, true])("falls back from invite to magic link (hashed %s)", async (hashed) => {
    prepare();
    h.inviteLinkFails = true;
    h.hashedToken = hashed ? "token/value" : null;
    const result = await callServerFn(sendInvitation, {
      data: { id: IDS.invitation },
      context: context(),
    });
    expect(result).toMatchObject({ ok: true });
    expect(h.authCalls.map((c) => c.kind)).toContain("link:magiclink");
    expect(h.emails[0].ctaUrl).toContain(hashed ? "token=token%2Fvalue&type=invite" : "token=abc");
  });
  it.each([undefined, "Analyst"])(
    "includes the selected organization in the invitation (%s)",
    async (job_title) => {
      prepare({ metadata: { company_name: "Fundacja New European Strategies", job_title } });
      await callServerFn(sendInvitation, { data: { id: IDS.invitation }, context: context() });
      expect(h.emails[0].details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: job_title
              ? "Fundacja New European Strategies - Analyst"
              : "Fundacja New European Strategies",
          }),
        ]),
      );
    },
  );
  it("reports password identity provisioning errors without sending mail", async () => {
    prepare({ mode: "password" });
    h.authError = new Error("auth unavailable");
    const result = await callServerFn(sendInvitation, {
      data: { id: IDS.invitation },
      context: context(),
    });
    expect(result).toMatchObject({ ok: false, error: "auth unavailable" });
    expect(h.emails).toHaveLength(0);
  });
});

describe("activation record persistence failures", () => {
  function profileReady() {
    grantAdmin();
    adminGetUser = ok([{ email: "member@example.org", display_name: "Member" }]);
  }
  it("propagates role lookup failure before creating an activation record", async () => {
    profileReady();
    db.setResponse("user_invitations", ok(null));
    // `assertAdmin` pyta o role administracyjne (`.in`), aktywacja o role
    // członka (bez `.in`).
    db.setResponse("user_roles", (chain) =>
      chain.has("in") ? ok([{ role: "admin" }]) : fail("roles unavailable"),
    );
    await expect(
      callServerFn(sendActivationEmailForUser, {
        data: { userId: IDS.existingUser },
        context: context(),
      }),
    ).rejects.toThrow("roles unavailable");
    expect(h.emails).toHaveLength(0);
  });
  it.each([fail("insert unavailable"), ok(null)])(
    "rejects a missing activation record after insertion",
    async (insertion) => {
      profileReady();
      db.setResponse("user_roles", (chain) =>
        chain.has("in") ? ok([{ role: "admin" }]) : ok(null),
      );
      db.setResponse("user_invitations", (chain) => (chain.has("insert") ? insertion : ok(null)));
      await expect(
        callServerFn(sendActivationEmailForUser, {
          data: { userId: IDS.existingUser },
          context: context(),
        }),
      ).rejects.toThrow(insertion.error?.message ?? "invitation_create_failed");
      expect(
        db
          .chainsFor("user_invitations")
          .find((c) => c.has("insert"))
          ?.argsOf("insert")?.[0],
      ).toMatchObject({ role: "user" });
      expect(h.emails).toHaveLength(0);
    },
  );
  it("reuses a pending invitation and reports a failed activation-link fallback", async () => {
    profileReady();
    h.linkError = new Error("link service unavailable");
    h.existingAuthUsers = [{ id: IDS.existingUser, email: "member@example.org" }];
    h.existingProfileTenant = IDS.tenant;
    db.setResponse("user_invitations", (chain) =>
      chain.argsOf("select")?.[0] === "id, status, auth_user_id, role, metadata"
        ? ok({
            id: IDS.invitation,
            status: "pending",
            auth_user_id: IDS.existingUser,
            role: "user",
            metadata: { activation_for_user_id: IDS.existingUser },
          })
        : chain.has("update")
          ? ok(null)
          : ok(invitationRow({ email: "member@example.org", auth_user_id: IDS.existingUser })),
    );
    const result = await callServerFn(sendActivationEmailForUser, {
      data: { userId: IDS.existingUser },
      context: context(),
    });
    expect(result).toMatchObject({ ok: false, error: "link_failed:link service unavailable" });
    expect(db.chainsFor("user_invitations").some((c) => c.has("insert"))).toBe(false);
    expect(h.emails).toHaveLength(0);
  });
});
