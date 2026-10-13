// Profil podatkowy biletu i pakietu (TIX-09): reguły pól = CHECK-i tabel
// (migracja 20261012130200). Za długa podstawa to odmowa, nie przycięcie.
import { describe, expect, it } from "vitest";

import {
  EMPTY_TAX_PROFILE,
  TAX_RATE_CHOICES,
  taxProfileFromRow,
  taxProfileIssues,
  taxProfileToPayload,
} from "@/lib/events/taxProfileDraft";

describe("taxProfileIssues", () => {
  it("pusty profil jest poprawny (stawka organizatora, kod domyślny Stripe)", () => {
    expect(taxProfileIssues(EMPTY_TAX_PROFILE)).toEqual({});
  });

  it("podstawa ponad 300 znaków to błąd - liczona po przycięciu brzegów, jak w bazie", () => {
    const ok = {
      ...EMPTY_TAX_PROFILE,
      vatRate: "zw" as const,
      vatExemptBasis: `  ${"a".repeat(300)}  `,
    };
    expect(taxProfileIssues(ok)).toEqual({});
    const tooLong = { ...ok, vatExemptBasis: "a".repeat(301) };
    expect(taxProfileIssues(tooLong)).toEqual({ vatExemptBasis: true });
  });

  it("kod Stripe: txcd_ i osiem cyfr; wielkość liter i spacje na brzegach nie przeszkadzają", () => {
    for (const code of ["txcd_10000000", " TXCD_20030000 "]) {
      expect(taxProfileIssues({ ...EMPTY_TAX_PROFILE, stripeTaxCode: code }), code).toEqual({});
    }
    for (const code of ["txcd_1000000", "txcd_100000000", "tx_10000000", "10000000"]) {
      expect(taxProfileIssues({ ...EMPTY_TAX_PROFILE, stripeTaxCode: code }), code).toEqual({
        stripeTaxCode: true,
      });
    }
  });
});

describe("taxProfileFromRow / taxProfileToPayload", () => {
  it("droplista ma „bez własnej stawki” i dokładnie zbiór stawek faktur", () => {
    expect(TAX_RATE_CHOICES).toEqual(["default", "23", "8", "5", "0", "zw", "np"]);
  });

  it("NULL z bazy to „default”, a „default” wraca jako NULL", () => {
    const draft = taxProfileFromRow({
      vat_rate: null,
      vat_exempt_basis: "",
      stripe_tax_code: null,
    });
    expect(draft).toEqual(EMPTY_TAX_PROFILE);
    expect(taxProfileToPayload(draft)).toEqual({
      vat_rate: null,
      vat_exempt_basis: "",
      stripe_tax_code: null,
    });
  });

  it("stawka spoza zbioru z bazy nie udaje znanej", () => {
    expect(taxProfileFromRow({ vat_rate: "7" }).vatRate).toBe("default");
    expect(taxProfileFromRow(undefined)).toEqual(EMPTY_TAX_PROFILE);
  });

  it("zw z podstawą i kodem: przycięte brzegi, kod małymi literami", () => {
    const payload = taxProfileToPayload({
      vatRate: "zw",
      vatExemptBasis: "  art. 43 ust. 1 pkt 29 ustawy o VAT ",
      stripeTaxCode: " TXCD_20030000",
    });
    expect(payload).toEqual({
      vat_rate: "zw",
      vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
      stripe_tax_code: "txcd_20030000",
    });
  });
});
