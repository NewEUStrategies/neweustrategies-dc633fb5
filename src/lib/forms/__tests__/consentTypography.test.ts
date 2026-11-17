import { describe, expect, it } from "vitest";

import { CONSENT_MIN_FONT_PX, legibleConsentFontPx } from "../consentTypography";
import { EDIT_TARGET_META } from "@/lib/builder/editTargets";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";

describe("próg czytelności tekstu zgód", () => {
  it("próg = dotychczasowy domyślny rozmiar zgody (11 px)", () => {
    expect(CONSENT_MIN_FONT_PX).toBe(11);
  });

  it("za mały rozmiar z CMS podnosi do progu, większy zostawia", () => {
    expect(legibleConsentFontPx(8)).toBe(11);
    expect(legibleConsentFontPx(10.5)).toBe(11);
    expect(legibleConsentFontPx(11)).toBe(11);
    expect(legibleConsentFontPx(14)).toBe(14);
  });

  it("brak rozmiaru zostawia domyślny formularza (bez reguły)", () => {
    expect(legibleConsentFontPx(undefined)).toBeUndefined();
    expect(legibleConsentFontPx(null)).toBeUndefined();
    expect(legibleConsentFontPx(0)).toBeUndefined();
    expect(legibleConsentFontPx(-3)).toBeUndefined();
    expect(legibleConsentFontPx(Number.NaN)).toBeUndefined();
    expect(legibleConsentFontPx(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("edytor rozmiarów w builderze nie pozwala wybrać mniej niż próg", () => {
    expect(EDIT_TARGET_META.consentSize.min).toBe(CONSENT_MIN_FONT_PX);
  });

  it("pole liczbowe zakładki treści (WIDGET_SCHEMAS) ma to samo minimum", () => {
    // join-us i contact-form edytuje też generyczny `SchemaFieldControl`
    // z WIDGET_SCHEMAS - dwa pola w jednym panelu nie mogą mieć różnych minimów.
    const fields = Object.entries(WIDGET_SCHEMAS).flatMap(([type, schema]) =>
      (schema ?? [])
        .filter((field) => field.key === "consentSize")
        .map((field) => [type, field.min] as const),
    );
    // `contact` to alias legacy schematu `contact-form` (koniec schemas.ts).
    expect(fields.map(([type]) => type).sort()).toEqual(["contact", "contact-form", "join-us"]);
    for (const [type, min] of fields) {
      expect(min, type).toBe(CONSENT_MIN_FONT_PX);
    }
  });
});
