// DZIENNIK ZDARZEŃ OPERATORA PŁATNOŚCI - idempotencja webhooka i ślad audytu.
//
// JAKIE RYZYKO PILNUJE TEN PLIK. `claimWebhookEvent` decyduje, czy zdarzenie
// od operatora zostanie przetworzone. Pomyłka w JEDNĄ stronę to podwójne
// wykonanie (drugi bilet, drugi mail „dziękujemy za płatność", podwójny wpis w
// CRM). Pomyłka w DRUGĄ jest gorsza: ponowna dostawa zdarzenia, które
// wcześniej padło, zostaje uznana za duplikat - klient zapłacił, a uprawnienia
// nie dostał nigdy, bo operator po odpowiedzi 200 przestaje ponawiać.
//
// Dlatego pilnujemy każdej gałęzi decyzji osobno - a decyzja ma TRZY wyniki,
// nie dwa (`claimed` / `done` / `in_progress`):
//   * nowe zdarzenie -> wiersz `received` z kompletem kluczy audytu, `claimed`,
//   * duplikat domknięty (`processed`/`skipped`) -> `done`, bez zapisu,
//   * duplikat w toku (`received`, od OSTATNIEGO PRZEJĘCIA nie minęło 5 min)
//     -> `in_progress`, bo właśnie obsługuje je ktoś inny; wiek liczy się od
//     `last_retried_at`, a dopiero bez niego od `created_at`,
//   * duplikat porzucony (`received` po oknie) albo `failed` -> PRZEJĘCIE:
//     licznik prób +1, wyczyszczony błąd, świeży ładunek - i zapis zawężony do
//     TEGO wiersza (`id`) w stanie właśnie odczytanym (status i licznik prób);
//     przegrany wyścig o przejęcie (0 wierszy) -> `in_progress`,
//   * awaria bazy na każdym kroku -> wyjątek z nazwą kroku (trasa webhooka
//     odpowiada wtedy 503 i NIE obsługuje zdarzenia), nigdy cichy wynik.
// `finishWebhookEvent` domyka wiersz i NIGDY nie rzuca - awaria dziennika nie
// może zamienić obsłużonego zdarzenia w 500 i ponowną dostawę.
//
// GRANICA ATRAP: wyłącznie klient roli serwisowej Supabase. Zegar zamrożony -
// okno „porzucenia" liczy się od `Date.now()`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  webhookEvent,
  type RecordedChain,
  type SupabaseResult,
} from "@/test/billing/fixtures";
import { FIXED_NOW_ISO, MINUTA, SEKUNDA, freezeClock, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));

import {
  claimWebhookEvent,
  finishWebhookEvent,
  isAbandonedClaim,
  reclaimWebhookEventRow,
} from "@/lib/billing/webhookLog.server";

freezeClock();

const TABLE = "payment_webhook_events";
const db = supabaseFromStub();

/**
 * Odpowiedzi bazy per krok: INSERT rezerwacji, odczyt duplikatu, warunkowy
 * UPDATE przejęcia (RETURNING - wygrany wyścig to jeden wiersz) i UPDATE
 * domknięcia.
 */
interface Plan {
  insert?: SupabaseResult;
  lookup?: SupabaseResult;
  reclaim?: SupabaseResult;
  finish?: SupabaseResult;
}

function plan(p: Plan) {
  db.setResponse(TABLE, (chain: RecordedChain) => {
    if (chain.has("insert")) return p.insert ?? ok(null);
    if (chain.has("maybeSingle")) return p.lookup ?? ok(null);
    if (chain.has("update") && chain.has("select")) return p.reclaim ?? ok([{ id: "row-won" }]);
    if (chain.has("update")) return p.finish ?? ok(null);
    return fail(`test: nieoczekiwany łańcuch na ${TABLE}`);
  });
}

const DUPLICATE = fail('duplicate key value violates unique constraint "uq_event"', "23505");

const REF = {
  eventId: "evt_test_1",
  eventType: "transaction.completed",
  environment: "live" as const,
};

const chainsWith = (method: string) => db.chainsFor(TABLE).filter((c) => c.has(method));
const eqFilters = (chain: RecordedChain) =>
  chain.calls.filter((c) => c.method === "eq").map((c) => c.args);

beforeEach(() => {
  db.reset();
  h.db.current = db;
});

describe("claimWebhookEvent - rezerwacja zdarzenia", () => {
  it("nowe zdarzenie: wiersz `received` z kluczami audytu i pełnym ładunkiem", async () => {
    plan({});
    const payload = { id: "evt_test_1", type: "invoice.paid" };

    const fresh = await claimWebhookEvent({
      ...REF,
      occurredAt: relativeIso(-30 * SEKUNDA),
      subscriptionId: "sub_test_1",
      customerId: "cus_test_1",
      userId: "user-me",
      payload,
    });

    expect(fresh).toBe("claimed");
    expect(chainsWith("insert")[0]!.argsOf("insert")?.[0]).toEqual({
      event_id: "evt_test_1",
      event_type: "transaction.completed",
      environment: "live",
      occurred_at: relativeIso(-30 * SEKUNDA),
      subscription_id: "sub_test_1",
      customer_id: "cus_test_1",
      user_id: "user-me",
      payload,
      status: "received",
    });
    // Nowe zdarzenie nie dotyka istniejących wierszy.
    expect(chainsWith("update")).toHaveLength(0);
  });

  it("brakujące klucze audytu zapisują się jako NULL, a ładunek jako pusty obiekt", async () => {
    plan({});

    await claimWebhookEvent(REF);

    expect(chainsWith("insert")[0]!.argsOf("insert")?.[0]).toMatchObject({
      occurred_at: null,
      subscription_id: null,
      customer_id: null,
      user_id: null,
      payload: {},
    });
  });

  it("awaria zapisu inna niż duplikat jest błędem, a nie cichym pominięciem", async () => {
    plan({ insert: fail("permission denied for table payment_webhook_events", "42501") });

    await expect(claimWebhookEvent(REF)).rejects.toThrow(
      "webhook log insert failed: permission denied for table payment_webhook_events",
    );
    expect(chainsWith("maybeSingle")).toHaveLength(0);
  });

  it("duplikat: odczyt istniejącego wiersza zawężony do zdarzenia I środowiska", async () => {
    plan({ insert: DUPLICATE, lookup: ok(webhookEvent({ status: "processed" })) });

    await claimWebhookEvent(REF);

    // To samo `event_id` w sandboxie to INNE zdarzenie - filtr środowiska jest
    // tu warunkiem poprawności, nie optymalizacją.
    expect(eqFilters(chainsWith("maybeSingle")[0]!)).toEqual([
      ["event_id", "evt_test_1"],
      ["environment", "live"],
    ]);
  });

  it("awaria odczytu duplikatu jest błędem z nazwą kroku", async () => {
    plan({ insert: DUPLICATE, lookup: fail("connection reset") });

    await expect(claimWebhookEvent(REF)).rejects.toThrow(
      "webhook log lookup failed: connection reset",
    );
  });

  it("duplikat bez widocznego wiersza (np. wyścig z usunięciem) to `in_progress`, nie duplikat", async () => {
    // Nie wiemy, czy zdarzenie ktoś obsłużył. „Duplikat" (2xx) kończyłby
    // ponawianie u operatora; „w toku" każe mu spróbować później - wtedy
    // INSERT przejdzie albo wiersz będzie już widoczny.
    plan({ insert: DUPLICATE, lookup: ok(null) });

    await expect(claimWebhookEvent(REF)).resolves.toBe("in_progress");
    expect(chainsWith("update")).toHaveLength(0);
  });

  it.each(["processed", "skipped"])(
    "duplikat domknięty statusem `%s` to `done` bez żadnego zapisu",
    async (status) => {
      plan({ insert: DUPLICATE, lookup: ok(webhookEvent({ status, created_at: FIXED_NOW_ISO })) });

      await expect(claimWebhookEvent(REF)).resolves.toBe("done");
      expect(chainsWith("update")).toHaveLength(0);
    },
  );

  it.each([
    ["4 min", -4 * MINUTA],
    // Granica okna: „porzucone" znaczy STARSZE niż 5 min. Równo 5 min to
    // wciąż dostawa w toku - przejęcie zdublowałoby trwającą obsługę.
    ["równo 5 min", -5 * MINUTA],
  ])(
    "duplikat `received` sprzed %s: równoległa dostawa go obsługuje - `in_progress`",
    async (_label, offset) => {
      plan({
        insert: DUPLICATE,
        lookup: ok(webhookEvent({ status: "received", created_at: relativeIso(offset) })),
      });

      await expect(claimWebhookEvent(REF)).resolves.toBe("in_progress");
      expect(chainsWith("update")).toHaveLength(0);
    },
  );

  it("duplikat `received` bez znacznika startu nie jest uznawany za porzucony", async () => {
    // Bez czasu startu nie da się dowieść porzucenia - przejęcie mogłoby
    // zdublować obsługę, która właśnie trwa.
    plan({
      insert: DUPLICATE,
      lookup: ok({ ...webhookEvent({ status: "received" }), created_at: null }),
    });

    await expect(claimWebhookEvent(REF)).resolves.toBe("in_progress");
    expect(chainsWith("update")).toHaveLength(0);
  });

  it("wiek przejęcia liczy się od `last_retried_at`: wiersz stary, ale świeżo przejęty jest W TOKU", async () => {
    // Scenariusz z audytu (PAY-08): wiersz utworzono godzinę temu, padł,
    // a minutę temu przejęła go ponowna dostawa i właśnie go obsługuje.
    // Wiek liczony od `created_at` (60 min > 5 min) uznawał go za porzucony -
    // równoległa dostawa przejmowała go w trakcie i zdarzenie szło dwa razy.
    plan({
      insert: DUPLICATE,
      lookup: ok(
        webhookEvent({
          id: "row-reclaimed",
          status: "received",
          created_at: relativeIso(-60 * MINUTA),
          last_retried_at: relativeIso(-1 * MINUTA),
          retry_count: 1,
        }),
      ),
    });

    await expect(claimWebhookEvent(REF)).resolves.toBe("in_progress");
    expect(chainsWith("update")).toHaveLength(0);
  });

  it("wiek przejęcia liczy się od `last_retried_at`: ostatnie przejęcie sprzed 6 min jest porzucone", async () => {
    plan({
      insert: DUPLICATE,
      lookup: ok(
        webhookEvent({
          id: "row-reclaimed",
          status: "received",
          created_at: relativeIso(-60 * MINUTA),
          last_retried_at: relativeIso(-6 * MINUTA),
          retry_count: 1,
        }),
      ),
    });

    await expect(claimWebhookEvent(REF)).resolves.toBe("claimed");
    expect(eqFilters(chainsWith("update")[0]!)).toEqual([
      ["id", "row-reclaimed"],
      ["status", "received"],
      ["retry_count", 1],
    ]);
  });

  it("porzucone `received` (starsze niż 5 min): przejęcie z licznikiem prób i świeżym ładunkiem", async () => {
    plan({
      insert: DUPLICATE,
      lookup: ok(
        webhookEvent({
          id: "row-stuck",
          status: "received",
          created_at: relativeIso(-5 * MINUTA - SEKUNDA),
          retry_count: 2,
        }),
      ),
    });
    const payload = { id: "evt_test_1", type: "invoice.paid", attempt: 3 };

    await expect(claimWebhookEvent({ ...REF, payload })).resolves.toBe("claimed");

    const reclaim = chainsWith("update")[0]!;
    expect(reclaim.argsOf("update")?.[0]).toEqual({
      status: "received",
      error: null,
      processed_at: null,
      retry_count: 3,
      last_retried_at: FIXED_NOW_ISO,
      payload,
    });
    // Przejęcie dotyka WYŁĄCZNIE tego wiersza - i tylko w stanie, który
    // właśnie odczytaliśmy (porównaj-i-zamień na statusie i liczniku prób).
    expect(eqFilters(reclaim)).toEqual([
      ["id", "row-stuck"],
      ["status", "received"],
      ["retry_count", 2],
    ]);
    expect(reclaim.argsOf("select")).toEqual(["id"]);
  });

  it("zdarzenie `failed` jest przejmowane od razu; brak licznika liczy się jako zero", async () => {
    plan({
      insert: DUPLICATE,
      lookup: ok({
        ...webhookEvent({ id: "row-failed", status: "failed", created_at: FIXED_NOW_ISO }),
        retry_count: null,
      }),
    });

    await expect(claimWebhookEvent(REF)).resolves.toBe("claimed");

    const patch = chainsWith("update")[0]!.argsOf("update")?.[0];
    expect(patch).toMatchObject({ retry_count: 1, error: null });
    // Odwołanie bez ładunku NIE czyści zapisanego - zamiatarka i panel
    // odtwarzają zdarzenie właśnie z niego.
    expect(patch).not.toHaveProperty("payload");
  });

  it("przegrany wyścig o przejęcie (0 wierszy) to `in_progress` - obsługuje je tylko zwycięzca", async () => {
    // Ponowna dostawa od operatora i naprawa z panelu admina mogą odczytać ten
    // sam wiersz `failed` jednocześnie. Gdyby obaj dostali „nasze", zdarzenie
    // wykonałoby się dwa razy (drugi bilet, drugi mail, podwójny wpis w CRM).
    // Przegrany słyszy „w toku", nie „gotowe": zwycięzca może jeszcze paść.
    plan({
      insert: DUPLICATE,
      lookup: ok(webhookEvent({ id: "row-failed", status: "failed", retry_count: 1 })),
      reclaim: ok([]),
    });

    await expect(claimWebhookEvent(REF)).resolves.toBe("in_progress");

    expect(eqFilters(chainsWith("update")[0]!)).toEqual([
      ["id", "row-failed"],
      ["status", "failed"],
      ["retry_count", 1],
    ]);
  });

  it("awaria przejęcia jest błędem - zdarzenie nie może udawać, że jest nasze", async () => {
    plan({
      insert: DUPLICATE,
      lookup: ok(webhookEvent({ status: "failed" })),
      reclaim: fail("could not serialize access"),
    });

    await expect(claimWebhookEvent(REF)).rejects.toThrow(
      "webhook log reclaim failed: could not serialize access",
    );
  });
});

describe("reclaimWebhookEventRow - przejęcie wiersza odczytanego przez wołającego", () => {
  const ROW = {
    id: "row-1",
    status: "processed",
    created_at: relativeIso(-2 * MINUTA),
    last_retried_at: null,
    retry_count: 2,
  };

  it("automat NIE otwiera wiersza domkniętego - `done` bez zapisu", async () => {
    plan({});

    await expect(reclaimWebhookEventRow(ROW)).resolves.toBe("done");
    expect(chainsWith("update")).toHaveLength(0);
  });

  it("ponowienie z panelu otwiera domknięty wiersz: autor i najemca w TYM SAMYM warunkowym zapisie", async () => {
    plan({});

    await expect(
      reclaimWebhookEventRow(ROW, {
        reopenClosed: true,
        retriedBy: "admin-1",
        tenantId: "tenant-alfa",
      }),
    ).resolves.toBe("claimed");

    const reclaim = chainsWith("update")[0]!;
    expect(reclaim.argsOf("update")?.[0]).toEqual({
      status: "received",
      error: null,
      processed_at: null,
      retry_count: 3,
      last_retried_at: FIXED_NOW_ISO,
      retried_by: "admin-1",
    });
    expect(eqFilters(reclaim)).toEqual([
      ["id", "row-1"],
      ["tenant_id", "tenant-alfa"],
      ["status", "processed"],
      ["retry_count", 2],
    ]);
  });

  it("nawet panel NIE przejmuje wiersza, który właśnie obsługuje żywa dostawa", async () => {
    // Kliknięcie „Ponów" w trakcie żywej dostawy tego samego zdarzenia
    // wykonałoby obsługę dwa razy równolegle.
    plan({});

    await expect(
      reclaimWebhookEventRow(
        { ...ROW, status: "received", created_at: relativeIso(-30 * SEKUNDA) },
        { reopenClosed: true, retriedBy: "admin-1" },
      ),
    ).resolves.toBe("in_progress");
    expect(chainsWith("update")).toHaveLength(0);
  });
});

describe("isAbandonedClaim - wiek ostatniego przejęcia", () => {
  it("liczy od `last_retried_at`, a dopiero bez niego od `created_at`; granica 5 min to jeszcze „w toku”", () => {
    const now = Date.parse(FIXED_NOW_ISO);
    const old = relativeIso(-60 * MINUTA);

    expect(isAbandonedClaim({ created_at: old, last_retried_at: null }, now)).toBe(true);
    expect(isAbandonedClaim({ created_at: old, last_retried_at: relativeIso(-MINUTA) }, now)).toBe(
      false,
    );
    expect(
      isAbandonedClaim({ created_at: old, last_retried_at: relativeIso(-5 * MINUTA) }, now),
    ).toBe(false);
    expect(
      isAbandonedClaim(
        { created_at: old, last_retried_at: relativeIso(-5 * MINUTA - SEKUNDA) },
        now,
      ),
    ).toBe(true);
    expect(isAbandonedClaim({ created_at: null, last_retried_at: null }, now)).toBe(false);
  });
});

describe("finishWebhookEvent - domknięcie wiersza", () => {
  it("domyka status z czasem obsługi, subskrypcją i użytkownikiem, zawężając do zdarzenia", async () => {
    plan({});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishWebhookEvent({ eventId: "evt_test_1", environment: "sandbox" }, "processed", {
      durationMs: 41.6,
      subscriptionId: "sub_test_1",
      userId: "user-me",
    });

    // Udany zapis nie zostawia w logu fałszywego alarmu.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();

    const update = chainsWith("update")[0]!;
    expect(update.argsOf("update")?.[0]).toEqual({
      status: "processed",
      error: null,
      processed_at: FIXED_NOW_ISO,
      duration_ms: 42,
      subscription_id: "sub_test_1",
      user_id: "user-me",
    });
    expect(eqFilters(update)).toEqual([
      ["event_id", "evt_test_1"],
      ["environment", "sandbox"],
    ]);
  });

  it("porażka zapisuje komunikat błędu; ujemny czas (przestawiony zegar) zapisuje się jako 0", async () => {
    plan({});

    await finishWebhookEvent(REF, "failed", {
      error: "subscriptions update failed",
      durationMs: -5,
    });

    expect(chainsWith("update")[0]!.argsOf("update")?.[0]).toEqual({
      status: "failed",
      error: "subscriptions update failed",
      processed_at: FIXED_NOW_ISO,
      duration_ms: 0,
    });
  });

  it("zakres najemcy zawęża również ZAPIS domknięcia (ścieżka w imieniu admina)", async () => {
    plan({});

    await finishWebhookEvent({ ...REF, tenantId: "tenant-alfa" }, "processed");

    expect(eqFilters(chainsWith("update")[0]!)).toEqual([
      ["event_id", "evt_test_1"],
      ["environment", "live"],
      ["tenant_id", "tenant-alfa"],
    ]);
  });

  it("bez łatki: nie nadpisuje subskrypcji ani użytkownika zapisanych przy rezerwacji", async () => {
    plan({});

    await finishWebhookEvent(REF, "skipped");

    expect(chainsWith("update")[0]!.argsOf("update")?.[0]).toEqual({
      status: "skipped",
      error: null,
      processed_at: FIXED_NOW_ISO,
    });
  });

  it("błąd zwrócony przez bazę (nie wyjątek) też jest logowany - domknięcie nigdy nie rzuca", async () => {
    // supabase-js NIE rzuca przy błędzie zapisu, tylko zwraca `{ error }`.
    // Bez odczytu wyniku wiersz zostawał po cichu w `received`, bez śladu w logu.
    const denied = fail("permission denied for table payment_webhook_events", "42501");
    plan({ finish: denied });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(finishWebhookEvent(REF, "processed")).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("[payments] webhook log update failed", denied.error);
    consoleError.mockRestore();
  });

  it("wyjątek klienta bazy jest logowany i połykany - domknięcie nigdy nie rzuca", async () => {
    const boom = new Error("fetch failed");
    h.db.current = {
      from: () => {
        throw boom;
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(finishWebhookEvent(REF, "processed")).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("[payments] webhook log update failed", boom);
    consoleError.mockRestore();
  });
});
