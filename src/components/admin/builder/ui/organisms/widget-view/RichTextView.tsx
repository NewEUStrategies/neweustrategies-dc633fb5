// Public renderer for the `rich-text` builder widget. It embeds the blocks
// engine (the same renderer used for article bodies) inside a builder layout,
// so the Elementor-style builder can host full rich content - callouts, FAQ,
// pros/cons, TOC, embeds, galleries - and remain the single page-composition
// engine. Authoring happens in the properties panel via the shared block editor.
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import type { Json } from "@/lib/builder/types";
import { BlocksRenderer } from "@/components/blocks/BlocksRenderer";

/**
 * Extract the BlocksDoc for `lang` from a widget's stored `doc` content,
 * tolerating missing/partial localization (falls back pl → en). Returns null
 * when there is nothing renderable; BlocksRenderer itself re-validates the doc.
 */
export function pickLocalizedBlocks(raw: Json | undefined, lang: "pl" | "en"): BlocksDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const loc = raw as Partial<LocalizedBlocks>;
  const doc = loc[lang] ?? loc.pl ?? loc.en ?? null;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  return doc as BlocksDoc;
}

export function RichTextView({
  content,
  lang,
  postId,
}: {
  content: Record<string, Json>;
  lang: "pl" | "en";
  postId?: string;
}) {
  const doc = pickLocalizedBlocks(content.doc, lang);
  if (!doc) return null;
  return <BlocksRenderer doc={doc} lang={lang} postId={postId} />;
}
