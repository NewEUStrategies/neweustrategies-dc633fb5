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
import {
  ilikeEqualityExpressible,
  ilikeEqualsOperand,
  postgrestQuotedList,
  urlEncodedLength,
} from "@/lib/supabase/postgrestFilterValue";

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
 * Jeden adres leada w lookupie awatara - po kluczu, nie po wierszu leada
 * (ten sam adres w wielu leadach pyta bazę raz).
 *
 * `profiles.email` pochodzi z auth (GoTrue zapisuje adres małymi literami),
 * więc pokrywa go dokładne `email.in.(<key>, ...)`. `contact_email` wpisuje
 * członek ręcznie, dowolną wielkością liter - porównujemy go BEZ wielkości
 * liter: `contact_email.ilike.<operand>`, gdzie operand to wzorzec bez
 * wieloznaczników w cudzysłowie PostgREST (lib/supabase/postgrestFilterValue.ts).
 * Wyjątek: adres z `*`. PostgREST zamienia `*` na `%` w każdym wzorcu
 * like/ilike i nie da się tego wyłączyć, więc taki adres idzie porównaniem
 * DOKŁADNYM (`contact_email.in.(...)`) na postaci znormalizowanej i zapisanej
 * w leadzie - jak przed zmianą, bez fałszywych trafień.
 */
export type AvatarLookupKey =
  | {
      /** `normalizeEmail` leada: wartość `email.in.(...)` i klucz mapowania wierszy. */
      readonly key: string;
      /** Operand `contact_email.ilike.<operand>` - równość bez wielkości liter. */
      readonly ilike: string;
      readonly exact?: undefined;
    }
  | {
      readonly key: string;
      readonly ilike?: undefined;
      /** Lista `contact_email.in.(<lista>)` (cytowana) - dla adresu z `*`. */
      readonly exact: string;
    };

export function avatarLookupKeys(leads: readonly LeadEmailRow[]): AvatarLookupKey[] {
  const forms = new Map<string, Set<string>>();
  for (const lead of leads) {
    const key = leadKey(lead);
    if (!key) continue;
    const known = forms.get(key) ?? new Set<string>([key]);
    const raw = (lead.email ?? "").trim();
    if (raw) known.add(raw);
    forms.set(key, known);
  }
  return [...forms].map(([key, written]) =>
    ilikeEqualityExpressible(key)
      ? { key, ilike: ilikeEqualsOperand(key) }
      : { key, exact: postgrestQuotedList([...written]) },
  );
}

/**
 * Narzut liścia `contact_email.<op>.<operand>` w drzewie `or=(...)` ponad sam
 * operand, po kodowaniu URL: `contact_email.ilike.` (20) albo
 * `contact_email.in.(` + `)` (17 + 2 x 3), plus przecinek `%2C` (3) - z zapasem.
 */
const CONTACT_TERM_OVERHEAD = 32;

/** Koszt klucza w adresie URL zapytania `contact_email` (to cięższe z dwóch). */
export function avatarLookupKeyCost(key: AvatarLookupKey): number {
  return urlEncodedLength(key.ilike ?? key.exact) + CONTACT_TERM_OVERHEAD;
}

/**
 * Porcje kluczy: najwyżej `maxItems` i najwyżej `maxEncodedLength` znaków
 * filtra `contact_email` po kodowaniu URL. Liść `ilike` jest kilka razy
 * dłuższy niż wartość listy `in` (escapowanie LIKE, narzut liścia), więc sam
 * limit liczby wartości nie trzyma już długości adresu. Ta sama porcja idzie do
 * obu zapytań - lista `email.in.(...)` jest zawsze krótsza niż filtr kontaktowy.
 * Klucz droższy niż limit dostaje porcję dla siebie (nie znika z lookupu).
 */
export function avatarLookupChunks(
  keys: readonly AvatarLookupKey[],
  limits: { readonly maxItems: number; readonly maxEncodedLength: number },
): AvatarLookupKey[][] {
  const out: AvatarLookupKey[][] = [];
  let current: AvatarLookupKey[] = [];
  let used = 0;
  for (const key of keys) {
    const cost = avatarLookupKeyCost(key);
    if (
      current.length > 0 &&
      (current.length >= limits.maxItems || used + cost > limits.maxEncodedLength)
    ) {
      out.push(current);
      current = [];
      used = 0;
    }
    current.push(key);
    used += cost;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Lead -> awatar. Dopasowanie po adresie logowania (`email`) wygrywa
 * z dopasowaniem po adresie kontaktowym: logowanie jednoznacznie wskazuje
 * konto, a ten sam adres kontaktowy może wpisać więcej niż jedna osoba.
 * W obrębie jednej klasy wygrywa pierwszy wiersz - serwer zadaje kolejność
 * (`order("id")`), więc z kilku członków z tym samym adresem kontaktowym
 * (także zapisanym inną wielkością liter) wygrywa najmniejsze id profilu.
 * Obie strony porównania idą przez `normalizeEmail`: wiersz z bazy mapuje się
 * na leada wyłącznie po własnym adresie, nigdy po tym, którym filtrem przyszedł.
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

/** Podział na porcje - lista id w `.in()` idzie w adresie URL zapytania. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
