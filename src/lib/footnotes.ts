// Footnotes processor: turns [fn]...[/fn] shortcodes into numbered superscript
// markers and collects the list of notes for rendering at the end of an article.
import type { BuilderDocument, SectionNode, SectionChild, ColumnNode, WidgetNode } from "./builder/types";

export type Footnote = { id: number; html: string };

// Match [fn]...[/fn] non-greedy. Inner content keeps user HTML (sanitized at render time).
const FN_RE = /\[fn\]([\s\S]*?)\[\/fn\]/g;

export function hasFootnotes(html: string | null | undefined): boolean {
  return !!html && html.includes("[fn]");
}

/**
 * Recover the footnote list from ALREADY-RENDERED markup (the "baked" output of
 * processHtmlFootnotes + footnotesSectionHtml that migrated content stores in a
 * builder `text` widget). Reads the `<ol data-footnotes-list>` items: each
 * `<li id="fn-N">` carries a `[N]` marker span (`data-fn-marker`) and a note
 * body span. Used to re-attach interactive footnote tooltips to baked `data-fn`
 * references at render time, with no [fn] reprocessing.
 *
 * `root` is any DOM ParentNode (a widget container) - kept DOM-based so it works
 * uniformly for the migrated builder path and is unit-testable under jsdom.
 */
export function parseBakedFootnotes(root: ParentNode): Footnote[] {
  const out: Footnote[] = [];
  const items = root.querySelectorAll('[data-footnotes-list] > li[id^="fn-"]');
  items.forEach((li) => {
    const id = Number(li.id.replace(/^fn-/, ""));
    if (!Number.isInteger(id) || id <= 0) return;
    // The note body is the direct-child span that is NOT the "[N]" marker.
    let html = "";
    for (const child of Array.from(li.children)) {
      if (child.tagName === "SPAN" && !child.hasAttribute("data-fn-marker")) {
        html = child.innerHTML;
      }
    }
    if (html.trim()) out.push({ id, html });
  });
  return out;
}

export function processHtmlFootnotes(
  html: string,
  startIndex: number,
): { html: string; notes: Footnote[] } {
  const notes: Footnote[] = [];
  let i = startIndex;
  const out = html.replace(FN_RE, (_m, inner: string) => {
    const id = i++;
    notes.push({ id, html: inner.trim() });
    return `<sup class="fn-ref"><a href="#fn-${id}" id="fnref-${id}" data-fn="${id}" aria-describedby="footnotes-heading">[${id}]</a></sup>`;
  });
  return { html: out, notes };
}

// Walks the builder document, processes text/heading widgets in place (returns a
// new doc - does not mutate the original) and returns the collected footnotes.
export function processDocFootnotes(
  doc: BuilderDocument,
  lang: "pl" | "en",
): { doc: BuilderDocument; notes: Footnote[] } {
  const notes: Footnote[] = [];
  let counter = 1;

  const processString = (v: unknown): unknown => {
    if (typeof v !== "string" || !v.includes("[fn]")) return v;
    const r = processHtmlFootnotes(v, counter);
    counter += r.notes.length;
    notes.push(...r.notes);
    return r.html;
  };

  const processWidget = (w: WidgetNode): WidgetNode => {
    if (w.type !== "text" && w.type !== "heading") return w;
    const keys = [`html_${lang}`, "html_pl", "html_en", `text_${lang}`, "text_pl", "text_en"];
    let changed = false;
    const next = { ...w.content };
    for (const k of keys) {
      if (k in next) {
        const updated = processString(next[k]);
        if (updated !== next[k]) {
          next[k] = updated as never;
          changed = true;
        }
      }
    }
    return changed ? { ...w, content: next } : w;
  };

  const processColumn = (c: ColumnNode): ColumnNode => ({
    ...c,
    children: c.children.map(processWidget),
  });

  const processChild = (ch: SectionChild): SectionChild =>
    ch.kind === "column" ? processColumn(ch) : { ...ch, columns: ch.columns.map(processColumn) };

  const processSection = (s: SectionNode): SectionNode => ({
    ...s,
    children: s.children.map(processChild),
  });

  const nextDoc: BuilderDocument = { ...doc, sections: doc.sections.map(processSection) };
  return { doc: nextDoc, notes };
}
