// FILTR SZUMU TELEMETRII BŁĘDÓW KLIENTA.
//
// Panel `/admin/performance?tab=errors` ma pokazywać awarie, nie normalne życie
// przeglądarki. Dwie klasy zdarzeń zalewały go bez żadnej wartości
// diagnostycznej (2026-08/09: 56% + 26% wszystkich wpisów):
//
//   1. ANULOWANE ŻĄDANIA - `AbortError: signal is aborted without reason`.
//      Każdy `AbortController` sprzątany w `useEffect` przy odmontowaniu,
//      każdy deadline sondy podglądu i każda przerwana nawigacja produkują
//      dokładnie ten komunikat. To ZAMIERZONE zachowanie, nie błąd.
//   2. ARTEFAKTY UKŁADU - `ResizeObserver loop ...`, które specyfikacja
//      nakazuje zgłaszać jako błąd okna, choć nic się nie zepsuło.
//
// Filtr jest CZYSTĄ funkcją (testowalną bez DOM) i celowo WĄSKI: dopasowujemy
// konkretne, znane komunikaty, żeby nie wyciszyć prawdziwej awarii sieci.

const IGNORABLE_PATTERNS: readonly RegExp[] = [
  /\bsignal is aborted without reason\b/i,
  /\bthe (?:user )?(?:operation|request) was aborted\b/i,
  /\baborted a request\b/i,
  /^AbortError\b/i,
  /\bresizeobserver loop\b/i,
  // Rozszerzenia przeglądarki i skrypty third-party bez CORS - przeglądarka
  // podaje wyłącznie tę zbitkę, więc wpis nie niesie żadnej informacji.
  /^script error\.?$/i,
];

/** Czy komunikat jest znanym, nieszkodliwym szumem, którego NIE raportujemy. */
export function isIgnorableClientError(message: unknown, name?: unknown): boolean {
  if (name === "AbortError") return true;
  if (typeof message !== "string") return false;
  const text = message.trim();
  if (text.length === 0) return true;
  // Sonda bootu potrafi zserializować brak komunikatu; taki wpis („[boot]
  // undefined") mówi tylko tyle, że coś się stało - i tak jest bezużyteczny.
  if (/^(?:undefined|null|\[object object\])$/i.test(text)) return true;
  return IGNORABLE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Wariant dla `unknown` błędu: bierze `name`/`message`, gdy to `Error`. */
export function isIgnorableClientErrorValue(error: unknown): boolean {
  if (error instanceof Error) return isIgnorableClientError(error.message, error.name);
  if (typeof error === "string") return isIgnorableClientError(error);
  return false;
}
