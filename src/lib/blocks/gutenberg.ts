// WordPress Gutenberg + Foxiz compatibility layer.
//
// - parseGutenberg(html): parses Gutenberg serialized HTML (with
//   `<!-- wp:xxx {json} -->` delimiters) into our BlocksDoc.
// - blocksToGutenberg(doc): serializes our BlocksDoc back to
//   Gutenberg-compatible HTML so posts stay portable (export / re-import
//   in WordPress, Foxiz, or any block.json consumer).
// - stripFoxizShortcodes(html): unwraps the most common Foxiz shortcodes
//   ([su_box], [foxiz_*], [ruby_toc], ...) so the regular HTML pipeline
//   can pick them up as paragraphs / lists / embeds.
//
// Pure, deterministic, no DOM. Uses our existing htmlToBlocks() as a
// fallback for inner HTML we do not want to special-case.

import type { Block, BlocksDoc, Json } from "./types";
import { newBlockId } from "./types";
import { htmlToBlocks } from "./migrate";

// ---------- shared ----------

function safeJson(input: string): Record<string, Json> {
  try {
    const parsed: unknown = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, Json>;
    }
  } catch {
    // ignore
  }
  return {};
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ---------- Foxiz / Shortcodes Ultimate ----------

// Helper for attribute extraction inside a single shortcode tag body.
function scAttr(body: string, name: string): string {
  const m = body.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : "";
}

// Foxiz and Shortcodes Ultimate ship dozens of shortcodes; we normalise the
// most common ones to inline HTML so the regular HTML -> blocks pipeline can
// absorb them. Unknown shortcodes are left untouched (lossless).
const SHORTCODE_RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // [su_quote cite="x"]text[/su_quote] -> blockquote
  [/\[su_quote(?:\s+cite="([^"]*)")?\]([\s\S]*?)\[\/su_quote\]/gi,
    (m) => `<blockquote><p>${m[2]}</p>${m[1] ? `<cite>${esc(m[1])}</cite>` : ""}</blockquote>`],
  // [su_note] / [su_box] / [su_spoiler title="x"] -> callout-like wrapper
  [/\[su_(?:note|box)[^\]]*\]([\s\S]*?)\[\/su_(?:note|box)\]/gi,
    (m) => `<div class="callout">${m[1]}</div>`],
  [/\[su_spoiler(?:\s+title="([^"]*)")?[^\]]*\]([\s\S]*?)\[\/su_spoiler\]/gi,
    (m) => `<details class="callout"><summary>${esc(m[1] || "Details")}</summary>${m[2]}</details>`],
  // [su_heading]Title[/su_heading] -> h2
  [/\[su_heading[^\]]*\]([\s\S]*?)\[\/su_heading\]/gi,
    (m) => `<h2>${esc(stripTags(m[1]))}</h2>`],
  // [su_divider] -> hr
  [/\[su_divider[^\]]*\]/gi, () => "<hr>"],
  // [su_button url="x" target="blank"]Label[/su_button]
  [/\[su_button\s+([^\]]*)\]([\s\S]*?)\[\/su_button\]/gi,
    (m) => {
      const href = scAttr(m[1], "url") || scAttr(m[1], "href") || "#";
      return `<p><a class="wp-block-button__link" href="${esc(href)}">${esc(stripTags(m[2]))}</a></p>`;
    }],
  // [su_youtube|vimeo|video|audio url="x"] -> iframe-style embed
  [/\[su_(?:youtube|vimeo|video|audio)\s+([^\]]*)\](?:\s*\[\/su_(?:youtube|vimeo|video|audio)\])?/gi,
    (m) => {
      const url = scAttr(m[1], "url") || scAttr(m[1], "src");
      return url ? `<iframe src="${esc(url)}"></iframe>` : "";
    }],
  // [su_list]<ul>...</ul>[/su_list] -> unwrap
  [/\[su_list[^\]]*\]([\s\S]*?)\[\/su_list\]/gi, (m) => m[1]],
  // [su_highlight]text[/su_highlight] -> <mark>
  [/\[su_highlight[^\]]*\]([\s\S]*?)\[\/su_highlight\]/gi,
    (m) => `<mark>${m[1]}</mark>`],
  // [su_table]...[/su_table] -> keep table-ish html
  [/\[su_table[^\]]*\]([\s\S]*?)\[\/su_table\]/gi,
    (m) => `<div class="wp-block-table">${m[1]}</div>`],
  // [caption ...]<img>caption[/caption] -> figure
  [/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi,
    (m) => {
      const img = m[1].match(/<img[^>]+>/i)?.[0] ?? "";
      const cap = stripTags(m[1].replace(/<img[^>]+>/i, ""));
      return `<figure>${img}${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>`;
    }],
  // [embed]url[/embed] / [video src=""] / [audio src=""]
  [/\[embed[^\]]*\]([\s\S]*?)\[\/embed\]/gi,
    (m) => `<iframe src="${esc(stripTags(m[1]))}"></iframe>`],
  [/\[(?:video|audio)\s+([^\]]*)\](?:\s*\[\/(?:video|audio)\])?/gi,
    (m) => {
      const src = scAttr(m[1], "src") || scAttr(m[1], "url");
      return src ? `<iframe src="${esc(src)}"></iframe>` : "";
    }],
  // Foxiz-specific: [ruby_button], [ruby_alert], [ruby_review] -> callout fallback
  [/\[ruby_button\s+([^\]]*)\](?:([\s\S]*?)\[\/ruby_button\])?/gi,
    (m) => {
      const href = scAttr(m[1], "url") || scAttr(m[1], "href") || "#";
      const label = stripTags(m[2] ?? scAttr(m[1], "label"));
      return `<p><a class="wp-block-button__link" href="${esc(href)}">${esc(label)}</a></p>`;
    }],
  [/\[ruby_(?:alert|review|box|cta)[^\]]*\]([\s\S]*?)\[\/ruby_(?:alert|review|box|cta)\]/gi,
    (m) => `<div class="callout">${m[1]}</div>`],
  // [foxiz_ads], [foxiz_subscribe], etc. -> drop standalone widget shortcodes
  [/\[foxiz_[^\]]+\](?:[\s\S]*?\[\/foxiz_[^\]]+\])?/gi, () => ""],
  // [ruby_toc] / [toc] / [su_table_of_contents] -> marker; renderer can decide
  [/\[(?:ruby_)?toc[^\]]*\]/gi, () => "<!-- toc -->"],
  [/\[su_table_of_contents[^\]]*\]/gi, () => "<!-- toc -->"],
  // [gallery ids="1,2,3"] -> drop (image refs unresolvable on import)
  [/\[gallery[^\]]*\]/gi, () => ""],
];

export function stripFoxizShortcodes(html: string): string {
  let out = html;
  for (const [re, fn] of SHORTCODE_RULES) {
    out = out.replace(re, (...args) => fn(args as unknown as RegExpMatchArray));
  }
  return out;
}

// ---------- Gutenberg parser ----------

interface GbToken {
  name: string;          // e.g. "core/paragraph", "core/heading"
  attrs: Record<string, Json>;
  inner: string;         // HTML between open / close comments
}

const OPEN_RE = /<!--\s*wp:([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)\s*(\{[\s\S]*?\})?\s*(\/)?-->/gi;

/** Split a Gutenberg HTML string into top-level block tokens. */
function tokenize(html: string): GbToken[] {
  const tokens: GbToken[] = [];
  OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN_RE.exec(html)) !== null) {
    const name = m[1].includes("/") ? m[1] : `core/${m[1]}`;
    const attrs = m[2] ? safeJson(m[2]) : {};
    const selfClose = Boolean(m[3]);
    if (selfClose) {
      tokens.push({ name, attrs, inner: "" });
      continue;
    }
    // Find matching close comment, supporting nesting.
    const shortName = name.replace(/^core\//, "");
    const closeRe = new RegExp(`<!--\\s*/wp:(?:core/)?${shortName}\\s*-->`, "i");
    const openAgainRe = new RegExp(`<!--\\s*wp:(?:core/)?${shortName}\\b`, "gi");
    openAgainRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let cursor = m.index + m[0].length;
    let closeIdx = -1;
    while (depth > 0) {
      closeRe.lastIndex = 0;
      const slice = html.slice(cursor);
      const closeMatch = closeRe.exec(slice);
      if (!closeMatch) break;
      const closeAbs = cursor + closeMatch.index;
      openAgainRe.lastIndex = cursor;
      let nested = 0;
      let nextOpen: RegExpExecArray | null;
      while ((nextOpen = openAgainRe.exec(html)) !== null && nextOpen.index < closeAbs) {
        nested += 1;
      }
      depth = 1 + nested - 1; // one open we are tracking + nested - the close we just found
      if (nested === 0) {
        closeIdx = closeAbs;
        break;
      }
      cursor = closeAbs + closeMatch[0].length;
      depth = 1;
    }
    if (closeIdx === -1) {
      tokens.push({ name, attrs, inner: "" });
      OPEN_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    const inner = html.slice(m.index + m[0].length, closeIdx);
    tokens.push({ name, attrs, inner });
    OPEN_RE.lastIndex = closeIdx;
  }
  return tokens;
}

function tokenToBlock(tok: GbToken): Block | null {
  const inner = tok.inner.trim();
  switch (tok.name) {
    case "core/paragraph":
      return { id: newBlockId(), type: "paragraph", data: { html: inner.replace(/^<p[^>]*>|<\/p>$/g, "") } };
    case "core/heading": {
      const level = Number(tok.attrs.level ?? 2);
      return {
        id: newBlockId(),
        type: "heading",
        data: {
          level: Math.min(Math.max(level, 2), 4) as Json,
          text: stripTags(inner),
          anchor: typeof tok.attrs.anchor === "string" ? tok.attrs.anchor : "",
        },
      };
    }
    case "core/list": {
      const ordered = Boolean(tok.attrs.ordered);
      const items: string[] = [];
      const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = re.exec(inner)) !== null) items.push(stripTags(li[1]));
      return { id: newBlockId(), type: "list", data: { ordered, items: items as Json } };
    }
    case "core/quote":
    case "core/pullquote": {
      const cite = (inner.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i)?.[1] ?? "").trim();
      const text = stripTags(inner.replace(/<cite[\s\S]*?<\/cite>/i, ""));
      return { id: newBlockId(), type: "quote", data: { text, cite } };
    }
    case "core/image": {
      const src = inner.match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? String(tok.attrs.url ?? "");
      if (!src) return null;
      const alt = inner.match(/<img[^>]+alt="([^"]*)"/i)?.[1] ?? "";
      const cap = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? "";
      return {
        id: newBlockId(),
        type: "image",
        data: { url: src, alt, caption: stripTags(cap), href: typeof tok.attrs.linkDestination === "string" ? String(tok.attrs.href ?? "") : "" },
      };
    }
    case "core/code":
    case "core/preformatted": {
      const code = stripTags(inner);
      const lang = typeof tok.attrs.language === "string" ? tok.attrs.language : "";
      return { id: newBlockId(), type: "code", data: { code, language: lang } };
    }
    case "core/separator":
      return { id: newBlockId(), type: "separator", data: {} };
    case "core/html":
      return { id: newBlockId(), type: "html", data: { html: inner } };
    case "core/embed":
    case "core-embed/youtube":
    case "core-embed/vimeo":
    case "core-embed/twitter": {
      const url = typeof tok.attrs.url === "string" ? tok.attrs.url : (inner.match(/https?:\/\/\S+/)?.[0] ?? "");
      if (!url) return null;
      return { id: newBlockId(), type: "embed", data: { url, provider: String(tok.attrs.providerNameSlug ?? "iframe"), html: "" } };
    }
    case "core/table":
      return { id: newBlockId(), type: "html", data: { html: inner } };
    case "core/buttons":
    case "core/button": {
      const href = inner.match(/href="([^"]+)"/i)?.[1] ?? "";
      const text = stripTags(inner);
      return { id: newBlockId(), type: "button", data: { href, text, variant: "primary" } };
    }
    default: {
      // Fallback: treat as raw HTML so nothing is lost.
      if (!inner) return null;
      return { id: newBlockId(), type: "html", data: { html: inner } };
    }
  }
}

export function isGutenbergHtml(html: string | null | undefined): boolean {
  return Boolean(html && /<!--\s*wp:[a-z]/i.test(html));
}

export function parseGutenberg(html: string | null | undefined): BlocksDoc {
  const src = stripFoxizShortcodes((html ?? "").trim());
  if (!src) return { version: 1, blocks: [] };
  if (!isGutenbergHtml(src)) {
    // Plain HTML coming from WP Classic editor or Foxiz: reuse our HTML parser.
    return htmlToBlocks(src);
  }
  const tokens = tokenize(src);
  const out: Block[] = [];
  for (const tok of tokens) {
    const block = tokenToBlock(tok);
    if (block) out.push(block);
  }
  if (!out.length) return htmlToBlocks(src);
  return { version: 1, blocks: out, meta: { migratedFrom: "gutenberg" } };
}

// ---------- Gutenberg serializer ----------

function attrsComment(name: string, attrs: Record<string, Json>): string {
  const keys = Object.keys(attrs);
  if (!keys.length) return `<!-- wp:${name} -->`;
  return `<!-- wp:${name} ${JSON.stringify(attrs)} -->`;
}

function blockToGutenberg(b: Block): string {
  switch (b.type) {
    case "paragraph":
      return `${attrsComment("paragraph", {})}\n<p>${String(b.data.html ?? "")}</p>\n<!-- /wp:paragraph -->`;
    case "heading": {
      const level = Number(b.data.level ?? 2);
      const anchor = b.data.anchor ? ` id="${esc(String(b.data.anchor))}"` : "";
      const attrs: Record<string, Json> = { level };
      if (b.data.anchor) attrs.anchor = String(b.data.anchor);
      return `${attrsComment("heading", attrs)}\n<h${level}${anchor}>${esc(String(b.data.text ?? ""))}</h${level}>\n<!-- /wp:heading -->`;
    }
    case "list": {
      const ordered = Boolean(b.data.ordered);
      const tag = ordered ? "ol" : "ul";
      const items = Array.isArray(b.data.items) ? (b.data.items as string[]) : [];
      const inner = items.map((i) => `<li>${esc(i)}</li>`).join("");
      return `${attrsComment("list", ordered ? { ordered: true } : {})}\n<${tag}>${inner}</${tag}>\n<!-- /wp:list -->`;
    }
    case "quote": {
      const cite = b.data.cite ? `<cite>${esc(String(b.data.cite))}</cite>` : "";
      return `${attrsComment("quote", {})}\n<blockquote class="wp-block-quote"><p>${esc(String(b.data.text ?? ""))}</p>${cite}</blockquote>\n<!-- /wp:quote -->`;
    }
    case "code":
      return `${attrsComment("code", b.data.language ? { language: String(b.data.language) } : {})}\n<pre class="wp-block-code"><code>${esc(String(b.data.code ?? ""))}</code></pre>\n<!-- /wp:code -->`;
    case "image": {
      const url = String(b.data.url ?? "");
      const alt = esc(String(b.data.alt ?? ""));
      const cap = b.data.caption ? `<figcaption>${esc(String(b.data.caption))}</figcaption>` : "";
      const attrs: Record<string, Json> = url ? { url } : {};
      return `${attrsComment("image", attrs)}\n<figure class="wp-block-image"><img src="${esc(url)}" alt="${alt}" />${cap}</figure>\n<!-- /wp:image -->`;
    }
    case "separator":
      return `<!-- wp:separator -->\n<hr class="wp-block-separator"/>\n<!-- /wp:separator -->`;
    case "embed": {
      const url = String(b.data.url ?? "");
      return `${attrsComment("embed", { url })}\n<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">${esc(url)}</div></figure>\n<!-- /wp:embed -->`;
    }
    case "button": {
      const href = esc(String(b.data.href ?? "#"));
      const text = esc(String(b.data.text ?? ""));
      return `<!-- wp:buttons -->\n<div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link" href="${href}">${text}</a></div></div>\n<!-- /wp:buttons -->`;
    }
    case "html":
    default:
      return `<!-- wp:html -->\n${String(b.data.html ?? "")}\n<!-- /wp:html -->`;
  }
}

export function blocksToGutenberg(doc: BlocksDoc | null | undefined): string {
  if (!doc?.blocks?.length) return "";
  return doc.blocks.map(blockToGutenberg).join("\n\n");
}
