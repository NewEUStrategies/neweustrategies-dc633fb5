// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// BRAMKA: zamkniete zbiory modulu faktur wydarzen (TS) = CHECK-i migracji.
// Kolumny slownikowe sa `text` + `CHECK (kolumna IN (...))`, wiec typ
// generowany to `string` - kompilator nie zobaczy, ze panel oferuje rodzaj,
// stan KSeF albo stawke, ktorej baza nie przyjmie, ani ze pomija wartosc,
// ktora baza juz zwraca (surowa sciezka i18n w odznace). Obie strony czytamy
// z plikow: migracja jest jedynym zrodlem prawdy o CHECK-ach.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EVENT_INVOICE_CORRECTION_MODES,
  EVENT_INVOICE_KINDS,
  EVENT_INVOICE_KSEF_STATUSES,
  EVENT_INVOICE_LOCALES,
  EVENT_INVOICE_PAYMENT_METHODS,
  EVENT_INVOICE_REQUEST_STATUSES,
  EVENT_INVOICE_SOURCE_KINDS,
  EVENT_INVOICE_STATUSES,
  pickEnum,
} from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES } from "@/lib/events/eventInvoiceMath";

const SUPABASE = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260926110000_event_invoices.sql"),
  "utf8",
);
const DRIZZLE = readFileSync(
  join(process.cwd(), "drizzle", "migrations", "0058_event_invoices.sql"),
  "utf8",
);

/** Wartosci z `CONSTRAINT <nazwa> CHECK (... IN ('a', 'b'))` - wycinek po indeksie. */
function checkValues(sql: string, constraint: string): string[] {
  const at = sql.indexOf(`CONSTRAINT ${constraint}`);
  if (at === -1) throw new Error(`Brak ograniczenia ${constraint} w migracji faktur`);
  const slice = sql.slice(at, sql.indexOf(")", sql.indexOf("IN (", at)) + 1);
  const list = slice.slice(slice.indexOf("IN (") + 4, -1);
  return [...list.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

const PAIRS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["event_invoices_kind_values", EVENT_INVOICE_KINDS],
  ["event_invoices_status_values", EVENT_INVOICE_STATUSES],
  ["event_invoices_ksef_status_values", EVENT_INVOICE_KSEF_STATUSES],
  ["event_invoices_payment_method_values", EVENT_INVOICE_PAYMENT_METHODS],
  ["event_invoices_locale_values", EVENT_INVOICE_LOCALES],
  ["event_invoices_correction_mode_values", EVENT_INVOICE_CORRECTION_MODES],
  ["event_invoice_requests_status_values", EVENT_INVOICE_REQUEST_STATUSES],
  ["event_invoice_requests_source_kind_values", EVENT_INVOICE_SOURCE_KINDS],
  ["event_invoice_sources_source_kind_values", EVENT_INVOICE_SOURCE_KINDS],
  ["event_invoice_lines_vat_rate_values", EVENT_INVOICE_VAT_RATES],
  ["event_invoice_settings_default_vat_rate_values", EVENT_INVOICE_VAT_RATES],
  ["event_invoice_settings_default_locale_values", EVENT_INVOICE_LOCALES],
];

describe("parytet zbiorow faktur z CHECK-ami migracji 20260926110000", () => {
  it.each(PAIRS)("%s", (constraint, values) => {
    expect(checkValues(SUPABASE, constraint)).toEqual([...values]);
    expect(checkValues(DRIZZLE, constraint)).toEqual([...values]);
  });

  it("wycinek umie odmowic (nieznane ograniczenie to blad, nie pusta lista)", () => {
    expect(() => checkValues(SUPABASE, "event_invoices_nope_values")).toThrow(/Brak ograniczenia/);
  });
});

describe("pickEnum", () => {
  it("wartosc ze zbioru przechodzi", () => {
    expect(pickEnum(EVENT_INVOICE_KSEF_STATUSES, "accepted")).toBe("accepted");
  });

  it("nieznana wartosc, inny typ i brak = pierwsza z listy", () => {
    expect(pickEnum(EVENT_INVOICE_KINDS, "receipt")).toBe("invoice");
    expect(pickEnum(EVENT_INVOICE_KINDS, 3)).toBe("invoice");
    expect(pickEnum(EVENT_INVOICE_STATUSES, null)).toBe("draft");
  });
});
