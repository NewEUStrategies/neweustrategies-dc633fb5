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
// KLUCZ JEDZIE WE FRAGMENCIE (`#token=`), NIE W ZAPYTANIU (REG-17). Uczestnik
// dostaje odnośnik mailem i musi móc go otworzyć jednym kliknięciem - ale
// fragmentu przeglądarka nie wysyła na serwer: klucz nie trafia do logów
// dostępu serwera ani CDN, do nagłówka `Referer` ani do adresu powrotu z kasy
// (Stripe). Tak samo jedzie kod biletu (`#t=`) i token potwierdzenia zgód.
// Fragment ZOSTAJE w pasku adresu: zakładka ma dalej otwierać tę stronę, a
// fragment i tak nigdzie nie wychodzi. Stare maile z `?token=` działają do końca
// wydarzenia (klucz wygasa wtedy w bazie) - trasa przepisuje je na fragment
// (`navigate` z `replace`), więc klucz z zapytania nie zostaje w historii.
//
// POWRÓT Z KASY BEZ KLUCZA W ADRESIE. Adres powrotu wędruje do dostawcy
// płatności, więc nie niesie klucza (`managePagePath`). Przed wyjściem do kasy
// strona odkłada klucz do `sessionStorage` tej karty (`stashManageTokenForReturn`):
// tylko dla tego wydarzenia, na 2 godziny, zużywany przy pierwszym odczycie.
// Płatność w innej karcie albo przeglądarce kończy się ekranem „wklej klucz"
// - odnośnik z maila nadal działa.
//
// OTWARCIE ODNOŚNIKA NICZEGO NIE ZMIENIA - rezygnacja wymaga świadomego
// kliknięcia, więc skaner poczty ani prefetch przeglądarki nie odwoła nikomu
// udziału.

/** 24 bajty w base64url - dokładnie 32 znaki, bez wypełnienia `=`. */
export const MANAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function isManageToken(value: string): boolean {
  return MANAGE_TOKEN_PATTERN.test(value.trim());
}

/**
 * Napis -> klucz albo `null`.
 *
 * Przycina białe znaki, które wklejenie z klienta pocztowego dokłada
 * zaskakująco często. Czyta też STARY adres `?token=` (wyszukiwanie trasy) -
 * tylko po to, żeby trasa przepisała go na fragment.
 */
export function readManageToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isManageToken(trimmed) ? trimmed : null;
}

/** Ścieżka strony zarządzania zgłoszeniem BEZ klucza (adres powrotu z kasy). */
export function managePagePath(eventSlug: string): string {
  return `/events/${encodeURIComponent(eventSlug)}/manage`;
}

/** Fragment adresu z kluczem, bez `#`: `token=<klucz>` (dla `navigate({ hash })`). */
export function manageFragment(token: string): string {
  return new URLSearchParams({ token }).toString();
}

/** Ścieżka strony zarządzania zgłoszeniem: `/events/<slug>/manage#token=<klucz>`. */
export function manageLinkPath(eventSlug: string, token: string): string {
  return `${managePagePath(eventSlug)}#${manageFragment(token)}`;
}

/** `location.hash` (z `#` albo bez) -> klucz albo `null`, gdy brak lub zły kształt. */
export function readManageFragment(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return readManageToken(params.get("token"));
}

// PRZECHOWALNIA NA POWRÓT Z KASY ------------------------------------------------

/** Klucz `sessionStorage` - jedna pozycja na kartę, nadpisywana przy każdej kasie. */
export const MANAGE_RETURN_STASH_KEY = "nes:event-manage-return";

/** Jak długo odłożony klucz czeka na powrót z kasy. */
export const MANAGE_RETURN_STASH_TTL_MS = 2 * 60 * 60 * 1000;

interface StashedManageToken {
  slug: string;
  token: string;
  at: number;
}

/**
 * `sessionStorage` albo `null`. Dostęp RZUCA (a nie zwraca `null`), gdy
 * przeglądarka blokuje dane witryny albo działa w trybie prywatnym z odciętym
 * magazynem - wtedy powrót z kasy kończy się ekranem „wklej klucz".
 */
function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Odkłada klucz przed wyjściem do kasy (ta karta, to wydarzenie, 2 h). */
export function stashManageTokenForReturn(
  eventSlug: string,
  token: string,
  now: number = Date.now(),
): void {
  const trimmed = readManageToken(token);
  const store = sessionStore();
  if (trimmed === null || store === null) return;
  const entry: StashedManageToken = { slug: eventSlug, token: trimmed, at: now };
  try {
    store.setItem(MANAGE_RETURN_STASH_KEY, JSON.stringify(entry));
  } catch {
    // Pełny albo zablokowany magazyn - powrót pokaże pole na klucz.
  }
}

/**
 * Odłożony klucz dla TEGO wydarzenia albo `null`. Pozycja znika przy każdym
 * odczycie (także cudza i przeterminowana): klucz nie leży w magazynie dłużej,
 * niż trwa powrót z kasy.
 */
export function takeStashedManageToken(eventSlug: string, now: number = Date.now()): string | null {
  const store = sessionStore();
  if (store === null) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(MANAGE_RETURN_STASH_KEY);
    if (raw !== null) store.removeItem(MANAGE_RETURN_STASH_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof entry !== "object" || entry === null) return null;
  const { slug, token, at } = entry as Partial<StashedManageToken>;
  if (slug !== eventSlug || typeof at !== "number") return null;
  if (at > now || now - at > MANAGE_RETURN_STASH_TTL_MS) return null;
  return readManageToken(token);
}

// BILET Z KODEM QR: KOD JEDZIE WE FRAGMENCIE (`#`), NIE W ZAPYTANIU. Kod
// wejścia to poświadczenie przy bramce, a fragmentu przeglądarka nie wysyła
// na serwer - nie trafia więc do logów dostępu, do nagłówka `Referer` ani do
// podglądu linków w poczcie. Strona biletu rysuje QR w przeglądarce.
// Kod ma ten sam kształt co klucz samoobsługi (`_event_new_qr_token()`).

export interface TicketFragment {
  qrToken: string;
  /** Klucz samoobsługi - tylko w bilecie gościa grupy, który go nie miał. */
  manageToken: string | null;
}

/** Ścieżka strony biletu: `/events/<slug>/ticket#t=<kod>&m=<klucz>`. */
export function ticketLinkPath(
  eventSlug: string,
  qrToken: string,
  manageToken: string | null = null,
): string {
  const fragment = new URLSearchParams({ t: qrToken });
  if (manageToken !== null) fragment.set("m", manageToken);
  return `/events/${encodeURIComponent(eventSlug)}/ticket#${fragment.toString()}`;
}

/** `location.hash` -> kod i opcjonalny klucz albo `null`, gdy kodu brak. */
export function readTicketFragment(hash: string): TicketFragment | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const qrToken = readManageToken(params.get("t"));
  if (qrToken === null) return null;
  return { qrToken, manageToken: readManageToken(params.get("m")) };
}
