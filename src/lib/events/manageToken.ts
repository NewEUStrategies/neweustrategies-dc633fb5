// Klucz samoobsługi zgłoszenia (`manage_token`) - kształt, adres i odczyt.
//
// TEN NAPIS JEST POŚWIADCZENIEM, NIE IDENTYFIKATOREM. Baza trzyma wyłącznie
// jego SHA-256, a `event_registration_cancel` przyjmuje go od KOGOKOLWIEK, kto
// go zna - dlatego traktujemy go jak hasło: nie wkładamy do cache zapytań, nie
// logujemy i nie doklejamy do adresów innych niż strona zarządzania zgłoszeniem.
//
// KSZTAŁT SPRAWDZAMY U SIEBIE, ŻEBY NIE PYTAĆ SIECI O LITERÓWKĘ.
// `_event_new_qr_token()` daje 24 losowe bajty w base64url, czyli dokładnie
// 32 znaki z alfabetu `[A-Za-z0-9_-]`. Wklejony klucz o innym kształcie nie ma
// prawa istnieć w bazie, więc odpowiadamy od razu, zamiast wysyłać zapytanie,
// które i tak wróci z „nie znaleziono".
//
// CZEMU W ADRESIE, A NIE W CIELE ŻĄDANIA. Uczestnik dostaje ten odnośnik
// mailem i musi móc go otworzyć jednym kliknięciem - tak samo jak wypisanie
// z newslettera. Cena jest znana i zaakceptowana: strona ma `noindex, nofollow`,
// nie wychodzi z niej ani jedno żądanie do obcego hosta, a samo otwarcie
// odnośnika NICZEGO NIE ZMIENIA - rezygnacja wymaga świadomego kliknięcia,
// więc skaner poczty ani prefetch przeglądarki nie odwoła nikomu udziału.

/** 24 bajty w base64url - dokładnie 32 znaki, bez wypełnienia `=`. */
export const MANAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function isManageToken(value: string): boolean {
  return MANAGE_TOKEN_PATTERN.test(value.trim());
}

/**
 * Wejście z adresu -> klucz albo `null`.
 *
 * Bierze `token` z wyszukiwania trasy i przycina białe znaki, które wklejenie
 * z klienta pocztowego dokłada zaskakująco często.
 */
export function readManageToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isManageToken(trimmed) ? trimmed : null;
}

/** Ścieżka strony zarządzania zgłoszeniem razem z kluczem. */
export function manageLinkPath(eventSlug: string, token: string): string {
  return `/events/${encodeURIComponent(eventSlug)}/manage?token=${encodeURIComponent(token)}`;
}
