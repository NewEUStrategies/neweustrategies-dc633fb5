// Import treści wklejanej ze schowka (Word / Google Docs / LibreOffice / web).
//
// Cel: zachować STRUKTURĘ dokumentu (nagłówki, akapity, listy, tabele, cytaty,
// podziały) oraz formatowanie inline (bold/italic/underline/sup/sub/linki),
// a przypisy dolne Worda zamienić na wspólny shortcode `[fn]treść[/fn]`,
// który obsługuje silnik `src/lib/footnotes.ts` (blocks / builder / html).
//
// Moduł jest czysty względem aplikacji: jedyną zależnością środowiskową jest
// `DOMParser` (przeglądarka + jsdom w testach), więc logika jest w pełni
// testowalna bez montowania edytora.

import type { Block } from "./types";
import { newBlockId } from "./types";
import { toJson } from "@/lib/builder/types";

/** Znaczniki, po których poznajemy że schowek niesie realną strukturę. */
const RICH_MARKERS = /<(h[1-6]|ul|ol|li|table|tr|td|th|figure|img|blockquote|pre|p|br|strong|b|em|i|u|sup|sub|a)\b/i;

/** Czy warto uruchamiać import strukturalny dla danego HTML ze schowka. */
export function looksLikeRichPaste(html: string): boolean {
  return typeof html === "string" && html.trim().length > 0 && RICH_MARKERS.test(html);
}

// --- przypisy -------------------------------------------------------------

/**
 * Word: `<a href="#_ftn1" id="_ftnref1">` w treści + `<div id="ftn1">` na końcu.
 * Google Docs: `<a href="#ftnt1" id="ftnt_ref1">` + `<div id="ftnt1">`.
 * LibreOffice: `<a class="sdfootnoteanc" href="#sdfootnote1sym">` + `#sdfootnote1`.
 */
const FTN_REF_HREF = /^#(_?ftn|ftnt|sdfootnote|_?edn)/i;

/** Normalizuje `#_ftn1` / `#ftnt1` / `#sdfootnote1sym` do klucza `1`. */
function footnoteKey(raw: string): string | null {
  const m = raw.replace(/^#/, "").match(/(\d+)/);
  return m ? m[1] : null;
}

/** Usuwa wiodący numer/marker („1.", „[1]", „i ") z treści przypisu. */
function stripLeadingMarker(text: string): string {
  return text
    .replace(/^\s*[[(]?\s*\d+\s*[\])]?[.):\u00A0\s]*/, "")
    .replace(/^[*\u2020\u2021\u00A0\s]+/, "")
    .trim();
}

/**
 * Zbiera definicje przypisów i USUWA je z drzewa (sekcja końcowa nie może
 * trafić do treści - jej rolę przejmuje renderer przypisów).
 */
function collectFootnotes(root: HTMLElement): Map<string, string> {
  const map = new Map<string, string>();
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      "div[id], p[id], li[id], div[style*='mso-element:footnote'], div[style*='mso-element:endnote']",
    ),
  );
  for (const el of candidates) {
    const id = el.getAttribute("id") ?? "";
    if (!/^(_?ftn|ftnt|sdfootnote|_?edn)\d+$/i.test(id)) continue;
    const key = footnoteKey(id);
    if (!key) continue;
    const text = stripLeadingMarker(el.textContent ?? "");
    if (text) map.set(key, text);
    el.remove();
  }
  // Word bywa poprzedza sekcję przypisów poziomą linią oraz pustym akapitem.
  if (map.size > 0) {
    const hrs = Array.from(root.querySelectorAll("hr"));
    const last = hrs[hrs.length - 1];
    if (last && !last.nextElementSibling) last.remove();
  }
  return map;
}

/** Zamienia odnośniki do przypisów na inline shortcode `[fn]…[/fn]`. */
function inlineFootnoteRefs(root: HTMLElement, notes: Map<string, string>): void {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const a of anchors) {
    const href = a.getAttribute("href") ?? "";
    if (!FTN_REF_HREF.test(href)) continue;
    const key = footnoteKey(href);
    const body = key ? notes.get(key) : undefined;
    const replacement = a.ownerDocument.createTextNode(body ? `[fn]${body}[/fn]` : "");
    // Marker Worda bywa opakowany w <sup> - usuwamy cały wrapper, nie tylko <a>.
    const sup = a.closest("sup");
    const target: Element =
      sup && (sup.textContent ?? "").trim() === (a.textContent ?? "").trim() ? sup : a;
    target.replaceWith(replacement);
  }
}

// --- przypisy „ręczne" (indeks górny + lista na końcu) ---------------------

/** Numery użyte w treści jako indeks górny: `tekst<sup>1</sup>`. */
function superscriptKeys(root: HTMLElement): Set<string> {
  const keys = new Set<string>();
  for (const sup of Array.from(root.querySelectorAll("sup"))) {
    const raw = (sup.textContent ?? "").replace(/\u00A0/g, " ").trim();
    const m = raw.match(/^[[(]?\s*(\d{1,3})\s*[\])]?$/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** Czy element to blok tekstowy, który może być definicją przypisu. */
const FOOTNOTE_DEF_TAGS = /^(P|DIV|LI)$/;

/**
 * Autorzy często nie używają mechanizmu przypisów Worda, tylko piszą `tekst¹`
 * i listę „1. źródło" na końcu dokumentu. Zbieramy takie definicje od końca
 * treści (tylko numery realnie użyte w indeksie górnym) i usuwamy je z drzewa.
 */
function collectManualFootnotes(root: HTMLElement, notes: Map<string, string>): void {
  const keys = superscriptKeys(root);
  if (keys.size === 0) return;
  const found = new Map<string, string>();
  let node = root.lastElementChild;
  while (node) {
    const prev = node.previousElementSibling;
    const text = (node.textContent ?? "").replace(/\u00A0/g, " ").trim();
    if (!text) {
      node = prev;
      continue;
    }
    if (node.tagName === "HR") break;
    if (!FOOTNOTE_DEF_TAGS.test(node.tagName)) break;
    const m = text.match(/^[[(]?\s*(\d{1,3})\s*[\])]?[.):\s]\s*(.+)$/s);
    if (!m) break;
    const key = m[1];
    if (!keys.has(key) || notes.has(key) || found.has(key)) break;
    found.set(key, m[2].trim());
    node.remove();
    node = prev;
  }
  for (const [key, body] of found) notes.set(key, body);
  const hrs = Array.from(root.querySelectorAll("hr"));
  const last = hrs[hrs.length - 1];
  if (found.size > 0 && last && !last.nextElementSibling) last.remove();
}

/** Zamienia `<sup>1</sup>` na `[fn]treść[/fn]`, gdy znamy definicję. */
function inlineSuperscriptRefs(root: HTMLElement, notes: Map<string, string>): void {
  if (notes.size === 0) return;
  for (const sup of Array.from(root.querySelectorAll("sup"))) {
    const raw = (sup.textContent ?? "").replace(/\u00A0/g, " ").trim();
    const m = raw.match(/^[[(]?\s*(\d{1,3})\s*[\])]?$/);
    if (!m) continue;
    const body = notes.get(m[1]);
    if (!body) continue;
    sup.replaceWith(sup.ownerDocument.createTextNode(`[fn]${body}[/fn]`));
  }
}



// --- inline ---------------------------------------------------------------

const INLINE_TAGS: Record<string, string> = {
  B: "strong",
  STRONG: "strong",
  I: "em",
  EM: "em",
  U: "u",
  S: "s",
  STRIKE: "s",
  DEL: "s",
  SUP: "sup",
  SUB: "sub",
  CODE: "code",
  MARK: "mark",
  BR: "br",
  A: "a",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styleImpliedTag(el: Element): string | null {
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) return "strong";
  if (/font-style\s*:\s*italic/.test(style)) return "em";
  if (/text-decoration[^;]*underline/.test(style)) return "u";
  if (/text-decoration[^;]*line-through/.test(style)) return "s";
  return null;
}

/** Serializuje węzły inline do bezpiecznego HTML (bez stylów Worda). */
function inlineHtml(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out += escapeHtml((child.nodeValue ?? "").replace(/\u00A0/g, " "));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = INLINE_TAGS[el.tagName] ?? styleImpliedTag(el);
    if (tag === "br") {
      out += "<br>";
      continue;
    }
    const inner = inlineHtml(el);
    if (!tag) {
      out += inner;
      continue;
    }
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) {
        out += inner;
        continue;
      }
      out += `<a href="${escapeHtml(href)}">${inner}</a>`;
      continue;
    }
    if (!inner.trim()) {
      out += inner;
      continue;
    }
    out += `<${tag}>${inner}</${tag}>`;
  }
  return out;
}

const isBlank = (html: string): boolean => html.replace(/<br\s*\/?>/gi, "").trim().length === 0;

// --- listy Worda ----------------------------------------------------------

/** Word eksportuje punktory jako `<p class=MsoListParagraph style="mso-list:…">`. */
function isWordListItem(el: Element): boolean {
  const cls = el.getAttribute("class") ?? "";
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  return /MsoListParagraph|MsoList/i.test(cls) || style.includes("mso-list:");
}

function isOrderedWordItem(el: Element): boolean {
  const text = (el.textContent ?? "").trimStart();
  return /^(\d+|[a-z]|[ivx]+)\s*[.)]/i.test(text);
}

/**
 * Poziom zagnieżdżenia punktu Worda. Priorytet: jawne `mso-list:… levelN`,
 * potem wcięcie `margin-left` (Word stosuje ok. 36 pt na poziom, LibreOffice
 * 1,27 cm), a w ostateczności poziom 1.
 */
function wordListLevel(el: Element): number {
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  const explicit = style.match(/mso-list:[^;]*level(\d+)/);
  if (explicit) return Math.min(6, Math.max(1, Number(explicit[1])));
  const margin = style.match(/margin-left\s*:\s*([\d.]+)\s*(pt|in|cm)/);
  if (margin) {
    const value = Number(margin[1]);
    const pt = margin[2] === "in" ? value * 72 : margin[2] === "cm" ? value * 28.35 : value;
    return Math.min(6, Math.max(1, Math.round(pt / 36) + 1));
  }
  return 1;
}

/** Numer startowy listy uporządkowanej odczytany z pierwszego punktu Worda. */
function wordListStart(el: Element): number {
  const m = (el.textContent ?? "").trimStart().match(/^(\d+)\s*[.)]/);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Usuwa wiodący punktor („·", „1.", „a)") wygenerowany przez Worda. */
function stripBullet(html: string): string {
  return html
    .replace(/^\s*(<[^>]+>\s*)*[\u00B7\u2022\u25CF\u25AA\uF0B7o-]\s*(&nbsp;|\s)*/i, "")
    .replace(/^\s*(\d+|[a-z]|[ivx]+)\s*[.)]\s*(&nbsp;|\s)*/i, "")
    .trim();
}

// --- bloki ----------------------------------------------------------------

const heading = (level: number, text: string): Block => ({
  id: newBlockId(),
  type: "heading",
  data: { level: Math.min(5, Math.max(2, level)), text, anchor: "" },
});

/**
 * Poziom nagłówka dla akapitu Worda/LibreOffice, który NIE jest tagiem `<hN>`:
 * `class="MsoHeading3"` / `MsoTitle`, `mso-outline-level:3`,
 * `mso-style-name:"heading 2"` albo styl LibreOffice `P.Heading_20_2`.
 * Zwraca 1-6 albo `null`, gdy to zwykły akapit.
 */
function wordHeadingLevel(el: Element): number | null {
  if (isWordListItem(el)) return null;
  const cls = el.getAttribute("class") ?? "";
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  if (/mso-?title|\bTitle\b/.test(cls) && !/subtitle/i.test(cls)) return 1;
  const byClass = cls.match(/(?:Mso)?Heading[_\s-]*(?:20[_\s-]*)?(\d)/i);
  if (byClass) return Math.min(6, Math.max(1, Number(byClass[1])));
  const byOutline = style.match(/mso-outline-level\s*:\s*(\d)/);
  if (byOutline) {
    const level = Number(byOutline[1]);
    if (level >= 1 && level <= 6) return level;
  }
  const byStyleName = style.match(/mso-style-name\s*:\s*"?heading\s*(\d)/);
  if (byStyleName) return Math.min(6, Math.max(1, Number(byStyleName[1])));
  return null;
}


const paragraph = (html: string): Block => ({
  id: newBlockId(),
  type: "paragraph",
  data: { html },
});

// --- media ze schowka -----------------------------------------------------

/** Osadzalne źródła obrazu: zdalne URL-e i base64. `file:///` z Worda odpada. */
const EMBEDDABLE_IMG = /^(https?:\/\/|\/\/|data:image\/)/i;

interface PastedImage {
  url: string;
  alt: string;
}

function readImage(el: Element): PastedImage | null {
  const raw = (el.getAttribute("src") ?? el.getAttribute("data-src") ?? "").trim();
  if (!raw || !EMBEDDABLE_IMG.test(raw)) return null;
  return {
    url: raw.startsWith("//") ? `https:${raw}` : raw,
    alt: (el.getAttribute("alt") ?? "").replace(/\u00A0/g, " ").trim(),
  };
}

const imageBlock = (img: PastedImage, caption: string): Block => ({
  id: newBlockId(),
  type: "image",
  data: {
    url: img.url,
    alt: img.alt || caption,
    caption,
    align: "center",
    size: "full",
    rounded: true,
    shadow: false,
  },
});

/** Wyciąga obrazy z poddrzewa i USUWA je, żeby nie dublowały się w tekście. */
function extractImages(root: Element): PastedImage[] {
  const out: PastedImage[] = [];
  for (const el of Array.from(root.querySelectorAll("img"))) {
    const img = readImage(el);
    if (img) out.push(img);
    el.remove();
  }
  // Word osadza starą grafikę VML - `<v:shape><v:imagedata src=…>`.
  for (const el of Array.from(root.querySelectorAll("[src]"))) {
    if (!/imagedata/i.test(el.tagName)) continue;
    const img = readImage(el);
    if (img) out.push(img);
    el.remove();
  }
  return out;
}

/** Akapit podpisu (Word: `MsoCaption`, edytory web: `.caption`, `<figcaption>`). */
function isCaptionEl(el: Element): boolean {
  if (el.tagName === "FIGCAPTION") return true;
  const cls = el.getAttribute("class") ?? "";
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  return /MsoCaption|(^|\s|-)caption(\s|$|-)/i.test(cls) || style.includes("mso-style-name:caption");
}

const plainText = (el: Element): string => (el.textContent ?? "").replace(/\u00A0/g, " ").trim();

/** Emituje bloki obrazów; pierwszy dostaje podpis (Word ma jeden na grafikę). */
function pushImages(out: Block[], images: PastedImage[], caption: string): void {
  images.forEach((img, i) => out.push(imageBlock(img, i === 0 ? caption : "")));
}

// --- tabele (Word / Excel) ------------------------------------------------

interface PastedCell {
  text: string;
  colSpan: number;
  rowSpan: number;
  align: string;
}

function cellAlign(el: Element): string {
  const attr = (el.getAttribute("align") ?? "").toLowerCase();
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  const m = style.match(/text-align\s*:\s*(left|center|right|justify)/);
  const value = m ? m[1] : attr;
  return value === "center" || value === "right" ? value : value === "justify" ? "left" : "";
}

function spanOf(el: Element, attr: "colspan" | "rowspan"): number {
  const n = Number(el.getAttribute(attr) ?? "1");
  return Number.isFinite(n) && n > 1 ? Math.min(20, Math.round(n)) : 1;
}

/**
 * Czy pierwszy wiersz jest nagłówkiem. Excel i Word nie emitują `<th>` -
 * rozpoznajemy pogrubienie całego wiersza lub styl `MsoTableHeader`.
 */
function looksLikeHeaderRow(cells: Element[]): boolean {
  if (cells.some((c) => c.tagName === "TH")) return true;
  const withText = cells.filter((c) => plainText(c).length > 0);
  if (!withText.length) return false;
  return withText.every((c) => {
    const cls = c.getAttribute("class") ?? "";
    if (/MsoTableHeader|heading/i.test(cls)) return true;
    const style = (c.getAttribute("style") ?? "").toLowerCase();
    if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) return true;
    const bold = c.querySelector("b,strong");
    return Boolean(bold) && plainText(bold as Element) === plainText(c);
  });
}

/** Bezpośrednie wiersze tabeli (bez wierszy tabel zagnieżdżonych w komórkach). */
function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll("tr")).filter((tr) => tr.closest("table") === table);
}

function tableBlock(el: Element): Block | null {
  const rows: string[][] = [];
  const spans: number[][][] = [];
  const aligns: string[][] = [];
  let header = false;
  ownRows(el).forEach((tr, i) => {
    const cells = Array.from(tr.children).filter((c) => c.tagName === "TH" || c.tagName === "TD");
    if (!cells.length) return;
    if (rows.length === 0 && looksLikeHeaderRow(cells)) header = true;
    const parsed: PastedCell[] = cells.map((c) => ({
      text: plainText(c),
      colSpan: spanOf(c, "colspan"),
      rowSpan: spanOf(c, "rowspan"),
      align: cellAlign(c),
    }));
    void i;
    rows.push(parsed.map((c) => c.text));
    spans.push(parsed.map((c) => [c.colSpan, c.rowSpan]));
    aligns.push(parsed.map((c) => c.align));
  });
  if (!rows.length) return null;
  const hasSpans = spans.some((r) => r.some(([c, rs]) => c > 1 || rs > 1));
  const hasAligns = aligns.some((r) => r.some((a) => a !== ""));
  return {
    id: newBlockId(),
    type: "table",
    data: {
      rows: toJson(rows),
      header,
      ...(hasSpans ? { spans: toJson(spans) } : {}),
      ...(hasAligns ? { aligns: toJson(aligns) } : {}),
    },
  };
}

// --- listy: model płaski z poziomami --------------------------------------

interface PendingList {
  ordered: boolean;
  items: string[];
  levels: number[];
  itemsOrdered: boolean[];
  start: number;
}

function pushList(out: Block[], list: PendingList | null): void {
  if (!list) return;
  const keep = list.items
    .map((text, i) => ({ text, level: list.levels[i] ?? 1, ordered: list.itemsOrdered[i] ?? false }))
    .filter((x) => x.text.trim().length > 0);
  if (!keep.length) return;
  const nested = keep.some((x) => x.level > 1);
  const mixed = keep.some((x) => x.ordered !== list.ordered);
  out.push({
    id: newBlockId(),
    type: "list",
    data: {
      ordered: list.ordered,
      items: toJson(keep.map((x) => x.text)),
      ...(nested ? { levels: toJson(keep.map((x) => x.level)) } : {}),
      ...(nested && mixed ? { itemsOrdered: toJson(keep.map((x) => x.ordered)) } : {}),
      ...(list.start > 1 ? { start: list.start } : {}),
    },
  });
}

/** Spłaszcza `<ul>/<ol>` z zagnieżdżeniami do modelu (tekst, poziom, ordered). */
function collectHtmlList(el: Element, level: number, into: PendingList): void {
  const ordered = el.tagName === "OL";
  for (const li of Array.from(el.children)) {
    if (li.tagName !== "LI") continue;
    const clone = li.cloneNode(true) as Element;
    clone.querySelectorAll("ul,ol").forEach((n) => n.remove());
    const text = inlineHtml(clone).trim();
    into.items.push(text);
    into.levels.push(level);
    into.itemsOrdered.push(ordered);
    for (const sub of Array.from(li.children)) {
      if (sub.tagName === "UL" || sub.tagName === "OL") collectHtmlList(sub, level + 1, into);
    }
  }
}

function convertChildren(parent: Element, out: Block[]): void {
  let pending: PendingList | null = null;
  const flush = () => {
    pushList(out, pending);
    pending = null;
  };

  const kids = Array.from(parent.children);
  /** Podpis stojący bezpośrednio po grafice - konsumujemy go razem z obrazem. */
  const takeCaption = (i: number): { caption: string; skip: number } => {
    const next = kids[i + 1];
    if (next && isCaptionEl(next)) return { caption: plainText(next), skip: 1 };
    return { caption: "", skip: 0 };
  };

  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    const tag = child.tagName;

    if (/^H[1-6]$/.test(tag)) {
      flush();
      const images = extractImages(child);
      const text = plainText(child);
      if (text) out.push(heading(Number(tag.slice(1)), text));
      pushImages(out, images, "");
      continue;
    }

    if (tag === "FIGURE") {
      flush();
      const cap = child.querySelector("figcaption");
      const caption = cap ? plainText(cap) : "";
      cap?.remove();
      pushImages(out, extractImages(child), caption);
      continue;
    }

    if (tag === "IMG") {
      flush();
      const img = readImage(child);
      const { caption, skip } = takeCaption(i);
      if (img) {
        out.push(imageBlock(img, caption));
        i += skip;
      }
      continue;
    }

    if (tag === "UL" || tag === "OL") {
      flush();
      const list: PendingList = {
        ordered: tag === "OL",
        items: [],
        levels: [],
        itemsOrdered: [],
        start: Math.max(1, Number(child.getAttribute("start") ?? "1") || 1),
      };
      collectHtmlList(child, 1, list);
      pushList(out, list);
      continue;
    }

    if (tag === "TABLE") {
      flush();
      const t = tableBlock(child);
      if (t) out.push(t);
      continue;
    }

    if (tag === "BLOCKQUOTE") {
      flush();
      const text = plainText(child);
      if (text) out.push({ id: newBlockId(), type: "quote", data: { text, cite: "" } });
      continue;
    }

    if (tag === "PRE") {
      flush();
      const code = child.textContent ?? "";
      if (code.trim()) out.push({ id: newBlockId(), type: "code", data: { code, language: "" } });
      continue;
    }

    if (tag === "HR") {
      flush();
      out.push({ id: newBlockId(), type: "separator", data: { variant: "line" } });
      continue;
    }

    if (tag === "P") {
      const styledLevel = wordHeadingLevel(child);
      if (styledLevel !== null) {
        flush();
        const images = extractImages(child);
        const text = plainText(child);
        if (text) out.push(heading(styledLevel, text));
        pushImages(out, images, "");
        continue;
      }

      if (isWordListItem(child)) {
        const ordered = isOrderedWordItem(child);
        const level = wordListLevel(child);
        const images = extractImages(child);
        const item = stripBullet(inlineHtml(child));
        if (!pending) {
          pending = {
            ordered,
            items: [],
            levels: [],
            itemsOrdered: [],
            start: ordered ? wordListStart(child) : 1,
          };
        }
        pending.items.push(item);
        pending.levels.push(level);
        pending.itemsOrdered.push(ordered);
        if (images.length) {
          flush();
          pushImages(out, images, "");
        }
        continue;
      }
      flush();
      const images = extractImages(child);
      const html = inlineHtml(child).trim();
      if (images.length && isBlank(html)) {
        const { caption, skip } = takeCaption(i);
        pushImages(out, images, caption);
        i += skip;
        continue;
      }
      if (!isBlank(html)) out.push(paragraph(html));
      pushImages(out, images, "");
      continue;
    }

    if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "BODY") {
      flush();
      // Kontener z samą treścią inline (typowe dla Google Docs) - jeden akapit.
      if (
        child.children.length === 0 ||
        !child.querySelector("p,div,ul,ol,table,figure,h1,h2,h3,h4,h5,h6")
      ) {
        const images = extractImages(child);
        const html = inlineHtml(child).trim();
        if (!isBlank(html)) out.push(paragraph(html));
        const { caption, skip } = images.length ? takeCaption(i) : { caption: "", skip: 0 };
        pushImages(out, images, isBlank(html) ? caption : "");
        if (images.length) i += skip;
      } else {
        convertChildren(child, out);
      }
      continue;
    }

    // Element inline na poziomie bloku (np. luźny <span> / <a>).
    const images = extractImages(child);
    const html = inlineHtml(child).trim();
    if (!isBlank(html) || images.length) {
      flush();
      if (!isBlank(html)) out.push(paragraph(html));
      pushImages(out, images, "");
    }
  }
  flush();
}

function parseBody(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return null;
  body.querySelectorAll("script,style,meta,link").forEach((n) => n.remove());
  Array.from(body.getElementsByTagName("*"))
    .filter((el) => el.tagName.toLowerCase().startsWith("o:"))
    .forEach((el) => el.remove());
  return body;
}

/**
 * Zamienia HTML ze schowka na listę bloków edytora.
 * Zwraca pustą tablicę, gdy nie da się nic sensownego odczytać.
 */
export function parseWordHtml(html: string): Block[] {
  const body = parseBody(html);
  if (!body) return [];
  const notes = collectFootnotes(body);
  inlineFootnoteRefs(body, notes);
  collectManualFootnotes(body, notes);
  inlineSuperscriptRefs(body, notes);

  const out: Block[] = [];
  convertChildren(body, out);
  // Same tekstowe dzieci body (bez żadnego elementu) - jeden akapit.
  if (!out.length) {
    const inline = inlineHtml(body).trim();
    if (!isBlank(inline)) out.push(paragraph(inline));
  }
  return out;
}

/**
 * Wariant inline: pojedynczy fragment (bez struktury blokowej) - używany, gdy
 * wklejamy w pole rich-text, które nie potrafi tworzyć nowych bloków.
 */
export function parseWordInlineHtml(html: string): string {
  const body = parseBody(html);
  if (!body) return "";
  const notes = collectFootnotes(body);
  inlineFootnoteRefs(body, notes);
  const blocks = Array.from(body.children).filter((el) =>
    /^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/.test(el.tagName),
  );
  if (!blocks.length) return inlineHtml(body).trim();
  return blocks
    .map((el) => inlineHtml(el).trim())
    .filter((s) => !isBlank(s))
    .join("<br>");
}
