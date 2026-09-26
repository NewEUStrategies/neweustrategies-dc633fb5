// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Formularz ustawien wystawcy - lustro `admin_event_invoice_settings_save`
// (harness 27, sekcja 2): kazdy kod odmowy bazy ma tu blad przy polu, a
// wlaczenie wymaga kompletu danych i JEDNORAZOWEGO potwierdzenia sprzedawcy.
import { describe, expect, it } from "vitest";

import { parseInvoiceSettings } from "@/lib/events/eventInvoicesApi";
import {
  SETTINGS_ERROR_KEYS,
  isSettingsDraftDirty,
  settingsDraftFromSettings,
  settingsDraftToInput,
  validateSettingsDraft,
  type InvoiceSettingsDraft,
} from "@/lib/events/eventInvoiceSettingsDraft";
import { invoiceSettingsJson } from "@/test/events/invoiceFixtures";

function draft(overrides: Partial<InvoiceSettingsDraft> = {}): InvoiceSettingsDraft {
  return {
    ...settingsDraftFromSettings(parseInvoiceSettings(invoiceSettingsJson())),
    ...overrides,
  };
}

const CONFIRMED = "2026-09-01T08:00:00.000Z";

describe("settingsDraftFromSettings", () => {
  it("ustawienia -> formularz (termin jako napis, potwierdzenie odznaczone)", () => {
    expect(draft()).toEqual({
      enabled: true,
      confirmSeller: false,
      sellerName: "Organizator 27 Sp. z o.o.",
      sellerTaxId: "7011278375",
      sellerAddress: "ul. Dluga 1",
      sellerPostalCode: "00-001",
      sellerCity: "Warszawa",
      sellerCountry: "PL",
      sellerEmail: "faktury@org27.example.com",
      sellerPhone: "",
      sellerBankAccount: "PL61109010140000071219812874",
      sellerBankSwift: "WBKPPLPP",
      seriesInvoice: "FV",
      seriesProforma: "PRO",
      seriesCorrection: "KOR",
      paymentDays: "14",
      defaultVatRate: "23",
      vatExemptBasis: "",
      footerNote: "",
      defaultLocale: "pl",
    });
  });
});

describe("validateSettingsDraft", () => {
  it("kompletne i juz potwierdzone = brak bledow", () => {
    expect(validateSettingsDraft(draft(), CONFIRMED)).toEqual({});
  });

  it("pierwsze wlaczenie wymaga potwierdzenia sprzedawcy", () => {
    expect(validateSettingsDraft(draft(), null)).toEqual({
      confirmSeller: SETTINGS_ERROR_KEYS.confirm,
    });
    expect(validateSettingsDraft(draft({ confirmSeller: true }), null)).toEqual({});
  });

  it("wylaczone: puste dane sprzedawcy wolno zapisac", () => {
    expect(
      validateSettingsDraft(
        draft({
          enabled: false,
          sellerName: "",
          sellerTaxId: "",
          sellerAddress: "",
          sellerCity: "",
        }),
        null,
      ),
    ).toEqual({});
  });

  it("wlaczone: nazwa, adres, kod, miasto i NIP wymagane", () => {
    expect(
      validateSettingsDraft(
        draft({
          sellerName: " ",
          sellerAddress: "",
          sellerPostalCode: "",
          sellerCity: "",
          sellerTaxId: "",
        }),
        CONFIRMED,
      ),
    ).toEqual({
      sellerName: SETTINGS_ERROR_KEYS.required,
      sellerAddress: SETTINGS_ERROR_KEYS.required,
      sellerPostalCode: SETTINGS_ERROR_KEYS.required,
      sellerCity: SETTINGS_ERROR_KEYS.required,
      sellerTaxId: SETTINGS_ERROR_KEYS.required,
    });
  });

  it("NIP, kraj i e-mail", () => {
    expect(validateSettingsDraft(draft({ sellerTaxId: "123" }), CONFIRMED)).toEqual({
      sellerTaxId: SETTINGS_ERROR_KEYS.taxId,
    });
    expect(validateSettingsDraft(draft({ sellerCountry: "P" }), CONFIRMED).sellerCountry).toBe(
      SETTINGS_ERROR_KEYS.country,
    );
    expect(validateSettingsDraft(draft({ sellerEmail: "zly" }), CONFIRMED)).toEqual({
      sellerEmail: SETTINGS_ERROR_KEYS.email,
    });
  });

  it("serie: ksztalt i roznorodnosc (bez wzgledu na wielkosc liter)", () => {
    expect(validateSettingsDraft(draft({ seriesInvoice: "F V" }), CONFIRMED)).toEqual({
      seriesInvoice: SETTINGS_ERROR_KEYS.series,
    });
    expect(validateSettingsDraft(draft({ seriesProforma: "fv" }), CONFIRMED)).toEqual({
      seriesCorrection: SETTINGS_ERROR_KEYS.seriesDistinct,
    });
    expect(validateSettingsDraft(draft({ seriesCorrection: "" }), CONFIRMED)).toEqual({
      seriesCorrection: SETTINGS_ERROR_KEYS.series,
    });
  });

  it("termin platnosci 0-120 dni", () => {
    for (const days of ["121", "-1", "abc", ""]) {
      expect(validateSettingsDraft(draft({ paymentDays: days }), CONFIRMED)).toEqual({
        paymentDays: SETTINGS_ERROR_KEYS.paymentDays,
      });
    }
    expect(validateSettingsDraft(draft({ paymentDays: " 0 " }), CONFIRMED)).toEqual({});
  });

  it("domyslne zw wymaga podstawy zwolnienia", () => {
    expect(validateSettingsDraft(draft({ defaultVatRate: "zw" }), CONFIRMED)).toEqual({
      vatExemptBasis: SETTINGS_ERROR_KEYS.exemptBasis,
    });
    expect(
      validateSettingsDraft(draft({ defaultVatRate: "zw", vatExemptBasis: "art. 43" }), CONFIRMED),
    ).toEqual({});
  });

  it("dlugosci pol jak w bazie", () => {
    expect(
      validateSettingsDraft(
        draft({
          sellerName: "n".repeat(201),
          sellerPhone: "1".repeat(41),
          sellerBankAccount: "1".repeat(65),
          sellerBankSwift: "S".repeat(21),
          vatExemptBasis: "b".repeat(301),
          footerNote: "f".repeat(501),
        }),
        CONFIRMED,
      ),
    ).toEqual({
      sellerName: SETTINGS_ERROR_KEYS.tooLong,
      sellerPhone: SETTINGS_ERROR_KEYS.tooLong,
      sellerBankAccount: SETTINGS_ERROR_KEYS.tooLong,
      sellerBankSwift: SETTINGS_ERROR_KEYS.tooLong,
      vatExemptBasis: SETTINGS_ERROR_KEYS.tooLong,
      footerNote: SETTINGS_ERROR_KEYS.tooLong,
    });
  });
});

describe("settingsDraftToInput", () => {
  it("normalizacja jak w bazie", () => {
    expect(
      settingsDraftToInput(
        draft({
          sellerName: " Org ",
          sellerTaxId: "PL 701-127-83-75",
          sellerCountry: " pl ",
          sellerEmail: " Faktury@Org.EXAMPLE.com ",
          sellerBankAccount: "pl61 1090 1014",
          sellerBankSwift: " wbkpplpp ",
          seriesInvoice: " fv ",
          paymentDays: " 30 ",
          confirmSeller: true,
          footerNote: " Stopka ",
        }),
      ),
    ).toEqual({
      enabled: true,
      confirmSeller: true,
      sellerName: "Org",
      sellerTaxId: "7011278375",
      sellerAddress: "ul. Dluga 1",
      sellerPostalCode: "00-001",
      sellerCity: "Warszawa",
      sellerCountry: "PL",
      sellerEmail: "faktury@org.example.com",
      sellerPhone: "",
      sellerBankAccount: "PL6110901014",
      sellerBankSwift: "WBKPPLPP",
      seriesInvoice: "FV",
      seriesProforma: "PRO",
      seriesCorrection: "KOR",
      paymentDays: 30,
      defaultVatRate: "23",
      vatExemptBasis: "",
      footerNote: "Stopka",
      defaultLocale: "pl",
    });
  });

  it("niepoprawny NIP idzie przyciety (baza odmowi z kodem)", () => {
    expect(settingsDraftToInput(draft({ sellerTaxId: " 123 " })).sellerTaxId).toBe("123");
  });
});

describe("isSettingsDraftDirty", () => {
  it("porownuje caly formularz", () => {
    expect(isSettingsDraftDirty(draft(), draft())).toBe(false);
    expect(isSettingsDraftDirty(draft({ footerNote: "x" }), draft())).toBe(true);
  });
});
