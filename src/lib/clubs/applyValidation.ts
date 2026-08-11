// Walidacja zgloszenia do klubu dyskusyjnego (/club/apply).
//
// Warstwa CZYSTA i wspolna dla obu widokow (anonim i zalogowany): formularz
// jest jeden, a komunikat o bledzie nie moze zalezec od tego, czy uzytkownik
// ma sesje. Funkcja zwraca KLUCZE i18n, nie gotowe zdania - dzieki temu ta
// sama walidacja obsluguje PL i EN, a bramka parytetu widzi klucze w kodzie.
//
// To jest walidacja UI. Serwer (`submitContactMessage`) waliduje niezaleznie
// przez zod i to on jest granica bezpieczenstwa - tutaj chodzi o to, zeby
// uzytkownik zobaczyl blad PRZY POLU, zanim wysle formularz.
import { z } from "zod";

/** Pola formularza objete walidacja po stronie UI. */
export const CLUB_APPLY_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "company",
  "role",
  "specialization",
  "motivation",
  "consent",
] as const;

export type ClubApplyField = (typeof CLUB_APPLY_FIELDS)[number];

export interface ClubApplyValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  specialization: string;
  motivation: string;
  consent: boolean;
}

/** Mapa pole -> klucz i18n komunikatu. Brak wpisu = pole poprawne. */
export type ClubApplyErrors = Partial<Record<ClubApplyField, string>>;

const K = "club.spec.apply.errors";

// Telefon: cyfry, spacje i typowe separatory. Celowo liberalnie - numery
// miedzynarodowe maja zbyt wiele form, zeby odrzucac je regexem.
const PHONE_RE = /^[+]?[\d\s()./-]{6,24}$/;

export const clubApplySchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(2, `${K}.firstNameShort`)
    .max(60, `${K}.firstNameLong`),
  lastName: z.string().trim().max(80, `${K}.lastNameLong`),
  email: z
    .string()
    .trim()
    .min(1, `${K}.emailRequired`)
    .max(254, `${K}.emailLong`)
    .email(`${K}.emailInvalid`),
  phone: z
    .string()
    .trim()
    .max(24, `${K}.phoneInvalid`)
    .refine((v) => v === "" || PHONE_RE.test(v), `${K}.phoneInvalid`),
  company: z.string().trim().max(120, `${K}.companyLong`),
  role: z.string().trim().max(120, `${K}.roleLong`),
  specialization: z.string().trim().min(1, `${K}.specializationRequired`),
  motivation: z
    .string()
    .trim()
    .min(20, `${K}.motivationShort`)
    .max(2000, `${K}.motivationLong`),
  consent: z.boolean().refine((v) => v === true, `${K}.consentRequired`),
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
