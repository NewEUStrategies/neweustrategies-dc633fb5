// Kotwice nagłówków dokumentu blokowego - JEDNA derywacja dla renderera i dla
// spisu treści.
//
// Dlaczego to nie może być liczone dwa razy niezależnie: `renderHeading`
// emitowało `id`, a `extractHeadingsFromBlocks` liczyło `href="#…"` osobno.
// Dopóki obie strony używały tej samej (błędnej) funkcji, rozjazd był
// niewidoczny; po dodaniu DEDUPLIKACJI dwie niezależne pętle mogłyby przydzielić
// różne sufiksy temu samemu nagłówkowi. Ten moduł liczy mapę
// `block.id -> kotwica` raz, deterministycznie, w kolejności dokumentu - obie
// strony ją tylko odczytują.
//
// Dodatkowo zwraca ALIASY WSTECZNE: identyfikatory, jakie ten nagłówek dostawał
// przed unifikacją slugifikatora (bez transliteracji `ł`). Renderer emituje je
// jako puste kotwice, więc już opublikowane linki `#…-ma-ych-…` nadal działają.

import { createAnchorAllocator, legacyAnchorVariants } from "@/lib/content/anchorSlug";
import { inlineHtmlToText, looksLikeInlineHtml } from "@/lib/blocks/inlineHtml";
import type { Block } from "@/lib/blocks/types";


export interface BlockAnchor {
  /** Kanoniczna, zdeduplikowana kotwica nagłówka. */
  readonly id: string;
  /**
   * Historyczne identyfikatory tego samego nagłówka (puste, gdy kanoniczny jest
   * identyczny z historycznym - czyli w zdecydowanej większości przypadków).
   */
  readonly legacyIds: readonly string[];
}

export type BlockAnchorMap = ReadonlyMap<string, BlockAnchor>;

const EMPTY_MAP: BlockAnchorMap = new Map();

/**
 * Cache per referencja tablicy bloków. `BlocksRenderer` przekazuje stabilne
 * `safe.blocks`, więc mapa liczy się raz na dokument, a nie raz na nagłówek.
 */
const cache = new WeakMap<readonly Block[], BlockAnchorMap>();

/**
 * Tekst nagłówka bloku (pusty string, gdy blok nie jest nagłówkiem).
 * Nagłówek edytowany w CMS builderze może zawierać inline HTML (bold / kolor),
 * więc znaczniki są odcinane - kotwica ma zależeć wyłącznie od treści.
 */
function headingText(block: Block): string {
  if (block.type !== "heading") return "";
  const raw = block.data.text;
  if (typeof raw !== "string") return "";
  return looksLikeInlineHtml(raw) ? inlineHtmlToText(raw) : raw.trim();
}


/** Jawna kotwica podana przez autora w edytorze (może być pusta). */
function explicitAnchor(block: Block): string {
  const raw = block.data.anchor;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Mapa `block.id -> kotwica` dla wszystkich nagłówków dokumentu, w kolejności
 * dokumentu. Deterministyczna: to samo wejście daje ten sam wynik na serwerze i
 * w przeglądarce, więc SSR i hydratacja nie mogą się rozjechać.
 */
export function resolveBlockAnchors(blocks: readonly Block[] | null | undefined): BlockAnchorMap {
  if (!blocks || blocks.length === 0) return EMPTY_MAP;
  const cached = cache.get(blocks);
  if (cached) return cached;

  const allocator = createAnchorAllocator();
  const out = new Map<string, BlockAnchor>();
  for (const block of blocks) {
    const text = headingText(block);
    if (!text) continue;
    const explicit = explicitAnchor(block);
    const id = allocator.allocate(text, explicit);
    // Autor podał kotwicę jawnie -> jest ona kontraktem i nie ma "historycznego"
    // wariantu do aliasowania. Aliasy dotyczą tylko kotwic wyliczonych z treści.
    const legacyIds = explicit ? [] : legacyAnchorVariants(text).filter((v) => !allocator.has(v));
    for (const legacyId of legacyIds) allocator.reserve(legacyId);
    out.set(block.id, { id, legacyIds });
  }

  cache.set(blocks, out);
  return out;
}

/**
 * Kotwica pojedynczego bloku nagłówka. Gdy blok jest zagnieżdżony (kolumna /
 * grupa / siatka), nie ma go w płaskiej liście dokumentu - wtedy zwracamy
 * kotwicę liczoną lokalnie, bez deduplikacji dokumentowej. To dokładnie
 * dotychczasowe zachowanie dla zagnieżdżonych nagłówków (spis treści ich też nie
 * obejmuje), więc nie wprowadzamy tu regresji.
 */
export function blockAnchor(block: Block, all: readonly Block[] | null | undefined): BlockAnchor {
  const fromDoc = resolveBlockAnchors(all).get(block.id);
  if (fromDoc) return fromDoc;

  const text = headingText(block);
  if (!text) return { id: "", legacyIds: [] };
  const explicit = explicitAnchor(block);
  const allocator = createAnchorAllocator();
  const id = allocator.allocate(text, explicit);
  return { id, legacyIds: explicit ? [] : legacyAnchorVariants(text) };
}
