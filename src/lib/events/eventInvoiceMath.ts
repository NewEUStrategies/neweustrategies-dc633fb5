// Arytmetyka faktur wydarzen - LUSTRO obliczen bazy do podgladu na zywo.
//
// AUTORYTETEM JEST BAZA. Sumy dokumentu liczy `_event_invoice_recalc`
// (migracja 20260927000200), a pozycje `_event_invoice_add_line`. Ten modul
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
//
// O KWOCIE PODATKU DECYDUJE PODSUMOWANIE STAWEK (INV-16, migracja
// 20261012100100): metoda "od brutto" z art. 106e ust. 7 i 8 ustawy o VAT -
// netto w stawce z SUMY wartosci brutto tej stawki, a nie suma netto pozycji
// (te rozjezdzaly sie o grosze przy wielu pozycjach w jednej stawce). Netto
// pozycji zostaje podstawa liczenia stanu po korektach; dokument drukuje
// pozycje w brutto. Korekta pokazuje roznice stanu w stawce (po - przed).

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

/** Sumy dokumentu = sumy wierszy podsumowania stawek (tak jak `_event_invoice_recalc`). */
export function invoiceTotals(lines: readonly EventInvoiceTotals[]): EventInvoiceTotals {
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

/** Suma brutto w stawce stanu PRZED korekta (faktura + wystawione korekty). */
export type EventInvoiceRateGross = Partial<Record<EventInvoiceVatRate, number>>;

/**
 * Podsumowanie wg stawek w kolejnosci `EVENT_INVOICE_VAT_RATES` (tylko stawki
 * obecne w pozycjach) - lustro `_event_invoice_vat_summary`. Netto w stawce
 * liczone OD SUMY brutto; dla korekty (`before` = brutto stanu przed nia)
 * wiersz to roznica: netto(przed + korekta) - netto(przed).
 */
export function vatSummary(
  lines: readonly EventInvoiceAmountLine[],
  before: EventInvoiceRateGross = {},
): EventInvoiceVatSummaryRow[] {
  return EVENT_INVOICE_VAT_RATES.flatMap((rate) => {
    const group = lines.filter((line) => line.vatRate === rate);
    if (group.length === 0) return [];
    const grossBefore = before[rate] ?? 0;
    const grossAfter = grossBefore + group.reduce((sum, line) => sum + line.grossCents, 0);
    const netBefore = netFromGross(grossBefore, rate);
    const netAfter = netFromGross(grossAfter, rate);
    const netCents = netAfter - netBefore;
    const grossCents = grossAfter - grossBefore;
    return [{ vatRate: rate, netCents, vatCents: grossCents - netCents, grossCents }];
  });
}

/**
 * Kwota w walucie -> PLN po kursie NBP (`rate` = PLN za jednostke, najwyzej 4
 * miejsca po przecinku), zaokraglenie polowkowe od zera do grosza. Lustro
 * `_event_invoice_pln`: arytmetyka na BigInt, bo grosze x kurs x 10^4
 * wychodza poza bezpieczny zakres liczb calkowitych `number`.
 */
export function amountInPln(cents: number, rate: number): number {
  const scaled = BigInt(Math.round(rate * 10_000));
  const value = BigInt(Math.trunc(cents));
  const magnitude = (2n * (value < 0n ? -value : value) * scaled + 10_000n) / 20_000n;
  return Number(value < 0n ? -magnitude : magnitude);
}
