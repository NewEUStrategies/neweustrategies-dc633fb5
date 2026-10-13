// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// BRAMKA: zamkniete zbiory modulu faktur wydarzen (TS) = CHECK-i migracji.
// Kolumny slownikowe sa `text` + `CHECK (kolumna IN (...))`, wiec typ
// generowany to `string` - kompilator nie zobaczy, ze panel oferuje rodzaj,
// stan KSeF albo stawke, ktorej baza nie przyjmie, ani ze pomija wartosc,
// ktora baza juz zwraca (surowa sciezka i18n w odznace). Obie strony czytamy
// z plikow: migracja jest jedynym zrodlem prawdy o CHECK-ach.
import { describe, expect, it } from "vitest";

import {
  EVENT_INVOICE_ADMISSIONS,
  EVENT_INVOICE_CORRECTION_HINTS,
  EVENT_INVOICE_CORRECTION_MODES,
  EVENT_INVOICE_KINDS,
  EVENT_INVOICE_KSEF_STATUSES,
  EVENT_INVOICE_KSEF_TRANSITIONS,
  EVENT_INVOICE_LOCALES,
  KSEF_NUMBER_PATTERN,
  EVENT_INVOICE_PAYMENT_METHODS,
  EVENT_INVOICE_REQUEST_BLOCKS,
  EVENT_INVOICE_REQUEST_STATUSES,
  EVENT_INVOICE_SOURCE_KINDS,
  EVENT_INVOICE_STATUSES,
  pickEnum,
} from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES } from "@/lib/events/eventInvoiceMath";
import { readLogicalMigration } from "@/lib/ci/migrationSize";

// Cala LOGICZNA migracja obu pasow: plik jest pociety na czesci (limit
// wdrozenia Lovable, scripts/split-migration.ts), a CHECK-i i CASE-y leza
// w roznych czesciach - sama czesc 1 zgubilaby polowe zbiorow.
const SUPABASE = readLogicalMigration("supabase/migrations", "20260927000200_event_invoices.sql");
const DRIZZLE = readLogicalMigration("drizzle/migrations", "0058_event_invoices.sql");

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

describe("parytet zbiorow faktur z CHECK-ami migracji 20260927000200", () => {
  it.each(PAIRS)("%s", (constraint, values) => {
    expect(checkValues(SUPABASE, constraint)).toEqual([...values]);
    expect(checkValues(DRIZZLE, constraint)).toEqual([...values]);
  });

  it("wycinek umie odmowic (nieznane ograniczenie to blad, nie pusta lista)", () => {
    expect(() => checkValues(SUPABASE, "event_invoices_nope_values")).toThrow(/Brak ograniczenia/);
  });
});

/** Galezie `CASE ... END AS block` w `event_my_invoice_sources` (powod braku prosby). */
function requestBlockValues(sql: string): string[] {
  const end = sql.indexOf("END AS block");
  if (end === -1) throw new Error("Brak powodu braku prosby w migracji faktur");
  const slice = sql.slice(sql.lastIndexOf("CASE", end), end);
  return [...slice.matchAll(/THEN '([a-z_]+)'/g)].map((match) => match[1]);
}

describe("parytet powodow braku prosby o fakture (request_block)", () => {
  it("TS zna dokladnie te powody, ktore zwraca baza (w kolejnosci galezi)", () => {
    expect(requestBlockValues(SUPABASE)).toEqual([...EVENT_INVOICE_REQUEST_BLOCKS]);
    expect(requestBlockValues(DRIZZLE)).toEqual([...EVENT_INVOICE_REQUEST_BLOCKS]);
  });

  it("wycinek umie odmowic (brak galezi to blad, nie pusta lista)", () => {
    expect(() => requestBlockValues("SELECT 1")).toThrow(/Brak powodu/);
  });
});

/** Wynik `_event_invoice_correction_hint` (ostatni `RETURN CASE v_rank ... END;`). */
function correctionHintValues(sql: string): string[] {
  const at = sql.indexOf("RETURN CASE v_rank");
  if (at === -1) throw new Error("Brak podpowiedzi korekty w migracji faktur");
  const slice = sql.slice(at, sql.indexOf("END;", at));
  return [...slice.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

/** Galezie `'admission', CASE ... END` w `_event_invoice_registration_source`. */
function admissionValues(sql: string): string[] {
  const at = sql.indexOf("'admission', CASE");
  if (at === -1) throw new Error("Brak miejsca oplaconego zapisu w migracji faktur");
  const slice = sql.slice(at, sql.indexOf("END", at));
  return [...slice.matchAll(/(?:THEN|ELSE) '([A-Za-z]+)'/g)].map((match) => match[1]);
}

describe("parytet podpowiedzi korekty i miejsca oplaconego zapisu", () => {
  it("podpowiedz korekty: TS zna dokladnie powody bazy (w kolejnosci wagi)", () => {
    expect(correctionHintValues(SUPABASE)).toEqual([...EVENT_INVOICE_CORRECTION_HINTS]);
    expect(correctionHintValues(DRIZZLE)).toEqual([...EVENT_INVOICE_CORRECTION_HINTS]);
  });

  it("miejsce oplaconego zapisu: ten sam zbior co baza", () => {
    expect(admissionValues(SUPABASE).sort()).toEqual([...EVENT_INVOICE_ADMISSIONS].sort());
    expect(admissionValues(DRIZZLE).sort()).toEqual([...EVENT_INVOICE_ADMISSIONS].sort());
  });

  it("wycinki umieja odmowic (brak fragmentu to blad, nie pusta lista)", () => {
    expect(() => correctionHintValues("SELECT 1")).toThrow(/Brak podpowiedzi/);
    expect(() => admissionValues("SELECT 1")).toThrow(/Brak miejsca/);
  });
});

// Przejscia stanu KSeF (INV-02) i format numeru KSeF (INV-17) - migracja
// 20261012100000. Panel oferuje w polu wyboru WYLACZNIE przejscia, ktore baza
// przyjmie; rozjazd = organizator wybiera stan i dostaje `invalid_transition`.
const COMPLIANCE = readLogicalMigration(
  "supabase/migrations",
  "20261012100000_event_invoice_compliance.sql",
);

function ksefTransitionPairs(sql: string): string[] {
  const at = sql.indexOf("FUNCTION public._event_invoice_ksef_transition_ok");
  if (at === -1) throw new Error("Brak funkcji przejsc KSeF w migracji");
  const slice = sql.slice(sql.indexOf("IN (", at), sql.indexOf("$$;", at));
  return [...slice.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)]
    .map((match) => `${match[1]}>${match[2]}`)
    .sort();
}

describe("parytet przejsc stanu KSeF i formatu numeru (INV-02, INV-17)", () => {
  it("TS zna dokladnie przejscia, ktore przyjmuje baza (accepted i not_applicable terminalne)", () => {
    const ts = Object.entries(EVENT_INVOICE_KSEF_TRANSITIONS)
      .flatMap(([from, targets]) => targets.map((to) => `${from}>${to}`))
      .sort();
    expect(ksefTransitionPairs(COMPLIANCE)).toEqual(ts);
    expect(EVENT_INVOICE_KSEF_TRANSITIONS.accepted).toEqual([]);
    expect(Object.keys(EVENT_INVOICE_KSEF_TRANSITIONS).sort()).toEqual(
      [...EVENT_INVOICE_KSEF_STATUSES].sort(),
    );
  });

  it("wzorzec numeru KSeF = wzorzec bazy", () => {
    expect(COMPLIANCE).toContain(
      "'^([0-9]{10})-([0-9]{4})([0-9]{2})([0-9]{2})-[0-9A-F]{12}-[0-9A-F]{2}$'",
    );
    expect(KSEF_NUMBER_PATTERN.test("7011278375-20260920-0123456789AB-CD")).toBe(true);
    expect(KSEF_NUMBER_PATTERN.test("7011278375-20260920-0123456789ab-CD")).toBe(false);
    expect(KSEF_NUMBER_PATTERN.test("KSEF-1")).toBe(false);
  });

  it("wycinek umie odmowic", () => {
    expect(() => ksefTransitionPairs("SELECT 1")).toThrow(/Brak funkcji/);
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
