// Profil podatkowy biletu i pakietu w panelu (TIX-09): stawka VAT na fakturze,
// podstawa zwolnienia i kod podatkowy produktu Stripe.
//
// JEDEN SZKIC DLA OBU OKIEN. Bilet zapisuje profil osobnym RPC
// (`admin_event_ticket_set_tax_profile`), pakiet - kluczami ładunku
// `admin_event_package_upsert`; reguły pól są te same co CHECK-i obu tabel
// (migracja `20261012130200`), więc żyją w jednym miejscu.
//
// ZA DŁUGA PODSTAWA TO ODMOWA, NIE PRZYCIĘCIE. Baza odmawia podstawy dłuższej
// niż 300 znaków (`invalid_exempt_basis`); pole nie ucina wklejonego tekstu
// (`maxLength` uciąłby go po cichu), tylko mówi, ile znaków trzeba skrócić -
// tak, żeby na fakturze stało dokładnie to, co redaktor widzi w polu.
import { EVENT_INVOICE_VAT_RATES, type EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";

/** Limit podstawy zwolnienia - CHECK `*_vat_exempt_basis_len`. */
export const TAX_EXEMPT_BASIS_MAX = 300;

/** Kod podatkowy produktu Stripe - CHECK `*_stripe_tax_code_shape`. */
export const STRIPE_TAX_CODE_PATTERN = /^txcd_[0-9]{8}$/;

/**
 * Wartość droplisty stawki. `default` = brak własnej stawki (`NULL` w bazie):
 * bilet bierze domyślną stawkę organizatora, pakiet - stawkę swojego biletu.
 */
export type TaxRateChoice = "default" | EventInvoiceVatRate;

export const TAX_RATE_CHOICES: readonly TaxRateChoice[] = ["default", ...EVENT_INVOICE_VAT_RATES];

export interface TaxProfileDraft {
  vatRate: TaxRateChoice;
  vatExemptBasis: string;
  stripeTaxCode: string;
}

export const EMPTY_TAX_PROFILE: TaxProfileDraft = {
  vatRate: "default",
  vatExemptBasis: "",
  stripeTaxCode: "",
};

export type TaxProfileField = "vatExemptBasis" | "stripeTaxCode";

/** Błędy pól profilu (puste = poprawny). */
export type TaxProfileIssues = Partial<Record<TaxProfileField, true>>;

function normalizedTaxCode(value: string): string {
  return value.trim().toLowerCase();
}

/** Ile znaków ma podstawa po przycięciu brzegów - tak liczy ją baza (`btrim`). */
export function exemptBasisLength(draft: Pick<TaxProfileDraft, "vatExemptBasis">): number {
  return draft.vatExemptBasis.trim().length;
}

export function taxProfileIssues(draft: TaxProfileDraft): TaxProfileIssues {
  const issues: TaxProfileIssues = {};
  if (exemptBasisLength(draft) > TAX_EXEMPT_BASIS_MAX) issues.vatExemptBasis = true;
  const code = normalizedTaxCode(draft.stripeTaxCode);
  if (code !== "" && !STRIPE_TAX_CODE_PATTERN.test(code)) issues.stripeTaxCode = true;
  return issues;
}

function isRate(value: unknown): value is EventInvoiceVatRate {
  return (
    typeof value === "string" && (EVENT_INVOICE_VAT_RATES as readonly string[]).includes(value)
  );
}

/** Wiersz z `admin_event_ticket_tax_profile` / `admin_event_package_terms` -> szkic. */
export function taxProfileFromRow(
  row:
    | { vat_rate?: unknown; vat_exempt_basis?: unknown; stripe_tax_code?: unknown }
    | null
    | undefined,
): TaxProfileDraft {
  if (row === null || row === undefined) return EMPTY_TAX_PROFILE;
  return {
    vatRate: isRate(row.vat_rate) ? row.vat_rate : "default",
    vatExemptBasis: typeof row.vat_exempt_basis === "string" ? row.vat_exempt_basis : "",
    stripeTaxCode: typeof row.stripe_tax_code === "string" ? row.stripe_tax_code : "",
  };
}

export interface TaxProfilePayload {
  vat_rate: EventInvoiceVatRate | null;
  vat_exempt_basis: string;
  stripe_tax_code: string | null;
}

/** Szkic -> ładunek RPC. Wołający sprawdza wcześniej `taxProfileIssues`. */
export function taxProfileToPayload(draft: TaxProfileDraft): TaxProfilePayload {
  const code = normalizedTaxCode(draft.stripeTaxCode);
  return {
    vat_rate: draft.vatRate === "default" ? null : draft.vatRate,
    vat_exempt_basis: draft.vatExemptBasis.trim(),
    stripe_tax_code: code === "" ? null : code,
  };
}
