// Spłaszczone drzewo bloków dla List View (drzewo wszystkich bloków jak w
// WordPress Gutenberg). Zagnieżdżenia: group/row/stack/grid trzymają dzieci
// w `children`, columns w `left`/`right`. Czyste funkcje - testowalne bez DOM.

import type { Block } from "./types";
import { readChildBlocks } from "./nested";
import { blocksToPlainText } from "./clipboard";

export interface BlockTreeRow {
  id: string;
  type: Block["type"];
  /** 0 = blok top-level; dzieci wcinane o poziom. */
  depth: number;
  /** Id przodka top-level - selekcja/DnD operują na top-level. */
  rootId: string;
  /** Krótki podgląd treści (pusty, gdy blok nie niesie tekstu). */
  snippet: string;
}

const CHILD_KEYS = ["children", "left", "right"] as const;
const MAX_SNIPPET = 48;

/** Krótki podgląd treści bloku do etykiety wiersza List View. */
export function blockSnippet(block: Block): string {
  const text = blocksToPlainText([block]).split("\n")[0]?.trim() ?? "";
  if (text.length <= MAX_SNIPPET) return text;
  return `${text.slice(0, MAX_SNIPPET - 1).trimEnd()}…`;
}

/** Spłaszcza dokument do wierszy w kolejności dokumentu (rodzic przed dziećmi). */
export function flattenBlockTree(blocks: readonly Block[]): BlockTreeRow[] {
  const rows: BlockTreeRow[] = [];
  const visit = (block: Block, depth: number, rootId: string): void => {
    rows.push({ id: block.id, type: block.type, depth, rootId, snippet: blockSnippet(block) });
    for (const key of CHILD_KEYS) {
      for (const child of readChildBlocks(block.data, key)) {
        visit(child, depth + 1, rootId);
      }
    }
  };
  for (const block of blocks) visit(block, 0, block.id);
  return rows;
}
