// Ręczne pozycje spisu treści widgetu buildera (TocWidget) - odczyt z treści
// widgetu + parsowanie linii wpisanych przez autora w panelu właściwości.
// Format (jedna pozycja = linia):
//
//   "Tekst"          -> H2, kotwica = slugifyAnchor("Tekst")
//   "-- Tekst"       -> H3 (wcięcie), kotwica jw.
//   "#id | Tekst"    -> jawna kotwica istniejącego nagłówka ("#" opcjonalny)
//
// Czysty moduł (bez DOM i Reacta): identyczny wynik na serwerze i w
// przeglądarce, testowalny jednostkowo i objęty testem parytetu
// międzysilnikowego (lib/content/anchorSlug.test.ts). Kotwice liczy JEDYNYM
// kanonicznym slugifikatorem - wcześniej widget miał piątą, rozbieżną kopię
// slugify (NFKD-only), która gubiła litery atomowe (`ł`) i linkowała do
// `#…-ma-ych-…`, gdy silniki treści emitowały `#…-malych-…`.
//
// Klucz treści (`items`) i jego odczyt mieszkają TUTAJ, nie w rendererze.
// Rozjazd "schemat zapisuje X, renderer czyta Y" był realnym błędem: pole
// deklarowano jako `stringArray` (zapis do `items`), a widget czytał wyłącznie
// `items_pl` / `items_en`, więc ręczne pozycje nigdy się nie renderowały.

import { createAnchorAllocator, slugifyAnchor } from "@/lib/content/anchorSlug";
import { pickI18nArray, type ContentBag, type ContentLang } from "@/lib/content-model/contentValue";

export interface ManualTocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Kanoniczna kotwica nagłówka. Re-eksport dla konsumentów widgetu i testu
 * parytetu - żeby ten moduł nie mógł ponownie rozjechać się z resztą silników.
 */
export const slugifyHeading = slugifyAnchor;

/**
 * Bazowy klucz treści z ręcznymi pozycjami. JEDNO źródło prawdy wspólne dla
 * schematu pola (`WIDGET_SCHEMAS.toc.items`, typ `i18nStringArray`) i dla
 * odczytu w rendererze.
 */
export const MANUAL_TOC_ITEMS_KEY = "items";

/**
 * Linie ręcznych pozycji z treści widgetu: `items_${lang}` -> `items_pl` ->
 * `items_en` -> legacy `items`. Ostatnie ogniwo jest tu po to, aby treść
 * zapisana przez zepsutą kontrolkę (bezjęzykowy `items`) zaczęła działać
 * zamiast przepaść przy migracji pola na dwujęzyczne.
 */
export function readManualTocLines(content: ContentBag, lang: ContentLang): string[] {
  return pickI18nArray(content, MANUAL_TOC_ITEMS_KEY, lang);
}

/**
 * Parsuje ręczne pozycje spisu treści.
 *
 * Kontrakt:
 *  - każdy element wejścia może sam zawierać znaki nowej linii (wklejony blok
 *    tekstu, starsze zapisy jednopolowe) - jest wtedy rozbijany na pozycje;
 *  - puste linie i linie bez tekstu (np. "#id |") są pomijane;
 *  - tekst zachowuje wszystko po PIERWSZYM "|", więc tytuł może zawierać "|";
 *  - kotwice są deduplikowane wspólnym alokatorem (`tytul`, `tytul-2`, …) -
 *    ta sama semantyka co w silnikach treści, a przy okazji unikalne klucze
 *    Reacta przy powtórzonych tytułach.
 */
export function parseManualTocItems(lines: readonly string[]): ManualTocItem[] {
  const allocator = createAnchorAllocator();
  const out: ManualTocItem[] = [];
  for (const entry of lines) {
    for (const line of entry.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const level: 2 | 3 = trimmed.startsWith("--") ? 3 : 2;
      const clean = trimmed.replace(/^--\s*/, "");
      const pipe = clean.indexOf("|");
      const explicit = pipe >= 0 ? clean.slice(0, pipe).trim().replace(/^#/, "") : "";
      const text = (pipe >= 0 ? clean.slice(pipe + 1) : clean).trim();
      if (!text) continue;
      out.push({ id: allocator.allocate(text, explicit), text, level });
    }
  }
  return out;
}
