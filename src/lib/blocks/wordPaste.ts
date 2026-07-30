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
import { newBlockId, toJson } from "./types";

/** Znaczniki, po których poznajemy że schowek niesie realną strukturę. */
const RICH_MARKERS = /<(h[1-6]|ul|ol|li|table|blockquote|pre|p|br|strong|b|em|i|u|sup|sub|a)\b/i;

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
    const target: Element = sup && (sup.textContent ?? "").trim() === (a.textContent ?? "").trim() ? sup : a;
    target.replaceWith(replacement);
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
  data: { level: Math.min(4, Math.max(2, level)), text, anchor: "" },
});

const paragraph = (html: string): Block => ({
  id: newBlockId(),
  type: "paragraph",
  data: { html },
});

function tableBlock(el: Element): Block | null {
  const rows: string[][] = [];
  let header = false;
  const trs = Array.from(el.querySelectorAll("tr"));
  trs.forEach((tr, i) => {
    const cells = Array.from(tr.querySelectorAll("th,td"));
    if (!cells.length) return;
    if (i === 0 && cells.some((c) => c.tagName === "TH")) header = true;
    rows.push(cells.map((c) => (c.textContent ?? "").replace(/\u00A0/g, " ").trim()));
  });
  if (!rows.length) return null;
  return { id: newBlockId(), type: "table", data: { rows: toJson(rows), header } };
}

function pushList(out: Block[], items: string[], ordered: boolean): void {
  const clean = items.filter((i) => i.trim().length > 0);
  if (!clean.length) return;
  out.push({ id: newBlockId(), type: "list", data: { ordered, items: toJson(clean) } });
}

function convertChildren(parent: Element, out: Block[]): void {
  let pending: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (pending) pushList(out, pending.items, pending.ordered);
    pending = null;
  };

  for (const child of Array.from(parent.children)) {
    const tag = child.tagName;

    if (/^H[1-6]$/.test(tag)) {
      flush();
      const text = (child.textContent ?? "").replace(/\u00A0/g, " ").trim();
      if (text) out.push(heading(Number(tag.slice(1)), text));
      continue;
    }

    if (tag === "UL" || tag === "OL") {
      flush();
      const items = Array.from(child.children)
        .filter((li) => li.tagName === "LI")
        .map((li) => inlineHtml(li).trim());
      pushList(out, items, tag === "OL");
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
      const text = (child.textContent ?? "").replace(/\u00A0/g, " ").trim();
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
      if (isWordListItem(child)) {
        const ordered = isOrderedWordItem(child);
        const item = stripBullet(inlineHtml(child));
        if (pending && pending.ordered === ordered) pending.items.push(item);
        else {
          flush();
          pending = { ordered, items: [item] };
        }
        continue;
      }
      flush();
      const html = inlineHtml(child).trim();
      if (!isBlank(html)) out.push(paragraph(html));
      continue;
    }

    if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "BODY") {
      flush();
      // Kontener z samą treścią inline (typowe dla Google Docs) - jeden akapit.
      if (child.children.length === 0 || !child.querySelector("p,div,ul,ol,table,h1,h2,h3,h4,h5,h6")) {
        const html = inlineHtml(child).trim();
        if (!isBlank(html)) out.push(paragraph(html));
      } else {
        convertChildren(child, out);
      }
      continue;
    }

    // Element inline na poziomie bloku (np. luźny <span> / <a>).
    const html = inlineHtml(child).trim();
    if (!isBlank(html)) {
      flush();
      out.push(paragraph(html));
    }
  }
  flush();
}

function parseBody(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return null;
  body.querySelectorAll("script,style,meta,link,o\\:p").forEach((n) => n.remove());
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
