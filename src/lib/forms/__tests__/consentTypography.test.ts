import { describe, expect, it } from "vitest";

import { CONSENT_MIN_FONT_PX, legibleConsentFontPx } from "../consentTypography";
import { EDIT_TARGET_META } from "@/lib/builder/editTargets";

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
});
