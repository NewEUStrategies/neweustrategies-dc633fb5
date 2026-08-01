// Scalanie bloków tekstowych (zachowanie WordPress Gutenberg): Backspace na
// POCZĄTKU niepustego bloku dokleja jego treść do poprzedniego bloku, a
// karetka ląduje dokładnie w punkcie złączenia (nie na końcu!).
//
// Moduł jest czysty: jedyną zależnością środowiskową jest DOMParser
// (przeglądarka + happy-dom w testach), z regexowym fallbackiem dla SSR.

/** Wynik scalenia: nowy HTML pola + offset znakowy karetki (punkt złączenia). */
export interface MergeResult {
  html: string;
  caretOffset: number;
}

/**
 * Długość TEKSTU (bez znaczników, z rozwiniętymi encjami) - musi liczyć tak
 * samo jak `textContent` edytowalnego DOM-u, bo o ten offset ustawiamy karetkę.
 */
export function htmlTextLength(html: string): number {
  if (!html) return 0;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    return (doc.body.textContent ?? "").length;
  }
  // Fallback SSR: zdjęcie znaczników + najczęstsze encje.
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').length;
}

/**
 * Zawartość inline bloku akapitu: zdejmuje zewnętrzne `<p>…</p>`, a granice
 * wielu akapitów (rzadkie - np. po wklejce) zamienia na `<br>`, żeby scalenie
 * nie gubiło treści ani nie wstrzykiwało zagnieżdżonych `<p>` do celu.
 */
export function innerInlineHtml(html: string): string {
  const trimmed = (html ?? "").trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/<\/p>\s*<p[^>]*>/gi, "<br>")
    .replace(/^<p[^>]*>/i, "")
    .replace(/<\/p>$/i, "");
}

/**
 * Dokleja treść inline na koniec HTML-a poprzedniego bloku. Gdy poprzednik
 * kończy się `</p>`, treść wchodzi DO tego akapitu (jeden `<p>`, jak w WP).
 * `caretOffset` to długość tekstu poprzednika sprzed scalenia.
 */
export function mergeInlineIntoHtml(prevHtml: string, incomingInner: string): MergeResult {
  const caretOffset = htmlTextLength(prevHtml);
  const prev = (prevHtml ?? "").trim();
  if (!incomingInner) return { html: prev, caretOffset };
  if (!prev) return { html: `<p>${incomingInner}</p>`, caretOffset: 0 };
  const closing = prev.match(/^([\s\S]*)<\/p>\s*$/i);
  const html = closing ? `${closing[1]}${incomingInner}</p>` : `${prev}${incomingInner}`;
  return { html, caretOffset };
}
