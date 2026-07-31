// Pomocniki dla pól bloków przechowujących INLINE HTML (np. treść nagłówka).
//
// Nagłówki w CMS builderze są edytowane przez TipTap, więc `data.text` może
// zawierać znaczniki inline (<strong>, <em>, <span style="color:…">). Renderer
// publiczny musi to rozpoznać i wstawić jako HTML - a nie jako tekst - stąd
// jedno, wspólne miejsce prawdy dla obu stron. Zero `any` / `as any`.

/** Czy string wygląda na inline HTML (a nie zwykły tekst). */
export function looksLikeInlineHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

/**
 * Usuwa pojedynczy zewnętrzny wrapper `<p>…</p>`, który TipTap zawsze dokłada
 * wokół treści jednoakapitowego dokumentu. Wielolinijkowa zawartość (dwa i
 * więcej akapitów) jest sklejana `<br>`, bo nagłówek to jeden wiersz treści.
 */
export function stripParagraphWrapper(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const parts = trimmed.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  if (!parts) return trimmed;
  const inner = parts
    .map((p) => p.replace(/^<p[^>]*>/i, "").replace(/<\/p>$/i, ""))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "<br>" && s !== "<br/>");
  return inner.join("<br>");
}

/** Owija inline HTML w `<p>` na potrzeby dokumentu TipTap. */
export function toParagraphDoc(inline: string): string {
  return `<p>${inline}</p>`;
}

/** Zamienia inline HTML na czysty tekst (spisy treści, kotwice, podglądy). */
export function inlineHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VAR_RE = /^var\(--[a-z0-9-]+(?:,\s*[^();]+)?\)$/i;

/**
 * Zwraca kolor tylko wtedy, gdy jest bezpieczny do wstawienia w atrybut
 * `style` (hex lub token `var(--…)`). Blokuje `url()`, `expression()` itd.
 */
export function safeCssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (HEX_RE.test(v) || VAR_RE.test(v)) return v;
  return undefined;
}
