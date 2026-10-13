// SPORY I ZWROTY STRIPE OD ZDARZENIA DO DOSTĘPU - przepływ end-to-end:
// surowy ładunek Stripe -> `normalizeStripeEvent` -> `dispatchWebhookEvent`
// -> `applyRefundEffects` -> uprawnienia, zamówienie, alert dla zespołu.
//
// PO CO TEN PLIK OBOK `refunds.server.test.ts`. Tamten test podaje
// `applyRefundEffects` zdarzenie już w słowniku domenowym - i właśnie dlatego
// nie widział, że Stripe tego słownika nie mówi. Spór przychodzi ze statusem
// `needs_response` / `won` / `lost` (PAY-03), a zwrot faktury odnowienia
// z `pi_...`, którego nasze zamówienia nie znają (PAY-04). Oba defekty żyły
// NA STYKU warstw: każda warstwa z osobna była „zielona", a klient po sporze
// albo zwrocie zachowywał dostęp, zespół nie dostawał alertu, a wygrany spór
// niczego nie przywracał.
//
// STAN, NIE KOLEJNOŚĆ WYWOŁAŃ. Baza jest stanowa (`memoryTables`): drugie
// zdarzenie (spór rozstrzygnięty) widzi to, co zapisało pierwsze (spór
// otwarty). Asercje czytają wiersze uprawnień - to samo, co czyta
// `has_content_access()`.
//
// GRANICE ATRAP: klient roli serwisowej (tabele + RPC), wysyłka poczty
// i klient operatora (`getStripeClient`). Reszta - normalizator, dyspozytor,
// `refunds.server`, `grant.server`, `entitlementSync.server`,
// `purchaseEffects.server`, `tenantAdminAlert.server` - biegnie prawdziwa.
// RODO: dane syntetyczne, adresy w `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedWebhookEvent } from "@/lib/stripe.server";
import { memoryTables, type MemoryTables, type Row } from "@/test/billing/memoryTables";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  db: null as MemoryTables | null,
  rpc: null as SupabaseRpcStub | null,
  emails: [] as Array<Record<string, unknown>>,
  /** `invoicePayments.list` po intencji płatności (PAY-04). */
  invoiceByIntent: new Map<string, Record<string, unknown>>(),
  /** Bieżący status sporu u operatora (`disputes.retrieve`, S2). */
  disputeStatus: new Map<string, string>(),
}));

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
        const invoice = h.invoiceByIntent.get(params.payment?.payment_intent ?? "");
        return { data: invoice ? [{ invoice }] : [] };
      },
    },
    invoices: { retrieve: async (id: string) => ({ id }) },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
    // S2: spór liczony ze stanu BIEŻĄCEGO u operatora, przywrócenie sprawdza
    // obciążenie (bez zwrotów) i bierze stan subskrypcji od operatora.
    disputes: {
      retrieve: async (id: string) => {
        const paymentIntent = id.replace(/^dp_/, "");
        return {
          id,
          status: h.disputeStatus.get(id) ?? null,
          amount: 4900,
          currency: "pln",
          payment_intent: paymentIntent,
          charge: `ch_${paymentIntent}`,
        };
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        latest_charge: { id: `ch_${id}`, amount: 4900, amount_refunded: 0, refunded: false },
      }),
    },
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        status: "active",
        items: {
          data: [
            {
              current_period_start: Math.floor(Date.parse(FUTURE) / 1000) - 30 * 86_400,
              current_period_end: Math.floor(Date.parse(FUTURE) / 1000),
              price: { id: "price_plus", lookup_key: "plus_monthly" },
            },
          ],
        },
      }),
    },
  }),
}));

const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

// --- scena --------------------------------------------------------------------

const TENANT = "tenant-alfa";
const USER = "user-klient";
const ADMIN = "admin-alfa";
const ORDER = "11111111-aaaa-4aaa-8aaa-111111111111";
const FUTURE = "2099-01-01T00:00:00.000Z";

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

/** Zakup jednorazowy (odblokowanie wpisu) opłacony sesją Checkout. */
function orderScene(): Record<string, Row[]> {
  return baseTables({
    payment_orders: [
      {
        id: ORDER,
        user_id: USER,
        tenant_id: TENANT,
        plan_id: null,
        kind: "one_time",
        entity_type: "post",
        entity_id: "post-1",
        metadata: {},
        amount_cents: 4900,
        refunded_amount_cents: 0,
        currency: "PLN",
        status: "paid",
        environment: "live",
        provider_session_id: "cs_zamowienie",
        provider_intent_id: "cs_zamowienie",
        provider_payment_intent_id: "pi_zamowienie",
      },
    ],
    user_purchases: [
      {
        id: "up-1",
        user_id: USER,
        tenant_id: TENANT,
        entity_type: "post",
        entity_id: "post-1",
        status: "active",
      },
    ],
  });
}

/**
 * Plan dożywotni kupiony sesją Checkout: realizacja nadała go pod kluczem
 * transakcji (`provider_intent_id` = sesja), nie pod identyfikatorem zamówienia.
 */
function planOrderScene(): Record<string, Row[]> {
  const scene = orderScene();
  const planOrder = {
    ...(scene.payment_orders?.[0] ?? {}),
    plan_id: "plan-member",
    entity_type: null,
    entity_id: null,
  };
  return {
    ...scene,
    payment_orders: [planOrder],
    user_purchases: [],
    user_subscriptions: [
      {
        id: "us-plan",
        user_id: USER,
        tenant_id: TENANT,
        plan_id: "plan-member",
        status: "active",
        external_ref: "cs_zamowienie",
        current_period_end: null,
        canceled_at: null,
      },
    ],
  };
}

/** Subskrypcja odnawiana fakturą - zamówienie NIE zna intencji płatności odnowienia. */
function subscriptionScene(): Record<string, Row[]> {
  h.invoiceByIntent.set("pi_odnowienie", {
    id: "in_odnowienie",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
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
        current_period_end: FUTURE,
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
        current_period_end: FUTURE,
        canceled_at: null,
      },
    ],
  });
}

function stripeEvent(type: string, object: Record<string, unknown>): VerifiedWebhookEvent {
  return {
    id: `evt_${type}_${String(object.status ?? "")}`,
    type,
    created: 1_790_000_000,
    data: { object },
  };
}

/** Ładunek `Dispute` w kształcie API 2026-08-26.dahlia (pola czytane + kontekst). */
function dispute(status: string, paymentIntent: string): Record<string, unknown> {
  h.disputeStatus.set(`dp_${paymentIntent}`, status);
  return {
    id: `dp_${paymentIntent}`,
    object: "dispute",
    amount: 4900,
    currency: "pln",
    charge: `ch_${paymentIntent}`,
    payment_intent: paymentIntent,
    reason: "fraudulent",
    status,
    livemode: true,
  };
}

/** Ładunek `Charge` po zwrocie - bez pola `invoice` (Basil+). */
function refundedCharge(paymentIntent: string, refunded: number): Record<string, unknown> {
  return {
    id: `ch_${paymentIntent}`,
    object: "charge",
    amount: 4900,
    amount_captured: 4900,
    amount_refunded: refunded,
    refunded: refunded >= 4900,
    currency: "pln",
    payment_intent: paymentIntent,
    refunds: {
      object: "list",
      data: [{ id: `re_${refunded}`, status: "succeeded", amount: refunded }],
    },
    livemode: true,
  };
}

async function deliver(type: string, object: Record<string, unknown>): Promise<void> {
  const event = stripeEvent(type, object);
  const normalized = normalizeStripeEvent(event);
  if (!normalized) throw new Error(`test: normalizator odrzucił ${type}`);
  await dispatchWebhookEvent({
    eventId: event.id,
    eventType: normalized.eventType,
    data: normalized.data,
    environment: "live",
    occurredAt: new Date(event.created * 1000).toISOString(),
  });
}

function db(): MemoryTables {
  if (!h.db) throw new Error("test: baza nieustawiona");
  return h.db;
}

/** Tytuły dzwonków administratorów najemcy (`enqueue_notification`). */
function adminAlerts(): string[] {
  return (h.rpc?.callsFor("enqueue_notification") ?? [])
    .filter((call) => call.arg("p_user_id") === ADMIN)
    .map((call) => String(call.arg("p_title_pl")));
}

function entitlement(table: "user_purchases" | "user_subscriptions"): Row | undefined {
  return db().find(table, (row) => row.user_id === USER);
}

function order(): Row | undefined {
  return db().find("payment_orders", (row) => row.id === ORDER);
}

beforeEach(() => {
  h.emails.length = 0;
  h.invoiceByIntent.clear();
  h.disputeStatus.clear();
  const rpc = supabaseRpcStub();
  rpc.setResponse("enqueue_notification", (call) => ({
    data: `bell-${String(call.arg("p_user_id"))}`,
    error: null,
  }));
  rpc.setData("payments_apply_event_ticket_outcome", null);
  h.rpc = rpc;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PAY-03: spór Stripe na ZAMÓWIENIU - otwarcie, wygrana, przegrana", () => {
  it("PAY-03 e2e: spór otwarty (needs_response) odbiera dostęp i alarmuje administratorów najemcy", async () => {
    h.db = memoryTables(orderScene());

    await deliver("charge.dispute.created", dispute("needs_response", "pi_zamowienie"));

    expect(order()).toMatchObject({ status: "refunded", refunded_amount_cents: 4900 });
    expect(entitlement("user_purchases")).toMatchObject({ status: "refunded" });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy"]);
  });

  it("PAY-03 e2e: spór wygrany (won) przywraca zamówienie i dostęp, z alertem", async () => {
    h.db = memoryTables(orderScene());

    await deliver("charge.dispute.created", dispute("needs_response", "pi_zamowienie"));
    await deliver("charge.dispute.closed", dispute("won", "pi_zamowienie"));

    expect(order()).toMatchObject({ status: "paid" });
    expect(entitlement("user_purchases")).toMatchObject({ status: "active" });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Spór płatniczy rozstrzygnięty"]);
  });

  it("PAY-03 e2e: spór przegrany (lost) zostawia dostęp odebrany i alarmuje zespół", async () => {
    h.db = memoryTables(orderScene());

    await deliver("charge.dispute.created", dispute("warning_needs_response", "pi_zamowienie"));
    await deliver("charge.dispute.closed", dispute("lost", "pi_zamowienie"));

    expect(order()).toMatchObject({ status: "refunded" });
    expect(entitlement("user_purchases")).toMatchObject({ status: "refunded" });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Spór płatniczy przegrany"]);
  });
});

describe("PAY-03: spór Stripe na zamówieniu PLANU", () => {
  it("PAY-03 e2e: spór otwarty ZAWIESZA plan, wygrany przywraca go pod tym samym kluczem", async () => {
    // Plan odebrany statusem `refunded` byłby nieodwracalny (`grantEntitlement`
    // nie wskrzesza zwróconego wiersza) - wygrany spór nie oddałby dostępu.
    h.db = memoryTables(planOrderScene());

    await deliver("charge.dispute.created", dispute("needs_response", "pi_zamowienie"));
    expect(entitlement("user_subscriptions")).toMatchObject({ status: "canceled" });
    expect(order()).toMatchObject({ status: "refunded" });

    await deliver("charge.dispute.closed", dispute("won", "pi_zamowienie"));

    expect(order()).toMatchObject({ status: "paid" });
    expect(db().rows("user_subscriptions")).toEqual([
      expect.objectContaining({ external_ref: "cs_zamowienie", status: "active" }),
    ]);
  });

  it("PAY-03 e2e: spór przegrany po otwartym odbiera plan OSTATECZNIE (`refunded`)", async () => {
    h.db = memoryTables(planOrderScene());

    await deliver("charge.dispute.created", dispute("needs_response", "pi_zamowienie"));
    await deliver("charge.dispute.closed", dispute("lost", "pi_zamowienie"));

    expect(entitlement("user_subscriptions")).toMatchObject({ status: "refunded" });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Spór płatniczy przegrany"]);
  });
});

describe("PAY-03 + PAY-04: spór Stripe na płatności FAKTURY SUBSKRYPCJI", () => {
  it("PAY-03 e2e: spór otwarty na odnowieniu zawiesza dostęp subskrypcji i alarmuje najemcę subskrypcji", async () => {
    h.db = memoryTables(subscriptionScene());

    await deliver("charge.dispute.created", dispute("needs_response", "pi_odnowienie"));

    // S1: korekta bieżącego okresu to `refunded` (trzyma przez
    // `subscription.updated` tego samego okresu), nie zawieszenie `canceled`.
    expect(entitlement("user_subscriptions")).toMatchObject({ status: "refunded" });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy"]);
  });

  it("PAY-03 e2e: spór wygrany na odnowieniu PRZYWRACA dostęp subskrypcji", async () => {
    // Spór otwarty zapisany jako `refunded` byłby nieodwracalny dla
    // `syncEntitlementState` - klient, który miał rację, zostawałby bez
    // opłaconego dostępu. Zawieszenie wraca po wygranej.
    h.db = memoryTables(subscriptionScene());

    await deliver("charge.dispute.created", dispute("needs_response", "pi_odnowienie"));
    await deliver("charge.dispute.closed", dispute("won", "pi_odnowienie"));

    expect(entitlement("user_subscriptions")).toMatchObject({
      status: "active",
      current_period_end: FUTURE,
    });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Spór płatniczy rozstrzygnięty"]);
  });

  it("PAY-03 e2e: spór przegrany na odnowieniu odbiera dostęp ostatecznie", async () => {
    h.db = memoryTables(subscriptionScene());

    await deliver("charge.dispute.created", dispute("under_review", "pi_odnowienie"));
    await deliver("charge.dispute.closed", dispute("lost", "pi_odnowienie"));

    expect(entitlement("user_subscriptions")).toMatchObject({ status: "refunded" });
    expect(adminAlerts()).toEqual(["Otwarto spór płatniczy", "Spór płatniczy przegrany"]);
  });
});

describe("PAY-04: zwrot płatności faktury subskrypcji", () => {
  it("PAY-04 e2e: charge.refunded faktury subskrypcji -> revokeSubscriptionEntitlement (uprawnienie `refunded`)", async () => {
    h.db = memoryTables(subscriptionScene());

    await deliver("charge.refunded", refundedCharge("pi_odnowienie", 4900));

    // Dokładnie zapis `revokeSubscriptionEntitlement`: status `refunded`,
    // koniec okresu i anulowanie na chwilę zwrotu, po kluczu subskrypcji.
    const revoked = entitlement("user_subscriptions");
    expect(revoked).toMatchObject({ status: "refunded", external_ref: "sub_1" });
    expect(revoked?.current_period_end).toBe(revoked?.canceled_at);
    expect(Date.parse(String(revoked?.current_period_end))).toBeLessThanOrEqual(Date.now());
    // Skutki dla klienta jak przy zwrocie zamówienia: mail i dzwonek.
    expect(h.emails.map((mail) => mail.type)).toEqual(["payment_refunded"]);
    expect(db().rows("notifications")).toEqual([
      expect.objectContaining({ user_id: USER, tenant_id: TENANT, title_pl: "Zwrot płatności" }),
    ]);
    // Zwrot to nie spór - zespół nie dostaje alertu.
    expect(adminAlerts()).toEqual([]);
  });

  it("PAY-04 e2e: zwrot CZĘŚCIOWY faktury subskrypcji to korekta ceny - dostęp zostaje", async () => {
    h.db = memoryTables(subscriptionScene());

    await deliver("charge.refunded", refundedCharge("pi_odnowienie", 1000));

    expect(entitlement("user_subscriptions")).toMatchObject({ status: "active" });
    expect(h.emails).toHaveLength(0);
  });

  it("PAY-04 e2e: płatność nieznana ani bazie, ani operatorowi kończy się bez skutku", async () => {
    h.db = memoryTables(subscriptionScene());

    await deliver("charge.refunded", refundedCharge("pi_obca", 4900));

    expect(entitlement("user_subscriptions")).toMatchObject({ status: "active" });
    expect(h.emails).toHaveLength(0);
  });
});
