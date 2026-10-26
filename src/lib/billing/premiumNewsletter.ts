// Czysta logika zapisu płacącego subskrybenta na newsletter premium.
// Bez zależności serwerowych, żeby dało się ją testować i współdzielić: trasa
// checkoutu renderuje treść zgody Z TEGO MODUŁU, a serwer zapisuje jako dowód
// dokładnie tę samą treść (ta sama wersja, ten sam język).
//
// PODSTAWA PRAWNA: WYŁĄCZNIE ZGODA (audyt rozliczeń, SUB-15). Sprawdzone, czym
// ten „newsletter premium" jest w kodzie: kampanie idą do CAŁEJ listy
// `newsletter_subscribers` o statusie `subscribed` (filtr po statusie, języku
// i źródle - bez osobnej treści dla klientów), wiersz `subscribed` zapala
// w CRM `marketing_consent` (wyzwalacz `newsletter_to_lead`), a wypis jest
// wycofaniem zgody marketingowej (wyzwalacz `trg_newsletter_unsubscribed_
// withdraw_crm`, 20261026120000). To komunikacja marketingowa (art. 398 PKE),
// nie treść opłaconej usługi - podstawa „umowa" nie pasuje do tego modelu
// i nie ma w potoku wysyłki żadnego rozróżnienia, które by ją obsłużyło.
// Dlatego zakup SAM W SOBIE nie dotyka listy, a wpis powstaje tylko po jawnym,
// domyślnie niezaznaczonym polu w checkoucie (art. 4 pkt 11 i art. 7 ust. 1
// RODO). Wcześniej każdy zakup dopisywał `granted: true` ze źródłem
// `subscription_checkout`, choć checkout nie miał żadnego pola zgody.
import type { Json } from "@/integrations/supabase/types";

export type NewsletterLanguage = "pl" | "en";

/** Klucz zgody udzielanej polem w checkoucie subskrypcji. */
export const PREMIUM_NEWSLETTER_CONSENT = "newsletter_premium";

/** Źródło wpisu - odróżnia zgodę z checkoutu od zgód z formularzy na stronie. */
export const PREMIUM_NEWSLETTER_CONSENT_SOURCE = "subscription_checkout";

/** `source_form_name` wiersza i wpisu w rejestrze `crm_consent_log`. */
export const PREMIUM_NEWSLETTER_FORM_NAME = "Subskrypcja premium";

/**
 * REJESTR WERSJI TREŚCI ZGODY. Wersji raz wydanej NIE zmienia się i NIE usuwa:
 * kupujący, który otworzył checkout przed wdrożeniem nowej treści, wyśle starą
 * wersję, a dowodem ma być dokładnie ten tekst, który widział. Zmiana treści =
 * nowy klucz + przestawienie `PREMIUM_NEWSLETTER_CONSENT_VERSION`.
 *
 * Tekst jest PEŁNY (zakres, kanał, dobrowolność, sposób wycofania) - zapisujemy
 * go w całości, bez skracania, tak jak treści zgód z formularzy.
 */
export const PREMIUM_NEWSLETTER_CONSENT_TEXTS: Readonly<
  Record<string, Readonly<Record<NewsletterLanguage, string>>>
> = {
  "2026-10-12": {
    pl: "Wyrażam zgodę na otrzymywanie drogą elektroniczną, na adres e-mail mojego konta, newslettera z informacjami handlowymi (analizy, zaproszenia na wydarzenia, oferty). Zgoda jest dobrowolna i nie jest warunkiem zakupu; mogę ją wycofać w każdej chwili linkiem w każdej wiadomości.",
    en: "I agree to receive, by e-mail at my account address, the newsletter with commercial information (analyses, event invitations, offers). Consent is voluntary and not a condition of purchase; I can withdraw it at any time via the link in every message.",
  },
};

/** Wersja treści pokazywana dziś w checkoucie. */
export const PREMIUM_NEWSLETTER_CONSENT_VERSION = "2026-10-12";

/**
 * Najstarsza zgoda, którą skutek zakupu jeszcze honoruje. Zgoda jedzie
 * metadanymi subskrypcji u operatora i zostaje tam na cały jej żywot, więc bez
 * tej granicy ręczne ponowienie starego zdarzenia (panel webhooków) albo
 * późniejsze zdarzenie tej samej subskrypcji odtworzyłoby zapis z decyzji
 * sprzed miesięcy - np. po usunięciu wiersza na żądanie osoby. 30 dni pokrywa
 * dobę życia sesji checkoutu, płatności odroczone przed pierwszą opłaconą
 * fakturą i trzydniowy horyzont ponowień operatora.
 */
export const PREMIUM_NEWSLETTER_CONSENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Tolerancja rozjazdu zegarów: zgoda „z przyszłości" ponad to jest odrzucana. */
const CONSENT_CLOCK_SKEW_MS = 10 * 60 * 1000;

export function isPremiumNewsletterConsentVersion(version: string): boolean {
  return Object.hasOwn(PREMIUM_NEWSLETTER_CONSENT_TEXTS, version);
}

/** Pełna treść zgody danej wersji w danym języku albo `null` dla nieznanej wersji. */
export function premiumNewsletterConsentText(
  version: string,
  lang: NewsletterLanguage,
): string | null {
  return isPremiumNewsletterConsentVersion(version)
    ? PREMIUM_NEWSLETTER_CONSENT_TEXTS[version][lang]
    : null;
}

export function normalizeNewsletterLanguage(value: string | null | undefined): NewsletterLanguage {
  return value?.toLowerCase().startsWith("en") ? "en" : "pl";
}

/**
 * Zgoda wyrażona polem w checkoucie - to, co jedzie od server function przez
 * metadane sesji i subskrypcji operatora do webhooka.
 */
export interface PremiumNewsletterConsentGrant {
  version: string;
  lang: NewsletterLanguage;
  /** Chwila przyjęcia zaznaczonego pola przez serwer (utworzenie sesji, zegar serwera). */
  at: string;
  /** Zamówienie `payment_orders`, przy którym padła zgoda - wiąże dowód z kontem. */
  orderId: string | null;
}

/**
 * Klucze metadanych operatora. Treści NIE wysyłamy (limit 500 znaków na wartość,
 * a treść żyje w rejestrze wersji) - wystarczy wersja i język.
 */
const CONSENT_METADATA_KEYS = {
  version: "newsletterConsentVersion",
  lang: "newsletterConsentLang",
  at: "newsletterConsentAt",
} as const;

/** Metadane sesji/subskrypcji niosące zgodę (wyłącznie gdy pole zaznaczono). */
export function premiumNewsletterConsentMetadata(
  grant: Pick<PremiumNewsletterConsentGrant, "version" | "lang" | "at">,
): Record<string, string> {
  return {
    [CONSENT_METADATA_KEYS.version]: grant.version,
    [CONSENT_METADATA_KEYS.lang]: grant.lang,
    [CONSENT_METADATA_KEYS.at]: grant.at,
  };
}

function metaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Odczyt zgody z metadanych operatora. Brak którejkolwiek części = BRAK zgody
 * (a nie zgoda z wartościami domyślnymi): język albo chwila dopowiedziana przez
 * kod byłyby dowodem, którego nikt nie złożył.
 */
export function readPremiumNewsletterConsentMetadata(
  metadata: Record<string, unknown> | null | undefined,
): PremiumNewsletterConsentGrant | null {
  if (!metadata) return null;
  const version = metaString(metadata, CONSENT_METADATA_KEYS.version);
  const lang = metaString(metadata, CONSENT_METADATA_KEYS.lang);
  const at = metaString(metadata, CONSENT_METADATA_KEYS.at);
  if (!version || !at || (lang !== "pl" && lang !== "en")) return null;
  return { version, lang, at, orderId: metaString(metadata, "orderId") };
}

/**
 * Wpis zgody w kanonicznym kształcie kolumny `consents` (ten sam, który
 * zapisują formularze przez `newsletter.functions.ts` i który czytają panel
 * subskrybenta oraz wyzwalacz rejestru `crm_consent_log`: `key`, `text`,
 * `version`, `given`, `lang`, `timestamp`, `received_at`), uzupełniony o dowód
 * pochodzenia z checkoutu. Dawny wpis miał `granted`, którego nikt nie czyta -
 * panel pokazywał go jako „brak", a rejestr zgód pomijał (brak `text`).
 */
export interface NewsletterConsentEntry {
  [key: string]: string | boolean | null;
  key: string;
  /** Pełna treść, którą zobaczył kupujący. */
  text: string;
  version: string;
  given: boolean;
  lang: NewsletterLanguage;
  /** Chwila wyrażenia zgody (przyjęcie zaznaczonego pola przez serwer). */
  timestamp: string;
  /** Chwila zapisu na listę (skutek opłaconej subskrypcji). */
  received_at: string;
  source: string;
  subscription_id: string;
  order_id: string | null;
}

/**
 * Wpis zgody z checkoutu albo `null`, gdy zgody nie ma albo jest nieważna:
 * nieznana wersja treści, język spoza pl/en, nieczytelna chwila, zgoda starsza
 * niż `PREMIUM_NEWSLETTER_CONSENT_MAX_AGE_MS` albo „z przyszłości". `null`
 * znaczy dla wołającego jedno: niczego nie zapisuj.
 */
export function buildPremiumNewsletterConsentEntry(input: {
  grant: PremiumNewsletterConsentGrant | null | undefined;
  subscriptionId: string;
  now?: Date;
}): NewsletterConsentEntry | null {
  const grant = input.grant;
  if (!grant || typeof grant !== "object") return null;
  if (grant.lang !== "pl" && grant.lang !== "en") return null;
  const text =
    typeof grant.version === "string"
      ? premiumNewsletterConsentText(grant.version, grant.lang)
      : null;
  if (!text) return null;
  const givenAt = typeof grant.at === "string" ? Date.parse(grant.at) : Number.NaN;
  if (Number.isNaN(givenAt)) return null;
  const now = (input.now ?? new Date()).getTime();
  if (givenAt > now + CONSENT_CLOCK_SKEW_MS) return null;
  if (now - givenAt > PREMIUM_NEWSLETTER_CONSENT_MAX_AGE_MS) return null;
  return {
    key: PREMIUM_NEWSLETTER_CONSENT,
    text,
    version: grant.version,
    given: true,
    lang: grant.lang,
    timestamp: new Date(givenAt).toISOString(),
    received_at: new Date(now).toISOString(),
    source: PREMIUM_NEWSLETTER_CONSENT_SOURCE,
    subscription_id: input.subscriptionId,
    order_id: typeof grant.orderId === "string" && grant.orderId ? grant.orderId : null,
  };
}

export interface PremiumNewsletterRow {
  tenant_id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  language: NewsletterLanguage;
  status: "subscribed";
  source: string;
  source_form_name: string;
  confirmed_at: string;
  unsubscribed_at: null;
  consents: NewsletterConsentEntry[];
  meta: Record<string, string>;
}

/**
 * Wiersz `newsletter_subscribers` dla adresu, którego NIE MA jeszcze na liście.
 * Istniejący wiersz nigdy nie przechodzi przez tę funkcję - jego dowody scala
 * `mergeNewsletterConsents`.
 *
 * Zapis jest potwierdzony od razu: zgodę złożył właściciel ZALOGOWANEGO konta,
 * którego adres przeszedł potwierdzenie przy rejestracji
 * (`auth.email.enable_confirmations`), a dowodem jest wpis w `consents`, który
 * da się wykazać i wycofać. Język listy to język, w którym zgodę wyrażono.
 */
export function buildPremiumNewsletterRow(input: {
  tenantId: string;
  userId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  tierKey: string;
  subscriptionId: string;
  consent: NewsletterConsentEntry;
}): PremiumNewsletterRow {
  return {
    tenant_id: input.tenantId,
    user_id: input.userId,
    email: input.email.trim().toLowerCase(),
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    language: input.consent.lang,
    status: "subscribed",
    source: "subscription",
    source_form_name: PREMIUM_NEWSLETTER_FORM_NAME,
    confirmed_at: input.consent.received_at,
    unsubscribed_at: null,
    consents: [input.consent],
    meta: { tier: input.tierKey, subscription_id: input.subscriptionId },
  };
}

function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Udzielenie z DOWODEM: jawne `given: true` i niepusta treść. */
function isEvidencedGrant(entry: { [key: string]: Json | undefined }): boolean {
  return entry.given === true && typeof entry.text === "string" && entry.text.trim() !== "";
}

/**
 * Scalenie dowodów zgody - NIGDY zastąpienie. Upsert supabase-js podmieniał
 * całą kolumnę `consents` istniejącego subskrybenta (razem z `confirmed_at`,
 * czyli dowodem double opt-in wcześniejszego zapisu); stąd ta funkcja.
 *
 *  * Istniejące wpisy zostają nietknięte i w tej samej kolejności - także
 *    obce (integracje, import) i dawne wpisy bez treści.
 *  * Dopisujemy na końcu (kolejność = chronologia), chyba że OSTATNI wpis tego
 *    klucza jest już udzieleniem z dowodem - wtedy zostaje najwcześniejszy
 *    dowód, a ponowione zdarzenie niczego nie dubluje.
 *  * Wycofanie (`given: false` albo dawne `granted: false`) zostaje w historii,
 *    a nowa, jawna zgoda staje się NOWYM wpisem - wycofania nie przestawiamy.
 *  * Dawny wpis `granted: true` bez treści (fabrykowany przy zakupie) nie jest
 *    dowodem - prawdziwa zgoda dopisuje się obok niego.
 *
 * `null` = kolumna ma kształt, którego nie da się bezpiecznie scalić (nie
 * tablica) - wołający nie zapisuje niczego, żeby nie zgubić cudzych danych.
 */
export function mergeNewsletterConsents(
  existing: Json | undefined,
  entry: NewsletterConsentEntry,
): { consents: Json[]; appended: boolean } | null {
  if (existing !== null && existing !== undefined && !Array.isArray(existing)) return null;
  const current: Json[] = Array.isArray(existing) ? [...existing] : [];
  const latestSameKey = current
    .filter(isRecord)
    .filter((item) => item.key === entry.key)
    .at(-1);
  if (latestSameKey && isEvidencedGrant(latestSameKey)) {
    return { consents: current, appended: false };
  }
  return { consents: [...current, entry], appended: true };
}

/**
 * Chwila zapisu (`received_at`) zgody TEGO zakupu, jeśli wiersz już ją niesie:
 * ostatni wpis klucza jest udzieleniem z dowodem, z checkoutu i z tej samej
 * subskrypcji. Inaczej `null`.
 *
 * PO CO. Wpis w `consents` i wpis w rejestrze `crm_consent_log` to dwa zapisy
 * (wyzwalacz bazy loguje tylko INSERT wiersza, nie scalenie). Gdy padł drugi,
 * ponowione zdarzenie widzi już scalony wiersz (`appended: false`) i bez tej
 * funkcji nie wiedziałoby, że rejestr trzeba jeszcze uzupełnić - luka w
 * niezmiennym rejestrze zostawała na zawsze. Wpis innej subskrypcji albo
 * formularza nie jest nasz: jego rejestr domknął tamten zapis.
 */
export function recordedCheckoutConsentAt(
  existing: Json | undefined,
  entry: NewsletterConsentEntry,
): string | null {
  if (!Array.isArray(existing)) return null;
  const latest = existing
    .filter(isRecord)
    .filter((item) => item.key === entry.key)
    .at(-1);
  if (!latest || !isEvidencedGrant(latest)) return null;
  if (latest.source !== PREMIUM_NEWSLETTER_CONSENT_SOURCE) return null;
  if (latest.subscription_id !== entry.subscription_id) return null;
  return typeof latest.received_at === "string" ? latest.received_at : null;
}

/**
 * Czy wolno zapisać adres na podstawie zgody z checkoutu. Tylko brak wiersza,
 * zapis oczekujący (`pending`) albo aktywny (`subscribed`). Świadome wypisanie
 * się jest nadrzędne: zgodę po wypisie przywraca wyłącznie double opt-in
 * z formularza (`suppressionBlocksSignup`), więc pole w checkoucie go nie
 * zastępuje. Nieznany status to też odmowa - automat nie zgaduje.
 */
export function canAutoSubscribe(
  existing: {
    status?: string | null;
    unsubscribed_at?: string | null;
  } | null,
): boolean {
  if (!existing) return true;
  if (existing.unsubscribed_at) return false;
  return existing.status === "pending" || existing.status === "subscribed";
}
