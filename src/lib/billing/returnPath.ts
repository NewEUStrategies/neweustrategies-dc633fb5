// Sanitizacja ścieżki powrotu przekazywanej przez klienta do operatora
// płatności (checkout, portal klienta). Wpuszczamy WYŁĄCZNIE ścieżki względne
// w obrębie serwisu - dzięki temu adres powrotu nie może stać się wektorem
// open redirect, nawet gdy ktoś podmieni payload server fn.
//
// Moduł czysty (bez zależności serwerowych) - współdzielony i testowalny.

/** Domyślny cel powrotu, gdy klient nic nie poda lub poda coś niedozwolonego. */
export const DEFAULT_RETURN_PATH = "/profile/plan";

const MAX_LENGTH = 300;

/**
 * Zwraca bezpieczną ścieżkę względną (zaczyna się od pojedynczego `/`,
 * bez schematu, bez hosta, bez znaków sterujących). W innym wypadku - fallback.
 */
export function safeReturnPath(
  path: string | null | undefined,
  fallback: string = DEFAULT_RETURN_PATH,
): string {
  if (typeof path !== "string") return fallback;
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return fallback;
  // Ścieżka absolutna w obrębie serwisu; `//host` i `/\host` to protocol-relative.
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
  // Znaki sterujące i białe znaki potrafią rozbić parsowanie URL-a.
  // Klasa sterująca jest tu CELOWA - to sanityzacja wejścia, nie przeoczenie:
  // `no-control-regex` ostrzega przed przypadkowym znakiem sterującym we wzorcu,
  // a my dokładnie takich znaków szukamy, żeby je ODRZUCIĆ (CR/LF w ścieżce powrotu
  // to wektor wstrzyknięcia nagłówka).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return fallback;
  // Schemat w środku (np. "/redirect?to=javascript:...") jest nieszkodliwy dla
  // operatora, ale "/..:" na początku segmentu już nie - odrzucamy jawne schematy.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(trimmed)) return fallback;
  return trimmed;
}
