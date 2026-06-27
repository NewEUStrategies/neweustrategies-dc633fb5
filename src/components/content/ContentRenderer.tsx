// Unified public content façade. ONE entry point that dispatches a piece of
// content to one of three render strategies (builder / blocks / sanitized html),
// replacing the three-way conditional that used to live inline in every content
// route.
//
// Honest architecture note: this is a single FAÇADE over three strategies, not
// a single rendering engine. The builder is the canonical page-composition
// engine; the blocks renderer still renders rich article bodies (and is embedded
// inside the builder via the `rich-text` widget, so the builder can host it);
// legacy/markdown content falls back to sanitized HTML. What is genuinely shared
// is the cross-cutting infrastructure - sanitization (lib/sanitize), the
// footnote pipeline (lib/footnotes), and per-node render-error isolation
// (RenderErrorBoundary, now wrapping both builder widgets AND blocks). Footnote/
// TOC processing happens upstream in the route; this component is purely the
// strategy switch so the decision lives in exactly one place
// (`resolveContentEngine`).
import type { BuilderDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";

import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/builder/currentPostContext";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { resolveContentEngine } from "@/lib/content/contentEngine";

interface Props {
  /** Stored editor kind of the content ("builder" | "blocks" | "richtext" | …). */
  editor?: string | null;
  /** Parsed (and footnote-processed) builder document. */
  builderDoc: BuilderDocument;
  /** Localized blocks document for the active language, if any. */
  blocksDoc: BlocksDoc | null;
  /** Pre-processed (footnotes/TOC applied) HTML for the legacy/markdown path. */
  html: string;
  lang: "pl" | "en";
  /** Current post id - lets blocks like `liveblog` subscribe per post. */
  postId?: string;
  /** Dynamic-tag widgets (post-title, post-meta, …) read the current post here. */
  currentPostCtx?: CurrentPostCtx;
}

export function ContentRenderer({
  editor,
  builderDoc,
  blocksDoc,
  html,
  lang,
  postId,
  currentPostCtx,
}: Props) {
  const engine = resolveContentEngine({ editor, builderDoc, blocksDoc });

  if (engine === "blocks") {
    return <BlocksRenderer doc={blocksDoc} lang={lang} postId={postId} />;
  }

  if (engine === "builder") {
    const tree = <BuilderRenderer doc={builderDoc} lang={lang} />;
    return currentPostCtx ? <CurrentPostProvider value={currentPostCtx}>{tree}</CurrentPostProvider> : tree;
  }

  return (
    <article
      className="single-post-content prose prose-lg dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(html) }}
    />
  );
}
