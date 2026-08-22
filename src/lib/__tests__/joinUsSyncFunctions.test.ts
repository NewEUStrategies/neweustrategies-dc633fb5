// SPIĘCIE FORMULARZA „DOŁĄCZ DO NAS” Z KONTEM
// (`src/lib/joinUsSync.functions.ts`). 98 linii, dwie funkcje serwerowe,
// ZERO wykonanych linii przed tym plikiem.
//
// CO TEN PLIK DOWODZI. Ta warstwa przenosi DANE OSOBOWE w obie strony:
// czyta profil (imię, nazwisko, lokalizacja, telefon, LinkedIn, firma,
// stanowisko), żeby wstępnie wypełnić formularz, i po zapisaniu subskrypcji
// dopisuje te same pola do profilu przez RPC pod kluczem service_role.
// Ryzyko nie jest tu wydajnościowe, a prawne - w obu kierunkach chodzi
// o CUDZE dane. Dowodzimy więc czterech rzeczy:
//
//   1. TOŻSAMOŚĆ POCHODZI Z SESJI, NIGDY Z WEJŚCIA. `getJoinUsPrefill` nie ma
//      walidatora i woła `get_own_profile` BEZ ARGUMENTÓW (zakres to
//      `auth.uid()`), a `linkJoinUsAndBackfill` bierze `_user_id` z
//      `context.userId`. Osobna asercja pilnuje, że doklejone do wejścia
//      `userId` jest przez schemat WYRZUCANE - inaczej dałoby się dopisać
//      swoje dane do cudzego profilu.
//   2. ZAKRES NAJEMCY. Bez rozwiązanego najemcy funkcja NIE WOŁA RPC wcale -
//      subskrypcja jest per-najemca, więc powiązanie bez najemcy dopisałoby
//      dane do niewłaściwej redakcji.
//   3. ODPORNOŚĆ ODCZYTU PROFILU: `?? ""` na każdym z siedmiu pól, dla
//      wartości obecnej, `null`, brakującej i PUSTEJ. Formularz nie może
//      dostać `undefined` w polu kontrolowanym (React zamienia je na pole
//      niekontrolowane i gubi wpisywany tekst).
//   4. MINIMALIZACJA I ŚLAD: wynik prefillu ma DOKŁADNIE siedem pól, a log
//      błędu nie zawiera adresu e-mail ani żadnej innej danej z wejścia.
//
// CZEGO TEN HARNESS NIE UDAJE - I DLACZEGO TO NIE JEST LUKA.
// `@/test/serverFnHarness` NIE URUCHAMIA middleware, więc „żądanie bez sesji”
// jest tu dowodzone jako DEKLARACJA `requireSupabaseAuth` na obu eksportach,
// a nie jako zachowanie handlera. Kompletności bramek pilnuje
// `check:authz-snapshot`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY: co robi `join_us_link_and_backfill` (czy naprawdę
//   uzupełnia WYŁĄCZNIE puste pola, czy `get_own_profile` jest zawężony do
//   `auth.uid()`, czy grant PII jest odebrany roli `authenticated`) -
//   `profiles_pii_grant_test.sql`, `pii_column_grants_test.sql`,
//   `profile_export_rls_scope_test.sql`, `security_definer_tenant_scope_test.sql`,
//   `rls_tenant_isolation_test.sql`. Na atrapie nie ma ani RLS, ani ciała RPC.
// - KONTRAKTU PARAMETRÓW RPC: bramki `check:rpc-contract` i `check:db-contract`.
// - ROZWIĄZYWANIA HOSTA NA NAJEMCĘ (`resolveTenantIdForHost`,
//   `currentTenantHost`): mają własne testy i pgTAP
//   (`host_tenant_resolution_test.sql`, `tenant_host_assertion_test.sql`).
//   Tutaj są atrapą i sprawdzamy WYŁĄCZNIE, co handler robi z ich wynikiem.
// - REJESTRU ZGÓD przy zapisie subskrypcji: `src/lib/__tests__/consentsFunctions.test.ts`.
// - FORMULARZA (`JoinUsForm.tsx`): to komponent i osobna praca.
//
// RODO: adresy e-mail wyłącznie w domenie `example.com`, dane osobowe umowne,
// zero adresów IP. Osobna asercja pilnuje, że treść logu błędu nie wynosi
// danych z wejścia.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wywołania RPC klienta użytkownika (`context.supabase`). */
  userRpc: [] as { name: string; args: unknown }[],
  /** Wynik `get_own_profile` - `data` jest `unknown`, bo RPC nie ma tu schematu. */
  ownProfile: { data: null, error: null } as { data: unknown; error: { message: string } | null },
  /** Wywołania RPC pod kluczem service_role (`supabaseAdmin`). */
  adminRpc: [] as { name: string; args: unknown }[],
  /** Wynik RPC backfillu. */
  backfill: { error: null } as { error: { message: string } | null },
  /** Host oddany przez warstwę żądania (`null` = brak nagłówka). */
  host: "www.example.com" as string | null,
  /** Najemca rozwiązany z hosta (`null` = nierozwiązywalny). */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
  /** Hosty, o które pytał handler - dowód, że najemca idzie z ŻĄDANIA. */
  resolvedHosts: [] as (string | null | undefined)[],
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(h.host),
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: (rawHost: string | null | undefined) => {
    h.resolvedHosts.push(rawHost);
    return Promise.resolve(h.tenantId);
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args?: unknown) => {
      h.adminRpc.push({ name, args });
      return Promise.resolve(h.backfill);
    },
  },
}));

import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";
import {
  getJoinUsPrefill,
  linkJoinUsAndBackfill,
  type JoinUsPrefill,
} from "@/lib/joinUsSync.functions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMAIL = "zapisujaca.sie@example.com";

/** Wszystkie siedem pól puste - kształt, który zwraca `EMPTY` w produkcji. */
const EMPTY_PREFILL: JoinUsPrefill = {
  firstName: "",
  lastName: "",
  country: "",
  linkedin: "",
  phone: "",
  company: "",
  position: "",
};

/** Strażnik runtime zamiast rzutowania. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pole specyfikacji server fn czytane strażnikiem, nie rzutowaniem. */
function specField(fn: unknown, field: string): unknown {
  if (!isRecord(fn)) throw new Error("test: eksport nie jest specyfikacją server fn");
  return fn[field];
}

/** Argumenty ostatniego wywołania RPC backfillu, zawężone strażnikiem. */
function backfillArgs(): Record<string, unknown> {
  const last = h.adminRpc.at(-1);
  if (!last || !isRecord(last.args)) throw new Error("test: RPC backfillu nie dostało obiektu");
  return last.args;
}

function context(): ServerFnContext {
  return {
    supabase: {
      rpc: (name: string, args?: unknown) => {
        h.userRpc.push({ name, args });
        return Promise.resolve(h.ownProfile);
      },
      // `from` MA tu być - i MA nie być wołane. Gdyby handler sięgnął wprost
      // do tabeli `profiles` (zamiast przez RPC zawężone do `auth.uid()`),
      // test wywali się z nazwą tabeli w komunikacie.
      from: (table: string) => {
        throw new Error(`test: handler sięgnął wprost do tabeli "${table}"`);
      },
    },
    userId: USER_ID,
  };
}

/** Minimalne poprawne wejście `linkJoinUsAndBackfill`. */
function linkInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { email: EMAIL, ...overrides };
}

beforeEach(() => {
  h.userRpc = [];
  h.ownProfile = { data: null, error: null };
  h.adminRpc = [];
  h.backfill = { error: null };
  h.host = "www.example.com";
  h.tenantId = TENANT_ID;
  h.resolvedHosts = [];
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA.
// ---------------------------------------------------------------------------

describe("join-us sync - obudowa server functions", () => {
  const EXPORTS: readonly { name: string; fn: unknown; method: string }[] = [
    { name: "getJoinUsPrefill", fn: getJoinUsPrefill, method: "GET" },
    { name: "linkJoinUsAndBackfill", fn: linkJoinUsAndBackfill, method: "POST" },
  ];

  it.each(EXPORTS)("$name deklaruje `requireSupabaseAuth`", ({ fn }) => {
    // Obie funkcje dotykają danych osobowych konkretnego konta - anonimowy
    // dostęp do którejkolwiek z nich to wyciek, nie usterka.
    expect(serverFnMiddlewareNames(fn)).toContain("requireSupabaseAuth");
  });

  it.each(EXPORTS)("$name ma metodę $method", ({ fn, method }) => {
    // Zapis (backfill) MUSI być POST-em: `GET` dałby się wywołać z `<img src>`
    // na obcej stronie.
    expect(specField(fn, "method")).toBe(method);
  });

  it("`getJoinUsPrefill` NIE MA walidatora, bo nie przyjmuje wejścia", () => {
    // To jest własność bezpieczeństwa, nie oszczędność: skoro nie ma
    // parametru, nie ma czym wskazać cudzego profilu. Dodanie tu wejścia
    // wymagałoby osobnej bramki autoryzacji.
    expect(specField(getJoinUsPrefill, "validator")).toBeUndefined();
  });

  it("`linkJoinUsAndBackfill` waliduje wejście schematem", () => {
    expect(specField(linkJoinUsAndBackfill, "validator")).toBeTypeOf("function");
  });
});

// ---------------------------------------------------------------------------
// 2. `getJoinUsPrefill` - odczyt własnego profilu.
// ---------------------------------------------------------------------------

describe("join-us sync - getJoinUsPrefill", () => {
  it("czyta profil przez `get_own_profile` BEZ ARGUMENTÓW", async () => {
    // Brak argumentu to cały mechanizm zawężenia: RPC jest SECURITY DEFINER
    // i sam bierze `auth.uid()`. Dopisanie tu parametru z identyfikatorem
    // otworzyłoby odczyt cudzych danych osobowych (telefon, lokalizacja).
    h.ownProfile = { data: [{ first_name: "Anna" }], error: null };
    await callServerFn(getJoinUsPrefill, { context: context() });
    expect(h.userRpc).toHaveLength(1);
    expect(h.userRpc[0]?.name).toBe("get_own_profile");
    expect(h.userRpc[0]?.args).toBeUndefined();
  });

  it("mapuje pełny wiersz na siedem pól formularza", async () => {
    h.ownProfile = {
      data: [
        {
          first_name: "Anna",
          last_name: "Kowalska",
          location: "Warszawa, Polska",
          linkedin_url: "https://www.example.com/in/anna",
          phone: "+48 000 000 000",
          current_company: "Przykładowa Fundacja",
          job_title: "Analityczka",
        },
      ],
      error: null,
    };
    const prefill = await callServerFn<JoinUsPrefill>(getJoinUsPrefill, { context: context() });
    expect(prefill).toEqual({
      firstName: "Anna",
      lastName: "Kowalska",
      country: "Warszawa, Polska",
      linkedin: "https://www.example.com/in/anna",
      phone: "+48 000 000 000",
      company: "Przykładowa Fundacja",
      position: "Analityczka",
    });
  });

  it("oddaje DOKŁADNIE siedem pól - nic ponad to, co potrzebuje formularz", async () => {
    // Minimalizacja danych: RPC `get_own_profile` zwraca cały wiersz profilu.
    // Gdyby handler przepuszczał go dalej (spread), do przeglądarki poszłyby
    // pola, o które formularz nie prosi.
    h.ownProfile = {
      data: [{ first_name: "Anna", role: "admin", tenant_id: TENANT_ID, email: EMAIL }],
      error: null,
    };
    const prefill = await callServerFn<Record<string, unknown>>(getJoinUsPrefill, {
      context: context(),
    });
    expect(Object.keys(prefill).sort()).toEqual([
      "company",
      "country",
      "firstName",
      "lastName",
      "linkedin",
      "phone",
      "position",
    ]);
    expect(JSON.stringify(prefill)).not.toContain(EMAIL);
  });

  const NO_ROW: readonly {
    label: string;
    response: { data: unknown; error: { message: string } | null };
  }[] = [
    { label: "RPC padło", response: { data: null, error: { message: "permission denied" } } },
    { label: "brak danych (`null`)", response: { data: null, error: null } },
    { label: "pusta lista wierszy", response: { data: [], error: null } },
    {
      label: "błąd RAZEM z danymi - błąd wygrywa",
      response: { data: [{ first_name: "Anna" }], error: { message: "timeout" } },
    },
  ];

  it.each(NO_ROW)("$label daje siedem pustych pól, nie wyjątek", async ({ response }) => {
    // Formularz „Dołącz do nas” jest publicznym wejściem do platformy - awaria
    // prefillu nie może go zablokować. Pusty kształt znaczy „wpisz sam”.
    h.ownProfile = response;
    const prefill = await callServerFn<JoinUsPrefill>(getJoinUsPrefill, { context: context() });
    expect(prefill).toEqual(EMPTY_PREFILL);
  });

  it("bierze PIERWSZY wiersz, gdy RPC odda ich więcej", async () => {
    h.ownProfile = {
      data: [{ first_name: "Anna" }, { first_name: "Nie-Anna" }],
      error: null,
    };
    const prefill = await callServerFn<JoinUsPrefill>(getJoinUsPrefill, { context: context() });
    expect(prefill.firstName).toBe("Anna");
  });

  const FIELDS: readonly { field: string; target: keyof JoinUsPrefill }[] = [
    { field: "first_name", target: "firstName" },
    { field: "last_name", target: "lastName" },
    { field: "location", target: "country" },
    { field: "linkedin_url", target: "linkedin" },
    { field: "phone", target: "phone" },
    { field: "current_company", target: "company" },
    { field: "job_title", target: "position" },
  ];

  const NULLISH: readonly { label: string; build: (field: string) => Record<string, unknown> }[] = [
    { label: "`null` w kolumnie", build: (field) => ({ [field]: null }) },
    { label: "brak pola w wierszu", build: () => ({}) },
  ];

  it.each(
    FIELDS.flatMap((entry) =>
      NULLISH.map((nullish) => ({
        target: entry.target,
        label: nullish.label,
        row: nullish.build(entry.field),
      })),
    ),
  )("pole $target: $label daje pusty napis", async ({ target, row }) => {
    // `?? ""` na każdym polu. `undefined` w polu kontrolowanym Reacta zamienia
    // input w niekontrolowany i gubi to, co użytkownik wpisze - dlatego pusty
    // napis, a nie „brak wartości”.
    h.ownProfile = { data: [row], error: null };
    const prefill = await callServerFn<JoinUsPrefill>(getJoinUsPrefill, { context: context() });
    expect(prefill[target]).toBe("");
  });

  it.each(FIELDS)(
    "pole $target: PUSTY napis w bazie zostaje pustym napisem",
    async ({ field, target }) => {
      // Wartość FAŁSZYWA, ale PRAWIDŁOWA. `??` (a nie `||`) jest tu poprawnym
      // wyborem i test to przypina: gdyby ktoś zamienił operator, pusty napis
      // nadal dawałby pusty napis, więc sam wynik tego nie złapie - dlatego
      // asercja idzie razem z przypadkiem `null` wyżej.
      h.ownProfile = { data: [{ [field]: "" }], error: null };
      const prefill = await callServerFn<JoinUsPrefill>(getJoinUsPrefill, { context: context() });
      expect(prefill[target]).toBe("");
    },
  );

  it("stan faktyczny: wartość nie-tekstowa przechodzi BEZ konwersji", async () => {
    // `?? ""` nie zamienia typu. Że kolumny profilu są tekstowe, pilnują
    // bramki `check:db-contract` / `check:rpc-contract` i typy z generatora -
    // nie ten handler. Test istnieje, żeby nikt nie czytał `?? ""` jako
    // normalizacji.
    h.ownProfile = { data: [{ phone: 0 }], error: null };
    const prefill = await callServerFn<Record<string, unknown>>(getJoinUsPrefill, {
      context: context(),
    });
    expect(prefill.phone).toBe(0);
  });

  it("nie sięga wprost do żadnej tabeli", async () => {
    // Atrapa `from` rzuca z nazwą tabeli, więc każde obejście RPC oblewa test.
    h.ownProfile = { data: [{ first_name: "Anna" }], error: null };
    await expect(callServerFn(getJoinUsPrefill, { context: context() })).resolves.toMatchObject({
      firstName: "Anna",
    });
  });
});

// ---------------------------------------------------------------------------
// 3. `linkJoinUsAndBackfill` - walidator.
// ---------------------------------------------------------------------------

describe("join-us sync - walidator linkJoinUsAndBackfill", () => {
  const REJECTED: readonly { label: string; input: unknown }[] = [
    { label: "brak wejścia", input: undefined },
    { label: "wejście `null`", input: null },
    { label: "brak adresu e-mail", input: {} },
    { label: "adres niebędący adresem", input: { email: "to-nie-adres" } },
    { label: "adres pusty", input: { email: "" } },
    { label: "adres jako `null`", input: { email: null } },
    { label: "adres dłuższy niż 254 znaki", input: { email: `${"a".repeat(250)}@example.com` } },
    { label: "imię dłuższe niż 100 znaków", input: { email: EMAIL, firstName: "a".repeat(101) } },
    { label: "kraj dłuższy niż 200 znaków", input: { email: EMAIL, country: "a".repeat(201) } },
    {
      label: "LinkedIn dłuższy niż 500 znaków",
      input: { email: EMAIL, linkedin: "a".repeat(501) },
    },
    { label: "telefon dłuższy niż 60 znaków", input: { email: EMAIL, phone: "1".repeat(61) } },
    { label: "pole tekstowe jako `null`", input: { email: EMAIL, firstName: null } },
    { label: "pole tekstowe jako liczba", input: { email: EMAIL, firstName: 7 } },
  ];

  it.each(REJECTED)("odrzuca: $label", ({ input }) => {
    expect(() => validateServerFnInput(linkJoinUsAndBackfill, input)).toThrow();
  });

  it("brak pól opcjonalnych daje puste napisy, nie `undefined`", () => {
    // Te wartości jadą do RPC jako parametry. `undefined` w argumencie
    // znaczyłoby dla PostgREST „użyj domyślnej”, czyli coś INNEGO niż „nic
    // nie podano” - a backfill i tak dopisuje tylko puste pola.
    const parsed = validateServerFnInput<Record<string, unknown>>(linkJoinUsAndBackfill, {
      email: EMAIL,
    });
    expect(parsed).toEqual({
      email: EMAIL,
      firstName: "",
      lastName: "",
      country: "",
      linkedin: "",
      phone: "",
      company: "",
      position: "",
    });
  });

  it("obcina białe znaki z adresu i z pól tekstowych", () => {
    const parsed = validateServerFnInput<Record<string, unknown>>(linkJoinUsAndBackfill, {
      email: `  ${EMAIL}  `,
      firstName: "  Anna  ",
    });
    expect(parsed.email).toBe(EMAIL);
    expect(parsed.firstName).toBe("Anna");
  });

  it("WYRZUCA doklejone `userId` - tożsamości nie da się podać z wejścia", () => {
    // Najważniejsza asercja w tej sekcji. Gdyby schemat przepuszczał nadmiarowe
    // klucze, a handler kiedykolwiek zaczął czytać `data.userId`, formularz
    // dopisywałby dane do CUDZEGO profilu.
    const parsed = validateServerFnInput<Record<string, unknown>>(linkJoinUsAndBackfill, {
      email: EMAIL,
      userId: "22222222-2222-4222-8222-222222222222",
      tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(parsed.userId).toBeUndefined();
    expect(parsed.tenantId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. `linkJoinUsAndBackfill` - handler.
// ---------------------------------------------------------------------------

describe("join-us sync - handler linkJoinUsAndBackfill", () => {
  it("rozwiązuje najemcę z HOSTA ŻĄDANIA i woła RPC z pełnym zestawem parametrów", async () => {
    const result = await callServerFn(linkJoinUsAndBackfill, {
      data: linkInput({
        firstName: "Anna",
        lastName: "Kowalska",
        country: "Polska",
        linkedin: "https://www.example.com/in/anna",
        phone: "+48 000 000 000",
        company: "Przykładowa Fundacja",
        position: "Analityczka",
      }),
      context: context(),
    });
    expect(result).toEqual({ ok: true });
    expect(h.resolvedHosts).toEqual(["www.example.com"]);
    expect(h.adminRpc).toHaveLength(1);
    expect(h.adminRpc[0]?.name).toBe("join_us_link_and_backfill");
    expect(backfillArgs()).toEqual({
      _user_id: USER_ID,
      _tenant_id: TENANT_ID,
      _email: EMAIL,
      _first_name: "Anna",
      _last_name: "Kowalska",
      _country: "Polska",
      _linkedin: "https://www.example.com/in/anna",
      _phone: "+48 000 000 000",
      _company: "Przykładowa Fundacja",
      _position: "Analityczka",
    });
  });

  it("`_user_id` pochodzi z SESJI, nie z wejścia", async () => {
    // Kontrola dodatnia do asercji na schemacie: nawet gdy wejście udaje
    // kogoś innego, do RPC idzie tożsamość z kontekstu middleware.
    await callServerFn(linkJoinUsAndBackfill, {
      data: linkInput({ userId: "22222222-2222-4222-8222-222222222222" }),
      context: context(),
    });
    expect(backfillArgs()._user_id).toBe(USER_ID);
  });

  const NO_TENANT: readonly { label: string; tenantId: string | null }[] = [
    { label: "najemca nierozwiązywalny (`null`)", tenantId: null },
    { label: "najemca jako PUSTY napis (wartość FAŁSZYWA, ale PRAWIDŁOWA)", tenantId: "" },
  ];

  it.each(NO_TENANT)("$label: odmawia i NIE woła RPC", async ({ tenantId }) => {
    // Subskrypcja jest per-najemca. Dopisanie danych osobowych bez zakresu
    // najemcy trafiłoby je do niewłaściwej redakcji - dlatego brak najemcy
    // musi zatrzymać pracę PRZED wywołaniem RPC pod service_role.
    h.tenantId = tenantId;
    const result = await callServerFn(linkJoinUsAndBackfill, {
      data: linkInput(),
      context: context(),
    });
    expect(result).toEqual({ ok: false });
    expect(h.adminRpc).toEqual([]);
  });

  it("brak hosta w żądaniu idzie do rozwiązywania jako `null`", async () => {
    // Handler nie podstawia hosta domyślnego - decyzję podejmuje warstwa
    // najemcy (i to ona ma pgTAP). Test pilnuje, że `null` NIE jest po drodze
    // zamieniany na cokolwiek innego.
    h.host = null;
    h.tenantId = null;
    const result = await callServerFn(linkJoinUsAndBackfill, {
      data: linkInput(),
      context: context(),
    });
    expect(h.resolvedHosts).toEqual([null]);
    expect(result).toEqual({ ok: false });
  });

  it("puste pola opcjonalne JADĄ do RPC jako puste napisy", async () => {
    // Wartość FAŁSZYWA, ale PRAWIDŁOWA: handler nie odsiewa pustych pól.
    // To jest zamierzone - o tym, czego nie nadpisywać, decyduje RPC
    // (`join_us_link_and_backfill` uzupełnia wyłącznie puste kolumny).
    await callServerFn(linkJoinUsAndBackfill, { data: linkInput(), context: context() });
    expect(backfillArgs()).toMatchObject({
      _first_name: "",
      _last_name: "",
      _country: "",
      _linkedin: "",
      _phone: "",
      _company: "",
      _position: "",
    });
  });

  it("błąd RPC daje `ok: false`, a nie wyjątek", async () => {
    // Formularz już zapisał subskrypcję - wyjątek tutaj pokazałby
    // użytkownikowi błąd po udanym zapisie, czyli skłonił do drugiej próby.
    h.backfill = { error: { message: "duplicate key value" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await callServerFn(linkJoinUsAndBackfill, {
        data: linkInput(),
        context: context(),
      });
      expect(result).toEqual({ ok: false });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("log błędu NIE zawiera danych osobowych z wejścia", async () => {
    // RODO: ślad diagnostyczny wychodzi do logów serwera, które żyją dłużej
    // i mają szerszy krąg czytelników niż baza. Adres e-mail, telefon ani
    // nazwisko nie mogą się w nim znaleźć.
    h.backfill = { error: { message: "duplicate key value" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await callServerFn(linkJoinUsAndBackfill, {
        data: linkInput({ firstName: "Anna", lastName: "Kowalska", phone: "+48 000 000 000" }),
        context: context(),
      });
      const logged = JSON.stringify(spy.mock.calls.map((call) => call.map((arg) => String(arg))));
      expect(logged).toContain("[join-us]");
      expect(logged).not.toContain(EMAIL);
      expect(logged).not.toContain("Kowalska");
      expect(logged).not.toContain("+48 000 000 000");
    } finally {
      spy.mockRestore();
    }
  });

  it("nie sięga wprost do żadnej tabeli - cała praca idzie przez RPC", async () => {
    await callServerFn(linkJoinUsAndBackfill, { data: linkInput(), context: context() });
    expect(h.userRpc).toEqual([]);
    expect(h.adminRpc.map((call) => call.name)).toEqual(["join_us_link_and_backfill"]);
  });
});
