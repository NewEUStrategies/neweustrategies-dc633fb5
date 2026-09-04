// BRAMKA AUTORYZACJI STAFF: ciało `roleMiddleware` z `require-staff.ts`.
//
// PO CO TEN PLIK ISTNIEJE. `require-staff.ts` jest importowany przez 46 plików
// produkcyjnych i do 04.09.2026 miał 0,00% GAŁĘZI: 9/30 linii, 1/2 funkcji.
// Pokryta była sama FABRYKA (woła się cztery razy na poziomie modułu), a ciało
// `.server(async ...)` - czyli KAŻDA ścieżka odmowy - nie wykonało się ani raz.
//
// Zero nie brało się z braku testów, a z ich rodzaju: `@/integrations/supabase/
// require-staff` jest podmieniany na atrapę w 39 plikach testowych. Te testy
// sprawdzają, KTÓRA bramka stoi przy której funkcji serwerowej (i to jest
// wartościowe - tego samego pilnuje `check:authz-snapshot`), ale żaden z nich
// nie może zobaczyć, CO ta bramka robi. `AUTHZ_SNAPSHOT` też nie: jego 63 wpisy
// `roleGates` są typu `"kind":"function"` z plikami `.sql`, czyli pilnują ról
// W BAZIE, nie ciała middleware w TypeScripcie.
//
// Jednym zdaniem: platforma weryfikowała, KTÓRA bramka stoi przy której
// funkcji, i nie weryfikowała, CO ta bramka robi. Ten plik zamyka drugą połowę.
//
// CO JEST PRZEDMIOTEM DOWODU. Siedem niezależnych ścieżek odmowy, każda
// z osobnym komunikatem - i komunikat JEST przedmiotem asercji, bo to on
// trafia do klienta i po nim rozpoznaje się przyczynę odmowy:
//   1. błąd odczytu profilu        -> `Forbidden: could not verify <label> (...)`
//   2. brak `profile.tenant_id`    -> `Forbidden: <label> required`
//   3. błąd odczytu roli           -> `Forbidden: could not verify <label> (...)`
//   4. pusta lista roli            -> `Forbidden: <label> required`
//   5. `aal !== "aal2"`            -> wejście w sprawdzenie MFA (nie odmowa)
//   6. błąd RPC `has_verified_mfa` -> `Forbidden: could not verify MFA status (...)`
//   7. `hasMfa === true` przy aal<2 -> `Forbidden: mfa_required - ...`
//
// Punkt 7 jest najgroźniejszy z całej siódemki: to reguła „użytkownik, który MA
// zweryfikowany drugi czynnik, MUSI go przedstawić, żeby zmutować treść".
// Odwrócenie warunku na `hasMfa === false` przechodziło CI na zielono i cicho
// wyłączało wymuszanie MFA dla CAŁEGO panelu.
//
// REGUŁA TEGO PLIKU: NIE ATRAPUJE MODUŁU, KTÓRY POKRYWA. Podmieniona jest
// wyłącznie fabryka `createMiddleware` z frameworka (`@/test/middlewareHarness`),
// bo bez niej ciało middleware jest niewywoływalne z testu - to instrument
// pomiarowy, nie zastępstwo dowodu. `roleMiddleware`, `STAFF_ROLES`,
// `CRM_STAFF_ROLES`, `ADMIN_ROLES`, składanie komunikatów i kolejność zapytań
// są PRAWDZIWE.
//
// WIERNOŚĆ ATRAPY KLIENTA JEST WARUNKIEM SENSU DOWODU. Atrapa `user_roles`
// symuluje FILTROWANIE PostgREST (`.eq("user_id")`, `.eq("tenant_id")`,
// `.in("role")`) na małej tabeli wierszy, a nie zwraca stałej odpowiedzi.
// Bez tego dowód o różnicy zestawów ról byłby fikcją: stała odpowiedź
// „jest rola" sprawiłaby, że `requireCrmStaff` przepuszcza autora tak samo jak
// `requireStaff`, i test przeszedłby, choć produkcja odrzuca. Ta sama uwaga
// dotyczy zawężenia najemcą - rola z innego `tenant_id` MUSI wypaść przez
// filtr, nie przez uprzejmość atrapy.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/middlewareHarness")).middlewareCaptureMock(),
);

import {
  attemptMiddleware,
  capturedServer,
  declaredMiddleware,
  middlewarePassThrough,
  runMiddleware,
  type MiddlewareOutcome,
} from "@/test/middlewareHarness";
import { supabaseFromStub, fail, ok, type SupabaseResult } from "@/test/supabaseChain";
import { requireSupabaseAuth } from "../auth-middleware";
import { requireAdmin, requireAdminEditor, requireCrmStaff, requireStaff } from "../require-staff";

// --- dane syntetyczne (RODO: żadnych prawdziwych identyfikatorów) -----------

const USER = "00000000-0000-4000-8000-000000000001";
const TENANT = "00000000-0000-4000-8000-0000000000aa";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000bb";

/** Wiersz `public.user_roles` w kształcie, jaki czyta middleware. */
interface RoleRow {
  user_id: string;
  tenant_id: string;
  role: string;
}

interface Harness {
  supabase: { from: (table: string) => unknown; rpc: ReturnType<typeof vi.fn> };
  /** Łańcuchy PostgREST zapisane przez atrapę - do asercji o filtrach. */
  stub: ReturnType<typeof supabaseFromStub>;
}

/**
 * Klient w kontekście middleware. `profiles` i `user_roles` odpowiadają jak
 * PostgREST (filtry naprawdę filtrują), `rpc` jest szpiegiem - dowód „RPC MFA
 * nie zostało zawołane" wymaga LICZBY wywołań, nie wyniku.
 */
function harness(opts: {
  profile?: SupabaseResult;
  roles?: RoleRow[];
  rolesError?: SupabaseResult;
  mfa?: { data?: unknown; error?: { message: string; code?: string } | null };
}): Harness {
  const stub = supabaseFromStub();
  stub.setResponse(
    "profiles",
    opts.profile ?? ok({ tenant_id: TENANT } as Record<string, unknown>),
  );
  stub.setResponse("user_roles", (chain) => {
    if (opts.rolesError) return opts.rolesError;
    // Symulacja filtrów PostgREST. `eq` występuje dwa razy (user_id, tenant_id),
    // więc czytamy WSZYSTKIE ogniwa `eq`, nie pierwsze.
    const eqs = chain.calls
      .filter((c) => c.method === "eq")
      .map((c) => [String(c.args[0]), String(c.args[1])] as const);
    const allowed = (chain.argsOf("in")?.[1] ?? []) as readonly string[];
    const rows = (opts.roles ?? []).filter((row) => {
      for (const [column, value] of eqs) {
        if (column === "user_id" && row.user_id !== value) return false;
        if (column === "tenant_id" && row.tenant_id !== value) return false;
      }
      return allowed.includes(row.role);
    });
    return ok(rows.map((r) => ({ role: r.role })));
  });
  const rpc = vi.fn(async () => ({
    data: opts.mfa?.data ?? null,
    error: opts.mfa?.error ?? null,
  }));
  return { supabase: { from: stub.from, rpc }, stub };
}

/** Kontekst, jaki wstrzykuje `requireSupabaseAuth`. `aal2` = drugi czynnik OK. */
function context(h: Harness, aal?: string): Record<string, unknown> {
  return { supabase: h.supabase, userId: USER, claims: aal ? { aal } : {} };
}

/**
 * Odmowa autoryzacji jest WYJĄTKIEM. `attemptMiddleware` zwraca go w `error`
 * ZAMIAST rzucać, więc zapis wywołań `next()` przeżywa odmowę - bez tego
 * zdania „odmowa nastąpiła PRZED handlerem" nie da się udowodnić, bo rzut
 * zabiera ze sobą jedyny ślad tego, czy handler ruszył.
 */
async function attemptDenial(
  value: unknown,
  ctx: Record<string, unknown>,
): Promise<MiddlewareOutcome> {
  const outcome = await attemptMiddleware(value, { context: ctx });
  if (!outcome.error) {
    throw new Error("test: middleware PRZEPUŚCIŁO żądanie, choć miało odmówić");
  }
  return outcome;
}

/** Sam komunikat odmowy - najczęstsza asercja. */
async function denial(value: unknown, ctx: Record<string, unknown>): Promise<Error> {
  const { error } = await attemptDenial(value, ctx);
  return error instanceof Error ? error : new Error(String(error));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("premisa: autoryzacja stoi NA uwierzytelnieniu", () => {
  it("każda z czterech bramek deklaruje `requireSupabaseAuth` w łańcuchu w górę", () => {
    // Bez tego ogniwa `context.supabase` / `context.userId` byłyby nieustawione,
    // a bramka roli sprawdzałaby rolę anonimowego wywołującego.
    for (const gate of [requireStaff, requireCrmStaff, requireAdminEditor, requireAdmin]) {
      expect(declaredMiddleware(gate)).toContain(requireSupabaseAuth);
    }
  });

  it("każda z czterech bramek REJESTRUJE ciało `.server()` - jest co mierzyć", () => {
    // Gdyby fabryka przestała rejestrować ciało, wszystkie dowody niżej
    // zamieniłyby się w dowody o atrapie.
    for (const gate of [requireStaff, requireCrmStaff, requireAdminEditor, requireAdmin]) {
      expect(typeof capturedServer(gate)).toBe("function");
    }
  });
});

describe("ścieżka odmowy 1/7: błąd odczytu profilu", () => {
  it("komunikat niesie etykietę bramki I komunikat bazy", async () => {
    const h = harness({ profile: fail("permission denied for table profiles", "42501") });
    const err = await denial(requireStaff, context(h, "aal2"));
    expect(err.message).toBe(
      "Forbidden: could not verify staff role (admin/editor/author) (permission denied for table profiles)",
    );
  });

  it("odmowa NIE MA efektów ubocznych: rola i MFA nie są w ogóle czytane", async () => {
    // Kolejność ma znaczenie - błąd profilu MUSI przerwać przed odczytem roli,
    // bo bez `tenant_id` zapytanie o rolę nie da się zawęzić najemcą.
    const h = harness({ profile: fail("connection reset") });
    await denial(requireStaff, context(h, "aal2"));
    expect(h.stub.chainsFor("user_roles")).toHaveLength(0);
    expect(h.supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("ścieżka odmowy 2/7: brak `profile.tenant_id`", () => {
  it("profil bez najemcy to odmowa `<label> required`, nie awaria", async () => {
    const h = harness({ profile: ok({ tenant_id: null } as Record<string, unknown>) });
    const err = await denial(requireStaff, context(h, "aal2"));
    expect(err.message).toBe("Forbidden: staff role (admin/editor/author) required");
  });

  it("brak wiersza profilu (`maybeSingle` -> null) też odmawia", async () => {
    const h = harness({ profile: ok(null) });
    const err = await denial(requireAdmin, context(h, "aal2"));
    expect(err.message).toBe("Forbidden: admin role required");
    expect(h.stub.chainsFor("user_roles")).toHaveLength(0);
  });
});

describe("ścieżka odmowy 3/7: błąd odczytu roli", () => {
  it("komunikat niesie etykietę bramki I komunikat bazy", async () => {
    const h = harness({ rolesError: fail("relation user_roles does not exist", "42P01") });
    const err = await denial(requireCrmStaff, context(h, "aal2"));
    expect(err.message).toBe(
      "Forbidden: could not verify CRM staff role (admin/editor) (relation user_roles does not exist)",
    );
  });

  it("odmowa NIE dochodzi do sprawdzenia MFA", async () => {
    const h = harness({ rolesError: fail("timeout") });
    await denial(requireCrmStaff, context(h, "aal2"));
    expect(h.supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("ścieżka odmowy 4/7: pusta lista roli", () => {
  it("uwierzytelniony użytkownik BEZ roli jest odrzucany", async () => {
    const h = harness({ roles: [] });
    const err = await denial(requireStaff, context(h, "aal2"));
    expect(err.message).toBe("Forbidden: staff role (admin/editor/author) required");
  });

  it("odmowa jest przed handlerem: `next()` NIE jest wołane ani raz", async () => {
    // To jest różnica między „zwróciło 401" a „zwróciło 401 i nic nie zrobiło".
    // Kod odpowiedzi jest zgodny również ze światem, w którym handler wykonał
    // się PRZED sprawdzeniem roli - dlatego asercja patrzy na `nextCalls`.
    const h = harness({ roles: [] });
    const { nextCalls } = await attemptDenial(requireStaff, context(h, "aal2"));
    expect(nextCalls).toEqual([]);
  });
});

describe("ścieżka 5/7: `aal` decyduje, CZY sprawdzamy MFA", () => {
  it("`aal2` POMIJA RPC `has_verified_mfa` - drugi czynnik już przedstawiony", async () => {
    // Asercja na LICZBIE wywołań, nie na wyniku: gdyby RPC było wołane zawsze,
    // każde żądanie panelu płaciłoby za nie okrągłym czasem bazy, a błąd RPC
    // odcinałby staffa, który MA aal2.
    const h = harness({ roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }] });
    const run = await runMiddleware(requireStaff, { context: context(h, "aal2") });
    expect(h.supabase.rpc).toHaveBeenCalledTimes(0);
    expect(run.nextCalls).toHaveLength(1);
  });

  it("brak `aal` w claimach WCHODZI w sprawdzenie MFA", async () => {
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { data: false },
    });
    await runMiddleware(requireStaff, { context: context(h) });
    expect(h.supabase.rpc).toHaveBeenCalledWith("has_verified_mfa");
  });

  it("`aal1` (hasło bez drugiego czynnika) WCHODZI w sprawdzenie MFA", async () => {
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "editor" }],
      mfa: { data: false },
    });
    await runMiddleware(requireAdminEditor, { context: context(h, "aal1") });
    expect(h.supabase.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("ścieżka odmowy 6/7: błąd RPC `has_verified_mfa`", () => {
  it("komunikat mówi o MFA, a NIE o roli - diagnoza nie może mylić warstw", async () => {
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { error: { message: "function has_verified_mfa does not exist", code: "42883" } },
    });
    const err = await denial(requireAdmin, context(h, "aal1"));
    expect(err.message).toBe(
      "Forbidden: could not verify MFA status (function has_verified_mfa does not exist)",
    );
  });

  it("fail-closed: niedostępne RPC ODMAWIA, nie przepuszcza", async () => {
    // To jest sedno: gdyby błąd RPC był ignorowany, wyłączenie funkcji w bazie
    // zdejmowałoby wymuszanie MFA z całego panelu - i to bez żadnego sygnału.
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { error: { message: "timeout" } },
    });
    const err = await denial(requireAdmin, context(h, "aal1"));
    expect(err.message).toContain("Forbidden:");
  });
});

describe("ścieżka odmowy 7/7: `mfa_required` - drugi czynnik ISTNIEJE, ale nie przedstawiony", () => {
  it("staff z zweryfikowanym MFA przy `aal1` dostaje `mfa_required`", async () => {
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "author" }],
      mfa: { data: true },
    });
    const err = await denial(requireStaff, context(h, "aal1"));
    expect(err.message).toBe(
      "Forbidden: mfa_required - verify your second factor (aal2) to perform staff role (admin/editor/author) actions",
    );
  });

  it("token `mfa_required` jest w komunikacie DOSŁOWNIE - klient rozpoznaje po nim step-up", async () => {
    // Front odróżnia „nie masz roli" od „podnieś poziom uwierzytelnienia"
    // wyłącznie po tym tokenie. Zmiana treści komunikatu psuje step-up w UI,
    // więc jest tu przypięta osobną asercją.
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { data: true },
    });
    const err = await denial(requireAdmin, context(h, "aal1"));
    expect(err.message).toContain("mfa_required");
  });

  it("ODWRÓCENIE warunku na `hasMfa === false` byłoby widoczne: bez MFA PRZEPUSZCZAMY", async () => {
    // Mutant `hasMfa === false` zapala się TUTAJ: użytkownik BEZ zweryfikowanego
    // drugiego czynnika ma przejść (nie ma czego przedstawiać), a użytkownik
    // Z czynnikiem ma zostać odrzucony - test wyżej. Razem te dwa przypadki
    // zabijają mutanta, którego żaden dowód strukturalny nie zobaczy.
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { data: false },
    });
    const run = await runMiddleware(requireAdmin, { context: context(h, "aal1") });
    expect(run.nextCalls).toHaveLength(1);
    expect(run.result).toBe(middlewarePassThrough);
  });

  it("`hasMfa` null (RPC bez wyniku) PRZEPUSZCZA - porównanie jest do `true`, nie truthy", async () => {
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { data: null },
    });
    const run = await runMiddleware(requireAdmin, { context: context(h, "aal1") });
    expect(run.nextCalls).toHaveLength(1);
  });
});

describe("zestawy ról: cztery bramki NIE są synonimami", () => {
  const withRole = (role: string) =>
    harness({ roles: [{ user_id: USER, tenant_id: TENANT, role }], mfa: { data: false } });

  it("`requireStaff` WPUSZCZA autora treści", async () => {
    const h = withRole("author");
    const run = await runMiddleware(requireStaff, { context: context(h, "aal2") });
    expect(run.nextCalls).toHaveLength(1);
  });

  it("`requireCrmStaff` ODRZUCA autora - CRM to modul sprzedazowy, nie redakcyjny", async () => {
    // Różnica udokumentowana komentarzem :22-25 („autorzy contentu nie powinni
    // mieć wglądu w leady/firmy/pipeline") i do dziś bez dowodu. Dowodem jest
    // to, że TA SAMA rola przechodzi bramkę wyżej i wypada tutaj.
    const h = withRole("author");
    const err = await denial(requireCrmStaff, context(h, "aal2"));
    expect(err.message).toBe("Forbidden: CRM staff role (admin/editor) required");
  });

  it("`requireAdmin` ODRZUCA redaktora", async () => {
    const h = withRole("editor");
    const err = await denial(requireAdmin, context(h, "aal2"));
    expect(err.message).toBe("Forbidden: admin role required");
  });

  it("`requireAdminEditor` WPUSZCZA redaktora", async () => {
    const h = withRole("editor");
    const run = await runMiddleware(requireAdminEditor, { context: context(h, "aal2") });
    expect(run.nextCalls).toHaveLength(1);
  });

  it("`super_admin` przechodzi bramki admina, a NIE przechodzi `requireStaff`", async () => {
    // To nie jest defekt, a konsekwencja `STAFF_ROLES` bez `super_admin` (:19).
    // Przypięte testem, żeby zmiana tego zestawu była decyzją, nie wypadkiem.
    const admin = withRole("super_admin");
    expect(
      (await runMiddleware(requireAdmin, { context: context(admin, "aal2") })).nextCalls,
    ).toHaveLength(1);
    const staff = withRole("super_admin");
    const err = await denial(requireStaff, context(staff, "aal2"));
    expect(err.message).toBe("Forbidden: staff role (admin/editor/author) required");
  });

  it("bramka pyta bazę DOKŁADNIE o swój zestaw ról, nie o wszystkie", async () => {
    // `.in("role", [...allowed])` jest tym, co przenosi zestaw do zapytania.
    // Gdyby ktoś je usunął, baza oddałaby KAŻDĄ rolę użytkownika, a `roles.length`
    // przepuściłby autora przez bramkę admina.
    const h = withRole("admin");
    await runMiddleware(requireCrmStaff, { context: context(h, "aal2") });
    expect(h.stub.lastChain("user_roles")?.argsOf("in")).toEqual([
      "role",
      ["admin", "editor", "super_admin"],
    ]);
  });
});

describe("zawężenie NAJEMCĄ: rola z innego tenanta nie jest rolą", () => {
  it("admin w OBCYM tenancie jest odrzucany", async () => {
    // `.eq("tenant_id", profile.tenant_id)` (:54) jest jedyną rzeczą, która
    // trzyma izolację obszarów roboczych na tej warstwie. Bez niej rola nadana
    // w jednej firmie otwierałaby panel innej.
    const h = harness({
      roles: [{ user_id: USER, tenant_id: OTHER_TENANT, role: "admin" }],
      mfa: { data: false },
    });
    const err = await denial(requireAdmin, context(h, "aal2"));
    expect(err.message).toBe("Forbidden: admin role required");
  });

  it("zapytanie o rolę zawęża się najemcą Z PROFILU, a nie z żądania", async () => {
    const h = harness({
      profile: ok({ tenant_id: TENANT } as Record<string, unknown>),
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { data: false },
    });
    await runMiddleware(requireAdmin, { context: context(h, "aal2") });
    const chain = h.stub.lastChain("user_roles");
    const eqs = chain?.calls.filter((c) => c.method === "eq").map((c) => c.args) ?? [];
    expect(eqs).toEqual([
      ["user_id", USER],
      ["tenant_id", TENANT],
    ]);
  });

  it("profil czyta się po `id` wywołującego z kontekstu, nie po parametrze wejścia", async () => {
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { data: false },
    });
    await runMiddleware(requireAdmin, { context: context(h, "aal2") });
    expect(h.stub.lastChain("profiles")?.argsOf("eq")).toEqual(["id", USER]);
    expect(h.stub.lastChain("profiles")?.has("maybeSingle")).toBe(true);
  });
});

describe("ścieżka przejścia: co dostaje handler", () => {
  it("`next()` jest wołane RAZ i bez podmiany kontekstu", async () => {
    // Bramka roli nie wzbogaca kontekstu - robi to `requireSupabaseAuth`.
    // Gdyby zaczęła, handlery zaczęłyby czytać inne `userId` niż to, na którym
    // sprawdzono rolę.
    const h = harness({
      roles: [{ user_id: USER, tenant_id: TENANT, role: "admin" }],
      mfa: { data: false },
    });
    const run = await runMiddleware(requireAdmin, { context: context(h, "aal2") });
    expect(run.nextCalls).toEqual([{ arg: undefined }]);
    expect(run.injectedContext).toEqual({});
  });
});
