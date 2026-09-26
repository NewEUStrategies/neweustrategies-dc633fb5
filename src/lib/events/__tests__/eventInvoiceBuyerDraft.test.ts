// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Dane nabywcy faktury wydarzenia: formularz kupujacego (kasa, pakiet,
// profil) i organizatora (szkic). Reguly sa lustrem `_event_invoice_buyer_clean`
// - kazdy kod odmowy bazy ma tu swoj blad przy polu (harness 27, sekcja 3),
// zeby kupujacy zobaczyl problem, ZANIM przejdzie do kasy.
import { describe, expect, it } from "vitest";

import type { BillingProfile } from "@/lib/billing/types";
import {
  BUYER_ERROR_KEYS,
  billingProfileFromBuyerDraft,
  buyerDraftFromBillingProfile,
  buyerDraftFromColumns,
  buyerDraftToPayload,
  emptyBuyerDraft,
  hasBuyerErrors,
  validateBuyerDraft,
  type InvoiceBuyerDraft,
} from "@/lib/events/eventInvoiceBuyerDraft";

function company(overrides: Partial<InvoiceBuyerDraft> = {}): InvoiceBuyerDraft {
  return {
    ...emptyBuyerDraft(),
    name: "Acme Sp. z o.o.",
    taxId: "PL 526-025-02-74",
    address: "ul. Morska 5",
    postalCode: "80-001",
    city: "Gdansk",
    ...overrides,
  };
}

const PROFILE: BillingProfile = {
  id: "bp-1",
  user_id: "u-1",
  tenant_id: "t-1",
  full_name: "Anna Kupujaca",
  company: "Acme Sp. z o.o.",
  tax_id: "5260250274",
  email: "anna@example.com",
  phone: "+48 600 000 000",
  address_line1: "ul. Morska 5",
  address_line2: " lok. 2 ",
  city: "Gdansk",
  postal_code: "80-001",
  region: "pomorskie",
  country_code: "PL",
  is_company: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("emptyBuyerDraft", () => {
  it("domyslnie firma z Polski, pola puste", () => {
    expect(emptyBuyerDraft()).toEqual({
      isCompany: true,
      name: "",
      taxId: "",
      country: "PL",
      address: "",
      postalCode: "",
      city: "",
      email: "",
      poNumber: "",
      recipientName: "",
      recipientAddress: "",
    });
  });
});

describe("validateBuyerDraft", () => {
  it("kompletne dane firmy = brak bledow", () => {
    const errors = validateBuyerDraft(company());
    expect(errors).toEqual({});
    expect(hasBuyerErrors(errors)).toBe(false);
  });

  it("pusty formularz firmy: nazwa, NIP, adres, kod i miasto", () => {
    const errors = validateBuyerDraft(emptyBuyerDraft());
    expect(errors).toEqual({
      name: BUYER_ERROR_KEYS.nameRequired,
      taxId: BUYER_ERROR_KEYS.taxIdRequired,
      address: BUYER_ERROR_KEYS.addressRequired,
      postalCode: BUYER_ERROR_KEYS.postalCodeRequired,
      city: BUYER_ERROR_KEYS.cityRequired,
    });
    expect(hasBuyerErrors(errors)).toBe(true);
  });

  it("osoba prywatna nie potrzebuje NIP-u", () => {
    expect(validateBuyerDraft(company({ isCompany: false, taxId: "" }))).toEqual({});
  });

  it("NIP: zly format i zla suma kontrolna to rozne komunikaty", () => {
    expect(validateBuyerDraft(company({ taxId: "123" })).taxId).toBe(BUYER_ERROR_KEYS.taxIdFormat);
    expect(validateBuyerDraft(company({ taxId: "5260250275" })).taxId).toBe(
      BUYER_ERROR_KEYS.taxIdChecksum,
    );
  });

  it("zagraniczny VAT ID bez polskiej sumy i bez polskiego kodu pocztowego", () => {
    expect(
      validateBuyerDraft(
        company({ country: " de ", taxId: "DE 123.456.789", postalCode: "10115" }),
      ),
    ).toEqual({});
    expect(validateBuyerDraft(company({ country: "DE", taxId: "X" })).taxId).toBe(
      BUYER_ERROR_KEYS.taxIdFormat,
    );
  });

  it("kraj: pusty = PL, inny ksztalt odrzucony", () => {
    expect(validateBuyerDraft(company({ country: "" }))).toEqual({});
    expect(validateBuyerDraft(company({ country: "POL" })).country).toBe(
      BUYER_ERROR_KEYS.countryInvalid,
    );
  });

  it("polski kod pocztowy ma ksztalt 00-000", () => {
    expect(validateBuyerDraft(company({ postalCode: "80001" })).postalCode).toBe(
      BUYER_ERROR_KEYS.postalCodeFormat,
    );
  });

  it("dlugosci pol jak w bazie", () => {
    const errors = validateBuyerDraft(
      company({
        name: "n".repeat(201),
        address: "a".repeat(201),
        postalCode: "9".repeat(21),
        city: "c".repeat(101),
        poNumber: "p".repeat(101),
        recipientName: "r".repeat(201),
        recipientAddress: "r".repeat(301),
      }),
    );
    expect(errors).toEqual({
      name: BUYER_ERROR_KEYS.nameTooLong,
      address: BUYER_ERROR_KEYS.tooLong,
      postalCode: BUYER_ERROR_KEYS.tooLong,
      city: BUYER_ERROR_KEYS.tooLong,
      poNumber: BUYER_ERROR_KEYS.tooLong,
      recipientName: BUYER_ERROR_KEYS.tooLong,
      recipientAddress: BUYER_ERROR_KEYS.tooLong,
    });
  });

  it("e-mail opcjonalny, ale jesli jest - poprawny i nie dluzszy niz 254", () => {
    expect(validateBuyerDraft(company({ email: "" })).email).toBeUndefined();
    expect(validateBuyerDraft(company({ email: "zly@" })).email).toBe(
      BUYER_ERROR_KEYS.emailInvalid,
    );
    expect(validateBuyerDraft(company({ email: `${"a".repeat(250)}@x.pl` })).email).toBe(
      BUYER_ERROR_KEYS.emailInvalid,
    );
    expect(validateBuyerDraft(company({ email: "ksiegowosc@acme.example" })).email).toBeUndefined();
  });

  it("nazwa jednoznakowa to brak nazwy", () => {
    expect(validateBuyerDraft(company({ name: " A " })).name).toBe(BUYER_ERROR_KEYS.nameRequired);
  });
});

describe("buyerDraftToPayload", () => {
  it("snake_case, NIP znormalizowany, napisy przyciete, e-mail malymi", () => {
    expect(
      buyerDraftToPayload(
        company({
          name: " Acme ",
          email: " Ksiegowosc@Acme.EXAMPLE ",
          poNumber: " PO-1 ",
          country: "pl",
        }),
      ),
    ).toEqual({
      is_company: true,
      name: "Acme",
      tax_id: "5260250274",
      country: "PL",
      address: "ul. Morska 5",
      postal_code: "80-001",
      city: "Gdansk",
      email: "ksiegowosc@acme.example",
      po_number: "PO-1",
      recipient_name: "",
      recipient_address: "",
    });
  });

  it("niepoprawny NIP idzie przyciety (baza odmowi z kodem)", () => {
    expect(buyerDraftToPayload(company({ taxId: " 123 " })).tax_id).toBe("123");
  });
});

describe("buyerDraftFromColumns", () => {
  it("kolumny prosby/dokumentu -> formularz", () => {
    expect(
      buyerDraftFromColumns({
        buyer_is_company: false,
        buyer_name: "Ewa",
        buyer_tax_id: "",
        buyer_country: "DE",
        buyer_address: "Str. 1",
        buyer_postal_code: "10115",
        buyer_city: "Berlin",
        buyer_email: "e@example.com",
        po_number: "PO",
        recipient_name: "Dzial",
        recipient_address: "Adres",
      }),
    ).toEqual({
      isCompany: false,
      name: "Ewa",
      taxId: "",
      country: "DE",
      address: "Str. 1",
      postalCode: "10115",
      city: "Berlin",
      email: "e@example.com",
      poNumber: "PO",
      recipientName: "Dzial",
      recipientAddress: "Adres",
    });
  });

  it("NULL-e z LEFT JOIN-a = domyslne wartosci formularza", () => {
    expect(
      buyerDraftFromColumns({
        buyer_is_company: null,
        buyer_name: null,
        buyer_tax_id: null,
        buyer_country: null,
        buyer_address: null,
        buyer_postal_code: null,
        buyer_city: null,
        buyer_email: null,
        po_number: null,
      }),
    ).toEqual(emptyBuyerDraft());
  });
});

describe("profil rozliczeniowy", () => {
  it("firma z profilu: nazwa firmy, adres z dwoch linii", () => {
    expect(buyerDraftFromBillingProfile(PROFILE)).toEqual({
      ...emptyBuyerDraft(),
      isCompany: true,
      name: "Acme Sp. z o.o.",
      taxId: "5260250274",
      country: "PL",
      address: "ul. Morska 5, lok. 2",
      postalCode: "80-001",
      city: "Gdansk",
      email: "anna@example.com",
    });
  });

  it("osoba z profilu: imie i nazwisko, puste pola zostaja puste", () => {
    expect(
      buyerDraftFromBillingProfile({
        ...PROFILE,
        is_company: false,
        company: null,
        tax_id: null,
        email: null,
        address_line1: null,
        address_line2: null,
        city: null,
        postal_code: null,
      }),
    ).toEqual({ ...emptyBuyerDraft(), isCompany: false, name: "Anna Kupujaca" });
    expect(
      buyerDraftFromBillingProfile({ ...PROFILE, is_company: false, full_name: null }).name,
    ).toBe("");
  });

  it("zapamietanie danych firmy zachowuje osobe, telefon i region z profilu", () => {
    expect(
      billingProfileFromBuyerDraft(company({ email: " Nowy@Acme.example " }), PROFILE),
    ).toEqual({
      full_name: "Anna Kupujaca",
      company: "Acme Sp. z o.o.",
      tax_id: "5260250274",
      email: "nowy@acme.example",
      phone: "+48 600 000 000",
      address_line1: "ul. Morska 5",
      address_line2: null,
      city: "Gdansk",
      postal_code: "80-001",
      region: "pomorskie",
      country_code: "PL",
      is_company: true,
    });
  });

  it("zapamietanie danych osoby bez profilu", () => {
    expect(
      billingProfileFromBuyerDraft(
        company({ isCompany: false, name: " Ewa Druga ", taxId: "" }),
        null,
      ),
    ).toEqual({
      full_name: "Ewa Druga",
      company: null,
      tax_id: null,
      email: null,
      phone: null,
      address_line1: "ul. Morska 5",
      address_line2: null,
      city: "Gdansk",
      postal_code: "80-001",
      region: null,
      country_code: "PL",
      is_company: false,
    });
  });

  it("pusty e-mail zostawia adres z profilu, niepoprawny NIP nie trafia do profilu", () => {
    const input = billingProfileFromBuyerDraft(company({ email: "", taxId: "123" }), PROFILE);
    expect(input.email).toBe("anna@example.com");
    expect(input.tax_id).toBeNull();
    const personNoProfile = billingProfileFromBuyerDraft(company({ isCompany: true }), null);
    expect(personNoProfile.full_name).toBeNull();
    const personWithProfile = billingProfileFromBuyerDraft(company({ isCompany: false }), PROFILE);
    expect(personWithProfile.company).toBe("Acme Sp. z o.o.");
  });
});
