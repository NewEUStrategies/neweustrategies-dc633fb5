// Arytmetyka faktur wydarzen - LUSTRO obliczen bazy do podgladu na zywo.
//
// AUTORYTETEM JEST BAZA. Sumy dokumentu liczy `_event_invoice_recalc`
// (migracja 20260926110000), a pozycje `_event_invoice_add_line`. Ten modul
// istnieje po to, zeby edytor szkicu pokazywal netto/VAT/brutto i
// podsumowanie stawek ZANIM organizator zapisze zmiane - i zeby pokazywal
// DOKLADNIE te same grosze, ktore potem wydrukuje dokument. Dlatego nie ma
// tu ani jednej operacji zmiennoprzecinkowej: netto z brutto liczymy wzorem
// calkowitym, identycznym z SQL-em, a te same wektory sprawdzaja vitest
// (`eventInvoiceMath.test.ts`) i harness (`27_invoices.sql`).
//
// REGULA ZAOKRAGLENIA. Kwota zaplacona jest BRUTTO. Netto pozycji =
// zaokraglenie polowkowe OD ZERA z brutto * 100 / (100 + stawka), liczone na
// POZYCJI (nie na sztuce), VAT = brutto - netto. Symetria wzgledem zera jest
// potrzebna korekcie: pozycja odwracajaca (-2 szt.) ma dokladnie przeciwne
// netto i VAT niz pozycja, ktora odwraca.

/** Stawki VAT pozycji - ten sam zbior co CHECK `event_invoice_lines_vat_rate_values`. */
export const EVENT_INVOICE_VAT_RATES = ["23", "8", "5", "0", "zw", "np"] as const;
export type EventInvoiceVatRate = (typeof EVENT_INVOICE_VAT_RATES)[number];

export function isEventInvoiceVatRate(value: string): value is EventInvoiceVatRate {
  return (EVENT_INVOICE_VAT_RATES as readonly string[]).includes(value);
}

/** Procent stawki; 0, `zw` (zwolniona) i `np` (nie podlega) = 0. */
export function vatPercent(rate: EventInvoiceVatRate): number {
  if (rate === "23") return 23;
  if (rate === "8") return 8;
  if (rate === "5") return 5;
  return 0;
}

/** Netto z brutto w groszach - wzor calkowity blizniaczy do `_event_invoice_net_from_gross`. */
export function netFromGross(grossCents: number, rate: EventInvoiceVatRate): number {
  const divisor = 100 + vatPercent(rate);
  const magnitude = Math.floor((2 * Math.abs(grossCents) * 100 + divisor) / (2 * divisor));
  return grossCents < 0 ? -magnitude : magnitude;
}

export interface EventInvoiceLineAmounts {
  grossCents: number;
  netCents: number;
  vatCents: number;
  unitNetCents: number;
}

/** Wartosci pozycji: ilosc x cena brutto, netto i VAT liczone na pozycji. */
export function lineAmounts(
  quantity: number,
  unitGrossCents: number,
  rate: EventInvoiceVatRate,
): EventInvoiceLineAmounts {
  const grossCents = quantity * unitGrossCents;
  const netCents = netFromGross(grossCents, rate);
  return {
    grossCents,
    netCents,
    vatCents: grossCents - netCents,
    unitNetCents: netFromGross(unitGrossCents, rate),
  };
}

export interface EventInvoiceUnits {
  quantity: number;
  unitGrossCents: number;
}

/**
 * Kwota zamowienia na miejsca: jedna pozycja, gdy dzieli sie rowno, inaczej
 * dwie (n-r po u oraz r po u+1 grosza) - zeby ilosc x cena = wartosc.
 * Lustro petli jednostek w `_event_invoice_draft_build`.
 */
export function splitSourceUnits(grossCents: number, seats: number): EventInvoiceUnits[] {
  const unit = Math.floor(grossCents / seats);
  const rest = grossCents - unit * seats;
  if (rest === 0) return [{ quantity: seats, unitGrossCents: unit }];
  return [
    { quantity: seats - rest, unitGrossCents: unit },
    { quantity: rest, unitGrossCents: unit + 1 },
  ];
}

export interface EventInvoiceAmountLine {
  vatRate: EventInvoiceVatRate;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface EventInvoiceTotals {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** Sumy dokumentu = sumy pozycji (tak jak `_event_invoice_recalc`). */
export function invoiceTotals(lines: readonly EventInvoiceAmountLine[]): EventInvoiceTotals {
  return lines.reduce<EventInvoiceTotals>(
    (sum, line) => ({
      netCents: sum.netCents + line.netCents,
      vatCents: sum.vatCents + line.vatCents,
      grossCents: sum.grossCents + line.grossCents,
    }),
    { netCents: 0, vatCents: 0, grossCents: 0 },
  );
}

export interface EventInvoiceVatSummaryRow extends EventInvoiceTotals {
  vatRate: EventInvoiceVatRate;
}

/** Podsumowanie wg stawek w kolejnosci `EVENT_INVOICE_VAT_RATES` (tylko obecne stawki). */
export function vatSummary(lines: readonly EventInvoiceAmountLine[]): EventInvoiceVatSummaryRow[] {
  return EVENT_INVOICE_VAT_RATES.flatMap((rate) => {
    const group = lines.filter((line) => line.vatRate === rate);
    return group.length === 0 ? [] : [{ vatRate: rate, ...invoiceTotals(group) }];
  });
}
