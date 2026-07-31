// Skanowanie nagłówków wyrenderowanej treści - wspólny silnik KLIENCKIEGO
// nadawania kotwic. Konsumenci: pływający spis treści (`FloatingShareBar`)
// oraz widget spisu treści buildera (`TocWidget`). Mieszka w lib/content, bo
// to CZYSTA logika nad DOM-em: da się ją przetestować jednostkowo bez
// montowania komponentów, a kotwice liczy tym samym modułem co silniki
// serwerowe (lib/content/anchorSlug), więc `#kotwica` z serwera i z klienta
// zawsze wskazuje ten sam nagłówek.

import { createAnchorAllocator, legacyAnchorVariants, slugifyAnchor } from "./anchorSlug";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5;

export interface ScannedHeading {
  id: string;
  text: string;
  level: HeadingLevel;
}

/** Selektor nagłówków branych do spisu treści (H6 celowo pominięty). */
export const HEADING_SELECTOR = "h1, h2, h3, h4, h5";

/**
 * Kanoniczna kotwica nagłówka. Re-eksport, żeby konsumenci skanera (i test
 * parytetu międzysilnikowego) nie musieli znać ścieżki do `anchorSlug`.
 */
export const slugifyHeading = slugifyAnchor;

/** Korzeń treści artykułu - kolejność selektorów od najbardziej do najmniej jawnego. */
export function getArticleRoot(doc: Document = document): HTMLElement | null {
  return (
    doc.querySelector<HTMLElement>(".article-body") ??
    doc.querySelector<HTMLElement>("[data-cms-prose]") ??
    doc.querySelector<HTMLElement>("article")
  );
}

export interface ScanHeadingsOptions {
  /** Selektor nagłówków; domyślnie `HEADING_SELECTOR` (h1-h5). */
  selector?: string;
  /**
   * Nagłówki zawarte w przodku pasującym do tego selektora są pomijane w
   * całości (bez wpisu na liście i bez nadawania id). Widget spisu treści
   * wyklucza tak własny chrome: `[data-widget-toc]`.
   */
  excludeAncestor?: string;
  /**
   * Nagłówek o dokładnie tej treści (porównanie po `trim`, bez rozróżniania
   * wielkości liter) jest pomijany - np. autorski nagłówek "Spis treści",
   * który dublowałby tytuł widgetu.
   */
  skipText?: string;
}

/**
 * Zbiera nagłówki z korzenia treści i - gdy nagłówek nie ma `id` - nadaje mu
 * kanoniczną kotwicę.
 *
 * Kontrakt:
 *  - istniejące `id` (z SSR: silnik richtext / bloków) jest ZAWSZE zachowywane,
 *    więc już opublikowane linki działają bez zmian;
 *  - nowo nadane `id` są kanoniczne i deduplikowane wspólnym alokatorem
 *    (`tytul`, `tytul-2`, `tytul-3` - bez dawnego narastania `tytul-2-2`);
 *  - nowo nadane `id` nigdy nie przejmują identyfikatora istniejącego GDZIE
 *    INDZIEJ w dokumencie (np. `<main id="main">`) - id wewnątrz korzenia są
 *    zarezerwowane wprost, więc każde trafienie `getElementById` to kolizja
 *    zewnętrzna i alokator wydaje kolejny sufiks;
 *  - dla nagłówka, którego kanoniczna kotwica różni się od historycznej,
 *    dokładamy pusty `<span id="…">` jako alias, żeby stare `#kotwica` nadal
 *    trafiały w cel (te same aliasy emituje serwerowy silnik bloków).
 */
export function scanHeadings(
  root: HTMLElement,
  options: ScanHeadingsOptions = {},
): ScannedHeading[] {
  const doc = root.ownerDocument;
  const skipText = options.skipText?.trim().toLowerCase() ?? "";
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(options.selector ?? HEADING_SELECTOR),
  );
  const allocator = createAnchorAllocator();
  // Najpierw rezerwujemy WSZYSTKIE istniejące id (także nagłówków wykluczonych
  // i pomijanych), żeby kotwica nadana nagłówkowi bez id nie przechwyciła
  // identyfikatora nagłówka występującego dalej ani kotwicy aliasowej
  // wyemitowanej przez serwerowy silnik bloków.
  for (const node of nodes) allocator.reserve(node.id);
  for (const alias of root.querySelectorAll<HTMLElement>("[data-anchor-alias]")) {
    allocator.reserve(alias.id);
  }

  const out: ScannedHeading[] = [];
  for (const node of nodes) {
    if (options.excludeAncestor && node.closest(options.excludeAncestor)) continue;
    const text = (node.textContent ?? "").trim();
    if (!text) continue;
    if (skipText && text.toLowerCase() === skipText) continue;
    const level = headingLevel(node.tagName);
    if (level === null) continue;

    let id = node.id;
    if (!id) {
      id = allocator.allocate(text);
      while (doc.getElementById(id)) id = allocator.allocate(text);
      node.id = id;
      ensureLegacyAliases(node, text, id);
    }
    out.push({ id, text, level });
  }
  return out;
}

function headingLevel(tagName: string): HeadingLevel | null {
  const n = Number(tagName.slice(1));
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 ? n : null;
}

/**
 * Dokleja niewidoczne kotwice aliasowe dla historycznych identyfikatorów tego
 * nagłówka. Idempotentne - `MutationObserver` re-skanuje treść przy każdym
 * doładowaniu, więc aliasy nie mogą się mnożyć.
 */
function ensureLegacyAliases(node: HTMLElement, text: string, canonicalId: string): void {
  const doc = node.ownerDocument;
  for (const legacyId of legacyAnchorVariants(text)) {
    if (legacyId === canonicalId || doc.getElementById(legacyId)) continue;
    const alias = doc.createElement("span");
    alias.id = legacyId;
    alias.dataset.anchorAlias = canonicalId;
    alias.setAttribute("aria-hidden", "true");
    node.prepend(alias);
  }
}
