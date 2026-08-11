// Walidacja zgloszenia do klubu dyskusyjnego (/club/apply).
//
// Warstwa CZYSTA: zwraca KLUCZE i18n, nie gotowe zdania - ta sama walidacja
// obsluguje PL i EN, a bramka parytetu widzi klucze w kodzie. Serwer
// (`club_apply_submit`) waliduje niezaleznie i to on jest granica
// bezpieczenstwa; tutaj chodzi o blad PRZY POLU, zanim formularz wyjdzie.
//
// Formularz jest dluzszy niz kontaktowy swiadomie: komisja rozpatruje
// zgloszenie bez rozmowy wstepnej, wiec profil zawodowy musi byc kompletny.
import { z } from "zod";

/** Pola formularza objete walidacja po stronie UI. */
export const CLUB_APPLY_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "company",
  "jobPosition",
  "seniority",
  "industry",
  "country",
  "city",
  "linkedinUrl",
  "yearsExperience",
  "expertise",
  "languages",
  "specialization",
  "clubId",
  "motivation",
  "goals",
  "contribution",
  "availability",
  "referralSource",
  "consent",
] as const;

export type ClubApplyField = (typeof CLUB_APPLY_FIELDS)[number];

export interface ClubApplyValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  jobPosition: string;
  seniority: string;
  industry: string;
  country: string;
  city: string;
  linkedinUrl: string;
  yearsExperience: string;
  expertise: string;
  languages: string;
  specialization: string;
  clubId: string;
  motivation: string;
  goals: string;
  contribution: string;
  availability: string;
  referralSource: string;
  consent: boolean;
  marketingConsent: boolean;
}

/** Mapa pole -> klucz i18n komunikatu. Brak wpisu = pole poprawne. */
export type ClubApplyErrors = Partial<Record<ClubApplyField, string>>;

const K = "club.spec.apply.errors";

// Telefon: cyfry, spacje i typowe separatory. Celowo liberalnie - numery
// miedzynarodowe maja zbyt wiele form, zeby odrzucac je regexem.
const PHONE_RE = /^[+]?[\d\s()./-]{6,24}$/;
const LINKEDIN_RE = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i;

const optionalText = (max: number, key: string) => z.string().trim().max(max, key);

export const clubApplySchema = z.object({
  firstName: z.string().trim().min(2, `${K}.firstNameShort`).max(60, `${K}.firstNameLong`),
  lastName: z.string().trim().min(2, `${K}.lastNameShort`).max(80, `${K}.lastNameLong`),
  email: z
    .string()
    .trim()
    .min(1, `${K}.emailRequired`)
    .max(254, `${K}.emailLong`)
    .email(`${K}.emailInvalid`),
  phone: z
    .string()
    .trim()
    .min(1, `${K}.phoneRequired`)
    .max(24, `${K}.phoneInvalid`)
    .refine((v) => PHONE_RE.test(v), `${K}.phoneInvalid`),
  company: z.string().trim().min(2, `${K}.companyRequired`).max(120, `${K}.companyLong`),
  jobPosition: z.string().trim().min(2, `${K}.jobPositionRequired`).max(120, `${K}.roleLong`),
  seniority: z.string().trim().min(1, `${K}.seniorityRequired`),
  industry: z.string().trim().min(1, `${K}.industryRequired`),
  country: z.string().trim().min(2, `${K}.countryRequired`).max(80, `${K}.countryLong`),
  city: optionalText(80, `${K}.cityLong`),
  linkedinUrl: z
    .string()
    .trim()
    .max(200, `${K}.linkedinLong`)
    .refine((v) => v === "" || LINKEDIN_RE.test(v), `${K}.linkedinInvalid`),
  yearsExperience: z
    .string()
    .trim()
    .refine((v) => {
      if (v === "") return true;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= 70;
    }, `${K}.yearsInvalid`),
  expertise: z.string().trim().min(10, `${K}.expertiseShort`).max(500, `${K}.expertiseLong`),
  languages: optionalText(200, `${K}.languagesLong`),
  specialization: z.string().trim().min(1, `${K}.specializationRequired`),
  clubId: z.string().trim().max(64, `${K}.clubInvalid`),
  motivation: z.string().trim().min(20, `${K}.motivationShort`).max(2000, `${K}.motivationLong`),
  goals: z.string().trim().min(10, `${K}.goalsShort`).max(1000, `${K}.goalsLong`),
  contribution: optionalText(1000, `${K}.contributionLong`),
  availability: z.string().trim().min(1, `${K}.availabilityRequired`),
  referralSource: optionalText(120, `${K}.referralLong`),
  consent: z.boolean().refine((v) => v === true, `${K}.consentRequired`),
  marketingConsent: z.boolean(),
});

/**
 * Sprawdza caly formularz i zwraca po JEDNYM (pierwszym) kluczu bledu na pole.
 * Jeden komunikat na pole jest swiadomy: lista trzech uwag pod jednym inputem
 * jest nieczytelna, a uzytkownik i tak poprawia bledy po kolei.
 */
export function validateClubApply(values: ClubApplyValues): ClubApplyErrors {
  const parsed = clubApplySchema.safeParse(values);
  if (parsed.success) return {};
  const out: ClubApplyErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;
    if (!(CLUB_APPLY_FIELDS as readonly string[]).includes(field)) continue;
    const key = field as ClubApplyField;
    if (out[key] === undefined) out[key] = issue.message;
  }
  return out;
}

/** Czy mapa bledow jest pusta. */
export function clubApplyValid(errors: ClubApplyErrors): boolean {
  return Object.keys(errors).length === 0;
}

/** Pusty formularz - jedno zrodlo stanu poczatkowego dla widoku i testow. */
export const EMPTY_CLUB_APPLY: ClubApplyValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  jobPosition: "",
  seniority: "",
  industry: "",
  country: "",
  city: "",
  linkedinUrl: "",
  yearsExperience: "",
  expertise: "",
  languages: "",
  specialization: "",
  clubId: "",
  motivation: "",
  goals: "",
  contribution: "",
  availability: "",
  referralSource: "",
  consent: false,
  marketingConsent: false,
};

/** Klucze i18n opcji list rozwijanych (stalosc wartosci = stalosc raportow). */
export const CLUB_APPLY_SENIORITY = [
  "board",
  "c_level",
  "director",
  "head",
  "manager",
  "expert",
  "advisor",
  "academic",
  "other",
] as const;

export const CLUB_APPLY_INDUSTRY = [
  "public_administration",
  "defence",
  "energy",
  "finance",
  "transport",
  "technology",
  "legal",
  "media",
  "academia",
  "ngo",
  "consulting",
  "other",
] as const;

export const CLUB_APPLY_AVAILABILITY = ["monthly", "quarterly", "ad_hoc", "observer"] as const;
