// ZWROT, KTÓRY NIE DOSZEDŁ DO SKUTKU (INV-19c) - od zdarzenia Stripe do RPC.
//
// Do 20261012120000 `refund.failed` nie był mapowany wcale, a korekta ze
// stanem `failed` kończyła się w `applyRefundEffects` jako `skipped`. Zlecenie
// zwrotu za odrzucone zgłoszenie wisiało więc w `submitted` bez końca, choć
// pieniądze nie wróciły do uczestnika.
//
// CO TEN PLIK MIERZY - KONTRAKT CAŁEJ ŚCIEŻKI TS:
//   * normalizacja: `refund.failed`, `refund.updated` i `charge.refund.updated`
//     ze stanem `failed`/`canceled` -> `adjustment.updated` z identyfikatorem
//     ZWROTU i kodem porażki; sukces i `pending` - poza zakresem (sukces niesie
//     `charge.refunded` z kwotą narastającą);
//   * dyspozycja: korekta trafia do `_event_registration_refund_failed` z
//     identyfikatorem zwrotu, ŚRODOWISKIEM zdarzenia i kodem - bez najemcy
//     z ładunku (najemcę bierze baza z wiersza zlecenia);
//   * porażka niczego nie odbiera; bez dopasowanego zamówienia, subskrypcji
//     ani darowizny nie ZAPISUJE niczego (przeliczenie z obciążenia - przegląd
//     2.11 - dotyczy wyłącznie znalezionego celu, patrz refunds.server.test);
//   * awaria RPC rzuca (Stripe ponowi), `false` to zwykłe `skipped`.
//
// Samą eskalację w bazie (stan, powód, alarm, brak drugiego alarmu) dowodzi
// scripts/events-harness/runtime_test.d/24b_refund_jobs_escalation.sql.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args),
  },
}));

// Operator bez śladu tej płatności: brak faktury i sesji Checkout - zwrot
// nie ma celu po naszej stronie poza zleceniem zwrotu zgłoszenia.
vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: async () => ({
    invoicePayments: { list: async () => ({ data: [] }) },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
    // Stan obciążenia po porażce: zwrot nie doszedł, nic nie jest zwrócone.
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        latest_charge: { id: "ch_3InvNineteenC", amount: 10000, amount_refunded: 0 },
      }),
    },
  }),
  getStripeErrorMessage: (error: unknown) => String(error),
  // Bramka środowiska dyspozytora (PAY-05) - poza produkcją każde środowisko.
  environmentGrantsAccess: () => true,
}));

const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
const { applyRefundEffects, isFailedRefund } = await import("@/lib/billing/refunds.server");

const RPC = "_event_registration_refund_failed";

function event(type: string, object: Record<string, unknown>): VerifiedWebhookEvent {
  return { id: `evt_${type}`, type, created: 1_790_000_000, data: { object } };
}

function stripeRefund(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "re_3InvNineteenC",
    object: "refund",
    amount: 10000,
    currency: "pln",
    charge: "ch_3InvNineteenC",
    payment_intent: "pi_3InvNineteenC",
    status: "failed",
    failure_reason: "expired_or_canceled_card",
    ...over,
  };
}

beforeEach(() => {
  db = supabaseFromStub();
  // Zwrot zlecony przez zgłoszenie bez zamówienia i darowizny w tym środowisku.
  db.setResponse("payment_orders", ok(null));
  db.setResponse("donations", (chain) => (chain.has("update") ? ok([]) : ok(null)));
  rpc = supabaseRpcStub();
  rpc.setData(RPC, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeStripeEvent - zwrot, który nie doszedł", () => {
  it("mapuje refund.failed na korektę z identyfikatorem ZWROTU i kodem porażki", () => {
    expect(normalizeStripeEvent(event("refund.failed", stripeRefund()))).toEqual({
      eventType: "adjustment.updated",
      data: {
        id: "re_3InvNineteenC",
        transactionId: "pi_3InvNineteenC",
        subscriptionId: null,
        action: "refund",
        status: "failed",
        failureReason: "expired_or_canceled_card",
      },
    });
  });

  it("nie niesie kwot: kwota pojedynczego zwrotu cofnęłaby licznik narastający", () => {
    const data = normalizeStripeEvent(event("refund.failed", stripeRefund()))?.data as Record<
      string,
      unknown
    >;
    expect(data).not.toHaveProperty("totals");
  });

  it("refund.failed bez pola status (ładunek z dziennika) to nadal porażka", () => {
    const { status: _status, ...withoutStatus } = stripeRefund();
    const data = normalizeStripeEvent(event("refund.failed", withoutStatus))?.data as Record<
      string,
      unknown
    >;
    expect(data.status).toBe("failed");
  });

  it.each([
    ["refund.updated", "failed"],
    ["refund.updated", "canceled"],
    ["charge.refund.updated", "failed"],
    ["charge.refund.updated", "canceled"],
  ])("%s ze stanem %s jest porażką zwrotu", (type, status) => {
    const result = normalizeStripeEvent(event(type, stripeRefund({ status })));
    expect(result?.eventType).toBe("adjustment.updated");
    expect((result?.data as Record<string, unknown>).status).toBe(status);
  });

  it.each([
    ["refund.updated", "succeeded"],
    ["refund.updated", "pending"],
    ["refund.updated", "requires_action"],
    ["charge.refund.updated", "succeeded"],
    ["refund.updated", undefined],
  ])("%s ze stanem %s zostaje poza zakresem (sukces niesie charge.refunded)", (type, status) => {
    expect(normalizeStripeEvent(event(type, stripeRefund({ status })))).toBeNull();
  });

  it("bez payment_intent kotwicą zwrotu zostaje obciążenie", () => {
    const data = normalizeStripeEvent(
      event("refund.failed", stripeRefund({ payment_intent: null })),
    )?.data as Record<string, unknown>;
    expect(data.transactionId).toBe("ch_3InvNineteenC");
  });
});

describe("dyspozycja porażki zwrotu", () => {
  it("refund.failed dochodzi do RPC eskalacji ze środowiskiem zdarzenia i nie dotyka tabel", async () => {
    const normalized = normalizeStripeEvent(event("refund.failed", stripeRefund()));
    expect(normalized).not.toBeNull();

    const outcome = await dispatchWebhookEvent({
      eventType: normalized!.eventType,
      data: normalized!.data,
      environment: "live",
      occurredAt: "2026-10-12T10:00:00.000Z",
    });

    expect(outcome).toBe("processed");
    expect(rpc.calls.map((call) => call.name)).toEqual([RPC]);
    expect(rpc.lastCall(RPC)?.args).toEqual({
      p_provider_refund_id: "re_3InvNineteenC",
      p_environment: "live",
      p_reason: "expired_or_canceled_card",
    });
    // Najemca NIGDY nie jedzie z ładunku operatora - wyprowadza go baza.
    expect(rpc.lastCall(RPC)?.has("p_tenant_id")).toBe(false);
    // Porażka bez celu po naszej stronie niczego nie odbiera ani nie
    // przywraca: tabele są wyłącznie czytane (szukanie celu), zero zapisów.
    // Jedyny zapis to WARUNKOWE wznowienie darowizny `refunded` tej płatności
    // (przegląd 2.11) - bez takiej darowizny nie zmienia żadnego wiersza.
    const writes = db.chains.filter((chain) =>
      ["insert", "update", "upsert", "delete"].some((op) => chain.has(op)),
    );
    expect(writes.map((chain) => chain.table)).toEqual(["donations"]);
    expect(
      writes[0]?.calls.some(
        (call) => call.method === "eq" && call.args[0] === "status" && call.args[1] === "refunded",
      ),
    ).toBe(true);
  });

  it("refund.updated -> canceled bez kodu operatora przekazuje stan jako powód", async () => {
    const normalized = normalizeStripeEvent(
      event("refund.updated", stripeRefund({ status: "canceled", failure_reason: null })),
    );
    await dispatchWebhookEvent({
      eventType: normalized!.eventType,
      data: normalized!.data,
      environment: "sandbox",
      occurredAt: "2026-10-12T10:00:00.000Z",
    });
    expect(rpc.lastCall(RPC)?.args).toEqual({
      p_provider_refund_id: "re_3InvNineteenC",
      p_environment: "sandbox",
      p_reason: "canceled",
    });
  });

  it("eskalacja daje własny wynik; brak dopasowanego zlecenia to skipped z wpisem w logu", async () => {
    const failed = {
      adjustmentId: "re_3InvNineteenC",
      transactionId: "pi_3InvNineteenC",
      subscriptionId: null,
      action: "refund" as const,
      status: "failed",
      amountCents: null,
      currency: null,
      environment: "live" as const,
      failureReason: "lost_or_stolen_card",
    };
    expect(await applyRefundEffects(failed)).toBe("refund_failure_escalated");

    rpc.setData(RPC, false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await applyRefundEffects(failed)).toBe("skipped");
    expect(warn).toHaveBeenCalledWith(
      "[payments] failed refund without escalation",
      expect.objectContaining({ adjustmentId: "re_3InvNineteenC" }),
    );
  });

  it("awaria RPC rzuca - webhook odpowie 500 i Stripe ponowi dostarczenie", async () => {
    rpc.setError(RPC, "connection reset");
    const normalized = normalizeStripeEvent(event("refund.failed", stripeRefund()));
    await expect(
      dispatchWebhookEvent({
        eventType: normalized!.eventType,
        data: normalized!.data,
        environment: "live",
        occurredAt: "2026-10-12T10:00:00.000Z",
      }),
    ).rejects.toThrow(/refund failure: escalation failed: connection reset/);
  });

  it("identyfikator zwrotu o obcym kształcie nie trafia do bazy", async () => {
    const outcome = await applyRefundEffects({
      adjustmentId: "re_1,provider_refund_id.neq.x",
      transactionId: "pi_1",
      subscriptionId: null,
      action: "refund",
      status: "failed",
      amountCents: null,
      currency: null,
      environment: "live",
    });
    expect(outcome).toBe("skipped");
    expect(rpc.calls).toHaveLength(0);
  });

  it.each([
    ["refund", "failed", true],
    ["refund", "canceled", true],
    ["refund", "succeeded", false],
    ["refund", "pending", false],
    ["refund", null, false],
    ["chargeback", "failed", false],
  ] as const)("isFailedRefund(%s, %s) = %s", (action, status, expected) => {
    expect(
      isFailedRefund({
        adjustmentId: "re_1",
        transactionId: "pi_1",
        subscriptionId: null,
        action,
        status,
        amountCents: null,
        currency: null,
        environment: "live",
      }),
    ).toBe(expected);
  });
});
