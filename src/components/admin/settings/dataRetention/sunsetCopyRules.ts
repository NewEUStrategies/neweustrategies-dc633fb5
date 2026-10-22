// Reguły edytora treści prośby o potwierdzenie (wygaszanie, I9d-Y1) - moduł
// czysty, bez Reacta.
//
// Osobny liść, bo czytają go dwa leniwe chunki: lista „do wygaszenia" w karcie
// retencji (kotwica odnośnika) i sam edytor (kotwica, znacznik zmian, limity).
// Import z modułu komponentu wciągałby całą listę do chunku edytora i odwrotnie.
//
// LIMIT ODRZUCA, NIE PRZYCINA: pole ponad limit trafia na listę
// `sunsetCopyOverLimit`, a edytor blokuje zapis, dopóki lista nie jest pusta.
// Długość = punkty kodowe (`copyLength`), jak `char_length` w SQL.
import {
  NEWSLETTER_SUNSET_COPY_FIELDS,
  NEWSLETTER_SUNSET_COPY_LIMITS,
  copyLength,
  type NewsletterSunsetCopyField,
  type NewsletterSunsetCopyOverrides,
  type NewsletterSunsetLang,
} from "@/lib/privacy/newsletterSunset";

/** Kotwica edytora treści prośby w ustawieniach newslettera. */
export const NEWSLETTER_SUNSET_COPY_ANCHOR = "newsletter-sunset-copy";

/** Języki treści prośby w kolejności przełącznika. */
export const SUNSET_COPY_LANGS: readonly NewsletterSunsetLang[] = ["pl", "en"];

/** Czy szkic różni się od zapisanej wersji - to decyduje o aktywności zapisu. */
export function sunsetCopyDirty(
  draft: NewsletterSunsetCopyOverrides,
  saved: NewsletterSunsetCopyOverrides,
): boolean {
  return SUNSET_COPY_LANGS.some((lang) =>
    NEWSLETTER_SUNSET_COPY_FIELDS.some((field) => draft[lang][field] !== saved[lang][field]),
  );
}

/** Pola ponad limit (oba języki) - zapis zablokowany, dopóki lista nie jest pusta. */
export function sunsetCopyOverLimit(
  draft: NewsletterSunsetCopyOverrides,
): { lang: NewsletterSunsetLang; field: NewsletterSunsetCopyField }[] {
  return SUNSET_COPY_LANGS.flatMap((lang) =>
    NEWSLETTER_SUNSET_COPY_FIELDS.filter(
      (field) => copyLength(draft[lang][field]) > NEWSLETTER_SUNSET_COPY_LIMITS[field],
    ).map((field) => ({ lang, field })),
  );
}
