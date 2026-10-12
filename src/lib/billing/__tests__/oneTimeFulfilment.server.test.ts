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
  /** Środowisko zlecenia zwrotu przy pełnej sali (PAY-14b). */
  refundEnvs: [] as string[],
  /** Odebrania uprawnień: zamówienie (`revokeOrderEntitlement`) i klucze subskrypcji. */
  revokedOrders: [] as unknown[],
  revokedRefs: [] as string[],
  /** Zwolnienia rezerwacji kuponu (`release_b2b_coupon_for_user`). */
  couponReleases: [] as Array<Record<string, unknown>>,
  couponReleaseReply: { data: true, error: null } as RpcReply,
  /** Dzwonki administratorów najemcy (`enqueue_notification`). */
  adminBells: [] as Array<Record<string, unknown>>,
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
      if (fn === "enqueue_notification") {
        h.adminBells.push(args);
        return { data: `bell-${String(args["p_user_id"])}`, error: null };
      }
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
    if (h.seat === "full") throw new Error("event_full");
    if (h.seat === "broken") throw new Error("test: odczyt pojemności padł");
    if (h.seat === "thrown-string") throw "test: rzut bez obiektu Error";
  },
}));

vi.mock("@/lib/billing/refundProvider.server", () => ({
  refundTransactionFully: async (env: string) => {
    h.log.push("refund");
    h.refundEnvs.push(env);
    return h.refund;
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
  h.refundEnvs.length = 0;
  h.revokedOrders.length = 0;
  h.revokedRefs.length = 0;
  h.couponReleases.length = 0;
  h.couponReleaseReply = { data: true, error: null };
  h.adminBells.length = 0;

  givenOrder(orderRow());
  paidFlipResponse = ok([{ id: ORDER_ID }]);
  oversoldFlipResponse = ok(null);
  stateResponse = ok({ status: "paid" });
  rsvpResponse = ok(null);

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
    // Księgowanie WYŁĄCZNIE z kasy w toku - zwrócone i zamknięte zamówienie
    // nie wraca na opłacone (PAY-07).
    expect(
      stub()
        .chainsFor("payment_orders")
        .find((c) => c.has("update"))
        ?.argsOf("in"),
    ).toEqual(["status", ["pending", "processing", "failed"]]);

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
      .find((c) => c.has("update") && !c.has("in"));
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
      .find((c) => c.has("update") && !c.has("in"));
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

  it("PAY-07: zwrot częściowy zaksięgowany przed realizacją też blokuje nadanie", async () => {
    givenOrder(orderRow({ metadata: {}, status: "processing", refunded_amount_cents: 500 }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");
    expect(h.grants).toHaveLength(0);
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

  it("płatność za zamówienie ZAMKNIĘTE (`canceled`) nie nadaje dostępu - zostaje do decyzji człowieka", async () => {
    givenOrder(orderRow({ metadata: {}, status: "canceled" }));

    expect(await fulfilOneTimeTransaction(txn(), "sandbox")).toBe("skipped");
    expect(h.grants).toHaveLength(0);
    expect(errorMessages()).toContain(
      "[payments] one-time: payment for a canceled order - needs review",
    );
  });
});

// --- 9. PAY-06: kwota pobrana kontra kwota zamówienia -------------------------

describe("PAY-06 - porównanie kwoty z zamówieniem", () => {
  it("kwota zgodna: `subtotal - rabat` = kwota zamówienia, podatek na wierzch nie jest rozjazdem", async () => {
    // Zamówienie 80 zł po kuponie (brutto 100 zł). Operator: pozycje 100 zł,
    // rabat 20 zł, VAT doliczony 18,40 zł - suma 98,40 zł.
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
    expect(patch).toMatchObject({ status: "paid", amount_cents: 8_000, currency: "PLN" });
    expect(patch).not.toHaveProperty("metadata");
    expect(h.adminBells).toHaveLength(0);
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
    // Wynik biletu tylko przy zamknięciu - powtórka go nie dubluje.
    expect(h.rpcCalls).toHaveLength(0);
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

  it("trial (operator nie pobrał nic): domknięcie BEZ nadpisania kwoty zerem i bez flagi", async () => {
    givenOrder(subscriptionOrder());

    await settleSubscriptionCheckoutOrder(
      session({ amountCents: 0, amountSubtotalCents: 0, amountDiscountCents: 0 }),
      "sandbox",
    );

    const patch = paidPatch();
    expect(patch).toMatchObject({ status: "paid" });
    expect(patch).not.toHaveProperty("amount_cents");
    expect(patch).not.toHaveProperty("metadata");
  });

  it("rozjazd kwoty pierwszej faktury -> flaga do weryfikacji i alert", async () => {
    givenOrder(subscriptionOrder());

    await settleSubscriptionCheckoutOrder(
      session({ amountCents: 0, amountSubtotalCents: 4_900, amountDiscountCents: 4_900 }),
      "sandbox",
    );

    expect(paidPatch()).toMatchObject({
      amount_cents: 0,
      metadata: { coupon_id: "kupon-1", review: { reason: "amount_mismatch", charged_cents: 0 } },
    });
    expect(h.adminBells).toHaveLength(1);
  });

  it.each([
    ["zwrócone", { status: "refunded" }],
    ["anulowane", { status: "canceled" }],
    ["z kwotą zwrotu", { refunded_amount_cents: 100 }],
    ["jednorazowe (idzie przez fulfilOrder)", { kind: "one_time" }],
    ["z innego środowiska", { environment: "live" }],
  ])("zamówienie %s nie jest domykane", async (_label, over) => {
    givenOrder(subscriptionOrder(over));

    expect(await settleSubscriptionCheckoutOrder(session(), "sandbox")).toBe("skipped");
    expect(paidPatch()).toBeUndefined();
    expect(h.log).not.toContain("coupon");
  });

  it("powtórka (zamówienie już `paid`): `skipped`, ale efekty kuponu dokańczają się", async () => {
    givenOrder(subscriptionOrder({ status: "paid" }));
    paidFlipResponse = ok([]);

    expect(await settleSubscriptionCheckoutOrder(session(), "sandbox")).toBe("skipped");
    expect(h.log).toContain("coupon");
    expect(h.adminBells).toHaveLength(0);
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
});
