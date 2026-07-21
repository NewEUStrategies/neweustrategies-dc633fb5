import { describe, it, expect } from "vitest";
import {
  checkoutSessionExtraParams,
  normalizeCheckoutSettings,
  DEFAULT_CHECKOUT_SETTINGS,
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

function toMap(pairs: Array<[string, string]>): Map<string, string> {
  return new Map(pairs);
}

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

describe("checkoutSessionExtraParams", () => {
  it("wszystko wyłączone -> tylko adres w trybie auto", () => {
    expect(checkoutSessionExtraParams(ALL_OFF, "payment")).toEqual([
      ["billing_address_collection", "auto"],
    ]);
    expect(checkoutSessionExtraParams(ALL_OFF, "subscription")).toEqual([
      ["billing_address_collection", "auto"],
    ]);
  });

  it("kody promocyjne trafiają do obu trybów", () => {
    const payment = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, allow_promotion_codes: true }, "payment"),
    );
    const sub = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, allow_promotion_codes: true }, "subscription"),
    );
    expect(payment.get("allow_promotion_codes")).toBe("true");
    expect(sub.get("allow_promotion_codes")).toBe("true");
  });

  it("tax_id_collection w trybie payment wymusza customer_creation=always", () => {
    const payment = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, tax_id_collection: true }, "payment"),
    );
    expect(payment.get("tax_id_collection[enabled]")).toBe("true");
    expect(payment.get("customer_creation")).toBe("always");
    // Subskrypcja zawsze tworzy klienta - parametr byłby błędem API.
    const sub = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, tax_id_collection: true }, "subscription"),
    );
    expect(sub.get("tax_id_collection[enabled]")).toBe("true");
    expect(sub.has("customer_creation")).toBe(false);
  });

  it("automatic_tax wymusza pełny adres rozliczeniowy", () => {
    const params = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, automatic_tax: true }, "subscription"),
    );
    expect(params.get("automatic_tax[enabled]")).toBe("true");
    expect(params.get("billing_address_collection")).toBe("required");
  });

  it("invoice_creation tylko dla trybu payment", () => {
    const payment = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, invoice_creation: true }, "payment"),
    );
    const sub = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, invoice_creation: true }, "subscription"),
    );
    expect(payment.get("invoice_creation[enabled]")).toBe("true");
    expect(sub.has("invoice_creation[enabled]")).toBe(false);
  });

  it("komplet flag w trybie payment składa się bez konfliktów", () => {
    const params = toMap(checkoutSessionExtraParams(ALL_ON, "payment"));
    expect(params.get("allow_promotion_codes")).toBe("true");
    expect(params.get("customer_creation")).toBe("always");
    expect(params.get("automatic_tax[enabled]")).toBe("true");
    expect(params.get("tax_id_collection[enabled]")).toBe("true");
    expect(params.get("billing_address_collection")).toBe("required");
    expect(params.get("invoice_creation[enabled]")).toBe("true");
  });

  it("jawne billing_address_collection=required jest respektowane bez podatku", () => {
    const params = toMap(
      checkoutSessionExtraParams({ ...ALL_OFF, billing_address_collection: "required" }, "payment"),
    );
    expect(params.get("billing_address_collection")).toBe("required");
  });
});
