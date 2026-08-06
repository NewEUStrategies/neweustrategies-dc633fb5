import { describe, it, expect } from "vitest";
import {
  checkoutBillingPlane,
  checkoutSessionParams,
  normalizeCheckoutSettings,
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSessionContext,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";

const ALL_ON: CheckoutSettings = {
  allow_promotion_codes: true,
  automatic_tax: true,
  tax_id_collection: true,
  billing_address_collection: "auto",
  invoice_creation: true,
};

const ALL_OFF: CheckoutSettings = {
  allow_promotion_codes: false,
  automatic_tax: false,
  tax_id_collection: false,
  billing_address_collection: "auto",
  invoice_creation: false,
};

/** Domyślny kontekst: zalogowany kupujący (klient przypięty), bez rabatu. */
const ctx = (over: Partial<CheckoutSessionContext> = {}): CheckoutSessionContext => ({
  mode: "payment",
  hasCustomer: true,
  hasDiscount: false,
  ...over,
});

describe("normalizeCheckoutSettings", () => {
  it("brak wiersza -> bezpieczne domyślne", () => {
    expect(normalizeCheckoutSettings(null)).toEqual(DEFAULT_CHECKOUT_SETTINGS);
    expect(normalizeCheckoutSettings(undefined)).toEqual(DEFAULT_CHECKOUT_SETTINGS);
  });

  it("nieznane wartości sprowadza do domyślnych", () => {
    const normalized = normalizeCheckoutSettings({
      allow_promotion_codes: "yes",
      automatic_tax: 1,
      tax_id_collection: null,
      billing_address_collection: "everywhere",
      invoice_creation: undefined,
    });
    expect(normalized).toEqual(DEFAULT_CHECKOUT_SETTINGS);
  });

  it("respektuje jawne wartości", () => {
    const normalized = normalizeCheckoutSettings({
      allow_promotion_codes: false,
      automatic_tax: true,
      tax_id_collection: false,
      billing_address_collection: "required",
      invoice_creation: false,
    });
    expect(normalized).toEqual({
      allow_promotion_codes: false,
      automatic_tax: true,
      tax_id_collection: false,
      billing_address_collection: "required",
      invoice_creation: false,
    });
  });
});

describe("checkoutBillingPlane", () => {
  it("domyślnie Stripe jako operator rozliczeniowy (MoR)", () => {
    expect(checkoutBillingPlane(DEFAULT_CHECKOUT_SETTINGS)).toBe("managed");
    expect(checkoutBillingPlane(ALL_OFF)).toBe("managed");
  });

  it("własny Stripe Tax przełącza na płaszczyznę sprzedawcy", () => {
    expect(checkoutBillingPlane({ ...ALL_OFF, automatic_tax: true })).toBe("merchant");
  });
});

describe("checkoutSessionParams", () => {
  it("wszystko wyłączone -> adres auto + tryb operatora rozliczeniowego", () => {
    expect(checkoutSessionParams(ALL_OFF, ctx())).toEqual({
      billing_address_collection: "auto",
      managed_payments: { enabled: true },
    });
    expect(checkoutSessionParams(ALL_OFF, ctx({ mode: "subscription" }))).toEqual({
      billing_address_collection: "auto",
      managed_payments: { enabled: true },
    });
  });

  it("domyślne ustawienia nie zmieniają dotychczasowego kształtu sesji", () => {
    // Regresja: przed okablowaniem flag każda sesja jechała wyłącznie z
    // `managed_payments`. Domyślne ustawienia dokładają tylko zbieranie NIP.
    expect(checkoutSessionParams(DEFAULT_CHECKOUT_SETTINGS, ctx())).toEqual({
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      managed_payments: { enabled: true },
      tax_id_collection: { enabled: true },
      customer_update: { name: "auto" },
    });
  });

  it("kody promocyjne trafiają do obu trybów", () => {
    expect(
      checkoutSessionParams({ ...ALL_OFF, allow_promotion_codes: true }, ctx())
        .allow_promotion_codes,
    ).toBe(true);
    expect(
      checkoutSessionParams(
        { ...ALL_OFF, allow_promotion_codes: true },
        ctx({ mode: "subscription" }),
      ).allow_promotion_codes,
    ).toBe(true);
  });

  it("rabat operatora wyklucza pole kodu promocyjnego (Stripe odrzuca tę parę)", () => {
    const params = checkoutSessionParams(
      { ...ALL_OFF, allow_promotion_codes: true },
      ctx({ hasDiscount: true }),
    );
    expect(params.allow_promotion_codes).toBeUndefined();
  });

  it("tax_id_collection bez klienta w trybie payment wymusza customer_creation", () => {
    const guest = checkoutSessionParams(
      { ...ALL_OFF, tax_id_collection: true },
      ctx({ hasCustomer: false }),
    );
    expect(guest.tax_id_collection).toEqual({ enabled: true });
    expect(guest.customer_creation).toBe("always");
    // Klient już przypięty - customer_creation byłoby błędem API.
    const known = checkoutSessionParams({ ...ALL_OFF, tax_id_collection: true }, ctx());
    expect(known.customer_creation).toBeUndefined();
    // Subskrypcja zawsze tworzy klienta - parametr byłby błędem API.
    const sub = checkoutSessionParams(
      { ...ALL_OFF, tax_id_collection: true },
      ctx({ mode: "subscription", hasCustomer: false }),
    );
    expect(sub.tax_id_collection).toEqual({ enabled: true });
    expect(sub.customer_creation).toBeUndefined();
  });

  it("przy istniejącym kliencie zbieranie NIP wymaga zgody na nadpisanie nazwy", () => {
    const params = checkoutSessionParams({ ...ALL_OFF, tax_id_collection: true }, ctx());
    expect(params.customer_update).toEqual({ name: "auto" });
    // Bez klienta nie ma czego aktualizować.
    expect(
      checkoutSessionParams({ ...ALL_OFF, tax_id_collection: true }, ctx({ hasCustomer: false }))
        .customer_update,
    ).toBeUndefined();
  });

  it("automatic_tax wymusza pełny adres i zgodę na nadpisanie adresu klienta", () => {
    const params = checkoutSessionParams(
      { ...ALL_OFF, automatic_tax: true },
      ctx({ mode: "subscription" }),
    );
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.billing_address_collection).toBe("required");
    expect(params.customer_update).toEqual({ address: "auto", name: "auto" });
  });

  it("automatic_tax i managed_payments nigdy nie jadą razem", () => {
    const merchant = checkoutSessionParams({ ...ALL_OFF, automatic_tax: true }, ctx());
    expect(merchant.automatic_tax).toEqual({ enabled: true });
    expect(merchant.managed_payments).toBeUndefined();

    const managed = checkoutSessionParams({ ...ALL_OFF, automatic_tax: false }, ctx());
    expect(managed.managed_payments).toEqual({ enabled: true });
    expect(managed.automatic_tax).toBeUndefined();
  });

  it("invoice_creation tylko w trybie payment i tylko na płaszczyźnie sprzedawcy", () => {
    const merchantPayment = checkoutSessionParams(
      { ...ALL_OFF, automatic_tax: true, invoice_creation: true },
      ctx(),
    );
    expect(merchantPayment.invoice_creation).toEqual({ enabled: true });

    const merchantSub = checkoutSessionParams(
      { ...ALL_OFF, automatic_tax: true, invoice_creation: true },
      ctx({ mode: "subscription" }),
    );
    expect(merchantSub.invoice_creation).toBeUndefined();

    // MoR wystawia fakturę sam - parametr sprzedawcy byłby zdublowaniem roli.
    const managed = checkoutSessionParams({ ...ALL_OFF, invoice_creation: true }, ctx());
    expect(managed.invoice_creation).toBeUndefined();
    expect(managed.managed_payments).toEqual({ enabled: true });
  });

  it("komplet flag w trybie payment składa się bez konfliktów", () => {
    const params = checkoutSessionParams(ALL_ON, ctx({ hasCustomer: false }));
    expect(params).toEqual({
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      customer_creation: "always",
      invoice_creation: { enabled: true },
      tax_id_collection: { enabled: true },
    });
    expect(params.managed_payments).toBeUndefined();
  });

  it("jawne billing_address_collection=required jest respektowane bez podatku", () => {
    const params = checkoutSessionParams(
      { ...ALL_OFF, billing_address_collection: "required" },
      ctx(),
    );
    expect(params.billing_address_collection).toBe("required");
  });
});
