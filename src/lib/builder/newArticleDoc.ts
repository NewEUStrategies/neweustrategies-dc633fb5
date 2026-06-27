// Seed document for a NEW post (blocks → builder consolidation, stage 1).
//
// New posts default to the builder. So that authors land straight in the
// article-writing experience (not an empty Elementor canvas), the seed doc is a
// single section/column holding one `rich-text` widget — that widget opens the
// same Gutenberg-style block editor used for article bodies, now nested inside a
// builder layout. Existing posts are unaffected.
//
// This delegates to the SAME wrapper the blocks→builder migration uses
// (localizedBlocksToBuilderDoc), so a freshly-created post and a migrated post
// have byte-identical structure and can never drift apart.
import type { BuilderDocument } from "./types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { localizedBlocksToBuilderDoc } from "./migrate/blocksToBuilder";

export function emptyArticleBuilderDoc(): BuilderDocument {
  return localizedBlocksToBuilderDoc({ pl: EMPTY_BLOCKS_DOC, en: EMPTY_BLOCKS_DOC });
}
