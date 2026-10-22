// Reguły panelu treści zgody (I9d-Y2) - moduł czysty.
//
// Stan pola łączy bazę (bieżąca treść domyślna / oznaczenie admina) z JEDNYM
// źródłem TS (dawne treści domyślne sprzed Y2 formularz renderuje jako
// bieżącą z pomiarem). Nigdy nie zgaduje po słowach w tekście.
import { describe, expect, it } from "vitest";

import {
  CONSENT_POLICY_FIELD,
  consentColumnValue,
  consentDraftDirty,
  consentDraftFrom,
  consentFieldDirty,
  consentFieldStatus,
  draftLosesMeasurement,
} from "../consentTextRules";
import {
  LEGACY_NEWSLETTER_CONSENT_DEFAULTS,
  newsletterConsentHtml,
} from "@/lib/newsletter/consentText";
import type { ConsentMeasurementFieldDto } from "@/lib/privacy/measurementParse";

function dto(over: Partial<ConsentMeasurementFieldDto> = {}): ConsentMeasurementFieldDto {
  return {
    field: "policy_html_pl",
    lang: "pl",
    textPresent: true,
    isDefault: false,
    marked: false,
    stale: false,
    covers: false,
    markedAt: null,
    ...over,
  };
}

const OWN = "Zapisując się, akceptujesz regulamin.";

describe("treść zgody - wartości pól", () => {
  it("kolumny grupy `inline`; puste pole = `null`, tekst bez zmian (nic nie przycinamy)", () => {
    expect(CONSENT_POLICY_FIELD).toEqual({ pl: "policy_html_pl", en: "policy_html_en" });
    expect(consentColumnValue("   ")).toBeNull();
    expect(consentColumnValue("  Tekst  ")).toBe("  Tekst  ");
    expect(consentDraftFrom({ policy_html_pl: null, policy_html_en: "EN" })).toEqual({
      pl: "",
      en: "EN",
    });
  });

  it("znacznik zmian: puste ≡ `null`, każdy inny znak to zmiana", () => {
    expect(consentFieldDirty("", null)).toBe(false);
    expect(consentFieldDirty(" ", "")).toBe(false);
    expect(consentFieldDirty(OWN, OWN)).toBe(false);
    expect(consentFieldDirty(`${OWN} `, OWN)).toBe(true);
    expect(
      consentDraftDirty({ pl: "", en: OWN }, { policy_html_pl: null, policy_html_en: OWN }),
    ).toBe(false);
    expect(
      consentDraftDirty({ pl: OWN, en: OWN }, { policy_html_pl: null, policy_html_en: OWN }),
    ).toBe(true);
  });
});

describe("treść zgody - stan pola", () => {
  it("puste, bieżąca i dawna treść domyślna = `default` (także gdy baza mówi `covers: false`)", () => {
    expect(consentFieldStatus(null, dto({ textPresent: false, covers: null }))).toBe("default");
    expect(consentFieldStatus(newsletterConsentHtml("pl"), dto({ isDefault: true }))).toBe(
      "default",
    );
    for (const legacy of LEGACY_NEWSLETTER_CONSENT_DEFAULTS) {
      expect(consentFieldStatus(legacy, dto()), legacy).toBe("default");
    }
  });

  it("własny tekst: oznaczony = `marked`, bez ważnego oznaczenia = `uncovered`, bez odczytu = `unknown`", () => {
    expect(consentFieldStatus(OWN, dto({ covers: true, marked: true }))).toBe("marked");
    expect(consentFieldStatus(OWN, dto({ covers: false }))).toBe("uncovered");
    expect(consentFieldStatus(OWN, dto({ covers: false, stale: true }))).toBe("uncovered");
    expect(consentFieldStatus(OWN, null)).toBe("unknown");
  });

  it("ostrzeżenie przed zapisem tylko dla zmiany NA własny tekst", () => {
    expect(draftLosesMeasurement(OWN, null)).toBe(true);
    expect(draftLosesMeasurement(`${OWN} x`, OWN)).toBe(true);
    expect(draftLosesMeasurement(OWN, OWN)).toBe(false);
    expect(draftLosesMeasurement("", OWN)).toBe(false);
    expect(draftLosesMeasurement(newsletterConsentHtml("en"), OWN)).toBe(false);
  });
});
