// Skanowanie nagłówków wyrenderowanej treści na potrzeby pływającego spisu
// treści (`FloatingShareBar`). Wydzielone z komponentu, bo to CZYSTA logika nad
// DOM-em: da się ją przetestować jednostkowo bez montowania całego railu, a
// kotwice liczy tym samym modułem co pozostałe silniki (lib/content/anchorSlug),
// więc `#kotwica` z serwera i z klienta zawsze wskazuje ten sam nagłówek.

import {
  createAnchorAllocator,
  legacyAnchorVariants,
  slugifyAnchor,
} from "@/lib/content/anchorSlug";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5;

export interface ScannedHeading {
  id: string;
  text: string;
  level: HeadingLevel;
}

/** Selektor nagłówków branych do spisu treści (H6 celowo pominięty). */
export const HEADING_SELECTOR = "h1, h2, h3, h4, h5";

/**
 * Kanoniczna kotwica nagłówka. Re-eksport, żeby konsumenci paska (i test
 * parytetu międzysilnikowego) nie musiały znać ścieżki do `lib/content`.
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

/**
 * Zbiera nagłówki z korzenia treści i - gdy nagłówek nie ma `id` - nadaje mu
 * kanoniczną kotwicę.
 *
 * Kontrakt:
 *  - istniejące `id` (z SSR: silnik richtext / bloków) jest ZAWSZE zachowywane,
 *    więc już opublikowane linki działają bez zmian;
 *  - nowo nadane `id` są kanoniczne i deduplikowane wspólnym alokatorem
 *    (`tytul`, `tytul-2`, `tytul-3` - bez dawnego narastania `tytul-2-2`);
 *  - dla nagłówka, którego kanoniczna kotwica różni się od historycznej,
 *    dokładamy pusty `<span id="…">` jako alias, żeby stare `#kotwica` nadal
 *    trafiały w cel (te same aliasy emituje serwerowy silnik bloków).
 */
export function scanHeadings(root: HTMLElement): ScannedHeading[] {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
  const allocator = createAnchorAllocator();
  // Najpierw rezerwujemy WSZYSTKIE istniejące id, żeby kotwica nadana nagłówkowi
  // bez id nie przechwyciła identyfikatora nagłówka występującego dalej ani
  // kotwicy aliasowej wyemitowanej przez serwerowy silnik bloków.
  for (const node of nodes) allocator.reserve(node.id);
  for (const alias of root.querySelectorAll<HTMLElement>("[data-anchor-alias]")) {
    allocator.reserve(alias.id);
  }

  const out: ScannedHeading[] = [];
  for (const node of nodes) {
    const text = (node.textContent ?? "").trim();
    if (!text) continue;
    const level = headingLevel(node.tagName);
    if (level === null) continue;

    let id = node.id;
    if (!id) {
      id = allocator.allocate(text);
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
