// REALIZACJA PŁATNOŚCI JEDNORAZOWEJ - KAŻDA GAŁĄŹ (`oneTimeFulfilment.server`).
//
// PO CO OSOBNY PLIK OBOK `oneTimeFulfilment.event.test.ts`. Tamten test stoi
// na atrapie, która zawsze odpowiada tak samo (zamówienie z wydarzeniem, RPC
// bez ładunku) - dowodzi szczęśliwej ścieżki i zwrotu przy wyczerpanej sali.
// Tutaj atrapa jest KONFIGUROWANA PER WYWOŁANIE i prowadzi wspólny dziennik
// kolejności, bo od 20260926180000 kolejność jest treścią kontraktu:
//
//   1. RPC `payments_apply_event_ticket_outcome` idzie PRZED RSVP 'going'.
//      Baza rozstrzyga przyjęcie pod blokadą i może zostawić wpłatę w kolejce
//      albo w oczekiwaniu na decyzję - wtedy RSVP (link wejścia) i mail
//      „miejsce zarezerwowane" byłyby nieprawdą.
//   2. Miejsce RSVP zakupu BEZ zgłoszenia rozstrzyga baza pod blokadą
//      (`_event_rsvp_claim_paid_seat`, TIX-08) - dopiero gdy odpowiedź bazy
//      mówi `registration_not_found`. Zamówienie ze zgłoszeniem nigdy nie
//      jest zwracane z księgi RSVP: baza stawia wpłatę w kolejce opłaconej.
//   3. Zakleszczenie (40P01) i konflikt serializacji (40001) dostają JEDNO
//      ponowienie. Błąd RPC przy WPŁACIE rzuca (TIX-05) - połknięty dawał
//      RSVP i link wejścia przy nieopłaconym zgłoszeniu.
//   4. Odmowa bazy (cudze zgłoszenie, zła kwota, druga wpłata) nie daje RSVP
//      ani „miejsce zarezerwowane" - idzie zawiadomienie o odmowie.
//
// Atrapowane są wyłącznie granice: klient service_role, operator zwrotów,
// nadanie uprawnienia, poczta i moduł powiadomień. RODO: dane syntetyczne.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

interface RpcReply {
  data: unknown;
  error: { code?: string; message: string } | null;
}

const h = vi.hoisted(() => ({
  /** Wspólny dziennik kolejności: RPC, tabele, uprawnienie, maile. */
  log: [] as string[],
  stub: null as SupabaseFromStub | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  /** Odpowiedzi RPC po kolei; pusta kolejka = `{ data: null, error: null }`. */
  rpcReplies: [] as RpcReply[],
  /**
   * Odpowiedź `_event_rsvp_claim_paid_seat`: `free`/`full` - decyzja bazy,
   * `already` - sala pełna, ale RSVP 'going' TEGO kupującego już stoi
   * (pierwsza dostawa zajęła miejsce), więc baza odpowiada `already: true`
   * (pgTAP: event_rsvp_claim_paid_seat_replay_test.sql), `broken` - błąd
   * RPC; `legacy-*` - funkcji jeszcze nie ma (migracja przed kodem), więc
   * idzie dawny odczyt `assertSeatAvailable` z danym skutkiem.
   */
  seat: "free" as
    | "free"
    | "full"
    | "already"
    | "broken"
    | "legacy-free"
    | "legacy-full"
    | "legacy-broken"
    | "legacy-thrown-string",
  claimCalls: [] as Array<Record<string, unknown>>,
  refusals: [] as unknown[],
  refund: { ok: true, adjustmentId: "adj_1" } as
    { ok: true; adjustmentId: string | null } | { ok: false; error: string },
  notifyPayloads: [] as unknown[],
  notifyThrows: false,
  issued: [] as string[],
  eventMails: [] as Array<Record<string, unknown>>,
  subscriptionMails: [] as Array<Record<string, unknown>>,
  refundMails: [] as Array<Record<string, unknown>>,
  grants: [] as unknown[],
  donations: [] as Array<Record<string, unknown>>,
  donationSettled: true,
  /** Środowisko zlecenia zwrotu przy pełnej sali (PAY-14b). */
  refundEnvs: [] as string[],
  /** Odebrania uprawnień: zamówienie (`revokeOrderEntitlement`) i klucze subskrypcji. */
  revokedOrders: [] as unknown[],
  revokedRefs: [] as string[],
  /** Zwolnienia rezerwacji kuponu (`release_b2b_coupon_for_user`). */
  couponReleases: [] as Array<Record<string, unknown>>,
  couponReleaseReply: { data: true, error: null } as RpcReply,
  /** Stara ścieżka zwolnienia (`release_b2b_coupon`) - okno wdrożenia przy PGRST202. */
  legacyCouponReleases: [] as Array<Record<string, unknown>>,
  legacyCouponReleaseReply: { data: true, error: null } as RpcReply,
  /** Dzwonki administratorów najemcy (`enqueue_notification`). */
  adminBells: [] as Array<Record<string, unknown>>,
  /** Argumenty zlecenia zwrotu przy pełnej sali (środowisko, transakcja, powód). */
  refundCalls: [] as unknown[][],
  /** Kody promocyjne operatora po identyfikatorze (S8); `Error` = awaria odczytu. */
  promotionCodes: {} as Record<string, { metadata: Record<string, string> } | Error>,
  /** Środowiska, w których realizacja sięgnęła po klienta operatora. */
  stripeEnvs: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      h.log.push(`from:${table}`);
      if (!h.stub) throw new Error("test: brak atrapy Supabase");
      return h.stub.from(table);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      // Zwolnienie kuponu i dzwonki administratorów mają własne dzienniki -
      // `rpcCalls` zostaje dziennikiem wyniku biletu, jak przed PAY-09.
      if (fn === "release_b2b_coupon_for_user") {
        h.log.push("coupon:release");
        h.couponReleases.push(args);
        return h.couponReleaseReply;
      }
      if (fn === "release_b2b_coupon") {
        h.log.push("coupon:legacy-release");
        h.legacyCouponReleases.push(args);
        return h.legacyCouponReleaseReply;
      }
      if (fn === "enqueue_notification") {
        h.adminBells.push(args);
        return { data: `bell-${String(args["p_user_id"])}`, error: null };
      }
      if (fn === "_event_rsvp_claim_paid_seat") {
        h.log.push("rpc:claim");
        h.claimCalls.push(args);
        if (h.seat === "full") return { data: { ok: false, reason: "event_full" }, error: null };
        if (h.seat === "already") {
          return { data: { ok: true, seated: true, already: true }, error: null };
        }
        if (h.seat === "broken") {
          return { data: null, error: { code: "XX000", message: "test: odczyt pojemności padł" } };
        }
        if (h.seat.startsWith("legacy-")) {
          return { data: null, error: { code: "PGRST202", message: "test: brak funkcji" } };
        }
        return { data: { ok: true, seated: true, already: false }, error: null };
      }
      h.log.push(`rpc:${String(args["p_outcome"])}`);
      h.rpcCalls.push({ fn, args });
      // Domyślnie: zakup bez zgłoszenia z formularza (ścieżka RSVP).
      return (
        h.rpcReplies.shift() ?? {
          data: { applied: false, reason: "registration_not_found" },
          error: null,
        }
      );
    },
  },
}));

vi.mock("@/lib/billing/grant.server", () => ({
  grantEntitlement: async (order: unknown) => {
    h.log.push("grant");
    h.grants.push(order);
  },
  revokeOrderEntitlement: async (order: unknown) => {
    h.log.push("revoke");
    h.revokedOrders.push(order);
  },
  revokeSubscriptionEntitlement: async (ref: string) => {
    h.revokedRefs.push(ref);
    return true;
  },
}));

vi.mock("@/lib/events/ticket.server", () => ({
  assertSeatAvailable: async () => {
    h.log.push("seat:legacy");
    if (h.seat === "legacy-full") throw new Error("event_full");
    if (h.seat === "legacy-broken") throw new Error("test: odczyt pojemności padł");
    if (h.seat === "legacy-thrown-string") throw "test: rzut bez obiektu Error";
  },
}));

vi.mock("@/lib/billing/refundProvider.server", () => ({
  refundTransactionFully: async (env: string, ...rest: unknown[]) => {
    h.log.push("refund");
    h.refundEnvs.push(env);
    h.refundCalls.push([env, ...rest]);
    return h.refund;
  },
}));

// Granica operatora dla kodów promocyjnych (S8): odczyt kodu po identyfikatorze.
// Nieznany kod to błąd testu, a nie „kod bez metadanych".
vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: async (env: string) => {
    h.stripeEnvs.push(env);
    return {
      promotionCodes: {
        retrieve: async (id: string) => {
          h.log.push(`promo:${id}`);
          const reply = h.promotionCodes[id];
          if (reply instanceof Error) throw reply;
          if (!reply) throw new Error(`test: nieznany kod promocyjny ${id}`);
          return { id, ...reply };
        },
      },
    };
  },
}));

// PUŁAPKA PAY-14b: środowisko „domyślne" zawsze wskazuje piaskownicę. Zwrot
// zlecony przez `resolveEnvironment(null)` zamiast środowiska zdarzenia
// pokazałby się w teście jako `sandbox` przy zdarzeniu `live`.
vi.mock("@/lib/billing/transactions.server", () => ({
  resolveEnvironment: () => "sandbox" as const,
}));

vi.mock("@/lib/billing/couponEffects.server", () => ({
  applyCouponEffectsForOrder: async () => {
    h.log.push("coupon");
  },
}));

vi.mock("@/lib/billing/notifications.server", () => ({
  notifySubscriptionEmail: async (input: Record<string, unknown>) => {
    h.log.push("mail:subscription");
    h.subscriptionMails.push(input);
  },
  notifyEventRegistration: async (input: Record<string, unknown>) => {
    h.log.push("mail:event");
    h.eventMails.push(input);
  },
  notifyRefundEmail: async (input: Record<string, unknown>) => {
    h.log.push("mail:refund");
    h.refundMails.push(input);
  },
}));

vi.mock("@/lib/events/registrationOutcomeNotify.server", () => ({
  notifyTicketOutcome: async (payload: unknown) => {
    h.log.push("notify");
    h.notifyPayloads.push(payload);
    if (h.notifyThrows) throw new Error("test: powiadomienie padło");
    return { emailed: false, smsSent: false, promotedNotified: 0, organizerAlerted: 0 };
  },
  notifyTicketRefusal: async (payload: unknown) => {
    h.log.push("notify:refusal");
    h.refusals.push(payload);
  },
}));

vi.mock("@/lib/events/ticketCodeNotify.server", () => ({
  issueAndSendTicketCodes: async (registrationId: string) => {
    h.log.push("codes");
    h.issued.push(registrationId);
    return 1;
  },
}));

vi.mock("@/lib/billing/donations.server", () => ({
  settleDonation: async (input: Record<string, unknown>) => {
    h.donations.push(input);
    return h.donationSettled;
  },
}));

import {
  applyTicketOutcome,
  expireCheckoutOrder,
  fulfilOneTimeTransaction,
  markOneTimePaymentFailed,
  runUnsettledFreeTicketOrders,
  settleFreeTicketOrder,
  settleSubscriptionCheckoutOrder,
  type OneTimeTransaction,
} from "@/lib/billing/oneTimeFulfilment.server";

// --- dane wejściowe ---------------------------------------------------------

const ORDER_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const USER = "22222222-bbbb-4bbb-8bbb-222222222222";
const TENANT = "33333333-cccc-4ccc-8ccc-333333333333";
const EVENT = "44444444-dddd-4ddd-8ddd-444444444444";
const REG = "55555555-eeee-4eee-8eee-555555555555";

interface OrderRow {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  plan_id: string | null;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  metadata: Record<string, unknown> | null;
  environment?: string;
  status?: string;
  refunded_amount_cents?: number;
  provider_session_id?: string | null;
  provider_intent_id?: string | null;
  provider_subscription_id?: string | null;
  provider?: string;
}

function orderRow(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    user_id: USER,
    tenant_id: TENANT,
    plan_id: null,
    kind: "one_time",
    entity_type: null,
    entity_id: null,
    amount_cents: 12_000,
    currency: "pln",
    metadata: { event_id: EVENT },
    environment: "sandbox",
    ...over,
  };
}

function txn(over: Partial<OneTimeTransaction> = {}): OneTimeTransaction {
  return {
    id: "txn_test_1",
    amountCents: 12_000,
    currency: "pln",
    customerEmail: "kupujacy@example.com",
    customData: { purpose: "order", orderId: ORDER_ID },
    ...over,
  };
}

/** Odpowiedź RPC z ładunkiem zgłoszenia. */
function rpcPaid(over: Record<string, unknown> = {}): RpcReply {
  return {
    data: { applied: true, registration_id: REG, outcome: "paid", ...over },
    error: null,
  };
}

function rpcError(code: string | undefined, message = "test: błąd RPC"): RpcReply {
  return { data: null, error: { ...(code === undefined ? {} : { code }), message } };
}

let orderResponse: SupabaseResult;
/**
 * KAŻDE warunkowe przestawienie statusu (`.in("status", ...)` + `.select("id")`):
 * księgowanie `paid`, zamknięcie `canceled` / `failed`. Pusta lista = żaden
 * wiersz nie spełnił warunku (powtórka albo zamówienie już zamknięte).
 */
let paidFlipResponse: SupabaseResult;
let oversoldFlipResponse: SupabaseResult;
/** Ponowny odczyt statusu po pustym przestawieniu (`select("status")`). */
let stateResponse: SupabaseResult;
let rsvpResponse: SupabaseResult;
/** Kupon z bazy, do którego odsyła kod promocyjny najemcy (`b2b_coupons`). */
let couponResponse: SupabaseResult;
let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

function givenOrder(row: OrderRow | null): void {
  orderResponse = ok(row);
}

beforeEach(() => {
  h.log.length = 0;
  h.rpcCalls.length = 0;
  h.rpcReplies.length = 0;
  h.seat = "free";
  h.claimCalls.length = 0;
  h.refusals.length = 0;
  h.refund = { ok: true, adjustmentId: "adj_1" };
  h.notifyPayloads.length = 0;
  h.notifyThrows = false;
  h.issued.length = 0;
  h.eventMails.length = 0;
  h.subscriptionMails.length = 0;
  h.refundMails.length = 0;
  h.grants.length = 0;
  h.donations.length = 0;
  h.donationSettled = true;
  h.refundEnvs.length = 0;
  h.revokedOrders.length = 0;
  h.revokedRefs.length = 0;
  h.couponReleases.length = 0;
  h.couponReleaseReply = { data: true, error: null };
  h.legacyCouponReleases.length = 0;
  h.legacyCouponReleaseReply = { data: true, error: null };
  h.adminBells.length = 0;
  h.refundCalls.length = 0;
  h.promotionCodes = {};
  h.stripeEnvs.length = 0;

  givenOrder(orderRow());
  paidFlipResponse = ok([{ id: ORDER_ID }]);
  oversoldFlipResponse = ok(null);
  stateResponse = ok({ status: "paid" });
  rsvpResponse = ok(null);
  couponResponse = ok(null);

  const next = supabaseFromStub();
  // Jedna tabela, cztery różne zapytania: odczyt zamówienia, warunkowe
  // przestawienie statusu (`.in("status", ...)` - stempel `paid_at` raz),
  // ponowny odczyt samego statusu i zamknięcie zwrotem przy pełnej sali.
  next.setResponse("payment_orders", (chain) => {
    if (chain.has("update")) return chain.has("in") ? paidFlipResponse : oversoldFlipResponse;
    if (chain.argsOf("select")?.[0] === "status") return stateResponse;
    return orderResponse;
  });
  next.setResponse("event_rsvps", () => rsvpResponse);
  next.setResponse("notifications", ok(null));
  // Alert „płatność do weryfikacji" (PAY-06) - administrator najemcy zamówienia.
  next.setResponse("user_roles", ok([{ user_id: "admin-1" }]));
  next.setResponse("profiles", ok([{ id: "admin-1" }]));
  next.setResponse("b2b_coupons", () => couponResponse);
  h.stub = next;

  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

function stub(): SupabaseFromStub {
  if (!h.stub) throw new Error("test: brak atrapy Supabase");
  return h.stub;
}

/** Łatka warunkowego przestawienia statusu (księgowanie / zamknięcie) - update z `.in`. */
function paidPatch(): Record<string, unknown> | undefined {
  const chain = stub()
    .chainsFor("payment_orders")
    .find((c) => c.has("update") && c.has("in"));
  return chain?.argsOf("update")?.[0] as Record<string, unknown> | undefined;
}

function rsvpRows(): Array<Record<string, unknown>> {
  return stub()
    .chainsFor("event_rsvps")
    .map((c) => c.argsOf("upsert")?.[0] as Record<string, unknown>);
}

function errorMessages(): string[] {
  return errorSpy.mock.calls.map((call) => String(call[0]));
}

// --- 1. rozdział transakcji -------------------------------------------------

describe("fulfilOneTimeTransaction - rozdział na skutek biznesowy", () => {
  it("`purpose=donation` księguje darowiznę z pól custom_data", async () => {
    const outcome = await fulfilOneTimeTransaction(
      txn({
        customData: { purpose: "donation", donationId: "don_1", sessionId: "cs_1" },
        customerEmail: "darczynca@example.com",
        paymentIntentId: "pi_darowizna_1",
      }),
      "sandbox",
    );

    expect(outcome).toBe("donation");
    // AUDYT SUB-09/SUB-10: w polu intencji ląduje INTENCJA płatności (po niej
    // przychodzi zwrot), a nie identyfikator sesji/transakcji; środowisko
    // zdarzenia bramkuje zapis tak samo jak przy zamówieniu.
    expect(h.donations[0]).toEqual({
      environment: "sandbox",
      donationId: "don_1",
      sessionId: "cs_1",
      intentId: "pi_darowizna_1",
      amountCents: 12_000,
      currency: "pln",
      donorEmail: "darczynca@example.com",
    });
    // Darowizna nie nadaje uprawnienia i nie dotyka zamówień.
    expect(h.grants).toHaveLength(0);
    expect(stub().chainsFor("payment_orders")).toHaveLength(0);
  });

  it("historyczne `kind=donation` bez sesji: sesją jest id transakcji, nierozliczona = skipped", async () => {
    h.donationSettled = false;
    const outcome = await fulfilOneTimeTransaction(
      txn({ customData: { kind: "donation" } }),
      "sandbox",
    );

    expect(outcome).toBe("skipped");
    expect(h.donations[0]).toMatchObject({ donationId: null, sessionId: "txn_test_1" });
  });

  it("klucz `order_id` (zapis z podkreślnikiem) prowadzi do tego samego zamówienia co `orderId`", async () => {
    const outcome = await fulfilOneTimeTransaction(
      txn({ customData: { kind: "order", order_id: ORDER_ID } }),
      "sandbox",
    );

    expect(outcome).toBe("order");
    expect(stub().lastChain("payment_orders")?.argsOf("eq")).toEqual(["id", ORDER_ID]);
  });

  it.each([
    ["bez custom_data", null],
    ["z identyfikatorem z samych spacji", { orderId: "   " }],
  ] as const)("transakcja %s jest pomijana z ostrzeżeniem", async (_label, customData) => {
    const outcome = await fulfilOneTimeTransaction(
      txn({ customData: customData === null ? null : { ...customData } }),
      "sandbox",
    );

    expect(outcome).toBe("skipped");
    expect(stub().chains).toHaveLength(0);
    expect(warnSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[payments] one-time transaction without recognised custom_data",
    );
  });
});

// --- 2. odczyt zamówienia i izolacja środowisk ------------------------------

describe("fulfilOrder - odczyt zamówienia", () => {
  it("błąd odczytu RZUCA - webhook ma zostać ponowiony", async () => {
    orderResponse = fail("odczyt zamówienia odrzucony");

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      "one-time: order lookup failed: odczyt zamówienia odrzucony",
    );
    expect(h.grants).toHaveLength(0);
  });

  it("nieznane zamówienie jest pomijane, bez nadania uprawnienia", async () => {
    givenOrder(null);

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");
    expect(h.grants).toHaveLength(0);
    expect(warnSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[payments] one-time: unknown order",
    );
  });

  it("zamówienie bez kolumny środowiska jest zamówieniem LIVE", async () => {
    // Wiersze sprzed 20260731220000 nie mają `environment`. Domyślne 'live'
    // znaczy: sandboxowy webhook takiego zamówienia NIE zrealizuje.
    givenOrder(orderRow({ environment: undefined }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");
    expect(h.grants).toHaveLength(0);

    expect(await fulfilOneTimeTransaction(txn(), "live")).toBe("order");
    expect(h.grants).toHaveLength(1);
  });
});

// --- 3. księgowanie i zamówienie bez wydarzenia -----------------------------

describe("fulfilOrder - zamówienie już zwrócone", () => {
  it("ponowiony webhook NIE przestawia zwrotu z powrotem na opłacone ani nie wydaje skutków", async () => {
    // Dyspozytor ponawia `transaction.completed` po błędzie zapisu dokumentu;
    // zamówienie zdążyło już przejść zwrot (odmowa wpłaty, pełna sala).
    givenOrder(orderRow({ status: "refunded" }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");
    expect(h.grants).toHaveLength(0);
    expect(paidPatch()).toBeUndefined();
    expect(h.rpcCalls).toHaveLength(0);
    expect(h.eventMails).toHaveLength(0);
  });

  it("anulowane zamówienie z opłaconą sesją JEST rozliczane - to realna wpłata", async () => {
    givenOrder(orderRow({ status: "canceled" }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(paidPatch()).toMatchObject({ status: "paid" });
  });
});

describe("fulfilOrder - księgowanie", () => {
  it("brak kwoty i waluty w transakcji spada na zamówienie, a waluta idzie wielkimi literami", async () => {
    givenOrder(orderRow({ metadata: null, currency: "eur", amount_cents: 9_900 }));
    const outcome = await fulfilOneTimeTransaction(
      txn({ amountCents: null, currency: null }),
      "sandbox",
    );

    expect(outcome).toBe("order");
    expect(paidPatch()).toMatchObject({ amount_cents: 9_900, currency: "EUR" });
    expect(h.grants[0]).toMatchObject({ amount_cents: 9_900 });
  });

  it("bez waluty gdziekolwiek księgujemy PLN", async () => {
    givenOrder(orderRow({ metadata: null, currency: null }));
    await fulfilOneTimeTransaction(txn({ currency: null }), "sandbox");

    expect(paidPatch()).toMatchObject({ currency: "PLN" });
  });

  it("identyfikatory operatora trafiają do zamówienia tylko wtedy, gdy przyszły", async () => {
    givenOrder(orderRow({ metadata: null }));
    await fulfilOneTimeTransaction(
      txn({ sessionId: "cs_42", paymentIntentId: "pi_42", customerId: "cus_42" }),
      "sandbox",
    );
    expect(paidPatch()).toMatchObject({
      status: "paid",
      provider: "stripe",
      provider_intent_id: "txn_test_1",
      provider_session_id: "cs_42",
      provider_payment_intent_id: "pi_42",
      provider_customer_id: "cus_42",
      receipt_email: "kupujacy@example.com",
    });
    // Księgowanie WYŁĄCZNIE ze statusu, który wolno rozliczyć - zwrócone
    // zamówienie nie wraca na opłacone (PAY-07); anulowane z wpłatą operatora
    // jest realną wpłatą (#498).
    expect(
      stub()
        .chainsFor("payment_orders")
        .find((c) => c.has("update"))
        ?.argsOf("in"),
    ).toEqual(["status", ["pending", "processing", "failed", "canceled"]]);

    stub().reset();
    stub().setResponse("payment_orders", (chain) =>
      chain.has("update") ? paidFlipResponse : orderResponse,
    );
    await fulfilOneTimeTransaction(txn({ customerEmail: null }), "sandbox");
    const bare = paidPatch() ?? {};
    // Bez sesji sesją jest transakcja; pustych pól nie wpisujemy wcale -
    // `undefined` w łatce nadpisałby wartość z wcześniejszego zdarzenia.
    expect(bare["provider_session_id"]).toBe("txn_test_1");
    expect(bare).not.toHaveProperty("provider_payment_intent_id");
    expect(bare).not.toHaveProperty("provider_customer_id");
    expect(bare).not.toHaveProperty("receipt_email");
  });

  it("nieudane księgowanie RZUCA, zanim cokolwiek potwierdzi zapis", async () => {
    paidFlipResponse = fail("księgowanie odrzucone");

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      "one-time: order paid flip failed: księgowanie odrzucone",
    );
    // Uprawnienie przed statusem - retry po awarii księgowania nie może
    // zostać pominięty przez `status='paid'`.
    expect(h.log.indexOf("grant")).toBeGreaterThanOrEqual(0);
    expect(h.rpcCalls).toHaveLength(0);
    expect(rsvpRows()).toHaveLength(0);
  });

  it("zamówienie bez wydarzenia: bez RPC biletu, bez RSVP i bez maila o wydarzeniu", async () => {
    givenOrder(orderRow({ metadata: {} }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.rpcCalls).toHaveLength(0);
    expect(rsvpRows()).toHaveLength(0);
    expect(h.eventMails).toHaveLength(0);
    expect(h.log).toContain("coupon");
  });

  it("subskrypcja kupiona jednorazowo dostaje mail potwierdzenia subskrypcji", async () => {
    givenOrder(orderRow({ kind: "subscription", plan_id: "plan_pro", metadata: null }));
    await fulfilOneTimeTransaction(txn(), "sandbox");

    expect(h.subscriptionMails).toEqual([
      {
        kind: "subscription_confirmed",
        userId: USER,
        planId: "plan_pro",
        amountCents: 12_000,
        currency: "PLN",
        idempotencySeed: ORDER_ID,
      },
    ]);
  });

  it("5.12: plan JEDNORAZOWY (dożywotni, `kind = one_time`) też dostaje mail potwierdzenia planu", async () => {
    // Od PAY-01 kasa `/checkout/$planId` stempluje `kind = one_time` dla planu
    // z interwałem jednorazowym; warunek `kind === "subscription"` gubił mail.
    givenOrder(orderRow({ kind: "one_time", plan_id: "plan_decision_lab", metadata: null }));

    await fulfilOneTimeTransaction(txn(), "sandbox");

    expect(h.subscriptionMails).toEqual([
      expect.objectContaining({
        kind: "subscription_confirmed",
        planId: "plan_decision_lab",
        idempotencySeed: ORDER_ID,
      }),
    ]);
  });

  it("zakup pojedynczej treści (encja, bez planu) nie dostaje maila o planie", async () => {
    givenOrder(
      orderRow({ kind: "one_time", entity_type: "post", entity_id: "post-1", metadata: null }),
    );

    await fulfilOneTimeTransaction(txn(), "sandbox");

    expect(h.subscriptionMails).toHaveLength(0);
  });

  it("zamówienie zanonimizowane: księgi tak, adresata nie ma - bez bramki miejsc, RSVP i maili", async () => {
    // Bez właściciela nie ma czyich RSVP liczyć ani komu zwracać uwagi o sali.
    h.seat = "full";
    givenOrder(orderRow({ user_id: null }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.log).not.toContain("refund");
    expect(h.log).toEqual(expect.arrayContaining(["grant", "from:payment_orders", "coupon"]));
    expect(h.rpcCalls).toHaveLength(0);
    expect(rsvpRows()).toHaveLength(0);
    expect(h.eventMails).toHaveLength(0);
    expect(warnSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[payments] one-time: order has no owner (anonymised), effects skipped",
    );
  });
});

// --- 4. miejsce RSVP zakupu bez zgłoszenia (TIX-08) -------------------------

describe("miejsce RSVP zakupu bez zgłoszenia - decyzja bazy pod blokadą", () => {
  it("zamówienie ze zgłoszeniem NIE jest zwracane z księgi RSVP - decyduje baza", async () => {
    // Baza rozstrzyga pod blokadą i stawia wpłatę w kolejce opłaconej - bez
    // zajmowania miejsca RSVP i bez zwrotu.
    h.seat = "full";
    givenOrder(orderRow({ metadata: { event_id: EVENT, registration_id: REG } }));
    h.rpcReplies.push(rpcPaid({ registration_status: "waitlist", waitlist_position: 2 }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.log).not.toContain("refund");
    expect(h.claimCalls).toHaveLength(0);
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["paid"]);
  });

  it("wolne miejsce: baza zajmuje je pod blokadą, potem mail o wydarzeniu", async () => {
    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.claimCalls).toEqual([{ p_order_id: ORDER_ID }]);
    expect(h.log.indexOf("rpc:claim")).toBeGreaterThan(h.log.indexOf("rpc:paid"));
    expect(h.log.indexOf("mail:event")).toBeGreaterThan(h.log.indexOf("rpc:claim"));
    // RSVP zapisuje funkcja bazy - TS nie pisze go drugi raz poza blokadą.
    expect(rsvpRows()).toHaveLength(0);
    expect(h.eventMails).toHaveLength(1);
  });

  it("zakup bez zgłoszenia przy pełnej sali: zwrot, zamówienie zamknięte, bez dzwonka bez najemcy", async () => {
    h.seat = "full";
    givenOrder(orderRow({ tenant_id: null }));

    expect(await fulfilOneTimeTransaction(txn({ customerEmail: null }), "sandbox")).toBe(
      "oversold_refunded",
    );
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && !c.has("in"));
    expect(flip?.argsOf("update")?.[0]).toMatchObject({ status: "refunded", provider: "stripe" });
    expect(flip?.argsOf("update")?.[0]).not.toHaveProperty("receipt_email");
    // Zgłoszenie (jeśli było) dostaje wynik `refunded` - kolejka rusza.
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["paid", "refunded"]);
    expect(h.refundMails[0]).toMatchObject({
      userId: USER,
      idempotencySeed: `oversold:${ORDER_ID}`,
    });
    // Wpis dzwonka bez najemcy wyświetlałby się wszystkim albo nikomu.
    expect(stub().chainsFor("notifications")).toHaveLength(0);
    expect(h.eventMails).toHaveLength(0);
  });

  it("powtórka OPŁACONEGO zakupu bez zgłoszenia nie zwraca pieniędzy - sala zapełniona po zajęciu miejsca", async () => {
    // Pierwsza dostawa przestawiła zamówienie na `paid` i zajęła miejsce RSVP
    // pod blokadą, po czym proces padł przed domknięciem dziennika. Zanim
    // zdarzenie wróciło, resztę sali wykupili inni. Miejsce rozstrzyga
    // ponownie baza: widzi RSVP 'going' TEGO kupującego i odpowiada
    // `already: true` mimo pełnej sali. Gdyby liczyła pojemność przed tym
    // sprawdzeniem, powtórka zwracałaby pieniądze za bilet z zajętym miejscem.
    h.seat = "already";
    givenOrder(orderRow({ status: "paid" }));
    paidFlipResponse = ok([]);
    // Domyślna odpowiedź RPC biletu: zakup bez zgłoszenia (`registration_not_found`).

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");

    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["paid"]);
    expect(h.claimCalls).toEqual([{ p_order_id: ORDER_ID }]);
    expect(h.log).not.toContain("refund");
    expect(h.refundCalls).toHaveLength(0);
    expect(h.grants).toHaveLength(1);
    // RSVP zapisała baza przy pierwszej dostawie - TS nie pisze go drugi raz.
    expect(rsvpRows()).toHaveLength(0);
  });

  it("zwrot przy pełnej sali z najemcą zostawia dzwonek i adres na rachunku", async () => {
    h.seat = "full";

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("oversold_refunded");
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && !c.has("in"));
    expect(flip?.argsOf("update")?.[0]).toMatchObject({ receipt_email: "kupujacy@example.com" });
    expect(stub().lastChain("notifications")?.argsOf("insert")?.[0]).toMatchObject({
      user_id: USER,
      tenant_id: TENANT,
      href: "/profile/tickets",
    });
  });

  it("S3 / 5.2 / 7.7: zamknięcie zwrotem zapisuje kwotę zwróconą brutto i intencję płatności", async () => {
    // Stripe dosyła potem `charge.refunded` tego samego zwrotu, a obsługa
    // korekt znajduje zamówienie przez sesję. Bez licznika zwrotów i intencji
    // wyglądało to tam jak NOWY zwrot: drugi mail, drugi dzwonek, drugi wynik
    // biletu. Z licznikiem równym kwocie korekta trafia w bramkę powtórki.
    h.seat = "full";
    givenOrder(orderRow({ amount_cents: 8_000, environment: "live" }));
    expect(
      await fulfilOneTimeTransaction(
        txn({
          id: "cs_pelna_sala",
          sessionId: "cs_pelna_sala",
          paymentIntentId: "pi_pelna_sala",
          amountCents: 9_840,
          amountSubtotalCents: 8_000,
          amountDiscountCents: 0,
          amountTaxCents: 1_840,
        }),
        "live",
      ),
    ).toBe("oversold_refunded");

    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && !c.has("in"));
    expect(flip?.argsOf("update")?.[0]).toMatchObject({
      status: "refunded",
      provider_intent_id: "cs_pelna_sala",
      provider_payment_intent_id: "pi_pelna_sala",
      amount_cents: 9_840,
      refunded_amount_cents: 9_840,
      currency: "PLN",
    });
    // PAY-14b: zwrot całej sesji, w środowisku zdarzenia, z powodem domenowym
    // (klucz idempotencji składa `refundProvider` z tej trójki).
    expect(h.refundCalls).toEqual([["live", "cs_pelna_sala", "oversold"]]);
    // Mail o zwrocie podaje kwotę, która naprawdę wróciła (brutto).
    expect(h.refundMails[0]).toMatchObject({ amountCents: 9_840, currency: "PLN" });
  });

  it("błąd zajęcia miejsca NIE jest pełną salą - rzuca dalej, bez zwrotu", async () => {
    h.seat = "broken";

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      `one-time: rsvp seat claim failed (${ORDER_ID}): test: odczyt pojemności padł`,
    );
    expect(h.log).not.toContain("refund");
    expect(h.eventMails).toHaveLength(0);
  });

  it("okno wdrożenia (brak funkcji w bazie): dawny odczyt miejsc i RSVP z kodu", async () => {
    h.seat = "legacy-free";

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.log).toContain("seat:legacy");
    expect(rsvpRows()[0]).toMatchObject({ event_id: EVENT, user_id: USER, status: "going" });
    expect(h.eventMails).toHaveLength(1);
  });

  it("okno wdrożenia przy pełnej sali: zwrot", async () => {
    h.seat = "legacy-full";

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("oversold_refunded");
    expect(h.log).toContain("refund");
    expect(rsvpRows()).toHaveLength(0);
  });

  it.each([
    ["inny błąd odczytu pojemności", "legacy-broken" as const, "test: odczyt pojemności padł"],
    ["rzut bez obiektu Error", "legacy-thrown-string" as const, "test: rzut bez obiektu Error"],
  ])(
    "okno wdrożenia: %s NIE jest pełną salą - rzuca dalej, bez zwrotu",
    async (_l, seat, message) => {
      h.seat = seat;

      await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toSatisfy((err: unknown) =>
        err instanceof Error ? err.message === message : err === message,
      );
      expect(h.log).not.toContain("refund");
    },
  );

  it("odmowa zwrotu u operatora RZUCA - sprawa nie jest zamknięta", async () => {
    h.seat = "full";
    h.refund = { ok: false, error: "charge_already_refunded" };

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      "one-time: oversold refund failed (txn_test_1): charge_already_refunded",
    );
    expect(
      stub()
        .chainsFor("payment_orders")
        .filter((c) => c.has("update") && !c.has("in")),
    ).toHaveLength(0);
  });

  it("nieudane zamknięcie zamówienia zwrotem RZUCA", async () => {
    h.seat = "full";
    oversoldFlipResponse = fail("zamknięcie odrzucone");

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      "one-time: oversold status flip failed: zamknięcie odrzucone",
    );
    expect(h.refundMails).toHaveLength(0);
  });
});

// --- 5. zgłoszenie PRZED RSVP (kroki 4-5) -----------------------------------

describe("kroki 4-5 - najpierw baza, potem RSVP i „miejsce zarezerwowane”", () => {
  it("przyjęte zgłoszenie: RPC, potem RSVP 'going', potem mail o wydarzeniu", async () => {
    h.rpcReplies.push(rpcPaid({ registration_status: "approved", newly_settled: true }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    const rpcAt = h.log.indexOf("rpc:paid");
    const rsvpAt = h.log.indexOf("from:event_rsvps");
    const mailAt = h.log.indexOf("mail:event");
    expect(rpcAt).toBeGreaterThan(h.log.indexOf("coupon"));
    expect(rsvpAt).toBeGreaterThan(rpcAt);
    expect(mailAt).toBeGreaterThan(rsvpAt);
    expect(rsvpRows()[0]).toMatchObject({
      tenant_id: TENANT,
      event_id: EVENT,
      user_id: USER,
      status: "going",
    });
    expect(stub().lastChain("event_rsvps")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "event_id,user_id",
    });
    expect(h.eventMails[0]).toMatchObject({
      userId: USER,
      eventId: EVENT,
      amountCents: 12_000,
      currency: "PLN",
      transactionId: "txn_test_1",
      ticketSeed: ORDER_ID,
      idempotencySeed: ORDER_ID,
    });
    expect(h.issued).toEqual([REG]);
  });

  it.each(["waitlist", "pending", "cancelled"])(
    "wpłata bez miejsca (%s): bez RSVP i bez „miejsce zarezerwowane”, księgi i uprawnienie tak",
    async (status) => {
      h.rpcReplies.push(rpcPaid({ registration_status: status, newly_settled: true }));

      expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
      expect(rsvpRows()).toHaveLength(0);
      expect(h.eventMails).toHaveLength(0);
      expect(h.grants).toHaveLength(1);
      expect(paidPatch()).toMatchObject({ status: "paid" });
      // Właściwy mail (kolejka / decyzja) wysyła moduł powiadomień z ładunku.
      expect(h.notifyPayloads[0]).toMatchObject({ registration_status: status });
    },
  );

  it("`registration_not_found` (zakup bez zgłoszenia): miejsce RSVP z bazy i mail", async () => {
    h.rpcReplies.push({ data: { applied: false, reason: "registration_not_found" }, error: null });

    await fulfilOneTimeTransaction(txn(), "sandbox");

    expect(h.claimCalls).toHaveLength(1);
    expect(h.eventMails).toHaveLength(1);
    expect(h.issued).toHaveLength(0);
  });

  it.each([
    "already_settled_by_another_order",
    "registration_not_owned",
    "amount_mismatch",
    "registration_mismatch",
  ])(
    "odmowa bazy (%s): bez RSVP, bez „miejsce zarezerwowane”, zawiadomienie o odmowie (TIX-05)",
    async (reason) => {
      givenOrder(orderRow({ metadata: { event_id: EVENT, registration_id: REG } }));
      const refusal = { applied: false, refused: true, reason, refund_queued: true };
      h.rpcReplies.push({ data: refusal, error: null });

      expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
      expect(rsvpRows()).toHaveLength(0);
      expect(h.claimCalls).toHaveLength(0);
      expect(h.eventMails).toHaveLength(0);
      expect(h.issued).toHaveLength(0);
      expect(h.refusals).toEqual([refusal]);
      expect(h.notifyPayloads).toHaveLength(0);
      // Księgi tak: wpłata jest pobrana, zwrot czeka w kolejce bazy.
      expect(paidPatch()).toMatchObject({ status: "paid" });
    },
  );

  it("nieudane RSVP RZUCA - webhook ma dokończyć potwierdzenie", async () => {
    h.rpcReplies.push(rpcPaid({ registration_status: "approved" }));
    rsvpResponse = fail("rsvp odrzucone");

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      "one-time: rsvp confirm failed: rsvp odrzucone",
    );
    expect(h.eventMails).toHaveLength(0);
  });
});

// --- 6. applyTicketOutcome: ponowienie i ładunek -----------------------------

describe("applyTicketOutcome - jedno ponowienie przy zakleszczeniu", () => {
  it("40P01, potem sukces: dwa wywołania i ładunek drugiego", async () => {
    h.rpcReplies.push(rpcError("40P01", "deadlock detected"));
    h.rpcReplies.push(rpcPaid({ registration_status: "waitlist" }));

    const payload = await applyTicketOutcome(ORDER_ID, "paid");

    expect(h.rpcCalls).toHaveLength(2);
    expect(h.rpcCalls[1]?.args).toEqual(h.rpcCalls[0]?.args);
    expect(payload).toMatchObject({ registration_id: REG, registration_status: "waitlist" });
    expect(errorMessages()).not.toContain("[payments] ticket outcome failed");
  });

  it("ponowienie w webhooku: kolejka z drugiej próby też nie dostaje RSVP", async () => {
    h.rpcReplies.push(rpcError("40P01"));
    h.rpcReplies.push(rpcPaid({ registration_status: "waitlist" }));

    await fulfilOneTimeTransaction(txn(), "sandbox");

    expect(rsvpRows()).toHaveLength(0);
    expect(h.eventMails).toHaveLength(0);
  });

  it("40001 dwa razy przy WPŁACIE: wyjątek (webhook ponowi), bez RSVP i bez maila (TIX-05)", async () => {
    // Dawniej `null` szło „starą ścieżką z RSVP": link wejścia i „miejsce
    // zarezerwowane" przy nieopłaconym zgłoszeniu bez kodu QR.
    h.rpcReplies.push(rpcError("40001"));
    h.rpcReplies.push(rpcError("40001", "could not serialize access"));

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      `one-time: ticket outcome failed (${ORDER_ID}): could not serialize access`,
    );
    expect(h.rpcCalls).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "[payments] ticket outcome failed",
      ORDER_ID,
      "paid",
      "could not serialize access",
    );
    expect(h.notifyPayloads).toHaveLength(0);
    expect(rsvpRows()).toHaveLength(0);
    expect(h.claimCalls).toHaveLength(0);
    expect(h.eventMails).toHaveLength(0);
  });

  it.each([
    ["inny SQLSTATE", "23514"],
    ["błąd bez kodu", undefined],
  ] as const)("%s przy wpłacie: bez ponowienia, wyjątek", async (_label, code) => {
    h.rpcReplies.push(rpcError(code));

    await expect(applyTicketOutcome(ORDER_ID, "paid")).rejects.toThrow(
      "one-time: ticket outcome failed",
    );
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.issued).toHaveLength(0);
  });

  it.each([
    ["inny SQLSTATE", "23514"],
    ["błąd bez kodu", undefined],
  ] as const)("%s przy zwrocie: bez ponowienia, `null` (miękki skutek)", async (_label, code) => {
    h.rpcReplies.push(rpcError(code));

    expect(await applyTicketOutcome(ORDER_ID, "refunded")).toBeNull();
    expect(h.rpcCalls).toHaveLength(1);
  });
});

describe("applyTicketOutcome - ładunek, powiadomienie i bilety", () => {
  it.each([
    ["null", null],
    ["tablica", [{ registration_id: REG }]],
    ["napis", "ok"],
  ] as const)(
    "odpowiedź nie-obiekt (%s): przy wpłacie wyjątek, przy zwrocie `null` - bez powiadomień i biletów",
    async (_l, data) => {
      h.rpcReplies.push({ data, error: null });
      await expect(applyTicketOutcome(ORDER_ID, "paid")).rejects.toThrow(
        `one-time: ticket outcome unreadable (${ORDER_ID})`,
      );

      h.rpcReplies.push({ data, error: null });
      expect(await applyTicketOutcome(ORDER_ID, "refunded")).toBeNull();
      expect(h.notifyPayloads).toHaveLength(0);
      expect(h.issued).toHaveLength(0);
    },
  );

  it("bilety z kodem QR tylko po WPŁACIE i tylko dla zgłoszenia z identyfikatorem", async () => {
    h.rpcReplies.push(rpcPaid({ registration_id: 42 }));
    await applyTicketOutcome(ORDER_ID, "paid");
    expect(h.issued).toHaveLength(0);

    h.rpcReplies.push({
      data: { applied: true, registration_id: REG, outcome: "refunded" },
      error: null,
    });
    await applyTicketOutcome(ORDER_ID, "refunded");
    expect(h.issued).toHaveLength(0);

    h.rpcReplies.push(rpcPaid());
    await applyTicketOutcome(ORDER_ID, "paid");
    expect(h.issued).toEqual([REG]);
  });

  it("zwrot oddaje ładunek - wołający widzi, co baza zapisała", async () => {
    const data = { applied: true, registration_id: REG, outcome: "refunded", newly_settled: false };
    h.rpcReplies.push({ data, error: null });

    expect(await applyTicketOutcome(ORDER_ID, "refunded", 12_000)).toEqual(data);
    expect(h.notifyPayloads).toEqual([data]);
  });

  it("awaria powiadomienia nie zabiera ani ładunku, ani biletów", async () => {
    h.notifyThrows = true;
    h.rpcReplies.push(rpcPaid());

    expect(await applyTicketOutcome(ORDER_ID, "paid")).toMatchObject({ registration_id: REG });
    expect(h.issued).toEqual([REG]);
    expect(errorMessages()).toContain("[payments] ticket outcome notify failed");
  });

  it.each([
    ["ułamek groszy zaokrąglony", 1_234.6, 1_235],
    ["ujemna kwota przycięta do zera", -50, 0],
    ["NaN pominięte", Number.NaN, undefined],
    ["nieskończoność pominięta", Number.POSITIVE_INFINITY, undefined],
    ["null pominięte", null, undefined],
    ["brak argumentu", undefined, undefined],
  ] as const)("kwota zwrotu: %s", async (_label, cents, expected) => {
    await applyTicketOutcome(ORDER_ID, "partial_refund", cents);

    expect(h.rpcCalls[0]).toEqual({
      fn: "payments_apply_event_ticket_outcome",
      args: { p_order_id: ORDER_ID, p_outcome: "partial_refund", p_refunded_cents: expected },
    });
  });
});

// --- 7. nieudana płatność -----------------------------------------------------

describe("markOneTimePaymentFailed", () => {
  it.each([
    ["`orderId`", { orderId: ORDER_ID }],
    ["`order_id`", { order_id: ORDER_ID }],
  ] as const)("klucz %s oznacza zgłoszenie jako nieopłacone", async (_label, customData) => {
    await markOneTimePaymentFailed({ ...customData });

    expect(h.rpcCalls).toEqual([
      {
        fn: "payments_apply_event_ticket_outcome",
        args: { p_order_id: ORDER_ID, p_outcome: "unpaid", p_refunded_cents: undefined },
      },
    ]);
  });

  it.each([
    ["bez identyfikatora zamówienia", {}],
    ["bez custom_data", null],
  ] as const)("%s nic nie robi", async (_label, customData) => {
    await markOneTimePaymentFailed(customData === null ? null : { ...customData });

    expect(h.rpcCalls).toHaveLength(0);
  });
});

// --- 8. PAY-07: zwrot przed realizacją i powtórka po zwrocie -----------------

describe("PAY-07 - realizacja nie wskrzesza zwróconego zamówienia", () => {
  it("PAY-07: zwrot PRZED realizacją (`refunded`) -> spóźniona realizacja odmawia, bez uprawnienia", async () => {
    givenOrder(orderRow({ metadata: {}, status: "refunded", refunded_amount_cents: 12_000 }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");

    expect(h.grants).toHaveLength(0);
    expect(paidPatch()).toBeUndefined();
    expect(h.log).not.toContain("coupon");
    expect(h.subscriptionMails).toHaveLength(0);
    expect(warnSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[payments] one-time: order already refunded - fulfilment refused",
    );
  });

  it("2.8 / 5.9: zwrot CZĘŚCIOWY przed realizacją nie blokuje nadania - korekta ceny zostaje w księgach", async () => {
    // Webhook realizacji padł i czekał na ponowienie, a w tym czasie obsługa
    // oddała 10 zł z 120 zł (`refunds.server` zapisał licznik bez zmiany
    // statusu). Klient zapłacił resztę - odmowa zostawiała go bez dostępu na
    // zawsze, a naprawa uzgadniania odbijała się od tej samej bramki.
    givenOrder(orderRow({ status: "processing", refunded_amount_cents: 1_000 }));
    h.rpcReplies.push(rpcPaid({ registration_status: "approved" }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");

    expect(h.grants).toHaveLength(1);
    const patch = paidPatch() ?? {};
    expect(patch).toMatchObject({ status: "paid" });
    // Ta sama podstawa (kwota pobrana = kwota zamówienia): licznik zostaje.
    expect(patch).not.toHaveProperty("refunded_amount_cents");
    // Najpierw wpłata (miejsce), potem korekta ceny na zgłoszeniu - bez
    // drugiego powiadomienia (mail o zwrocie wysłała obsługa korekty).
    expect(h.rpcCalls.map((c) => c.args)).toEqual([
      { p_order_id: ORDER_ID, p_outcome: "paid", p_refunded_cents: undefined },
      { p_order_id: ORDER_ID, p_outcome: "partial_refund", p_refunded_cents: 1_000 },
    ]);
    expect(h.notifyPayloads).toHaveLength(1);
  });

  it("2.8 / 5.9: zwrot PEŁNY przed realizacją (licznik = kwota zamówienia) nadal blokuje nadanie", async () => {
    givenOrder(orderRow({ metadata: {}, status: "processing", refunded_amount_cents: 12_000 }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");
    expect(h.grants).toHaveLength(0);
    expect(paidPatch()).toBeUndefined();
  });

  it("R4: zwrot częściowy sprzed realizacji przechodzi na podstawę kwoty POBRANEJ razem z kwotą", async () => {
    // Bilet netto 80 zł, Stripe dolicza VAT i pobiera 98,40 zł. Obsługa oddała
    // 85 zł, zanim realizacja doszła - `refunds.server` zapisał to w podstawie
    // zamówienia: round(8 500 * 8 000 / 9 840) = 6 911. Realizacja przestawia
    // `amount_cents` na 9 840; licznik w starej podstawie dawał przychód netto
    // 29,29 zł zamiast 13,40 zł.
    givenOrder(
      orderRow({ status: "processing", amount_cents: 8_000, refunded_amount_cents: 6_911 }),
    );
    h.rpcReplies.push(rpcPaid({ registration_status: "approved" }));

    expect(
      await fulfilOneTimeTransaction(
        txn({
          amountCents: 9_840,
          amountSubtotalCents: 8_000,
          amountDiscountCents: 0,
          amountTaxCents: 1_840,
        }),
        "sandbox",
      ),
    ).toBe("order");

    const patch = paidPatch() ?? {};
    expect(patch).toMatchObject({
      status: "paid",
      amount_cents: 9_840,
      refunded_amount_cents: 8_500,
    });
    expect(Number(patch["amount_cents"]) - Number(patch["refunded_amount_cents"])).toBe(1_340);
    // Zapis warunkowy na liczniku, który przeczytaliśmy - zwrot zapisany
    // w międzyczasie nie zostanie nadpisany starą podstawą.
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && c.has("in"));
    expect(flip?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "refunded_amount_cents",
      6_911,
    ]);
    // Zgłoszenie dostaje korektę w tej samej podstawie co `amount_cents`.
    expect(h.rpcCalls.map((c) => c.args)).toContainEqual({
      p_order_id: ORDER_ID,
      p_outcome: "partial_refund",
      p_refunded_cents: 8_500,
    });
  });

  it.each([
    // [zwrócone u operatora, kwota zamówienia, kwota pobrana]
    [1, 8_000, 9_840],
    [8_500, 8_000, 9_840],
    [9_839, 8_000, 9_840],
    [1_000, 12_000, 7_000],
  ])(
    "R4: licznik %i (podstawa %i -> pobrane %i) wraca do kwoty operatora, nigdy jej nie zawyżając",
    async (refundedAtProvider, orderAmount, collected) => {
      // Przeliczenie `refunds.server`: kwota operatora -> podstawa zamówienia.
      const stored = Math.round((refundedAtProvider * orderAmount) / collected);
      givenOrder(
        orderRow({
          metadata: {},
          status: "processing",
          amount_cents: orderAmount,
          refunded_amount_cents: stored,
        }),
      );

      await fulfilOneTimeTransaction(txn({ amountCents: collected }), "sandbox");

      const rebased = Number(paidPatch()?.["refunded_amount_cents"]);
      expect(rebased).toBeLessThanOrEqual(refundedAtProvider);
      // Przeliczenie z powrotem daje ten sam zapisany licznik.
      expect(Math.round((rebased * orderAmount) / collected)).toBe(stored);
    },
  );

  it("R4: zwrot zapisany W TRAKCIE realizacji (licznik inny niż odczytany) - zdarzenie wraca, dostęp zostaje", async () => {
    // Zapis z przeliczonym licznikiem nie trafił (warunek licznika), a
    // zamówienie wciąż czeka na płatność: zwrot częściowy zmienił licznik
    // między odczytem a zapisem. Odebranie dostępu byłoby błędem (pieniądze
    // są), cichy `skipped` zostawiłby opłacone zamówienie w toku.
    givenOrder(
      orderRow({
        metadata: {},
        status: "processing",
        amount_cents: 8_000,
        refunded_amount_cents: 6_911,
      }),
    );
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "processing" });

    await expect(fulfilOneTimeTransaction(txn({ amountCents: 9_840 }), "sandbox")).rejects.toThrow(
      `one-time: refund counter changed while settling (${ORDER_ID})`,
    );
    expect(h.revokedOrders).toHaveLength(0);
    expect(h.log).not.toContain("coupon");
  });

  it("R4 + anulowane: wyścig licznika przy zamówieniu ANULOWANYM opłaconym przez Stripe - zdarzenie wraca, dostęp zostaje", async () => {
    // Płatność Stripe na anulowanym zamówieniu jednorazowym JEST rozliczana
    // (polityka main), więc `canceled` to dla tej ścieżki stan „do
    // rozliczenia", a nie zamknięty. Zapis z przeliczonym licznikiem nie
    // trafił, a ponowny odczyt wciąż daje `canceled`: zwrot zmienił licznik
    // między odczytem a zapisem. Odebranie dostępu i `skipped` zostawiłyby
    // opłacone zamówienie nierozliczone - ma polecieć wyjątek i ponowienie.
    givenOrder(
      orderRow({
        metadata: {},
        status: "canceled",
        amount_cents: 8_000,
        refunded_amount_cents: 6_911,
      }),
    );
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "canceled" });

    await expect(fulfilOneTimeTransaction(txn({ amountCents: 9_840 }), "sandbox")).rejects.toThrow(
      `one-time: refund counter changed while settling (${ORDER_ID})`,
    );
    // Zapis był warunkowy na zbiorze rozliczalnym Stripe (z `canceled`)
    // i na odczytanym liczniku.
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && c.has("in"));
    expect(flip?.argsOf("in")).toEqual(["status", ["pending", "processing", "failed", "canceled"]]);
    expect(flip?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "refunded_amount_cents",
      6_911,
    ]);
    // Uprawnienie nadane przed zapisem zostaje - pieniądze są, a ponowienie
    // dokończy księgowanie. Efektów kuponu bez `paid` nie ma.
    expect(h.grants).toHaveLength(1);
    expect(h.revokedOrders).toHaveLength(0);
    expect(h.log).not.toContain("coupon");
  });

  it("PAY-07: realizacja -> zwrot -> POWTÓRKA realizacji kończy się bez dostępu, status zostaje `refunded`", async () => {
    // Pierwsza realizacja: dostęp i `paid`.
    givenOrder(orderRow({ metadata: {}, status: "processing" }));
    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.grants).toHaveLength(1);

    // Zwrot (refunds.server) zamknął zamówienie. Powtórka tej samej dostawy
    // (operator, panel, uzgadnianie) widzi `refunded` i odmawia PRZED grantem.
    h.grants.length = 0;
    stub().reset();
    stub().setResponse("payment_orders", (chain) =>
      chain.has("update") ? paidFlipResponse : orderResponse,
    );
    givenOrder(orderRow({ metadata: {}, status: "refunded", refunded_amount_cents: 12_000 }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");
    expect(h.grants).toHaveLength(0);
    expect(
      stub()
        .chainsFor("payment_orders")
        .filter((c) => c.has("update")),
    ).toHaveLength(0);
  });

  it("PAY-07: zwrot WYPRZEDZIŁ nadanie (między odczytem a zapisem) -> uprawnienie odebrane od razu", async () => {
    // Odczyt widział `processing`, ale zanim księgowanie doszło do bazy, zwrot
    // przestawił zamówienie na `refunded`: warunkowy zapis nie trafia w nic,
    // a ponowny odczyt pokazuje zwrot.
    givenOrder(
      orderRow({
        kind: "one_time",
        plan_id: "plan_lifetime",
        metadata: {},
        status: "processing",
        provider_session_id: "cs_stara",
      }),
    );
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "refunded" });

    expect(await fulfilOneTimeTransaction(txn({ id: "cs_nowa" }), "sandbox")).toBe("skipped");

    // Nadanie było, więc odebranie MUSI objąć klucz, pod którym poszło (sesja
    // z tego zdarzenia), i klucze zapisane na zamówieniu.
    expect(h.log.indexOf("revoke")).toBeGreaterThan(h.log.indexOf("grant"));
    expect(h.revokedOrders).toEqual([expect.objectContaining({ id: ORDER_ID })]);
    expect(h.revokedRefs).toEqual(expect.arrayContaining(["cs_stara", "cs_nowa"]));
    expect(h.log).not.toContain("coupon");
    expect(h.subscriptionMails).toHaveLength(0);
    expect(errorMessages()).toContain(
      "[payments] one-time: order closed while fulfilling - entitlement revoked",
    );
  });

  it("powtórka realizacji OPŁACONEGO zamówienia: pusty zapis, stan `paid` - skutki idempotentne, bez odebrania", async () => {
    givenOrder(orderRow({ metadata: {}, status: "paid" }));
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "paid" });

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.revokedOrders).toHaveLength(0);
    expect(h.log).toContain("coupon");
  });

  it("awaria ponownego odczytu statusu RZUCA - webhook ma wrócić", async () => {
    paidFlipResponse = ok([]);
    stateResponse = fail("odczyt statusu odrzucony");

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      "one-time: order state lookup failed: odczyt statusu odrzucony",
    );
  });
});

// --- 9. PAY-06: kwota pobrana kontra kwota zamówienia -------------------------

describe("PAY-06 - porównanie kwoty z zamówieniem", () => {
  it("S5 / 4.2: kwota zgodna (`subtotal - rabat`), a księgi dostają kwotę POBRANĄ brutto z podatkiem", async () => {
    // Zamówienie 80 zł po kuponie (brutto 100 zł). Operator: pozycje 100 zł,
    // rabat 20 zł, VAT doliczony 18,40 zł - suma 98,40 zł. Porównanie
    // przechodzi, ale `amount_cents` to pieniądze, które wpłynęły: zwrot
    // pełny (9 840), faktura wydarzenia i przychód czytają tę kolumnę jako
    // brutto - zapis 8 000 dawał przychód -18,40 zł po pełnym zwrocie.
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, amount_cents: 8_000 }));

    await fulfilOneTimeTransaction(
      txn({
        amountCents: 9_840,
        amountSubtotalCents: 10_000,
        amountDiscountCents: 2_000,
        amountTaxCents: 1_840,
      }),
      "sandbox",
    );

    const patch = paidPatch();
    expect(patch).toMatchObject({ status: "paid", amount_cents: 9_840, currency: "PLN" });
    expect(patch).not.toHaveProperty("metadata");
    expect(h.adminBells).toHaveLength(0);
    // Uprawnienie (`user_purchases.amount_cents`) też widzi brutto.
    expect(h.grants[0]).toMatchObject({ amount_cents: 9_840 });
  });

  it("4.7: ładunek BEZ rozbicia kwoty (sprzed wdrożenia) nie jest porównywany - suma minus podatek to nie podstawa", async () => {
    // Powtórka wiersza dziennika sprzed wdrożenia: jest suma i podatek, nie
    // ma `amount_subtotal`. Dawny zapas `suma - podatek` przy podatku
    // doliczanym na wierzch dawał fałszywy rozjazd z alertem.
    givenOrder(orderRow({ metadata: {}, amount_cents: 8_000 }));

    await fulfilOneTimeTransaction(txn({ amountCents: 9_840, amountTaxCents: 1_000 }), "sandbox");

    const patch = paidPatch();
    expect(patch).toMatchObject({ status: "paid", amount_cents: 9_840 });
    expect(patch).not.toHaveProperty("metadata");
    expect(h.adminBells).toHaveLength(0);
    expect(errorMessages()).not.toContain("[payments] amount mismatch - order flagged for review");
  });

  it("6.7 / 7.4: alert przeglądu ma href unikalny dla zamówienia i powodu i idzie RAZ na odbiorcę", async () => {
    givenOrder(orderRow({ metadata: {}, amount_cents: 12_000 }));

    await fulfilOneTimeTransaction(
      txn({ amountCents: 7_000, amountSubtotalCents: 7_000, amountDiscountCents: 0 }),
      "sandbox",
    );

    const href = `/admin/billing?order=${ORDER_ID}&review=amount_mismatch`;
    expect(h.adminBells).toEqual([expect.objectContaining({ p_href: href, p_kind: "billing" })]);
    // `once`: przed dzwonkiem sprawdzamy, czy odbiorca nie ma już dzwonka
    // z tym href - ponowienie zdarzenia po oknie deduplikacji nie dubluje.
    const seen = stub()
      .chainsFor("notifications")
      .find((c) => c.calls.some((call) => call.method === "eq" && call.args[0] === "href"));
    expect(seen?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual(
      expect.arrayContaining([
        ["user_id", "admin-1"],
        ["tenant_id", TENANT],
        ["href", href],
      ]),
    );
  });

  it("PAY-06: rozjazd kwoty kończy się flagą do weryfikacji i alertem, a nie cichym `paid`", async () => {
    // Kod promocyjny Stripe spoza `b2b_coupons` zdjął 50 zł z zamówienia na
    // 120 zł. Pieniądze pobrano, więc księgujemy PRAWDZIWĄ kwotę i dajemy
    // dostęp (klient zapłacił tyle, ile przyjął operator), ale zamówienie
    // dostaje `metadata.review`, a administratorzy najemcy - alert.
    givenOrder(orderRow({ metadata: { label: "Wpis premium" }, amount_cents: 12_000 }));

    const outcome = await fulfilOneTimeTransaction(
      txn({
        amountCents: 7_000,
        amountSubtotalCents: 12_000,
        amountDiscountCents: 5_000,
        amountTaxCents: 0,
      }),
      "sandbox",
    );

    expect(outcome).toBe("order");
    expect(h.grants).toHaveLength(1);
    const patch = paidPatch();
    expect(patch).toMatchObject({
      status: "paid",
      amount_cents: 7_000,
      metadata: {
        label: "Wpis premium",
        review: {
          reason: "amount_mismatch",
          expected_cents: 12_000,
          expected_currency: "PLN",
          charged_cents: 7_000,
          currency: "PLN",
          flagged_at: expect.any(String),
        },
      },
    });
    expect(h.adminBells).toEqual([
      expect.objectContaining({ p_user_id: "admin-1", p_title_pl: "Płatność do weryfikacji" }),
    ]);
    expect(String(h.adminBells[0]?.["p_body_pl"])).toContain("70.00 PLN zamiast 120.00 PLN");
    expect(errorMessages()).toContain("[payments] amount mismatch - order flagged for review");
  });

  it("inna WALUTA niż zamówienie to też rozjazd", async () => {
    givenOrder(orderRow({ metadata: {}, amount_cents: 12_000, currency: "PLN" }));

    await fulfilOneTimeTransaction(
      txn({ currency: "eur", amountSubtotalCents: 12_000, amountDiscountCents: 0 }),
      "sandbox",
    );

    expect(paidPatch()).toMatchObject({
      currency: "EUR",
      metadata: { review: { expected_currency: "PLN", currency: "EUR" } },
    });
  });

  it("różnica jednego grosza (zaokrąglenie operatora) nie flaguje", async () => {
    givenOrder(orderRow({ metadata: {}, amount_cents: 12_000 }));

    await fulfilOneTimeTransaction(
      txn({ amountSubtotalCents: 12_001, amountDiscountCents: 0 }),
      "sandbox",
    );

    expect(paidPatch()).not.toHaveProperty("metadata");
    expect(h.adminBells).toHaveLength(0);
  });

  it("powtórka realizacji z rozjazdem nie alarmuje drugi raz", async () => {
    givenOrder(orderRow({ metadata: {}, amount_cents: 12_000, status: "paid" }));
    paidFlipResponse = ok([]);

    await fulfilOneTimeTransaction(
      txn({ amountSubtotalCents: 7_000, amountDiscountCents: 0 }),
      "sandbox",
    );

    expect(h.adminBells).toHaveLength(0);
  });
});

// --- 10. PAY-14b: zwrot przy pełnej sali w środowisku zdarzenia ---------------

describe("PAY-14b - środowisko zwrotu", () => {
  it("PAY-14b: zwrot przy pełnej sali dla zdarzenia `live` poza produkcją idzie kluczem LIVE", async () => {
    // Domyślne środowisko poza produkcją to piaskownica (atrapa
    // `resolveEnvironment` niżej je udaje). Zlecenie zwrotu transakcji live
    // kluczem piaskownicy kończy się „nie ma takiej płatności" i pętlą ponowień.
    h.seat = "full";
    givenOrder(orderRow({ environment: "live" }));

    expect(await fulfilOneTimeTransaction(txn(), "live")).toBe("oversold_refunded");
    expect(h.refundEnvs).toEqual(["live"]);
  });
});

// --- 10b. S8: kody promocyjne operatora (7.5, 0.5) ------------------------------

describe("S8 - kod promocyjny operatora a najemca i zakres zamówienia", () => {
  const COUPON = "66666666-ffff-4fff-8fff-666666666666";
  const promoTxn = (ids: string[]): OneTimeTransaction =>
    txn({
      amountCents: 0,
      amountSubtotalCents: 12_000,
      amountDiscountCents: 12_000,
      promotionCodeIds: ids,
    });

  it("7.5: kod OBCEGO najemcy -> zamówienie `paid` (pieniądze pobrane), dostęp WSTRZYMANY, alert raz", async () => {
    // Najemca A zsynchronizował FREE100; kupujący najemcy B wpisał go
    // w kasie B (konto Stripe jest wspólne). Dawniej: flaga rozjazdu
    // i mimo to nadanie - kod A otwierał płatne treści B.
    h.promotionCodes["promo_free100"] = {
      metadata: { source: "b2b_coupon_sync", tenant_id: "najemca-a", coupon_id: COUPON },
    };
    givenOrder(orderRow({ metadata: { label: "Wpis premium" } }));

    expect(await fulfilOneTimeTransaction(promoTxn(["promo_free100"]), "sandbox")).toBe("held");

    expect(h.grants).toHaveLength(0);
    expect(h.log).not.toContain("coupon");
    expect(h.subscriptionMails).toHaveLength(0);
    expect(h.eventMails).toHaveLength(0);
    expect(paidPatch()).toMatchObject({
      status: "paid",
      amount_cents: 0,
      metadata: {
        label: "Wpis premium",
        review: {
          reason: "foreign_promotion_code",
          promotion_code_ids: ["promo_free100"],
          expected_cents: 12_000,
          charged_cents: 0,
        },
      },
    });
    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_title_pl: "Płatność wstrzymana do weryfikacji",
        p_href: `/admin/billing?order=${ORDER_ID}&review=foreign_promotion_code`,
      }),
    ]);
    // Treść niesie identyfikator kodu, nie identyfikator cudzego najemcy.
    expect(String(h.adminBells[0]?.["p_body_pl"])).toContain("promo_free100");
    expect(String(h.adminBells[0]?.["p_body_pl"])).not.toContain("najemca-a");
    // Bez kuponu z bazy nie ma czego sprawdzać.
    expect(stub().chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("powtórka wstrzymanego zamówienia (już `paid`) nadal nie nadaje dostępu", async () => {
    // Wstrzymanie zapisało `metadata.review` razem z `paid` - powtórka czyta
    // decyzję z zamówienia, nie pyta operatora o kody drugi raz.
    givenOrder(
      orderRow({
        status: "paid",
        metadata: {
          event_id: EVENT,
          review: {
            reason: "foreign_promotion_code",
            promotion_code_ids: ["promo_free100"],
            flagged_at: "2026-10-01T10:00:00.000Z",
          },
        },
      }),
    );
    paidFlipResponse = ok([]);

    expect(await fulfilOneTimeTransaction(promoTxn(["promo_free100"]), "sandbox")).toBe("held");
    expect(h.grants).toHaveLength(0);
    expect(h.stripeEnvs).toHaveLength(0);
    // Alert dokańcza ten z pierwszej dostawy (raz na incydent - `once`).
    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_href: `/admin/billing?order=${ORDER_ID}&review=foreign_promotion_code`,
        p_title_pl: "Płatność wstrzymana do weryfikacji",
      }),
    ]);
  });

  it("R3: powtórka OPŁACONEGO i nadanego zamówienia nie ocenia kodów od nowa - kupon wyłączony po zakupie nie daje `held`", async () => {
    // Zakup kodem najemcy w zakresie kuponu: nadany, `paid`, bez flagi. Potem
    // administrator wyłącza kupon, a to samo zdarzenie wraca (ponowienie
    // z panelu, zamiatarka, dostawa po awarii procesu). Dawniej: ocena od
    // nowa -> `held`, dzwonek „dostępu nie nadano" przy aktywnym dostępie
    // i urwane efekty kuponu, biletu i maili przerwanej pierwszej dostawy.
    h.promotionCodes["promo_lato"] = { metadata: { tenant_id: TENANT, coupon_id: COUPON } };
    couponResponse = ok({ id: COUPON, active: false, plan_ids: [], event_ids: [] });
    givenOrder(orderRow({ status: "paid", metadata: {} }));
    paidFlipResponse = ok([]);

    expect(
      await fulfilOneTimeTransaction(
        txn({ promotionCodeIds: ["promo_lato"], amountSubtotalCents: 12_000 }),
        "sandbox",
      ),
    ).toBe("order");

    expect(h.stripeEnvs).toHaveLength(0);
    expect(stub().chainsFor("b2b_coupons")).toHaveLength(0);
    expect(h.adminBells).toHaveLength(0);
    // Skutki idempotentne dokończone: uprawnienie i efekty kuponu.
    expect(h.grants).toHaveLength(1);
    expect(h.log).toContain("coupon");
  });

  it("powtórka zamówienia z flagą rozjazdu dokańcza jej alert (raz na incydent), bez nowej oceny", async () => {
    givenOrder(
      orderRow({
        status: "paid",
        metadata: {
          review: {
            reason: "amount_mismatch",
            expected_cents: 12_000,
            expected_currency: "PLN",
            charged_cents: 7_000,
            currency: "PLN",
            flagged_at: "2026-10-01T10:00:00.000Z",
          },
        },
      }),
    );
    paidFlipResponse = ok([]);

    expect(await fulfilOneTimeTransaction(txn({ amountCents: 7_000 }), "sandbox")).toBe("order");

    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_href: `/admin/billing?order=${ORDER_ID}&review=amount_mismatch`,
      }),
    ]);
    expect(h.grants).toHaveLength(1);
  });

  it("kod operatora BEZ najemcy (zrobiony ręcznie w panelu Stripe): nadanie + ślad w metadanych", async () => {
    h.promotionCodes["promo_operator"] = { metadata: {} };
    givenOrder(orderRow({ metadata: {} }));

    expect(
      await fulfilOneTimeTransaction(
        txn({ promotionCodeIds: ["promo_operator"], amountSubtotalCents: 12_000 }),
        "sandbox",
      ),
    ).toBe("order");

    expect(h.grants).toHaveLength(1);
    const patch = paidPatch() ?? {};
    expect(patch).toMatchObject({ metadata: { promotion_code_unscoped: ["promo_operator"] } });
    expect((patch["metadata"] as Record<string, unknown>)["review"]).toBeUndefined();
    expect(h.adminBells).toHaveLength(0);
  });

  it("0.5: kod najemcy, ale kupon planowy NIE obejmuje planu zamówienia -> wstrzymanie `out_of_scope`", async () => {
    // MIESIAC50 zawężony w bazie do planu miesięcznego; Stripe przepuszcza go
    // w kasie planu rocznego, bo oba interwały dzielą produkt.
    h.promotionCodes["promo_miesiac50"] = {
      metadata: { source: "b2b_coupon_sync", tenant_id: TENANT, coupon_id: COUPON },
    };
    couponResponse = ok({ id: COUPON, active: true, plan_ids: ["plan_monthly"], event_ids: [] });
    givenOrder(orderRow({ kind: "one_time", plan_id: "plan_annual", metadata: {} }));

    expect(await fulfilOneTimeTransaction(promoTxn(["promo_miesiac50"]), "sandbox")).toBe("held");

    expect(h.grants).toHaveLength(0);
    expect(paidPatch()).toMatchObject({
      metadata: { review: { reason: "promotion_code_out_of_scope" } },
    });
    // Kupon czytany W NAJEMCY ZAMÓWIENIA (R-TS), nie po samym identyfikatorze.
    const lookup = stub().lastChain("b2b_coupons");
    expect(lookup?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", COUPON],
      ["tenant_id", TENANT],
    ]);
    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_href: `/admin/billing?order=${ORDER_ID}&review=promotion_code_out_of_scope`,
      }),
    ]);
  });

  it.each([
    ["kupon usunięty z bazy", ok(null)],
    ["kupon wyłączony w panelu", ok({ id: COUPON, active: false, plan_ids: [], event_ids: [] })],
  ])("0.5: %s, a kopia w Stripe wciąż działa -> wstrzymanie", async (_label, coupon) => {
    h.promotionCodes["promo_lato"] = { metadata: { tenant_id: TENANT, coupon_id: COUPON } };
    couponResponse = coupon;
    givenOrder(orderRow({ metadata: {} }));

    expect(await fulfilOneTimeTransaction(promoTxn(["promo_lato"]), "sandbox")).toBe("held");
  });

  it("kod najemcy w zakresie kuponu (plan na liście): zwykłe nadanie", async () => {
    h.promotionCodes["promo_roczny"] = { metadata: { tenant_id: TENANT, coupon_id: COUPON } };
    couponResponse = ok({ id: COUPON, active: true, plan_ids: ["plan_annual"], event_ids: [] });
    givenOrder(orderRow({ kind: "one_time", plan_id: "plan_annual", metadata: {} }));

    expect(
      await fulfilOneTimeTransaction(
        txn({ promotionCodeIds: ["promo_roczny"], amountSubtotalCents: 12_000 }),
        "sandbox",
      ),
    ).toBe("order");
    expect(h.grants).toHaveLength(1);
  });

  it("kupon wydarzenia obejmuje wyłącznie swoje wydarzenia", async () => {
    h.promotionCodes["promo_gala"] = { metadata: { tenant_id: TENANT, coupon_id: COUPON } };
    couponResponse = ok({ id: COUPON, active: true, plan_ids: [], event_ids: ["inne-wydarzenie"] });

    expect(await fulfilOneTimeTransaction(promoTxn(["promo_gala"]), "sandbox")).toBe("held");
  });

  it("awaria odczytu kodu u operatora RZUCA przed nadaniem i zapisem - webhook wróci", async () => {
    h.promotionCodes["promo_x"] = new Error("connection reset");

    await expect(fulfilOneTimeTransaction(promoTxn(["promo_x"]), "sandbox")).rejects.toThrow(
      "promotion code scope: lookup failed (promo_x): connection reset",
    );
    expect(h.grants).toHaveLength(0);
    expect(paidPatch()).toBeUndefined();
  });

  it("awaria odczytu kuponu z bazy RZUCA", async () => {
    h.promotionCodes["promo_lato"] = { metadata: { tenant_id: TENANT, coupon_id: COUPON } };
    couponResponse = fail("statement timeout");

    await expect(fulfilOneTimeTransaction(promoTxn(["promo_lato"]), "sandbox")).rejects.toThrow(
      `promotion code scope: coupon lookup failed (${COUPON}): statement timeout`,
    );
    expect(h.grants).toHaveLength(0);
  });

  it("sesja bez kodów (nasz kupon jedzie bez kodu) nie pyta operatora", async () => {
    await fulfilOneTimeTransaction(txn({ promotionCodeIds: [] }), "sandbox");

    expect(h.stripeEnvs).toHaveLength(0);
    expect(h.grants).toHaveLength(1);
  });
});

// --- 11. PAY-09: cykl życia zamówienia poza „opłacone" -------------------------

describe("PAY-09 - wygaśnięcie sesji Checkout", () => {
  const expired = (over: Partial<OneTimeTransaction> = {}): OneTimeTransaction =>
    txn({ id: "cs_wygasla", sessionId: "cs_wygasla", amountCents: null, ...over });

  it("PAY-09: sesja wygasła -> kupon zwolniony, zamówienie canceled", async () => {
    givenOrder(
      orderRow({
        metadata: { coupon_id: "kupon-1", coupon_code: "LATO" },
        status: "processing",
        provider_session_id: "cs_wygasla",
      }),
    );

    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(true);

    expect(paidPatch()).toMatchObject({ status: "canceled" });
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update"));
    expect(flip?.argsOf("in")).toEqual(["status", ["pending", "processing"]]);
    // Najemca, konto i zamówienie z NASZEGO wiersza - nigdy z ładunku.
    expect(h.couponReleases).toEqual([
      { _tenant_id: TENANT, _user_id: USER, _coupon_id: "kupon-1", _order_id: ORDER_ID },
    ]);
    // Zwolnienie PO zamknięciu: baza oddaje użycie tylko nieopłaconemu zamówieniu.
    expect(h.log.indexOf("coupon:release")).toBeGreaterThan(
      h.log.lastIndexOf("from:payment_orders"),
    );
    expect(h.grants).toHaveLength(0);
  });

  it("bilet: wygaśnięcie oddaje bilet z puli (`unpaid`) BEZ maila „płatność odrzucona”", async () => {
    givenOrder(orderRow({ status: "pending" }));

    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(true);
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["unpaid"]);
    expect(h.notifyPayloads).toHaveLength(0);
    expect(h.couponReleases).toHaveLength(0);
  });

  it("powtórka po awarii zwolnienia dokańcza zwolnienie na zamówieniu już zamkniętym", async () => {
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, status: "canceled" }));
    paidFlipResponse = ok([]);

    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(true);
    expect(h.couponReleases).toHaveLength(1);
    // Zamówienie bez wydarzenia nie ma wyniku biletu do zapisania.
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("4.6: błąd zapisu wyniku biletu przy wygaśnięciu RZUCA - miejsce z puli planu nie przepada", async () => {
    // `payments_apply_event_ticket_outcome` oddaje bilet z puli planu
    // (`_event_plan_seat_settle`). Połknięty błąd kończył zdarzenie jako
    // `processed` - operator nie ponawiał, a członek tracił wejściówkę.
    givenOrder(
      orderRow({ metadata: { event_id: EVENT, coupon_id: "kupon-1" }, status: "pending" }),
    );
    h.rpcReplies.push(rpcError("57014", "canceling statement due to statement timeout"));

    await expect(expireCheckoutOrder(expired(), "sandbox")).rejects.toThrow(
      `ticket outcome failed (${ORDER_ID}, unpaid): canceling statement due to statement timeout`,
    );
  });

  it("4.6: ponowienie na zamówieniu JUŻ zamkniętym dokańcza wynik biletu (idempotentny w bazie)", async () => {
    // Pierwsza dostawa zamknęła status i padła na zapisie biletu. Dawniej
    // ponowienie widziało `canceled`, uznawało, że nie ono zamknęło - i biletu
    // nie oddawało już nigdy.
    givenOrder(orderRow({ metadata: { event_id: EVENT }, status: "canceled" }));
    paidFlipResponse = ok([]);

    await expireCheckoutOrder(expired(), "sandbox");

    expect(h.rpcCalls.map((c) => c.args)).toEqual([
      { p_order_id: ORDER_ID, p_outcome: "unpaid", p_refunded_cents: undefined },
    ]);
    // Porzucona kasa to nie odrzucona płatność - bez maila do uczestnika.
    expect(h.notifyPayloads).toHaveLength(0);
  });

  it("kasa zamknęła zamówienie (`canceled`) MIĘDZY naszym odczytem a zamknięciem - kupon i tak wraca", async () => {
    // Zastąpione zamówienie kasa oznacza `canceled` bez zwalniania kuponu
    // i zostawia to temu webhookowi. Odczyt widział jeszcze `processing`,
    // warunkowe zamknięcie nie trafiło - stary status pomijał zwolnienie, a
    // zdarzenie kończyło się bez ponowienia.
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, status: "processing" }));
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "canceled" });

    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(true);
    expect(h.couponReleases).toEqual([
      { _tenant_id: TENANT, _user_id: USER, _coupon_id: "kupon-1", _order_id: ORDER_ID },
    ]);
  });

  it("zamknięcie nie trafiło, bo zamówienie w międzyczasie OPŁACONO - kupon zostaje", async () => {
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, status: "processing" }));
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "paid" });

    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(false);
    expect(h.couponReleases).toHaveLength(0);
  });

  it("zamówienie OPŁACONE nie jest zamykane ani pozbawiane kuponu; wynik `false`", async () => {
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, status: "paid" }));
    paidFlipResponse = ok([]);

    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(false);
    expect(h.couponReleases).toHaveLength(0);
  });

  it("wygasła sesja INNA niż zapisana na zamówieniu nie zamyka zamówienia", async () => {
    givenOrder(orderRow({ status: "processing", provider_session_id: "cs_nowsza" }));

    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(false);
    expect(paidPatch()).toBeUndefined();
  });

  it("zdarzenie z innego środowiska i nieznane zamówienie nic nie zmieniają", async () => {
    givenOrder(orderRow({ status: "processing", environment: "live" }));
    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(false);

    givenOrder(null);
    expect(await expireCheckoutOrder(expired(), "sandbox")).toBe(false);
    expect(await expireCheckoutOrder(expired({ customData: null }), "sandbox")).toBe(false);
    expect(paidPatch()).toBeUndefined();
  });

  it("odmowa bazy przy zwolnieniu kuponu RZUCA - webhook wróci i dokończy", async () => {
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, status: "processing" }));
    h.couponReleaseReply = { data: null, error: { message: "permission denied" } };

    await expect(expireCheckoutOrder(expired(), "sandbox")).rejects.toThrow(
      `expire: coupon release failed (${ORDER_ID}): permission denied`,
    );
  });

  it("nieudane zamknięcie statusu RZUCA przed zwolnieniem kuponu", async () => {
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, status: "processing" }));
    paidFlipResponse = fail("zapis odrzucony");

    await expect(expireCheckoutOrder(expired(), "sandbox")).rejects.toThrow(
      "expire: order status flip failed: zapis odrzucony",
    );
    expect(h.couponReleases).toHaveLength(0);
  });
});

describe("PAY-09 - odrzucona płatność asynchroniczna", () => {
  it("PAY-09: zamówienie -> failed, kupon zwolniony, zgłoszenie nieopłacone (z mailem)", async () => {
    givenOrder(
      orderRow({ metadata: { event_id: EVENT, coupon_id: "kupon-1" }, status: "processing" }),
    );

    await markOneTimePaymentFailed({ orderId: ORDER_ID }, "sandbox");

    expect(paidPatch()).toMatchObject({ status: "failed" });
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["unpaid"]);
    expect(h.couponReleases).toEqual([expect.objectContaining({ _coupon_id: "kupon-1" })]);
    // To JEST odrzucona płatność - uczestnik dostaje powiadomienie.
    expect(h.notifyPayloads).toHaveLength(1);
  });

  it("status zamknięty przez kogoś innego po naszym odczycie: zwolnienie z BIEŻĄCEGO statusu", async () => {
    givenOrder(orderRow({ metadata: { coupon_id: "kupon-1" }, status: "pending" }));
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "failed" });

    await markOneTimePaymentFailed({ orderId: ORDER_ID }, "sandbox");

    expect(h.couponReleases).toEqual([expect.objectContaining({ _coupon_id: "kupon-1" })]);
    const reread = stub()
      .chainsFor("payment_orders")
      .find((c) => c.argsOf("select")?.[0] === "status");
    expect(reread?.argsOf("eq")).toEqual(["id", ORDER_ID]);
  });

  it("zdarzenie z innego środowiska nie zamyka zamówienia i nie rusza zgłoszenia", async () => {
    givenOrder(orderRow({ status: "processing", environment: "live" }));

    await markOneTimePaymentFailed({ orderId: ORDER_ID }, "sandbox");

    expect(paidPatch()).toBeUndefined();
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("zamówienie nieznane bazie: zostaje sam wynik biletu (jak przed PAY-09)", async () => {
    givenOrder(null);

    await markOneTimePaymentFailed({ orderId: ORDER_ID }, "sandbox");

    expect(paidPatch()).toBeUndefined();
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["unpaid"]);
  });

  it("S6 / 4.8 / 5.8 / 7.11: sesja SUBSKRYPCJI z odrzuconą płatnością -> zamówienie `failed`, kupon wraca", async () => {
    // SEPA w trybie `subscription`: sesja się ukończyła (nie wygaśnie), a
    // subskrypcja u operatora nigdy nie wystartuje. Bez zamknięcia zamówienie
    // wisiało jako `processing`, a limitowany kod trzymał użycie na zawsze.
    givenOrder(
      orderRow({
        kind: "subscription",
        plan_id: "plan_pro",
        metadata: { coupon_id: "kupon-1" },
        status: "processing",
      }),
    );

    await markOneTimePaymentFailed({ orderId: ORDER_ID }, "sandbox");

    expect(paidPatch()).toMatchObject({ status: "failed" });
    expect(
      stub()
        .chainsFor("payment_orders")
        .find((c) => c.has("update"))
        ?.argsOf("in"),
    ).toEqual(["status", ["pending", "processing"]]);
    expect(h.couponReleases).toEqual([
      { _tenant_id: TENANT, _user_id: USER, _coupon_id: "kupon-1", _order_id: ORDER_ID },
    ]);
    // Zamówienie planu nie ma zgłoszenia - wyniku biletu nie wołamy wcale.
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("porażka dla zamówienia JUŻ opłaconego (inną sesją) nie oddaje miejsca ani kuponu", async () => {
    givenOrder(orderRow({ metadata: { event_id: EVENT, coupon_id: "kupon-1" }, status: "paid" }));
    paidFlipResponse = ok([]);

    await markOneTimePaymentFailed({ orderId: ORDER_ID }, "sandbox");

    expect(h.rpcCalls).toHaveLength(0);
    expect(h.couponReleases).toHaveLength(0);
  });

  it("4.6: błąd zapisu wyniku biletu po odrzuconej płatności RZUCA, zanim kupon wróci", async () => {
    givenOrder(
      orderRow({ metadata: { event_id: EVENT, coupon_id: "kupon-1" }, status: "processing" }),
    );
    h.rpcReplies.push(rpcError("57014", "statement timeout"));

    await expect(markOneTimePaymentFailed({ orderId: ORDER_ID }, "sandbox")).rejects.toThrow(
      `ticket outcome failed (${ORDER_ID}, unpaid): statement timeout`,
    );
    expect(h.couponReleases).toHaveLength(0);
  });
});

describe("PAY-09 - domknięcie zamówienia pierwszej sesji subskrypcji", () => {
  const subscriptionOrder = (over: Partial<OrderRow> = {}): OrderRow =>
    orderRow({
      kind: "subscription",
      plan_id: "plan_pro",
      metadata: { coupon_id: "kupon-1" },
      amount_cents: 4_900,
      status: "processing",
      ...over,
    });
  const session = (over: Partial<OneTimeTransaction> = {}): OneTimeTransaction =>
    txn({
      id: "cs_sub",
      sessionId: "cs_sub",
      subscriptionId: "sub_nowa",
      customerId: "cus_1",
      amountCents: 4_900,
      amountSubtotalCents: 4_900,
      amountDiscountCents: 0,
      amountTaxCents: 0,
      ...over,
    });

  it("PAY-09: sesja subskrypcji -> zamówienie `paid` z identyfikatorami, efekty kuponu, BEZ uprawnienia", async () => {
    givenOrder(subscriptionOrder());

    expect(await settleSubscriptionCheckoutOrder(session(), "sandbox")).toBe("settled");

    expect(paidPatch()).toMatchObject({
      status: "paid",
      paid_at: expect.any(String),
      provider: "stripe",
      provider_intent_id: "cs_sub",
      provider_session_id: "cs_sub",
      provider_subscription_id: "sub_nowa",
      provider_customer_id: "cus_1",
      receipt_email: "kupujacy@example.com",
      amount_cents: 4_900,
    });
    expect(
      stub()
        .chainsFor("payment_orders")
        .find((c) => c.has("update"))
        ?.argsOf("in"),
    ).toEqual(["status", ["pending", "processing", "failed"]]);
    // Uprawnienie nadaje WYŁĄCZNIE ścieżka `subscription.*` (klucz `sub_...`).
    expect(h.grants).toHaveLength(0);
    expect(stub().chainsFor("user_subscriptions")).toHaveLength(0);
    expect(h.log).toContain("coupon");
    expect(h.subscriptionMails).toHaveLength(0);
  });

  it("S4 / 4.0 / 4.1 / 5.3: trial (sesja bez pobrania) tylko stempluje identyfikatory - bez `paid`, bez kuponu", async () => {
    // Trial 14 dni z kuponem PARTNER (warstwa premium). Sesja kończy się
    // `no_payment_required`, operator nie pobrał nic. Dawniej zamówienie
    // stawało się `paid` w cenie planu (pulpit liczył to jako przychód),
    // a `apply_b2b_coupon_effects` nadawało warstwę, której nic nie odbiera
    // przy anulowaniu w trakcie trialu.
    givenOrder(subscriptionOrder());

    expect(
      await settleSubscriptionCheckoutOrder(
        session({ amountCents: 0, amountSubtotalCents: 0, amountDiscountCents: 0 }),
        "sandbox",
      ),
    ).toBe("stamped");

    const patch = paidPatch() ?? {};
    expect(patch).toMatchObject({
      provider: "stripe",
      provider_session_id: "cs_sub",
      provider_subscription_id: "sub_nowa",
      provider_customer_id: "cus_1",
    });
    for (const column of [
      "status",
      "paid_at",
      "amount_cents",
      "provider_intent_id",
      "provider_payment_intent_id",
      "metadata",
    ]) {
      expect(patch).not.toHaveProperty(column);
    }
    expect(
      stub()
        .chainsFor("payment_orders")
        .find((c) => c.has("update"))
        ?.argsOf("in"),
    ).toEqual(["status", ["pending", "processing", "failed"]]);
    expect(h.log).not.toContain("coupon");
    expect(h.adminBells).toHaveLength(0);
  });

  it("S4: pierwsza OPŁACONA faktura po trialu domyka zamówienie - `paid_at` operatora, brutto, bez nadpisania sesji", async () => {
    // Po 14 dniach Stripe pobiera 49 zł + 11,27 zł VAT fakturą `in_...`.
    // Faktura nie niesie rozbicia kwoty - porównania nie ma, a sesja zapisana
    // na zamówieniu zostaje (identyfikator faktury to nie sesja). Sesja trialu
    // ostemplowała zamówienie subskrypcją dni wcześniej.
    givenOrder(
      subscriptionOrder({ provider_session_id: "cs_sub", provider_subscription_id: "sub_nowa" }),
    );

    expect(
      await settleSubscriptionCheckoutOrder(
        txn({
          id: "in_po_trialu",
          sessionId: "in_po_trialu",
          source: "invoice",
          paidAt: "2026-10-01T08:30:00.000Z",
          subscriptionId: "sub_nowa",
          customerId: "cus_1",
          amountCents: 6_027,
          currency: "pln",
          customData: { orderId: ORDER_ID },
        }),
        "sandbox",
      ),
    ).toBe("settled");

    const patch = paidPatch() ?? {};
    expect(patch).toMatchObject({
      status: "paid",
      paid_at: "2026-10-01T08:30:00.000Z",
      provider_intent_id: "in_po_trialu",
      provider_subscription_id: "sub_nowa",
      amount_cents: 6_027,
      currency: "PLN",
    });
    expect(patch).not.toHaveProperty("provider_session_id");
    expect(patch).not.toHaveProperty("metadata");
    expect(h.adminBells).toHaveLength(0);
    // Efekty kuponu - dopiero przy tym przejściu, za prawdziwe pieniądze.
    expect(h.log).toContain("coupon");
  });

  it("S4: odnowienie (inna faktura) na zamówieniu już opłaconym nic nie zmienia i nie powtarza kuponu", async () => {
    givenOrder(
      subscriptionOrder({
        status: "paid",
        provider_intent_id: "cs_sub",
        provider_subscription_id: "sub_nowa",
      }),
    );
    paidFlipResponse = ok([]);

    expect(
      await settleSubscriptionCheckoutOrder(
        session({ id: "in_odnowienie", sessionId: "in_odnowienie", source: "invoice" }),
        "sandbox",
      ),
    ).toBe("skipped");
    expect(h.log).not.toContain("coupon");
  });

  it("S4: powtórka TEGO SAMEGO zdarzenia, które opłaciło zamówienie, dokańcza efekty kuponu", async () => {
    givenOrder(subscriptionOrder({ status: "paid", provider_intent_id: "cs_sub" }));
    paidFlipResponse = ok([]);

    expect(await settleSubscriptionCheckoutOrder(session(), "sandbox")).toBe("skipped");
    expect(h.log).toContain("coupon");
    expect(h.adminBells).toHaveLength(0);
  });

  it("S5: sesja z podatkiem doliczonym na wierzch - księgi brutto, porównanie netto bez flagi", async () => {
    givenOrder(subscriptionOrder());

    await settleSubscriptionCheckoutOrder(
      session({ amountCents: 6_027, amountSubtotalCents: 4_900, amountTaxCents: 1_127 }),
      "sandbox",
    );

    const patch = paidPatch() ?? {};
    expect(patch).toMatchObject({ status: "paid", amount_cents: 6_027 });
    expect(patch).not.toHaveProperty("metadata");
  });

  it("rozjazd kwoty pierwszej faktury -> flaga do weryfikacji i alert z adresem incydentu", async () => {
    givenOrder(subscriptionOrder());

    await settleSubscriptionCheckoutOrder(
      session({ amountCents: 3_900, amountSubtotalCents: 4_900, amountDiscountCents: 1_000 }),
      "sandbox",
    );

    expect(paidPatch()).toMatchObject({
      status: "paid",
      amount_cents: 3_900,
      metadata: {
        coupon_id: "kupon-1",
        review: { reason: "amount_mismatch", charged_cents: 3_900, expected_cents: 4_900 },
      },
    });
    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_href: `/admin/billing?order=${ORDER_ID}&review=amount_mismatch`,
      }),
    ]);
  });

  it("rabat 100% spoza bazy (sesja bez pobrania, `subtotal` > 0): flaga i alert, ale bez `paid`", async () => {
    givenOrder(subscriptionOrder());

    expect(
      await settleSubscriptionCheckoutOrder(
        session({ amountCents: 0, amountSubtotalCents: 4_900, amountDiscountCents: 4_900 }),
        "sandbox",
      ),
    ).toBe("stamped");

    const patch = paidPatch() ?? {};
    expect(patch).not.toHaveProperty("status");
    expect(patch).toMatchObject({
      metadata: { review: { reason: "amount_mismatch", charged_cents: 0 } },
    });
    expect(h.adminBells).toHaveLength(1);
    expect(h.log).not.toContain("coupon");
  });

  it("ładunek sprzed wdrożenia bez `source`: `cs_...` to sesja, `in_...` to faktura (S6)", async () => {
    givenOrder(subscriptionOrder());
    await settleSubscriptionCheckoutOrder(session({ source: undefined }), "sandbox");
    expect(paidPatch()).toMatchObject({ provider_session_id: "cs_sub" });

    stub().reset();
    stub().setResponse("payment_orders", (chain) =>
      chain.has("update") ? paidFlipResponse : orderResponse,
    );
    givenOrder(subscriptionOrder({ provider_subscription_id: "sub_nowa" }));
    await settleSubscriptionCheckoutOrder(
      session({ id: "in_stary", sessionId: "in_stary", source: undefined }),
      "sandbox",
    );
    expect(paidPatch()).toMatchObject({ provider_intent_id: "in_stary" });
    expect(paidPatch()).not.toHaveProperty("provider_session_id");
  });

  it("nieczytelny `paidAt` spada na chwilę obecną", async () => {
    givenOrder(subscriptionOrder());
    const before = Date.now();

    await settleSubscriptionCheckoutOrder(session({ paidAt: "nie-data" }), "sandbox");

    expect(Date.parse(String(paidPatch()?.["paid_at"]))).toBeGreaterThanOrEqual(before);
  });

  it("S8: kod promocyjny OBCEGO najemcy w sesji subskrypcji -> flaga i alert, bez wstrzymania", async () => {
    h.promotionCodes["promo_obcy"] = {
      metadata: { source: "b2b_coupon_sync", tenant_id: "inny-najemca", coupon_id: "x" },
    };
    givenOrder(subscriptionOrder());

    expect(
      await settleSubscriptionCheckoutOrder(
        session({ promotionCodeIds: ["promo_obcy"], amountCents: 2_450 }),
        "sandbox",
      ),
    ).toBe("settled");

    expect(paidPatch()).toMatchObject({
      status: "paid",
      metadata: {
        review: { reason: "foreign_promotion_code", promotion_code_ids: ["promo_obcy"] },
      },
    });
    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_href: `/admin/billing?order=${ORDER_ID}&review=foreign_promotion_code`,
        p_title_pl: "Płatność do weryfikacji",
      }),
    ]);
    // Dostęp daje `subscription.*`; zamówienie jest opłacone, kupon działa.
    expect(h.log).toContain("coupon");
    expect(h.stripeEnvs).toEqual(["sandbox"]);
  });

  it("R2: odnowienie subskrypcji sprzed wdrożenia (zamówienie bez stempla sesji) NIE opłaca zamówienia", async () => {
    // Zamówienie z czerwca: kasa sprzed domknięcia zostawiła je w
    // `processing` bez identyfikatora subskrypcji (kupon LATO, 24,50 zł).
    // Metadane subskrypcji niosą `orderId`, więc pierwsze odnowienie po
    // wdrożeniu trafiało tutaj. Dawniej: `paid` z kwotą i datą odnowienia
    // i efekty kuponu odpalone cztery miesiące po zakupie.
    givenOrder(
      subscriptionOrder({
        amount_cents: 2_450,
        metadata: { coupon_id: "kupon-lato", coupon_code: "LATO" },
        provider_subscription_id: null,
      }),
    );

    expect(
      await settleSubscriptionCheckoutOrder(
        txn({
          id: "in_odnowienie_pazdziernik",
          source: "invoice",
          subscriptionId: "sub_nowa",
          amountCents: 4_900,
          paidAt: "2026-10-08T06:00:00.000Z",
          customData: { orderId: ORDER_ID },
        }),
        "sandbox",
      ),
    ).toBe("skipped");

    expect(
      stub()
        .chainsFor("payment_orders")
        .filter((c) => c.has("update")),
    ).toHaveLength(0);
    expect(h.log).not.toContain("coupon");
  });

  it("R1: faktura PRZED sesją nie domyka zamówienia - przegląd kwoty robi sesja, niezależnie od kolejności", async () => {
    // Stripe wysyła `invoice.paid` i `checkout.session.completed` równolegle.
    // Cena w katalogu podmieniona: zamówienie 49 zł, pobrano 99 zł. Dawniej
    // faktura domykała zamówienie (nadpisując kwotę oczekiwaną kwotą
    // pobraną), a sesja nie miała już z czym porównać - bez flagi i alertu.
    givenOrder(subscriptionOrder({ provider_subscription_id: null }));

    expect(
      await settleSubscriptionCheckoutOrder(
        txn({
          id: "in_pierwsza",
          source: "invoice",
          subscriptionId: "sub_nowa",
          amountCents: 9_900,
          customData: { orderId: ORDER_ID },
        }),
        "sandbox",
      ),
    ).toBe("skipped");
    expect(paidPatch()).toBeUndefined();

    expect(
      await settleSubscriptionCheckoutOrder(
        session({ amountCents: 9_900, amountSubtotalCents: 9_900 }),
        "sandbox",
      ),
    ).toBe("settled");
    expect(paidPatch()).toMatchObject({
      status: "paid",
      amount_cents: 9_900,
      provider_intent_id: "cs_sub",
      metadata: {
        review: { reason: "amount_mismatch", expected_cents: 4_900, charged_cents: 9_900 },
      },
    });
    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_href: `/admin/billing?order=${ORDER_ID}&review=amount_mismatch`,
      }),
    ]);
  });

  it("R3: powtórka sesji na zamówieniu opłaconym nie ocenia kodów od nowa - dokańcza alert zapisanej flagi", async () => {
    // Pierwsza dostawa oznaczyła obcy kod i zapisała flagę razem z `paid`.
    // Powtórka nie pyta operatora o kody (wynik zależałby od chwili
    // powtórki), tylko dokańcza alert (raz na incydent) i efekty kuponu.
    h.promotionCodes["promo_obcy"] = { metadata: { tenant_id: "inny-najemca" } };
    givenOrder(
      subscriptionOrder({
        status: "paid",
        provider_intent_id: "cs_sub",
        provider_subscription_id: "sub_nowa",
        metadata: {
          coupon_id: "kupon-1",
          review: {
            reason: "foreign_promotion_code",
            promotion_code_ids: ["promo_obcy"],
            flagged_at: "2026-10-01T10:00:00.000Z",
          },
        },
      }),
    );
    paidFlipResponse = ok([]);

    expect(
      await settleSubscriptionCheckoutOrder(
        session({ promotionCodeIds: ["promo_obcy"] }),
        "sandbox",
      ),
    ).toBe("skipped");

    expect(h.stripeEnvs).toHaveLength(0);
    expect(
      stub()
        .chainsFor("payment_orders")
        .filter((c) => c.has("update") && !c.has("in")),
    ).toHaveLength(0);
    expect(h.adminBells).toEqual([
      expect.objectContaining({
        p_href: `/admin/billing?order=${ORDER_ID}&review=foreign_promotion_code`,
      }),
    ]);
    expect(h.log).toContain("coupon");
  });

  it("R4: zwrot częściowy przed domknięciem przechodzi na podstawę pobraną razem z kwotą", async () => {
    // Zamówienie 49 zł netto, operator pobrał 60,27 zł (VAT na wierzch);
    // zwrot 12,30 zł zapisany wcześniej w podstawie zamówienia jako 10 zł.
    givenOrder(subscriptionOrder({ refunded_amount_cents: 1_000 }));

    expect(
      await settleSubscriptionCheckoutOrder(
        session({ amountCents: 6_027, amountSubtotalCents: 4_900, amountTaxCents: 1_127 }),
        "sandbox",
      ),
    ).toBe("settled");

    expect(paidPatch()).toMatchObject({ amount_cents: 6_027, refunded_amount_cents: 1_230 });
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && c.has("in"));
    expect(flip?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "refunded_amount_cents",
      1_000,
    ]);
  });

  it("R4: licznik zmieniony w trakcie domknięcia (zamówienie wciąż w toku) RZUCA - zdarzenie wróci", async () => {
    givenOrder(subscriptionOrder({ refunded_amount_cents: 1_000 }));
    paidFlipResponse = ok([]);
    stateResponse = ok({ status: "processing" });

    await expect(
      settleSubscriptionCheckoutOrder(
        session({ amountCents: 6_027, amountSubtotalCents: 4_900, amountTaxCents: 1_127 }),
        "sandbox",
      ),
    ).rejects.toThrow(`subscription settle: refund counter changed while settling (${ORDER_ID})`);
    expect(h.log).not.toContain("coupon");
  });

  it("sesja z podatkiem PO fakturze bez kodów: bez zapisu i bez fałszywego rozjazdu", async () => {
    givenOrder(
      subscriptionOrder({ status: "paid", provider_intent_id: "in_pierwsza", amount_cents: 6_027 }),
    );
    paidFlipResponse = ok([]);

    await settleSubscriptionCheckoutOrder(
      session({ amountCents: 6_027, amountSubtotalCents: 4_900, amountTaxCents: 1_127 }),
      "sandbox",
    );

    expect(
      stub()
        .chainsFor("payment_orders")
        .filter((c) => c.has("update") && !c.has("in")),
    ).toHaveLength(0);
    expect(h.adminBells).toHaveLength(0);
  });

  it.each([
    ["zwrócone", { status: "refunded" }],
    ["anulowane", { status: "canceled" }],
    ["zwrócone w całości (licznik = kwota)", { refunded_amount_cents: 4_900 }],
    ["jednorazowe (idzie przez fulfilOrder)", { kind: "one_time" }],
    ["z innego środowiska", { environment: "live" }],
    ["domknięte inną subskrypcją", { provider_subscription_id: "sub_inna" }],
  ])("zamówienie %s nie jest domykane", async (_label, over) => {
    givenOrder(subscriptionOrder(over));

    expect(await settleSubscriptionCheckoutOrder(session(), "sandbox")).toBe("skipped");
    expect(paidPatch()).toBeUndefined();
    expect(h.log).not.toContain("coupon");
  });

  it("zwrot CZĘŚCIOWY przed domknięciem nie blokuje księgowania (2.8 / 5.9)", async () => {
    givenOrder(subscriptionOrder({ refunded_amount_cents: 100 }));

    expect(await settleSubscriptionCheckoutOrder(session(), "sandbox")).toBe("settled");
  });

  it("sesja bez `orderId` (spoza naszej kasy) nie dotyka bazy", async () => {
    expect(await settleSubscriptionCheckoutOrder(session({ customData: {} }), "sandbox")).toBe(
      "skipped",
    );
    expect(stub().chains).toHaveLength(0);
  });

  it("odmowa zapisu RZUCA - webhook wróci", async () => {
    givenOrder(subscriptionOrder());
    paidFlipResponse = fail("zapis odrzucony");

    await expect(settleSubscriptionCheckoutOrder(session(), "sandbox")).rejects.toThrow(
      "subscription settle: order paid flip failed: zapis odrzucony",
    );
  });

  it("odmowa zapisu identyfikatorów trialu RZUCA", async () => {
    givenOrder(subscriptionOrder());
    paidFlipResponse = fail("zapis odrzucony");

    await expect(
      settleSubscriptionCheckoutOrder(
        session({ amountCents: 0, amountSubtotalCents: 0 }),
        "sandbox",
      ),
    ).rejects.toThrow("subscription settle: provider ids stamp failed: zapis odrzucony");
  });
});

// --- 12. bilet za zero (kod 100%, TIX-13a) ------------------------------------

describe("settleFreeTicketOrder - bilet za zero bez operatora", () => {
  const COUPON = "66666666-ffff-4fff-8fff-666666666666";

  function freeOrder(over: Partial<OrderRow> = {}): OrderRow {
    return orderRow({
      amount_cents: 0,
      status: "pending",
      provider: "coupon",
      metadata: { event_id: EVENT, coupon_id: COUPON },
      ...over,
    });
  }

  it("rozlicza zamówienie tą samą ścieżką co wpłata: uprawnienie, księga, baza, miejsce", async () => {
    givenOrder(freeOrder());

    expect(await settleFreeTicketOrder(ORDER_ID)).toEqual({ outcome: "order", seated: true });
    expect(paidPatch()).toMatchObject({
      status: "paid",
      provider: "coupon",
      provider_intent_id: `free_${ORDER_ID}`,
      amount_cents: 0,
    });
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["paid"]);
    expect(h.claimCalls).toEqual([{ p_order_id: ORDER_ID }]);
    expect(h.eventMails).toHaveLength(1);
    expect(h.log).not.toContain("refund");
  });

  it("pełna sala: zamówienie anulowane i kod zwolniony - bez zwrotu u operatora", async () => {
    givenOrder(freeOrder());
    h.seat = "full";

    expect(await settleFreeTicketOrder(ORDER_ID)).toEqual({
      outcome: "oversold_refunded",
      seated: false,
    });
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && !c.has("in"));
    expect(flip?.argsOf("update")?.[0]).toMatchObject({ status: "canceled" });
    expect(h.log).not.toContain("refund");
    expect(h.eventMails).toHaveLength(0);
    // Zwolnienie PO anulowaniu (baza oddaje użycie tylko nieopłaconemu
    // zamówieniu), z najemcą i kontem z NASZEGO wiersza.
    expect(h.couponReleases).toEqual([
      { _tenant_id: TENANT, _user_id: USER, _coupon_id: COUPON, _order_id: ORDER_ID },
    ]);
    expect(h.log.indexOf("coupon:release")).toBeGreaterThan(
      h.log.lastIndexOf("from:payment_orders"),
    );
    expect(buyerNotice()).toMatchObject({
      body_pl: expect.stringContaining("Kod wrócił do puli"),
      body_en: expect.stringContaining("Your code is usable again"),
    });
  });

  function buyerNotice(): Record<string, unknown> | undefined {
    const insert = stub()
      .chainsFor("notifications")
      .find((c) => c.has("insert"));
    return insert?.argsOf("insert")?.[0] as Record<string, unknown> | undefined;
  }

  it("pełna sala bez funkcji `_for_user` (pas produkcyjny przed 0305): kod wraca starą ścieżką, nie przepada", async () => {
    // Gołe RPC bez powrotu do starej funkcji kończyło się PGRST202 połkniętym
    // w logu - anulowanego zamówienia nic już nie rozlicza ponownie.
    givenOrder(freeOrder());
    h.seat = "full";
    h.couponReleaseReply = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };

    await settleFreeTicketOrder(ORDER_ID);

    expect(h.couponReleases).toHaveLength(1);
    expect(h.legacyCouponReleases).toEqual([{ _coupon_id: COUPON, _order_id: ORDER_ID }]);
    expect(buyerNotice()?.["body_pl"]).toBe(
      "Ostatnie miejsce zajęto, zanim bilet został wydany. Kod wrócił do puli.",
    );
  });

  it("pełna sala, a baza NIE oddała kodu: zamówienie anulowane, kupujący nie słyszy, że kod wrócił", async () => {
    givenOrder(freeOrder());
    h.seat = "full";
    h.couponReleaseReply = { data: null, error: { code: "57014", message: "statement timeout" } };

    expect(await settleFreeTicketOrder(ORDER_ID)).toEqual({
      outcome: "oversold_refunded",
      seated: false,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[payments] free order coupon release failed",
      ORDER_ID,
      "statement timeout",
    );
    const notice = buyerNotice();
    expect(notice?.["body_pl"]).toBe(
      "Ostatnie miejsce zajęto, zanim bilet został wydany. Zamówienie zostało anulowane.",
    );
    expect(notice?.["body_en"]).toBe(
      "The last seat was taken before your ticket was issued. Your order was canceled.",
    );
  });

  it("pełna sala, a baza odmówiła zwolnienia wartością (`false`) - ten sam neutralny tekst", async () => {
    givenOrder(freeOrder());
    h.seat = "full";
    h.couponReleaseReply = { data: false, error: null };

    await settleFreeTicketOrder(ORDER_ID);

    expect(h.couponReleases).toHaveLength(1);
    expect(buyerNotice()?.["body_pl"]).toBe(
      "Ostatnie miejsce zajęto, zanim bilet został wydany. Zamówienie zostało anulowane.",
    );
  });

  it("zgłoszenie w kolejce: rozliczone, ale BEZ potwierdzonego miejsca - kasa nie obiecuje sukcesu", async () => {
    givenOrder(
      freeOrder({ metadata: { event_id: EVENT, coupon_id: COUPON, registration_id: REG } }),
    );
    h.rpcReplies.push(rpcPaid({ registration_status: "waitlist", waitlist_position: 2 }));

    expect(await settleFreeTicketOrder(ORDER_ID)).toEqual({ outcome: "order", seated: false });
    expect(h.eventMails).toHaveLength(0);
  });

  it("PONOWIENIE zamówienia już zaksięgowanego (rozliczenie urwane po księgowaniu) przechodzi idempotentnie", async () => {
    // Darmowe zamówienie nie ma webhooka, który ponowiłby rozliczenie - robi to
    // tick zadań, a zamówienie stoi już na `paid`.
    givenOrder(freeOrder({ status: "paid" }));
    // Warunkowe księgowanie nie trafia w zamówienie już `paid`; ponowny odczyt
    // statusu potwierdza powtórkę i skutki idą dalej (idempotentne).
    paidFlipResponse = ok([]);

    expect(await settleFreeTicketOrder(ORDER_ID)).toEqual({ outcome: "order", seated: true });
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["paid"]);
    expect(h.claimCalls).toEqual([{ p_order_id: ORDER_ID }]);
    // Księgowanie nie stempluje `paid_at` drugi raz - wyłącznie z kasy w toku;
    // darmowe zamówienie nigdy z `canceled` (kod wrócił już do puli).
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && c.has("in"));
    expect(flip?.argsOf("in")).toEqual(["status", ["pending", "processing", "failed"]]);
    expect(h.revokedOrders).toHaveLength(0);
  });

  it.each([
    ["kwota dodatnia", { amount_cents: 100 }],
    ["zamówienie anulowane (kod wrócił)", { status: "canceled" }],
    ["zamówienie zwrócone", { status: "refunded" }],
    ["zamówienie operatora", { provider: "stripe" }],
    ["bez kodu w metadanych", { metadata: { event_id: EVENT } }],
    ["bez wydarzenia", { metadata: { coupon_id: COUPON } }],
    ["subskrypcja", { kind: "subscription" }],
  ] as const)("%s: pominięte - nic nie jest oznaczane jako opłacone", async (_label, over) => {
    givenOrder(freeOrder(over as Partial<OrderRow>));

    expect(await settleFreeTicketOrder(ORDER_ID)).toEqual({ outcome: "skipped", seated: false });
    expect(h.grants).toHaveLength(0);
    expect(paidPatch()).toBeUndefined();
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("nieznane zamówienie: pominięte", async () => {
    givenOrder(null);

    expect(await settleFreeTicketOrder(ORDER_ID)).toEqual({ outcome: "skipped", seated: false });
    expect(h.grants).toHaveLength(0);
  });
});

// --- 13. ponowienia darmowych zamówień (tick zadań) --------------------------

describe("runUnsettledFreeTicketOrders - ponowienie urwanego rozliczenia", () => {
  const COUPON = "66666666-ffff-4fff-8fff-666666666666";

  /** Klient roli serwisowej ticka - tylko odczyt listy z bazy. */
  function lister(reply: { data: unknown; error: { code?: string; message: string } | null }) {
    const calls: Array<{ fn: string; args: unknown }> = [];
    return {
      calls,
      client: {
        rpc: async (fn: string, args: unknown) => {
          calls.push({ fn, args });
          return reply;
        },
      } as unknown as Parameters<typeof runUnsettledFreeTicketOrders>[0],
    };
  }

  beforeEach(() => {
    givenOrder(
      orderRow({
        amount_cents: 0,
        status: "paid",
        provider: "coupon",
        metadata: { event_id: EVENT, coupon_id: COUPON },
      }),
    );
  });

  it("rozlicza każde wskazane zamówienie tą samą ścieżką i liczy wynik", async () => {
    const { client, calls } = lister({ data: [ORDER_ID, ORDER_ID], error: null });

    expect(await runUnsettledFreeTicketOrders(client, 7, Date.now() + 5_000)).toEqual({
      claimed: 2,
      settled: 2,
      failed: 0,
      deferred: 0,
    });
    expect(calls).toEqual([{ fn: "_event_free_ticket_orders_unsettled", args: { p_limit: 7 } }]);
    expect(h.claimCalls).toHaveLength(2);
  });

  it("błąd jednego zamówienia nie zatrzymuje kolejnych - wróci w następnym ticku", async () => {
    const { client } = lister({ data: [ORDER_ID, ORDER_ID], error: null });
    h.rpcReplies.push(rpcError("XX000", "test: baza chwilowo niedostępna"));

    expect(await runUnsettledFreeTicketOrders(client, 10, Date.now() + 5_000)).toEqual({
      claimed: 2,
      settled: 1,
      failed: 1,
      deferred: 0,
    });
    expect(errorMessages().some((m) => m.includes("free ticket order retry failed"))).toBe(true);
  });

  it("zamówienie odrzucone przez strażnika (np. anulowane w międzyczasie) to porażka, nie rozliczenie", async () => {
    givenOrder(orderRow({ amount_cents: 0, status: "canceled", provider: "coupon" }));
    const { client } = lister({ data: [ORDER_ID], error: null });

    expect(await runUnsettledFreeTicketOrders(client)).toMatchObject({ settled: 0, failed: 1 });
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("po terminie nie pyta bazy; zamówienia ponad termin są odkładane", async () => {
    const early = lister({ data: [ORDER_ID], error: null });
    expect(await runUnsettledFreeTicketOrders(early.client, 10, Date.now() - 1)).toEqual({
      claimed: 0,
      settled: 0,
      failed: 0,
      deferred: 0,
    });
    expect(early.calls).toHaveLength(0);
  });

  it("brak funkcji w bazie (migracja przed kodem) to jawne pominięcie, nie cisza", async () => {
    const { client } = lister({ data: null, error: { code: "PGRST202", message: "no function" } });

    expect(await runUnsettledFreeTicketOrders(client)).toMatchObject({
      claimed: 0,
      skipped: "migration_pending",
    });
  });

  it("inny błąd odczytu listy rzuca - tor zadań raportuje go w logu przebiegów", async () => {
    const { client } = lister({ data: null, error: { code: "XX000", message: "boom" } });

    await expect(runUnsettledFreeTicketOrders(client)).rejects.toThrow(
      "free ticket orders lookup failed",
    );
  });
});
