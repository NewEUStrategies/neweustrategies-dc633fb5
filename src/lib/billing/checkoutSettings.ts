// Ustawienia checkoutu (kupony / Stripe Tax / NIP / faktury) - część czysta,
// współdzielona przez serwerową funkcję checkoutu i UI. Bez importu klienta
// Supabase, żeby była w pełni unit-testowalna i bezpieczna dla obu środowisk.

export interface CheckoutSettings {
  allow_promotion_codes: boolean;
  automatic_tax: boolean;
  tax_id_collection: boolean;
  billing_address_collection: "auto" | "required";
  invoice_creation: boolean;
}

/** Zachowanie przy braku wiersza ustawień - bezpieczne, konserwatywne domyślne. */
export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  allow_promotion_codes: true,
  automatic_tax: false,
  tax_id_collection: true,
  billing_address_collection: "auto",
  invoice_creation: true,
};

export function normalizeCheckoutSettings(
  row: Partial<Record<keyof CheckoutSettings, unknown>> | null | undefined,
): CheckoutSettings {
  if (!row) return DEFAULT_CHECKOUT_SETTINGS;
  const addr = row.billing_address_collection;
  return {
    allow_promotion_codes:
      typeof row.allow_promotion_codes === "boolean"
        ? row.allow_promotion_codes
        : DEFAULT_CHECKOUT_SETTINGS.allow_promotion_codes,
    automatic_tax:
      typeof row.automatic_tax === "boolean"
        ? row.automatic_tax
        : DEFAULT_CHECKOUT_SETTINGS.automatic_tax,
    tax_id_collection:
      typeof row.tax_id_collection === "boolean"
        ? row.tax_id_collection
        : DEFAULT_CHECKOUT_SETTINGS.tax_id_collection,
    billing_address_collection: addr === "required" ? "required" : "auto",
    invoice_creation:
      typeof row.invoice_creation === "boolean"
        ? row.invoice_creation
        : DEFAULT_CHECKOUT_SETTINGS.invoice_creation,
  };
}

/**
 * Parametry Stripe Checkout Session wynikające z ustawień tenantu - czysta
 * funkcja zwracająca pary klucz/wartość do dopisania do form-encoded body
 * (konwencja repo: żadnego SDK Stripe, surowe URLSearchParams).
 *
 * Zależności między parametrami (wymogi API Stripe):
 *  - tax_id_collection i automatic_tax w trybie "payment" wymagają
 *    customer_creation=always (inaczej sesja nie ma klienta, na którym
 *    można zapisać NIP / policzyć podatek);
 *  - automatic_tax potrzebuje adresu do ustalenia jurysdykcji - wymuszamy
 *    billing_address_collection=required, gdy podatek jest automatyczny;
 *  - invoice_creation dotyczy WYŁĄCZNIE trybu "payment" (subskrypcje mają
 *    faktury zawsze) - wysłanie go w trybie "subscription" to błąd API.
 */
export function checkoutSessionExtraParams(
  settings: CheckoutSettings,
  mode: "payment" | "subscription",
): Array<[string, string]> {
  const params: Array<[string, string]> = [];

  if (settings.allow_promotion_codes) {
    params.push(["allow_promotion_codes", "true"]);
  }

  const needsCustomer = settings.tax_id_collection || settings.automatic_tax;
  if (mode === "payment" && needsCustomer) {
    params.push(["customer_creation", "always"]);
  }

  if (settings.automatic_tax) {
    params.push(["automatic_tax[enabled]", "true"]);
  }

  if (settings.tax_id_collection) {
    params.push(["tax_id_collection[enabled]", "true"]);
  }

  const address =
    settings.automatic_tax || settings.billing_address_collection === "required"
      ? "required"
      : "auto";
  params.push(["billing_address_collection", address]);

  if (mode === "payment" && settings.invoice_creation) {
    params.push(["invoice_creation[enabled]", "true"]);
  }

  return params;
}
