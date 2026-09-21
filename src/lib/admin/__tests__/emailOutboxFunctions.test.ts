// SKRZYNKA WYSYŁEK PANELU ADMINA - WARSTWA SERWEROWA
// (`src/lib/admin/emailOutbox.functions.ts`), która przed tym plikiem miała
// ZERO pokrycia: jedyny test w tym obszarze (`emailOutboxPanel.test.tsx`)
// mockuje `getEmailOutbox: {}`, więc nie wykonywał ani jednej jej linii.
//
// PO CO TO JEST WAŻNE. To jedyne okno operatora na `email_send_log` - dziennik
// mówiący, czy zaproszenie/reset hasła w ogóle wyszedł. Liczby z tej funkcji
// idą do panelu bez żadnej dalszej weryfikacji, więc przedmiotem dowodu są
// cztery rzeczy, na których panel stoi:
//   1. GRANICA NAJEMCY - odczyt idzie kluczem serwisowym, który RLS OMIJA,
//      a `requireAdminEditor` potwierdza samą ROLĘ. Rola w obszarze A nie jest
//      zgodą na dane obszaru B, więc filtr `.eq("tenant_id", …)` jest tu
//      JEDYNĄ granicą autoryzacji: bez niego admin jednego najemcy czyta adresy
//      odbiorców, nazwy szablonów i komunikaty błędów dostawcy WSZYSTKICH
//      najemców (sekcja 4);
//   2. OKNO CZASU - drugie zawężenie odczytu; jeśli handler zgubi `gte`
//      albo `lte`, panel pokaże wysyłki spoza wybranego zakresu i „dziś nic nie
//      poszło" będzie nieodróżnialne od „poszło tydzień temu";
//   3. DEDUPLIKACJA po `message_id` - jedna wiadomość zostawia w dzienniku
//      kilka wierszy ('pending' -> 'sent'/'dlq'), więc bez niej statystyki są
//      zawyżone dwu-, trzykrotnie, a wiersz bez `message_id` (wpis, który nigdy
//      nie dotarł do dostawcy) MUSI zostać osobną pozycją, nie zlepkiem;
//   4. `truncated` - liczby są przybliżeniem dokładnie wtedy, gdy dziennik był
//      dłuższy niż okno odczytu. Fałszywe `false` każe operatorowi ufać sumom,
//      które nie opisują całości.
//
// ŻADNEJ GAŁĘZI WYJĄTKU DLA `super_admin` - i dlatego NIE MA tu testu, który
// by takiej gałęzi oczekiwał. `super_admin` jest w tym schemacie rolą PER
// NAJEMCA (`user_roles.tenant_id` NOT NULL), a `is_super_admin()` jest zawężone
// do `current_tenant_id()`. Wyjątek „super admin widzi wszystkich" nie byłby
// więc udogodnieniem dla operatora platformy, tylko odtworzeniem dokładnie tej
// dziury, którą sekcja 4 zamyka - dla każdego, kto ma `super_admin` we własnym
// obszarze roboczym.
//
// ATRAPA NAPRAWDĘ FILTRUJE. `respondFiltering` czyta ZAPISANE ogniwa łańcucha
// (`gte`/`lte`/`eq`/`limit`) i stosuje je do wierszy, zamiast oddawać stałą.
// Bez tego test „na okno czasu" przechodziłby również dla handlera, który
// żadnego okna nie stawia - czyli nie dowodziłby niczego. Z tego samego powodu
// wiersze niosą `tenant_id`: granica najemcy jest sprawdzana na DANYCH, które
// wychodzą z funkcji, a nie wyłącznie na kształcie zapytania.
//
// CZEGO TEN HARNESS NIE UDAJE. `@/test/serverFnHarness` NIE uruchamia
// middleware (patrz jego nagłówek), więc odmowy dla użytkownika bez roli nie da
// się tu odegrać. Bramka jest sprawdzana STRUKTURALNIE - jej usunięcie z kodu
// wywraca sekcję 1.
//
// RODO: żadnych prawdziwych danych osobowych - adresy wyłącznie w `example.com`
// i `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Najemca, jakiego oddaje bramka - testy granicy podmieniają go na obcego. */
  callerTenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Gdy ustawione, bramka ODMAWIA tym komunikatem zamiast oddać najemcę. */
  tenantRefusal: null as string | null,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdminEditor: { name: "requireAdminEditor" },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));

// BRAMKA NAJEMCY NA SWOJEJ GRANICY. Atrapa stoi na MODULE `userTenant.server`,
// a nie na tabeli `profiles`, bo przedmiotem dowodu TEGO pliku nie jest to, jak
// `resolveUserTenantId` czyta profil (dowodzi tego jego własny test), tylko to,
// że handler UŻYWA jej wyniku jako zakresu zapytania i odmawia pracy, gdy ona
// rzuca.
//
// To ten sam helper, którego używa `fetchSystemEmailReport` - drugi panel
// czytający ten sam dziennik tym samym kluczem serwisowym. Granica ma tu mieć
// jedną definicję, a nie dwie.
vi.mock("@/lib/server/userTenant.server", () => ({
  resolveUserTenantId: async (): Promise<string> => {
    if (h.tenantRefusal) throw new Error(h.tenantRefusal);
    return h.callerTenantId;
  },
}));

import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";
import { getEmailOutbox, type OutboxResult } from "@/lib/admin/emailOutbox.functions";

const LOG = "email_send_log";
/** Ustalone „teraz" - domyślne okno liczy się od niego wstecz. */
const NOW = new Date("2026-08-18T12:00:00.000Z");

/** Najemca WOŁAJĄCEGO: domyślna odpowiedź bramki i domyślny zakres wierszy. */
const TENANT_A = h.callerTenantId;
/** Najemca OBCY - jego wiersze nie mają prawa wyjść z tej funkcji. */
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Kontekst, jaki middleware wstrzykuje w produkcji. `supabase` zostaje `null`
 * świadomie: jedynym odbiorcą klienta użytkownika jest `resolveUserTenantId`,
 * a ta stoi tu jako atrapa modułu - handler nie wykonuje na nim zapytania.
 */
const CONTEXT: ServerFnContext = {
  supabase: null,
  userId: "11111111-1111-4111-8111-111111111111",
};

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
  return h.db;
}

function chain(): RecordedChain {
  const last = db().lastChain(LOG);
  if (!last) throw new Error(`test: brak zapytania do tabeli "${LOG}"`);
  return last;
}

/**
 * Wiersz dziennika w kształcie tabeli (snake_case). `tenant_id` domyślnie
 * należy do WOŁAJĄCEGO - inaczej filtr najemcy odcinałby każdy wiersz i testy
 * niżej mówiłyby wyłącznie o pustym wyniku. Kolumny nie ma w `select`
 * handlera; jest tu po to, żeby atrapa miała na czym wykonać `.eq(...)`.
 */
function logRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "row-1",
    tenant_id: TENANT_A,
    message_id: "msg-1",
    template_name: "password_reset",
    recipient_email: "anna@example.com",
    status: "sent",
    error_message: null,
    created_at: "2026-08-18T09:00:00.000Z",
    ...overrides,
  };
}

/**
 * Odpowiedź atrapy, która STOSUJE zapisane ogniwa łańcucha do wierszy.
 * Handler, który zgubi filtr okna, dostanie tu wiersze spoza okna - i test
 * padnie na wyniku, a nie dopiero na asercji o kształcie zapytania.
 */
function respondFiltering(rows: Record<string, unknown>[]) {
  return (recorded: RecordedChain): SupabaseResult => {
    let out = [...rows];
    for (const call of recorded.calls) {
      // Bez rzutowań: ogniwo zapisuje argumenty jako `unknown[]`, a nazwa
      // kolumny jest pierwszym z nich.
      const column = String(call.args[0]);
      const value = call.args[1];
      if (call.method === "gte") out = out.filter((r) => String(r[column]) >= String(value));
      else if (call.method === "lte") out = out.filter((r) => String(r[column]) <= String(value));
      else if (call.method === "eq") out = out.filter((r) => r[column] === value);
      else if (call.method === "limit") out = out.slice(0, Number(call.args[0]));
    }
    return ok(out);
  };
}

async function call(data?: unknown): Promise<OutboxResult> {
  return callServerFn<OutboxResult>(getEmailOutbox, { data, context: CONTEXT });
}

beforeEach(() => {
  h.db = supabaseFromStub();
  // Bramka wraca do stanu „najemca wołającego rozstrzygnięty": sekcja 4
  // podmienia obie te wartości, a wyciek takiej podmiany do kolejnego testu
  // dałby zielone testy mówiące o czymś innym niż ich nazwa.
  h.callerTenantId = TENANT_A;
  h.tenantRefusal = null;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  h.db = null;
});

// --------------------------------------------------------------------------
// 1. BRAMKA - dowód strukturalny (harness nie uruchamia middleware).
// --------------------------------------------------------------------------
describe("bramka funkcji", () => {
  it("deklaruje `requireAdminEditor`, a nie samo uwierzytelnienie", () => {
    expect(serverFnMiddlewareNames(getEmailOutbox)).toEqual(["requireAdminEditor"]);
  });
});

// --------------------------------------------------------------------------
// 2. WALIDATOR - co zostaje odrzucone, zanim cokolwiek pójdzie do bazy.
// --------------------------------------------------------------------------
describe("walidator wejścia", () => {
  it("wywołanie bez argumentów dostaje komplet wartości domyślnych", () => {
    expect(validateServerFnInput(getEmailOutbox, undefined)).toEqual({
      from: null,
      to: null,
      days: 7,
      template: null,
      status: null,
      search: null,
      page: 1,
    });
  });

  it.each([
    ["strona zerowa", { page: 0 }],
    ["okno dłuższe niż rok", { days: 366 }],
    ["okno zerowe", { days: 0 }],
    ["data początku nie w ISO", { from: "wczoraj" }],
    ["fraza dłuższa niż 200 znaków", { search: "x".repeat(201) }],
  ])("odrzuca: %s", (_nazwa, data) => {
    expect(() => validateServerFnInput(getEmailOutbox, data)).toThrow(ZodError);
  });
});

// --------------------------------------------------------------------------
// 3. OKNO CZASU I KSZTAŁT ZAPYTANIA.
// --------------------------------------------------------------------------
describe("okno czasu", () => {
  it("domyślnie czyta siedem dni wstecz od teraz i odcina wiersze spoza okna", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "w-oknie", message_id: "a", created_at: "2026-08-17T09:00:00.000Z" }),
        logRow({ id: "stary", message_id: "b", created_at: "2026-07-01T09:00:00.000Z" }),
      ]),
    );

    const result = await call();

    expect(result.rows.map((r) => r.id)).toEqual(["w-oknie"]);
    expect(chain().argsOf("gte")).toEqual(["created_at", "2026-08-11T12:00:00.000Z"]);
    expect(chain().argsOf("lte")).toEqual(["created_at", "2026-08-18T12:00:00.000Z"]);
  });

  it("jawny początek zakresu ma pierwszeństwo przed presetem dni", async () => {
    db().setResponse(LOG, respondFiltering([]));

    await call({ from: "2026-08-16T00:00:00.000Z", days: 365 });

    expect(chain().argsOf("gte")).toEqual(["created_at", "2026-08-16T00:00:00.000Z"]);
  });

  it("jawny koniec zakresu przesuwa też początek liczony z dni", async () => {
    db().setResponse(LOG, respondFiltering([]));

    await call({ to: "2026-08-10T00:00:00.000Z", days: 2 });

    expect(chain().argsOf("gte")).toEqual(["created_at", "2026-08-08T00:00:00.000Z"]);
    expect(chain().argsOf("lte")).toEqual(["created_at", "2026-08-10T00:00:00.000Z"]);
  });

  it("czyta tylko kolumny panelu, najnowsze pierwsze, z twardym limitem odczytu", async () => {
    db().setResponse(LOG, respondFiltering([]));

    await call();

    expect(chain().argsOf("select")).toEqual([
      "id, message_id, template_name, recipient_email, status, error_message, created_at",
    ]);
    expect(chain().argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain().argsOf("limit")).toEqual([5000]);
  });
});

// --------------------------------------------------------------------------
// 4. GRANICA NAJEMCY - jedyna granica autoryzacji tego odczytu.
// --------------------------------------------------------------------------
describe("granica najemcy", () => {
  // DEFEKT ZAMKNIĘTY W KODZIE PRODUKCYJNYM - ta sekcja zastąpiła test-tripwire,
  // który wcześniej OPISYWAŁ lukę („zapytanie NIE niesie granicy najemcy") i
  // miał paść po migracji. Dziennik ma już `tenant_id`
  // (20260913101000_email_log_tenant_scope.sql, wypełniany przez producentów
  // i trigger z 20260913140000), a handler zawęża po najemcy WOŁAJĄCEGO.
  // Asercje idą więc w dwie strony naraz: kształt zapytania ORAZ dane, które
  // z funkcji wychodzą - sam kontrakt łańcucha nie wykluczyłby handlera
  // filtrującego po czymś, co do wyniku i tak nie trafia.

  it("admin najemcy A NIE widzi wiersza najemcy B", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "moj", message_id: "a" }),
        logRow({
          id: "obcy",
          message_id: "b",
          tenant_id: TENANT_B,
          template_name: "szablon_obcego",
          recipient_email: "obcy@example.org",
        }),
      ]),
    );

    const result = await call();

    expect(result.rows.map((r) => r.id)).toEqual(["moj"]);
    // Statystyki i lista szablonów liczą się z TEGO SAMEGO odczytu, więc obcy
    // wiersz nie ma prawa przeciekać także tamtędy: nazwa szablonu innego
    // najemcy w liście wyboru to już wyciek, nawet bez adresu odbiorcy.
    expect(result.stats.total).toBe(1);
    expect(result.total).toBe(1);
    expect(result.templates).toEqual(["password_reset"]);
  });

  it("zapytanie niesie najemcę Z BRAMKI, a nie stałą z tego pliku", async () => {
    // Podmiana wartości oddawanej przez bramkę rozdziela dwie hipotezy: filtr
    // wpisany na sztywno (albo wzięty z wejścia czy z hosta) pokazałby dalej
    // najemcę A i oddał jego wiersze.
    h.callerTenantId = TENANT_B;
    db().setResponse(LOG, respondFiltering([logRow()]));

    const result = await call();

    expect(chain().argsOf("eq")).toEqual(["tenant_id", TENANT_B]);
    expect(result.rows).toEqual([]);
  });

  it("wiersz z `tenant_id` NULL jest NIEWIDOCZNY, a nie widoczny dla wszystkich", async () => {
    // `.eq(...)` nie dopasowuje NULL-a i to jest tu DECYZJA, nie skutek
    // uboczny: wiersz, któremu ani producent, ani kaskada po adresie odbiorcy
    // nie umiały przypisać najemcy (adres obecny w dwóch organizacjach albo
    // nieznany katalogowi), ma zniknąć WSZYSTKIM - ta sama reguła „fail
    // closed", co w obu migracjach i w polityce `email_send_log_admin_select`.
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "przypisany", message_id: "a" }),
        logRow({ id: "sierota", message_id: "b", tenant_id: null }),
      ]),
    );

    const result = await call();

    expect(result.rows.map((r) => r.id)).toEqual(["przypisany"]);
    expect(result.stats.total).toBe(1);
  });

  it("odmowa bramki najemcy to ZERO zapytań do dziennika", async () => {
    // `resolveUserTenantId` rzuca tym jednym komunikatem zarówno przy braku
    // wiersza profilu, jak i przy błędzie odczytu - obie gałęzie są u niej
    // nierozróżnialne z założenia (fail closed), więc tutaj jest jeden przypadek.
    const komunikat = "No tenant for current user";
    // Kolejność w handlerze jest tu całym zabezpieczeniem: najemca rozstrzyga
    // się PRZED importem klienta serwisowego, więc „nie wiem, czyje to dane"
    // nie może zamienić się w odczyt bez filtra. Atrapa bazy nie ma tu żadnej
    // zaplanowanej odpowiedzi - każde zapytanie zostawiłoby ślad w `chains`.
    // Same komunikaty należą do bramki i są dowodzone w jej własnym teście;
    // tutaj liczy się to, że handler ich nie połyka.
    h.tenantRefusal = komunikat;

    await expect(call()).rejects.toThrow(komunikat);
    expect(db().chains).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 4b. DEFEKT ZGŁOSZONY, NIE NAPRAWIONY (konwencja repo: produkcja bez zmian).
// --------------------------------------------------------------------------
describe("skrzynka wysyłek - defekt zgłoszony", () => {
  it.fails("DEFEKT: bramka wpuszcza `editor`, a baza dla tej tabeli wpuszcza tylko `admin`", () => {
    // CO JEST ZŁE. Ta funkcja stoi za `requireAdminEditor`, czyli zbiorem
    // `["admin", "editor", "super_admin"]` (`require-staff.ts`). Tymczasem
    // polityka RLS tej samej tabeli - `email_send_log_admin_select`
    // (20260913101000:167-176) - dopuszcza WYŁĄCZNIE `admin` albo
    // `super_admin`, a jej migracja uzasadnia to wprost: „paneli dziennika
    // pilnuje `requireAdmin` […] autor treści nie ma do nich wstępu i nie ma
    // powodu, żeby baza dawała mu więcej niż aplikacja". Bliźniaczy panel
    // (`fetchSystemEmailReport`) faktycznie używa `requireAdmin`.
    //
    // KONSEKWENCJA. Odczyt idzie kluczem serwisowym, który RLS OMIJA, więc to
    // bramka aplikacji JEST tu jedyną kontrolą roli. `editor` czyta w efekcie
    // surowe adresy odbiorców, nazwy szablonów i komunikaty błędów dostawcy -
    // czyli dane, których baza by mu odmówiła, gdyby pytał własnym kluczem.
    // Granicę NAJEMCY zamyka sekcja 4; to jest osobna, węższa dziura: zły
    // ZAKRES RÓL w obrębie własnego najemcy.
    //
    // DLACZEGO NIE NAPRAWIONE TUTAJ. Zamiana na `requireAdmin` odbiera dostęp
    // roli, która dziś ten panel widzi w nawigacji (`adminNav.ts`, grupa CRM,
    // bez własnego zawężenia roli), więc jest decyzją produktową, nie
    // poprawką testu: albo panel przestaje być dla edytorów, albo polityka RLS
    // ma świadomie dopuścić `editor`. Obie drogi zmieniają zachowanie poza
    // zakresem tego zlecenia.
    expect(serverFnMiddlewareNames(getEmailOutbox)).toEqual(["requireAdmin"]);
  });
});

// --------------------------------------------------------------------------
// 5. DEDUPLIKACJA.
// --------------------------------------------------------------------------
describe("deduplikacja po identyfikatorze wiadomości", () => {
  it("kilka wierszy jednej wiadomości to JEDNA pozycja - w stanie najnowszym", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({
          id: "r1",
          message_id: "msg-1",
          status: "pending",
          created_at: "2026-08-18T09:00:00.000Z",
        }),
        logRow({
          id: "r2",
          message_id: "msg-1",
          status: "dlq",
          created_at: "2026-08-18T09:05:00.000Z",
        }),
      ]),
    );

    const result = await call();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "r2", status: "dlq" });
    expect(result.stats).toMatchObject({ total: 1, failed: 1, pending: 0 });
  });

  it("kolejność wejścia nie ma znaczenia - wygrywa nowsza data, nie ostatni wiersz", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({
          id: "r2",
          message_id: "msg-1",
          status: "sent",
          created_at: "2026-08-18T09:05:00.000Z",
        }),
        logRow({
          id: "r1",
          message_id: "msg-1",
          status: "pending",
          created_at: "2026-08-18T09:00:00.000Z",
        }),
      ]),
    );

    const result = await call();

    expect(result.rows[0]).toMatchObject({ id: "r2", status: "sent" });
  });

  it("wiersze BEZ message_id zostają osobnymi pozycjami, a nie jedną", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "r1", message_id: null, status: "failed" }),
        logRow({ id: "r2", message_id: null, status: "failed" }),
      ]),
    );

    const result = await call();

    expect(result.rows.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    expect(result.stats.total).toBe(2);
  });

  it("wynik jest posortowany malejąco po dacie, niezależnie od kolejności z bazy", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "stary", message_id: "a", created_at: "2026-08-16T09:00:00.000Z" }),
        logRow({ id: "nowy", message_id: "b", created_at: "2026-08-18T09:00:00.000Z" }),
      ]),
    );

    const result = await call();

    expect(result.rows.map((r) => r.id)).toEqual(["nowy", "stary"]);
  });
});

// --------------------------------------------------------------------------
// 6. STATYSTYKI I LISTA SZABLONÓW.
// --------------------------------------------------------------------------
describe("statystyki", () => {
  it("każdy status trafia do swojego wiadra, porażki do wspólnego", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "1", message_id: "a", status: "sent" }),
        logRow({ id: "2", message_id: "b", status: "pending" }),
        logRow({ id: "3", message_id: "c", status: "suppressed" }),
        logRow({ id: "4", message_id: "d", status: "failed" }),
        logRow({ id: "5", message_id: "e", status: "dlq" }),
        logRow({ id: "6", message_id: "f", status: "bounced" }),
      ]),
    );

    const result = await call();

    expect(result.stats).toEqual({ total: 6, sent: 1, pending: 1, suppressed: 1, failed: 3 });
  });

  it("lista szablonów jest bez powtórzeń i posortowana", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "1", message_id: "a", template_name: "welcome" }),
        logRow({ id: "2", message_id: "b", template_name: "password_reset" }),
        logRow({ id: "3", message_id: "c", template_name: "welcome" }),
      ]),
    );

    const result = await call();

    expect(result.templates).toEqual(["password_reset", "welcome"]);
  });

  it("lista szablonów opisuje CAŁE okno, nie przefiltrowaną stronę", async () => {
    db().setResponse(
      LOG,
      respondFiltering([
        logRow({ id: "1", message_id: "a", template_name: "welcome" }),
        logRow({ id: "2", message_id: "b", template_name: "password_reset" }),
      ]),
    );

    const result = await call({ template: "welcome" });

    // Inaczej filtr po szablonie wyczyściłby operatorowi listę wyboru.
    expect(result.templates).toEqual(["password_reset", "welcome"]);
    expect(result.rows).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------
// 7. FILTRY PANELU I STRONICOWANIE.
// --------------------------------------------------------------------------
describe("filtry i stronicowanie", () => {
  const rows = [
    logRow({
      id: "1",
      message_id: "a",
      template_name: "welcome",
      status: "sent",
      recipient_email: "Anna@Example.com",
    }),
    logRow({
      id: "2",
      message_id: "b",
      template_name: "password_reset",
      status: "dlq",
      recipient_email: "borys@example.com",
    }),
    logRow({
      id: "3",
      message_id: "c",
      template_name: "welcome",
      status: "sent",
      recipient_email: "cezary@example.com",
    }),
  ];

  it("filtruje po szablonie", async () => {
    db().setResponse(LOG, respondFiltering(rows));

    const result = await call({ template: "welcome" });

    expect(result.rows.map((r) => r.id).sort()).toEqual(["1", "3"]);
    expect(result.total).toBe(2);
  });

  it("filtruje po statusie DOSŁOWNIE", async () => {
    db().setResponse(LOG, respondFiltering(rows));

    const result = await call({ status: "dlq" });

    expect(result.rows.map((r) => r.id)).toEqual(["2"]);
  });

  it("szuka po adresie bez względu na wielkość liter i otaczające spacje", async () => {
    db().setResponse(LOG, respondFiltering(rows));

    const result = await call({ search: "  ANNA@  " });

    expect(result.rows.map((r) => r.id)).toEqual(["1"]);
    expect(result.total).toBe(1);
  });

  it("statystyki IDĄ za filtrem - opisują to, co operator widzi", async () => {
    db().setResponse(LOG, respondFiltering(rows));

    const result = await call({ status: "sent" });

    expect(result.stats).toEqual({ total: 2, sent: 2, pending: 0, suppressed: 0, failed: 0 });
  });

  it("strona druga bierze wiersze od 51. i zachowuje pełny licznik", async () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      logRow({
        id: `r${i}`,
        message_id: `m${i}`,
        // Malejąco po dacie: r0 najnowszy, r54 najstarszy.
        created_at: new Date(Date.parse("2026-08-18T09:00:00.000Z") - i * 60_000).toISOString(),
      }),
    );
    db().setResponse(LOG, respondFiltering(many));

    const page2 = await call({ page: 2 });

    expect(page2.pageSize).toBe(50);
    expect(page2.rows).toHaveLength(5);
    expect(page2.rows[0]?.id).toBe("r50");
    expect(page2.total).toBe(55);
  });
});

// --------------------------------------------------------------------------
// 8. PRZYBLIŻENIE LICZB I BŁĄD ODCZYTU.
// --------------------------------------------------------------------------
describe("granica okna odczytu", () => {
  it("pełne okno odczytu oznacza liczby PRZYBLIŻONE", async () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      logRow({ id: `r${i}`, message_id: `m${i}` }),
    );
    db().setResponse(LOG, respondFiltering(many));

    const result = await call();

    expect(result.truncated).toBe(true);
  });

  it("krótszy dziennik to liczby DOKŁADNE", async () => {
    db().setResponse(LOG, respondFiltering([logRow()]));

    const result = await call();

    expect(result.truncated).toBe(false);
  });

  it("błąd odczytu leci w górę z komunikatem bazy - nie jako pusta skrzynka", async () => {
    db().setResponse(LOG, fail("permission denied for table email_send_log", "42501"));

    await expect(call()).rejects.toThrow(/permission denied/);
  });

  it("brak wierszy to pusty wynik, a nie wyjątek", async () => {
    db().setResponse(LOG, ok(null));

    const result = await call();

    expect(result).toMatchObject({
      rows: [],
      total: 0,
      page: 1,
      truncated: false,
      templates: [],
    });
    expect(result.stats.total).toBe(0);
  });
});
