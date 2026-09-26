// Plik importu konwersji offline Google Ads (`src/lib/events/adsOfflineConversions.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. PLIK NIE PRZECHODZI IMPORTU - zly naglowek parametrow, format czasu albo
//      wartosci (przecinek dziesietny), BOM na poczatku.
//   2. WSTRZYKNIECIE FORMULY / ROZBITY WIERSZ - komorka z `=` albo przecinkiem
//      trafia do pliku zamiast wypasc (plik nie moze byc "naprawiany" apostrofem).
//   3. KLIKNIECIA iOS (gbraid/wbraid) GINA albo laduja w kolumnie gclid.
//   4. WIERSZ BEZ NAZWY KONWERSJI jedzie do Google Ads i jest odrzucany tam.
import { describe, expect, it } from "vitest";

import { freezeClock } from "@/test/time";
import type { AdsConversionRow, AdsConversionsExport } from "@/lib/events/adsFunnel";
import {
  buildOfflineConversionsCsv,
  centsToDecimal,
  isValidConversionName,
  offlineConversionsFileName,
} from "@/lib/events/adsOfflineConversions";

freezeClock();

function row(overrides: Partial<AdsConversionRow> = {}): AdsConversionRow {
  return {
    orderId: "o1",
    registrationId: "r1",
    clickType: "gclid",
    clickId: "Cj0KCQjw-abc_DEF123",
    conversionActionName: "Bilet Kongres",
    conversionTime: "2099-06-15T12:05:00Z",
    conversionTimeLocal: "2099-06-15 14:05:00",
    valueCents: 49900,
    currency: "PLN",
    adUserData: true,
    adPersonalization: true,
    ...overrides,
  };
}

function exportOf(rows: AdsConversionRow[], timezone = "Europe/Warsaw"): AdsConversionsExport {
  return {
    timezone,
    rows,
    skipped: { unattributed: 0, noClick: 0, expired: 0, beforeClick: 0 },
  };
}

describe("buildOfflineConversionsCsv", () => {
  it("plik zloty: naglowek parametrow, kolumny szablonu, LF, bez BOM", () => {
    const got = buildOfflineConversionsCsv(
      exportOf([row(), row({ valueCents: 5, adPersonalization: false })]),
      null,
    );
    expect(got.csv).toBe(
      [
        "Parameters:TimeZone=Europe/Warsaw",
        "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Ad User Data,Ad Personalization",
        "Cj0KCQjw-abc_DEF123,Bilet Kongres,2099-06-15 14:05:00,499.00,PLN,GRANTED,GRANTED",
        "Cj0KCQjw-abc_DEF123,Bilet Kongres,2099-06-15 14:05:00,0.05,PLN,GRANTED,DENIED",
        "",
      ].join("\n"),
    );
    expect(got.csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(got).toMatchObject({ included: 2, missingName: 0, rejected: 0 });
  });

  it("klikniecia iOS: kolumny GBRAID/WBRAID, dokladnie jedna wypelniona w wierszu", () => {
    const got = buildOfflineConversionsCsv(
      exportOf([
        row(),
        row({ clickType: "gbraid", clickId: "GBRAID-123456" }),
        row({ clickType: "wbraid", clickId: "WBRAID-123456", adUserData: false }),
      ]),
      null,
    );
    const lines = got.csv.trimEnd().split("\n");
    expect(lines[1]).toBe(
      "Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Ad User Data,Ad Personalization",
    );
    expect(lines[2]?.startsWith("Cj0KCQjw-abc_DEF123,,,")).toBe(true);
    expect(lines[3]?.startsWith(",GBRAID-123456,,")).toBe(true);
    expect(lines[4]).toBe(
      ",,WBRAID-123456,Bilet Kongres,2099-06-15 14:05:00,499.00,PLN,DENIED,GRANTED",
    );
  });

  it("nazwa domyslna uzupelnia wiersze bez nazwy; bez niej wiersz wypada", () => {
    const rows = [row({ conversionActionName: null }), row()];
    expect(buildOfflineConversionsCsv(exportOf(rows), null)).toMatchObject({
      included: 1,
      missingName: 1,
    });
    const filled = buildOfflineConversionsCsv(exportOf(rows), "  Zakup biletu ");
    expect(filled.included).toBe(2);
    expect(filled.csv).toContain(",Zakup biletu,");
    expect(buildOfflineConversionsCsv(exportOf(rows), "   ").missingName).toBe(1);
  });

  it("biala lista: komorka z formula, przecinkiem albo zlym formatem - wiersz WYPADA", () => {
    const bad = [
      row({ conversionActionName: '=HYPERLINK("x")' }),
      row({ conversionActionName: "Bilet, VIP" }),
      row({ clickId: "krotki" }),
      row({ clickId: "=1+1abcdefgh" }),
      row({ conversionTimeLocal: "15.06.2099 14:05" }),
      row({ currency: "zl" }),
      row({ valueCents: 10 ** 16 }),
    ];
    const got = buildOfflineConversionsCsv(exportOf(bad), null);
    expect(got).toMatchObject({ included: 0, rejected: bad.length, missingName: 0 });
    expect(got.csv).not.toContain("HYPERLINK");
    expect(got.csv.trimEnd().split("\n")).toHaveLength(2);
  });

  it("strefa spoza wzorca zastapiona strefa domyslna", () => {
    expect(
      buildOfflineConversionsCsv(exportOf([], "Europe/Warsaw\nx"), null).csv.split("\n")[0],
    ).toBe("Parameters:TimeZone=Europe/Warsaw");
    expect(
      buildOfflineConversionsCsv(exportOf([], "America/Argentina/Buenos_Aires"), null).csv,
    ).toMatch(/^Parameters:TimeZone=America\/Argentina\/Buenos_Aires\n/);
  });
});

describe("pomocnicze", () => {
  it("centsToDecimal: kropka i dwa miejsca", () => {
    expect(centsToDecimal(0)).toBe("0.00");
    expect(centsToDecimal(7)).toBe("0.07");
    expect(centsToDecimal(123456)).toBe("1234.56");
  });

  it("isValidConversionName: lustro CHECK-a w bazie", () => {
    expect(isValidConversionName("Bilet Kongres (PL) - 2026")).toBe(true);
    for (const bad of ["", "-bilet", "+x", "@x", 'a"b', "a,b", "a\nb", "x".repeat(101)]) {
      expect(isValidConversionName(bad)).toBe(false);
    }
  });

  it("nazwa pliku ze slugu i dnia", () => {
    expect(offlineConversionsFileName("Kongres 2026!", "2099-06-15T12:00:00.000Z")).toBe(
      "google-ads-conversions-kongres-2026-2099-06-15.csv",
    );
    expect(offlineConversionsFileName("!!!", "2099-06-15T12:00:00.000Z")).toBe(
      "google-ads-conversions-event-2099-06-15.csv",
    );
  });
});
