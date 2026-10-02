// Adres wypisu z newslettera - JEDNA definicja dla nagłówka i stopki.
//
// PRZYCZYNA ŹRÓDŁOWA. Kampania wstawiała do nagłówka `List-Unsubscribe` adres
// STRONY `/newsletter/unsubscribe`, a nie endpointu. RFC 8058 wymaga, żeby
// klient pocztowy (Gmail, Yahoo, Apple Mail) mógł POST-ować `List-Unsubscribe=
// One-Click` wprost na adres z nagłówka - a trasa strony nie ma handlera POST,
// więc wypis jednym kliknięciem po prostu nie działał. Przycisk „Wypisz się"
// w skrzynce odbiorcy niczego nie robił, a bramki Google/Yahoo dla nadawców
// masowych traktują to jak brak mechanizmu wypisu.
//
// Dlatego adres ZAWSZE wskazuje endpoint API, także w stopce HTML:
//   * POST (one-click z klienta pocztowego) wykonuje wypis,
//   * GET z przeglądarki (Accept: text/html) dostaje 303 na przyjazną stronę,
//     która dopiero po kliknięciu „Potwierdź" wysyła POST - skanery linków
//     w bramkach pocztowych (GET) nadal nikogo nie wypisują,
//   * jeden adres w nagłówku i w stopce to jeden kontrakt pod testem, a strona
//     może zmienić ścieżkę (np. wersja językowa) bez psucia maili już wysłanych.
//
// Moduł czysty, bez importów serwerowych - wołany z wysyłki kampanii i z maila
// potwierdzającego zapis.

/** Publiczny endpoint wypisu (GET: walidacja/303, POST: wypis). */
export const NEWSLETTER_UNSUBSCRIBE_API_PATH = "/api/public/newsletter/unsubscribe";

/** Przyjazna strona potwierdzenia wypisu, na którą GET z przeglądarki robi 303. */
export const NEWSLETTER_UNSUBSCRIBE_PAGE_PATH = "/newsletter/unsubscribe";

/**
 * Absolutny adres wypisu dla subskrybenta. Origin bez końcowego ukośnika -
 * podwójny `//` w ścieżce część klientów pocztowych traktuje jak inny adres.
 */
export function newsletterUnsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${NEWSLETTER_UNSUBSCRIBE_API_PATH}?token=${encodeURIComponent(token)}`;
}
