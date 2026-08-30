// KASA WEJŚCIÓWKI: `registration_id` przechodzi przez zamówienie i jest
// SPRAWDZANY, zanim cokolwiek powstanie u operatora.
//
// DLACZEGO TO JEST TEST O PIENIĄDZACH, A NIE O KSZTAŁCIE ŁADUNKU.
// `payments_apply_event_ticket_outcome` dopasowywało wpłatę do zgłoszenia
// alternatywą `payment_order_id = order.id OR person_id = <osoba>` z
// `ORDER BY created_at DESC LIMIT 1`. Pierwszy człon ustawia DOPIERO ta sama
// funkcja, więc przy PIERWSZYM księgowaniu działał wyłącznie drugi: uczestnik
// z dwoma zgłoszeniami na to samo wydarzenie dostawał opłacony bilet przypięty
// do najnowszego wiersza - niekoniecznie tego, za który zapłacił. Kluczem
// dowiązania jest `metadata.registration_id`, a wkłada go tutaj ten handler.
//
// KLIENT WSKAZUJE WIERSZ, WIĘC SERWER MUSI GO SPRAWDZIĆ. Autorytetem jest baza
// (`event_registration_payment_context`), bo RLS `event_registrations` jest
// zamknięte dla uczestnika, a rzutowanie odczytu na `service_role` oddałoby
// serwerowi aplikacji prawo czytania CUDZYCH zgłoszeń. Ten plik dowodzi, że
// handler tę odpowiedź CZYTA i że odmowa zatrzymuje go PRZED założeniem
// zamówienia.
//
// CZEGO TEN PLIK NIE DOWODZI: autoryzacji. Harness server fn nie uruchamia
// middleware - zestawu `requireSupabaseAuth` pilnuje bramka
// `check:authz-snapshot`. Test handlera mówi o tym, CO robi handler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const EVENT_ID = "22222222-2222-2222-2222-222222222222";
const TICKET_ID = "33333333-3333-3333-3333-333333333333";
const REGISTRATION_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_EVENT_ID = "99999999-9999-9999-9999-999999999999";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
const inserted: Array<Record<string, unknown>> = [];

const state = vi.hoisted(() => ({
  paymentContext: null as unknown,
  quote: null as unknown,
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { id: "requireSupabaseAuth" },
}));

vi.mock("@/lib/billing/entitlement", () => ({ periodEndFor: () => null }));

// Tryb mock (brak dostawcy) kończy handler TUŻ PO wstawieniu zamówienia -
// czyli dokładnie tam, gdzie kończy się przedmiot tego pliku. Sesja operatora
// ma własne testy (`adhocCheckout.server.test.ts`).
vi.mock("@/lib/billing/mockMode.server", () => ({
  mockCheckoutAllowed: () => true,
  paymentsConfiguredServer: () => false,
}));

vi.mock("@/lib/http/resolveReturnUrl", () => ({ resolveReturnUrl: (path: string) => path }));

vi.mock("@/lib/stripe.server", () => ({ resolveEnvironment: () => "sandbox" }));

vi.mock("@/lib/events/ticketAllowance.server", () => ({
  ticketPriceForCaller: async (_client: unknown, amountCents: number) => ({
    amountCents,
    kind: "full" as const,
  }),
}));

const { callServerFn } = await import("@/test/serverFn");
const { createCheckoutOrder } = await import("@/lib/billing/checkout.functions");

/** Klient Supabase w kształcie, jakiego używa TEN handler - RPC + insert. */
function client() {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "event_registration_payment_context") {
        return { data: state.paymentContext, error: null };
      }
      if (fn === "event_ticket_checkout_quote") {
        return { data: state.quote, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, ...row });
        return {
          select: () => ({
            single: async () => ({
              data: { id: "order-1", tenant_id: "tenant-1" },
              error: null,
            }),
          }),
        };
      },
    }),
  };
}

function context() {
  return { supabase: client(), userId: "user-1", claims: { email: "kupujacy@example.org" } };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    kind: "one_time" as const,
    event_id: EVENT_ID,
    ticket_type_id: TICKET_ID,
    registration_id: REGISTRATION_ID,
    success_path: "/events/kongres-cee",
    cancel_path: "/events/kongres-cee",
    environment: "sandbox" as const,
    ...over,
  };
}

/** Odpowiedź `event_registration_payment_context` w kształcie z migracji. */
function paymentContext(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    registration_id: REGISTRATION_ID,
    event_id: EVENT_ID,
    event_slug: "kongres-cee",
    ticket_type_id: TICKET_ID,
    status: "pending",
    payment_status: "unpaid",
    amount_cents: 15000,
    currency: "PLN",
    ...over,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  inserted.length = 0;
  state.paymentContext = paymentContext();
  state.quote = {
    ticket_type_id: TICKET_ID,
    event_id: EVENT_ID,
    amount_cents: 15000,
    list_price_cents: 15000,
    currency: "PLN",
    name_pl: "Bilet",
    name_en: "Ticket",
    event_title_pl: "Kongres CEE",
    event_title_en: "CEE Congress",
    phase: null,
  };
});

describe("createCheckoutOrder - `registration_id` w metadanych", () => {
  it("wkłada `registration_id` obok `event_id` i `ticket_type_id`", async () => {
    await callServerFn(createCheckoutOrder, payload(), context());

    const order = inserted.at(0);
    expect(order?.table).toBe("payment_orders");
    const metadata = order?.metadata as Record<string, unknown>;
    expect(metadata.event_id).toBe(EVENT_ID);
    expect(metadata.ticket_type_id).toBe(TICKET_ID);
    expect(metadata.registration_id).toBe(REGISTRATION_ID);
  });

  it("bez `registration_id` klucza w metadanych NIE MA - zamówienie kasy społeczności zostaje bez zmian", async () => {
    await callServerFn(createCheckoutOrder, payload({ registration_id: undefined }), context());

    const metadata = inserted.at(0)?.metadata as Record<string, unknown>;
    expect(metadata).not.toHaveProperty("registration_id");
    expect(rpcCalls.some((call) => call.fn === "event_registration_payment_context")).toBe(false);
  });

  it("kwota pochodzi z WYCENY BAZY, a nie z kontekstu zgłoszenia", async () => {
    state.paymentContext = paymentContext({ amount_cents: 1 });
    await callServerFn(createCheckoutOrder, payload(), context());

    expect(inserted.at(0)?.amount_cents).toBe(15000);
  });

  it("sprawdza zgłoszenie PRZED wyceną - błędne wskazanie nie dotyka cennika", async () => {
    state.paymentContext = { ok: false, reason: "not_found" };

    await expect(callServerFn(createCheckoutOrder, payload(), context())).rejects.toThrow(
      /registration_not_payable/,
    );
    expect(rpcCalls.map((call) => call.fn)).toEqual(["event_registration_payment_context"]);
  });
});

describe("createCheckoutOrder - odmowy wskazania zgłoszenia", () => {
  it("cudze zgłoszenie: baza mówi `not_found`, handler NIE zakłada zamówienia", async () => {
    state.paymentContext = { ok: false, reason: "not_found" };

    await expect(callServerFn(createCheckoutOrder, payload(), context())).rejects.toThrow(
      "registration_not_payable:not_found",
    );
    expect(inserted).toHaveLength(0);
  });

  it("zgłoszenie z INNEGO wydarzenia jest odrzucone, choć baza je oddała", async () => {
    state.paymentContext = paymentContext({ event_id: OTHER_EVENT_ID });

    await expect(callServerFn(createCheckoutOrder, payload(), context())).rejects.toThrow(
      "registration_not_payable:event_mismatch",
    );
    expect(inserted).toHaveLength(0);
  });

  it("zgłoszenie na INNĄ wejściówkę jest odrzucone", async () => {
    state.paymentContext = paymentContext({ ticket_type_id: "44444444-4444-4444-4444-444444444444" });

    await expect(callServerFn(createCheckoutOrder, payload(), context())).rejects.toThrow(
      "registration_not_payable:ticket_mismatch",
    );
    expect(inserted).toHaveLength(0);
  });

  it("zgłoszenie już rozliczone albo odwołane nie wraca do kasy", async () => {
    state.paymentContext = { ok: false, reason: "already_settled" };

    await expect(callServerFn(createCheckoutOrder, payload(), context())).rejects.toThrow(
      "registration_not_payable:already_settled",
    );
  });

  it("gość bez konta dostaje powód `account_required` z bazy, a nie cichy sukces", async () => {
    state.paymentContext = { ok: false, reason: "account_required" };

    await expect(callServerFn(createCheckoutOrder, payload(), context())).rejects.toThrow(
      "registration_not_payable:account_required",
    );
  });

  it("nieczytelna odpowiedź RPC jest odmową, a nie przepustką", async () => {
    state.paymentContext = null;

    await expect(callServerFn(createCheckoutOrder, payload(), context())).rejects.toThrow(
      "registration_not_payable:not_found",
    );
    expect(inserted).toHaveLength(0);
  });

  it("`registration_id` o złym kształcie odrzuca WALIDATOR, zanim dojdzie do bazy", async () => {
    await expect(
      callServerFn(createCheckoutOrder, payload({ registration_id: "nie-uuid" }), context()),
    ).rejects.toThrow();
    expect(rpcCalls).toHaveLength(0);
  });
});
