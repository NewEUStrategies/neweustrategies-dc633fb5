// Manual TOC anchor: <!--TOC--> in HTML content is replaced with an
// auto-generated table of contents built from H2/H3 headings. Headings get
// stable IDs (slugified) so anchor links work. Pure string transform - no
// DOM dependency, safe for SSR.
//
// Usage flow (server-rendered HTML pipeline):
//   const { html, toc } = processManualToc(rawHtml, lang);
//   // -> html contains the TOC inline + ids on headings
//   // -> toc is also returned in case the consumer wants to render it elsewhere
//
// Honors only the FIRST <!--TOC--> marker; subsequent markers are stripped
// (multiple TOCs in the same article are an authoring mistake).

export interface TocEntry {
  level: 2 | 3;
  id: string;
  text: string;
}

const STRIP_TAGS_RE = /<[^>]+>/g;
const HEADING_RE = /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi;
const ID_ATTR_RE = /\sid\s*=\s*"([^"]+)"/i;
const TOC_MARKER_RE = /<!--\s*TOC\s*-->/i;

const PL_MAP: Record<string, string> = {
  "ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ß": "ss",
};

export function slugifyHeading(input: string): string {
  return input
    .replace(/[łŁøØđĐß]/g, (c) => PL_MAP[c] ?? c)
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "section";
}

export interface ProcessedToc {
  html: string;
  toc: TocEntry[];
  /** True when the manual marker was present in the source. */
  hasMarker: boolean;
}

const COPY = {
  pl: { heading: "Spis treści" },
  en: { heading: "Table of contents" },
} as const;

export function processManualToc(html: string, lang: "pl" | "en"): ProcessedToc {
  if (!html) return { html: "", toc: [], hasMarker: false };
  const hasMarker = TOC_MARKER_RE.test(html);
  const toc: TocEntry[] = [];
  const usedIds = new Set<string>();

  const withIds = html.replace(HEADING_RE, (full, levelStr: string, attrs: string, inner: string) => {
    const level = (levelStr === "3" ? 3 : 2) as 2 | 3;
    const text = inner.replace(STRIP_TAGS_RE, "").trim();
    if (!text) return full;
    const existing = attrs.match(ID_ATTR_RE)?.[1];
    let id = existing ?? slugifyHeading(text);
    let n = 2;
    while (usedIds.has(id)) { id = `${slugifyHeading(text)}-${n++}`; }
    usedIds.add(id);
    toc.push({ level, id, text });
    const cleanedAttrs = existing ? attrs : `${attrs} id="${id}"`;
    return `<h${level}${cleanedAttrs}>${inner}</h${level}>`;
  });

  if (!hasMarker) return { html: withIds, toc, hasMarker: false };

  const tocHtml = renderTocHtml(toc, COPY[lang].heading);
  // Replace first marker; strip any additional markers.
  let replaced = false;
  const out = withIds.replace(/<!--\s*TOC\s*-->/gi, () => {
    if (replaced) return "";
    replaced = true;
    return tocHtml;
  });
  return { html: out, toc, hasMarker: true };
}

function renderTocHtml(toc: readonly TocEntry[], heading: string): string {
  if (toc.length === 0) return "";
  const items = toc
    .map((t) => {
      const indent = t.level === 3 ? " manual-toc__item--sub" : "";
      return `<li class="manual-toc__item${indent}"><a href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a></li>`;
    })
    .join("");
  return `<nav class="manual-toc" aria-label="${escapeHtml(heading)}"><div class="manual-toc__title">${escapeHtml(heading)}</div><ol class="manual-toc__list">${items}</ol></nav>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
