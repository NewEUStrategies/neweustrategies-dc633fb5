// Ręczne pozycje spisu treści widgetu buildera (TocWidget) - parsowanie linii
// wpisanych przez autora w panelu właściwości. Format (jedna pozycja = linia):
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

import { createAnchorAllocator, slugifyAnchor } from "@/lib/content/anchorSlug";

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
 * Parsuje ręczne pozycje spisu treści.
 *
 * Kontrakt:
 *  - puste linie i linie bez tekstu (np. "#id |") są pomijane;
 *  - tekst zachowuje wszystko po PIERWSZYM "|", więc tytuł może zawierać "|";
 *  - kotwice są deduplikowane wspólnym alokatorem (`tytul`, `tytul-2`, …) -
 *    ta sama semantyka co w silnikach treści, a przy okazji unikalne klucze
 *    Reacta przy powtórzonych tytułach.
 */
export function parseManualTocItems(lines: readonly string[]): ManualTocItem[] {
  const allocator = createAnchorAllocator();
  const out: ManualTocItem[] = [];
  for (const line of lines) {
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
  return out;
}
