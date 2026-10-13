// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Lustro arytmetyki faktur wydarzen. Autorytetem jest baza
// (`_event_invoice_net_from_gross`, `_event_invoice_recalc`), a edytor szkicu
// liczy podglad tym modulem - wiec kazdy grosz rozjazdu to podglad inny niz
// wydruk. Wektory netto sa TE SAME co w harnessie
// (`scripts/events-harness/runtime_test.d/27_invoices.sql`, sekcja 1) - zmiana
// jednego zbioru bez drugiego to zerwana parytetowosc. Wektory metody brutto
// (VAT od sumy w stawce, korekta jako roznica stanu) i przeliczenia na PLN sa
// te same co w `27_invoices_compliance.sql` (sekcja B i 27b/EUR).
import { describe, expect, it } from "vitest";

import {
  EVENT_INVOICE_VAT_RATES,
  amountInPln,
  invoiceTotals,
  isEventInvoiceVatRate,
  lineAmounts,
  netFromGross,
  splitSourceUnits,
  vatPercent,
  vatSummary,
  type EventInvoiceVatRate,
} from "@/lib/events/eventInvoiceMath";

// [brutto, stawka, netto] - identyczne z harnessem.
const SHARED_VECTORS: ReadonlyArray<readonly [number, EventInvoiceVatRate, number]> = [
  [12300, "23", 10000],
  [100, "23", 81],
  [61, "23", 50],
  [1, "23", 1],
  [-12300, "23", -10000],
  [-61, "23", -50],
  [10800, "8", 10000],
  [105, "5", 100],
  [999, "np", 999],
  [5000, "zw", 5000],
  [777, "0", 777],
  [0, "23", 0],
  [12301, "23", 10001],
  [50000, "23", 40650],
  [12300, "8", 11389],
  [2100, "5", 2000],
];

describe("netFromGross - wektory wspolne z harnessem", () => {
  it.each(SHARED_VECTORS)("%i @%s = %i", (gross, rate, net) => {
    expect(netFromGross(gross, rate)).toBe(net);
  });

  it("jest symetryczne wzgledem zera (pozycja korekty odwraca dokladnie)", () => {
    for (const gross of [1, 61, 99, 12301, 987654]) {
      for (const rate of EVENT_INVOICE_VAT_RATES) {
        expect(netFromGross(-gross, rate)).toBe(-netFromGross(gross, rate));
      }
    }
  });

  it("nie zna ulamkow: wynik zawsze calkowity, VAT nigdy ujemny dla dodatniego brutto", () => {
    for (let gross = 0; gross <= 5000; gross += 7) {
      const net = netFromGross(gross, "23");
      expect(Number.isInteger(net)).toBe(true);
      expect(gross - net).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("stawki", () => {
  it("zbior stawek jest zamkniety", () => {
    expect([...EVENT_INVOICE_VAT_RATES]).toEqual(["23", "8", "5", "0", "zw", "np"]);
    expect(isEventInvoiceVatRate("8")).toBe(true);
    expect(isEventInvoiceVatRate("7")).toBe(false);
    expect(isEventInvoiceVatRate("")).toBe(false);
  });

  it("procent: 23/8/5, a 0/zw/np = 0", () => {
    expect(EVENT_INVOICE_VAT_RATES.map(vatPercent)).toEqual([23, 8, 5, 0, 0, 0]);
  });
});

describe("lineAmounts", () => {
  it("liczy netto na POZYCJI, nie na sztuce", () => {
    // 3 x 0,61 zl: na sztuce 3 x 50 = 150 netto, na pozycji 183 -> 149.
    expect(lineAmounts(3, 61, "23")).toEqual({
      grossCents: 183,
      netCents: 149,
      vatCents: 34,
      unitNetCents: 50,
    });
  });

  it("ujemna ilosc korekty daje przeciwne kwoty", () => {
    expect(lineAmounts(-1, 12300, "8")).toEqual({
      grossCents: -12300,
      netCents: -11389,
      vatCents: -911,
      unitNetCents: 11389,
    });
  });

  it("stawka zw: VAT zero", () => {
    expect(lineAmounts(2, 1050, "zw")).toEqual({
      grossCents: 2100,
      netCents: 2100,
      vatCents: 0,
      unitNetCents: 1050,
    });
  });
});

describe("splitSourceUnits - lustro petli jednostek szkicu", () => {
  it("kwota dzielaca sie rowno = jedna pozycja", () => {
    expect(splitSourceUnits(36900, 3)).toEqual([{ quantity: 3, unitGrossCents: 12300 }]);
  });

  it("reszta z dzielenia trafia na druga pozycje o grosz drozsza", () => {
    expect(splitSourceUnits(24601, 2)).toEqual([
      { quantity: 1, unitGrossCents: 12300 },
      { quantity: 1, unitGrossCents: 12301 },
    ]);
    const parts = splitSourceUnits(10000, 3);
    expect(parts).toEqual([
      { quantity: 2, unitGrossCents: 3333 },
      { quantity: 1, unitGrossCents: 3334 },
    ]);
    expect(parts.reduce((sum, part) => sum + part.quantity * part.unitGrossCents, 0)).toBe(10000);
  });
});

describe("sumy i podsumowanie VAT", () => {
  const lines = [
    { vatRate: "8" as const, ...lineAmounts(1, 12300, "8") },
    { vatRate: "5" as const, ...lineAmounts(2, 1050, "5") },
    { vatRate: "23" as const, ...lineAmounts(1, 12300, "23") },
    { vatRate: "8" as const, ...lineAmounts(-1, 12300, "8") },
  ];

  it("sumy = sumy pozycji", () => {
    expect(invoiceTotals(lines)).toEqual({ netCents: 12000, vatCents: 2400, grossCents: 14400 });
    expect(invoiceTotals([])).toEqual({ netCents: 0, vatCents: 0, grossCents: 0 });
  });

  it("podsumowanie w kolejnosci stawek, tylko obecne stawki", () => {
    expect(vatSummary(lines)).toEqual([
      { vatRate: "23", netCents: 10000, vatCents: 2300, grossCents: 12300 },
      { vatRate: "8", netCents: 0, vatCents: 0, grossCents: 0 },
      { vatRate: "5", netCents: 2000, vatCents: 100, grossCents: 2100 },
    ]);
    expect(vatSummary([])).toEqual([]);
  });
});

describe("metoda brutto: VAT od SUMY w stawce (art. 106e ust. 7-8, INV-16)", () => {
  const three = [1, 2, 3].map(() => ({ vatRate: "23" as const, ...lineAmounts(1, 61, "23") }));

  it("3 x 0,61 zl: netto 1,49 + VAT 0,34 (nie 1,50 + 0,33 z pozycji)", () => {
    expect(three.reduce((sum, line) => sum + line.netCents, 0)).toBe(150);
    const summary = vatSummary(three);
    expect(summary).toEqual([{ vatRate: "23", netCents: 149, vatCents: 34, grossCents: 183 }]);
    expect(invoiceTotals(summary)).toEqual({ netCents: 149, vatCents: 34, grossCents: 183 });
  });

  it("korekta = roznica stanu: 1,83 -> 1,22 daje -0,50 netto i -0,11 VAT", () => {
    const correction = [{ vatRate: "23" as const, ...lineAmounts(-1, 61, "23") }];
    expect(vatSummary(correction, { "23": 183 })).toEqual([
      { vatRate: "23", netCents: -50, vatCents: -11, grossCents: -61 },
    ]);
    // Stan przed korekta ma znaczenie: obnizka 0,50 zl -> 0,47 zl to roznica
    // VAT 0,09 -> 0,09 = 0,00, a podatek liczony od samej pozycji -0,03 dalby -0,01.
    const cut = [{ vatRate: "23" as const, ...lineAmounts(-1, 3, "23") }];
    expect(vatSummary(cut, { "23": 50 })[0]).toMatchObject({ netCents: -3, vatCents: 0 });
    expect(vatSummary(cut)[0]).toMatchObject({ netCents: -2, vatCents: -1 });
  });

  it("stan przed korekta w innej stawce nie wplywa na stawke korekty", () => {
    const line = [{ vatRate: "8" as const, ...lineAmounts(1, 10800, "8") }];
    expect(vatSummary(line, { "23": 183 })).toEqual([
      { vatRate: "8", netCents: 10000, vatCents: 800, grossCents: 10800 },
    ]);
  });
});

describe("amountInPln - przeliczenie po kursie NBP (INV-06), wektory z harnessem", () => {
  it.each([
    [1870, 4.2731, 7991],
    [-1870, 4.2731, -7991],
    [1, 0.5, 1],
    [-1, 0.5, -1],
    [3, 0.1667, 1],
    [0, 4.5, 0],
  ])("%i x %f = %i (polowka od zera)", (cents, rate, pln) => {
    expect(amountInPln(cents, rate)).toBe(pln);
  });

  it("duze kwoty bez utraty precyzji (BigInt)", () => {
    expect(amountInPln(99_999_999_999, 4.2731)).toBe(427_309_999_996);
  });
});
