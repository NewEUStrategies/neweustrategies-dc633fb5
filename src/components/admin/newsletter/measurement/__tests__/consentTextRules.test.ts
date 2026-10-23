// Reguły panelu treści zgody (I9d-Y2, I9d-Y2b) - moduł czysty.
//
// Wariant (b): treść zgody na newsletter nie daje pomiaru, więc stan pola
// to tylko „domyślna" albo „własna" (jedno źródło TS, także dawne treści
// domyślne i pakietowa (a)). Ostrzeżenie R1.24 - własny tekst, który
// wspomina pomiar - to samo wyrażenie co kontrola K5b runbooka.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONSENT_MEASUREMENT_MENTION,
  CONSENT_POLICY_FIELD,
  consentColumnValue,
  consentDraftDirty,
  consentDraftFrom,
  consentFieldDirty,
  consentFieldStatus,
  newsletterConsentMentionsMeasurement,
} from "../consentTextRules";
import * as rules from "../consentTextRules";
import {
  LEGACY_NEWSLETTER_CONSENT_DEFAULTS,
  newsletterConsentHtml,
} from "@/lib/newsletter/consentText";
import { measurementConsentHtml } from "@/lib/newsletter/measurementConsentText";

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

describe("treść zgody - stan pola (wariant (b): domyślna albo własna)", () => {
  it("puste, bieżąca i dawna treść domyślna (także pakietowa (a)) = `default`", () => {
    expect(consentFieldStatus(null)).toBe("default");
    expect(consentFieldStatus("  ")).toBe("default");
    expect(consentFieldStatus(newsletterConsentHtml("pl"))).toBe("default");
    expect(consentFieldStatus(newsletterConsentHtml("en"))).toBe("default");
    for (const legacy of LEGACY_NEWSLETTER_CONSENT_DEFAULTS) {
      expect(consentFieldStatus(legacy), legacy).toBe("default");
    }
  });

  it("tekst admina = `custom` - bez oznaczeń, bez stanów z bazy", () => {
    expect(consentFieldStatus(OWN)).toBe("custom");
    // Oznaczeń admina „mój tekst obejmuje pomiar" i ostrzeżenia „szkic traci
    // pomiar" z wariantu (a) nie ma.
    expect(Object.keys(rules)).not.toContain("draftLosesMeasurement");
  });
});

describe("ostrzeżenie R1.24 - własny tekst zgody na newsletter wspomina pomiar", () => {
  it("własny tekst ze słowami pomiaru (PL i EN, dowolna wielkość liter) ostrzega", () => {
    for (const text of [
      "Zapisując się, zgadzasz się na newsletter i pomiar otwarć.",
      "Wiadomości mogą zawierać elementy MIERZĄCE kliknięcia.",
      "Mierzymy otwarcia.",
      "By subscribing you accept the measurement of opens.",
      "We MEASURE clicks.",
    ]) {
      expect(newsletterConsentMentionsMeasurement(text), text).toBe(true);
    }
  });

  it("treść domyślna - także dawna pakietowa (a) z opisem pomiaru - NIE ostrzega", () => {
    expect(newsletterConsentMentionsMeasurement(null)).toBe(false);
    expect(newsletterConsentMentionsMeasurement("")).toBe(false);
    for (const lang of ["pl", "en"] as const) {
      expect(newsletterConsentMentionsMeasurement(newsletterConsentHtml(lang))).toBe(false);
    }
    // (a) jest dawną treścią domyślną - formularz pokazuje zamiast niej (b).
    const bundled = LEGACY_NEWSLETTER_CONSENT_DEFAULTS.filter((t) =>
      CONSENT_MEASUREMENT_MENTION.test(t),
    );
    expect(bundled.length).toBeGreaterThanOrEqual(2);
    for (const text of bundled) expect(newsletterConsentMentionsMeasurement(text)).toBe(false);
  });

  it("własny tekst bez pomiaru nie ostrzega; kopia treści POLA POMIARU w zgodzie na newsletter - ostrzega", () => {
    expect(newsletterConsentMentionsMeasurement(OWN)).toBe(false);
    expect(newsletterConsentMentionsMeasurement(measurementConsentHtml("pl"))).toBe(true);
    expect(newsletterConsentMentionsMeasurement(measurementConsentHtml("en"))).toBe(true);
  });

  it("to samo wyrażenie co kontrola K5b w runbooku (panel i SQL wskazują te same teksty)", () => {
    const runbook = readFileSync(join(process.cwd(), "docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md"), "utf8");
    expect(CONSENT_MEASUREMENT_MENTION.source).toBe("mierz|pomiar|measur");
    expect(CONSENT_MEASUREMENT_MENTION.flags).toContain("i");
    expect(runbook).toContain(`~* '${CONSENT_MEASUREMENT_MENTION.source}'`);
  });
});
