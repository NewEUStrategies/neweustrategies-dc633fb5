// Silnik przypisów bloków. Wydzielony z BlocksRenderer, bo to samodzielny,
// czysto tekstowy problem: znajdź `[fn]…[/fn]` w kolejności renderu, ponumeruj,
// zamień na <sup> z tooltipem i zbierz treści do sekcji końcowej.
//
// Pre-pass zbiera przypisy PRZED renderem, dlatego sekcja przypisów jest znana
// na pierwszym malowaniu / w SSR (wcześniej kolektor był mutowany w trakcie
// renderu dziecka, więc rodzic czytał `notes.length === 0` i sekcja się nie
// pojawiała). Render staje się wtedy czystym odczytem po id bloku, a numeracja
// odpowiada kolejności renderu.

import type { Block } from "@/lib/blocks/types";
import { readBlocksArray, sanitize } from "./data";

/** Globalny stan przypisów: zbiera [fn]…[/fn] w kolejności wystąpienia. */
export interface FootnoteCollector {
  notes: string[];
}

/** Escape HTML w treści przypisu (atrybut title + sekcja końcowa). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Zamienia [fn]treść[/fn] na <sup> z tooltipem; treści dopisuje do kolektora.
 * Emituje `data-fn="N"` na <a>, żeby zadziałał wspólny <FootnoteTooltips>.
 */
export function replaceFootnotes(html: string, fn: FootnoteCollector): string {
  return html.replace(/\[fn\]([\s\S]*?)\[\/fn\]/g, (_m, content: string) => {
    const text = content.trim();
    if (!text) return "";
    fn.notes.push(text);
    const n = fn.notes.length;
    const safeTitle = escapeHtml(text.replace(/<[^>]+>/g, ""));
    return `<sup class="fn-ref"><a href="#fn-${n}" id="fnref-${n}" data-fn="${n}" title="${safeTitle}" aria-describedby="footnotes-heading" class="text-primary no-underline hover:underline">[${n}]</a></sup>`;
  });
}

/** Czy dany string zawiera choć jeden shortcode [fn]…[/fn]. */
export function hasFn(v: unknown): v is string {
  return typeof v === "string" && v.includes("[fn]");
}

/** Zamienia treść przypisu z plain/markdown na czysty HTML dla listy końcowej. */
export function renderFootnoteHtml(text: string): string {
  return sanitize(text);
}

/**
 * Przechodzi bloki w kolejności renderu (kolumny: lewa, potem prawa),
 * przekształcając shortcody przypisów w blokach paragraph/html/heading/quote/
 * list/table dokładnie raz i zbierając treści.
 *
 * Konwencja kluczy pól (płaska, żeby jedna Mapa obsłużyła każdy blok):
 *   paragraph/html:  `${id}`
 *   heading:         `${id}:text`
 *   quote:           `${id}:text`, `${id}:cite`
 *   list:            `${id}:item:${i}`
 *   table:           `${id}:cell:${r}:${c}`
 */
export function precomputeFootnotes(
  blocks: readonly Block[],
  fn: FootnoteCollector,
  out: Map<string, string>,
): void {
  const process = (raw: unknown): string | null => {
    if (!hasFn(raw)) return null;
    return replaceFootnotes(sanitize(raw), fn);
  };
  for (const b of blocks) {
    if (b.type === "paragraph" || b.type === "html") {
      out.set(b.id, replaceFootnotes(sanitize(String(b.data.html ?? "")), fn));
    } else if (b.type === "heading") {
      const v = process(b.data.text);
      if (v !== null) out.set(`${b.id}:text`, v);
    } else if (b.type === "quote") {
      const text = process(b.data.text);
      if (text !== null) out.set(`${b.id}:text`, text);
      const cite = process(b.data.cite);
      if (cite !== null) out.set(`${b.id}:cite`, cite);
    } else if (b.type === "list") {
      const items = Array.isArray(b.data.items) ? (b.data.items as unknown[]) : [];
      items.forEach((it, i) => {
        const v = process(it);
        if (v !== null) out.set(`${b.id}:item:${i}`, v);
      });
    } else if (b.type === "table") {
      const rows = Array.isArray(b.data.rows) ? (b.data.rows as unknown[]) : [];
      rows.forEach((r, ri) => {
        if (!Array.isArray(r)) return;
        r.forEach((c, ci) => {
          const v = process(c);
          if (v !== null) out.set(`${b.id}:cell:${ri}:${ci}`, v);
        });
      });
    } else if (b.type === "columns") {
      precomputeFootnotes(readBlocksArray(b.data.left), fn, out);
      precomputeFootnotes(readBlocksArray(b.data.right), fn, out);
    } else if (b.type === "group" || b.type === "row" || b.type === "stack" || b.type === "grid") {
      // Kontenery trzymają dzieci pod `data.children`; przechodzimy je też, bo
      // inaczej przypisy w zagnieżdżonym paragraphie renderują się jako dosłowne
      // shortcody i wypadają z sekcji przypisów.
      precomputeFootnotes(readBlocksArray(b.data.children), fn, out);
    }
  }
}
