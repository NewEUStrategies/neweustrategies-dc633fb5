// Elementor -> nasze widgety.
//
// Cel: ograniczyć fallback htmlToBlocks. HTML z Elementora jest dość regularny -
// każdy widget siedzi w <div class="elementor-widget elementor-widget-{TYPE}">.
// Mapujemy top-level sections -> nasz `section`, kolumny -> `column`, a widgety
// (heading / text-editor / button / image / icon-box / icon-list / divider /
// spacer / video / embed / gallery / html) na natywne odpowiedniki. Nieznane
// typy trafiają jako `rich-text` z surowym HTML-em i wpisem w warnings.
//
// Pure, deterministic, no DOM. Testowalny.

import type { BuilderDocument, SectionNode, ColumnNode, WidgetNode, WidgetType } from "@/lib/builder/types";
import { newId, toJson } from "@/lib/builder/types";
import type { BlocksDoc } from "./types";
import { htmlToBlocks } from "./migrate";

/* ============================ HTML utilities ============================= */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function stripTags(s: string): string {
  return String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function readAttr(openTag: string, name: string): string {
  const m = openTag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : "";
}
function classesOf(openTag: string): string[] {
  return readAttr(openTag, "class").split(/\s+/).filter(Boolean);
}
function hasClass(openTag: string, token: string): boolean {
  return classesOf(openTag).includes(token);
}
function hasAnyClassStart(openTag: string, prefix: string): string | null {
  return classesOf(openTag).find((c) => c.startsWith(prefix)) ?? null;
}

/**
 * Walks the html and returns balanced element ranges for a given tag whose
 * open tag matches `matchOpen(openTag)`. Skips nested matches - only yields
 * the outermost occurrences.
 */
interface Range {
  outer: string;
  open: string;
  inner: string;
}
function extractOutermost(html: string, tag: "div" | "section", matchOpen: (open: string) => boolean): Range[] {
  const result: Range[] = [];
  const both = new RegExp(`<(\\/?)${tag}\\b([^>]*)>`, "gi");
  let depth = 0;
  let started = -1;
  let openTag = "";
  let m: RegExpExecArray | null;
  while ((m = both.exec(html)) !== null) {
    const isClose = m[1] === "/";
    const openWhole = m[0];
    if (!isClose) {
      const attrs = m[2];
      const asOpen = `<${tag}${attrs}>`;
      if (depth === 0 && matchOpen(asOpen)) {
        started = m.index;
        openTag = asOpen;
        depth = 1;
      } else if (depth > 0) {
        depth++;
      }
    } else {
      if (depth > 0) {
        depth--;
        if (depth === 0 && started >= 0) {
          const endIdx = m.index + openWhole.length;
          const outer = html.slice(started, endIdx);
          const innerStart = started + openTag.length;
          const inner = html.slice(innerStart, m.index);
          result.push({ outer, open: openTag, inner });
          started = -1;
          openTag = "";
        }
      }
    }
  }
  return result;
}

/* ============================ Detection ================================= */

export function isElementorHtml(html: string): boolean {
  if (!html) return false;
  return (
    /class="[^"]*\belementor(?:-section|-column|-container|-widget|-inner-section)?\b[^"]*"/i.test(html) ||
    /\bdata-elementor-type=/i.test(html)
  );
}

/* ============================ Widget parsing ============================ */

interface WidgetParse {
  node: WidgetNode;
  mapped: boolean; // true => proper widget, false => rich-text fallback
  warning?: string;
}

/** Detect Elementor widget flavour from open-tag classes. */
function widgetKind(openTag: string): string | null {
  const c = classesOf(openTag);
  if (!c.includes("elementor-widget")) return null;
  const flavour = c.find((x) => x.startsWith("elementor-widget-") && x !== "elementor-widget-container");
  return flavour ? flavour.replace(/^elementor-widget-/, "") : null;
}

function firstMatch(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? m[1] : "";
}

function parseHeadingWidget(inner: string): WidgetNode {
  const tagM = inner.match(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i);
  const level = tagM ? Number(tagM[1].slice(1)) : 2;
  const text = tagM ? stripTags(tagM[2]) : stripTags(inner);
  const linkHref = firstMatch(inner, /<a\b[^>]*href="([^"]*)"/i);
  return {
    id: newId(),
    kind: "widget",
    type: "heading",
    content: {
      text_pl: text,
      text_en: text,
      level,
      ...(linkHref ? { href: linkHref } : {}),
    },
  };
}

function parseButtonWidget(inner: string): WidgetNode {
  const aM = inner.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
  const openA = aM ? `<a${aM[1]}>` : "";
  const href = openA ? readAttr(openA, "href") || "#" : "#";
  const label = aM ? stripTags(aM[2]) : stripTags(inner);
  const variantClass = openA
    ? (classesOf(openA).find((c) => c.startsWith("elementor-button-")) ?? "")
    : "";
  const variant = variantClass.replace(/^elementor-button-/, "") || "primary";
  const target = openA ? readAttr(openA, "target") : "";
  return {
    id: newId(),
    kind: "widget",
    type: "button",
    content: {
      label_pl: label,
      label_en: label,
      href,
      variant,
      ...(target === "_blank" ? { target: "_blank" as const } : {}),
    },
  };
}

function parseImageWidget(inner: string): WidgetNode {
  const imgOpen = inner.match(/<img\b[^>]*>/i)?.[0] ?? "";
  const src = readAttr(imgOpen, "src");
  const alt = readAttr(imgOpen, "alt");
  const linkHref = firstMatch(inner, /<a\b[^>]*href="([^"]*)"/i);
  const caption = firstMatch(inner, /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
  return {
    id: newId(),
    kind: "widget",
    type: "image",
    content: {
      src,
      alt_pl: alt,
      alt_en: alt,
      ...(linkHref ? { href: linkHref } : {}),
      ...(caption ? { caption_pl: stripTags(caption), caption_en: stripTags(caption) } : {}),
    },
  };
}

function parseIconBoxAsCard(inner: string): WidgetNode {
  const title = firstMatch(inner, /<(?:h[1-6]|div)\b[^>]*class="[^"]*elementor-icon-box-title[^"]*"[^>]*>([\s\S]*?)<\/(?:h[1-6]|div)>/i);
  const text = firstMatch(inner, /<(?:p|div)\b[^>]*class="[^"]*elementor-icon-box-description[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i);
  const href = firstMatch(inner, /<a\b[^>]*href="([^"]*)"/i);
  const iconSvg = firstMatch(inner, /<(?:svg|i)\b[^>]*class="([^"]*)"/i);
  return {
    id: newId(),
    kind: "widget",
    type: "text",
    content: {
      html_pl: `<h3>${esc(stripTags(title))}</h3><p>${esc(stripTags(text))}</p>${href ? `<a href="${esc(href)}">${esc(stripTags(title))}</a>` : ""}`,
      html_en: "",
      _iconHint: iconSvg,
    },
  };
}

function parseDividerWidget(): WidgetNode {
  return { id: newId(), kind: "widget", type: "divider", content: {} };
}

function parseSpacerWidget(inner: string): WidgetNode {
  const styleAttr = firstMatch(inner, /<[^>]*style="([^"]*height:[^"]*)"/i);
  const heightM = styleAttr.match(/height:\s*([0-9]+)px/i);
  const height = heightM ? Number(heightM[1]) : 48;
  return {
    id: newId(),
    kind: "widget",
    type: "spacer",
    content: { height },
  };
}

function parseVideoOrEmbedWidget(inner: string): WidgetNode {
  const iframeSrc =
    firstMatch(inner, /<iframe\b[^>]*src="([^"]*)"/i) ||
    firstMatch(inner, /data-src="([^"]*)"/i);
  return {
    id: newId(),
    kind: "widget",
    type: "video",
    content: { src: iframeSrc, kind: iframeSrc.includes("youtube") ? "youtube" : "iframe" },
  };
}

function parseTextEditorWidget(inner: string): WidgetNode {
  // Trim off the elementor-widget-container wrapper if present.
  const stripped = inner.replace(/^\s*<div class="elementor-widget-container"[^>]*>([\s\S]*)<\/div>\s*$/i, "$1").trim();
  return {
    id: newId(),
    kind: "widget",
    type: "rich-text",
    content: {
      doc: toJson({
        pl: htmlBlocksDoc(stripped),
        en: { version: 1, blocks: [] } as BlocksDoc,
      }),
    },
  };
}

function htmlBlocksDoc(html: string): BlocksDoc {
  const trimmed = html.trim();
  if (!trimmed) return { version: 1, blocks: [] };
  return htmlToBlocks(trimmed);
}

function fallbackWidget(inner: string, warning: string): WidgetParse {
  return {
    mapped: false,
    warning,
    node: {
      id: newId(),
      kind: "widget",
      type: "rich-text",
      content: {
        doc: toJson({
          pl: htmlBlocksDoc(inner),
          en: { version: 1, blocks: [] } as BlocksDoc,
        }),
      },
    },
  };
}

/** Parse a single elementor-widget block into a WidgetNode. */
function parseWidget(open: string, inner: string): WidgetParse {
  const kind = widgetKind(open);
  if (!kind) return fallbackWidget(inner, "Nierozpoznany kontener widgetu");
  switch (kind) {
    case "heading":
      return { mapped: true, node: parseHeadingWidget(inner) };
    case "text-editor":
    case "text-path":
    case "theme-post-content":
      return { mapped: true, node: parseTextEditorWidget(inner) };
    case "button":
      return { mapped: true, node: parseButtonWidget(inner) };
    case "image":
    case "theme-post-featured-image":
      return { mapped: true, node: parseImageWidget(inner) };
    case "image-box":
    case "icon-box":
      return { mapped: true, node: parseIconBoxAsCard(inner) };
    case "icon-list":
    case "icon-list-menu": {
      const items = Array.from(inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)).map((m) => stripTags(m[1]));
      const html = `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      return {
        mapped: true,
        node: {
          id: newId(),
          kind: "widget",
          type: "rich-text",
          content: {
            doc: toJson({ pl: htmlBlocksDoc(html), en: { version: 1, blocks: [] } as BlocksDoc }),
          },
        },
      };
    }
    case "divider":
      return { mapped: true, node: parseDividerWidget() };
    case "spacer":
      return { mapped: true, node: parseSpacerWidget(inner) };
    case "video":
    case "html":
      return { mapped: true, node: parseVideoOrEmbedWidget(inner) };
    default:
      return fallbackWidget(inner, `Nieznany widget Elementor: ${kind}`);
  }
}

/* ============================ Columns & Sections ======================== */

interface Coverage {
  elementorMapped: number;
  fallback: number;
  total: number;
}

function pickSpan(open: string): number {
  const c = classesOf(open);
  const w = c.find((x) => x.startsWith("elementor-col-"));
  if (w) {
    const n = Number(w.replace("elementor-col-", ""));
    if (n === 100) return 12;
    if (n === 66) return 8;
    if (n === 50) return 6;
    if (n === 33) return 4;
    if (n === 25) return 3;
    if (n === 20) return 3;
    if (n === 16) return 2;
  }
  return 12;
}

function parseWidgetsInHtml(html: string, cov: Coverage, warnings: string[]): WidgetNode[] {
  const widgets = extractOutermost(html, "div", (open) => hasClass(open, "elementor-widget"));
  const nodes: WidgetNode[] = [];
  for (const w of widgets) {
    cov.total++;
    const parsed = parseWidget(w.open, w.inner);
    if (parsed.mapped) cov.elementorMapped++;
    else {
      cov.fallback++;
      if (parsed.warning) warnings.push(parsed.warning);
    }
    nodes.push(parsed.node);
  }
  return nodes;
}

function parseColumn(open: string, inner: string, cov: Coverage, warnings: string[]): ColumnNode {
  const span = pickSpan(open);
  const widgets = parseWidgetsInHtml(inner, cov, warnings);
  return {
    id: newId(),
    kind: "column",
    span: { desktop: span },
    children: widgets,
  };
}

function parseSection(inner: string, cov: Coverage, warnings: string[]): SectionNode {
  const cols = extractOutermost(inner, "div", (open) => hasClass(open, "elementor-column") || hasClass(open, "elementor-column-wrap"));
  let children: ColumnNode[];
  if (cols.length > 0) {
    children = cols.map((c) => parseColumn(c.open, c.inner, cov, warnings));
  } else {
    // No columns - treat the whole section as a single 12-col column.
    const widgets = parseWidgetsInHtml(inner, cov, warnings);
    children = [
      {
        id: newId(),
        kind: "column",
        span: { desktop: 12 },
        children: widgets,
      },
    ];
  }
  return {
    id: newId(),
    kind: "section",
    children,
  };
}

/* ============================== Main entry ============================== */

export interface ElementorConversion {
  doc: BuilderDocument;
  coverage: Coverage;
  warnings: string[];
}

export function elementorToBuilder(html: string): ElementorConversion | null {
  if (!isElementorHtml(html)) return null;
  const cov: Coverage = { elementorMapped: 0, fallback: 0, total: 0 };
  const warnings: string[] = [];

  const sections = extractOutermost(html, "section", (open) =>
    hasClass(open, "elementor-section") || hasClass(open, "elementor-top-section"),
  );
  const divSections = extractOutermost(html, "div", (open) =>
    hasAnyClassStart(open, "elementor-top-section") !== null ||
    (hasClass(open, "elementor-section") && !hasClass(open, "elementor-inner-section")) ||
    hasClass(open, "e-con") || hasClass(open, "e-parent"),
  );
  const all: Range[] = [...sections, ...divSections];

  let secNodes: SectionNode[];
  if (all.length > 0) {
    secNodes = all.map((s) => parseSection(s.inner, cov, warnings));
  } else {
    // No sections detected but Elementor markers exist - walk widgets flat.
    const widgets = parseWidgetsInHtml(html, cov, warnings);
    if (widgets.length === 0) return null;
    secNodes = [
      {
        id: newId(),
        kind: "section",
        children: [
          { id: newId(), kind: "column", span: { desktop: 12 }, children: widgets },
        ],
      },
    ];
  }

  // Drop empty sections/columns (Elementor often ships empty spacers-only chrome).
  const cleaned = secNodes
    .map((s) => ({
      ...s,
      children: s.children.filter((c) => c.kind !== "column" || c.children.length > 0),
    }))
    .filter((s) => s.children.length > 0);

  if (cleaned.length === 0) return null;

  return { doc: { version: 1, sections: cleaned }, coverage: cov, warnings };
}

/* Re-export for narrow use by tests. */
export const __internals = { extractOutermost, widgetKind, parseWidget };

// WidgetType touched to keep TS happy about unused imports in prod build.
const _widgetTypeGuard: WidgetType = "rich-text";
void _widgetTypeGuard;
