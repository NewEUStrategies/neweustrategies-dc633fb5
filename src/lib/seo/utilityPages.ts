// Strony TECHNICZNE CMS-a (konto, koszyk, logowanie, personalizacja) - nigdy
// nie są indeksowalne, bez względu na flagę `seo_noindex` w bazie.
//
// PO CO (2026-11, wynik Google dla zapytania „new european strategies").
// Import z WordPressa przyniósł opublikowane strony wtyczek: personalizację
// zainteresowań (`customize-interests`), edycję zgłoszenia, koszyk, zamówienie,
// konto, logowanie i rejestrację członkostwa, reset hasła. Żadna nie miała
// `seo_noindex`, więc wszystkie szły do `sitemaps/pages.xml` (PL+EN) i do mapy
// HTML. Skutek był widoczny w SERP-ie marki: Google wybrał „Customize
// Interests" na sitelink obok „Analiz" i „O nas", czyli pokazywał formularz
// preferencji zamiast sekcji redakcyjnej.
//
// Sitelinki są algorytmiczne (Google nie ma przełącznika -
// https://developers.google.com/search/docs/appearance/sitelinks), ale jedyną
// udokumentowaną dźwignią usunięcia adresu z wyników jest `noindex`. Strona
// techniczna dostaje więc `noindex, follow` (linki nawigacji dalej przekazują
// sygnał) i znika z mapy XML oraz HTML - mapa nie może reklamować adresu,
// któremu meta robots każe zniknąć.
//
// REGUŁA: pełny slug strony (ostatni człon ścieżki) z listy poniżej. Celowo
// dopasowanie DOKŁADNE, nie prefiksowe: `zamowienie-publikacji` albo
// `register-of-experts` to potencjalnie treść, a lista ma wyłącznie znane
// slugi wtyczek (WooCommerce, Paid Memberships Pro, formularze zgłoszeń)
// i ich odpowiedniki językowe.

/** Slugi stron technicznych - zawsze `noindex`, poza mapą XML i HTML. */
export const UTILITY_PAGE_SLUGS: ReadonlySet<string> = new Set([
  // Personalizacja i formularze zgłoszeń
  "customize-interests",
  "edit-your-submission",
  // Sklep (WooCommerce)
  "koszyk",
  "cart",
  "zamowienie",
  "checkout",
  "moje-konto",
  "my-account",
  // Konto i członkostwo
  "register",
  "rejestracja",
  "password-reset",
  "reset-hasla",
  "lost-password",
  "membership-login",
  // `membership-registration` CELOWO poza listą: pod tym adresem renderuje się
  // trasa kodowa - indeksowalna strona pozyskania członka z treścią i linkami
  // (`routes/membership-registration.tsx`), a nie martwy formularz wtyczki.
  "membership-account",
  "membership-billing",
  "membership-cancel",
  "membership-checkout",
  "membership-confirmation",
  "membership-invoice",
]);

/** Czy pojedynczy slug strony oznacza stronę techniczną. */
export function isUtilityPageSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && UTILITY_PAGE_SLUGS.has(slug.trim().toLowerCase());
}

/**
 * Czy ścieżka strony (`/moje-konto`, `en/koszyk`, pełny adres) prowadzi na
 * stronę techniczną. Decyduje ostatni człon ścieżki - slug samej strony;
 * query, hash i prefiks języka niczego nie zmieniają.
 */
export function isUtilityPagePath(path: string | null | undefined): boolean {
  if (typeof path !== "string" || !path) return false;
  const bare = path.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const last = bare.split("/").filter(Boolean).at(-1);
  return isUtilityPageSlug(last);
}
