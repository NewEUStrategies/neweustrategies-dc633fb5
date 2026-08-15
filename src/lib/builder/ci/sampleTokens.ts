// Kanoniczny zbiór napisów PRÓBKI kontekstu wpisu - wyliczany, nie przepisywany.
//
// PROBLEM, KTÓRY TEN MODUŁ LIKWIDUJE
// Widgety dynamiczne robiły `useCurrentPostCtx() ?? PLACEHOLDER_POST_CTX`, więc
// każda powierzchnia renderująca sekcję buildera BEZ providera - nagłówek,
// stopka, popup, szuflada mobilna, strona taksonomii - pokazywała REALNYM
// odwiedzającym zmyślonego autora ("Jan Kowalski"), zmyślony tytuł ("Tytuł
// przykładowego wpisu"), zmyślone archiwum ("Przykładowe archiwum / 12 wpisów")
// i zmyślony licznik odsłon (1234). Naprawa (PR #141) związała próbkę z trybem
// edycji, ale zabezpieczenie zostało punktowe.
//
// Ten moduł daje bramce LISTĘ NAPISÓW DO ŚCIGANIA, wyprowadzoną z tego samego
// obiektu, który renderuje kanwa. Dopisanie nowego pola do `PLACEHOLDER_POST_CTX`
// automatycznie rozszerza zakres bramki - lista nie może się rozjechać ze
// źródłem, bo nie jest osobną listą.
import { PLACEHOLDER_POST_CTX } from "@/lib/content-model/postContext";

/**
 * Napisy zbyt krótkie albo zbyt ogólne, by ich obecność w HTML-u cokolwiek
 * dowodziła (slug "podglad", identyfikator "preview", nazwa kategorii "Przykład"
 * czy typ archiwum "category" trafiają do klas CSS, atrybutów i realnych treści).
 * Bramka pilnuje fraz, które MOGĄ pochodzić wyłącznie z próbki.
 */
const NOT_DISTINCTIVE: ReadonlySet<string> = new Set([
  "preview",
  "podglad",
  "category",
  "Start",
  "Przykład",
  "CMS",
  "cms",
  "wiadomosci",
  "Wiadomości",
  "jan-kowalski",
]);

const MIN_TOKEN_LENGTH = 8;

function collectStrings(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    const text = value.trim();
    if (
      text.length >= MIN_TOKEN_LENGTH &&
      !NOT_DISTINCTIVE.has(text) &&
      !text.startsWith("data:")
    ) {
      out.add(text);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

/**
 * Wszystkie charakterystyczne napisy próbki. Każdy z nich w HTML-u strony
 * publicznej to wyciek danych przykładowych do realnego odwiedzającego.
 */
export const SAMPLE_POST_TOKENS: ReadonlyArray<string> = (() => {
  const out = new Set<string>();
  collectStrings(PLACEHOLDER_POST_CTX, out);
  // Daty i URL-e próbki są generowane / neutralne - nie ścigamy ich treści.
  for (const token of [...out]) {
    if (/^https?:\/\//.test(token) || /^\d{4}-\d{2}-\d{2}T/.test(token)) out.delete(token);
  }
  return [...out].sort((a, b) => (a < b ? -1 : 1));
})();

/**
 * Liczby, które próbka wprowadzała do widgetów licznikowych. Ściganie samej
 * cyfry w HTML-u dawałoby fałszywe trafienia, więc bramka używa ich tylko tam,
 * gdzie widget renderuje wyłącznie licznik.
 */
export const SAMPLE_POST_NUMBERS: ReadonlyArray<number> = [
  PLACEHOLDER_POST_CTX.viewCount ?? 0,
  PLACEHOLDER_POST_CTX.archive?.count ?? 0,
].filter((n) => n > 0);

/** Pierwszy napis próbki obecny w tekście, albo `null`. Do komunikatów błędów. */
export function findSampleLeak(text: string): string | null {
  for (const token of SAMPLE_POST_TOKENS) {
    if (text.includes(token)) return token;
  }
  return null;
}
