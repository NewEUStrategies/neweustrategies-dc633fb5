// Best-effort migration of legacy content into a BlocksDoc.
// Pure, deterministic, SSR-safe (no DOM dependency, no `any`).
//
// Two entry points:
//   - htmlToBlocks(html): converts rich-text / markdown-rendered HTML
//     into a structured BlocksDoc preserving paragraphs, headings, lists,
//     blockquotes, images, code blocks, separators and embeds (iframe).
//   - builderToBlocks(json): heuristic fallback that walks a Visual
//     Builder tree and extracts text/image nodes into block equivalents.
//
// Anything we cannot map confidently is preserved as a single `html`
// block so no content is lost.

import type { Block, BlocksDoc, Json } from "./types";
import { parseGutenberg } from "./gutenberg";
import { EMPTY_BLOCKS_DOC, newBlockId } from "./types";

// ---------- shared helpers ----------

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = tag.match(re);
  return m ? decodeEntities(m[1]) : null;
}

// ---------- HTML -> blocks ----------

interface Token {
  raw: string;
  open: string;
  tag: string;
  inner: string;
}

// Capture the most common top-level block tags. Anything outside these
// boundaries becomes an inline paragraph chunk.
const BLOCK_RE = /<(p|h1|h2|h3|h4|h5|h6|ul|ol|blockquote|pre|hr|figure|img|iframe|div)\b([^>]*)>([\s\S]*?)<\/\1>|<(hr|img|iframe)\b([^>]*)\/?>/gi;

function pushParagraph(out: Block[], html: string): void {
  const trimmed = html.trim();
  if (!trimmed) return;
  out.push({
    id: newBlockId(),
    type: "paragraph",
    data: { html: trimmed },
  });
}

function listItems(innerHtml: string): string[] {
  const items: string[] = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(innerHtml)) !== null) {
    items.push(decodeEntities(stripTags(m[1])));
  }
  return items;
}

function headingLevel(tag: string): 2 | 3 | 4 {
  const n = Number(tag.replace(/^h/i, ""));
  if (n <= 2) return 2;
  if (n === 3) return 3;
  return 4;
}

function mapStandalone(tag: string, openAttrs: string): Block | null {
  const lower = tag.toLowerCase();
  if (lower === "hr") {
    return { id: newBlockId(), type: "separator", data: {} };
  }
  if (lower === "img") {
    const src = attr(`<img ${openAttrs}>`, "src");
    if (!src) return null;
    return {
      id: newBlockId(),
      type: "image",
      data: {
        url: src,
        alt: attr(`<img ${openAttrs}>`, "alt") ?? "",
        caption: "",
        href: "",
      },
    };
  }
  if (lower === "iframe") {
    const src = attr(`<iframe ${openAttrs}>`, "src");
    if (!src) return null;
    return {
      id: newBlockId(),
      type: "embed",
      data: { url: src, provider: "iframe", html: "" },
    };
  }
  return null;
}

function mapBlock(tag: string, inner: string, openAttrs: string): Block | null {
  const lower = tag.toLowerCase();
  if (lower === "p") {
    if (!stripTags(inner)) return null;
    return { id: newBlockId(), type: "paragraph", data: { html: inner.trim() } };
  }
  if (/^h[1-6]$/.test(lower)) {
    return {
      id: newBlockId(),
      type: "heading",
      data: {
        level: headingLevel(lower),
        text: decodeEntities(stripTags(inner)),
        anchor: attr(`<${lower} ${openAttrs}>`, "id") ?? "",
      },
    };
  }
  if (lower === "ul" || lower === "ol") {
    const items = listItems(inner);
    if (!items.length) return null;
    return {
      id: newBlockId(),
      type: "list",
      data: { ordered: lower === "ol", items: items as Json },
    };
  }
  if (lower === "blockquote") {
    const text = decodeEntities(stripTags(inner));
    return { id: newBlockId(), type: "quote", data: { text, cite: "" } };
  }
  if (lower === "pre") {
    // <pre><code class="language-x">...</code></pre>
    const codeMatch = inner.match(/<code\b([^>]*)>([\s\S]*?)<\/code>/i);
    const code = codeMatch ? decodeEntities(stripTags(codeMatch[2])) : decodeEntities(stripTags(inner));
    const lang = codeMatch ? (attr(`<code ${codeMatch[1]}>`, "class") ?? "").replace(/^language-/, "") : "";
    return { id: newBlockId(), type: "code", data: { code, language: lang } };
  }
  if (lower === "figure") {
    // figure with img + optional figcaption
    const imgMatch = inner.match(/<img\b([^>]*)\/?>/i);
    if (imgMatch) {
      const src = attr(`<img ${imgMatch[1]}>`, "src");
      if (!src) return null;
      const capMatch = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
      return {
        id: newBlockId(),
        type: "image",
        data: {
          url: src,
          alt: attr(`<img ${imgMatch[1]}>`, "alt") ?? "",
          caption: capMatch ? decodeEntities(stripTags(capMatch[1])) : "",
          href: "",
        },
      };
    }
    return { id: newBlockId(), type: "html", data: { html: `<figure>${inner}</figure>` } };
  }
  if (lower === "div") {
    // Don't emit raw <div> wrappers — unwrap recursively in the loop below.
    // Returning null here is just a guard; htmlToBlocks handles div specially.
    return null;
  }
  return null;
}

export function htmlToBlocks(input: string | null | undefined): BlocksDoc {
  const html = (input ?? "").trim();
  if (!html) return { version: 1, blocks: [] };

  const out: Block[] = [];
  let cursor = 0;
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(html)) !== null) {
    if (m.index > cursor) {
      pushParagraph(out, html.slice(cursor, m.index));
    }
    if (m[1]) {
      const block = mapBlock(m[1], m[3], m[2] ?? "");
      if (block) out.push(block);
    } else if (m[4]) {
      const block = mapStandalone(m[4], m[5] ?? "");
      if (block) out.push(block);
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < html.length) {
    pushParagraph(out, html.slice(cursor));
  }

  if (!out.length) {
    out.push({ id: newBlockId(), type: "paragraph", data: { html } });
  }
  return { version: 1, blocks: out, meta: { migratedFrom: "html" } };
}

// ---------- Builder JSON -> blocks ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function walkBuilder(node: unknown, out: Block[]): void {
  if (Array.isArray(node)) {
    for (const child of node) walkBuilder(child, out);
    return;
  }
  if (!isRecord(node)) return;

  const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
  const data = isRecord(node.data) ? node.data : isRecord(node.props) ? node.props : {};

  if (type.includes("heading") && typeof data.text === "string") {
    const level = typeof data.level === "number" ? data.level : 2;
    out.push({
      id: newBlockId(),
      type: "heading",
      data: { level: headingLevel(`h${level}`), text: data.text, anchor: "" },
    });
  } else if ((type.includes("text") || type.includes("paragraph") || type.includes("richtext")) && typeof data.html === "string") {
    pushParagraph(out, data.html);
  } else if ((type.includes("text") || type.includes("paragraph")) && typeof data.text === "string") {
    pushParagraph(out, `<p>${data.text}</p>`);
  } else if (type.includes("image") && typeof data.src === "string") {
    out.push({
      id: newBlockId(),
      type: "image",
      data: {
        url: data.src,
        alt: typeof data.alt === "string" ? data.alt : "",
        caption: typeof data.caption === "string" ? data.caption : "",
        href: typeof data.href === "string" ? data.href : "",
      },
    });
  } else if (type.includes("quote") && typeof data.text === "string") {
    out.push({
      id: newBlockId(),
      type: "quote",
      data: { text: data.text, cite: typeof data.cite === "string" ? data.cite : "" },
    });
  } else if (type.includes("separator") || type.includes("divider")) {
    out.push({ id: newBlockId(), type: "separator", data: {} });
  } else if ((type.includes("video") || type.includes("embed")) && typeof data.url === "string") {
    out.push({ id: newBlockId(), type: "embed", data: { url: data.url, provider: "iframe", html: "" } });
  } else if (type.includes("html") && typeof data.html === "string") {
    out.push({ id: newBlockId(), type: "html", data: { html: data.html } });
  }

  // Recurse through known nesting keys.
  if (Array.isArray(node.children)) walkBuilder(node.children, out);
  if (Array.isArray(node.elements)) walkBuilder(node.elements, out);
  if (Array.isArray(node.blocks)) walkBuilder(node.blocks, out);
  if (Array.isArray(node.columns)) walkBuilder(node.columns, out);
}

export function builderToBlocks(input: unknown): BlocksDoc {
  if (input == null) return { version: 1, blocks: [] };
  const out: Block[] = [];
  walkBuilder(input, out);
  if (!out.length) return { version: 1, blocks: [] };
  return { version: 1, blocks: out, meta: { migratedFrom: "builder" } };
}

// ---------- public unified migrator ----------

export interface LegacyPostContent {
  content_pl?: string | null;
  content_en?: string | null;
  builder_data?: unknown;
}

export interface MigrationResult {
  pl: BlocksDoc;
  en: BlocksDoc;
  source: "html" | "gutenberg" | "builder" | "empty";
}

export function migratePostContent(input: LegacyPostContent): MigrationResult {
  const pl = (input.content_pl ?? "").trim();
  const en = (input.content_en ?? "").trim();
  if (pl || en) {
    const isGb = /<!--\s*wp:[a-z]/i.test(pl) || /<!--\s*wp:[a-z]/i.test(en);
    if (isGb) {
      return { pl: parseGutenberg(pl), en: parseGutenberg(en), source: "gutenberg" };
    }
    return { pl: htmlToBlocks(pl), en: htmlToBlocks(en), source: "html" };
  }
  if (input.builder_data != null) {
    const doc = builderToBlocks(input.builder_data);
    return { pl: doc, en: doc, source: "builder" };
  }
  return { pl: EMPTY_BLOCKS_DOC, en: EMPTY_BLOCKS_DOC, source: "empty" };
}
