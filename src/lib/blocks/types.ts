// Block editor (Gutenberg/Foxiz-style) — typy podstawowe.
// Każdy wpis może być serializowany jako BlocksDoc i renderowany publicznie.

export type BlockType =
  | "paragraph"
  | "heading"
  | "image"
  | "list"
  | "quote"
  | "code"
  | "embed"
  | "video"
  | "gallery"
  | "separator"
  | "callout"
  | "table"
  | "button"
  | "columns"
  | "html"
  | "liveblog";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

export interface BlockStyle {
  align?: "left" | "center" | "right" | "wide" | "full";
  marginTop?: number;   // px
  marginBottom?: number;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Dane lokalne dla każdego typu — kształt definiuje rejestr. */
  data: Record<string, Json>;
  style?: BlockStyle;
}

export interface BlocksDoc {
  version: 1;
  blocks: Block[];
  /** Opcjonalne metadane (np. ostrzeżenia z migracji). */
  meta?: Record<string, Json>;
}

export const EMPTY_BLOCKS_DOC: BlocksDoc = { version: 1, blocks: [] };

export function newBlockId(): string {
  // krótki, czytelny id (bez zależności od uuid)
  return "b_" + Math.random().toString(36).slice(2, 10);
}

/** Per-language content split — taka sama strategia jak w content_pl/en. */
export interface LocalizedBlocks {
  pl: BlocksDoc;
  en: BlocksDoc;
}
