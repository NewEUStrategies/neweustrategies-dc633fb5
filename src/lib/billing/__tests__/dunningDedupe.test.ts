// Windykacja: operator opisuje jedno nieudane obciążenie dwoma zdarzeniami
// (`transaction.payment_failed` i `transaction.past_due`). Użytkownik ma
// dostać jeden mail i jedno powiadomienie, a licznik prób ma wzrosnąć o jeden.
import { describe, expect, it, vi, beforeEach } from "vitest";

const notifyPaymentEmail = vi.fn(async () => undefined);
vi.mock("@/lib/billing/notifications.server", () => ({ notifyPaymentEmail }));
vi.mock("@/lib/billing/purchaseEffects.server", () => ({
  resolvePlanForPrice: async () => ({
    planId: "plan-1",
    tenantId: "tenant-1",
    priceCents: 4900,
    currency: "PLN",
  }),
}));

interface SubState {
  user_id: string;
  tenant_id: string;
  price_id: string;
  current_period_end: string | null;
  payment_failure_count: number;
  last_dunning_transaction_id: string | null;
  last_payment_at: string | null;
}

const state: SubState = {
  user_id: "user-1",
  tenant_id: "tenant-1",
  price_id: "plus_monthly",
  current_period_end: "2026-09-01T00:00:00.000Z",
  payment_failure_count: 0,
  last_dunning_transaction_id: null,
  last_payment_at: null,
};

const notificationInserts: unknown[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "notifications") {
        return {
          insert: async (row: unknown) => {
            notificationInserts.push(row);
            return { error: null };
          },
        };
      }
      // subscriptions
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { ...state }, error: null }),
        update: (patch: Partial<SubState>) => {
          // Zamknięcie cyklu windykacji jest warunkowe (`gt(count, 0)`) i
          // czyta RETURNING - zajęte, gdy cykl był otwarty przed zapisem.
          const claimed = state.payment_failure_count > 0;
          Object.assign(state, patch);
          const query = {
            eq: () => query,
            gt: () => query,
            or: () => query,
            select: async () => ({ data: claimed ? [{ id: "sub-row-1" }] : [], error: null }),
            then: (resolve: (value: { error: null }) => unknown) =>
              Promise.resolve({ error: null }).then(resolve),
          };
          return query;
        },
      };
      return chain;
    },
  },
}));

const ctx = (transactionId: string) => ({
  subscriptionId: "sub_1",
  environment: "sandbox" as const,
  occurredAt: "2026-07-30T10:00:00.000Z",
  amountCents: 4900,
  currency: "PLN",
  transactionId,
});

describe("deduplikacja windykacji", () => {
  beforeEach(() => {
    notifyPaymentEmail.mockClear();
    notificationInserts.length = 0;
    state.payment_failure_count = 0;
    state.last_dunning_transaction_id = null;
    state.last_payment_at = null;
  });

  it("wysyła jedno powiadomienie dla payment_failed + past_due tej samej transakcji", async () => {
    const { applyPaymentFailedEffects } = await import("../dunning.server");
    await applyPaymentFailedEffects(ctx("txn_1"));
    await applyPaymentFailedEffects(ctx("txn_1"));

    expect(notifyPaymentEmail).toHaveBeenCalledTimes(1);
    expect(notificationInserts).toHaveLength(1);
    expect(state.payment_failure_count).toBe(1);
  });

  it("nowa nieudana transakcja podbija licznik i wysyła kolejny mail", async () => {
    const { applyPaymentFailedEffects } = await import("../dunning.server");
    await applyPaymentFailedEffects(ctx("txn_1"));
    await applyPaymentFailedEffects(ctx("txn_2"));

    expect(notifyPaymentEmail).toHaveBeenCalledTimes(2);
    expect(state.payment_failure_count).toBe(2);
  });

  it("zaksięgowanie płatności NIE zwalnia klucza - powtórzona porażka tej samej faktury nie wraca (PAY-13)", async () => {
    // Dawniej odzyskanie płatności zerowało klucz, więc spóźnione albo
    // powtórzone `payment_failed` TEJ SAMEJ, już opłaconej faktury podbijało
    // licznik i wysyłało mail „płatność nie powiodła się". Nowa porażka
    // w kolejnym cyklu ma nową fakturę, więc klucza nie trzeba zwalniać.
    const { applyPaymentFailedEffects, applyPaymentRecoveredEffects } =
      await import("../dunning.server");
    await applyPaymentFailedEffects(ctx("txn_1"));
    await applyPaymentRecoveredEffects(ctx("txn_1"));

    expect(state.last_dunning_transaction_id).toBe("txn_1");

    await applyPaymentFailedEffects(ctx("txn_1"));
    expect(state.payment_failure_count).toBe(0);
    expect(notifyPaymentEmail).toHaveBeenCalledTimes(2); // failed + recovered
  });
});
