// SKRZYNKA WYSYŁEK PANELU ADMINA - WARSTWA SERWEROWA
// (`src/lib/admin/emailOutbox.functions.ts`), która przed tym plikiem miała
// ZERO pokrycia: jedyny test w tym obszarze (`emailOutboxPanel.test.tsx`)
// mockuje `getEmailOutbox: {}`, więc nie wykonywał ani jednej jej linii.
//
// PO CO TO JEST WAŻNE. To jedyne okno operatora na `email_send_log` - dziennik
// mówiący, czy zaproszenie/reset hasła w ogóle wyszedł. Liczby z tej funkcji
// idą do panelu bez żadnej dalszej weryfikacji, więc przedmiotem dowodu są
// trzy rzeczy, na których panel stoi:
//   1. OKNO CZASU jest jedynym zawężeniem odczytu - jeśli handler zgubi `gte`
//      albo `lte`, panel pokaże wysyłki spoza wybranego zakresu i „dziś nic nie
//      poszło" będzie nieodróżnialne od „poszło tydzień temu";
//   2. DEDUPLIKACJA po `message_id` - jedna wiadomość zostawia w dzienniku
//      kilka wierszy ('pending' -> 'sent'/'dlq'), więc bez niej statystyki są
//      zawyżone dwu-, trzykrotnie, a wiersz bez `message_id` (wpis, który nigdy
//      nie dotarł do dostawcy) MUSI zostać osobną pozycją, nie zlepkiem;
//   3. `truncated` - liczby są przybliżeniem dokładnie wtedy, gdy dziennik był
//      dłuższy niż okno odczytu. Fałszywe `false` każe operatorowi ufać sumom,
//      które nie opisują całości.
//
// ATRAPA NAPRAWDĘ FILTRUJE. `respondFiltering` czyta ZAPISANE ogniwa łańcucha
// (`gte`/`lte`/`eq`/`limit`) i stosuje je do wierszy, zamiast oddawać stałą.
// Bez tego test „na okno czasu" przechodziłby również dla handlera, który
// żadnego okna nie stawia - czyli nie dowodziłby niczego.
//
// CZEGO TEN HARNESS NIE UDAJE. `@/test/serverFnHarness` NIE uruchamia
// middleware (patrz jego nagłówek), więc odmowy dla użytkownika bez roli nie da
// się tu odegrać. Bramka jest sprawdzana STRUKTURALNIE - jej usunięcie z kodu
// wywraca sekcję 1.
//
// RODO: żadnych prawdziwych danych osobowych - adresy wyłącznie w `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ db: null as SupabaseFromStub | null }));

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

/** Kontekst, jaki middleware wstrzykuje w produkcji. */
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

/** Wiersz dziennika w kształcie tabeli (snake_case). */
function logRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "row-1",
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
// 4. ZAKRES DANYCH - stan zastany, opisany testem.
// --------------------------------------------------------------------------
describe("zakres najemcy", () => {
  // TRIPWIRE, NIE APROBATA. Ten test opisuje LUKĘ: dziennik nie ma dziś kolumny
  // `tenant_id` (20260728154925_email_infra.sql:27-36), więc zapytanie zawęża
  // się WYŁĄCZNIE oknem czasu i admin jednego najemcy czyta wysyłki wszystkich.
  // Gdy kolumna wejdzie i handler dostanie `.eq("tenant_id", …)`, ten test MA
  // paść - wtedy zamień go na asercję, że łańcuch niesie filtr najemcy
  // wywołującego, a wiersz obcego najemcy nie wychodzi w wyniku.
  it("dziś zapytanie NIE niesie granicy najemcy (do zamiany po migracji)", async () => {
    db().setResponse(LOG, respondFiltering([logRow()]));

    await call();

    const zawezenia = chain()
      .calls.filter((c) => ["eq", "in", "or", "filter", "match", "contains"].includes(c.method))
      .map((c) => c.method);
    expect(zawezenia).toEqual([]);
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
