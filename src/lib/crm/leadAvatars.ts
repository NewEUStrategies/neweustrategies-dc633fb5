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
 * Porównanie adresu kontaktowego BEZ wielkości liter - tak, jak robi to baza.
 *
 * `ILIKE` w PostgreSQL 16 (baza UTF-8) to `lower(tekst) LIKE lower(wzorzec)`,
 * a `lower()` dostawcy libc to `towlower()` glibc ZNAK PO ZNAKU: prosta mapa
 * 1:1 z UnicodeData, bez reguł kontekstowych. JS `toLowerCase()` całego
 * napisu robi co innego: `İ` (U+0130) daje dwa znaki `i̇` (i + U+0307), a `Σ`
 * na końcu słowa - `ς`. Sprawdzone na PG 16.15 (glibc 2.39, C.UTF-8):
 * `lower('İ')` = `i`, `lower('ΟΔΟΣ')` = `οδοσ`, `lower('ẞ')` = `ß`,
 * `lower('ı')` = `ı`; `'İzmir@x.tr' ILIKE 'i̇zmir@x.tr'` i
 * `'ΟΔΟΣ@x.gr' ILIKE 'οδος@x.gr'` - fałsz.
 *
 * `pgCaseFold` to `lower()` bazy ZAWĘŻONY do znaków, w których JS i glibc
 * zgadzają się na pewno: U+0000-U+058F (łacina z rozszerzeniami A i B, IPA,
 * grecki, cyrylica z suplementem, ormiański) i U+1E00-U+1EFF (łacina
 * rozszerzona dodatkowa, m.in. `ẞ`), plus `İ` -> `i` jak w glibc. Ostatnie
 * pary wielkości liter w tych blokach doszły w Unicode 7.0 (2014). Pełne
 * porównanie wszystkich punktów kodowych (PG16 vs JS z Unicode 17) różni się
 * WYŁĄCZNIE w U+0130 i w literach z Unicode 16+, spoza tych zakresów. Poza
 * zakresami - tożsamość.
 *
 * Dlaczego zawężony: z równości `pgCaseFold` wynika równość `lower()` w bazie
 * (litera po literze), więc wiersz, któremu przypisujemy zdjęcie, zwraca ZAWSZE
 * liść samego tego leada - karta (jeden lead) i lista (strona leadów) widzą to
 * samo. Litera z nowszego Unicode, którą JS zna, a glibc bazy jeszcze nie,
 * odwróciłaby tę implikację: wiersz przyniesiony na liście liściem innego
 * leada i przypisany temu - zdjęcie na liście, brak na karcie. Odwrotnej
 * różnicy (baza zrównuje, `pgCaseFold` nie) nie szkodzi: brak zdjęcia, ten sam
 * w obu widokach.
 */
export function pgCaseFold(value: string): string {
  let out = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x130) out += "i";
    else if (cp <= 0x58f || (cp >= 0x1e00 && cp <= 0x1eff)) out += ch.toLowerCase();
    else out += ch;
  }
  return out;
}

/**
 * Jeden adres leada w lookupie awatara - po postaciach adresu, nie po wierszu
 * leada (leady o tych samych postaciach pytają bazę raz).
 *
 * `profiles.email` pochodzi z auth (GoTrue zapisuje adres małymi literami),
 * więc pokrywa go dokładne `email.in.(<key>, ...)`. `contact_email` wpisuje
 * członek ręcznie, dowolną wielkością liter - porównujemy go BEZ wielkości
 * liter (`contact_email.ilike.<operand>`, wzorzec bez wieloznaczników
 * w cudzysłowie PostgREST, lib/supabase/postgrestFilterValue.ts) z KAŻDĄ
 * zapisaną postacią adresu leada: kluczem i adresem z leada. Sam klucz nie
 * wystarcza: to JS `toLowerCase`, a baza porównuje swoim `lower()`. Lead
 * i kontakt `İzmir@x.tr` (U+0130) albo `ΟΔΟΣ@x.gr` dają klucz `i̇zmir@x.tr` /
 * `οδος@x.gr`, którego `ILIKE` identycznego adresu w bazie NIE znajduje - przed
 * 2026-11-16 znajdował go dokładny `in` z postacią zapisaną. Postaci o równym
 * `pgCaseFold` dają ten sam wynik `ILIKE`, więc idzie jeden liść na klasę.
 *
 * Postaci są WŁASNE dla leada, nie wspólne dla klucza: `ΟΔΟΣ@x.gr`
 * i `οδος@x.gr` mają ten sam klucz JS, ale baza zrównuje z kontaktem
 * `ΟΔΟΣ@x.gr` tylko pierwszy. Postać pożyczona od innego leada strony dałaby
 * zdjęcie na liście, którego karta (jeden lead) nie pokaże.
 *
 * Wyjątek: postać z `*`. PostgREST zamienia `*` na `%` w każdym wzorcu
 * like/ilike i nie da się tego wyłączyć, więc taka postać idzie porównaniem
 * DOKŁADNYM (`contact_email.in.(...)`) - bez fałszywych trafień.
 */
export interface AvatarLookupKey {
  /** Tożsamość wpisu (klucz i postaci) - po niej leady odbierają wynik. */
  readonly id: string;
  /** `normalizeEmail` leada: wartość `email.in.(...)`. */
  readonly key: string;
  /** Postaci bez `*`, po jednej na klasę `pgCaseFold` - liść `contact_email.ilike` na każdą. */
  readonly ilike: readonly string[];
  /** Postaci z `*` - jeden liść `contact_email.in.(...)`, porównanie dokładne. */
  readonly exact: readonly string[];
}

function lookupKeyOf(lead: LeadEmailRow): AvatarLookupKey | null {
  const key = leadKey(lead);
  if (!key) return null;
  const raw = (lead.email ?? "").trim();
  const ilike: string[] = [];
  const exact: string[] = [];
  const folds = new Set<string>();
  for (const form of new Set(raw ? [key, raw] : [key])) {
    if (!ilikeEqualityExpressible(form)) {
      exact.push(form);
      continue;
    }
    const fold = pgCaseFold(form);
    if (folds.has(fold)) continue;
    folds.add(fold);
    ilike.push(form);
  }
  return { id: JSON.stringify([key, ilike, exact]), key, ilike, exact };
}

export function avatarLookupKeys(leads: readonly LeadEmailRow[]): AvatarLookupKey[] {
  const byId = new Map<string, AvatarLookupKey>();
  for (const lead of leads) {
    const entry = lookupKeyOf(lead);
    if (entry && !byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/** Liście `contact_email` jednego klucza w drzewie `or=(...)` - operandy już cytowane. */
export function contactFilterLeaves(key: AvatarLookupKey): string[] {
  const leaves = key.ilike.map((form) => `contact_email.ilike.${ilikeEqualsOperand(form)}`);
  if (key.exact.length > 0) leaves.push(`contact_email.in.(${postgrestQuotedList(key.exact)})`);
  return leaves;
}

/**
 * Filtr `contact_email` porcji - argument `.or()` (postgrest-js dokleja
 * nawiasy). Przecinek, kropka, nawias, dwukropek ani cudzysłów w adresie nie
 * zmieniają filtra: każdy operand jest cytowany. Identyczny liść dwóch wpisów
 * (np. klucz `οδος@x.gr` leadów `ΟΔΟΣ@x.gr` i `οδος@x.gr`) idzie raz.
 */
export function contactFilter(keys: readonly AvatarLookupKey[]): string {
  return [...new Set(keys.flatMap(contactFilterLeaves))].join(",");
}

/**
 * Narzut klucza ponad jego liście po kodowaniu URL: przecinek `%2C` (3) przed
 * następnym kluczem i nawiasy `%28`/`%29` (6) parametru `or=(...)` - liczone
 * przy każdym kluczu, z zapasem.
 */
const CONTACT_KEY_OVERHEAD = 9;

/** Koszt klucza w adresie URL zapytania `contact_email` (to cięższe z dwóch). */
export function avatarLookupKeyCost(key: AvatarLookupKey): number {
  return urlEncodedLength(contactFilterLeaves(key).join(",")) + CONTACT_KEY_OVERHEAD;
}

/**
 * Porcje kluczy: najwyżej `maxItems` i najwyżej `maxEncodedLength` znaków
 * filtra `contact_email` po kodowaniu URL. Liść `ilike` jest kilka razy
 * dłuższy niż wartość listy `in` (escapowanie LIKE, narzut liścia), a klucz
 * może mieć kilka liści, więc sam limit liczby wartości nie trzyma długości
 * adresu. Ta sama porcja idzie do obu zapytań - lista `email.in.(...)` jest
 * zawsze krótsza niż filtr kontaktowy (klucz jest pierwszą postacią).
 *
 * Klucz droższy niż `maxEncodedLength` jest POMIJANY - lead zostaje bez
 * zdjęcia na liście i na karcie. Wysłany nawet sam przekroczyłby limit linii
 * żądania, a odrzucone zapytanie wywróciłoby lookup całej strony (lista -
 * błąd, karta - log). Taki adres nie jest poprawnym e-mailem (RFC 5321: 254
 * znaki); schemat bazy długości adresu nie ogranicza, więc limit trzymamy tu.
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
    if (cost > limits.maxEncodedLength) continue;
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
 * Zdjęcie dla wpisów JEDNEJ porcji (mapa po `AvatarLookupKey.id`) - wyłącznie
 * z wierszy, które przyniosły zapytania tej porcji, w kolejności serwera
 * (`order("id")`).
 *
 * Dopasowanie po adresie logowania (`email`) wygrywa z dopasowaniem po
 * adresie kontaktowym: logowanie jednoznacznie wskazuje konto, a ten sam
 * adres kontaktowy może wpisać więcej niż jedna osoba. W obrębie klasy wygrywa
 * pierwszy wiersz, więc z kilku członków z tym samym adresem kontaktowym
 * (także zapisanym inną wielkością liter) - najmniejsze id profilu.
 *
 * Wiersz trafia do klucza tylko wtedy, gdy zwróciłby go SAM liść tego klucza:
 * logowanie - `normalizeEmail(email)` równy kluczowi (`email.in` przynosi
 * wyłącznie klucze porcji, a te są już znormalizowane); kontakt - adres równy
 * postaci dokładnej albo `pgCaseFold` równy `pgCaseFold` postaci `ilike`.
 * Nigdy po tym, którym filtrem wiersz przyszedł, i nigdy po JS
 * `toLowerCase`: wiersz przyniesiony na liście liściem INNEGO leada (np.
 * `ΟΔΟΣ@x.gr` liściem `οδοσ@x.gr`) dałby wtedy zdjęcie leadowi `οδος@x.gr`,
 * którego karta (jeden lead) go nie widzi.
 *
 * Dlaczego per porcja: wiersz pasujący do klucza jest zawsze w porcji tego
 * klucza, ale może przyjść też w innej (liściem innego leada). Wybór po
 * połączeniu porcji oddałby pierwszy wiersz w kolejności porcji, a nie
 * najmniejsze id - inne zdjęcie niż na karcie.
 */
export function matchChunkAvatars(
  keys: readonly AvatarLookupKey[],
  byEmail: readonly ProfileAvatarRow[],
  byContactEmail: readonly ProfileAvatarRow[],
): Map<string, string> {
  const login = new Map<string, string>();
  for (const row of byEmail) {
    const key = normalizeEmail(row.email);
    if (row.avatar_url && key && !login.has(key)) login.set(key, row.avatar_url);
  }
  // Pierwszy wiersz (najmniejsze id) dla adresu dokładnego i dla klasy `pgCaseFold`.
  const firstExact = new Map<string, number>();
  const firstFold = new Map<string, number>();
  byContactEmail.forEach((row, index) => {
    if (!row.avatar_url || !row.contact_email) return;
    if (!firstExact.has(row.contact_email)) firstExact.set(row.contact_email, index);
    const fold = pgCaseFold(row.contact_email);
    if (!firstFold.has(fold)) firstFold.set(fold, index);
  });

  const out = new Map<string, string>();
  for (const key of keys) {
    const own = login.get(key.key);
    if (own) {
      out.set(key.id, own);
      continue;
    }
    let best: number | undefined;
    const consider = (index: number | undefined) => {
      if (index !== undefined && (best === undefined || index < best)) best = index;
    };
    for (const form of key.exact) consider(firstExact.get(form));
    for (const form of key.ilike) consider(firstFold.get(pgCaseFold(form)));
    const avatar = best === undefined ? null : byContactEmail[best]?.avatar_url;
    if (avatar) out.set(key.id, avatar);
  }
  return out;
}

/** Lead -> awatar po jego wpisie lookupu (mapa `matchChunkAvatars` ze wszystkich porcji). */
export function leadAvatarsByKey(
  leads: readonly LeadEmailRow[],
  avatarByKey: ReadonlyMap<string, string>,
): LeadAvatar[] {
  const out: LeadAvatar[] = [];
  for (const lead of leads) {
    const entry = lookupKeyOf(lead);
    const avatar = entry ? avatarByKey.get(entry.id) : undefined;
    if (avatar) out.push({ lead_id: lead.id, avatar_url: avatar });
  }
  return out;
}

/** Reguła dopasowania dla wszystkich leadów w JEDNEJ porcji (bez podziału zapytań). */
export function matchLeadAvatars(
  leads: readonly LeadEmailRow[],
  byEmail: readonly ProfileAvatarRow[],
  byContactEmail: readonly ProfileAvatarRow[],
): LeadAvatar[] {
  return leadAvatarsByKey(
    leads,
    matchChunkAvatars(avatarLookupKeys(leads), byEmail, byContactEmail),
  );
}

/** Podział na porcje - lista id w `.in()` idzie w adresie URL zapytania. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
