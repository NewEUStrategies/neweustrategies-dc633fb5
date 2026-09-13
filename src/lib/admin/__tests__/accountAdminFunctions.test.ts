// ADMINISTRACJA CUDZYM KONTEM - WARSTWA SERWEROWA
// (`src/lib/admin/accountAdmin.functions.ts`).
//
// CO TEN PLIK DOWODZI I DLACZEGO WŁAŚNIE TO. Obie funkcje pracują KLUCZEM
// SERWISOWYM (`supabaseAdmin`), czyli poza RLS: jedna czyta stan konta
// w warstwie auth, druga NIEODWRACALNIE je usuwa. Przedmiotem dowodu jest
// więc GRANICA NAJEMCY, a nie kształt odpowiedzi:
//
//   1. `assertSameTenant()` porównuje tenant wywołującego z tenantem konta
//      docelowego i przed tym porównaniem NIE MA żadnej gałęzi wcześniejszego
//      zwrotu. Regresja, którą przypinamy: do niedawna `has_role(super_admin)`
//      kończyło funkcję zanim tenanty w ogóle zostały porównane, więc super
//      admin tenanta A czytał status i usuwał konta w tenancie B. `has_role()`
//      jest równie tenantowe co reszta bramek (migracja 20260625160054), więc
//      ta gałąź nigdy nie mówiła o tym, o czym komentarz obok niej twierdził.
//   2. ODMOWA WYPRZEDZA PRACĘ: przy odmowie handler NIE dotyka warstwy auth
//      (żadnego `getUserById`, żadnego `deleteUser`) i nie zamyka rozliczeń.
//      Usunięcie konta jest nieodwracalne - kolejność jest tu regułą.
//   3. BRAK WYROCZNI: „nie ma takiego profilu" i „profil w innym tenancie"
//      dają IDENTYCZNY kod błędu. Inaczej funkcja potwierdzałaby istnienie
//      identyfikatora w cudzej organizacji.
//
// CZEGO TEN HARNESS NIE UDAJE - I DLACZEGO TO NIE JEST LUKA.
// `@/test/serverFnHarness` NIE URUCHAMIA middleware, więc „kto w ogóle może
// wywołać tę funkcję" jest tu dowodzone wyłącznie jako DEKLARACJA
// `requireAdmin` na obu eksportach (sekcja 1); kompletności zestawu middleware
// pilnuje bramka `check:authz-snapshot`. Tego, czy `current_tenant_id()`
// i RLS mówią prawdę, dowodzą testy pgTAP - na atrapie nie ma RLS.
//
// RODO: żadnych realnych danych osobowych - adresy wyłącznie w `example.com`,
// identyfikatory umowne.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseFromStub } from "@/test/supabaseChain";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

/** Odpowiedź `auth.admin.getUserById` w kształcie, jaki czyta handler. */
interface AdminUserResponse {
  data: { user: Record<string, unknown> | null } | null;
  error: { message?: string } | null;
}

const h = vi.hoisted(() => ({
  /** Atrapa zapytań KLUCZEM SERWISOWYM (`supabaseAdmin.from`). */
  admin: null as SupabaseFromStub | null,
  /** Kroki warstwy auth w KOLEJNOŚCI wywołania - z argumentami. */
  authCalls: [] as { step: "getUserById" | "deleteUser"; args: unknown }[],
  /** Kroki zamknięcia konta poza auth (rozliczenia, retencja dowodów). */
  billingCalls: [] as { step: "closeBilling" | "retainEvidence"; args: unknown }[],
  userResponse: null as AdminUserResponse | null,
  deleteError: null as { message: string } | null,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
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
        deleteUser: (userId: string) => {
          h.authCalls.push({ step: "deleteUser", args: userId });
          return Promise.resolve({ data: null, error: h.deleteError });
        },
      },
    },
    from: (table: string) => {
      if (!h.admin) throw new Error("test: atrapa klucza serwisowego nieustawiona");
      return h.admin.from(table);
    },
  },
}));

vi.mock("@/lib/billing/accountClosure.server", () => ({
  closeBillingForUser: (userId: string, email: string) => {
    h.billingCalls.push({ step: "closeBilling", args: { userId, email } });
    return Promise.resolve();
  },
}));

vi.mock("@/lib/billing/accountingRetention.server", () => ({
  retainAccountingEvidence: (userId: string) => {
    h.billingCalls.push({ step: "retainEvidence", args: userId });
    return Promise.resolve({ retainedTotal: 3 });
  },
}));

import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";
import {
  ADMIN_ACCOUNT_ERROR,
  deleteUserAccount,
  getUserAccountStatus,
} from "@/lib/admin/accountAdmin.functions";

const IDS = {
  caller: "11111111-1111-4111-8111-111111111111",
  target: "22222222-2222-4222-8222-222222222222",
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherTenant: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;

const TARGET_EMAIL = "cel.administracji@example.com";

/** Atrapa zapytań klienta RLS (kontekst wywołującego). */
let rls: SupabaseFromStub;
/** Wywołania RPC klienta wywołującego - nazwa + argumenty. */
let rpcCalls: { name: string; args: unknown }[] = [];
/** Wynik RPC. Domyślnie `true`: „wywołujący JEST super adminem w swoim tenancie". */
let rpcResult: { data: unknown; error: { message: string } | null } = { data: true, error: null };

function admin(): SupabaseFromStub {
  const value = h.admin;
  if (!value) throw new Error("test: atrapa klucza serwisowego nieustawiona");
  return value;
}

/**
 * Przechwytuje odmowę handlera jako WARTOŚĆ - asercja na treści komunikatu nie
 * wymaga wtedy rzutowania na typ błędu.
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

function context(userId: string = IDS.caller): ServerFnContext {
  return {
    supabase: {
      from: (table: string) => rls.from(table),
      rpc: (name: string, args?: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
    },
    userId,
  };
}

/**
 * Ustawia oba odczyty profilu. Atrapy REALNIE FILTRUJĄ: responder czyta
 * zapisane ogniwo `.eq()` i odpowiada tylko na identyfikator, o który handler
 * naprawdę zapytał - dzięki temu test o „profilu celu" nie przechodzi
 * przypadkiem na odpowiedzi przygotowanej dla wywołującego.
 */
function profiles(
  options: {
    caller?: SupabaseResult;
    target?: SupabaseResult;
    callerTenant?: string | null;
    targetTenant?: string | null;
  } = {},
): void {
  const callerRow = options.caller ?? ok({ tenant_id: options.callerTenant ?? IDS.tenant });
  const targetRow =
    options.target ??
    ok({ id: IDS.target, email: TARGET_EMAIL, tenant_id: options.targetTenant ?? IDS.tenant });

  admin().setResponse("profiles", (chain) => {
    const [, id] = chain.argsOf("eq") ?? [];
    if (id !== IDS.target) {
      return fail(`test: klucz serwisowy zapytał o nieoczekiwany profil "${String(id)}"`);
    }
    return targetRow;
  });
  rls.setResponse("profiles", (chain) => {
    const [, id] = chain.argsOf("eq") ?? [];
    if (id !== IDS.caller) {
      return fail(`test: klient RLS zapytał o nieoczekiwany profil "${String(id)}"`);
    }
    return callerRow;
  });
  rls.setResponse("user_invitations", ok(null));
}

/** Konto w warstwie auth - istniejące, z potwierdzonym adresem. */
function authAccount(email: string | null = TARGET_EMAIL): void {
  h.userResponse = {
    data: {
      user: {
        email,
        email_confirmed_at: relativeIso(-134 * DZIEN),
        last_sign_in_at: relativeIso(-106 * DZIEN),
        created_at: relativeIso(-165 * DZIEN),
        app_metadata: { provider: "email" },
        factors: [],
      },
    },
    error: null,
  };
}

function statusInput(userId: string = IDS.target): Record<string, unknown> {
  return { userId };
}

function deleteInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { userId: IDS.target, confirmEmail: TARGET_EMAIL, ...overrides };
}

beforeEach(() => {
  h.admin = supabaseFromStub();
  h.authCalls = [];
  h.billingCalls = [];
  h.userResponse = null;
  h.deleteError = null;
  rls = supabaseFromStub();
  rpcCalls = [];
  rpcResult = { data: true, error: null };
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA FUNKCJI - bramka i walidator wejścia.
// ---------------------------------------------------------------------------
// Zegar zamrozony NA CALY PLIK: daty konta ponizej sa liczone WZGLEDEM
// zamrozonego "teraz", wiec test nie jest opozniony - nie zacznie padac
// w dniu, w ktorym literal wypadnie z okna liczonego z Date.now().
freezeClock();

describe("accountAdmin.functions - obudowa", () => {
  it("obie funkcje deklarują requireAdmin", () => {
    expect(serverFnMiddlewareNames(getUserAccountStatus)).toContain("requireAdmin");
    expect(serverFnMiddlewareNames(deleteUserAccount)).toContain("requireAdmin");
  });

  it("odrzuca identyfikator, który nie jest uuid", () => {
    expect(() => validateServerFnInput(getUserAccountStatus, { userId: "nie-uuid" })).toThrow();
    expect(() =>
      validateServerFnInput(deleteUserAccount, { userId: "nie-uuid", confirmEmail: TARGET_EMAIL }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. GRANICA NAJEMCY - odczyt statusu konta.
// ---------------------------------------------------------------------------
describe("getUserAccountStatus - granica najemcy", () => {
  it("odmawia, gdy konto docelowe jest w INNYM tenancie", async () => {
    profiles({ targetTenant: IDS.otherTenant });

    const err = await rejection(() =>
      callServerFn(getUserAccountStatus, { data: statusInput(), context: context() }),
    );

    expect(errorMessage(err)).toBe(ADMIN_ACCOUNT_ERROR.outsideTenant);
  });

  it("TEST REGRESJI: rola super_admin NIE omija granicy najemcy", async () => {
    // Wywołujący jest super adminem we WŁASNYM tenancie (`has_role` zwróciłoby
    // `true`), a mimo to konto z obcego tenanta zostaje poza jego zasięgiem.
    // Wcześniej właśnie tu funkcja kończyła się wcześniejszym zwrotem.
    rpcResult = { data: true, error: null };
    profiles({ targetTenant: IDS.otherTenant });

    const err = await rejection(() =>
      callServerFn(getUserAccountStatus, { data: statusInput(), context: context() }),
    );

    expect(errorMessage(err)).toBe(ADMIN_ACCOUNT_ERROR.outsideTenant);
    // Odmowa wyprzedza pracę: konto celu nie zostało w ogóle odczytane.
    expect(h.authCalls).toEqual([]);
  });

  it("nie pyta o `has_role` - granica nie zna wyjątku dla roli", async () => {
    profiles({ targetTenant: IDS.otherTenant });

    await rejection(() =>
      callServerFn(getUserAccountStatus, { data: statusInput(), context: context() }),
    );

    expect(rpcCalls.map((call) => call.name)).toEqual([]);
  });

  it("na brak profilu celu i na obcy tenant odpowiada IDENTYCZNIE", async () => {
    profiles({ target: ok(null) });
    const brakProfilu = errorMessage(
      await rejection(() =>
        callServerFn(getUserAccountStatus, { data: statusInput(), context: context() }),
      ),
    );

    h.admin = supabaseFromStub();
    rls = supabaseFromStub();
    profiles({ targetTenant: IDS.otherTenant });
    const obcyTenant = errorMessage(
      await rejection(() =>
        callServerFn(getUserAccountStatus, { data: statusInput(), context: context() }),
      ),
    );

    // Identyczność komunikatów jest tu dowodem: inaczej funkcja byłaby
    // wyrocznią potwierdzającą istnienie identyfikatora w cudzym tenancie.
    expect(brakProfilu).toBe(obcyTenant);
    expect(obcyTenant).toBe(ADMIN_ACCOUNT_ERROR.outsideTenant);
  });

  it.each([
    ["profil wywołującego bez tenanta", ok({ tenant_id: null }), ADMIN_ACCOUNT_ERROR.outsideTenant],
    ["brak wiersza profilu wywołującego", ok(null), ADMIN_ACCOUNT_ERROR.outsideTenant],
    [
      "odczyt profilu wywołującego padł",
      fail("connection reset"),
      ADMIN_ACCOUNT_ERROR.lookupFailed,
    ],
  ])("odmawia, gdy %s", async (_tytul, callerRow, expected) => {
    profiles({ caller: callerRow });

    const err = await rejection(() =>
      callServerFn(getUserAccountStatus, { data: statusInput(), context: context() }),
    );

    expect(errorMessage(err)).toBe(expected);
    expect(h.authCalls).toEqual([]);
  });

  it("odmawia, gdy odczyt profilu celu padł", async () => {
    profiles({ target: fail("connection reset") });

    const err = await rejection(() =>
      callServerFn(getUserAccountStatus, { data: statusInput(), context: context() }),
    );

    expect(errorMessage(err)).toBe(ADMIN_ACCOUNT_ERROR.lookupFailed);
    expect(h.authCalls).toEqual([]);
  });

  it("czyta profil celu KLUCZEM SERWISOWYM, a profil wywołującego klientem RLS", async () => {
    profiles();
    authAccount();

    await callServerFn(getUserAccountStatus, { data: statusInput(), context: context() });

    const [targetChain] = admin().chainsFor("profiles");
    expect(targetChain.argsOf("eq")).toEqual(["id", IDS.target]);
    expect(targetChain.argsOf("select")).toEqual(["id, email, tenant_id"]);

    const [callerChain] = rls.chainsFor("profiles");
    expect(callerChain.argsOf("eq")).toEqual(["id", IDS.caller]);
    expect(callerChain.argsOf("select")).toEqual(["tenant_id"]);
  });

  it("ścieżka zgodna: oba profile w tym samym tenancie - zwraca status konta", async () => {
    profiles();
    authAccount();

    const status = await callServerFn<{ exists: boolean; email: string | null; state: string }>(
      getUserAccountStatus,
      { data: statusInput(), context: context() },
    );

    expect(status.exists).toBe(true);
    expect(status.email).toBe(TARGET_EMAIL);
    expect(status.state).toBe("active");
    expect(h.authCalls).toEqual([{ step: "getUserById", args: IDS.target }]);
  });
});

// ---------------------------------------------------------------------------
// 3. GRANICA NAJEMCY - usunięcie konta (nieodwracalne).
// ---------------------------------------------------------------------------
describe("deleteUserAccount - granica najemcy", () => {
  it("TEST REGRESJI: super admin NIE usuwa konta z obcego tenanta", async () => {
    rpcResult = { data: true, error: null };
    profiles({ targetTenant: IDS.otherTenant });

    const err = await rejection(() =>
      callServerFn(deleteUserAccount, { data: deleteInput(), context: context() }),
    );

    expect(errorMessage(err)).toBe(ADMIN_ACCOUNT_ERROR.outsideTenant);
    // Najważniejsza asercja pliku: nic nieodwracalnego się NIE wydarzyło.
    expect(h.authCalls).toEqual([]);
    expect(h.billingCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("odmawia usunięcia samego siebie, zanim dotknie profilu celu", async () => {
    const err = await rejection(() =>
      callServerFn(deleteUserAccount, {
        data: deleteInput({ userId: IDS.caller }),
        context: context(),
      }),
    );

    expect(errorMessage(err)).toBe(ADMIN_ACCOUNT_ERROR.selfDelete);
    expect(admin().chains).toEqual([]);
  });

  it("odmawia, gdy potwierdzenie adresem się nie zgadza", async () => {
    profiles();
    authAccount();

    const err = await rejection(() =>
      callServerFn(deleteUserAccount, {
        data: deleteInput({ confirmEmail: "kto.inny@example.com" }),
        context: context(),
      }),
    );

    expect(errorMessage(err)).toBe(ADMIN_ACCOUNT_ERROR.confirmMismatch);
    expect(h.authCalls).toEqual([{ step: "getUserById", args: IDS.target }]);
    expect(h.billingCalls).toEqual([]);
  });

  it("ścieżka zgodna: ten sam tenant - zamyka rozliczenia i usuwa konto", async () => {
    profiles();
    authAccount();

    const result = await callServerFn<{ ok: true; retainedEvidence: number }>(deleteUserAccount, {
      data: deleteInput(),
      context: context(),
    });

    expect(result).toEqual({ ok: true, retainedEvidence: 3 });
    expect(h.billingCalls.map((call) => call.step)).toEqual(["closeBilling", "retainEvidence"]);
    expect(h.authCalls.at(-1)).toEqual({ step: "deleteUser", args: IDS.target });
  });
});
