// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Slowniki etykiet ekranu faktur: kazdy stan, rodzaj, stawka, jezyk i sposob
// platnosci ma zdanie w OBU jezykach. Brakujacy klucz to surowa sciezka
// i18n w odznace dokumentu - tego nie zobaczy kompilator (klucz to napis).
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import {
  KIND_LABEL_KEYS,
  KSEF_STATUS_LABEL_KEYS,
  LOCALE_LABEL_KEYS,
  PAYMENT_METHOD_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  VAT_RATE_LABEL_KEYS,
} from "@/lib/events/adminEventInvoiceLabels";
import {
  EVENT_INVOICE_KINDS,
  EVENT_INVOICE_KSEF_STATUSES,
  EVENT_INVOICE_LOCALES,
  EVENT_INVOICE_PAYMENT_METHODS,
  EVENT_INVOICE_STATUSES,
} from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES } from "@/lib/events/eventInvoiceMath";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

ensureAdminEventInvoicesI18n();

const MAPS: ReadonlyArray<readonly [string, Record<string, string>, readonly string[]]> = [
  ["rodzaje", KIND_LABEL_KEYS, EVENT_INVOICE_KINDS],
  ["stany", STATUS_LABEL_KEYS, EVENT_INVOICE_STATUSES],
  ["stany KSeF", KSEF_STATUS_LABEL_KEYS, EVENT_INVOICE_KSEF_STATUSES],
  ["sposoby platnosci", PAYMENT_METHOD_LABEL_KEYS, EVENT_INVOICE_PAYMENT_METHODS],
  ["jezyki", LOCALE_LABEL_KEYS, EVENT_INVOICE_LOCALES],
  ["stawki VAT", VAT_RATE_LABEL_KEYS, EVENT_INVOICE_VAT_RATES],
];

describe("slowniki etykiet faktur", () => {
  it.each(MAPS)("%s: pelny zbior i zdanie w pl oraz en", (_name, map, values) => {
    expect(Object.keys(map).sort()).toEqual([...values].sort());
    for (const key of Object.values(map)) {
      expect(i18n.exists(key, { lng: "pl" }), `${key} pl`).toBe(true);
      expect(i18n.exists(key, { lng: "en" }), `${key} en`).toBe(true);
    }
  });
});
