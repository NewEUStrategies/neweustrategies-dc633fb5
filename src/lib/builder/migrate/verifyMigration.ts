// Post-migration verification helpers (pure, DOM-free, unit-tested).
//
// The blocks/html→builder migration ran on production, but - per the audit -
// nobody had DB access to confirm the result. These helpers turn "looks fine?"
// into a deterministic audit that scripts/verify-migration.ts runs read-only
// against the live tables, and that unit tests pin down.
//
// They inspect the BAKED output of the HTML→`text`-widget path
// (lib/builder/migrate/htmlToBuilder): footnote references (`data-fn="N"`) and
// the rendered footnotes list (`<li id="fn-N">`) must stay in 1:1 correspondence,
// no `[fn]` shortcode may survive un-processed, and we surface inline `style=`
// attributes (which the text widget's sanitizer strips at render → silent
// formatting loss) so a human can review them.
import type { BuilderDocument, ColumnNode, SectionChild, WidgetNode } from "../types";

export type Lang = "pl" | "en";

export interface HtmlAudit {
  lang: Lang;
  /** Footnote reference ids found in the body (`data-fn="N"`). */
  refIds: number[];
  /** Footnote list-item ids found at the bottom (`<li id="fn-N">`). */
  listIds: number[];
  /** Refs that point at a missing list entry (dangling anchors). */
  refsWithoutList: number[];
  /** List entries nothing references (orphan notes). */
  listWithoutRefs: number[];
  /** Count of un-processed `[fn]` shortcodes still present. */
  leftoverFnMarkers: number;
  /** Count of inline `style=` attributes (stripped by the widget sanitizer). */
  inlineStyleAttrs: number;
  /** True when the stored HTML is blank. */
  empty: boolean;
}

const DATA_FN_RE = /data-fn="(\d+)"/g;
const LIST_ID_RE = /<li[^>]*\bid="fn-(\d+)"/g;
const FN_MARKER_RE = /\[fn\]/g;
const INLINE_STYLE_RE = /\sstyle\s*=\s*["']/gi;

function uniqueInts(html: string, re: RegExp): number[] {
  const seen = new Set<number>();
  for (const m of html.matchAll(re)) {
    const n = Number(m[1]);
    if (Number.isInteger(n)) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Audit a single baked HTML string for one language. */
export function auditHtml(html: string, lang: Lang): HtmlAudit {
  const refIds = uniqueInts(html, DATA_FN_RE);
  const listIds = uniqueInts(html, LIST_ID_RE);
  const listSet = new Set(listIds);
  const refSet = new Set(refIds);
  return {
    lang,
    refIds,
    listIds,
    refsWithoutList: refIds.filter((id) => !listSet.has(id)),
    listWithoutRefs: listIds.filter((id) => !refSet.has(id)),
    leftoverFnMarkers: (html.match(FN_MARKER_RE) ?? []).length,
    inlineStyleAttrs: (html.match(INLINE_STYLE_RE) ?? []).length,
    empty: html.trim().length === 0,
  };
}

/** Collect every `text` widget's per-language HTML body from a builder doc. */
export function collectTextHtml(doc: BuilderDocument): Array<{ lang: Lang; html: string }> {
  const out: Array<{ lang: Lang; html: string }> = [];
  const visitWidget = (w: WidgetNode): void => {
    if (w.type !== "text") return;
    const c = w.content ?? {};
    for (const lang of ["pl", "en"] as const) {
      const v = c[`html_${lang}`];
      if (typeof v === "string" && v.length > 0) out.push({ lang, html: v });
    }
  };
  const visitColumn = (col: ColumnNode): void => col.children.forEach(visitWidget);
  const visitChild = (ch: SectionChild): void =>
    ch.kind === "column" ? visitColumn(ch) : ch.columns.forEach(visitColumn);
  for (const s of doc.sections ?? []) s.children.forEach(visitChild);
  return out;
}

export interface DocAudit {
  /** Number of per-language HTML bodies audited across all `text` widgets. */
  htmlBodies: number;
  audits: HtmlAudit[];
  /** Human-readable problems worth a reviewer's eyes. */
  warnings: string[];
}

/** Audit every `text` widget in a migrated builder document. */
export function auditBuilderDoc(doc: BuilderDocument): DocAudit {
  const bodies = collectTextHtml(doc);
  const audits = bodies.map(({ html, lang }) => auditHtml(html, lang));
  const warnings: string[] = [];
  for (const a of audits) {
    if (a.leftoverFnMarkers > 0) {
      warnings.push(`[${a.lang}] ${a.leftoverFnMarkers} un-processed [fn] shortcode(s) survived migration`);
    }
    if (a.refsWithoutList.length > 0) {
      warnings.push(`[${a.lang}] footnote ref(s) with no list entry: ${a.refsWithoutList.join(", ")}`);
    }
    if (a.listWithoutRefs.length > 0) {
      warnings.push(`[${a.lang}] orphan footnote note(s) nothing references: ${a.listWithoutRefs.join(", ")}`);
    }
    if (a.inlineStyleAttrs > 0) {
      warnings.push(`[${a.lang}] ${a.inlineStyleAttrs} inline style="" attribute(s) will be stripped at render (review formatting)`);
    }
  }
  return { htmlBodies: bodies.length, audits, warnings };
}
