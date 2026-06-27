// Migration helper: wrap a localized blocks document (the legacy "blocks" editor
// format) into a BuilderDocument, so existing block content becomes editable and
// renderable inside the Elementor-style builder - one section → one full-width
// column → one `rich-text` widget whose content is the original blocks doc.
//
// This is the pure, deterministic core of the blocks→builder data migration.
// It performs NO data loss: the produced builder doc embeds the blocks doc
// verbatim, and the migration runner keeps the original `blocks_data` column, so
// the change is reversible (flip `editor` back to "blocks").
import { toJson } from "@/lib/builder/types";
import type { BuilderDocument, Json } from "../types";
import { newId } from "../types";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";

const FULL_WIDTH_SPAN = 12;

function blocksOf(doc: BlocksDoc | undefined | null): number {
  return Array.isArray(doc?.blocks) ? doc!.blocks.length : 0;
}

/** True when either language carries at least one block worth migrating. */
export function hasBlocksContent(blocks: LocalizedBlocks | null | undefined): boolean {
  if (!blocks || typeof blocks !== "object") return false;
  return blocksOf(blocks.pl) > 0 || blocksOf(blocks.en) > 0;
}

/**
 * Build a BuilderDocument that hosts a localized blocks document inside a single
 * full-width `rich-text` widget. IDs are freshly generated per call.
 */
export function localizedBlocksToBuilderDoc(blocks: LocalizedBlocks): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: newId(),
        kind: "section",
        children: [
          {
            id: newId(),
            kind: "column",
            span: { desktop: FULL_WIDTH_SPAN },
            children: [
              {
                id: newId(),
                kind: "widget",
                type: "rich-text",
                content: { doc: toJson(blocks) },
              },
            ],
          },
        ],
      },
    ],
  };
}
