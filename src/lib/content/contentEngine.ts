// Single source of truth for *which* rendering engine owns a piece of content.
//
// The public site historically chose between three renderers with inline checks
// duplicated across routes (the post/page resolver, the homepage, …). Centralizing
// the decision here removes that duplication and makes the convergence explicit:
// the Elementor-style **builder** is the canonical page-composition engine; the
// **blocks** engine renders rich article bodies; legacy/empty content falls back
// to sanitized **html**. The ContentRenderer façade renders whatever this returns.
import type { BuilderDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";

export type ContentEngine = "blocks" | "builder" | "html";

export interface ContentEngineInput {
  /** The content's stored editor kind: "builder" | "blocks" | "richtext" | "markdown" | … */
  editor?: string | null;
  builderDoc?: BuilderDocument | null;
  blocksDoc?: BlocksDoc | null;
}

/**
 * Decide the rendering engine for a piece of content:
 *  - an explicit `blocks` editor with at least one block → "blocks"
 *  - an explicit `builder` editor with at least one section → "builder"
 *  - everything else (richtext / markdown / legacy / empty) → "html"
 */
export function resolveContentEngine(input: ContentEngineInput): ContentEngine {
  const { editor, builderDoc, blocksDoc } = input;
  if (editor === "blocks" && (blocksDoc?.blocks?.length ?? 0) > 0) return "blocks";
  if (editor === "builder" && (builderDoc?.sections?.length ?? 0) > 0) return "builder";
  return "html";
}
