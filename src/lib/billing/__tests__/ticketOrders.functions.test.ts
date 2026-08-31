// Obudowa RPC panelu zamówień biletowych - 0 z 4 funkcji pokrytych
// do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. Sama logika odczytu (`ticketOrders.server`) ma
// własny, obszerny test. Nieprzetestowane było OPAKOWANIE, a to ono decyduje
// o trzech rzeczach, których logika odczytu nie zna:
//
//   1. CZYIM KLIENTEM pytamy bazę. Handler przekazuje `context.supabase` -
//      klienta ZALOGOWANEGO ADMINA, nie rolę serwisową. To jedyna bramka
//      najemcy na tej ścieżce: podmiana na klienta serwisowego pokazałaby
//      w panelu zamówienia wszystkich najemców naraz. Dlatego test podstawia
//      klienta przez kontekst i sprawdza, że zapytanie poszło WŁAŚNIE NIM.
//   2. ILE WIERSZY wolno pobrać. `limit` przychodzi z przeglądarki; brak
//      górnego ograniczenia to zapytanie o całą tabelę pieniężną w jednym
//      żądaniu (i pobranie jej do przeglądarki admina).
//   3. CZY IDENTYFIKATOR jest identyfikatorem. `orderId` idzie do kolumny
//      `uuid` - napis spoza formatu kończy się błędem bazy zamiast czytelną
//      odmową.
//
// ŚWIADOMIE NIE ATRAPUJEMY `ticketOrders.server` - to sąsiad, nie granica.
// Atrapą jest wyłącznie klient bazy (`supabaseFromStub`), więc przez test
// przechodzi PRAWDZIWE zapytanie: widać w nim, że `limit` z walidatora dojechał
// do ogniwa `.limit()`, a `orderId` do `.eq("id", ...)`. Test na atrapie
// sąsiada dowodziłby wyłącznie tego, że handler woła atrapę.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware
// (patrz `src/test/serverFnHarness.ts`) - deklarację `requireSupabaseAuth`
// przybijamy strukturalnie, a bramką roli/najemcy jest RLS.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, fail, supabaseFromStub, type RecordedChain } from "@/test/billing/fixtures";
import { asServerFn, callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";
import type { TicketOrderHistoryEntry, TicketOrderRow } from "@/lib/billing/ticketOrders.server";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

const { getTicketOrderHistory, listTicketOrders } =
  await import("@/lib/billing/ticketOrders.functions");

const ORDERS = "payment_orders";
const EVENTS = "events";
const PROFILES = "profiles";
const WEBHOOKS = "payment_webhook_events";

/** Identyfikatory testowe (UUID losowe, bez związku z produkcją). */
const ZAMOWIENIE = "aaaaaaaa-1111-4222-8333-444444444444";
const WYDARZENIE = "bbbbbbbb-1111-4222-8333-444444444444";
const KUPUJACY = "cccccccc-1111-4222-8333-444444444444";

const db = supabaseFromStub();

/** Kontekst z klientem ZALOGOWANEGO admina - dokładnie jak w produkcji. */
const KONTEKST = { supabase: { from: db.from }, userId: "user-admin" };

/** Wiersz zamówienia biletowego w kształcie czytanym przez warstwę odczytu. */
function zamowienie(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ZAMOWIENIE,
    user_id: KUPUJACY,
    anonymized_at: null,
    status: "paid",
    provider: "stripe",
    provider_intent_id: "pi_test_1",
    amount_cents: 12000,
    currency: "pln",
    paid_at: "2026-08-20T10:05:00.000Z",
    created_at: "2026-08-20T10:00:00.000Z",
    metadata: { event_id: WYDARZENIE, quantity: 2, coupon_code: "WCZESNY" },
    ...over,
  };
}

/** Argumenty ogniwa `.limit()` z ostatniego łańcucha dla tabeli. */
function limitOstatniego(table: string): unknown[] | undefined {
  const args = db.lastChain(table)?.argsOf("limit");
  return args ? [...args] : undefined;
}

function waliduj(fn: unknown, input: unknown): unknown {
  const spec = asServerFn(fn);
  if (!spec.validator) throw new Error("test: funkcja bez walidatora");
  return spec.validator(input);
}

beforeEach(() => {
  db.reset();
  db.setResponse(ORDERS, ok([]));
});

describe("obudowa - bramki i metody", () => {
  it("obie funkcje wymagają uwierzytelnionej sesji", () => {
    // Dowód STRUKTURALNY: harness nie uruchamia middleware. Gdyby deklaracja
    // zniknęła, handler pobiegłby z klientem bez tożsamości - a wtedy RLS nie
    // ma po czym zawęzić wierszy pieniężnych.
    expect(serverFnMiddlewareNames(listTicketOrders)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(getTicketOrderHistory)).toEqual(["requireSupabaseAuth"]);
  });

  it("obie funkcje są odczytem (GET)", () => {
    expect(asServerFn(listTicketOrders).method).toBe("GET");
    expect(asServerFn(getTicketOrderHistory).method).toBe("GET");
  });
});

describe("walidator listy zamówień", () => {
  it("brak wejścia znaczy „ustawienia domyślne”", () => {
    expect(waliduj(listTicketOrders, undefined)).toEqual({});
    expect(waliduj(listTicketOrders, null)).toEqual({});
    expect(waliduj(listTicketOrders, {})).toEqual({});
  });

  it("przyjmuje krańce dozwolonego zakresu", () => {
    expect(waliduj(listTicketOrders, { limit: 1 })).toEqual({ limit: 1 });
    expect(waliduj(listTicketOrders, { limit: 500 })).toEqual({ limit: 500 });
  });

  it("odrzuca zero i wartości ujemne", () => {
    expect(() => waliduj(listTicketOrders, { limit: 0 })).toThrow();
    expect(() => waliduj(listTicketOrders, { limit: -10 })).toThrow();
  });

  it("odrzuca wartość powyżej limitu (501)", () => {
    // Sufit 500 wierszy to ochrona przed jednym żądaniem ciągnącym całą
    // tabelę zamówień - i przed pamięcią przeglądarki panelu.
    expect(() => waliduj(listTicketOrders, { limit: 501 })).toThrow();
    expect(() => waliduj(listTicketOrders, { limit: 100000 })).toThrow();
  });

  it("odrzuca ułamek i napis", () => {
    expect(() => waliduj(listTicketOrders, { limit: 10.5 })).toThrow();
    expect(() => waliduj(listTicketOrders, { limit: "50" })).toThrow();
  });

  it("obce pola są odcinane", () => {
    expect(waliduj(listTicketOrders, { limit: 5, tenantId: "tenant-obcy" })).toEqual({
      limit: 5,
    });
  });
});

describe("walidator historii zamówienia", () => {
  it("przyjmuje poprawny identyfikator zamówienia", () => {
    expect(waliduj(getTicketOrderHistory, { orderId: ZAMOWIENIE })).toEqual({
      orderId: ZAMOWIENIE,
    });
  });

  it("odrzuca brak pola i puste wejście", () => {
    expect(() => waliduj(getTicketOrderHistory, {})).toThrow();
    expect(() => waliduj(getTicketOrderHistory, undefined)).toThrow();
    expect(() => waliduj(getTicketOrderHistory, null)).toThrow();
  });

  it("odrzuca pusty napis i napis spoza formatu UUID", () => {
    expect(() => waliduj(getTicketOrderHistory, { orderId: "" })).toThrow();
    expect(() => waliduj(getTicketOrderHistory, { orderId: "1 OR 1=1" })).toThrow();
  });

  it("odrzuca typ inny niż napis", () => {
    expect(() => waliduj(getTicketOrderHistory, { orderId: 1 })).toThrow();
    expect(() => waliduj(getTicketOrderHistory, { orderId: [ZAMOWIENIE] })).toThrow();
  });
});

describe("lista zamówień - co handler robi z argumentami", () => {
  it("bez `limit` pyta o 200 wierszy", async () => {
    // Domyślna wartość żyje w handlerze (`data.limit ?? 200`) - to jedyne
    // miejsce, w którym da się ją sprawdzić.
    await callServerFn(listTicketOrders, { context: KONTEKST });

    expect(limitOstatniego(ORDERS)).toEqual([200]);
  });

  it("podany `limit` dojeżdża do zapytania", async () => {
    await callServerFn(listTicketOrders, { data: { limit: 25 }, context: KONTEKST });

    expect(limitOstatniego(ORDERS)).toEqual([25]);
  });

  it("zapytanie idzie klientem Z KONTEKSTU (sesja admina), nie rolą serwisową", async () => {
    // Klient z kontekstu jest jedynym, przez który działa RLS najemcy.
    // Zapisany łańcuch dowodzi, że handler użył właśnie jego.
    await callServerFn(listTicketOrders, { context: KONTEKST });

    expect(db.chainsFor(ORDERS)).toHaveLength(1);
  });

  it("oddaje wiersze przemapowane przez warstwę odczytu", async () => {
    // Handler nie przerabia wyniku - test pilnuje, że nic po drodze nie gubi
    // pól pieniężnych ani danych wydarzenia (to one są treścią ekranu).
    db.setResponse(ORDERS, ok([zamowienie()]));
    db.setResponse(
      EVENTS,
      ok([
        {
          id: WYDARZENIE,
          slug: "kongres-cee",
          title_pl: "Kongres CEE",
          title_en: "CEE Congress",
          starts_at: "2026-09-10T08:00:00.000Z",
        },
      ]),
    );
    db.setResponse(
      PROFILES,
      ok([
        {
          id: KUPUJACY,
          display_name: "Uczestnik Testowy",
          first_name: "Uczestnik",
          last_name: "Testowy",
          email: "uczestnik@example.com",
        },
      ]),
    );

    const wiersze = await callServerFn<TicketOrderRow[]>(listTicketOrders, {
      context: KONTEKST,
    });

    expect(wiersze).toHaveLength(1);
    expect(wiersze[0]).toMatchObject({
      id: ZAMOWIENIE,
      status: "paid",
      amountCents: 12000,
      currency: "PLN",
      tickets: 2,
      couponCode: "WCZESNY",
      buyerEmail: "uczestnik@example.com",
      eventId: WYDARZENIE,
      eventSlug: "kongres-cee",
    });
  });

  it("pusta lista to pusta tablica, nie błąd", async () => {
    await expect(callServerFn(listTicketOrders, { context: KONTEKST })).resolves.toEqual([]);
  });

  it("odmowa bazy wychodzi na zewnątrz zamiast udawać brak zamówień", async () => {
    // Pusta lista przy błędzie RLS/awarii to najgorszy możliwy wynik na
    // ekranie pieniężnym: wygląda jak „nikt nie kupił".
    db.setResponse(ORDERS, fail("permission denied for table payment_orders", "42501"));

    await expect(
      callServerFn(listTicketOrders, { data: { limit: 10 }, context: KONTEKST }),
    ).rejects.toThrow("permission denied for table payment_orders");
  });
});

describe("historia zamówienia - co handler robi z argumentami", () => {
  it("identyfikator z ładunku trafia do filtru zapytania", async () => {
    db.setResponse(ORDERS, (chain: RecordedChain) =>
      chain.has("maybeSingle") ? ok(null) : ok([]),
    );

    await callServerFn(getTicketOrderHistory, {
      data: { orderId: ZAMOWIENIE },
      context: KONTEKST,
    });

    expect(db.lastChain(ORDERS)?.argsOf("eq")).toEqual(["id", ZAMOWIENIE]);
  });

  it("nieistniejące zamówienie daje pustą oś czasu, a nie wyjątek", async () => {
    // Zamówienie innego najemcy jest dla RLS „nieistniejące" - panel ma wtedy
    // pokazać pustkę, a nie białą stronę.
    db.setResponse(ORDERS, ok(null));

    await expect(
      callServerFn(getTicketOrderHistory, {
        data: { orderId: ZAMOWIENIE },
        context: KONTEKST,
      }),
    ).resolves.toEqual([]);
  });

  it("oddaje oś czasu zbudowaną przez warstwę odczytu", async () => {
    db.setResponse(ORDERS, ok(zamowienie()));
    db.setResponse(
      WEBHOOKS,
      ok([
        {
          id: "evt-1",
          event_type: "checkout.session.completed",
          status: "processed",
          error: null,
          environment: "live",
          occurred_at: "2026-08-20T10:06:00.000Z",
          created_at: "2026-08-20T10:06:01.000Z",
        },
      ]),
    );

    const wpisy = await callServerFn<TicketOrderHistoryEntry[]>(getTicketOrderHistory, {
      data: { orderId: ZAMOWIENIE },
      context: KONTEKST,
    });

    expect(wpisy.map((w) => w.kind)).toEqual(["order_created", "order_paid", "webhook"]);
  });

  it("odmowa bazy wychodzi na zewnątrz", async () => {
    db.setResponse(ORDERS, fail("permission denied for table payment_orders", "42501"));

    await expect(
      callServerFn(getTicketOrderHistory, {
        data: { orderId: ZAMOWIENIE },
        context: KONTEKST,
      }),
    ).rejects.toThrow("permission denied for table payment_orders");
  });
});
