// Zdjęcia profilowe na liście leadów CRM: dopasowanie lead -> profil członka
// po adresie e-mail.
//
// DLACZEGO TO NIE JEST ZAPYTANIE Z PRZEGLĄDARKI. `profiles.email`
// i `profiles.contact_email` celowo NIE mają grantu SELECT dla roli
// `authenticated` (kontrakt 20260801120000_restore_min_profile_grants.sql,
// egzekwowany przez pgTAP `pii_column_grants_test` i `profiles_pii_grant_test`).
// PostgREST nie oddaje wtedy pustej kolumny, tylko odrzuca CAŁE zapytanie
// kodem 42501. Lista robiła dokładnie to - klientem, z ignorowanym `error` - więc
// awatary leadów nie renderowały się nigdy, a test trasy był zielony, bo atrapa
// oddawała wiersze, których prawdziwa baza nie wyda.
//
// Grantu NIE otwieramy: polityka odczytu wpuszcza staff do cudzych wierszy
// tenanta, więc grant kolumnowy jest jedyną zaporą przed odczytem adresów
// członków. Lookup idzie serwerem (`getCrmLeadAvatars`, service-role zawężony
// do tenanta wołającego), a ten moduł trzyma wyłącznie regułę dopasowania -
// bez sieci, żeby dało się ją sprawdzić bez atrapy klienta.
import type { Tables } from "@/integrations/supabase/types";

/** Lead w zakresie potrzebnym do dopasowania. */
export type LeadEmailRow = Pick<Tables<"crm_leads">, "id" | "email" | "email_norm">;

/** Profil w zakresie potrzebnym do dopasowania - nic poza tym nie opuszcza serwera. */
export type ProfileAvatarRow = Pick<Tables<"profiles">, "email" | "contact_email" | "avatar_url">;

/**
 * Wynik dla klienta: kluczem jest id leada, NIE adres profilu. Odpowiedź nie
 * niesie żadnej kolumny bez grantu - adres leada staff i tak widzi na liście,
 * a `avatar_url` jest kolumną publiczną.
 */
export interface LeadAvatar {
  readonly lead_id: string;
  readonly avatar_url: string;
}

/** Ten sam klucz co `crm_leads.email_norm` i indeks `profiles(tenant_id, lower(email))`. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function leadKey(lead: LeadEmailRow): string {
  return normalizeEmail(lead.email_norm || lead.email);
}

/**
 * Wartości do filtra `.in()` na `profiles.email` / `profiles.contact_email`.
 *
 * `.in()` porównuje dokładnie, a nie bez wielkości liter. `profiles.email`
 * pochodzi z auth (GoTrue zapisuje adres małymi literami), więc pokrywa go
 * postać znormalizowana. `contact_email` wpisuje członek ręcznie - dlatego
 * obok postaci znormalizowanej idzie też adres leada w zapisanej postaci.
 * Kontakt zapisany inną wielkością liter niż lead pozostaje nietrafiony; to
 * świadoma cena za brak dopasowania wzorcem (`ilike` w `.or()` wymagałby
 * ręcznego escapowania `_`/`%` i cytowania PostgREST).
 */
export function emailLookupValues(leads: readonly LeadEmailRow[]): string[] {
  const values = new Set<string>();
  for (const lead of leads) {
    const key = leadKey(lead);
    if (!key) continue;
    values.add(key);
    const raw = (lead.email ?? "").trim();
    if (raw) values.add(raw);
  }
  return [...values];
}

/**
 * Lead -> awatar. Dopasowanie po adresie logowania (`email`) wygrywa
 * z dopasowaniem po adresie kontaktowym: logowanie jednoznacznie wskazuje
 * konto, a ten sam adres kontaktowy może wpisać więcej niż jedna osoba.
 * W obrębie jednej klasy wygrywa pierwszy wiersz - serwer zadaje kolejność.
 */
export function matchLeadAvatars(
  leads: readonly LeadEmailRow[],
  byEmail: readonly ProfileAvatarRow[],
  byContactEmail: readonly ProfileAvatarRow[],
): LeadAvatar[] {
  const avatarByKey = new Map<string, string>();
  const take = (rows: readonly ProfileAvatarRow[], pick: (row: ProfileAvatarRow) => string) => {
    for (const row of rows) {
      if (!row.avatar_url) continue;
      const key = normalizeEmail(pick(row));
      if (key && !avatarByKey.has(key)) avatarByKey.set(key, row.avatar_url);
    }
  };
  take(byEmail, (row) => row.email ?? "");
  take(byContactEmail, (row) => row.contact_email ?? "");

  const out: LeadAvatar[] = [];
  for (const lead of leads) {
    const avatar = avatarByKey.get(leadKey(lead));
    if (avatar) out.push({ lead_id: lead.id, avatar_url: avatar });
  }
  return out;
}

/** Podział na porcje - lista id/adresów w `.in()` idzie w adresie URL zapytania. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
