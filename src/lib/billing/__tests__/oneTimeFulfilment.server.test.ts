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
//   2. Zamówienie ze zgłoszeniem (`metadata.registration_id`) NIE przechodzi
//      przez `refundIfOversold`: tamta bramka liczy RSVP, nie zgłoszenia, i
//      zwróciłaby wpłatę, którą baza właśnie zakolejkowała jako opłaconą.
//   3. Zakleszczenie (40P01) i konflikt serializacji (40001) dostają JEDNO
//      ponowienie - bez niego zakleszczenie z decyzją organizatora kończyło
//      się wpłatą bez zgłoszenia, bo błąd RPC jest tu połykany.
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
  seat: "free" as "free" | "full" | "broken" | "thrown-string",
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
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      h.log.push(`from:${table}`);
      if (!h.stub) throw new Error("test: brak atrapy Supabase");
      return h.stub.from(table);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.log.push(`rpc:${String(args["p_outcome"])}`);
      h.rpcCalls.push({ fn, args });
      return h.rpcReplies.shift() ?? { data: null, error: null };
    },
  },
}));

vi.mock("@/lib/billing/grant.server", () => ({
  grantEntitlement: async (order: unknown) => {
    h.log.push("grant");
    h.grants.push(order);
  },
}));

vi.mock("@/lib/events/ticket.server", () => ({
  assertSeatAvailable: async () => {
    if (h.seat === "full") throw new Error("event_full");
    if (h.seat === "broken") throw new Error("test: odczyt pojemności padł");
    if (h.seat === "thrown-string") throw "test: rzut bez obiektu Error";
  },
}));

vi.mock("@/lib/billing/refundProvider.server", () => ({
  refundTransactionFully: async () => {
    h.log.push("refund");
    return h.refund;
  },
}));

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
  fulfilOneTimeTransaction,
  markOneTimePaymentFailed,
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
let paidFlipResponse: SupabaseResult;
let oversoldFlipResponse: SupabaseResult;
let rsvpResponse: SupabaseResult;
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

  givenOrder(orderRow());
  paidFlipResponse = ok(null);
  oversoldFlipResponse = ok(null);
  rsvpResponse = ok(null);

  const next = supabaseFromStub();
  // Jedna tabela, trzy różne zapytania: odczyt zamówienia, księgowanie
  // (`.neq("status","paid")` - stempel `paid_at` raz) i zamknięcie zwrotem.
  next.setResponse("payment_orders", (chain) => {
    if (chain.has("select")) return orderResponse;
    return chain.has("neq") ? paidFlipResponse : oversoldFlipResponse;
  });
  next.setResponse("event_rsvps", () => rsvpResponse);
  next.setResponse("notifications", ok(null));
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

/** Łatka księgowania (`status: 'paid'`) - jedyny update z `.neq`. */
function paidPatch(): Record<string, unknown> | undefined {
  const chain = stub()
    .chainsFor("payment_orders")
    .find((c) => c.has("update") && c.has("neq"));
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
      }),
      "sandbox",
    );

    expect(outcome).toBe("donation");
    expect(h.donations[0]).toEqual({
      donationId: "don_1",
      sessionId: "cs_1",
      intentId: "txn_test_1",
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

  it("klucz `order_id` (Paddle) prowadzi do tego samego zamówienia co `orderId`", async () => {
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
    expect(stub().chainsFor("payment_orders").at(-1)?.argsOf("neq")).toEqual(["status", "paid"]);

    stub().reset();
    stub().setResponse("payment_orders", (chain) =>
      chain.has("select") ? orderResponse : paidFlipResponse,
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

// --- 4. bramka miejsc (krok 0) ----------------------------------------------

describe("krok 0 - bramka miejsc tylko dla zakupu bez zgłoszenia", () => {
  it("zamówienie ze zgłoszeniem NIE jest zwracane z księgi RSVP - decyduje baza", async () => {
    // Pełna sala według RSVP, ale zamówienie niesie `registration_id`: baza
    // rozstrzyga pod blokadą i stawia wpłatę w kolejce opłaconej.
    h.seat = "full";
    givenOrder(orderRow({ metadata: { event_id: EVENT, registration_id: REG } }));
    h.rpcReplies.push(rpcPaid({ registration_status: "waitlist", waitlist_position: 2 }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.log).not.toContain("refund");
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["paid"]);
  });

  it("zakup bez zgłoszenia przy pełnej sali: zwrot, zamówienie zamknięte, bez dzwonka bez najemcy", async () => {
    h.seat = "full";
    givenOrder(orderRow({ tenant_id: null }));

    expect(await fulfilOneTimeTransaction(txn({ customerEmail: null }), "sandbox")).toBe(
      "oversold_refunded",
    );
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && !c.has("neq"));
    expect(flip?.argsOf("update")?.[0]).toMatchObject({ status: "refunded", provider: "stripe" });
    expect(flip?.argsOf("update")?.[0]).not.toHaveProperty("receipt_email");
    // Zgłoszenie (jeśli było) dostaje wynik `refunded` - kolejka rusza.
    expect(h.rpcCalls.map((c) => c.args["p_outcome"])).toEqual(["refunded"]);
    expect(h.refundMails[0]).toMatchObject({
      userId: USER,
      idempotencySeed: `oversold:${ORDER_ID}`,
    });
    // Wpis dzwonka bez najemcy wyświetlałby się wszystkim albo nikomu.
    expect(stub().chainsFor("notifications")).toHaveLength(0);
    expect(h.grants).toHaveLength(0);
  });

  it("zwrot przy pełnej sali z najemcą zostawia dzwonek i adres na rachunku", async () => {
    h.seat = "full";

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("oversold_refunded");
    const flip = stub()
      .chainsFor("payment_orders")
      .find((c) => c.has("update") && !c.has("neq"));
    expect(flip?.argsOf("update")?.[0]).toMatchObject({ receipt_email: "kupujacy@example.com" });
    expect(stub().lastChain("notifications")?.argsOf("insert")?.[0]).toMatchObject({
      user_id: USER,
      tenant_id: TENANT,
      href: "/profile/tickets",
    });
  });

  it.each([
    ["inny błąd odczytu pojemności", "broken" as const, "test: odczyt pojemności padł"],
    ["rzut bez obiektu Error", "thrown-string" as const, "test: rzut bez obiektu Error"],
  ])("%s NIE jest pełną salą - rzuca dalej, bez zwrotu", async (_label, seat, message) => {
    h.seat = seat;

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toSatisfy((err: unknown) =>
      err instanceof Error ? err.message === message : err === message,
    );
    expect(h.log).not.toContain("refund");
    expect(h.grants).toHaveLength(0);
  });

  it("odmowa zwrotu u operatora RZUCA - sprawa nie jest zamknięta", async () => {
    h.seat = "full";
    h.refund = { ok: false, error: "charge_already_refunded" };

    await expect(fulfilOneTimeTransaction(txn(), "sandbox")).rejects.toThrow(
      "one-time: oversold refund failed (txn_test_1): charge_already_refunded",
    );
    expect(
      stub()
        .chainsFor("payment_orders")
        .filter((c) => c.has("update")),
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

  it("`applied: false` (zakup bez zgłoszenia): dotychczasowe RSVP i mail", async () => {
    h.rpcReplies.push({ data: { applied: false, reason: "no_registration" }, error: null });

    await fulfilOneTimeTransaction(txn(), "sandbox");

    expect(rsvpRows()).toHaveLength(1);
    expect(h.eventMails).toHaveLength(1);
    expect(h.issued).toHaveLength(0);
  });

  it("nieudane RSVP RZUCA - webhook ma dokończyć potwierdzenie", async () => {
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

  it("40001 dwa razy: `null`, ślad w logu, a webhook idzie starą ścieżką z RSVP", async () => {
    h.rpcReplies.push(rpcError("40001"));
    h.rpcReplies.push(rpcError("40001", "could not serialize access"));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("order");
    expect(h.rpcCalls).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "[payments] ticket outcome failed",
      ORDER_ID,
      "paid",
      "could not serialize access",
    );
    expect(h.notifyPayloads).toHaveLength(0);
    expect(rsvpRows()).toHaveLength(1);
    expect(h.eventMails).toHaveLength(1);
  });

  it.each([
    ["inny SQLSTATE", "23514"],
    ["błąd bez kodu", undefined],
  ] as const)("%s: bez ponowienia, `null`", async (_label, code) => {
    h.rpcReplies.push(rpcError(code));

    expect(await applyTicketOutcome(ORDER_ID, "paid")).toBeNull();
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.issued).toHaveLength(0);
  });
});

describe("applyTicketOutcome - ładunek, powiadomienie i bilety", () => {
  it.each([
    ["null", null],
    ["tablica", [{ registration_id: REG }]],
    ["napis", "ok"],
  ] as const)(
    "odpowiedź nie-obiekt (%s): powiadomienie dostaje `{}`, biletów nie ma",
    async (_l, data) => {
      h.rpcReplies.push({ data, error: null });

      expect(await applyTicketOutcome(ORDER_ID, "paid")).toBeNull();
      expect(h.notifyPayloads).toEqual([{}]);
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
