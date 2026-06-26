// Migration helper: wrap legacy HTML/markdown article content (the "richtext" /
// "markdown" editors, stored in content_pl/content_en) into a BuilderDocument so
// it renders inside the builder as a `text` widget.
//
// To avoid a rendering regression, this runs the SAME pipeline the public HTML
// render path uses - footnote shortcodes ([fn]…[/fn] → numbered references) and
// the manual <!--TOC--> marker - and bakes the rendered footnotes section into
// the HTML, so the builder text widget shows identical output without needing
// any render-time footnote/TOC processing.
//
// No data loss: the migration runner keeps the original content_* columns, so
// the change is reversible (flip `editor` back).
import type { BuilderDocument, Json } from "../types";
import { newId } from "../types";
import { processHtmlFootnotes, type Footnote } from "@/lib/footnotes";
import { processManualToc } from "@/lib/manualToc";

const FULL_WIDTH_SPAN = 12;

const FN_TITLE: Record<"pl" | "en", string> = {
  pl: "Przypisy źródłowe:",
  en: "Source notes:",
};
const FN_BACK_TITLE: Record<"pl" | "en", string> = {
  pl: "Wróć do odsyłacza",
  en: "Back to reference",
};

/**
 * Static HTML for the footnotes section, mirroring the <FootnotesList> component
 * (ids `fn-N`, backlinks to `#fnref-N`). Returns "" when there are no notes.
 * Note HTML is embedded verbatim and re-sanitized by the text widget at render.
 */
export function footnotesSectionHtml(notes: Footnote[], lang: "pl" | "en"): string {
  if (notes.length === 0) return "";
  const items = notes
    .map(
      (n) =>
        `<li id="fn-${n.id}" class="leading-relaxed">` +
        `<span data-fn-marker class="text-foreground/80 font-medium mr-1">[${n.id}]</span> ` +
        `<span>${n.html}</span> ` +
        `<a href="#fnref-${n.id}" data-footnote-backlink class="text-brand hover:underline ml-1" ` +
        `aria-label="${FN_BACK_TITLE[lang]} ${n.id}" title="${FN_BACK_TITLE[lang]}">↩</a></li>`,
    )
    .join("");
  return (
    `<section class="mt-12 pt-6 border-t border-border" aria-labelledby="footnotes-heading" lang="${lang}">` +
    `<h2 id="footnotes-heading" data-footnotes-title class="font-display text-xl mb-4">${FN_TITLE[lang]}</h2>` +
    `<ol data-footnotes-list class="space-y-2 text-sm text-muted-foreground">${items}</ol>` +
    `</section>`
  );
}

/**
 * Process raw article HTML exactly like the public HTML render path (footnotes →
 * numbered refs, manual TOC expansion + heading ids), then append the footnotes
 * section, so the result renders identically inside a builder text widget.
 */
export function processArticleHtml(rawHtml: string, lang: "pl" | "en"): string {
  const { html, notes } = processHtmlFootnotes(rawHtml ?? "", 1);
  const { html: withToc } = processManualToc(html, lang);
  return withToc + footnotesSectionHtml(notes, lang);
}

export function hasHtmlContent(
  contentPl: string | null | undefined,
  contentEn: string | null | undefined,
): boolean {
  return Boolean((contentPl && contentPl.trim()) || (contentEn && contentEn.trim()));
}

/**
 * Build a BuilderDocument hosting legacy HTML content in a single full-width
 * `text` widget, with footnotes/TOC pre-processed per language.
 */
export function htmlToBuilderDoc(
  contentPl: string | null | undefined,
  contentEn: string | null | undefined,
): BuilderDocument {
  const content: Record<string, Json> = {};
  if (contentPl && contentPl.trim()) content.html_pl = processArticleHtml(contentPl, "pl");
  if (contentEn && contentEn.trim()) content.html_en = processArticleHtml(contentEn, "en");
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
            children: [{ id: newId(), kind: "widget", type: "text", content }],
          },
        ],
      },
    ],
  };
}
