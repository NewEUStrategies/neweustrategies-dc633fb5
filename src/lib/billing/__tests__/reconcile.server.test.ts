// Uzgadnianie rozliczeń: raport rozjazdów Stripe kontra baza oraz naprawa
// pojedynczej pozycji uruchamiana z panelu admina.
//
// Moduł MUTUJE stan rozliczeń (odtwarza webhooka), więc testujemy kontrakt, a
// nie implementację:
//   - `buildReconcileReport` jest wyłącznie odczytowy i klasyfikuje każdy
//     rodzaj rozjazdu (event / order / subscription) wraz z flagą `repairable`,
//   - `repairReconcileIssue` idzie tą samą ścieżką co webhook
//     (`normalizeStripeEvent` -> `claimWebhookEvent` -> `dispatchWebhookEvent`
//     -> `finishWebhookEvent`) i używa DETERMINISTYCZNEGO klucza dziennika,
//   - rozjazd nienaprawialny nie może po cichu zapisać czegokolwiek,
//   - ZAKRES NAJEMCY: oba wejścia (raport i naprawa) biegną spod `service_role`,
//     czyli z pominięciem RLS, a `reference` przychodzi wprost od klienta -
//     jedynym zakresem jest filtr w zapytaniu i sprawdzenie przynależności
//     obiektu pobranego od operatora.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- Atrapa klienta service_role ------------------------------------------
// Łańcuch PostgREST: każda metoda zwraca siebie, a `await` (thenable) oddaje
// wiersze podstawione per tabela.
//
// Atrapa FILTRUJE NAPRAWDĘ (`eq`, `in`, `gte`, `lte`), bo cały spór o granicę
// najemcy rozstrzyga się właśnie na tych filtrach: builder oddający stałą
// „potwierdzałby" przynależność dowolnego wiersza i przypadek z cudzym
// `tenant_id` niczego by nie dowodził. Kolumna NIEOBECNA w wierszu-atrapie jest
// przezroczysta, żeby fixture deklarował tylko to, co dany przypadek bada -
// dlatego w przypadkach o przynależność wypisujemy też jawne `null`.
//
// `maybeSingle` czyta te same wiersze, ale klucz `<tabela>#single` nadal
// podstawia wynik wprost - dla przypadków, które badają sam kontrakt zapytania.
const db = vi.hoisted(() => {
  const state: {
    calls: { table: string; method: string; args: unknown[] }[];
    results: Record<string, { data: unknown; error: { message: string } | null }>;
  } = { calls: [], results: {} };

  const resultFor = (key: string, fallback: unknown) =>
    state.results[key] ?? { data: fallback, error: null };

  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const filters: { method: string; column: string; value: unknown }[] = [];
    const record = (method: string, args: unknown[]) => {
      state.calls.push({ table, method, args });
    };
    for (const m of [
      "select",
      "neq",
      "not",
      "order",
      "limit",
      "insert",
      "update",
      "upsert",
      "delete",
    ]) {
      chain[m] = (...args: unknown[]) => {
        record(m, args);
        return chain;
      };
    }
    for (const m of ["eq", "in", "gte", "lte"]) {
      chain[m] = (...args: unknown[]) => {
        record(m, args);
        if (typeof args[0] === "string")
          filters.push({ method: m, column: args[0], value: args[1] });
        return chain;
      };
    }

    const passes = (row: unknown) => {
      if (!row || typeof row !== "object") return true;
      const cells = row as Record<string, unknown>;
      return filters.every((f) => {
        if (!(f.column in cells)) return true;
        const actual = cells[f.column];
        if (f.method === "eq") return actual === f.value;
        if (f.method === "in") return Array.isArray(f.value) && f.value.includes(actual);
        if (typeof actual !== "string" || typeof f.value !== "string") return true;
        return f.method === "gte" ? actual >= f.value : actual <= f.value;
      });
    };
    const applied = (result: { data: unknown; error: { message: string } | null }) =>
      result.error || !Array.isArray(result.data)
        ? result
        : { data: result.data.filter(passes), error: null };

    chain.maybeSingle = () => {
      record("maybeSingle", []);
      if (`${table}#single` in state.results) {
        return Promise.resolve(state.results[`${table}#single`]);
      }
      const result = applied(resultFor(table, []));
      return Promise.resolve({
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        error: result.error,
      });
    };
    chain.single = chain.maybeSingle;
    chain.then = (
      onFulfilled?:
        ((value: { data: unknown; error: { message: string } | null }) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(applied(resultFor(table, []))).then(onFulfilled, onRejected);
    return chain;
  };

  return {
    state,
    supabaseAdmin: {
      from: (table: string) => {
        state.calls.push({ table, method: "from", args: [table] });
        return makeChain(table);
      },
    },
  };
});

// --- Atrapa operatora ------------------------------------------------------
const stripe = vi.hoisted(() => ({
  envs: [] as string[],
  eventsList: vi.fn(),
  eventsRetrieve: vi.fn(),
  sessionRetrieve: vi.fn(),
  subscriptionRetrieve: vi.fn(),
}));

// --- Atrapy ścieżki webhooka ----------------------------------------------
const hook = vi.hoisted(() => ({
  normalize: vi.fn(),
  dispatch: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db.supabaseAdmin }));

vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: (env: string) => {
    stripe.envs.push(env);
    return {
      events: { list: stripe.eventsList, retrieve: stripe.eventsRetrieve },
      checkout: { sessions: { retrieve: stripe.sessionRetrieve } },
      subscriptions: { retrieve: stripe.subscriptionRetrieve },
    };
  },
}));

vi.mock("@/lib/billing/stripeEvents.server", () => ({ normalizeStripeEvent: hook.normalize }));
vi.mock("@/lib/billing/webhookDispatch.server", () => ({ dispatchWebhookEvent: hook.dispatch }));
vi.mock("@/lib/billing/webhookLog.server", () => ({
  claimWebhookEvent: hook.claim,
  finishWebhookEvent: hook.finish,
}));

import { buildReconcileReport, repairReconcileIssue } from "@/lib/billing/reconcile.server";

// Czas zamrożony - `sinceIso`, okno karencji i `occurredAt` są wtedy dokładne.
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const SINCE_72H = "2026-08-03T12:00:00.000Z";
const GRACE = "2026-08-06T11:45:00.000Z";
const EVENT_CREATED = Math.floor(Date.UTC(2026, 7, 5, 9, 30, 0) / 1000);
const EVENT_CREATED_ISO = "2026-08-05T09:30:00.000Z";

/** Najemca wołającego (z bramki `assertAdminWithTenant`) i najemca obcy. */
const TENANT = "tenant-alfa";
const FOREIGN_TENANT = "tenant-beta";

const setRows = (table: string, data: unknown, error: { message: string } | null = null) => {
  db.state.results[table] = { data, error };
};
const setSingle = (table: string, data: unknown, error: { message: string } | null = null) => {
  db.state.results[`${table}#single`] = { data, error };
};
const argsOf = (table: string, method: string) =>
  db.state.calls.filter((c) => c.table === table && c.method === method).map((c) => c.args);
const methodsUsed = () => db.state.calls.map((c) => c.method);

const stripeEvent = (id: string, type: string) => ({
  id,
  type,
  created: EVENT_CREATED,
  data: { object: { id: `obj_${id}`, customer: "cus_1" } },
});

/**
 * Wiersz `payment_orders`, który PRZYPISUJE zdarzenie operatora do najemcy.
 *
 * `events.list` zwraca całe konto Stripe, więc bez takiego wiersza zdarzenie
 * jest NIEROZSTRZYGNIĘTE i w raporcie się nie pojawia. Status `paid` trzyma
 * fixture poza sondą zamówień - świadczy o przynależności, nie o rozjeździe.
 */
const owningOrderRow = (over: Record<string, unknown> = {}) => ({
  id: "ord_wlasciciel",
  tenant_id: TENANT,
  environment: "sandbox",
  status: "paid",
  provider_session_id: null,
  provider_subscription_id: null,
  provider_customer_id: "cus_1",
  provider_payment_intent_id: null,
  provider_intent_id: null,
  provider_charge_id: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.state.calls = [];
  db.state.results = {};
  stripe.envs = [];
  for (const fn of [
    stripe.eventsList,
    stripe.eventsRetrieve,
    stripe.sessionRetrieve,
    stripe.subscriptionRetrieve,
    hook.normalize,
    hook.dispatch,
    hook.claim,
    hook.finish,
  ]) {
    fn.mockReset();
  }
  stripe.eventsList.mockResolvedValue({ data: [], has_more: false });
  hook.claim.mockResolvedValue(true);
  hook.finish.mockResolvedValue(undefined);
  hook.normalize.mockReturnValue({ eventType: "transaction.completed", data: { id: "obj_1" } });
  hook.dispatch.mockResolvedValue("processed");
  // Domyślnie obiekt pobrany od operatora NALEŻY do najemcy wołającego - inaczej
  // każda naprawa kończyłaby się `skipped` i przypadki ścieżki naprawy nie
  // dowodziłyby niczego. Brak dopasowania jest osobnym, jawnym przypadkiem.
  setSingle("subscriptions", { id: "sub-wiersz-najemcy" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildReconcileReport - sonda zdarzeń", () => {
  it("zwraca pusty raport i NICZEGO nie zapisuje, gdy stan lokalny zgadza się z operatorem", async () => {
    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report).toEqual({
      environment: "sandbox",
      sinceIso: SINCE_72H,
      scannedEvents: 0,
      scannedOrders: 0,
      scannedSubscriptions: 0,
      issues: [],
      warnings: [],
    });
    // Operacja czysto odczytowa: żadnego zapisu do bazy ani odtwarzania webhooka.
    expect(methodsUsed()).not.toContain("insert");
    expect(methodsUsed()).not.toContain("update");
    expect(methodsUsed()).not.toContain("upsert");
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("pomija zdarzenia domknięte (processed/skipped) i typy spoza integracji", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [
        stripeEvent("evt_done", "invoice.paid"),
        stripeEvent("evt_skip", "customer.updated"),
        stripeEvent("evt_alien", "payout.paid"),
      ],
      has_more: false,
    });
    setRows("payment_webhook_events", [
      { event_id: "evt_done", status: "processed" },
      { event_id: "evt_skip", status: "skipped" },
    ]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues).toEqual([]);
    // `payout.paid` nie jest obsługiwany, więc nie wchodzi nawet do licznika.
    expect(report.scannedEvents).toBe(2);
  });

  it("zgłasza event_missing dla zdarzenia, którego nie ma w dzienniku", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [stripeEvent("evt_1", "checkout.session.completed")],
      has_more: false,
    });
    setRows("payment_orders", [owningOrderRow({ environment: "live" })]);

    const report = await buildReconcileReport("live", 72, TENANT);

    expect(report.issues).toEqual([
      {
        kind: "event",
        reference: "evt_1",
        eventId: "evt_1",
        eventType: "checkout.session.completed",
        reason: "event_missing",
        detail: null,
        occurredAt: EVENT_CREATED_ISO,
        repairable: true,
      },
    ]);
    expect(report.scannedEvents).toBe(1);
  });

  it("zgłasza event_failed i event_received dla wpisów niedomkniętych", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [stripeEvent("evt_f", "invoice.paid"), stripeEvent("evt_r", "invoice.paid")],
      has_more: false,
    });
    setRows("payment_webhook_events", [
      { event_id: "evt_f", status: "failed" },
      { event_id: "evt_r", status: "received" },
    ]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues.map((i) => [i.reference, i.reason])).toEqual([
      ["evt_f", "event_failed"],
      ["evt_r", "event_received"],
    ]);
    expect(report.issues.every((i) => i.repairable)).toBe(true);
  });

  it("ogranicza okno skanu do przedziału <1h, 30 dni>", async () => {
    const short = await buildReconcileReport("sandbox", 0, TENANT);
    expect(short.sinceIso).toBe("2026-08-06T11:00:00.000Z");
    expect(stripe.eventsList.mock.calls[0][0]).toMatchObject({
      limit: 100,
      created: { gte: Math.floor((NOW - 3600_000) / 1000) },
    });

    stripe.eventsList.mockClear();
    const long = await buildReconcileReport("sandbox", 10_000, TENANT);
    expect(long.sinceIso).toBe("2026-07-07T12:00:00.000Z");
    expect(stripe.eventsList.mock.calls[0][0]).toMatchObject({
      created: { gte: Math.floor((NOW - 720 * 3600_000) / 1000) },
    });
  });

  it("skleja kolejne strony zdarzeń i nie ostrzega, gdy operator odda komplet", async () => {
    stripe.eventsList
      .mockResolvedValueOnce({ data: [stripeEvent("evt_a", "invoice.paid")], has_more: true })
      .mockResolvedValueOnce({ data: [stripeEvent("evt_b", "invoice.paid")], has_more: false });
    setRows("payment_orders", [owningOrderRow()]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(stripe.eventsList).toHaveBeenCalledTimes(2);
    expect(stripe.eventsList.mock.calls[1][0]).toMatchObject({ starting_after: "evt_a" });
    expect(report.scannedEvents).toBe(2);
    expect(report.warnings).toEqual([]);
  });

  it("ostrzega events_truncated, gdy skan urwie się na trzeciej stronie", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [stripeEvent("evt_p", "invoice.paid")],
      has_more: true,
    });

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(stripe.eventsList).toHaveBeenCalledTimes(3);
    expect(report.warnings).toEqual(["events_truncated"]);
  });

  it("kończy skan bez ostrzeżenia, gdy operator odda pustą stronę mimo has_more", async () => {
    stripe.eventsList.mockResolvedValue({ data: [], has_more: true });

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(stripe.eventsList).toHaveBeenCalledTimes(1);
    expect(report.warnings).toEqual([]);
    expect(report.scannedEvents).toBe(0);
  });

  it("zdarzenie bez znacznika czasu trafia do raportu z pustym occurredAt", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [{ id: "evt_1", type: "invoice.paid", data: { object: { customer: "cus_1" } } }],
      has_more: false,
    });
    setRows("payment_orders", [owningOrderRow()]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues[0]).toMatchObject({ reference: "evt_1", occurredAt: null });
  });

  it("puste odpowiedzi bazy (data: null) dają raport zerowy zamiast wywrotki", async () => {
    setRows("payment_webhook_events", null);
    setRows("payment_orders", null);
    setRows("subscriptions", null);
    stripe.eventsList.mockResolvedValue({
      data: [stripeEvent("evt_1", "invoice.paid")],
      has_more: false,
    });

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.scannedOrders).toBe(0);
    expect(report.scannedSubscriptions).toBe(0);
    // Pusty dziennik NIE czyni zdarzenia rozjazdem: bez wiersza po naszej
    // stronie nie wiadomo nawet, czy zdarzenie wspólnego konta jest nasze.
    expect(report.issues).toEqual([]);
    expect(report.scannedEvents).toBe(0);
  });
});

// UWAGA RECENZJI (P1): `listStripeEvents` czyta CAŁE konto operatora, a dziennik
// jest zawężony do najemcy - samo porównanie tych zbiorów robiło z poprawnie
// obsłużonego zdarzenia CUDZEGO obszaru pozycję `event_missing` z przyciskiem
// „Napraw", pokazując obcemu adminowi identyfikator i typ zdarzenia.
describe("buildReconcileReport - przypisanie zdarzenia do najemcy", () => {
  it("zdarzenie obcego obszaru nie jest rozjazdem i nie wycieka identyfikatorem", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [
        stripeEvent("evt_wlasne", "invoice.paid"),
        {
          id: "evt_obcy",
          type: "invoice.paid",
          created: EVENT_CREATED,
          data: { object: { id: "in_obcy", customer: "cus_obcy" } },
        },
      ],
      has_more: false,
    });
    // Oba zamówienia leżą w tej samej tabeli - rozstrzyga wyłącznie `tenant_id`.
    setRows("payment_orders", [
      owningOrderRow(),
      owningOrderRow({
        id: "ord_obcy",
        tenant_id: FOREIGN_TENANT,
        provider_customer_id: "cus_obcy",
      }),
    ]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues.map((i) => i.reference)).toEqual(["evt_wlasne"]);
    expect(report.scannedEvents).toBe(1);
    // Nic z cudzego obszaru nie może wyjść z raportu - ani w polu, ani w szczególe.
    expect(JSON.stringify(report)).not.toContain("obcy");
  });

  it("wpis w dzienniku najemcy sam w sobie przesądza przynależność", async () => {
    // Dziennik jest już filtrowany po `tenant_id`, więc zdarzenie ze statusem
    // `failed` jest nasze nawet bez dopasowania po identyfikatorach operatora.
    stripe.eventsList.mockResolvedValue({
      data: [stripeEvent("evt_f", "invoice.paid")],
      has_more: false,
    });
    setRows("payment_webhook_events", [{ event_id: "evt_f", status: "failed" }]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues.map((i) => [i.reference, i.reason])).toEqual([["evt_f", "event_failed"]]);
    expect(report.scannedEvents).toBe(1);
  });

  it("zwrot płatności gościa przypisuje się po payment_intent zamówienia", async () => {
    // Charge bez klienta Stripe: jedynym wiązaniem jest `payment_intent`.
    stripe.eventsList.mockResolvedValue({
      data: [
        {
          id: "evt_zwrot",
          type: "charge.refunded",
          created: EVENT_CREATED,
          data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_1" } },
        },
      ],
      has_more: false,
    });
    setRows("payment_orders", [
      owningOrderRow({ provider_customer_id: null, provider_payment_intent_id: "pi_1" }),
    ]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues.map((i) => i.reference)).toEqual(["evt_zwrot"]);
    expect(argsOf("payment_orders", "in")).toContainEqual(["provider_payment_intent_id", ["pi_1"]]);
  });

  it("nieczytelna sonda właściciela przerywa raport, zamiast zgadywać", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [stripeEvent("evt_1", "invoice.paid")],
      has_more: false,
    });
    setRows("payment_orders", null, { message: "timeout" });

    await expect(buildReconcileReport("sandbox", 72, TENANT)).rejects.toThrow(
      /właściciela zdarzeń \(payment_orders\): timeout/,
    );
  });
});

describe("buildReconcileReport - sonda zamówień", () => {
  const order = {
    id: "ord_1",
    status: "pending",
    provider_session_id: "cs_1",
    created_at: "2026-08-04T08:00:00.000Z",
  };

  it("zgłasza order_paid_not_fulfilled dla wiszącego zamówienia z opłaconą sesją", async () => {
    setRows("payment_orders", [order]);
    stripe.sessionRetrieve.mockResolvedValue({ id: "cs_1", payment_status: "paid" });

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(stripe.sessionRetrieve).toHaveBeenCalledWith("cs_1");
    expect(report.issues).toEqual([
      {
        kind: "order",
        reference: "ord_1",
        eventId: null,
        eventType: "checkout.session.completed",
        reason: "order_paid_not_fulfilled",
        detail: "cs_1",
        occurredAt: order.created_at,
        repairable: true,
      },
    ]);
    expect(report.scannedOrders).toBe(1);
  });

  it("szuka wyłącznie zamówień Stripe z tego środowiska, poza oknem karencji", async () => {
    setRows("payment_orders", []);

    await buildReconcileReport("live", 72, TENANT);

    expect(argsOf("payment_orders", "eq")).toEqual([
      ["tenant_id", TENANT],
      ["environment", "live"],
      ["provider", "stripe"],
    ]);
    expect(argsOf("payment_orders", "in")).toEqual([["status", ["pending", "processing"]]]);
    expect(argsOf("payment_orders", "gte")).toEqual([["created_at", SINCE_72H]]);
    // 15 minut karencji: świeże zamówienie to jeszcze nie rozjazd.
    expect(argsOf("payment_orders", "lte")).toEqual([["created_at", GRACE]]);
    expect(argsOf("payment_orders", "not")).toEqual([["provider_session_id", "is", null]]);
    expect(argsOf("payment_orders", "limit")).toEqual([[200]]);
  });

  it("nieopłacona sesja nie jest rozjazdem", async () => {
    setRows("payment_orders", [order]);
    stripe.sessionRetrieve.mockResolvedValue({ id: "cs_1", payment_status: "unpaid" });

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues).toEqual([]);
    expect(report.scannedOrders).toBe(1);
  });

  it("nieczytelna sesja daje rozjazd NIENAPRAWIALNY z komunikatem operatora", async () => {
    setRows("payment_orders", [order, { ...order, id: "ord_2", provider_session_id: "cs_2" }]);
    stripe.sessionRetrieve
      .mockRejectedValueOnce(new Error("No such checkout.session: cs_1"))
      .mockRejectedValueOnce("gateway 502");

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues).toEqual([
      {
        kind: "order",
        reference: "ord_1",
        eventId: null,
        eventType: null,
        reason: "order_session_unreadable",
        detail: "No such checkout.session: cs_1",
        occurredAt: order.created_at,
        repairable: false,
      },
      {
        kind: "order",
        reference: "ord_2",
        eventId: null,
        eventType: null,
        reason: "order_session_unreadable",
        // Rzut nie-Error również musi być czytelny w panelu.
        detail: "gateway 502",
        occurredAt: order.created_at,
        repairable: false,
      },
    ]);
  });

  it("wiersz bez identyfikatora sesji jest pomijany, mimo filtra w zapytaniu", async () => {
    setRows("payment_orders", [{ ...order, provider_session_id: null }]);

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(stripe.sessionRetrieve).not.toHaveBeenCalled();
    expect(report.issues).toEqual([]);
    // Wiersz nadal wlicza się do zasięgu skanu.
    expect(report.scannedOrders).toBe(1);
  });
});

describe("buildReconcileReport - sonda subskrypcji", () => {
  const sub = {
    provider_subscription_id: "sub_1",
    status: "active",
    updated_at: "2026-08-02T10:00:00.000Z",
  };

  it("zgłasza subscription_status_drift z kierunkiem rozjazdu w szczególe", async () => {
    setRows("subscriptions", [sub]);
    stripe.subscriptionRetrieve.mockResolvedValue({ id: "sub_1", status: "past_due" });

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues).toEqual([
      {
        kind: "subscription",
        reference: "sub_1",
        eventId: null,
        eventType: "customer.subscription.updated",
        reason: "subscription_status_drift",
        detail: "active -> past_due",
        occurredAt: sub.updated_at,
        repairable: true,
      },
    ]);
    expect(report.scannedSubscriptions).toBe(1);
    // Anulowane subskrypcje są poza skanem - nie ma czego uzgadniać.
    expect(argsOf("subscriptions", "not")).toEqual([["status", "in", "(canceled)"]]);
  });

  it("zgodny status nie jest rozjazdem", async () => {
    setRows("subscriptions", [sub]);
    stripe.subscriptionRetrieve.mockResolvedValue({ id: "sub_1", status: "active" });

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues).toEqual([]);
    expect(report.scannedSubscriptions).toBe(1);
  });

  it("nieczytelna subskrypcja daje rozjazd NIENAPRAWIALNY", async () => {
    setRows("subscriptions", [sub, { ...sub, provider_subscription_id: "sub_2" }]);
    stripe.subscriptionRetrieve
      .mockRejectedValueOnce(new Error("No such subscription: sub_1"))
      .mockRejectedValueOnce("sieć padła");

    const report = await buildReconcileReport("sandbox", 72, TENANT);

    expect(report.issues).toHaveLength(2);
    expect(report.issues[0]).toMatchObject({
      kind: "subscription",
      reference: "sub_1",
      eventType: null,
      reason: "subscription_unreadable",
      detail: "No such subscription: sub_1",
      repairable: false,
    });
    // Rzut nie-Error też musi trafić do szczegółu w czytelnej postaci.
    expect(report.issues[1]).toMatchObject({ reference: "sub_2", detail: "sieć padła" });
  });
});

describe("buildReconcileReport - propagacja błędów bazy", () => {
  it("rzuca, gdy dziennik zdarzeń jest nieczytelny", async () => {
    setRows("payment_webhook_events", null, { message: "permission denied" });
    await expect(buildReconcileReport("sandbox", 72, TENANT)).rejects.toThrow(
      /dziennika zdarzeń: permission denied/,
    );
  });

  it("rzuca, gdy zamówienia są nieczytelne", async () => {
    setRows("payment_orders", null, { message: "timeout" });
    await expect(buildReconcileReport("sandbox", 72, TENANT)).rejects.toThrow(/zamówień: timeout/);
  });

  it("rzuca, gdy subskrypcje są nieczytelne", async () => {
    setRows("subscriptions", null, { message: "rls" });
    await expect(buildReconcileReport("sandbox", 72, TENANT)).rejects.toThrow(/subskrypcji: rls/);
  });

  it("czyta dziennik i subskrypcje w granicach jednego środowiska", async () => {
    await buildReconcileReport("live", 72, TENANT);

    expect(stripe.envs).toEqual(["live"]);
    expect(argsOf("payment_webhook_events", "eq")).toEqual([
      ["tenant_id", TENANT],
      ["environment", "live"],
    ]);
    expect(argsOf("payment_webhook_events", "gte")).toEqual([["created_at", SINCE_72H]]);
    expect(argsOf("subscriptions", "eq")).toEqual([
      ["tenant_id", TENANT],
      ["environment", "live"],
    ]);
  });
});

describe("repairReconcileIssue - zdarzenie", () => {
  const event = {
    id: "evt_1",
    type: "invoice.paid",
    created: EVENT_CREATED,
    data: { object: { id: "in_1", customer: "cus_1" } },
  };

  it("odtwarza zdarzenie tą samą ścieżką co webhook i domyka dziennik", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.normalize.mockReturnValue({ eventType: "transaction.completed", data: { id: "in_1" } });

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);

    expect(stripe.eventsRetrieve).toHaveBeenCalledWith("evt_1");
    expect(hook.normalize).toHaveBeenCalledWith(event);
    expect(hook.claim).toHaveBeenCalledWith({
      eventId: "evt_1",
      eventType: "invoice.paid",
      environment: "sandbox",
      occurredAt: EVENT_CREATED_ISO,
      payload: { eventType: "transaction.completed", data: { id: "in_1" } },
    });
    expect(hook.dispatch).toHaveBeenCalledWith({
      eventType: "transaction.completed",
      data: { id: "in_1" },
      environment: "sandbox",
      occurredAt: EVENT_CREATED_ISO,
    });
    expect(hook.finish).toHaveBeenCalledWith(
      { eventId: "evt_1", environment: "sandbox" },
      "processed",
      {
        durationMs: expect.any(Number),
      },
    );
    expect(outcome).toEqual({ reference: "evt_1", status: "processed", error: null });
  });

  it("przenosi wynik 'skipped' dyspozytora do dziennika i do odpowiedzi", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.dispatch.mockResolvedValue("skipped");

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);

    expect(outcome).toEqual({ reference: "evt_1", status: "skipped", error: null });
    expect(hook.finish.mock.calls[0][1]).toBe("skipped");
  });

  it("zdarzenie spoza integracji kończy się 'skipped' BEZ wpisu w dzienniku i bez wysyłki", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.normalize.mockReturnValue(null);

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);

    expect(outcome).toEqual({ reference: "evt_1", status: "skipped", error: null });
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
    expect(hook.finish).not.toHaveBeenCalled();
  });

  it("błąd dyspozytora nie wywraca naprawy - ląduje w dzienniku jako 'failed'", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.dispatch.mockRejectedValue(new Error("grant failed"));

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);

    expect(outcome).toEqual({ reference: "evt_1", status: "failed", error: "grant failed" });
    expect(hook.finish).toHaveBeenCalledWith(
      { eventId: "evt_1", environment: "sandbox" },
      "failed",
      {
        error: "grant failed",
        durationMs: expect.any(Number),
      },
    );
  });

  it("rzut nie-Error z dyspozytora zapisuje się w dzienniku jako tekst", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.dispatch.mockRejectedValue({ code: "23505" });

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);

    expect(outcome).toEqual({
      reference: "evt_1",
      status: "failed",
      error: "[object Object]",
    });
    expect(hook.finish.mock.calls[0][1]).toBe("failed");
  });

  it("zdarzenie bez znacznika czasu księguje się czasem naprawy", async () => {
    stripe.eventsRetrieve.mockResolvedValue({ ...event, created: undefined });

    await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);

    expect(hook.claim.mock.calls[0][0]).toMatchObject({
      occurredAt: new Date(NOW).toISOString(),
    });
  });

  it("błąd pobrania zdarzenia od operatora propaguje się do wołającego", async () => {
    stripe.eventsRetrieve.mockRejectedValue(new Error("No such event: evt_x"));

    await expect(repairReconcileIssue("sandbox", "event", "evt_x", TENANT)).rejects.toThrow(
      /No such event: evt_x/,
    );
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });
});

// UWAGA RECENZJI (P2): zdarzenia korygujące wiążą się z danymi lokalnymi przez
// `payment_intent` albo identyfikator obciążenia, a nie przez klienta czy
// subskrypcję - przy płatności gościa nie ma nawet klienta Stripe'a. Sonda
// przynależności patrzyła wyłącznie na sesję, subskrypcję i klienta, więc
// WŁASNA naprawa najemcy wracała jako `skipped`.
describe("repairReconcileIssue - korekty bez klienta Stripe", () => {
  /** Zamówienie gościa: żadnej sesji ani klienta, tylko ślad płatności. */
  const guestOrderRow = (over: Record<string, unknown> = {}) => ({
    id: "ord_gosc",
    tenant_id: TENANT,
    environment: "sandbox",
    provider_session_id: null,
    provider_subscription_id: null,
    provider_customer_id: null,
    provider_payment_intent_id: "pi_1",
    provider_intent_id: null,
    provider_charge_id: null,
    ...over,
  });

  const refundEvent = {
    id: "evt_zwrot",
    type: "charge.refunded",
    created: EVENT_CREATED,
    data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_1", customer: null } },
  };

  beforeEach(() => {
    // Domyślne dopasowanie po subskrypcji musi tu zniknąć - dowodzimy, że
    // własność potwierdza ZAMÓWIENIE, a nie zastany fixture.
    setSingle("subscriptions", null);
  });

  it("zwrot płatności gościa WŁASNEGO najemcy idzie do dyspozytora", async () => {
    stripe.eventsRetrieve.mockResolvedValue(refundEvent);
    setRows("payment_orders", [guestOrderRow()]);

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_zwrot", TENANT);

    expect(outcome).toEqual({ reference: "evt_zwrot", status: "processed", error: null });
    expect(hook.dispatch).toHaveBeenCalledTimes(1);
    expect(argsOf("payment_orders", "eq")).toContainEqual(["provider_payment_intent_id", "pi_1"]);
  });

  it("ten sam zwrot z zamówieniem OBCEGO najemcy nadal kończy się `skipped`", async () => {
    stripe.eventsRetrieve.mockResolvedValue(refundEvent);
    setRows("payment_orders", [guestOrderRow({ tenant_id: FOREIGN_TENANT })]);

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_zwrot", TENANT);

    expect(outcome).toEqual({ reference: "evt_zwrot", status: "skipped", error: null });
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
    expect(hook.finish).not.toHaveBeenCalled();
  });

  it("obciążenie zwrotne bez płatności wiąże się po identyfikatorze obciążenia", async () => {
    // Dispute niesie `charge`, a `payment_orders` ma kolumnę `provider_charge_id`.
    stripe.eventsRetrieve.mockResolvedValue({
      id: "evt_spor",
      type: "charge.dispute.created",
      created: EVENT_CREATED,
      data: { object: { id: "dp_1", object: "dispute", charge: "ch_9" } },
    });
    setRows("payment_orders", [
      guestOrderRow({ provider_payment_intent_id: null, provider_charge_id: "ch_9" }),
    ]);

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_spor", TENANT);

    expect(outcome.status).toBe("processed");
    expect(argsOf("payment_orders", "eq")).toContainEqual(["provider_charge_id", "ch_9"]);
  });

  it("zamówienie zapisane w kolumnie `provider_intent_id` też potwierdza własność", async () => {
    // Darowizny i bilety zapisują płatność w tej kolumnie - `refunds.server`
    // szuka zamówienia po obu, więc sonda przynależności nie może być węższa.
    stripe.eventsRetrieve.mockResolvedValue(refundEvent);
    setRows("payment_orders", [
      guestOrderRow({ provider_payment_intent_id: null, provider_intent_id: "pi_1" }),
    ]);

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_zwrot", TENANT);

    expect(outcome.status).toBe("processed");
  });
});

describe("repairReconcileIssue - zamówienie", () => {
  const orderRow = { id: "ord_1", provider_session_id: "cs_1", environment: "sandbox" };
  const session = { id: "cs_1", payment_status: "paid", amount_total: 12000 };

  it("buduje syntetyczne checkout.session.completed z sesji zamówienia", async () => {
    setSingle("payment_orders", orderRow);
    stripe.sessionRetrieve.mockResolvedValue(session);

    const outcome = await repairReconcileIssue("sandbox", "order", "ord_1", TENANT);

    expect(hook.normalize).toHaveBeenCalledWith({
      id: "reconcile_cs_1",
      type: "checkout.session.completed",
      created: Math.floor(NOW / 1000),
      data: { object: session },
    });
    // Wynik jest raportowany pod identyfikatorem ZAMÓWIENIA, nie sesji.
    expect(outcome).toEqual({ reference: "ord_1", status: "processed", error: null });
    expect(hook.claim.mock.calls[0][0]).toMatchObject({ eventId: "reconcile_cs_1" });
  });

  it("zamówienie czytane jest tylko z własnego środowiska", async () => {
    setSingle("payment_orders", null);

    await repairReconcileIssue("live", "order", "ord_1", TENANT);

    expect(stripe.envs).toEqual(["live"]);
    expect(argsOf("payment_orders", "eq")).toEqual([
      ["id", "ord_1"],
      ["tenant_id", TENANT],
      ["environment", "live"],
    ]);
  });

  it("sesja nieopłacona daje zdarzenie nieudanej płatności, nie realizację", async () => {
    setSingle("payment_orders", orderRow);
    stripe.sessionRetrieve.mockResolvedValue({ ...session, payment_status: "unpaid" });

    await repairReconcileIssue("sandbox", "order", "ord_1", TENANT);

    expect(hook.normalize.mock.calls[0][0]).toMatchObject({
      type: "checkout.session.async_payment_failed",
    });
  });

  it("brak zamówienia kończy się 'skipped' bez dotykania operatora", async () => {
    setSingle("payment_orders", null);

    const outcome = await repairReconcileIssue("sandbox", "order", "ord_nieznane", TENANT);

    expect(outcome).toEqual({ reference: "ord_nieznane", status: "skipped", error: null });
    expect(stripe.sessionRetrieve).not.toHaveBeenCalled();
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("zamówienie bez sesji operatora kończy się 'skipped'", async () => {
    setSingle("payment_orders", { ...orderRow, provider_session_id: null });

    const outcome = await repairReconcileIssue("sandbox", "order", "ord_1", TENANT);

    expect(outcome).toEqual({ reference: "ord_1", status: "skipped", error: null });
    expect(stripe.sessionRetrieve).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("błąd odczytu zamówienia propaguje się i nic nie zostaje odtworzone", async () => {
    setSingle("payment_orders", null, { message: "connection reset" });

    await expect(repairReconcileIssue("sandbox", "order", "ord_1", TENANT)).rejects.toThrow(
      /nie udało się odczytać zamówienia: connection reset/,
    );
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("rozjazd NIENAPRAWIALNY (sesja nieczytelna) przerywa naprawę bez żadnego zapisu", async () => {
    // Ten sam warunek, który w raporcie daje `order_session_unreadable`
    // (repairable: false). Gdyby ktoś wymusił naprawę mimo blokady w UI,
    // musi dostać błąd - a nie połowicznie zaksięgowane zamówienie.
    setSingle("payment_orders", orderRow);
    stripe.sessionRetrieve.mockRejectedValue(new Error("No such checkout.session: cs_1"));

    await expect(repairReconcileIssue("sandbox", "order", "ord_1", TENANT)).rejects.toThrow(
      /No such checkout.session/,
    );
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
    expect(hook.finish).not.toHaveBeenCalled();
  });
});

describe("repairReconcileIssue - subskrypcja", () => {
  it("buduje syntetyczne customer.subscription.updated ze stanem od operatora", async () => {
    stripe.subscriptionRetrieve.mockResolvedValue({ id: "sub_1", status: "past_due" });

    const outcome = await repairReconcileIssue("sandbox", "subscription", "sub_1", TENANT);

    expect(stripe.subscriptionRetrieve).toHaveBeenCalledWith("sub_1");
    expect(hook.normalize).toHaveBeenCalledWith({
      // Klucz dziennika niesie status: kolejny rozjazd tej samej subskrypcji
      // to nowe zdarzenie, a powtórka tego samego - ten sam wpis.
      id: "reconcile_sub_1_past_due",
      type: "customer.subscription.updated",
      created: Math.floor(NOW / 1000),
      data: { object: { id: "sub_1", status: "past_due" } },
    });
    expect(outcome).toEqual({ reference: "sub_1", status: "processed", error: null });
  });

  it("rozjazd NIENAPRAWIALNY (subskrypcja nieczytelna) przerywa naprawę bez zapisu", async () => {
    stripe.subscriptionRetrieve.mockRejectedValue(new Error("No such subscription: sub_x"));

    await expect(repairReconcileIssue("sandbox", "subscription", "sub_x", TENANT)).rejects.toThrow(
      /No such subscription/,
    );
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
    expect(hook.finish).not.toHaveBeenCalled();
  });
});

describe("repairReconcileIssue - idempotencja", () => {
  it("powtórna naprawa tego samego rozjazdu trafia w TEN SAM wpis dziennika", async () => {
    // Klucz dziennika (event_id, environment) jest deterministyczny dla każdego
    // rodzaju rozjazdu, więc druga naprawa nie tworzy drugiego wpisu - to na nim
    // stoi cała idempotencja odtwarzania.
    setSingle("payment_orders", { id: "ord_1", provider_session_id: "cs_1" });
    stripe.sessionRetrieve.mockResolvedValue({ id: "cs_1", payment_status: "paid" });
    stripe.eventsRetrieve.mockResolvedValue({
      id: "evt_1",
      type: "invoice.paid",
      created: EVENT_CREATED,
      data: { object: { id: "in_1", customer: "cus_1" } },
    });
    stripe.subscriptionRetrieve.mockResolvedValue({ id: "sub_1", status: "active" });

    await repairReconcileIssue("sandbox", "order", "ord_1", TENANT);
    await repairReconcileIssue("sandbox", "order", "ord_1", TENANT);
    await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);
    await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);
    await repairReconcileIssue("sandbox", "subscription", "sub_1", TENANT);
    await repairReconcileIssue("sandbox", "subscription", "sub_1", TENANT);

    const keys = hook.claim.mock.calls.map((c) => (c[0] as { eventId: string }).eventId);
    expect(keys).toEqual([
      "reconcile_cs_1",
      "reconcile_cs_1",
      "evt_1",
      "evt_1",
      "reconcile_sub_1_active",
      "reconcile_sub_1_active",
    ]);
  });

  it("odmowa dziennika (zdarzenie już domknięte) wstrzymuje ponowną wysyłkę", async () => {
    // `claimWebhookEvent` zwraca `false`, gdy wpis jest już w stanie końcowym
    // (processed/skipped) - to JEST bramka idempotencji. Trasa webhooka honoruje
    // tę odmowę i kończy jako duplikat; naprawa z panelu musi zachowywać się tak
    // samo, inaczej powtórne kliknięcie "Napraw" przepuszcza pełny handler dla
    // domkniętego zdarzenia i nadpisuje `processed_at`/`duration_ms`.
    stripe.eventsRetrieve.mockResolvedValue({
      id: "evt_1",
      type: "invoice.paid",
      created: EVENT_CREATED,
      data: { object: { id: "in_1", customer: "cus_1" } },
    });
    hook.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);
    const second = await repairReconcileIssue("sandbox", "event", "evt_1", TENANT);

    expect(first.status).toBe("processed");
    expect(second.status).toBe("skipped");
    expect(second.error).toBeNull();
    // Druga próba nie dotyka ani dyspozytora, ani domknięcia wpisu.
    expect(hook.dispatch).toHaveBeenCalledTimes(1);
    expect(hook.finish).toHaveBeenCalledTimes(1);
  });
});

describe("izolacja najemcy w uzgadnianiu", () => {
  // DEFEKT NAPRAWIONY (kod produkcyjny).
  //
  // CO BYŁO ZŁE. Oba wejścia stały na `assertAdmin`, czyli na samej ROLI, a
  // wszystkie zapytania szły klientem `service_role`, który OMIJA RLS.
  // `buildReconcileReport` filtrował wyłącznie po środowisku i oknie czasu,
  // a `repairReconcileIssue` brał `reference` wprost od klienta
  // (`z.string().max(255)`) i - dla `kind: "event"` oraz `kind: "subscription"`
  // - pobierał obiekt WPROST ZE STRIPE'A, bez sprawdzenia, czyj on jest.
  //
  // JAKIE TO BYŁO RYZYKO. Raport rozbieżności jednego obszaru roboczego
  // wypisywał `event_id`, identyfikatory zamówień i subskrypcji pozostałych -
  // każdy z gotowym przyciskiem „Napraw". Kliknięcie przepuszczało cudze
  // rozliczenie przez `dispatchWebhookEvent`, czyli pełen zestaw skutków
  // (uprawnienia, miejsca, zwroty, dokumenty, poczta). Wektor był SZERSZY niż
  // w ponowieniu z dziennika: nie trzeba było znać UUID wiersza u nas,
  // wystarczył identyfikator Stripe'a.
  //
  // JAK NAPRAWIONE. Najemca jest wymaganym parametrem obu funkcji i pochodzi
  // z bramki `assertAdminWithTenant` (tożsamość wołającego). Zapytania raportu
  // filtrują po `tenant_id`, a naprawa rozstrzyga przynależność obiektu po
  // NASZYCH tabelach najemcowych; brak dopasowania to `skipped` o kształcie
  // nieodróżnialnym od braku danych.
  const tenantFilters = (table: string) =>
    db.state.calls
      .filter((c) => c.table === table && c.method === "eq" && c.args[0] === "tenant_id")
      .map((c) => c.args[1]);

  it("raport filtruje po najemcy w KAŻDEJ z trzech sond", async () => {
    // Asercja stoi na kontrakcie ZAPYTANIA, bo moduł nie wybiera kolumny
    // `tenant_id` - po samym wyniku nie da się odróżnić najemców.
    await buildReconcileReport("sandbox", 72, TENANT);

    expect(tenantFilters("payment_webhook_events")).toEqual([TENANT]);
    expect(tenantFilters("payment_orders")).toEqual([TENANT]);
    expect(tenantFilters("subscriptions")).toEqual([TENANT]);
  });

  it("naprawa ZAMÓWIENIA nie widzi wiersza obcego najemcy", async () => {
    // Zapytanie z filtrem najemcy nie odda cudzego zamówienia, więc ścieżka
    // kończy się tak samo jak przy literówce w identyfikatorze: `skipped`,
    // bez dotykania operatora. Osobny komunikat potwierdzałby istnienie
    // zamówienia o podanym identyfikatorze.
    setSingle("payment_orders", null);

    const outcome = await repairReconcileIssue("sandbox", "order", "ord_obcy", TENANT);

    expect(outcome).toEqual({ reference: "ord_obcy", status: "skipped", error: null });
    expect(tenantFilters("payment_orders")).toEqual([TENANT]);
    expect(stripe.sessionRetrieve).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("naprawa ZDARZENIA obcego obiektu nie dociera do dyspozytora", async () => {
    // Obiekt jest pobierany ze Stripe'a po identyfikatorze OD KLIENTA, więc
    // przynależność rozstrzygamy po naszych tabelach. Żadnego dopasowania =
    // żadnego odtworzenia: bez tego wystarczyło znać `evt_...` cudzego obszaru.
    stripe.eventsRetrieve.mockResolvedValue({
      id: "evt_obcy",
      type: "invoice.paid",
      created: EVENT_CREATED,
      data: { object: { id: "in_obcy", customer: "cus_obcy" } },
    });
    setSingle("subscriptions", null);
    setSingle("payment_orders", null);

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_obcy", TENANT);

    expect(outcome).toEqual({ reference: "evt_obcy", status: "skipped", error: null });
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
    expect(hook.finish).not.toHaveBeenCalled();
  });

  it("naprawa SUBSKRYPCJI obcego obiektu też kończy się `skipped`", async () => {
    stripe.subscriptionRetrieve.mockResolvedValue({
      id: "sub_obcy",
      status: "past_due",
      customer: "cus_obcy",
    });
    setSingle("subscriptions", null);
    setSingle("payment_orders", null);

    const outcome = await repairReconcileIssue("sandbox", "subscription", "sub_obcy", TENANT);

    expect(outcome).toEqual({ reference: "sub_obcy", status: "skipped", error: null });
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("sonda przynależności pyta o NAJEMCĘ WOŁAJĄCEGO, a nie o dowolnego", async () => {
    // Gdyby sonda nie filtrowała po najemcy, dopasowałaby dowolny wiersz w
    // bazie i „potwierdziła" cudzą własność - czyli nie sprawdzałaby niczego.
    stripe.subscriptionRetrieve.mockResolvedValue({ id: "sub_1", status: "active" });

    await repairReconcileIssue("sandbox", "subscription", "sub_1", FOREIGN_TENANT);

    expect(tenantFilters("subscriptions")).toEqual([FOREIGN_TENANT]);
    expect(
      db.state.calls.filter(
        (c) =>
          c.table === "subscriptions" &&
          c.method === "eq" &&
          c.args[0] === "provider_subscription_id",
      ),
    ).toHaveLength(1);
  });
});
