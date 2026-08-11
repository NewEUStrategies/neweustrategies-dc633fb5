// Kontrakt walidacji zgloszenia klubowego i SEO stron specjalizacji.
//
// Po co test: oba mechanizmy sa "ciche". Zle klucze bledu renderuja surowy
// `club.spec.apply.errors.x` na produkcji, a powielony tytul meta na osmiu
// stronach specjalizacji jest niewidoczny w UI i wychodzi dopiero w indeksie
// wyszukiwarki.
import { describe, expect, it } from "vitest";
import {
  validateClubApply,
  clubApplyValid,
  EMPTY_CLUB_APPLY,
  type ClubApplyValues,
} from "@/lib/clubs/applyValidation";
import { CLUB_SPECIALIZATIONS } from "@/lib/clubs/specializations";
import { specializationSeoCopy, CLUB_SPECIALIZATION_SEO } from "@/lib/clubs/specializationHead";
import { clubPl, clubEn } from "@/lib/i18n-club";

const VALID: ClubApplyValues = {
  ...EMPTY_CLUB_APPLY,
  firstName: "Anna",
  lastName: "Kowalska",
  email: "anna@example.com",
  phone: "+48 600 100 200",
  company: "Instytut",
  jobPosition: "Analityk",
  seniority: "expert",
  industry: "energy",
  country: "Polska",
  expertise: "Rynek gazu, kontrakty długoterminowe i regulacje UE.",
  specialization: "energy",
  availability: "monthly",
  motivation: "Zajmuję się rynkiem gazu i chcę współtworzyć rekomendacje.",
  goals: "Chcę wypracować stanowisko o cenach gazu.",
  consent: true,
};

function readKey(tree: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, tree);
}

describe("walidacja /club/apply", () => {
  it("poprawne zgłoszenie nie ma błędów", () => {
    expect(clubApplyValid(validateClubApply(VALID))).toBe(true);
  });

  it("wymaga kompletu pól obowiązkowych", () => {
    const errors = validateClubApply(EMPTY_CLUB_APPLY);
    expect(Object.keys(errors).sort()).toEqual([
      "availability",
      "company",
      "consent",
      "country",
      "email",
      "expertise",
      "firstName",
      "goals",
      "industry",
      "jobPosition",
      "lastName",
      "motivation",
      "phone",
      "seniority",
      "specialization",
    ]);
  });

  it("odrzuca niepoprawny e-mail i telefon, przyjmuje pusty telefon", () => {
    expect(validateClubApply({ ...VALID, email: "anna(at)example" }).email).toBe(
      "club.spec.apply.errors.emailInvalid",
    );
    expect(validateClubApply({ ...VALID, phone: "abc" }).phone).toBe(
      "club.spec.apply.errors.phoneInvalid",
    );
    expect(validateClubApply({ ...VALID, phone: "" }).phone).toBe(
      "club.spec.apply.errors.phoneRequired",
    );
    expect(validateClubApply({ ...VALID, linkedinUrl: "example.com" }).linkedinUrl).toBe(
      "club.spec.apply.errors.linkedinInvalid",
    );
    expect(validateClubApply({ ...VALID, yearsExperience: "abc" }).yearsExperience).toBe(
      "club.spec.apply.errors.yearsInvalid",
    );
  });

  it("każdy klucz błędu istnieje w PL i EN", () => {
    const cases: ClubApplyValues[] = [
      { ...VALID, firstName: "" },
      { ...VALID, firstName: "x".repeat(61) },
      { ...VALID, lastName: "x".repeat(81) },
      { ...VALID, email: "" },
      { ...VALID, email: "nope" },
      { ...VALID, phone: "abc" },
      { ...VALID, company: "" },
      { ...VALID, jobPosition: "x".repeat(121) },
      { ...VALID, seniority: "" },
      { ...VALID, industry: "" },
      { ...VALID, country: "" },
      { ...VALID, availability: "" },
      { ...VALID, expertise: "krótko" },
      { ...VALID, goals: "" },
      { ...VALID, linkedinUrl: "nope" },
      { ...VALID, yearsExperience: "abc" },
      { ...VALID, specialization: "" },
      { ...VALID, motivation: "krótko" },
      { ...VALID, motivation: "x".repeat(2001) },
      { ...VALID, consent: false },
    ];
    const keys = new Set(cases.flatMap((c) => Object.values(validateClubApply(c))));
    expect(keys.size).toBeGreaterThanOrEqual(18);
    for (const key of keys) {
      expect(typeof readKey(clubPl, key), `PL: ${key}`).toBe("string");
      expect(typeof readKey(clubEn, key), `EN: ${key}`).toBe("string");
    }
  });
});

describe("SEO stron specjalizacji", () => {
  it("każda specjalizacja ma tekst PL i EN", () => {
    for (const spec of CLUB_SPECIALIZATIONS) {
      expect(CLUB_SPECIALIZATION_SEO[spec.key], spec.key).toBeDefined();
      for (const lang of ["pl", "en"] as const) {
        const copy = specializationSeoCopy(spec.slug, lang);
        expect(copy.title.length, `${spec.slug}/${lang}`).toBeGreaterThan(10);
        expect(copy.title.length).toBeLessThan(70);
        expect(copy.description.length).toBeGreaterThan(80);
        expect(copy.description.length).toBeLessThan(170);
      }
    }
  });

  it("tytuły i opisy są unikalne w obrębie języka", () => {
    for (const lang of ["pl", "en"] as const) {
      const titles = CLUB_SPECIALIZATIONS.map((s) => specializationSeoCopy(s.slug, lang).title);
      const descriptions = CLUB_SPECIALIZATIONS.map(
        (s) => specializationSeoCopy(s.slug, lang).description,
      );
      expect(new Set(titles).size).toBe(titles.length);
      expect(new Set(descriptions).size).toBe(descriptions.length);
    }
  });

  it("nieznany slug dostaje bezpieczny fallback", () => {
    expect(specializationSeoCopy("nie-ma-takiej", "pl").title).toContain("Specjalizacje");
    expect(specializationSeoCopy("nie-ma-takiej", "en").title).toContain("specialisations");
  });
});
