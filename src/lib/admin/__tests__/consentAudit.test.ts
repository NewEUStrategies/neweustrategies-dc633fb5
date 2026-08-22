// AUDYT ZGÓD W PANELU - KONTRAKTY I WARSTWA SERWEROWA
// (`src/lib/admin/consentAudit.server.ts` - 40 linii,
// `src/lib/admin/consentAudit.functions.ts` - 39 linii). Oba pliki miały
// ZERO wykonanych linii przed tym plikiem.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO RYZYKO WARTE TESTU. To jedyna droga, przez
// którą redakcja widzi DOWÓD ZGODY: kto, kiedy, na jakich kategoriach, w jakiej
// wersji banera i czy przyszedł z sygnałem GPC. W razie kontroli to ten ekran
// jest dowodem, więc znaczenie ma nie „czy się rysuje”, a:
//
//   1. DROGA ODCZYTU. Handlery wolno TYLKO utwardzone RPC
//      (`admin_consent_decisions`, `admin_consent_stats`) - nigdy tabelę
//      wprost. `user_consent_events` ma politykę „tylko własne wpisy”, więc
//      obejście RPC nie dałoby błędu, a CICHO PUSTĄ listę: panel pokazałby
//      „brak zgód” tam, gdzie zgody są. Atrapa klienta rzuca na każde
//      `from(...)`, więc każda taka próba oblewa test.
//   2. NIEZMIENNOŚĆ DOWODU. Handler nie normalizuje, nie uzupełnia ani nie
//      przycina wierszy - oddaje DOKŁADNIE to, co przyszło z bazy (asercja na
//      TOŻSAMOŚCI obiektu, nie na jego kształcie). Każde „posprzątanie” pola
//      po drodze zmienia dowód.
//   3. ODMOWA NIE JEST PUSTKĄ. Błąd RPC MUSI rzucić. Zwrócenie `[]` znaczyłoby
//      „nikt nie wyraził zgody” - dokładna odwrotność prawdy.
//   4. GRANICE OKNA I STRONICOWANIA. `limit`, `offset`, `days` mają twarde
//      widełki (1..200, 0.., 1..365) - to jednocześnie ochrona przed
//      wyciągnięciem całego rejestru jednym żądaniem.
//   5. `?? undefined` NA FILTRZE ŹRÓDŁA: `null` z interfejsu MUSI zniknąć
//      z argumentów, żeby RPC użyło wartości domyślnej parametru. Pusty napis
//      to osobny, przypięty przypadek (patrz komentarz przy teście).
//
// CZEGO TEN HARNESS NIE UDAJE - I DLACZEGO TO NIE JEST LUKA.
// `@/test/serverFnHarness` NIE URUCHAMIA middleware, więc „żądanie bez sesji”
// i „konto bez roli admina” są tu dowodzone jako DEKLARACJA
// `requireSupabaseAuth` (sekcja 1) plus fakt, że cała autoryzacja siedzi
// w ciele RPC. Bramka roli w tych handlerach NIE ISTNIEJE i to jest zamierzone:
// sprawdza ją SECURITY DEFINER w bazie. Test na atrapie nie może tego dowieść
// ani podważyć.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY: że `admin_consent_decisions` / `admin_consent_stats`
//   wymagają roli admina i zawężają wynik do najemcy, że `user_consents`
//   i `user_consent_events` mają WYŁĄCZNIE ścieżkę SELECT (żadnego UPDATE ani
//   DELETE, czyli dowód jest niezmienny) i że grant PII jest odebrany -
//   `consent_evidence_hardening_test.sql` (28 asercji),
//   `security_definer_tenant_scope_test.sql`, `rls_tenant_isolation_test.sql`,
//   `tenant_isolation_three_tenants_test.sql`.
// - ZAPISU ZGODY, SYGNAŁU GPC I REJESTRU PO STRONIE UŻYTKOWNIKA:
//   `src/lib/__tests__/consentsFunctions.test.ts`,
//   `src/lib/consent/__tests__/*`.
// - INTERFEJSU PANELU (`ConsentAuditSummary.tsx`): to komponent i osobna praca;
//   tutaj nie ma ani jednego renderu.
//
// RODO: wszystkie adresy w fixture'ach są w domenie `example.com`, adresy IP -
// wyłącznie z puli dokumentacyjnej RFC 5737. Osobna asercja przechodzi po
// fixture'ach i pilnuje tej reguły, żeby nikt nie wklejił tu prawdziwego
// wpisu z produkcji przy odtwarzaniu zgłoszenia.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wywołania RPC: nazwa + argumenty, w kolejności. */
  rpcCalls: [] as { name: string; args: unknown }[],
  /** Zaplanowane odpowiedzi RPC per nazwa funkcji bazy. */
  rpcResults: new Map<string, { data: unknown; error: { message: string } | null }>(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

import {
  callServerFn,
  serverFnMiddlewareNames,
  type ServerFnContext,
} from "@/test/serverFnHarness";
import {
  ConsentDecisionsQuerySchema,
  ConsentStatsQuerySchema,
  type ConsentDecisionRow,
  type ConsentStatRow,
} from "@/lib/admin/consentAudit.server";
import { listConsentDecisions, listConsentStats } from "@/lib/admin/consentAudit.functions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DECISION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** Adres wyłącznie z domeny zarezerwowanej - patrz nagłówek (RODO). */
const SUBJECT_EMAIL = "osoba.badana@example.com";

/** Strażnik runtime zamiast rzutowania. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pole specyfikacji server fn czytane strażnikiem. */
function specField(fn: unknown, field: string): unknown {
  if (!isRecord(fn)) throw new Error("test: eksport nie jest specyfikacją server fn");
  return fn[field];
}

/** Argumenty ostatniego wywołania RPC, zawężone strażnikiem. */
function rpcArgs(): Record<string, unknown> {
  const last = h.rpcCalls.at(-1);
  if (!last || !isRecord(last.args)) throw new Error("test: RPC nie dostało obiektu argumentów");
  return last.args;
}

function context(): ServerFnContext {
  return {
    supabase: {
      rpc: (name: string, args?: unknown) => {
        h.rpcCalls.push({ name, args });
        const planned = h.rpcResults.get(name);
        if (!planned) {
          // Brak planu to BŁĄD TESTU, nie „puste dane”: ciche `null` udawałoby
          // poprawną odpowiedź funkcji, której test w ogóle nie przewidział.
          return Promise.resolve({
            data: null,
            error: { message: `test: brak zaplanowanej odpowiedzi RPC "${name}"` },
          });
        }
        return Promise.resolve(planned);
      },
      // Sięgnięcie wprost do tabeli zgód ma OBLAĆ test - patrz punkt 1
      // nagłówka. Polityka „tylko własne wpisy” zwróciłaby w produkcji pustą
      // listę bez błędu, czyli defekt bez objawu.
      from: (table: string) => {
        throw new Error(`test: handler sięgnął wprost do tabeli "${table}"`);
      },
    },
    userId: USER_ID,
  };
}

function decisionRow(overrides: Partial<ConsentDecisionRow> = {}): ConsentDecisionRow {
  return {
    decision_id: DECISION_ID,
    user_id: USER_ID,
    email: SUBJECT_EMAIL,
    display_name: "Osoba Badana",
    decided_at: "2026-03-15T12:00:00.000Z",
    source: "banner",
    banner_version: "2026-01",
    lang: "pl",
    gpc: false,
    page_url: "https://www.example.com/analizy",
    granted_keys: ["necessary", "analytics"],
    denied_keys: ["marketing"],
    ...overrides,
  };
}

function statRow(overrides: Partial<ConsentStatRow> = {}): ConsentStatRow {
  return {
    consent_key: "analytics",
    granted: 12,
    denied: 3,
    gpc_events: 1,
    last_event_at: "2026-03-15T12:00:00.000Z",
    banner_versions: ["2026-01"],
    ...overrides,
  };
}

beforeEach(() => {
  h.rpcCalls = [];
  h.rpcResults = new Map();
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA.
// ---------------------------------------------------------------------------

describe("audyt zgód - obudowa server functions", () => {
  const EXPORTS: readonly { name: string; fn: unknown }[] = [
    { name: "listConsentDecisions", fn: listConsentDecisions },
    { name: "listConsentStats", fn: listConsentStats },
  ];

  it.each(EXPORTS)("$name deklaruje `requireSupabaseAuth`", ({ fn }) => {
    // Bez tego middleware `context.supabase` nie istnieje, a RPC pojechałoby
    // rolą anonimową - czyli albo błąd, albo (gorzej) pusta lista czytana
    // jako „brak zgód”.
    expect(serverFnMiddlewareNames(fn)).toContain("requireSupabaseAuth");
  });

  it.each(EXPORTS)("$name jest ODCZYTEM (GET)", ({ fn }) => {
    // Audyt jest wyłącznie do czytania. Metoda zapisu na tej powierzchni
    // sugerowałaby, że dowód zgody da się z panelu modyfikować.
    expect(specField(fn, "method")).toBe("GET");
  });

  it.each(EXPORTS)("$name waliduje wejście", ({ fn }) => {
    expect(specField(fn, "validator")).toBeTypeOf("function");
  });
});

// ---------------------------------------------------------------------------
// 2. SCHEMATY (`consentAudit.server.ts`).
// ---------------------------------------------------------------------------

describe("audyt zgód - schemat zapytania o decyzje", () => {
  it("brak wejścia daje pierwszą stronę po 50 wierszy", () => {
    // `parse(input ?? {})` w handlerze: wywołanie bez danych ma dać domyślne
    // widełki, a nie wyjątek - inaczej pierwsze wejście na ekran audytu
    // kończyłoby się błędem.
    expect(ConsentDecisionsQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  const LIMITS: readonly { label: string; limit: unknown; ok: boolean }[] = [
    { label: "1 - dolna granica", limit: 1, ok: true },
    { label: "200 - górna granica", limit: 200, ok: true },
    { label: "0 (wartość FAŁSZYWA, ale PRAWIDŁOWA liczbowo)", limit: 0, ok: false },
    { label: "201 - ponad limit", limit: 201, ok: false },
    { label: "-1", limit: -1, ok: false },
    { label: "1.5 - nie całkowita", limit: 1.5, ok: false },
    { label: 'napis `"50"`', limit: "50", ok: false },
    { label: "`null`", limit: null, ok: false },
  ];

  it.each(LIMITS)("limit $label -> przyjęty: $ok", ({ limit, ok }) => {
    // Górny limit to ochrona rejestru: bez niego jedno żądanie wyciągnęłoby
    // do przeglądarki wszystkie dowody zgód najemcy.
    const result = ConsentDecisionsQuerySchema.safeParse({ limit });
    expect(result.success).toBe(ok);
  });

  const OFFSETS: readonly { label: string; offset: unknown; ok: boolean }[] = [
    { label: "0 - pierwsza strona", offset: 0, ok: true },
    { label: "50", offset: 50, ok: true },
    { label: "-1 - przed początkiem", offset: -1, ok: false },
    { label: "2.5", offset: 2.5, ok: false },
  ];

  it.each(OFFSETS)("offset $label -> przyjęty: $ok", ({ offset, ok }) => {
    expect(ConsentDecisionsQuerySchema.safeParse({ offset }).success).toBe(ok);
  });

  const SOURCES: readonly { label: string; source: unknown; parsed: unknown; ok: boolean }[] = [
    { label: "źródło podane", source: "banner", parsed: "banner", ok: true },
    { label: "`null` - dozwolone przez `nullish`", source: null, parsed: null, ok: true },
    {
      label: "`undefined` - dozwolone przez `nullish`",
      source: undefined,
      parsed: undefined,
      ok: true,
    },
    { label: "obcięte białe znaki", source: "  banner  ", parsed: "banner", ok: true },
    { label: "PUSTY napis - przechodzi walidację", source: "", parsed: "", ok: true },
    { label: "dłuższe niż 64 znaki", source: "s".repeat(65), parsed: undefined, ok: false },
    { label: "liczba", source: 7, parsed: undefined, ok: false },
  ];

  it.each(SOURCES)("źródło: $label", ({ source, parsed, ok }) => {
    const result = ConsentDecisionsQuerySchema.safeParse({ source });
    expect(result.success).toBe(ok);
    if (result.success) expect(result.data.source).toBe(parsed);
  });
});

describe("audyt zgód - schemat zapytania o statystyki", () => {
  it("brak wejścia daje okno 30 dni", () => {
    expect(ConsentStatsQuerySchema.parse({})).toEqual({ days: 30 });
  });

  const DAYS: readonly { label: string; days: unknown; ok: boolean }[] = [
    { label: "1 - dolna granica", days: 1, ok: true },
    { label: "365 - górna granica", days: 365, ok: true },
    { label: "0 (wartość FAŁSZYWA, ale PRAWIDŁOWA liczbowo)", days: 0, ok: false },
    { label: "366 - ponad rok", days: 366, ok: false },
    { label: "30.5", days: 30.5, ok: false },
    { label: 'napis `"30"`', days: "30", ok: false },
  ];

  it.each(DAYS)("okno $label -> przyjęte: $ok", ({ days, ok }) => {
    // Okno ma widełki, bo statystyki liczy się po zdarzeniach - „wszystko od
    // początku” to skan całego rejestru zgód najemcy.
    expect(ConsentStatsQuerySchema.safeParse({ days }).success).toBe(ok);
  });
});

// ---------------------------------------------------------------------------
// 3. `listConsentDecisions` - handler.
// ---------------------------------------------------------------------------

describe("audyt zgód - listConsentDecisions", () => {
  it("czyta WYŁĄCZNIE przez utwardzone RPC, z trzema parametrami", async () => {
    h.rpcResults.set("admin_consent_decisions", { data: [decisionRow()], error: null });
    await callServerFn(listConsentDecisions, {
      data: { limit: 25, offset: 50, source: "banner" },
      context: context(),
    });
    expect(h.rpcCalls.map((call) => call.name)).toEqual(["admin_consent_decisions"]);
    expect(rpcArgs()).toEqual({ p_limit: 25, p_offset: 50, p_source: "banner" });
  });

  const SOURCE_ARGS: readonly { label: string; input: Record<string, unknown>; sent: unknown }[] = [
    { label: "źródło podane jedzie jako filtr", input: { source: "banner" }, sent: "banner" },
    {
      label: "`null` ZNIKA z argumentów (`?? undefined`)",
      input: { source: null },
      sent: undefined,
    },
    { label: "brak pola też znika", input: {}, sent: undefined },
  ];

  it.each(SOURCE_ARGS)("$label", async ({ input, sent }) => {
    // `data.source ?? undefined`: `null` z interfejsu musi zamienić się
    // w `undefined`, bo PostgREST usuwa `undefined` z ciała żądania i RPC
    // używa DOMYŚLNEJ wartości parametru. `null` przesłany dosłownie
    // filtrowałby po źródle `NULL`, czyli pokazywał pustą listę.
    h.rpcResults.set("admin_consent_decisions", { data: [], error: null });
    await callServerFn(listConsentDecisions, { data: input, context: context() });
    expect(rpcArgs().p_source).toBe(sent);
    expect(Object.keys(rpcArgs()).sort()).toEqual(["p_limit", "p_offset", "p_source"]);
  });

  it("stan faktyczny: PUSTY napis jedzie jako filtr, nie jako brak filtra", async () => {
    // Wartość FAŁSZYWA, ALE PRAWIDŁOWA. `??` łapie tylko `null`/`undefined`,
    // więc `""` przechodzi i RPC dostaje filtr „źródło = ''”, czyli pustą
    // listę. DZIŚ to pułapka, a nie defekt: panel (`ConsentAuditSummary.tsx`)
    // nie wysyła `source` wcale. Test przypina stan faktyczny, żeby dodanie
    // do interfejsu selecta z opcją „wszystkie” jako `""` nie przeszło cicho.
    h.rpcResults.set("admin_consent_decisions", { data: [], error: null });
    await callServerFn(listConsentDecisions, { data: { source: "" }, context: context() });
    expect(rpcArgs().p_source).toBe("");
  });

  it("oddaje wiersze NIETKNIĘTE - ta sama tożsamość obiektu", async () => {
    // Niezmienność dowodu: handler nie mapuje, nie uzupełnia domyślnych i nie
    // przycina pól. Asercja na TOŻSAMOŚCI (`toBe`) jest tu mocniejsza niż na
    // kształcie - wyłapie nawet „nieszkodliwy” spread, który cicho gubiłby
    // pole dodane później w bazie.
    const row = decisionRow();
    h.rpcResults.set("admin_consent_decisions", { data: [row], error: null });
    const result = await callServerFn<ConsentDecisionRow[]>(listConsentDecisions, {
      data: {},
      context: context(),
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(row);
  });

  it("zachowuje wszystkie pola dowodu, w tym `gpc: false` i puste listy", async () => {
    // `gpc: false` to NIE to samo co brak sygnału (`null`), a pusta lista
    // zgód udzielonych to NIE to samo co brak decyzji. Wartości fałszywe,
    // ale prawidłowe - każda z nich znaczy w audycie coś innego.
    const row = decisionRow({
      gpc: false,
      granted_keys: [],
      denied_keys: [],
      source: null,
      banner_version: null,
      lang: null,
      email: null,
      display_name: null,
      page_url: null,
    });
    h.rpcResults.set("admin_consent_decisions", { data: [row], error: null });
    const result = await callServerFn<ConsentDecisionRow[]>(listConsentDecisions, {
      data: {},
      context: context(),
    });
    expect(result[0]).toEqual({
      decision_id: DECISION_ID,
      user_id: USER_ID,
      email: null,
      display_name: null,
      decided_at: "2026-03-15T12:00:00.000Z",
      source: null,
      banner_version: null,
      lang: null,
      gpc: false,
      page_url: null,
      granted_keys: [],
      denied_keys: [],
    });
  });

  const EMPTY_RESULTS: readonly { label: string; data: unknown }[] = [
    { label: "pusta lista", data: [] },
    { label: "`null` z PostgREST", data: null },
    { label: "`undefined`", data: undefined },
  ];

  it.each(EMPTY_RESULTS)("$label daje pustą tablicę", async ({ data }) => {
    // `(rows ?? [])` - panel dostaje tablicę, nie `null`. `null` w miejscu
    // listy wywala render tabeli, czyli cały ekran audytu.
    h.rpcResults.set("admin_consent_decisions", { data, error: null });
    const result = await callServerFn<ConsentDecisionRow[]>(listConsentDecisions, {
      data: {},
      context: context(),
    });
    expect(result).toEqual([]);
  });

  it("błąd RPC RZUCA z komunikatem bazy - nie oddaje pustej listy", async () => {
    // Pusta lista przy odmowie znaczyłaby „nikt nie wyraził zgody”, czyli
    // dokładną odwrotność prawdy. Odmowa musi być widoczna.
    h.rpcResults.set("admin_consent_decisions", {
      data: null,
      error: { message: "permission denied for function admin_consent_decisions" },
    });
    await expect(
      callServerFn(listConsentDecisions, { data: {}, context: context() }),
    ).rejects.toThrow("permission denied for function admin_consent_decisions");
  });

  it("wywołanie BEZ danych bierze domyślne widełki (`input ?? {}`)", async () => {
    // Tak wygląda pierwsze wejście na ekran audytu: `listConsentDecisions()`
    // bez argumentu. Gdyby walidator nie miał `?? {}`, Zod dostałby
    // `undefined` i ekran otwierałby się wyjątkiem, a nie listą.
    h.rpcResults.set("admin_consent_decisions", { data: [], error: null });
    await callServerFn(listConsentDecisions, { context: context() });
    expect(rpcArgs()).toEqual({ p_limit: 50, p_offset: 0, p_source: undefined });
  });

  it("odrzuca złe wejście PRZED wywołaniem RPC", async () => {
    // Walidator jest przed handlerem: żądanie o 5000 wierszy nie ma nawet
    // dotknąć bazy.
    await expect(
      callServerFn(listConsentDecisions, { data: { limit: 5000 }, context: context() }),
    ).rejects.toThrow();
    expect(h.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. `listConsentStats` - handler.
// ---------------------------------------------------------------------------

describe("audyt zgód - listConsentStats", () => {
  it("woła `admin_consent_stats` z jednym parametrem okna", async () => {
    h.rpcResults.set("admin_consent_stats", { data: [statRow()], error: null });
    await callServerFn(listConsentStats, { data: { days: 7 }, context: context() });
    expect(h.rpcCalls.map((call) => call.name)).toEqual(["admin_consent_stats"]);
    expect(rpcArgs()).toEqual({ p_days: 7 });
  });

  it("brak wejścia daje okno domyślne 30 dni", async () => {
    h.rpcResults.set("admin_consent_stats", { data: [], error: null });
    await callServerFn(listConsentStats, { context: context() });
    expect(rpcArgs()).toEqual({ p_days: 30 });
  });

  it("liczniki ZEROWE przechodzą jako zera, nie jako brak danych", async () => {
    // Wartość FAŁSZYWA, ale PRAWIDŁOWA: „zero zgód udzielonych” to wynik,
    // a nie brak wyniku. Zgubienie zera zamieniłoby wiersz statystyki
    // w pustkę i ukryło kategorię, której nikt nie akceptuje.
    const row = statRow({
      granted: 0,
      denied: 0,
      gpc_events: 0,
      last_event_at: null,
      banner_versions: [],
    });
    h.rpcResults.set("admin_consent_stats", { data: [row], error: null });
    const result = await callServerFn<ConsentStatRow[]>(listConsentStats, {
      data: {},
      context: context(),
    });
    expect(result[0]).toBe(row);
    expect(result[0]?.granted).toBe(0);
    expect(result[0]?.last_event_at).toBeNull();
  });

  it.each([
    { label: "pusta lista", data: [] },
    { label: "`null` z PostgREST", data: null },
  ])("$label daje pustą tablicę", async ({ data }) => {
    h.rpcResults.set("admin_consent_stats", { data, error: null });
    const result = await callServerFn<ConsentStatRow[]>(listConsentStats, {
      data: {},
      context: context(),
    });
    expect(result).toEqual([]);
  });

  it("błąd RPC RZUCA z komunikatem bazy", async () => {
    h.rpcResults.set("admin_consent_stats", {
      data: null,
      error: { message: "not_authorized" },
    });
    await expect(callServerFn(listConsentStats, { data: {}, context: context() })).rejects.toThrow(
      "not_authorized",
    );
  });

  it("odrzuca okno poza widełkami PRZED wywołaniem RPC", async () => {
    await expect(
      callServerFn(listConsentStats, { data: { days: 3650 }, context: context() }),
    ).rejects.toThrow();
    expect(h.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. HIGIENA FIXTURE'ÓW (RODO) - reguła dla tego pliku, nie dla produkcji.
// ---------------------------------------------------------------------------

describe("audyt zgód - higiena danych w fixture'ach", () => {
  /** Pule dokumentacyjne RFC 5737 - jedyne adresy IP dopuszczone w testach. */
  const DOC_IP_PREFIXES = ["192.0.2.", "198.51.100.", "203.0.113."] as const;

  it("fixture'y nie zawierają adresu e-mail poza domenami zarezerwowanymi", () => {
    // Ekran audytu zgód jest naturalnym miejscem, w którym ktoś odtwarzając
    // zgłoszenie wklei prawdziwy wiersz z produkcji. Ta asercja to zapora.
    const serialized = JSON.stringify([decisionRow(), statRow()]);
    const emails = serialized.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email.endsWith("example.com") || email.endsWith("example.org")).toBe(true);
    }
  });

  it("fixture'y nie zawierają adresu IP poza pulami RFC 5737", () => {
    const serialized = JSON.stringify([decisionRow(), statRow()]);
    const ips = serialized.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    for (const ip of ips) {
      expect(DOC_IP_PREFIXES.some((prefix) => ip.startsWith(prefix))).toBe(true);
    }
  });
});
