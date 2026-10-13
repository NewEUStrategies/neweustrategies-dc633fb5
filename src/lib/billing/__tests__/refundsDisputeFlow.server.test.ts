// ZWROTY I SPORY OD ZDARZENIA STRIPE DO DOSTĘPU - runda 2 przeglądu (S1-S3).
//
// Każdy scenariusz poniżej odtwarza ścieżkę, którą recenzenci zreprodukowali na
// kodzie sprzed poprawki: kilka zdarzeń z rzędu, baza STANOWA (`memoryTables`),
// asercje na wierszach, które czyta `has_content_access()`. Ładunki są
// w kształcie API 2026-08-26.dahlia - `charge.refunded` BEZ listy `refunds`
// (pole nie jest dołączane domyślnie), więc status zwrotu idzie realną ścieżką
// normalizatora (`refunded` albo `null` dla zwrotu częściowego).
//
// OPERATOR JEST STANOWY. Spór, obciążenie i subskrypcja żyją w atrapie
// `getStripeClient` i zmieniają się między zdarzeniami tak, jak u operatora:
// `refunds.server` czyta spór w stanie BIEŻĄCYM (S2) i obciążenie przed
// przywróceniem dostępu, więc atrapa bez pamięci dowodziłaby kolejności
// wywołań, a nie skutku.
//
// DEDUPLIKACJA ALERTÓW. `enqueue_notification` w atrapie zapisuje dzwonek do
// tabeli `notifications` - tak jak funkcja w bazie - więc `once` (odbiorca ma
// już dzwonek z tym adresem) działa jak na produkcji.
//
// `subscription.updated` (ten sam okres, nowy okres) idzie przez
// `syncEntitlementState` z kontraktem dyspozytora (S1: `periodStart`
// = `currentBillingPeriod.startsAt`) - strażnik kolejności dyspozytora pisze
// `or(last_event_at.is.null,...)`, którego tabele w pamięci nie obsługują.
//
// RODO: dane syntetyczne, adresy w `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedWebhookEvent } from "@/lib/stripe.server";
import { memoryTables, type MemoryTables, type Row } from "@/test/billing/memoryTables";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

interface ChargeState {
  amount: number;
  amount_refunded: number;
  refunded: boolean;
  disputed: boolean;
}

const h = vi.hoisted(() => ({
  db: null as MemoryTables | null,
  rpc: null as SupabaseRpcStub | null,
  emails: [] as Array<Record<string, unknown>>,
  stripe: {
    /** Obciążenie po intencji płatności. */
    charges: new Map<string, ChargeState>(),
    /** Bieżący status sporu po identyfikatorze. */
    disputes: new Map<string, string>(),
    /** Faktura opłacona intencją (`invoicePayments.list`, PAY-04). */
    invoices: new Map<string, Record<string, unknown>>(),
    /** Sesja Checkout po intencji (`checkout.sessions.list`, PAY-07 / 2.6). */
    sessions: new Map<string, Record<string, unknown>>(),
    /** Subskrypcje u operatora. */
    subscriptions: new Map<string, Record<string, unknown>>(),
  },
}));

function missing(): Error {
  return Object.assign(new Error("No such resource"), {
    statusCode: 404,
    code: "resource_missing",
  });
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: baza nieustawiona");
      return h.db.stub.from(table);
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (!h.rpc) throw new Error("test: RPC nieustawione");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return {
    ...actual,
    sendTxEmail: (message: Record<string, unknown>) => {
      h.emails.push(message);
      return Promise.resolve({ ok: true });
    },
  };
});

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async () => ({
    charges: { retrieve: async (id: string) => ({ id, payment_intent: null }) },
    invoicePayments: {
      list: async (params: { payment?: { payment_intent?: string } }) => {
        const invoice = h.stripe.invoices.get(params.payment?.payment_intent ?? "");
        return { data: invoice ? [{ invoice }] : [] };
      },
    },
    invoices: { retrieve: async (id: string) => ({ id }) },
    checkout: {
      sessions: {
        list: async (params: { payment_intent?: string }) => {
          const session = h.stripe.sessions.get(params.payment_intent ?? "");
          return { data: session ? [session] : [] };
        },
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => {
        const charge = h.stripe.charges.get(id);
        if (!charge) throw missing();
        return { id, latest_charge: { id: `ch_${id}`, currency: "pln", ...charge } };
      },
    },
    disputes: {
      retrieve: async (id: string) => {
        const status = h.stripe.disputes.get(id);
        if (!status) throw missing();
        const paymentIntent = id.replace(/^dp_/, "");
        return {
          id,
          status,
          amount: 4900,
          currency: "pln",
          payment_intent: paymentIntent,
          charge: `ch_${paymentIntent}`,
        };
      },
    },
    subscriptions: {
      retrieve: async (id: string) => {
        const subscription = h.stripe.subscriptions.get(id);
        if (!subscription) throw missing();
        return subscription;
      },
    },
  }),
}));

const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");

freezeClock();

// --- scena --------------------------------------------------------------------

const TENANT = "tenant-alfa";
const USER = "user-klient";
const ADMIN = "admin-alfa";
const ORDER = "11111111-aaaa-4aaa-8aaa-111111111111";
const ORDER_B = "22222222-bbbb-4bbb-8bbb-222222222222";
const DONATION = "33333333-dddd-4ddd-8ddd-333333333333";
const PERIOD_START = relativeIso(-5 * DZIEN);
const PERIOD_END = relativeIso(25 * DZIEN);

function unixAt(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function baseTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    payment_orders: [],
    user_purchases: [],
    user_subscriptions: [],
    subscriptions: [],
    donations: [],
    notifications: [],
    event_rsvps: [],
    user_roles: [{ user_id: ADMIN, tenant_id: TENANT, role: "admin" }],
    profiles: [
      {
        id: USER,
        tenant_id: TENANT,
        email: "klient@example.com",
        first_name: "Klient",
        last_name: "Testowy",
        display_name: "Klient Testowy",
        prefs: { language: "pl" },
      },
      { id: ADMIN, tenant_id: TENANT, email: "admin@example.com", prefs: { language: "pl" } },
    ],
    access_plans: [
      {
        id: "plan-member",
        tenant_id: TENANT,
        tier_key: "member",
        interval: "month",
        active: true,
        price_cents: 4900,
        currency: "PLN",
        name_pl: "Członek",
        name_en: "Member",
      },
    ],
    crm_leads: [],
    newsletter_subscribers: [],
    ...extra,
  };
}

function purchaseOrder(id: string, paymentIntent: string): Row {
  return {
    id,
    user_id: USER,
    tenant_id: TENANT,
    plan_id: null,
    kind: "one_time",
    entity_type: "post",
    entity_id: `post-${id}`,
    metadata: {},
    amount_cents: 4900,
    refunded_amount_cents: 0,
    currency: "PLN",
    status: "paid",
    environment: "live",
    provider_session_id: `cs_${paymentIntent}`,
    provider_intent_id: `cs_${paymentIntent}`,
    provider_payment_intent_id: paymentIntent,
  };
}

/** Zakup jednorazowy (odblokowanie wpisu) opłacony sesją Checkout. */
function orderScene(): Record<string, Row[]> {
  h.stripe.charges.set("pi_zamowienie", charge());
  return baseTables({
    payment_orders: [purchaseOrder(ORDER, "pi_zamowienie")],
    user_purchases: [
      {
        id: "up-1",
        user_id: USER,
        tenant_id: TENANT,
        entity_type: "post",
        entity_id: `post-${ORDER}`,
        status: "active",
      },
    ],
  });
}

/** Plan dożywotni kupiony sesją Checkout - uprawnienie pod kluczem sesji. */
function planOrderScene(): Record<string, Row[]> {
  const scene = orderScene();
  return {
    ...scene,
    payment_orders: [
      {
        ...purchaseOrder(ORDER, "pi_zamowienie"),
        plan_id: "plan-member",
        entity_type: null,
        entity_id: null,
      },
    ],
    user_purchases: [],
    user_subscriptions: [
      {
        id: "us-plan",
        user_id: USER,
        tenant_id: TENANT,
        plan_id: "plan-member",
        status: "active",
        external_ref: "cs_pi_zamowienie",
        current_period_end: null,
        canceled_at: null,
      },
    ],
  };
}

/** Faktura subskrypcji `sub_1` opłacona intencją, z okresem usługi z pozycji. */
function subscriptionInvoice(paymentIntent: string, start: string, end: string): void {
  h.stripe.invoices.set(paymentIntent, {
    id: `in_${paymentIntent}`,
    billing_reason: "subscription_cycle",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    lines: { data: [{ period: { start: unixAt(start), end: unixAt(end) } }] },
  });
  h.stripe.charges.set(paymentIntent, charge());
}

/** Subskrypcja odnawiana fakturą - zamówienie NIE zna intencji płatności odnowienia. */
function subscriptionScene(): Record<string, Row[]> {
  subscriptionInvoice("pi_odnowienie", PERIOD_START, PERIOD_END);
  h.stripe.subscriptions.set("sub_1", {
    id: "sub_1",
    status: "active",
    metadata: { userId: USER },
    items: {
      data: [
        {
          current_period_start: unixAt(PERIOD_START),
          current_period_end: unixAt(PERIOD_END),
          price: { id: "price_plus", lookup_key: "plus_monthly", product: { id: "prod_plus" } },
        },
      ],
    },
  });
  return baseTables({
    subscriptions: [
      {
        id: "s-1",
        provider_subscription_id: "sub_1",
        user_id: USER,
        tenant_id: TENANT,
        price_id: "plus_monthly",
        status: "active",
        current_period_end: PERIOD_END,
        environment: "live",
      },
    ],
    user_subscriptions: [
      {
        id: "us-1",
        user_id: USER,
        tenant_id: TENANT,
        plan_id: "plan-member",
        status: "active",
        external_ref: "sub_1",
        current_period_end: PERIOD_END,
        canceled_at: null,
      },
    ],
  });
}

function charge(overrides: Partial<ChargeState> = {}): ChargeState {
  return { amount: 4900, amount_refunded: 0, refunded: false, disputed: false, ...overrides };
}

let sequence = 0;

function stripeEvent(type: string, object: Record<string, unknown>): VerifiedWebhookEvent {
  sequence += 1;
  return {
    id: `evt_${sequence}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
}

async function deliver(type: string, object: Record<string, unknown>, eventId?: string) {
  const event = stripeEvent(type, object);
  const normalized = normalizeStripeEvent(event);
  if (!normalized) throw new Error(`test: normalizator odrzucił ${type}`);
  await dispatchWebhookEvent({
    eventId: eventId ?? event.id,
    eventType: normalized.eventType,
    data: normalized.data,
    environment: "live",
    occurredAt: new Date(event.created * 1000).toISOString(),
  });
}

/** Spór: operator zmienia status, a potem wysyła zdarzenie z tym statusem. */
async function dispute(
  type: "charge.dispute.created" | "charge.dispute.closed",
  status: string,
  paymentIntent: string,
): Promise<void> {
  h.stripe.disputes.set(`dp_${paymentIntent}`, status);
  const current = h.stripe.charges.get(paymentIntent);
  if (current) current.disputed = true;
  await deliver(type, {
    id: `dp_${paymentIntent}`,
    object: "dispute",
    amount: 4900,
    currency: "pln",
    charge: `ch_${paymentIntent}`,
    payment_intent: paymentIntent,
    reason: "fraudulent",
    status,
  });
}

/** Zwrot: operator podnosi `amount_refunded`, ładunek bez listy `refunds` (dahlia). */
async function refund(paymentIntent: string, refunded: number): Promise<void> {
  const current = h.stripe.charges.get(paymentIntent) ?? charge();
  current.amount_refunded = refunded;
  current.refunded = refunded >= current.amount;
  h.stripe.charges.set(paymentIntent, current);
  await deliver("charge.refunded", {
    id: `ch_${paymentIntent}`,
    object: "charge",
    amount: current.amount,
    amount_captured: current.amount,
    amount_refunded: refunded,
    refunded: current.refunded,
    currency: "pln",
    payment_intent: paymentIntent,
  });
}

function db(): MemoryTables {
  if (!h.db) throw new Error("test: baza nieustawiona");
  return h.db;
}

/** Tytuły dzwonków administratorów najemcy (`enqueue_notification`). */
function adminAlerts(): string[] {
  return db()
    .rows("notifications")
    .filter((row) => row.user_id === ADMIN)
    .map((row) => String(row.title_pl));
}

function adminAlertBodies(): string[] {
  return db()
    .rows("notifications")
    .filter((row) => row.user_id === ADMIN)
    .map((row) => String(row.body_pl));
}

/** Dzwonki KLIENTA (wstawiane wprost przez skutki zwrotu). */
function customerBells(): string[] {
  return db()
    .rows("notifications")
    .filter((row) => row.user_id === USER)
    .map((row) => String(row.title_pl));
}

function find(table: string, predicate: (row: Row) => boolean): Row | undefined {
  return db().find(table, predicate);
}

function order(id = ORDER): Row | undefined {
  return find("payment_orders", (row) => row.id === id);
}

function purchase(id = ORDER): Row | undefined {
  return find("user_purchases", (row) => row.entity_id === `post-${id}`);
}

function subscriptionEntitlement(): Row | undefined {
  return find("user_subscriptions", (row) => row.external_ref === "sub_1");
}

/** `subscription.updated` z kontraktem dyspozytora (S1: `periodStart`). */
async function subscriptionUpdated(periodStart: string, periodEnd: string): Promise<void> {
  await syncEntitlementState({
    userId: USER,
    tenantId: TENANT,
    planId: "plan-member",
    externalRef: "sub_1",
    status: "active",
    periodEnd,
    periodStart,
  });
}

beforeEach(() => {
  h.emails.length = 0;
  h.stripe.charges.clear();
  h.stripe.disputes.clear();
  h.stripe.invoices.clear();
  h.stripe.sessions.clear();
  h.stripe.subscriptions.clear();
  const rpc = supabaseRpcStub();
  // `enqueue_notification` jak w bazie: dzwonek ląduje w `notifications`
  // (najemca z profilu odbiorcy), więc `once` widzi go przy ponowieniu.
  rpc.setResponse("enqueue_notification", (call) => {
    const id = `bell-${String(call.arg("p_user_id"))}-${db().rows("notifications").length}`;
    db()
      .rows("notifications")
      .push({
        id,
        user_id: call.arg("p_user_id"),
        tenant_id: TENANT,
        kind: call.arg("p_kind"),
        href: call.arg("p_href"),
        title_pl: call.arg("p_title_pl"),
        body_pl: call.arg("p_body_pl"),
      });
    return { data: id, error: null };
  });
  rpc.setData("payments_apply_event_ticket_outcome", null);
  h.rpc = rpc;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// --- scenariusze ----------------------------------------------------------------

describe("S2: wygrany spór NIE wskrzesza zwróconego zamówienia (2.0, 2.3, 6.3, 7.1)", () => {
  it("2.0A: zwrot -> spór -> wygrana: zamówienie i zakup zostają zwrócone", async () => {
    h.db = memoryTables(orderScene());

    await refund("pi_zamowienie", 4900);
    await dispute("charge.dispute.created", "needs_response", "pi_zamowienie");
    await dispute("charge.dispute.closed", "won", "pi_zamowienie");

    expect(order()).toMatchObject({ status: "refunded", refunded_amount_cents: 4900 });
    expect(purchase()).toMatchObject({ status: "refunded" });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Spór płatniczy rozstrzygnięty"]);
    expect(adminAlertBodies()[1]).toContain("Płatność została zwrócona");
  });

  it("2.0B/7.1: zapytanie banku -> pełny zwrot -> `warning_closed`: zakup i plan NIE wracają", async () => {
    h.db = memoryTables(planOrderScene());

    await dispute("charge.dispute.created", "warning_needs_response", "pi_zamowienie");
    expect(find("user_subscriptions", () => true)).toMatchObject({ status: "canceled" });

    await refund("pi_zamowienie", 4900);
    await dispute("charge.dispute.closed", "warning_closed", "pi_zamowienie");

    expect(order()).toMatchObject({ status: "refunded", refunded_amount_cents: 4900 });
    expect(find("user_subscriptions", () => true)).toMatchObject({ status: "refunded" });
  });

  it("2.3: zwrot -> spór zatrzymany automatycznym zwrotem (`prevented`): dostęp nie wraca", async () => {
    h.db = memoryTables(orderScene());

    await refund("pi_zamowienie", 4900);
    await dispute("charge.dispute.closed", "prevented", "pi_zamowienie");

    expect(order()).toMatchObject({ status: "refunded" });
    expect(purchase()).toMatchObject({ status: "refunded" });
    expect(adminAlerts()).toEqual(["Spór zakończony zwrotem płatności"]);
  });

  it("6.5: wygrana -> spóźnione `created` (ponowienie): dostęp ZOSTAJE przywrócony", async () => {
    h.db = memoryTables(orderScene());

    await dispute("charge.dispute.created", "needs_response", "pi_zamowienie");
    await dispute("charge.dispute.closed", "won", "pi_zamowienie");
    // Operator: spór jest wygrany; ponawiamy STARE zdarzenie otwarcia.
    await deliver("charge.dispute.created", {
      id: "dp_pi_zamowienie",
      object: "dispute",
      amount: 4900,
      currency: "pln",
      payment_intent: "pi_zamowienie",
      status: "needs_response",
    });

    expect(order()).toMatchObject({ status: "paid", refunded_amount_cents: 0 });
    expect(purchase()).toMatchObject({ status: "active" });
  });
});

describe("2.5 / 5.6 / 6.4: wygrana zeruje kwotę sporu - późniejszy drobny zwrot to korekta ceny", () => {
  it("spór -> wygrana -> zwrot 5 zł: zakup aktywny, licznik = 500", async () => {
    h.db = memoryTables(orderScene());

    await dispute("charge.dispute.created", "needs_response", "pi_zamowienie");
    await dispute("charge.dispute.closed", "won", "pi_zamowienie");
    expect(order()).toMatchObject({ status: "paid", refunded_amount_cents: 0 });

    await refund("pi_zamowienie", 500);

    expect(order()).toMatchObject({ status: "paid", refunded_amount_cents: 500 });
    expect(purchase()).toMatchObject({ status: "active" });
  });
});

describe("2.4 / 2.10 / 5.7: spór nie wysyła klientowi potwierdzenia zwrotu", () => {
  it("2.4: spór otwarty na zamówieniu - bez maila `payment_refunded` i bez dzwonka", async () => {
    h.db = memoryTables(orderScene());

    await dispute("charge.dispute.created", "warning_needs_response", "pi_zamowienie");

    expect(h.emails).toHaveLength(0);
    expect(customerBells()).toEqual([]);
    expect(purchase()).toMatchObject({ status: "refunded" });
  });

  it("2.10/5.7: spór na odnowieniu: otwarty -> przegrany, bez żadnego dzwonka klienta", async () => {
    h.db = memoryTables(subscriptionScene());

    await dispute("charge.dispute.created", "needs_response", "pi_odnowienie");
    await dispute("charge.dispute.closed", "lost", "pi_odnowienie");

    expect(subscriptionEntitlement()).toMatchObject({ status: "refunded" });
    expect(customerBells()).toEqual([]);
    expect(h.emails).toHaveLength(0);
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Spór płatniczy przegrany"]);
  });
});

describe("S1: korekta subskrypcji - ten sam okres nie cofa, nowy opłacony okres przywraca (2.1, 2.2, 5.0, 5.1, 6.0, 6.1, 7.2, 7.3)", () => {
  it("2.2/5.0/6.0/7.3: spór otwarty -> klient zmienia `cancel_at_period_end` (ten sam okres): dostęp dalej wstrzymany", async () => {
    h.db = memoryTables(subscriptionScene());

    await dispute("charge.dispute.created", "needs_response", "pi_odnowienie");
    await subscriptionUpdated(PERIOD_START, PERIOD_END);

    expect(subscriptionEntitlement()).toMatchObject({ status: "refunded" });
  });

  it("2.1/5.1/6.1/7.2: pełny zwrot bieżącego okresu -> kolejne OPŁACONE odnowienie przywraca dostęp", async () => {
    h.db = memoryTables(subscriptionScene());

    await refund("pi_odnowienie", 4900);
    expect(subscriptionEntitlement()).toMatchObject({ status: "refunded" });
    expect(h.emails.map((mail) => mail.type)).toEqual(["payment_refunded"]);

    // Ten sam okres (synchronizacja na żądanie) - nadal bez dostępu.
    await subscriptionUpdated(PERIOD_START, PERIOD_END);
    expect(subscriptionEntitlement()).toMatchObject({ status: "refunded" });

    // Odnowienie: nowy okres zaczyna się PO korekcie.
    const nextEnd = relativeIso(55 * DZIEN);
    await subscriptionUpdated(PERIOD_END, nextEnd);
    expect(subscriptionEntitlement()).toMatchObject({
      status: "active",
      current_period_end: nextEnd,
      canceled_at: null,
    });
  });

  it("2.1: zwrot STAREJ faktury (okres minął) nie odbiera bieżącego okresu i nie pisze klientowi „dostęp zakończony”", async () => {
    h.db = memoryTables(subscriptionScene());
    subscriptionInvoice("pi_stara", relativeIso(-35 * DZIEN), relativeIso(-5 * DZIEN));

    await refund("pi_stara", 4900);
    await refund("pi_stara", 4900);

    expect(subscriptionEntitlement()).toMatchObject({ status: "active", canceled_at: null });
    expect(h.emails).toHaveLength(0);
    expect(customerBells()).toEqual([]);
    // Ślad dla zespołu - raz, mimo ponowienia zdarzenia.
    expect(adminAlerts()).toEqual(["Zwrot faktury za zakończony okres"]);
  });

  it("S2: wygrana na odnowieniu przywraca dostęp ze stanu operatora", async () => {
    h.db = memoryTables(subscriptionScene());

    await dispute("charge.dispute.created", "needs_response", "pi_odnowienie");
    await dispute("charge.dispute.closed", "won", "pi_odnowienie");

    expect(subscriptionEntitlement()).toMatchObject({
      status: "active",
      current_period_end: PERIOD_END,
      canceled_at: null,
    });
  });
});

describe("2.6: darowizna - spór alarmuje, zwrot zamyka wpłatę", () => {
  function donationScene(): Record<string, Row[]> {
    h.stripe.charges.set("pi_darowizna", charge());
    h.stripe.sessions.set("pi_darowizna", {
      id: "cs_darowizna",
      metadata: { purpose: "donation", donationId: DONATION, tenantId: TENANT },
    });
    return baseTables({
      donations: [
        {
          id: DONATION,
          tenant_id: TENANT,
          amount_cents: 4900,
          currency: "PLN",
          status: "paid",
          environment: "live",
          // Wpłata z webhooka: w `provider_intent_id` siedzi SESJA (`txn.id`).
          provider_intent_id: "cs_darowizna",
          provider_session_id: "cs_darowizna",
        },
      ],
    });
  }

  it("spór otwarty alarmuje administratorów najemcy darowizny; przegrany zamyka wpłatę", async () => {
    h.db = memoryTables(donationScene());

    await dispute("charge.dispute.created", "needs_response", "pi_darowizna");
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy"]);
    expect(find("donations", () => true)).toMatchObject({ status: "paid" });

    await dispute("charge.dispute.closed", "lost", "pi_darowizna");
    expect(find("donations", () => true)).toMatchObject({ status: "refunded" });
  });

  it("pełny zwrot wpłaty zapisanej z sesją oznacza ją `refunded`", async () => {
    h.db = memoryTables(donationScene());

    await refund("pi_darowizna", 4900);

    expect(find("donations", () => true)).toMatchObject({ status: "refunded" });
  });
});

describe("2.7 / 6.6 / 6.7: alert o sporze - osobny dla każdego sporu, raz na fazę", () => {
  it("dwa spory w tej samej minucie dają dwa alerty, a ponowione zdarzenie - żadnego nowego", async () => {
    const scene = orderScene();
    h.stripe.charges.set("pi_drugie", charge());
    scene.payment_orders = [...(scene.payment_orders ?? []), purchaseOrder(ORDER_B, "pi_drugie")];
    h.db = memoryTables(scene);

    await dispute("charge.dispute.created", "needs_response", "pi_zamowienie");
    await dispute("charge.dispute.created", "needs_response", "pi_drugie");
    // Ponowienie (redelivery / przegląd zaległych) po kwadransie.
    await dispute("charge.dispute.created", "needs_response", "pi_zamowienie");

    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Otwarto spór płatniczy"]);
    expect(
      db()
        .rows("notifications")
        .map((row) => row.href),
    ).toEqual([
      "/admin/billing?dispute=dp_pi_zamowienie&phase=open",
      "/admin/billing?dispute=dp_pi_drugie&phase=open",
    ]);
  });
});

describe("2.11: nieudany zwrot przywraca dostęp i alarmuje zespół raz", () => {
  it("pełny zwrot -> `refund.failed` (wygasła karta): zamówienie `paid`, zakup aktywny", async () => {
    h.db = memoryTables(orderScene());

    await refund("pi_zamowienie", 4900);
    expect(purchase()).toMatchObject({ status: "refunded" });

    // Operator: zwrot przepadł, pieniądze wróciły na saldo.
    const current = h.stripe.charges.get("pi_zamowienie");
    if (current) Object.assign(current, { amount_refunded: 0, refunded: false });
    const failed = {
      id: "re_wygasla_karta",
      object: "refund",
      amount: 4900,
      charge: "ch_pi_zamowienie",
      payment_intent: "pi_zamowienie",
      currency: "pln",
      status: "failed",
      failure_reason: "expired_or_canceled_card",
    };
    await deliver("refund.failed", failed);
    await deliver("refund.failed", failed);

    expect(order()).toMatchObject({ status: "paid", refunded_amount_cents: 0 });
    expect(purchase()).toMatchObject({ status: "active" });
    expect(adminAlerts()).toEqual(["Zwrot płatności nie powiódł się"]);
  });
});

describe("S3 / 7.7: zwrot po samoczynnym zwrocie nadsprzedanego biletu", () => {
  it("zamówienie już `refunded` z pełną kwotą (stempel C) - `charge.refunded` nie dubluje maila ani dzwonka", async () => {
    const scene = orderScene();
    scene.payment_orders = [
      {
        ...purchaseOrder(ORDER, "pi_zamowienie"),
        entity_type: null,
        entity_id: null,
        metadata: { event_id: "event-1" },
        status: "refunded",
        refunded_amount_cents: 4900,
      },
    ];
    h.db = memoryTables(scene);

    await refund("pi_zamowienie", 4900);

    expect(h.emails).toHaveLength(0);
    expect(customerBells()).toEqual([]);
    expect(h.rpc?.callsFor("payments_apply_event_ticket_outcome")).toHaveLength(0);
  });
});

describe("PAY-07: spór, który WYPRZEDZIŁ realizację zamówienia", () => {
  it("otwarcie zamyka zamówienie w toku (z intencją), wygrana bez zwrotu je opłaca i nadaje dostęp", async () => {
    const scene = orderScene();
    scene.payment_orders = [
      {
        ...purchaseOrder(ORDER, "pi_zamowienie"),
        status: "processing",
        // Zamówienie zna wyłącznie sesję - intencję niesie dopiero spór.
        provider_payment_intent_id: null,
        provider_intent_id: null,
      },
    ];
    scene.user_purchases = [];
    h.stripe.sessions.set("pi_zamowienie", {
      id: "cs_pi_zamowienie",
      metadata: { orderId: ORDER },
    });
    h.db = memoryTables(scene);

    await dispute("charge.dispute.created", "needs_response", "pi_zamowienie");
    expect(order()).toMatchObject({
      status: "refunded",
      provider_payment_intent_id: "pi_zamowienie",
    });

    await dispute("charge.dispute.closed", "won", "pi_zamowienie");

    expect(order()).toMatchObject({ status: "paid", refunded_amount_cents: 0 });
    expect(purchase()).toMatchObject({ status: "active" });
  });
});
