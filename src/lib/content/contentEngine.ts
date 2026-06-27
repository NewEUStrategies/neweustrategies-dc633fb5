// Single source of truth for *which* render strategy owns a piece of content.
//
// The public site historically chose between three renderers with inline checks
// duplicated across routes (the post/page resolver, the homepage, …). Centralizing
// the decision here removes that duplication: the Elementor-style **builder** is
// the canonical page-composition engine; the **blocks** engine renders rich
// article bodies (and is also embeddable inside the builder via the `rich-text`
// widget); legacy/empty content falls back to sanitized **html**. These remain
// three distinct strategies behind one façade (ContentRenderer) - the
// "convergence" is the single dispatch point + shared cross-cutting infra
// (sanitization, footnotes, render-error isolation), not one literal engine.
import type { BuilderDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";

export type ContentEngine = "builder" | "html";

export interface ContentEngineInput {
  /** The content's stored editor kind: "builder" | "richtext" | "markdown" | … */
  editor?: string | null;
  builderDoc?: BuilderDocument | null;
  /** Retained for input shape stability; no longer participates in dispatch. */
  blocksDoc?: BlocksDoc | null;
}

/**
 * Legacy editor kinds that no longer have a dedicated public render strategy.
 * Any stored value listed here is normalized to the safe sanitized-HTML path,
 * so a stale `editor='blocks'` row (DB enum still permits it) renders cleanly
 * instead of falling through to an unknown branch.
 */
const LEGACY_HTML_EDITORS = new Set<string>(["blocks", "richtext", "markdown"]);

/**
 * Decide the rendering engine for a piece of content:
 *  - an explicit `builder` editor with at least one section → "builder"
 *  - legacy `blocks` (compat), `richtext`, `markdown`, unknown, empty → "html"
 */
export function resolveContentEngine(input: ContentEngineInput): ContentEngine {
  const { editor, builderDoc } = input;
  if (editor === "builder" && (builderDoc?.sections?.length ?? 0) > 0) return "builder";
  if (typeof editor === "string" && LEGACY_HTML_EDITORS.has(editor)) return "html";
  return "html";
}
