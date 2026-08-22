// Pre-pass przypisów dla silnika bloków.
//
// Ten moduł NIE ma własnej implementacji rozwijania `[fn]…[/fn]` - deleguje do
// `src/lib/footnotes.ts::expandFootnotes`, wspólnego dla wszystkich trzech
// silników treści (blocks / builder / html). Wcześniej istniała tu druga,
// równoległa kopia, utrzymywana w zgodzie z pierwszą KOMENTARZEM, nie kodem -
// czyli dwa miejsca do zmiany przy każdej modyfikacji kontraktu markera i stała
// możliwość cichego rozjazdu (dokładnie taki rozjazd - `title` i klasy Tailwind
// tylko po stronie bloków - opisał audyt z 2026-07-25).
//
// Rola tego modułu jest teraz węższa i czysto blokowa: przejść drzewo bloków w
// kolejności renderu i zebrać przekształcone HTML-e do mapy kluczowanej polami.
// Sam pre-pass jest istotny: sekcja przypisów musi być znana PRZED renderem,
// żeby istniała na pierwszym malowaniu i w SSR (wcześniej kolektor był mutowany
// w trakcie renderu dziecka, więc rodzic czytał `notes.length === 0`).

import type { Block } from "@/lib/blocks/types";
import { expandFootnotes, type FootnoteCounter } from "@/lib/footnotes";
import { readBlocksArray, sanitize } from "./data";

/**
 * Kolektor przypisów. Alias na wspólny `FootnoteCounter`, żeby oba silniki
 * niosły JEDEN typ stanu - numeracja pochodzi z `counter`, a nie z długości
 * tablicy, więc identyfikatory są jawne i nie zależą od indeksu w widoku.
 */
export type FootnoteCollector = FootnoteCounter;

/**
 * Zamienia `[fn]treść[/fn]` na marker i dopisuje treści do kolektora.
 * Cienki alias na wspólny silnik - zachowany, bo nazwa jest zadomowiona w
 * warstwie bloków i czyta się lepiej w kontekście pre-passu.
 */
export function replaceFootnotes(html: string, fn: FootnoteCollector): string {
  return expandFootnotes(html, fn);
}

/** Czy string zawiera shortcode [fn]…[/fn] albo stary markup przypisu z WP. */
export function hasFn(v: unknown): v is string {
  return typeof v === "string" && (v.includes("[fn]") || v.includes("footnote_referrer"));
}

/** Zamienia treść przypisu z plain/markdown na czysty HTML dla listy końcowej. */
export function renderFootnoteHtml(text: string): string {
  return sanitize(text);
}

/**
 * Przechodzi bloki w kolejności renderu (kolumny: lewa, potem prawa),
 * przekształcając shortcody przypisów dokładnie raz i zbierając treści.
 *
 * ZASIĘG - świadomie ograniczony do pól renderowanych jako HTML.
 * Marker przypisu to znacznik (`<sup class="fn-ref">…`), więc pole wstawiane
 * jako węzeł tekstowy React pokazałoby go DOSŁOWNIE. W rendererze bloków
 * `dangerouslySetInnerHTML` na treści występuje wyłącznie w blokach poniżej -
 * pozostałe typy renderują tekst i dlatego NIE są tu obsługiwane (to nie jest
 * przeoczenie; ta sama zasada rządzi mapą `WIDGET_TEXT_FIELDS` po stronie
 * buildera).
 *
 * Konwencja kluczy pól (płaska, żeby jedna Mapa obsłużyła każdy blok):
 *   paragraph/html/spoiler:  `${id}`
 *   heading:                 `${id}:text`
 *   quote:                   `${id}:text`, `${id}:cite`
 *   list:                    `${id}:item:${i}`
 *   table:                   `${id}:cell:${r}:${c}`
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
    if (b.type === "paragraph" || b.type === "html" || b.type === "spoiler") {
      // `spoiler` też wstawia `data.html` przez dangerouslySetInnerHTML
      // (molecules.tsx::renderSpoiler), więc należy do tej samej rodziny.
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
