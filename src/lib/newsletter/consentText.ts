// TREŚĆ ZGODY NA NEWSLETTER - JEDNO ŹRÓDŁO PO STRONIE TS (I9d-Y2, I9d-Y2b;
// decyzje właściciela 2026-10-20, 2026-10-21 i 2026-10-23).
//
// WARIANT (b) OD 2026-10-23: KAŻDA ZGODA MA OSOBNE POLE. Treść zgody na
// newsletter nie wspomina pomiaru otwarć i kliknięć ani nie dokłada drugiej
// zgody w tym samym zdaniu („akceptujesz Politykę prywatności" - polityka to
// informacja z art. 13 RODO, nie zgoda). Pomiar ma osobne, domyślnie
// niezaznaczone pole z własną treścią i wersją
// (`./measurementConsentText.ts`). Treść pakietowa (a) `newsletter-2026-10-21`
// zostaje w rejestrze wersji wyłącznie jako dowód tego, co osoba widziała,
// i jako „dawna treść domyślna" (kopie w danych podmieniamy na bieżącą).
//
// LUSTRO SQL. Ta sama treść (HTML, bajt w bajt) i ta sama wersja żyją
// w `_newsletter_consent_default` / `_newsletter_consent_version`
// (supabase/migrations/20261023090000_consent_measurement_separate_core.sql) -
// stamtąd biorą ją DEFAULT kolumn `newsletter_settings.policy_html_*`.
// Test parytetu (`__tests__/consentText.test.ts`) czyta bloki
// `newsletter-consent-default:*` z NAJNOWSZEJ migracji: zmiana treści tu bez
// nowej wersji tam (i odwrotnie) zatrzymuje CI.
//
// WERSJI WYDANEJ NIE ZMIENIA SIĘ. Nowa treść = nowa wersja (stała niżej,
// literał w nowej migracji i wpis w `NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION`).
// Wpis w rejestrze zgód niesie wersję, więc da się wykazać, KTÓRĄ treść
// osoba widziała (art. 7 ust. 1 RODO).
//
// MODUŁ CZYSTY: bez Reacta, bez I/O - czytają go formularze publiczne
// (chunki czytelnika), serwer (sanitizer ładunku zgód) i panel. Treść nie
// jest w słowniku i18n celowo: słownik bywa nadpisywany, a dowód zgody musi
// wskazywać jedną, wersjonowaną treść.
import {
  CONSENT_LANGS,
  segmentsHtml,
  segmentsPlain,
  type ConsentLang,
  type ConsentSegment,
} from "./consentSegments";
import {
  EMAIL_MEASUREMENT_CONSENT_KEY,
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  EMAIL_MEASUREMENT_DECLARED_KEY,
  isMeasurementConsentText,
  MEASUREMENT_CONSENT_VERSIONS,
  measurementConsentHtml,
  measurementConsentLangOf,
  measurementConsentPayload,
  normalizeConsentKey,
  type MeasurementConsentPayload,
} from "./measurementConsentText";

// Zgodność importów: typy odcinków mieszkają w liściu `consentSegments`.
export type { ConsentLang, ConsentSegment } from "./consentSegments";

/** Wersja bieżącej treści domyślnej (b, bez pomiaru). Limit ładunku `version`: 32 znaki. */
export const NEWSLETTER_CONSENT_VERSION = "newsletter-2026-10-23";

/**
 * Wersja treści pakietowej (a) z 2026-10-21 (zgoda na newsletter z opisem
 * pomiaru w jednym zdaniu). Od 20261023090000 NIE daje pomiaru - zostaje
 * jako dowód treści, którą osoba widziała.
 */
export const NEWSLETTER_CONSENT_VERSION_BUNDLED = "newsletter-2026-10-21";

/**
 * Treść (a) - bajt w bajt literały `_newsletter_consent_default` z
 * 20261020162300 (`c_a_pl`/`c_a_en` w 20261023090000).
 */
const SEGMENTS_BUNDLED: Readonly<Record<ConsentLang, readonly ConsentSegment[]>> = {
  pl: [
    "Zapisując się, wyrażasz zgodę na otrzymywanie newslettera i akceptujesz ",
    { href: "/polityka-prywatnosci", label: "Politykę prywatności" },
    ". Wiadomości mogą zawierać elementy mierzące otwarcia i kliknięcia - dzięki nim dopasowujemy treść i częstotliwość wysyłki oraz prowadzimy statystykę. Pomiar możesz wyłączyć osobno, bez rezygnacji z newslettera, a zgodę wycofać w każdej chwili (",
    { href: "/komunikacja-i-marketing#rezygnacja", label: "jak to zrobić" },
    ").",
  ],
  en: [
    "By signing up, you agree to receive the newsletter and accept our ",
    { href: "/en/polityka-prywatnosci", label: "Privacy Policy" },
    ". Our emails may contain elements that measure opens and clicks - they help us tailor the content and sending frequency and keep statistics. You can switch off this measurement separately, without unsubscribing, and withdraw your consent at any time (",
    { href: "/en/komunikacja-i-marketing#rezygnacja", label: "how to do it" },
    ").",
  ],
};

/**
 * Treść bieżąca (b) jako odcinki - z nich powstaje HTML (lustro SQL) i widok
 * React bez `innerHTML` (`NewsletterConsentText`). Ścieżki EN z prefiksem
 * `/en` (jedna trasa dokumentu na oba języki - `documentIndex.ts`); dawne
 * `/privacy-policy` nie istniało.
 */
const SEGMENTS: Readonly<Record<ConsentLang, readonly ConsentSegment[]>> = {
  pl: [
    "Zapisując się, wyrażasz zgodę na otrzymywanie newslettera. Zasady przetwarzania danych opisuje ",
    { href: "/polityka-prywatnosci", label: "Polityka prywatności" },
    ". Zgodę możesz wycofać w każdej chwili (",
    { href: "/komunikacja-i-marketing#rezygnacja", label: "jak to zrobić" },
    ").",
  ],
  en: [
    "By signing up, you agree to receive the newsletter. How we process your data is described in our ",
    { href: "/en/polityka-prywatnosci", label: "Privacy Policy" },
    ". You can withdraw your consent at any time (",
    { href: "/en/komunikacja-i-marketing#rezygnacja", label: "how to do it" },
    ").",
  ],
};

/**
 * Wydane wersje treści domyślnej zgody na newsletter -> odcinki PL/EN.
 * Wersja z tej mapy w ładunku zostaje WYŁĄCZNIE przy dokładnej treści tej
 * wersji (`normalizeConsentVersion`).
 */
export const NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION: Readonly<
  Record<string, Readonly<Record<ConsentLang, readonly ConsentSegment[]>>>
> = {
  [NEWSLETTER_CONSENT_VERSION_BUNDLED]: SEGMENTS_BUNDLED,
  [NEWSLETTER_CONSENT_VERSION]: SEGMENTS,
};

/** Odcinki wydanej wersji (własne pola mapy - bez łańcucha prototypów). */
function newsletterSegmentsOf(
  version: string,
): Readonly<Record<ConsentLang, readonly ConsentSegment[]>> | undefined {
  return Object.prototype.hasOwnProperty.call(NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION, version)
    ? NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION[version]
    : undefined;
}

/** Odcinki treści domyślnej (widok React). */
export function newsletterConsentSegments(lang: ConsentLang): readonly ConsentSegment[] {
  return SEGMENTS[lang];
}

/** Treść domyślna jako HTML - DOKŁADNIE literał SQL (dowód w rejestrze zgód). */
export function newsletterConsentHtml(lang: ConsentLang): string {
  return segmentsHtml(SEGMENTS[lang]);
}

/** Treść domyślna bez znaczników (tekst maila, czytniki bez HTML). */
export function newsletterConsentPlain(lang: ConsentLang): string {
  return segmentsPlain(SEGMENTS[lang]);
}

/** Dawne DEFAULT kolumn `policy_html_*` (= `c_old_pl`/`c_old_en` w 20261020162300). */
const OLD_POLICY_HTML_PL =
  'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.';
const OLD_POLICY_HTML_EN =
  'By signing up, you agree to our <a href="/privacy-policy">Privacy Policy</a>. You may unsubscribe at any time.';

/** Treść (a) jako HTML (= `c_a_pl`/`c_a_en` w 20261023090000). */
const BUNDLED_POLICY_HTML_PL = segmentsHtml(SEGMENTS_BUNDLED.pl);
const BUNDLED_POLICY_HTML_EN = segmentsHtml(SEGMENTS_BUNDLED.en);

/**
 * DAWNE TREŚCI DOMYŚLNE - kopie zapisane w danych: kolumny `policy_html_*`
 * (DEFAULT 20260601054247 i treść pakietowa (a) z 20261020162300; migracje
 * podmieniają tylko wiersze równe dawnym domyślnym), akapit dokumentu
 * buildera newslettera (kopia `policy_html` przy zasiewie), właściwość
 * `consentText` widżetu „Dołącz do nas" (kopia słownika) i etykiety pól
 * wyboru newslettera. Treść równa któremuś z nich jest traktowana jak
 * „treść domyślna" i renderowana jako bieżąca - tekstów WŁASNYCH admina
 * nigdy nie podmieniamy.
 */
export const LEGACY_NEWSLETTER_CONSENT_DEFAULTS: readonly string[] = [
  // `newsletter_settings.policy_html_*` sprzed Y2 (= c_old_pl/c_old_en).
  OLD_POLICY_HTML_PL,
  OLD_POLICY_HTML_EN,
  // Treść pakietowa (a) `newsletter-2026-10-21` (= c_a_pl/c_a_en).
  BUNDLED_POLICY_HTML_PL,
  BUNDLED_POLICY_HTML_EN,
  // Słownik `newsletterForm.consentDefault` (zapisywany, gdy `policy_html` był pusty).
  "Wyrażam zgodę na otrzymywanie newslettera i przetwarzanie mojego adresu e-mail w tym celu.",
  "I agree to receive the newsletter and processing of my e-mail address for that purpose.",
  // Słownik `joinUs.consent` (wyświetlany w „Dołącz do nas").
  "Zapisując się akceptujesz politykę prywatności. W każdej chwili możesz się wypisać.",
  "By subscribing you accept the privacy policy. You can unsubscribe at any time.",
  // Domyślne etykiety pól wyboru „newsletter" (popup rejestracji
  // `popup_fields`, widżet rejestracji, bramka klubu, formularz kontaktu -
  // rejestr buildera kopiował je do treści strony). Pole z taką etykietą
  // pokazuje pełną treść zgody.
  "Chcę otrzymywać newsletter",
  "I want to receive the newsletter",
  "Subscribe to newsletter",
  "Zapisz mnie do newslettera",
  "Subscribe me to the newsletter",
];

const LEGACY = new Set(LEGACY_NEWSLETTER_CONSENT_DEFAULTS.map((text) => text.trim()));
/**
 * Kopie treści `policy_html` (dawne DEFAULT kolumn i treść (a)) - jawna
 * lista, nie wycinek: kolejność `LEGACY_NEWSLETTER_CONSENT_DEFAULTS` nie jest
 * kontraktem.
 */
const LEGACY_POLICY_HTML = new Set([
  OLD_POLICY_HTML_PL,
  OLD_POLICY_HTML_EN,
  BUNDLED_POLICY_HTML_PL,
  BUNDLED_POLICY_HTML_EN,
]);

/** Czy tekst (po obcięciu brzegów) jest dawną albo bieżącą treścią domyślną. */
export function isNewsletterConsentDefault(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (!value) return true;
  return (
    LEGACY.has(value) ||
    value === newsletterConsentHtml("pl") ||
    value === newsletterConsentHtml("en")
  );
}

/**
 * Akapit z KOPIĄ treści zgody (dokument buildera newslettera kopiuje
 * `policy_html` przy zasiewie): dawna (także (a)) albo bieżąca treść domyślna
 * -> bieżąca w języku formularza, każdy inny tekst (także pusty) bez zmian.
 * Mapowanie przy renderze zamiast masowej aktualizacji JSON-u dokumentów
 * (szkice, rewizje, publikacje).
 */
export function upgradeLegacyConsentHtml(html: string, lang: ConsentLang): string {
  const value = html.trim();
  // Wyłącznie dawne/bieżące treści `policy_html` - akapit z samym napisem
  // „Subscribe to newsletter" to nagłówek redakcji, nie kopia zgody.
  const isPolicyCopy =
    LEGACY_POLICY_HTML.has(value) ||
    value === newsletterConsentHtml("pl") ||
    value === newsletterConsentHtml("en");
  return isPolicyCopy ? newsletterConsentHtml(lang) : html;
}

/** Treść zgody wyświetlana w formularzu i zapisywana jako dowód. */
export type ResolvedNewsletterConsent =
  | { readonly isDefault: true; readonly text: string; readonly version: string }
  | { readonly isDefault: false; readonly text: string; readonly version?: undefined };

/**
 * Pole z panelu albo buildera -> treść zgody. Puste, dawne domyślne (także
 * (a)) i bieżące domyślne = BIEŻĄCA treść domyślna w języku formularza
 * z wersją (b). Tekst własny admina zostaje bez zmian i bez wersji (serwer
 * dopisze skrót treści). Żadna treść zgody na newsletter nie daje pomiaru -
 * pomiar ma osobne pole.
 */
export function resolveNewsletterConsent(
  custom: string | null | undefined,
  lang: ConsentLang,
): ResolvedNewsletterConsent {
  if (isNewsletterConsentDefault(custom)) {
    return {
      isDefault: true,
      text: newsletterConsentHtml(lang),
      version: NEWSLETTER_CONSENT_VERSION,
    };
  }
  return { isDefault: false, text: (custom ?? "").trim() };
}

/** Pozycja `consents` ładunku zapisu (kształt `ConsentEntry` funkcji serwerowych). */
export interface NewsletterConsentPayload {
  key: "newsletter";
  text: string;
  given: true;
  lang: ConsentLang;
  version?: string;
}

/** Pozycja zgody na newsletter dla ładunku - ta sama treść, którą formularz pokazał. */
export function newsletterConsentPayload(
  resolved: ResolvedNewsletterConsent,
  lang: ConsentLang,
): NewsletterConsentPayload {
  return resolved.isDefault
    ? { key: "newsletter", text: resolved.text, given: true, lang, version: resolved.version }
    : { key: "newsletter", text: resolved.text, given: true, lang };
}

/**
 * Wersja z rejestru w ładunku jest PRZYWILEJEM treści z rejestru: klient
 * może podać dowolny napis, więc serwer zostawia ją wyłącznie przy DOKŁADNEJ
 * treści tej wersji (HTML albo tekst, PL albo EN). Inaczej wersja znika,
 * a baza zapisze skrót treści.
 *   * wersja treści zgody na newsletter (a albo b) - tylko z treścią tej wersji;
 *   * wersja treści pomiaru - tylko przy kluczu deklaracji
 *     `email_measurement_declared` z treścią pola pomiaru;
 *   * pozostałe wersje (skróty popupu, premium `2026-10-12`, wydarzenia) -
 *     bez zmian.
 */
export function normalizeConsentVersion(entry: {
  key: string;
  text: string;
  version?: string | null;
}): string | undefined {
  const version = entry.version?.trim() || undefined;
  if (!version) return undefined;
  const newsletterSegments = newsletterSegmentsOf(version);
  if (newsletterSegments) {
    const text = entry.text.trim();
    const matches = CONSENT_LANGS.some(
      (lang) =>
        text === segmentsHtml(newsletterSegments[lang]) ||
        text === segmentsPlain(newsletterSegments[lang]),
    );
    return matches ? version : undefined;
  }
  if (MEASUREMENT_CONSENT_VERSIONS.includes(version)) {
    return normalizeConsentKey(entry.key) === EMAIL_MEASUREMENT_DECLARED_KEY &&
      isMeasurementConsentText(entry.text)
      ? version
      : undefined;
  }
  return version;
}

/** Minimalny kształt pozycji zgody, którą czyści `sanitizeConsentEntries`. */
export interface SanitizableConsentEntry {
  key: string;
  text: string;
  version?: string | null;
  given?: boolean;
  lang?: string;
}

/** Zgoda na newsletter/marketing w ładunku (warunek deklaracji pomiaru). */
function isNewsletterOptIn(entry: SanitizableConsentEntry): boolean {
  const key = normalizeConsentKey(entry.key);
  return (key.startsWith("newsletter") || key.startsWith("marketing")) && entry.given !== false;
}

/**
 * Pozycje `consents` z formularza -> pozycje do zapisu (serwer, przed
 * subskrybentem i `contact_messages`). Funkcja NIE mutuje wejścia.
 *
 * 1. Klucz `email_measurement` (po `trim().toLowerCase()`) jest ZAWSZE
 *    usuwany: zgodę na pomiar zapisuje wyłącznie baza po decyzji właściciela
 *    skrzynki, nigdy formularz (także stara paczka JS z treścią (a)).
 * 2. Deklaracja `email_measurement_declared` przechodzi WYŁĄCZNIE, gdy:
 *    `given === true`, wersja = `EMAIL_MEASUREMENT_CONSENT_VERSION`, treść =
 *    treść pola pomiaru (HTML albo tekst, PL albo EN) i w tym samym ładunku
 *    jest zgoda `newsletter*`/`marketing*` z `given !== false`. Przechodzi
 *    najwyżej jedna; klucz jest normalizowany, a treść PRZEPISANA na HTML
 *    dopasowanego języka (`lang` = ten język) - dokładnie tę postać rozpoznaje
 *    SQL (`_newsletter_measurement_declared_at`). Każda inna deklaracja znika.
 * 3. Pozostałe pozycje: wersja przez `normalizeConsentVersion`.
 */
export function sanitizeConsentEntries<T extends SanitizableConsentEntry>(
  entries: readonly T[],
): T[] {
  const newsletterOptIn = entries.some(isNewsletterOptIn);
  let declared = false;
  const out: T[] = [];
  for (const entry of entries) {
    const key = normalizeConsentKey(entry.key);
    if (key === EMAIL_MEASUREMENT_CONSENT_KEY) continue;
    if (key === EMAIL_MEASUREMENT_DECLARED_KEY) {
      const lang = measurementConsentLangOf(entry.text);
      if (
        lang === null ||
        declared ||
        !newsletterOptIn ||
        entry.given !== true ||
        entry.version?.trim() !== EMAIL_MEASUREMENT_CONSENT_VERSION
      ) {
        continue;
      }
      declared = true;
      out.push({
        ...entry,
        key: EMAIL_MEASUREMENT_DECLARED_KEY,
        text: measurementConsentHtml(lang),
        version: EMAIL_MEASUREMENT_CONSENT_VERSION,
        given: true,
        lang,
      });
      continue;
    }
    const { version: _claimed, ...rest } = entry;
    const version = normalizeConsentVersion(entry);
    out.push((version ? { ...rest, version } : rest) as unknown as T);
  }
  return out;
}

/**
 * Czy ładunek niesie deklarację pola pomiaru. Wołać na pozycjach PO
 * `sanitizeConsentEntries` (sam klucz nie jest tu walidowany).
 */
export function hasMeasurementDeclaration(entries: readonly { key: string }[]): boolean {
  return entries.some((entry) => normalizeConsentKey(entry.key) === EMAIL_MEASUREMENT_DECLARED_KEY);
}

/**
 * Domyślna treść akceptacji polityki prywatności w popupie rejestracji, gdy
 * redakcja nie wpisała własnej. Wymagane pole „prywatność" nie może nieść
 * zgody marketingowej (uzależnienie rejestracji od zgody - art. 7 ust. 4).
 */
const PRIVACY_ACCEPTANCE: Readonly<Record<ConsentLang, readonly ConsentSegment[]>> = {
  pl: ["Akceptuję ", { href: "/polityka-prywatnosci", label: "Politykę prywatności" }, "."],
  en: ["I accept the ", { href: "/en/polityka-prywatnosci", label: "Privacy Policy" }, "."],
};

export function privacyAcceptanceHtml(lang: ConsentLang): string {
  return segmentsHtml(PRIVACY_ACCEPTANCE[lang]);
}

/**
 * Zapis na newsletter po rejestracji konta z zaznaczonym polem „newsletter"
 * (widżet rejestracji, bramka klubu - jak popup rejestracji). Zapis idzie tą
 * samą funkcją serwerową co formularze (double opt-in wg ustawień najemcy),
 * a wyzwalacz bazy loguje zgodę z wersją. `measurement: true` (zaznaczone
 * osobne pole pomiaru) dokłada DEKLARACJĘ pomiaru - zgodę i tak zapisze
 * dopiero decyzja właściciela skrzynki.
 */
export function signupNewsletterSubscription(input: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  lang: ConsentLang;
  source: string;
  consent: ResolvedNewsletterConsent;
  measurement?: boolean;
}) {
  const firstName = input.firstName?.trim() || undefined;
  const lastName = input.lastName?.trim() || undefined;
  const consents: Array<NewsletterConsentPayload | MeasurementConsentPayload> = [
    newsletterConsentPayload(input.consent, input.lang),
  ];
  if (input.measurement) consents.push(measurementConsentPayload(input.lang));
  return {
    email: input.email.trim().toLowerCase(),
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
    language: input.lang,
    source: `signup_${input.source}`,
    consents,
  };
}
