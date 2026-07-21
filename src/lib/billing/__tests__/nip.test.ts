import { describe, it, expect } from "vitest";
import { isValidPlNip, normalizeTaxId, validateTaxId } from "@/lib/billing/nip";

describe("normalizeTaxId", () => {
  it("usuwa separatory i normalizuje wielkość liter", () => {
    expect(normalizeTaxId("526-10-40-828")).toBe("5261040828");
    expect(normalizeTaxId(" pl 5261040828 ")).toBe("PL5261040828");
    expect(normalizeTaxId("de 123.456.789")).toBe("DE123456789");
  });
});

describe("isValidPlNip", () => {
  it("akceptuje NIP-y z poprawną sumą kontrolną", () => {
    // 5261040828: suma wag 162 -> 162 % 11 = 8 = cyfra kontrolna.
    expect(isValidPlNip("5261040828")).toBe(true);
    expect(isValidPlNip("526-104-08-28")).toBe(true);
    expect(isValidPlNip("PL5261040828")).toBe(true);
    // 1234563218: suma wag 118 -> 118 % 11 = 8 = cyfra kontrolna.
    expect(isValidPlNip("1234563218")).toBe(true);
  });

  it("odrzuca błędną cyfrę kontrolną", () => {
    expect(isValidPlNip("5261040829")).toBe(false);
    expect(isValidPlNip("1234567890")).toBe(false);
  });

  it("odrzuca zły format", () => {
    expect(isValidPlNip("")).toBe(false);
    expect(isValidPlNip("12345")).toBe(false);
    expect(isValidPlNip("52610408281")).toBe(false);
    expect(isValidPlNip("ABCDEFGHIJ")).toBe(false);
  });
});

describe("validateTaxId", () => {
  it("puste pole jest dozwolone (opcjonalność decyduje UI)", () => {
    expect(validateTaxId("", "PL")).toEqual({ ok: true, normalized: "" });
    expect(validateTaxId("  ", "DE")).toEqual({ ok: true, normalized: "" });
  });

  it("PL: pełny checksum + normalizacja do samych cyfr", () => {
    expect(validateTaxId("526-10-40-828", "PL")).toEqual({ ok: true, normalized: "5261040828" });
    expect(validateTaxId("PL 5261040828", "pl")).toEqual({ ok: true, normalized: "5261040828" });
    expect(validateTaxId("5261040829", "PL")).toEqual({ ok: false, reason: "checksum" });
    expect(validateTaxId("12345", "PL")).toEqual({ ok: false, reason: "format" });
  });

  it("inne kraje: łagodna walidacja formatu VAT", () => {
    expect(validateTaxId("DE123456789", "DE")).toEqual({ ok: true, normalized: "DE123456789" });
    expect(validateTaxId("x", "DE")).toEqual({ ok: false, reason: "format" });
    expect(validateTaxId("!!!", "DE")).toEqual({ ok: false, reason: "format" });
  });
});
