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
//   - rozjazd nienaprawialny nie może po cichu zapisać czegokolwiek.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- Atrapa klienta service_role ------------------------------------------
// Łańcuch PostgREST: każda metoda zwraca siebie, a `await` (thenable) oddaje
// wynik podstawiony per tabela. `maybeSingle` ma osobny klucz `<tabela>#single`.
const db = vi.hoisted(() => {
  const state: {
    calls: { table: string; method: string; args: unknown[] }[];
    results: Record<string, { data: unknown; error: { message: string } | null }>;
  } = { calls: [], results: {} };

  const resultFor = (key: string, fallback: unknown) =>
    state.results[key] ?? { data: fallback, error: null };

  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const record = (method: string, args: unknown[]) => {
      state.calls.push({ table, method, args });
    };
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "gte",
      "lte",
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
    chain.maybeSingle = () => {
      record("maybeSingle", []);
      return Promise.resolve(resultFor(`${table}#single`, null));
    };
    chain.single = chain.maybeSingle;
    chain.then = (
      onFulfilled?:
        ((value: { data: unknown; error: { message: string } | null }) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(resultFor(table, [])).then(onFulfilled, onRejected);
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
  createStripeClient: (env: string) => {
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
  data: { object: { id: `obj_${id}` } },
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildReconcileReport - sonda zdarzeń", () => {
  it("zwraca pusty raport i NICZEGO nie zapisuje, gdy stan lokalny zgadza się z operatorem", async () => {
    const report = await buildReconcileReport("sandbox", 72);

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

    const report = await buildReconcileReport("sandbox", 72);

    expect(report.issues).toEqual([]);
    // `payout.paid` nie jest obsługiwany, więc nie wchodzi nawet do licznika.
    expect(report.scannedEvents).toBe(2);
  });

  it("zgłasza event_missing dla zdarzenia, którego nie ma w dzienniku", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [stripeEvent("evt_1", "checkout.session.completed")],
      has_more: false,
    });

    const report = await buildReconcileReport("live", 72);

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

    const report = await buildReconcileReport("sandbox", 72);

    expect(report.issues.map((i) => [i.reference, i.reason])).toEqual([
      ["evt_f", "event_failed"],
      ["evt_r", "event_received"],
    ]);
    expect(report.issues.every((i) => i.repairable)).toBe(true);
  });

  it("ogranicza okno skanu do przedziału <1h, 30 dni>", async () => {
    const short = await buildReconcileReport("sandbox", 0);
    expect(short.sinceIso).toBe("2026-08-06T11:00:00.000Z");
    expect(stripe.eventsList.mock.calls[0][0]).toMatchObject({
      limit: 100,
      created: { gte: Math.floor((NOW - 3600_000) / 1000) },
    });

    stripe.eventsList.mockClear();
    const long = await buildReconcileReport("sandbox", 10_000);
    expect(long.sinceIso).toBe("2026-07-07T12:00:00.000Z");
    expect(stripe.eventsList.mock.calls[0][0]).toMatchObject({
      created: { gte: Math.floor((NOW - 720 * 3600_000) / 1000) },
    });
  });

  it("skleja kolejne strony zdarzeń i nie ostrzega, gdy operator odda komplet", async () => {
    stripe.eventsList
      .mockResolvedValueOnce({ data: [stripeEvent("evt_a", "invoice.paid")], has_more: true })
      .mockResolvedValueOnce({ data: [stripeEvent("evt_b", "invoice.paid")], has_more: false });

    const report = await buildReconcileReport("sandbox", 72);

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

    const report = await buildReconcileReport("sandbox", 72);

    expect(stripe.eventsList).toHaveBeenCalledTimes(3);
    expect(report.warnings).toEqual(["events_truncated"]);
  });

  it("kończy skan bez ostrzeżenia, gdy operator odda pustą stronę mimo has_more", async () => {
    stripe.eventsList.mockResolvedValue({ data: [], has_more: true });

    const report = await buildReconcileReport("sandbox", 72);

    expect(stripe.eventsList).toHaveBeenCalledTimes(1);
    expect(report.warnings).toEqual([]);
    expect(report.scannedEvents).toBe(0);
  });

  it("zdarzenie bez znacznika czasu trafia do raportu z pustym occurredAt", async () => {
    stripe.eventsList.mockResolvedValue({
      data: [{ id: "evt_1", type: "invoice.paid", data: { object: {} } }],
      has_more: false,
    });

    const report = await buildReconcileReport("sandbox", 72);

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

    const report = await buildReconcileReport("sandbox", 72);

    expect(report.scannedOrders).toBe(0);
    expect(report.scannedSubscriptions).toBe(0);
    // Pusty dziennik oznacza, że KAŻDE zdarzenie operatora jest rozjazdem.
    expect(report.issues.map((i) => i.reason)).toEqual(["event_missing"]);
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

    const report = await buildReconcileReport("sandbox", 72);

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

    await buildReconcileReport("live", 72);

    expect(argsOf("payment_orders", "eq")).toEqual([
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

    const report = await buildReconcileReport("sandbox", 72);

    expect(report.issues).toEqual([]);
    expect(report.scannedOrders).toBe(1);
  });

  it("nieczytelna sesja daje rozjazd NIENAPRAWIALNY z komunikatem operatora", async () => {
    setRows("payment_orders", [order, { ...order, id: "ord_2", provider_session_id: "cs_2" }]);
    stripe.sessionRetrieve
      .mockRejectedValueOnce(new Error("No such checkout.session: cs_1"))
      .mockRejectedValueOnce("gateway 502");

    const report = await buildReconcileReport("sandbox", 72);

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

    const report = await buildReconcileReport("sandbox", 72);

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

    const report = await buildReconcileReport("sandbox", 72);

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

    const report = await buildReconcileReport("sandbox", 72);

    expect(report.issues).toEqual([]);
    expect(report.scannedSubscriptions).toBe(1);
  });

  it("nieczytelna subskrypcja daje rozjazd NIENAPRAWIALNY", async () => {
    setRows("subscriptions", [sub, { ...sub, provider_subscription_id: "sub_2" }]);
    stripe.subscriptionRetrieve
      .mockRejectedValueOnce(new Error("No such subscription: sub_1"))
      .mockRejectedValueOnce("sieć padła");

    const report = await buildReconcileReport("sandbox", 72);

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
    await expect(buildReconcileReport("sandbox", 72)).rejects.toThrow(
      /dziennika zdarzeń: permission denied/,
    );
  });

  it("rzuca, gdy zamówienia są nieczytelne", async () => {
    setRows("payment_orders", null, { message: "timeout" });
    await expect(buildReconcileReport("sandbox", 72)).rejects.toThrow(/zamówień: timeout/);
  });

  it("rzuca, gdy subskrypcje są nieczytelne", async () => {
    setRows("subscriptions", null, { message: "rls" });
    await expect(buildReconcileReport("sandbox", 72)).rejects.toThrow(/subskrypcji: rls/);
  });

  it("czyta dziennik i subskrypcje w granicach jednego środowiska", async () => {
    await buildReconcileReport("live", 72);

    expect(stripe.envs).toEqual(["live"]);
    expect(argsOf("payment_webhook_events", "eq")).toEqual([["environment", "live"]]);
    expect(argsOf("payment_webhook_events", "gte")).toEqual([["created_at", SINCE_72H]]);
    expect(argsOf("subscriptions", "eq")).toEqual([["environment", "live"]]);
  });
});

describe("repairReconcileIssue - zdarzenie", () => {
  const event = {
    id: "evt_1",
    type: "invoice.paid",
    created: EVENT_CREATED,
    data: { object: { id: "in_1" } },
  };

  it("odtwarza zdarzenie tą samą ścieżką co webhook i domyka dziennik", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.normalize.mockReturnValue({ eventType: "transaction.completed", data: { id: "in_1" } });

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1");

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

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1");

    expect(outcome).toEqual({ reference: "evt_1", status: "skipped", error: null });
    expect(hook.finish.mock.calls[0][1]).toBe("skipped");
  });

  it("zdarzenie spoza integracji kończy się 'skipped' BEZ wpisu w dzienniku i bez wysyłki", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.normalize.mockReturnValue(null);

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1");

    expect(outcome).toEqual({ reference: "evt_1", status: "skipped", error: null });
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
    expect(hook.finish).not.toHaveBeenCalled();
  });

  it("błąd dyspozytora nie wywraca naprawy - ląduje w dzienniku jako 'failed'", async () => {
    stripe.eventsRetrieve.mockResolvedValue(event);
    hook.dispatch.mockRejectedValue(new Error("grant failed"));

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1");

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

    const outcome = await repairReconcileIssue("sandbox", "event", "evt_1");

    expect(outcome).toEqual({
      reference: "evt_1",
      status: "failed",
      error: "[object Object]",
    });
    expect(hook.finish.mock.calls[0][1]).toBe("failed");
  });

  it("zdarzenie bez znacznika czasu księguje się czasem naprawy", async () => {
    stripe.eventsRetrieve.mockResolvedValue({ ...event, created: undefined });

    await repairReconcileIssue("sandbox", "event", "evt_1");

    expect(hook.claim.mock.calls[0][0]).toMatchObject({
      occurredAt: new Date(NOW).toISOString(),
    });
  });

  it("błąd pobrania zdarzenia od operatora propaguje się do wołającego", async () => {
    stripe.eventsRetrieve.mockRejectedValue(new Error("No such event: evt_x"));

    await expect(repairReconcileIssue("sandbox", "event", "evt_x")).rejects.toThrow(
      /No such event: evt_x/,
    );
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });
});

describe("repairReconcileIssue - zamówienie", () => {
  const orderRow = { id: "ord_1", provider_session_id: "cs_1", environment: "sandbox" };
  const session = { id: "cs_1", payment_status: "paid", amount_total: 12000 };

  it("buduje syntetyczne checkout.session.completed z sesji zamówienia", async () => {
    setSingle("payment_orders", orderRow);
    stripe.sessionRetrieve.mockResolvedValue(session);

    const outcome = await repairReconcileIssue("sandbox", "order", "ord_1");

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

    await repairReconcileIssue("live", "order", "ord_1");

    expect(stripe.envs).toEqual(["live"]);
    expect(argsOf("payment_orders", "eq")).toEqual([
      ["id", "ord_1"],
      ["environment", "live"],
    ]);
  });

  it("sesja nieopłacona daje zdarzenie nieudanej płatności, nie realizację", async () => {
    setSingle("payment_orders", orderRow);
    stripe.sessionRetrieve.mockResolvedValue({ ...session, payment_status: "unpaid" });

    await repairReconcileIssue("sandbox", "order", "ord_1");

    expect(hook.normalize.mock.calls[0][0]).toMatchObject({
      type: "checkout.session.async_payment_failed",
    });
  });

  it("brak zamówienia kończy się 'skipped' bez dotykania operatora", async () => {
    setSingle("payment_orders", null);

    const outcome = await repairReconcileIssue("sandbox", "order", "ord_nieznane");

    expect(outcome).toEqual({ reference: "ord_nieznane", status: "skipped", error: null });
    expect(stripe.sessionRetrieve).not.toHaveBeenCalled();
    expect(hook.claim).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("zamówienie bez sesji operatora kończy się 'skipped'", async () => {
    setSingle("payment_orders", { ...orderRow, provider_session_id: null });

    const outcome = await repairReconcileIssue("sandbox", "order", "ord_1");

    expect(outcome).toEqual({ reference: "ord_1", status: "skipped", error: null });
    expect(stripe.sessionRetrieve).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  it("błąd odczytu zamówienia propaguje się i nic nie zostaje odtworzone", async () => {
    setSingle("payment_orders", null, { message: "connection reset" });

    await expect(repairReconcileIssue("sandbox", "order", "ord_1")).rejects.toThrow(
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

    await expect(repairReconcileIssue("sandbox", "order", "ord_1")).rejects.toThrow(
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

    const outcome = await repairReconcileIssue("sandbox", "subscription", "sub_1");

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

    await expect(repairReconcileIssue("sandbox", "subscription", "sub_x")).rejects.toThrow(
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
      data: { object: { id: "in_1" } },
    });
    stripe.subscriptionRetrieve.mockResolvedValue({ id: "sub_1", status: "active" });

    await repairReconcileIssue("sandbox", "order", "ord_1");
    await repairReconcileIssue("sandbox", "order", "ord_1");
    await repairReconcileIssue("sandbox", "event", "evt_1");
    await repairReconcileIssue("sandbox", "event", "evt_1");
    await repairReconcileIssue("sandbox", "subscription", "sub_1");
    await repairReconcileIssue("sandbox", "subscription", "sub_1");

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
      data: { object: { id: "in_1" } },
    });
    hook.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await repairReconcileIssue("sandbox", "event", "evt_1");
    const second = await repairReconcileIssue("sandbox", "event", "evt_1");

    expect(first.status).toBe("processed");
    expect(second.status).toBe("skipped");
    expect(second.error).toBeNull();
    // Druga próba nie dotyka ani dyspozytora, ani domknięcia wpisu.
    expect(hook.dispatch).toHaveBeenCalledTimes(1);
    expect(hook.finish).toHaveBeenCalledTimes(1);
  });
});
