// TREŚĆ ZGODY NA NEWSLETTER - JEDNO ŹRÓDŁO PO STRONIE TS (I9d-Y2, decyzje
// właściciela 2026-10-20 „tak, uzupełnij" i 2026-10-21, wariant (a)).
//
// Domyślna treść mówi wprost o pomiarze otwarć i kliknięć, jego celu
// (dopasowanie treści i częstotliwości, statystyka), o tym, że pomiar można
// wyłączyć OSOBNO - bez rezygnacji z newslettera (art. 7 ust. 4 RODO: zgoda
// na newsletter nie jest uzależniona od zgody na pomiar) - i że zgodę można
// wycofać w każdej chwili (link do sekcji „rezygnacja" polityki komunikacji).
// Pomiar to dostęp do informacji w urządzeniu odbiorcy (piksel, link
// z identyfikatorem), więc wymaga zgody - wytyczne EDPB 2/2023 do art. 5
// ust. 3 dyrektywy 2002/58/WE.
//
// LUSTRO SQL. Ta sama treść (HTML, bajt w bajt) i ta sama wersja żyją
// w `_newsletter_consent_default` / `_newsletter_consent_version`
// (supabase/migrations/20261020162300_consent_measurement_core.sql) - stamtąd
// biorą ją DEFAULT kolumn `newsletter_settings.policy_html_*`, wpis rejestru
// zgód przy potwierdzeniu pomiaru linkiem z maila i wyzwalacz
// `email_measurement`. Test parytetu (`__tests__/consentText.test.ts`) czyta
// bloki `newsletter-consent-default:*` z migracji: zmiana treści tu bez
// nowej wersji tam (i odwrotnie) zatrzymuje CI.
//
// WERSJI WYDANEJ NIE ZMIENIA SIĘ. Nowa treść = nowa wersja (stała niżej,
// literał w nowej migracji i dopisek do `_consent_measurement_versions`).
// Wpis w rejestrze zgód niesie wersję, więc da się wykazać, KTÓRĄ treść
// osoba widziała (art. 7 ust. 1 RODO).
//
// MODUŁ CZYSTY: bez Reacta, bez I/O, bez zależności - czytają go formularze
// publiczne (chunki czytelnika), serwer (normalizacja wersji w ładunku zgody)
// i panel. Treść nie jest w słowniku i18n celowo: słownik bywa nadpisywany,
// a dowód zgody musi wskazywać jedną, wersjonowaną treść.

export type ConsentLang = "pl" | "en";

/** Wersja bieżącej treści domyślnej (z pomiarem). Limit ładunku `version`: 32 znaki. */
export const NEWSLETTER_CONSENT_VERSION = "newsletter-2026-10-21";

/**
 * Wersje treści OBEJMUJĄCE pomiar otwarć i kliknięć (lustro
 * `_consent_measurement_versions()`): wpis „tak" z taką wersją daje w bazie
 * zgodę `email_measurement`.
 */
export const MEASUREMENT_CONSENT_VERSIONS: readonly string[] = [NEWSLETTER_CONSENT_VERSION];

/** Odcinek treści: tekst albo link (adres wewnętrzny serwisu i etykieta). */
export type ConsentSegment = string | { readonly href: string; readonly label: string };

/**
 * Treść domyślna jako odcinki - z nich powstaje HTML (lustro SQL) i widok
 * React bez `innerHTML` (`NewsletterConsentText`). Ścieżki EN z prefiksem
 * `/en` (jedna trasa dokumentu na oba języki - `documentIndex.ts`); dawne
 * `/privacy-policy` nie istniało.
 */
const SEGMENTS: Readonly<Record<ConsentLang, readonly ConsentSegment[]>> = {
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

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/** Odcinki treści domyślnej (widok React). */
export function newsletterConsentSegments(lang: ConsentLang): readonly ConsentSegment[] {
  return SEGMENTS[lang];
}

/** Treść domyślna jako HTML - DOKŁADNIE literał SQL (dowód w rejestrze zgód). */
export function newsletterConsentHtml(lang: ConsentLang): string {
  return SEGMENTS[lang]
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part)
        : `<a href="${escapeHtml(part.href)}">${escapeHtml(part.label)}</a>`,
    )
    .join("");
}

/** Treść domyślna bez znaczników (tekst maila, czytniki bez HTML). */
export function newsletterConsentPlain(lang: ConsentLang): string {
  return SEGMENTS[lang].map((part) => (typeof part === "string" ? part : part.label)).join("");
}

/**
 * DAWNE TREŚCI DOMYŚLNE (bez pomiaru) - kopie zapisane w danych sprzed Y2:
 * kolumny `policy_html_*` (DEFAULT 20260601054247; migracja 20261020162300
 * podmieniła tylko wiersze równe staremu domyślnemu), akapit dokumentu
 * buildera newslettera (kopia `policy_html` przy zasiewie), właściwość
 * `consentText` widżetu „Dołącz do nas" (kopia słownika) i etykiety pól
 * wyboru newslettera. Treść równa któremuś z nich jest traktowana jak
 * „treść domyślna" i renderowana jako bieżąca - tekstów WŁASNYCH admina
 * nigdy nie podmieniamy.
 */
export const LEGACY_NEWSLETTER_CONSENT_DEFAULTS: readonly string[] = [
  // `newsletter_settings.policy_html_*` (= c_old_pl/c_old_en w 20261020162300).
  'Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.',
  'By signing up, you agree to our <a href="/privacy-policy">Privacy Policy</a>. You may unsubscribe at any time.',
  // Słownik `newsletterForm.consentDefault` (zapisywany, gdy `policy_html` był pusty).
  "Wyrażam zgodę na otrzymywanie newslettera i przetwarzanie mojego adresu e-mail w tym celu.",
  "I agree to receive the newsletter and processing of my e-mail address for that purpose.",
  // Słownik `joinUs.consent` (wyświetlany w „Dołącz do nas").
  "Zapisując się akceptujesz politykę prywatności. W każdej chwili możesz się wypisać.",
  "By subscribing you accept the privacy policy. You can unsubscribe at any time.",
  // Domyślne etykiety pól wyboru „newsletter" (popup rejestracji
  // `popup_fields`, widżet rejestracji, bramka klubu, formularz kontaktu -
  // rejestr buildera kopiował je do treści strony). Pole z taką etykietą
  // pokazuje pełną treść zgody: sama etykieta nie mówiła o pomiarze.
  "Chcę otrzymywać newsletter",
  "I want to receive the newsletter",
  "Subscribe to newsletter",
  "Zapisz mnie do newslettera",
  "Subscribe me to the newsletter",
];

const LEGACY = new Set(LEGACY_NEWSLETTER_CONSENT_DEFAULTS.map((text) => text.trim()));
/** Dwie pierwsze pozycje listy = dawne DEFAULT kolumn `policy_html_pl/_en`. */
const LEGACY_POLICY_HTML = new Set(LEGACY_NEWSLETTER_CONSENT_DEFAULTS.slice(0, 2));

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
 * `policy_html` przy zasiewie): dawna albo bieżąca treść domyślna -> bieżąca
 * w języku formularza, każdy inny tekst (także pusty) bez zmian. Mapowanie
 * przy renderze zamiast masowej aktualizacji JSON-u dokumentów (szkice,
 * rewizje, publikacje).
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
 * Pole z panelu albo buildera -> treść zgody. Puste, dawne domyślne i bieżące
 * domyślne = BIEŻĄCA treść domyślna w języku formularza z wersją z pomiarem.
 * Tekst własny admina zostaje bez zmian i bez wersji (serwer dopisze skrót
 * treści; pomiar obejmie go tylko po jawnym oznaczeniu w panelu - skrót
 * zapisanego tekstu w `newsletter_consent_measurement_marks`).
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
 * Wersja z pomiarem w ładunku jest PRZYWILEJEM treści z rejestru: klient
 * może podać dowolny napis, więc serwer zostawia wersję z pomiarem wyłącznie
 * wtedy, gdy treść jest DOKŁADNIE treścią tej wersji (HTML albo tekst, PL
 * albo EN). Inaczej wersja znika, a baza zapisze skrót treści - fałszywa
 * wersja nie da zgody na pomiar za kogoś, kto jej nie widział.
 */
export function normalizeConsentVersion(entry: {
  key: string;
  text: string;
  version?: string | null;
}): string | undefined {
  const version = entry.version?.trim() || undefined;
  if (!version || !MEASUREMENT_CONSENT_VERSIONS.includes(version)) return version;
  if (version !== NEWSLETTER_CONSENT_VERSION) return undefined;
  const text = entry.text.trim();
  const matches = (["pl", "en"] as const).some(
    (lang) => text === newsletterConsentHtml(lang) || text === newsletterConsentPlain(lang),
  );
  return matches ? version : undefined;
}

/**
 * Domyślna treść akceptacji polityki prywatności w popupie rejestracji, gdy
 * redakcja nie wpisała własnej. Dotąd popup brał `policy_html` - od Y2 to
 * treść zgody na NEWSLETTER, a wymagane pole „prywatność" nie może nieść
 * zgody marketingowej (uzależnienie rejestracji od zgody - art. 7 ust. 4).
 */
const PRIVACY_ACCEPTANCE: Readonly<Record<ConsentLang, readonly ConsentSegment[]>> = {
  pl: ["Akceptuję ", { href: "/polityka-prywatnosci", label: "Politykę prywatności" }, "."],
  en: ["I accept the ", { href: "/en/polityka-prywatnosci", label: "Privacy Policy" }, "."],
};

export function privacyAcceptanceHtml(lang: ConsentLang): string {
  return PRIVACY_ACCEPTANCE[lang]
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part)
        : `<a href="${escapeHtml(part.href)}">${escapeHtml(part.label)}</a>`,
    )
    .join("");
}

/**
 * Zapis na newsletter po rejestracji konta z zaznaczonym polem „newsletter"
 * (widżet rejestracji, bramka klubu - jak popup rejestracji). Dotąd zgoda
 * jechała wyłącznie flagą `marketing_opt_in` w metadanych konta: nie było
 * ani subskrypcji, ani wpisu w rejestrze zgód (dowodu treści i wersji).
 * Zapis idzie tą samą funkcją serwerową co formularze (double opt-in wg
 * ustawień najemcy), a wyzwalacz bazy loguje zgodę z wersją.
 */
export function signupNewsletterSubscription(input: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  lang: ConsentLang;
  source: string;
  consent: ResolvedNewsletterConsent;
}) {
  const firstName = input.firstName?.trim() || undefined;
  const lastName = input.lastName?.trim() || undefined;
  return {
    email: input.email.trim().toLowerCase(),
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
    language: input.lang,
    source: `signup_${input.source}`,
    consents: [newsletterConsentPayload(input.consent, input.lang)],
  };
}
