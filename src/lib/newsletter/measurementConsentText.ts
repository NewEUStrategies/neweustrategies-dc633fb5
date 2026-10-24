// TREŚĆ OSOBNEJ ZGODY NA POMIAR OTWARĆ I KLIKNIĘĆ - JEDNO ŹRÓDŁO PO STRONIE TS
// (I9d-Y2b, decyzje właściciela 2026-10-23: D1 wariant (b) - każda zgoda ma
// osobne pole; D2 - pomiar działa tylko dla skrzynki potwierdzonej przez jej
// właściciela).
//
// Pole pomiaru jest OSOBNE i domyślnie NIEZAZNACZONE, z własną, wersjonowaną
// treścią (art. 7 ust. 2 i 4 RODO: zgoda na newsletter nie zależy od zgody na
// pomiar). Pomiar to dostęp do informacji w urządzeniu odbiorcy (piksel, link
// z identyfikatorem), więc wymaga zgody - wytyczne EDPB 2/2023 do art. 5
// ust. 3 dyrektywy 2002/58/WE.
//
// ZAZNACZENIE POLA TO DEKLARACJA, NIE ZGODA. Formularz wysyła pozycję pod
// OSOBNYM kluczem `email_measurement_declared` (nie wygląda jak udzielona
// zgoda w `consents`, w szufladzie CRM ani w eksporcie danych osoby). Zgodę
// `email_measurement` zapisuje WYŁĄCZNIE baza po decyzji właściciela skrzynki:
// przycisk na stronie potwierdzenia double opt-in albo na stronie
// `/newsletter/measurement` z linku w mailu. Każda pozycja `email_measurement`
// przysłana z formularza jest usuwana (`sanitizeConsentEntries`).
//
// LUSTRO SQL. Ta sama treść (HTML, bajt w bajt) i ta sama wersja żyją
// w `_email_measurement_consent_default` / `_email_measurement_consent_version`
// (supabase/migrations/20261023090000_consent_measurement_separate_core.sql) -
// stamtąd bierze ją pisarz zgody `_email_measurement_grant` i rozpoznanie
// deklaracji `_newsletter_measurement_declared_at`. Test parytetu
// (`__tests__/measurementConsentText.test.ts`) czyta bloki
// `email-measurement-consent-default:*` z NAJNOWSZEJ migracji: zmiana treści
// tu bez nowej wersji tam (i odwrotnie) zatrzymuje CI.
//
// WERSJI WYDANEJ NIE ZMIENIA SIĘ. Nowa treść = nowa wersja (stała niżej
// i literał w nowej migracji). Wpis w rejestrze zgód niesie wersję, więc da
// się wykazać, KTÓRĄ treść osoba widziała (art. 7 ust. 1 RODO).
//
// MODUŁ CZYSTY: bez Reacta, bez I/O - czytają go formularze publiczne,
// serwer (sanitizer ładunku, notka maila DOI) i panel. Treść nie jest
// w słowniku i18n celowo: słownik bywa nadpisywany, a dowód zgody musi
// wskazywać jedną, wersjonowaną treść.
import {
  CONSENT_LANGS,
  segmentsHtml,
  segmentsPlain,
  type ConsentLang,
  type ConsentSegment,
} from "./consentSegments";

/** Klucz zgody na pomiar w rejestrze zgód (`crm_consent_log.consent_key`). */
export const EMAIL_MEASUREMENT_CONSENT_KEY = "email_measurement" as const;

/**
 * Klucz DEKLARACJI z formularza (zaznaczone pole pomiaru) w `consents`
 * subskrybenta. Czytają go `_newsletter_measurement_declared_at` (stan oferty
 * na stronie DOI, prośba po zapisie bez DOI); rejestr zgód go nie loguje.
 */
export const EMAIL_MEASUREMENT_DECLARED_KEY = "email_measurement_declared" as const;

/** Wersja bieżącej treści pola pomiaru. Limit ładunku `version`: 32 znaki. */
export const EMAIL_MEASUREMENT_CONSENT_VERSION = "email-measurement-2026-10-23";

/**
 * Wersje treści zgody na pomiar (lustro `_consent_measurement_versions()`,
 * od 20261023090000: wersje treści OSOBNEJ zgody na pomiar). Treść zgody na
 * newsletter - także pakietowa (a) `newsletter-2026-10-21` - nie jest tu
 * nigdy wpisywana.
 */
export const MEASUREMENT_CONSENT_VERSIONS: readonly string[] = [EMAIL_MEASUREMENT_CONSENT_VERSION];

/**
 * Klucze zastrzeżone dla pola pomiaru: widżet „pole wyboru" buildera z takim
 * kluczem nie jest renderowany ani zbierany (jedyną drogą jest pole pomiaru).
 */
export const RESERVED_CONSENT_KEYS: readonly string[] = [
  EMAIL_MEASUREMENT_CONSENT_KEY,
  EMAIL_MEASUREMENT_DECLARED_KEY,
];

/** Klucz po obcięciu i małych literach (tak jak sanitizer i SQL `lower(btrim())`). */
export function normalizeConsentKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Czy klucz pozycji zgody jest zastrzeżony dla pola pomiaru. */
export function isReservedConsentKey(key: string): boolean {
  return RESERVED_CONSENT_KEYS.includes(normalizeConsentKey(key));
}

/**
 * Treść pola pomiaru jako odcinki: `[tekst, link, tekst]`. Etykieta linku ze
 * stopki = `MEASUREMENT_FOOTER_COPY.*.link` (test). Kotwica `#pomiar` -
 * sekcja polityki komunikacji (`src/lib/legal/content/communications.ts`).
 */
const SEGMENTS: Readonly<Record<ConsentLang, readonly ConsentSegment[]>> = {
  pl: [
    "Zgadzam się na pomiar otwarć i kliknięć w wiadomościach e-mail, które od Was otrzymuję (niewidoczny obrazek w treści i linki z moim identyfikatorem), aby dopasować treść i częstotliwość wysyłki oraz prowadzić statystykę. Zgoda jest dobrowolna - newsletter otrzymam także bez niej. Pomiar zacznie działać dopiero, gdy potwierdzę tę zgodę przyciskiem na stronie, do której prowadzi link z wiadomości wysłanej na mój adres. Mogę ją wycofać w każdej chwili, bez rezygnacji z newslettera, linkiem „Nie mierz moich otwarć i kliknięć” w stopce każdej wiadomości (",
    { href: "/komunikacja-i-marketing#pomiar", label: "szczegóły" },
    ").",
  ],
  en: [
    "I agree to the measurement of opens and clicks in the emails I receive from you (a tracking image in the message and links carrying my identifier) to tailor the content and sending frequency and keep statistics. This consent is optional - I will receive the newsletter without it. Measurement starts only after I confirm this consent with the button on the page opened from a link in an email sent to my address. I can withdraw it at any time, without unsubscribing, using the “Don't measure my opens and clicks” link at the bottom of every email (",
    { href: "/en/komunikacja-i-marketing#pomiar", label: "details" },
    ").",
  ],
};

/** Concise form label; the confirmation page retains the versioned full disclosure. */
const FORM_SUMMARY: Readonly<Record<ConsentLang, readonly ConsentSegment[]>> = {
  pl: [
    "Wyrażasz zgodę na pomiar otwarć i kliknięć w e-mailach od New European Strategies, aby poprawiać jakość usług i dopasowywać komunikację marketingową. Zgoda jest dobrowolna, nie warunkuje newslettera i działa po potwierdzeniu z e-maila. Wycofasz ją w stopce każdej wiadomości (",
    { href: "/komunikacja-i-marketing#pomiar", label: "szczegóły" },
    ").",
  ],
  en: [
    "You consent to measuring opens and clicks in emails from New European Strategies to improve service quality and tailor marketing communications. Consent is optional, is not required for the newsletter and takes effect after confirmation via email. You can withdraw it in any email footer (",
    { href: "/en/komunikacja-i-marketing#pomiar", label: "details" },
    ").",
  ],
};

export function measurementConsentSummarySegments(lang: ConsentLang): readonly ConsentSegment[] {
  return FORM_SUMMARY[lang];
}

export function measurementConsentSummaryPlain(lang: ConsentLang): string {
  return segmentsPlain(FORM_SUMMARY[lang]);
}

/** Odcinki treści pola pomiaru (widok React). */
export function measurementConsentSegments(lang: ConsentLang): readonly ConsentSegment[] {
  return SEGMENTS[lang];
}

/** Treść pola pomiaru jako HTML - DOKŁADNIE literał SQL (dowód w rejestrze zgód). */
export function measurementConsentHtml(lang: ConsentLang): string {
  return segmentsHtml(SEGMENTS[lang]);
}

/** Treść pola pomiaru bez znaczników (ramka maila prośby, czytniki bez HTML). */
export function measurementConsentPlain(lang: ConsentLang): string {
  return segmentsPlain(SEGMENTS[lang]);
}

/**
 * Język treści pola pomiaru rozpoznany po DOKŁADNEJ treści (po obcięciu
 * brzegów; HTML albo tekst, PL albo EN); obca treść -> `null`.
 */
export function measurementConsentLangOf(text: string | null | undefined): ConsentLang | null {
  const value = (text ?? "").trim();
  if (!value) return null;
  for (const lang of CONSENT_LANGS) {
    if (value === measurementConsentHtml(lang) || value === measurementConsentPlain(lang)) {
      return lang;
    }
  }
  return null;
}

/** Czy tekst jest treścią pola pomiaru (HTML albo tekst, PL albo EN, po `trim`). */
export function isMeasurementConsentText(text: string): boolean {
  return measurementConsentLangOf(text) !== null;
}

/**
 * Pozycja `consents` ładunku zapisu przy ZAZNACZONYM polu pomiaru (kształt
 * `ConsentEntry` funkcji serwerowych). Deklaracja, nie zgoda: klucz
 * `email_measurement_declared`, treść HTML i wersja z rejestru.
 */
export interface MeasurementConsentPayload {
  key: typeof EMAIL_MEASUREMENT_DECLARED_KEY;
  text: string;
  version: string;
  given: true;
  lang: ConsentLang;
}

/** Deklaracja pola pomiaru dla ładunku - ta sama treść, którą formularz pokazał. */
export function measurementConsentPayload(lang: ConsentLang): MeasurementConsentPayload {
  return {
    key: EMAIL_MEASUREMENT_DECLARED_KEY,
    text: measurementConsentHtml(lang),
    version: EMAIL_MEASUREMENT_CONSENT_VERSION,
    given: true,
    lang,
  };
}

/**
 * Akapit maila double opt-in dokładany WYŁĄCZNIE przy zaznaczonym polu
 * pomiaru (pod wstępem, z escapowaniem w szablonie). Mówi, że zgoda zadziała
 * dopiero po kliknięciu na stronie potwierdzenia i że newsletter przychodzi
 * tak samo bez niej.
 */
export const MEASUREMENT_DOI_MAIL_NOTE: Readonly<Record<ConsentLang, string>> = {
  pl: "W formularzu zaznaczono także pole zgody na pomiar otwarć i kliknięć. Po potwierdzeniu zapisu zapytamy Cię o tę zgodę na stronie potwierdzenia - pomiar zacznie działać dopiero po Twoim kliknięciu, a bez niego newsletter przychodzi tak samo.",
  en: "The form also had the box for consent to measuring opens and clicks ticked. After you confirm your subscription, we will ask you about this consent on the confirmation page - measurement starts only after you click, and the newsletter arrives the same without it.",
};
