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
  getStripeClient: () => ({
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

  it("płaszczyzna MoR: kupony i managed_payments, bez automatic_tax i NIP", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    const result = await createAdhocCheckoutSession({ ...base, settings: SETTINGS.managed });
    expect(result.ok).toBe(true);

    const payload = lastSessionPayload();
    expect(payload.allow_promotion_codes).toBe(true);
    expect(payload.tax_id_collection).toBeUndefined();
    expect(payload.managed_payments).toEqual({ enabled: true });
    expect(payload.billing_address_collection).toBe("auto");
    expect(payload.automatic_tax).toBeUndefined();
    expect(payload.invoice_creation).toBeUndefined();
    // Klient jest przypięty, więc customer_creation byłoby błędem API.
    expect(payload.customer_creation).toBeUndefined();
    expect(payload.customer_update).toBeUndefined();
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
    expect(payload.tax_id_collection).toBeUndefined();
  });

  // ZMIANA: ten test podawał bilet z ustawieniami, w których WOŁAJĄCY już
  // wyłączył pole kodu („tak woła kasa"). Reguła zależała więc od każdego
  // wołającego z osobna - a server fn ad-hoc (`buildAdhocOrder`) podawał
  // ustawienia tenantu bez zmian i jego sesja biletu miała pole kodu Stripe.
  // Dziś regułę egzekwuje sam budowniczy sesji, więc dowodzimy jej na tenancie,
  // który pole kodu WŁĄCZA.
  it("bilet NIE dostaje pola kodu Stripe, nawet gdy tenant je włącza", async () => {
    // Kod wpisany w nakładce operatora schodziłby RAZ z całej sesji, z pominięciem
    // zakresu wydarzenia, rozbicia na miejsca i limitu użyć.
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    await createAdhocCheckoutSession({
      ...base,
      purpose: "event_ticket",
      quantity: 3,
      amountCents: 10000,
      settings: SETTINGS.managed,
    });
    const payload = lastSessionPayload();
    expect(payload.allow_promotion_codes).toBeUndefined();
    // Reszta flag tenantu jedzie bez zmian - wyłączamy JEDNO pole, nie ustawienia.
    expect(payload.managed_payments).toEqual({ enabled: true });
    expect(payload.billing_address_collection).toBe("auto");
  });

  it("bilet BEZ ustawień tenantu też nie dostaje pola kodu (domyślne je włączają)", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    await createAdhocCheckoutSession({ ...base, purpose: "event_ticket" });

    const payload = lastSessionPayload();
    expect(payload.allow_promotion_codes).toBeUndefined();
    // Bezpieczne domyślne zostają domyślnymi - poza polem kodu.
    expect(payload.managed_payments).toEqual({ enabled: true });
    expect(payload.tax_id_collection).toBeUndefined();
  });

  it("bilet na płaszczyźnie sprzedawcy: bez pola kodu, z podatkiem i fakturą tenantu", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    await createAdhocCheckoutSession({
      ...base,
      purpose: "event_ticket",
      settings: { ...SETTINGS.merchant, allow_promotion_codes: true },
    });

    const payload = lastSessionPayload();
    expect(payload.allow_promotion_codes).toBeUndefined();
    expect(payload.automatic_tax).toEqual({ enabled: true });
    expect(payload.invoice_creation).toEqual({ enabled: true });
  });

  it.each([["content_unlock" as const], ["donation" as const]])(
    "%s z tym samym tenantem ZOSTAJE przy polu kodu Stripe",
    async (purpose) => {
      const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
      await createAdhocCheckoutSession({ ...base, purpose, settings: SETTINGS.managed });
      expect(lastSessionPayload().allow_promotion_codes).toBe(true);

      // Bez ustawień - domyślne, które pole kodu włączają.
      await createAdhocCheckoutSession({ ...base, purpose });
      expect(lastSessionPayload().allow_promotion_codes).toBe(true);
    },
  );

  it("darowizna anonimowa na płaszczyźnie MoR nie tworzy klienta sprzedawcy", async () => {
    const { createAdhocCheckoutSession } = await import("../adhocCheckout.server");
    await createAdhocCheckoutSession({
      ...base,
      purpose: "donation",
      userId: null,
      settings: SETTINGS.managed,
    });

    const payload = lastSessionPayload();
    expect(payload.customer).toBeUndefined();
    expect(payload.customer_creation).toBeUndefined();
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
