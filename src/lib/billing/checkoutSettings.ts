// Ustawienia checkoutu (kupony / Stripe Tax / NIP / faktury) - część czysta,
// współdzielona przez serwerowe budowanie sesji Stripe i przez UI. Bez importu
// klienta Supabase i bez SDK Stripe, żeby moduł był w pełni unit-testowalny i
// bezpieczny dla obu środowisk (wchodzi też do bundla przeglądarki).
//
// Autorytetem jest tabela `checkout_settings` (jeden wiersz na tenant, PK =
// `tenant_id`). Odczyt serwerowy: `checkoutSettings.server.ts`; odczyt kliencki:
// `hooks/useCheckoutSettings.ts`. Mapowanie na parametry sesji Stripe żyje
// WYŁĄCZNIE tutaj (`checkoutSessionParams`), żeby wszystkie ścieżki checkoutu -
// plan z katalogu, odblokowanie treści, bilet, darowizna - składały sesję
// identycznie.

// Kolumny czytane przez obie warstwy - jedno źródło prawdy dla `select()`.
// `as const` jest istotne: typowany klient Supabase parsuje literał zapytania,
// żeby wyprowadzić kształt wiersza.
export const CHECKOUT_SETTINGS_COLUMNS =
  "allow_promotion_codes, automatic_tax, tax_id_collection, billing_address_collection, invoice_creation" as const;

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
 * Płaszczyzna rozliczeniowa sesji - kto liczy podatek i wystawia dokument:
 *
 *  - `managed` (domyślna): Stripe jako operator rozliczeniowy (Merchant of
 *    Record, `managed_payments`). Stripe ustala jurysdykcję, nalicza podatek i
 *    sam wystawia fakturę - patrz `invoice.server.ts` ("faktury nie są
 *    przechowywane u nas"). W tej płaszczyźnie NIE wolno wysłać
 *    `automatic_tax` ani `invoice_creation`: to parametry silnika podatkowego i
 *    fakturowania SPRZEDAWCY, więc dublowałyby rolę operatora.
 *
 *  - `merchant`: sprzedawca przejmuje podatek (Stripe Tax na własnym koncie),
 *    więc `managed_payments` znika z sesji, a `automatic_tax` i - dla płatności
 *    jednorazowych - `invoice_creation` trafiają do Stripe.
 *
 * Przełącznikiem jest `automatic_tax`: włączenie własnego silnika podatkowego
 * jest jedyną deklaracją, która wyklucza tryb MoR. Domyślne ustawienia
 * (`automatic_tax: false`) zostawiają płaszczyznę `managed` - dokładnie to,
 * czym sesje jeżdżą dziś.
 */
export type CheckoutBillingPlane = "managed" | "merchant";

export function checkoutBillingPlane(settings: CheckoutSettings): CheckoutBillingPlane {
  return settings.automatic_tax ? "merchant" : "managed";
}

/** Kontekst sesji, którego same ustawienia nie znają (wynika ze ścieżki zakupu). */
export interface CheckoutSessionContext {
  /** Tryb sesji Stripe - wyprowadzony z typu ceny / rodzaju zamówienia. */
  mode: "payment" | "subscription";
  /** Sesja ma już przypiętego klienta (`customer`). */
  hasCustomer: boolean;
  /** Sesja niesie rabat operatora (`discounts`) - np. kupon B2B. */
  hasDiscount: boolean;
}

/**
 * Fragment `Stripe.Checkout.SessionCreateParams` wynikający z ustawień tenantu.
 * Kształt celowo opisany lokalnie (moduł nie importuje SDK), a zgodność z API
 * pilnuje kompilator w miejscu rozwinięcia - `adhocCheckout.server.ts`.
 * `managed_payments` należy do preview API i nie ma go jeszcze w typach SDK,
 * stąd rozszerzenie po stronie serwera.
 */
export interface CheckoutSessionParams {
  allow_promotion_codes?: boolean;
  automatic_tax?: { enabled: boolean };
  billing_address_collection: "auto" | "required";
  customer_creation?: "always";
  customer_update?: { address?: "auto"; name?: "auto" };
  invoice_creation?: { enabled: boolean };
  managed_payments?: { enabled: boolean };
  tax_id_collection?: { enabled: boolean };
}

/**
 * Ustawienia tenantu -> parametry sesji Stripe Checkout. Czysta funkcja, jedyne
 * miejsce, w którym rozstrzygamy zależności wymuszone przez API Stripe:
 *
 *  1. `allow_promotion_codes` i `discounts` wykluczają się - sesja z rabatem
 *     operatora (kupon B2B) nie może jednocześnie pokazywać pola na kod
 *     promocyjny, bo Stripe odrzuca taką parę. Rabat już policzony wygrywa.
 *  2. `customer_creation` wolno podać tylko w trybie `payment` i tylko gdy
 *     sesja NIE ma jeszcze klienta - inaczej Stripe zwraca błąd. Klient jest
 *     potrzebny, gdy sesja ma zapisać NIP, policzyć podatek albo wystawić
 *     fakturę, więc te trzy flagi go wymuszają (gość -> `always`).
 *  3. Przy JUŻ przypiętym kliencie Stripe wymaga zgody na nadpisanie jego
 *     danych tym, co kupujący wpisze w Checkout: `customer_update.address` dla
 *     `automatic_tax` (adres ustala jurysdykcję) i `customer_update.name` dla
 *     `tax_id_collection` (nazwa firmy trafia na fakturę).
 *  4. `automatic_tax` potrzebuje adresu do ustalenia jurysdykcji - wymuszamy
 *     `billing_address_collection=required`.
 *  5. `invoice_creation` dotyczy WYŁĄCZNIE trybu `payment` (subskrypcje mają
 *     faktury zawsze) - wysłanie go w trybie `subscription` to błąd API.
 *  6. Płaszczyzna rozliczeniowa (patrz `checkoutBillingPlane`) rozstrzyga
 *     `managed_payments` vs `automatic_tax`/`invoice_creation` - nigdy razem.
 */
export function checkoutSessionParams(
  settings: CheckoutSettings,
  context: CheckoutSessionContext,
): CheckoutSessionParams {
  const plane = checkoutBillingPlane(settings);
  const managed = plane === "managed";

  // (6) Na płaszczyźnie MoR podatek i faktura należą do operatora, więc obie
  // flagi sprzedawcy są wygaszone jeszcze przed złożeniem parametrów.
  const automaticTax = !managed && settings.automatic_tax;
  const invoiceCreation =
    !managed && settings.invoice_creation && context.mode === "payment"; /* (5) */

  // (2) Sesja musi mieć klienta, żeby zapisać NIP, policzyć podatek albo
  // powiązać fakturę. W trybie `subscription` Stripe tworzy go zawsze sam.
  const needsCustomer = settings.tax_id_collection || automaticTax || invoiceCreation;

  const params: CheckoutSessionParams = {
    // (4) Adres wymagany, gdy podatek liczymy sami albo gdy operator tak chce.
    billing_address_collection:
      automaticTax || settings.billing_address_collection === "required" ? "required" : "auto",
  };

  // (1) Pole kodu promocyjnego tylko wtedy, gdy sesja nie niesie już rabatu.
  if (settings.allow_promotion_codes && !context.hasDiscount) {
    params.allow_promotion_codes = true;
  }

  if (context.mode === "payment" && needsCustomer && !context.hasCustomer) {
    params.customer_creation = "always";
  }

  if (automaticTax) params.automatic_tax = { enabled: true };
  if (settings.tax_id_collection) params.tax_id_collection = { enabled: true };
  if (invoiceCreation) params.invoice_creation = { enabled: true };
  if (managed) params.managed_payments = { enabled: true };

  // (3) Zgoda na nadpisanie danych istniejącego klienta danymi z Checkoutu.
  if (context.hasCustomer) {
    const customerUpdate: { address?: "auto"; name?: "auto" } = {};
    if (automaticTax) customerUpdate.address = "auto";
    if (automaticTax || settings.tax_id_collection) customerUpdate.name = "auto";
    if (customerUpdate.address || customerUpdate.name) params.customer_update = customerUpdate;
  }

  return params;
}
