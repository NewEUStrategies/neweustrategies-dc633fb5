// Seed document for a NEW post (blocks → builder consolidation, stage 1).
//
// New posts now default to the builder. So that authors land straight in the
// article-writing experience (and not an empty Elementor canvas), the seed doc
// is a single section/column holding one `rich-text` widget — that widget opens
// the same Gutenberg-style block editor used for article bodies, now nested
// inside a builder layout. Existing posts are unaffected.
import { newId, toJson, type BuilderDocument } from "./types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";

export function emptyArticleBuilderDoc(): BuilderDocument {
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
            span: { desktop: 12 },
            children: [
              {
                id: newId(),
                kind: "widget",
                type: "rich-text",
                content: { doc: toJson({ pl: EMPTY_BLOCKS_DOC, en: EMPTY_BLOCKS_DOC }) },
              },
            ],
          },
        ],
      },
    ],
  };
}
