// Trasowanie opłaconych i nieudanych transakcji (przegląd S4, S6, S7; 4.5,
// 4.7, 4.8 / 5.8 / 7.11, 6.8).
//
// CO BYŁO ZŁE.
//   * S4 - zamówienie subskrypcji domykała WYŁĄCZNIE sesja Checkout. Sesja bez
//     pobrania (trial, rabat 100%) świadomie tylko stempluje identyfikatory, a
//     pierwsza OPŁACONA faktura - jedyne zdarzenie z pieniędzmi - omijała
//     domknięcie: zamówienie trialu wisiało jako `processing` na zawsze.
//     Dyspozytor nie podawał też źródła ani chwili pobrania (`paid_at` = dziś
//     przy każdej powtórce).
//   * S6 - nieudana płatność ODROCZONA sesji w trybie `subscription` (SEPA,
//     Bacs) szła do windykacji: mail „płatność nie powiodła się" z terminem
//     kolejnej próby dla subskrypcji, która nigdy nie wystartowała, a
//     zamówienie i zajęte użycie limitowanego kodu wisiały na zawsze.
//   * 4.5 - sesja subskrypcji uruchamiała „odzyskanie płatności": powtórka
//     sesji z uzgadniania przesuwała `last_payment_at` na „teraz", zerowała
//     licznik prób i wysyłała „Płatność zaksięgowana" klientowi w windykacji.
//   * 4.7 - ładunek sprzed wdrożenia (dziennik, zamiatarka) nie ma `source`:
//     powtórka starej sesji subskrypcji omijała domknięcie i zakładała
//     fantomowy dokument `cs_...`.
//   * S7 / 6.8 - dokument „opłacone" (i zakup w GA4) powstawał także dla
//     biletu zwróconego od razu za nadkomplet.
//
// ATRAPY NA GRANICACH: realizacja i cykl życia zamówienia
// (`oneTimeFulfilment.server`), windykacja (`dunning.server`), zapis dokumentu
// (`billingDocuments.server`) i GA4 - każde ma własne testy; tu liczy się
// WYŁĄCZNIE to, dokąd dyspozytor kieruje zdarzenie i z jakimi danymi.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import type { TransactionData } from "@/lib/billing/webhookDispatch.server";

const h = vi.hoisted(() => ({
  fulfil: vi.fn(),
  settle: vi.fn(),
  markFailed: vi.fn(),
  dunningFailed: vi.fn(),
  dunningRecovered: vi.fn(),
  recordDocument: vi.fn(),
  ga4: vi.fn(),
}));

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));
vi.mock("@/lib/billing/oneTimeFulfilment.server", () => ({
  fulfilOneTimeTransaction: (...args: unknown[]) => h.fulfil(...args),
  settleSubscriptionCheckoutOrder: (...args: unknown[]) => h.settle(...args),
  markOneTimePaymentFailed: (...args: unknown[]) => h.markFailed(...args),
  expireCheckoutOrder: async () => false,
}));
vi.mock("@/lib/billing/dunning.server", () => ({
  applyPaymentFailedEffects: (...args: unknown[]) => h.dunningFailed(...args),
  applyPaymentRecoveredEffects: (...args: unknown[]) => h.dunningRecovered(...args),
}));
vi.mock("@/lib/billing/billingDocuments.server", () => ({
  documentInputFromTransaction: (data: { id: string }) => ({ transactionId: data.id }),
  recordTransactionDocument: (input: unknown) => {
    h.recordDocument(input);
    return Promise.resolve("inserted");
  },
}));
vi.mock("@/lib/analytics/ga4Mp.server", () => ({
  sendGa4Purchase: (input: unknown) => h.ga4(input),
}));
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: () => {
    throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
  },
}));

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

const OCCURRED_AT = "2026-09-01T10:00:00.000Z";

function txn(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    id: "cs_live_kasa",
    subscriptionId: "sub_kupujacy",
    customerId: "cus_kupujacy",
    paymentIntentId: null,
    currencyCode: "PLN",
    customData: { orderId: "order-subskrypcja", userId: "user-kupujacy" },
    customer: { email: "kupujacy@example.com" },
    details: { totals: { grandTotal: "9900" } },
    source: "checkout_session",
    ...overrides,
  };
}

async function deliver(eventType: string, data: TransactionData) {
  return dispatchWebhookEvent({
    eventId: "evt_trasa",
    eventType,
    data,
    environment: "live",
    occurredAt: OCCURRED_AT,
  });
}

beforeEach(() => {
  db = supabaseFromStub();
  db.setResponse("payment_orders", ok({ tenant_id: "tenant-alfa" }));
  db.setResponse("donations", ok({ tenant_id: "tenant-alfa" }));
  for (const fn of Object.values(h)) fn.mockReset();
  h.fulfil.mockResolvedValue("order");
  h.settle.mockResolvedValue("settled");
});

describe("S4 - domknięcie zamówienia subskrypcji", () => {
  it("sesja Checkout: domknięcie ze źródłem i chwilą pobrania, BEZ odzyskania płatności i dokumentu", async () => {
    expect(await deliver("transaction.completed", txn())).toBe("processed");

    expect(h.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cs_live_kasa",
        sessionId: "cs_live_kasa",
        subscriptionId: "sub_kupujacy",
        source: "checkout_session",
        paidAt: OCCURRED_AT,
      }),
      "live",
    );
    // 4.5: sesja to nie odzyskanie cyklu - windykacja jej nie widzi.
    expect(h.dunningRecovered).not.toHaveBeenCalled();
    // Rozliczeniem subskrypcji jest faktura - fantomu `cs_` nie ma.
    expect(h.recordDocument).not.toHaveBeenCalled();
  });

  it("pierwsza OPŁACONA faktura (po trialu) też idzie do domknięcia - bez identyfikatora sesji", async () => {
    expect(
      await deliver("transaction.completed", txn({ id: "in_live_pierwsza", source: "invoice" })),
    ).toBe("processed");

    expect(h.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "in_live_pierwsza",
        sessionId: null,
        source: "invoice",
        paidAt: OCCURRED_AT,
      }),
      "live",
    );
    // Faktura jest cyklem: odzyskanie płatności i dokument - jak dotąd.
    expect(h.dunningRecovered).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_kupujacy", transactionId: "in_live_pierwsza" }),
    );
    expect(h.recordDocument).toHaveBeenCalledWith({ transactionId: "in_live_pierwsza" });
  });

  it("faktura bez NASZEGO `orderId` (subskrypcja spoza kasy) nie domyka niczego", async () => {
    await deliver(
      "transaction.completed",
      txn({ id: "in_live_obca", source: "invoice", customData: { userId: "user-kupujacy" } }),
    );

    expect(h.settle).not.toHaveBeenCalled();
    expect(h.dunningRecovered).toHaveBeenCalledTimes(1);
  });

  it("historyczna pisownia `order_id` też wskazuje zamówienie", async () => {
    await deliver(
      "transaction.completed",
      txn({ id: "in_live_x", source: "invoice", customData: { order_id: "order-stare" } }),
    );

    expect(h.settle).toHaveBeenCalledTimes(1);
  });
});

describe("4.7 - ładunek sprzed wdrożenia (bez `source`) rozpoznaje źródło po identyfikatorze", () => {
  it("`cs_...` z subskrypcją: domknięcie jak sesji, bez fantomowego dokumentu i bez odzyskania", async () => {
    await deliver("transaction.completed", txn({ source: undefined }));

    expect(h.settle).toHaveBeenCalledWith(
      expect.objectContaining({ source: "checkout_session", sessionId: "cs_live_kasa" }),
      "live",
    );
    expect(h.recordDocument).not.toHaveBeenCalled();
    expect(h.dunningRecovered).not.toHaveBeenCalled();
  });

  it("`in_...`: domknięcie jak faktury, dokument i odzyskanie płatności", async () => {
    await deliver("transaction.completed", txn({ id: "in_live_stara", source: undefined }));

    expect(h.settle).toHaveBeenCalledWith(
      expect.objectContaining({ source: "invoice", sessionId: null }),
      "live",
    );
    expect(h.recordDocument).toHaveBeenCalledTimes(1);
    expect(h.dunningRecovered).toHaveBeenCalledTimes(1);
  });

  it("identyfikator spoza obu kształtów: bez domknięcia (źródło nieznane), windykacja jak dotąd", async () => {
    await deliver("transaction.completed", txn({ id: "txn_dawny", source: undefined }));

    expect(h.settle).not.toHaveBeenCalled();
    expect(h.dunningRecovered).toHaveBeenCalledTimes(1);
    expect(h.recordDocument).toHaveBeenCalledTimes(1);
  });
});

describe("S6 - nieudana płatność", () => {
  it("odroczona płatność SESJI subskrypcji: zamówienie się zamyka, windykacji nie ma", async () => {
    expect(await deliver("transaction.payment_failed", txn())).toBe("processed");

    expect(h.markFailed).toHaveBeenCalledWith(
      { orderId: "order-subskrypcja", userId: "user-kupujacy" },
      "live",
    );
    expect(h.dunningFailed).not.toHaveBeenCalled();
  });

  it("ładunek sprzed wdrożenia (`cs_...` bez `source`) zamyka zamówienie tak samo", async () => {
    await deliver("transaction.payment_failed", txn({ source: undefined }));

    expect(h.markFailed).toHaveBeenCalledTimes(1);
    expect(h.dunningFailed).not.toHaveBeenCalled();
  });

  it("nieudana FAKTURA odnowienia idzie do windykacji, zamówienia nie rusza", async () => {
    await deliver("transaction.payment_failed", txn({ id: "in_live_odnowienie", source: "invoice" }));

    expect(h.dunningFailed).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_kupujacy", transactionId: "in_live_odnowienie" }),
    );
    expect(h.markFailed).not.toHaveBeenCalled();
  });

  it("nieudana płatność jednorazowa zamyka zamówienie jak dotąd", async () => {
    await deliver(
      "transaction.payment_failed",
      txn({ subscriptionId: null, customData: { orderId: "order-bilet" } }),
    );

    expect(h.markFailed).toHaveBeenCalledWith({ orderId: "order-bilet" }, "live");
    expect(h.dunningFailed).not.toHaveBeenCalled();
  });
});

describe("S7 / 6.8 - dokument i GA4 wyłącznie dla zakupu zaksięgowanego", () => {
  const oneTime = () =>
    txn({
      id: "cs_live_bilet",
      subscriptionId: null,
      customData: { orderId: "order-bilet", purpose: "ticket" },
    });

  it.each([
    ["order", true],
    ["donation", true],
    // Zamówienie opłacone i wstrzymane do decyzji administratora (S8):
    // pieniądze pobrane, księgi zgodne z operatorem.
    ["held", true],
    ["oversold_refunded", false],
    ["skipped", false],
  ] as const)("realizacja `%s`: dokument i GA4 = %s", async (outcome, recorded) => {
    h.fulfil.mockResolvedValue(outcome);

    expect(await deliver("transaction.completed", oneTime())).toBe("processed");

    expect(h.recordDocument).toHaveBeenCalledTimes(recorded ? 1 : 0);
    expect(h.ga4).toHaveBeenCalledTimes(recorded ? 1 : 0);
  });

  it("realizacja dostaje źródło i chwilę pobrania wg operatora", async () => {
    await deliver("transaction.completed", oneTime());

    expect(h.fulfil).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cs_live_bilet",
        sessionId: "cs_live_bilet",
        source: "checkout_session",
        paidAt: OCCURRED_AT,
      }),
      "live",
    );
  });
});
