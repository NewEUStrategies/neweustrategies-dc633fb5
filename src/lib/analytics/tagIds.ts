// Publiczne identyfikatory tagu Google i walidatory ich kształtu.
//
// Moduł bez DOM i bez zależności serwerowych: importują go snippet SSR
// (`__root.tsx`), bootstrap kliencki (`ga4Client.ts`) i ścieżki serwerowe
// (Measurement Protocol), więc wszystkie trzy mówią o TYM SAMYM strumieniu.

/**
 * Identyfikator pomiaru GA4 strumienia neweuropeanstrategies.com. Publiczny
 * (widoczny w HTML każdej strony), więc siedzi w kodzie jako pewne źródło:
 * konektor wystawia go wyłącznie jako zmienną build-time, a gdy jej brak,
 * tag ładował się bez GA4 i Analytics nie zbierał danych.
 */
export const GA4_MEASUREMENT_ID = "G-EN05JH34VP";

/**
 * Identyfikator konwersji Google Ads przypięty do tego samego tagu Google
 * (jeden gtag.js, dwa miejsca docelowe). Zmiana konta Ads = zmiana tu.
 *
 * UWAGA: weryfikator Google raportuje na tej domenie także miejsce docelowe
 * AW-11463700688 (inne konto Ads) i drugi strumień G-7QYB5FYQ2Z - żadnego z
 * nich nie ma w kodzie. Przed zmianą tej stałej potwierdzić w Google Ads,
 * które konto ma zbierać konwersje.
 */
export const GOOGLE_ADS_ID = "AW-17612160320";

/** `G-` + 4..16 znaków alfanumerycznych (realne identyfikatory mają 10). */
export const GA4_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,16}$/;

/** `AW-` + 9..12 cyfr. */
export const GOOGLE_ADS_ID_RE = /^AW-\d{9,12}$/;

/**
 * Znormalizowany identyfikator pomiaru GA4 albo "" - nigdy nie przepuszcza
 * wartości spoza kształtu `G-XXXXXXXXXX`. To jedyny filtr między zmienną
 * środowiskową / wpisem w panelu a `gtag('config', …)` w publicznym HTML:
 * klucz API podstawiony przez pomyłkę pod identyfikator pomiaru zostałby
 * inaczej opublikowany w źródle każdej strony, a tag przestałby działać.
 */
export function asGa4MeasurementId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim().toUpperCase();
  return GA4_MEASUREMENT_ID_RE.test(id) ? id : "";
}

/** Znormalizowany identyfikator konwersji Google Ads albo "". */
export function asGoogleAdsId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim().toUpperCase();
  return GOOGLE_ADS_ID_RE.test(id) ? id : "";
}
