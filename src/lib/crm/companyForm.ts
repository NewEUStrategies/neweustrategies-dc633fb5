// Formularz „Nowa firma" - walidacja i mapowanie błędu serwera na KLUCZ.
//
// Dialog (`NewCompanyDialog`) trzymał obie reguły w sobie: warunek „można
// zapisać" siedział w `submit`, a rozpoznanie duplikatu w `onError` obok
// gotowego tekstu w dwóch językach. Reguła wyprowadzona tutaj zwraca klucz,
// więc słownik PL/EN zostaje w panelu, a warunek zapisu da się sprawdzić bez
// renderowania okna.
import { nullIfBlank } from "@/lib/crm/text";

export interface CompanyFormValues {
  name: string;
  domain: string;
  country: string;
  branch: string;
  city: string;
  address: string;
  postal_code: string;
  website: string;
  phone: string;
}

export const EMPTY_COMPANY_FORM: CompanyFormValues = {
  name: "",
  domain: "",
  country: "",
  branch: "",
  city: "",
  address: "",
  postal_code: "",
  website: "",
  phone: "",
};

/** Czy formularz da się wysłać - nazwa jest jedynym polem wymaganym. */
export function canSubmitCompanyForm(form: CompanyFormValues, busy: boolean): boolean {
  return !busy && form.name.trim().length > 0;
}

/**
 * Wartości do wysłania: przycięte, a puste pola POMINIĘTE (nie wysłane jako
 * pusty napis). Serwer normalizuje je dalej do NULL - wysyłanie `""` zapisałoby
 * „firma z pustą domeną" zamiast „bez domeny".
 */
export function companyFormPayload(form: CompanyFormValues): Record<string, string> {
  const payload: Record<string, string> = { name: form.name.trim() };
  for (const key of Object.keys(EMPTY_COMPANY_FORM) as Array<keyof CompanyFormValues>) {
    if (key === "name") continue;
    const value = nullIfBlank(form[key]);
    if (value !== null) payload[key] = value;
  }
  return payload;
}

export type CompanyFormErrorKey = "duplicate_name" | "generic";

/**
 * Błąd serwera -> klucz komunikatu. `duplicate_name` (unikat tenant+nazwa) to
 * jedyny przypadek, w którym użytkownik ma co poprawić; reszta to komunikat
 * ogólny, bo treść błędu bazy nie jest dla niego informacją.
 */
export function companyFormErrorKey(error: unknown): CompanyFormErrorKey {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("duplicate_name") ? "duplicate_name" : "generic";
}
