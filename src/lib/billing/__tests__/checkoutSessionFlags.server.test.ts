// Dowód okablowania: flagi z `checkout_settings` MUSZĄ dojechać do wywołania
// `stripe.checkout.sessions.create`.
//
// Ten test istnieje po audycie, który wykazał, że `checkoutSettings.ts` był
// wołany wyłącznie we własnym teście jednostkowym, a panel admina obiecywał
// kupującemu flagi, które nigdy nie trafiały do sesji. Test jednostkowy czystej
// funkcji tego nie wychwyci - dlatego sprawdzamy tu FAKTYCZNY ładunek wysłany
// do operatora.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CheckoutSettings } from "@/lib/billing/checkoutSettings";

const create = vi.fn();
const list = vi.fn();
const search = vi.fn();
const customersCreate = vi.fn();

vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: () => ({
    checkout: { sessions: { create } },
    prices: { list },
    customers: { search, list: vi.fn().mockResolvedValue({ data: [] }), create: customersCreate },
  }),
  resolveEnvironment: (env?: string) => env ?? "sandbox",
  getStripeErrorMessage: (e: unknown) => String(e),
}));

const SETTINGS: Record<"managed" | "merchant", CheckoutSettings> = {
  managed: {
    allow_promotion_codes: true,
    automatic_tax: false,
    tax_id_collection: true,
    billing_address_collection: "auto",
    invoice_creation: true,
  },
  merchant: {
    allow_promotion_codes: false,
    automatic_tax: true,
    tax_id_collection: true,
    billing_address_collection: "auto",
    invoice_creation: true,
  },
};

/** Ostatni ładunek przekazany do `sessions.create`. */
function lastSessionPayload(): Record<string, unknown> {
  expect(create).toHaveBeenCalled();
  return create.mock.calls[create.mock.calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  create.mockReset();
  list.mockReset();
  search.mockReset();
  customersCreate.mockReset();
  create.mockResolvedValue({ id: "cs_1", client_secret: "cs_secret" });
  search.mockResolvedValue({ data: [{ id: "cus_1" }] });
  customersCreate.mockResolvedValue({ id: "cus_new" });
  list.mockResolvedValue({
    data: [{ id: "price_1", lookup_key: "pro_monthly", type: "recurring", product: null }],
  });
});

describe("createAdhocCheckoutSession - flagi tenantu w sesji", () => {
  const base = {
    environment: "sandbox" as const,
    name: "Dostęp do treści",
    amountCents: 4900,
    currency: "PLN",
    orderId: "order-1",
    purpose: "content_unlock" as const,
    userId: "user-1",
    customerEmail: "buyer@example.com",
    returnUrl: "https://example.com/checkout/success",
  };

  it("płaszczyzna MoR: kupony, NIP i managed_payments, bez automatic_tax", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    const result = await createAdhocCheckoutSession({ ...base, settings: SETTINGS.managed });
    expect(result.ok).toBe(true);

    const payload = lastSessionPayload();
    expect(payload.allow_promotion_codes).toBe(true);
    expect(payload.tax_id_collection).toEqual({ enabled: true });
    expect(payload.managed_payments).toEqual({ enabled: true });
    expect(payload.billing_address_collection).toBe("auto");
    expect(payload.automatic_tax).toBeUndefined();
    expect(payload.invoice_creation).toBeUndefined();
    // Klient jest przypięty, więc customer_creation byłoby błędem API.
    expect(payload.customer_creation).toBeUndefined();
    expect(payload.customer_update).toEqual({ name: "auto" });
  });

  it("płaszczyzna sprzedawcy: automatic_tax + faktura, bez managed_payments", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    await createAdhocCheckoutSession({ ...base, settings: SETTINGS.merchant });

    const payload = lastSessionPayload();
    expect(payload.automatic_tax).toEqual({ enabled: true });
    expect(payload.invoice_creation).toEqual({ enabled: true });
    expect(payload.billing_address_collection).toBe("required");
    expect(payload.managed_payments).toBeUndefined();
    expect(payload.allow_promotion_codes).toBeUndefined();
  });

  it("brak ustawień -> bezpieczne domyślne, a nie pusta sesja", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    await createAdhocCheckoutSession(base);

    const payload = lastSessionPayload();
    expect(payload.managed_payments).toEqual({ enabled: true });
    expect(payload.allow_promotion_codes).toBe(true);
    expect(payload.tax_id_collection).toEqual({ enabled: true });
  });

  it("darowizna anonimowa bez klienta -> customer_creation=always dla NIP", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    await createAdhocCheckoutSession({
      ...base,
      purpose: "donation",
      userId: null,
      settings: SETTINGS.managed,
    });

    const payload = lastSessionPayload();
    expect(payload.customer).toBeUndefined();
    expect(payload.customer_creation).toBe("always");
    expect(payload.customer_update).toBeUndefined();
  });
});

describe("createPlanCheckoutSession - flagi tenantu w sesji", () => {
  const base = {
    environment: "sandbox" as const,
    priceLookupKey: "pro_monthly",
    planId: "plan-1",
    orderId: "order-2",
    userId: "user-1",
    customerEmail: "buyer@example.com",
    returnUrl: "https://example.com/checkout/success",
  };

  it("subskrypcja nie dostaje invoice_creation ani customer_creation", async () => {
    const { createPlanCheckoutSession } = await import("../adhocCheckout.server");
    const result = await createPlanCheckoutSession({ ...base, settings: SETTINGS.merchant });
    expect(result.ok).toBe(true);

    const payload = lastSessionPayload();
    expect(payload.mode).toBe("subscription");
    expect(payload.automatic_tax).toEqual({ enabled: true });
    expect(payload.invoice_creation).toBeUndefined();
    expect(payload.customer_creation).toBeUndefined();
  });

  it("rabat kuponu B2B wyłącza pole kodu promocyjnego", async () => {
    const { createPlanCheckoutSession } = await import("../adhocCheckout.server");
    await createPlanCheckoutSession({
      ...base,
      settings: SETTINGS.managed,
      discount: { coupon: "co_1" },
    });

    const payload = lastSessionPayload();
    expect(payload.discounts).toEqual([{ coupon: "co_1" }]);
    expect(payload.allow_promotion_codes).toBeUndefined();

    // Bez rabatu to samo ustawienie pokazuje pole kodu promocyjnego.
    await createPlanCheckoutSession({ ...base, settings: SETTINGS.managed });
    expect(lastSessionPayload().allow_promotion_codes).toBe(true);
  });
});
