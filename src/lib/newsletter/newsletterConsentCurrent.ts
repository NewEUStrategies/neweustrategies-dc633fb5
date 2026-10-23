// BIEŻĄCA TREŚĆ ZGODY NA NEWSLETTER (b) - LIŚĆ DLA CHUNKU STARTOWEGO
// (I9d-Y2b, integracja; decyzja właściciela 2026-10-23, wariant (b)).
//
// Hook korzenia `useNewsletterSettings` potrzebuje WYŁĄCZNIE treści bieżącej
// (wartości domyślne `policy_html_*`, gdy najemca nie ma wiersza ustawień).
// Gdy importował ją z `./consentText`, do chunku startowego (`app-initial`,
// każda strona czytelnika) wchodził cały moduł: treść (a), dawne treści,
// sanitizer ładunku zgód i - przez jego import - treść osobnego pola pomiaru
// z `./measurementConsentText`. Ten liść niesie tylko wersję i odcinki (b);
// `./consentText` je stąd re-eksportuje, więc pozostali czytelnicy i test
// parytetu TS⇄SQL (`__tests__/consentText.test.ts`) widzą to samo API.
//
// MODUŁ CZYSTY I LIŚĆ (poza liściem odcinków): bez Reacta, bez I/O.
// Lustro SQL, wersjonowanie i zasady zmiany treści - nagłówek `./consentText`.
import { segmentsHtml, type ConsentLang, type ConsentSegment } from "./consentSegments";

/** Wersja bieżącej treści domyślnej (b, bez pomiaru). Limit ładunku `version`: 32 znaki. */
export const NEWSLETTER_CONSENT_VERSION = "newsletter-2026-10-23";

/**
 * Treść bieżąca (b) jako odcinki - z nich powstaje HTML (lustro SQL) i widok
 * React bez `innerHTML` (`NewsletterConsentText`). Ścieżki EN z prefiksem
 * `/en` (jedna trasa dokumentu na oba języki - `documentIndex.ts`); dawne
 * `/privacy-policy` nie istniało.
 */
export const NEWSLETTER_CONSENT_CURRENT_SEGMENTS: Readonly<
  Record<ConsentLang, readonly ConsentSegment[]>
> = {
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

/** Treść domyślna jako HTML - DOKŁADNIE literał SQL (dowód w rejestrze zgód). */
export function newsletterConsentHtml(lang: ConsentLang): string {
  return segmentsHtml(NEWSLETTER_CONSENT_CURRENT_SEGMENTS[lang]);
}
