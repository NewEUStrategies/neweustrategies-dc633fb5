// Silnik przypisów `[fn]…[/fn]` - JEDYNE źródło prawdy dla całej aplikacji.
// Obsługuje trzy silniki treści (builder / blocks / html) i widok kanwy admina.
//
// Kontrakt wyjścia (identyczny wszędzie):
//   <sup class="fn-ref"><a href="#fn-N" id="fnref-N" data-fn="N"
//        title="…" aria-describedby="footnotes-heading">[N]</a></sup>
//
// Reguły:
// - `[fn]  [/fn]` (pusto po trim) → drop bez zużycia numeru.
// - numeracja globalna dla dokumentu (kolektor niesie counter między wywołaniami).
// - `title` zawiera treść przypisu bez tagów, HTML-escapowaną.
// - sanityzacja treści przypisu happens przy renderze `<FootnotesList>`, nie tu.

import type {
  BuilderDocument,
  SectionNode,
  SectionChild,
  ColumnNode,
  WidgetNode,
  Json,
} from "./builder/types";
import { WIDGET_TEXT_FIELDS, localizedKeys } from "./builder/widgetTextFields";

export type Footnote = { id: number; html: string };

const FN_RE = /\[fn\]([\s\S]*?)\[\/fn\]/g;

/** Escape HTML dla atrybutu `title` i (opcjonalnie) sekcji końcowej. */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Stateful kolektor - pozwala jednemu counterowi zszywać wiele wywołań
 * w kolejności dokumentu (builder → blocks → html).
 */
export interface FootnoteCounter {
  counter: number;
  notes: Footnote[];
}

export function createCounter(start = 1): FootnoteCounter {
  return { counter: start, notes: [] };
}

/**
 * Rozwija `[fn]…[/fn]` w stringu do markera `<sup><a data-fn>` i dopisuje
 * przypisy do wspólnego kolektora. Puste (po trim) przypisy są cicho pomijane
 * i nie zużywają numeru - dzięki temu numeracja jest stabilna między silnikami.
 */
export function expandFootnotes(html: string, col: FootnoteCounter): string {
  return html.replace(FN_RE, (_m, inner: string) => {
    const text = String(inner ?? "").trim();
    if (!text) return "";
    const id = col.counter++;
    col.notes.push({ id, html: text });
    const title = escapeAttr(text.replace(/<[^>]+>/g, ""));
    return `<sup class="fn-ref"><a href="#fn-${id}" id="fnref-${id}" data-fn="${id}" title="${title}" aria-describedby="footnotes-heading" role="doc-noteref">[${id}]</a></sup>`;
  });
}

/**
 * Legacy wrapper - zwraca `{ html, notes }` z liczeniem od `startIndex`.
 * Zachowany dla wywołań które nie potrzebują wspólnego kolektora.
 */
export function processHtmlFootnotes(
  html: string,
  startIndex: number,
): { html: string; notes: Footnote[] } {
  const col = createCounter(startIndex);
  const out = expandFootnotes(html, col);
  return { html: out, notes: col.notes };
}

/**
 * Odzyskiwanie przypisów z ALREADY-RENDERED markupu (baked output).
 * Kompatybilne wstecz z RichHtmlView i migracją WP.
 */
export function parseBakedFootnotes(root: ParentNode): Footnote[] {
  const out: Footnote[] = [];
  const items = root.querySelectorAll('[data-footnotes-list] > li[id^="fn-"]');
  items.forEach((li) => {
    const id = Number(li.id.replace(/^fn-/, ""));
    if (!Number.isInteger(id) || id <= 0) return;
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

// -------------------- Builder document walker --------------------

function processStringField(v: Json | undefined, col: FootnoteCounter): Json | undefined {
  if (typeof v !== "string" || !v.includes("[fn]")) return v;
  return expandFootnotes(v, col);
}

/**
 * Rozwija [fn] w polach tekstowych POJEDYNCZEGO widgetu według mapy
 * WIDGET_TEXT_FIELDS. Używane m.in. przez overlay globalnych widgetów w
 * WidgetView - live payload z bazy zawiera surowe shortcody, które muszą
 * zostać przetworzone tak samo jak snapshot w dokumencie, inaczej reader
 * widzi dosłowne `[fn]…[/fn]`.
 */
export function processWidgetFootnotes(
  w: WidgetNode,
  lang: "pl" | "en",
  col: FootnoteCounter = createCounter(1),
): { widget: WidgetNode; notes: Footnote[] } {
  const widget = processWidget(w, lang, col);
  return { widget, notes: col.notes };
}

function processWidget(w: WidgetNode, lang: "pl" | "en", col: FootnoteCounter): WidgetNode {
  const spec = WIDGET_TEXT_FIELDS[w.type];
  if (!spec) return w;
  let changed = false;
  const next: WidgetNode["content"] = { ...w.content };

  // Skalarne pola (lokalizowane warianty).
  for (const base of spec.scalar ?? []) {
    for (const key of localizedKeys(base, lang)) {
      if (key in next) {
        const before = next[key];
        const after = processStringField(before, col);
        if (after !== before) {
          next[key] = after as Json;
          changed = true;
        }
      }
    }
  }

  // Tablice obiektów (np. accordion.items[].title_pl).
  for (const arr of spec.arrays ?? []) {
    const raw = next[arr.arrayKey];
    if (!Array.isArray(raw)) continue;
    let arrChanged = false;
    const nextArr = raw.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      let itemChanged = false;
      const nextEntry: { [k: string]: Json } = { ...(entry as { [k: string]: Json }) };
      for (const base of arr.fields) {
        for (const key of localizedKeys(base, lang)) {
          if (key in nextEntry) {
            const before = nextEntry[key];
            const after = processStringField(before, col);
            if (after !== before) {
              nextEntry[key] = after as Json;
              itemChanged = true;
            }
          }
        }
      }
      if (itemChanged) {
        arrChanged = true;
        return nextEntry as Json;
      }
      return entry;
    });
    if (arrChanged) {
      next[arr.arrayKey] = nextArr as Json;
      changed = true;
    }
  }

  return changed ? { ...w, content: next } : w;
}

function processColumn(c: ColumnNode, lang: "pl" | "en", col: FootnoteCounter): ColumnNode {
  return { ...c, children: c.children.map((w) => processWidget(w, lang, col)) };
}

function processChild(ch: SectionChild, lang: "pl" | "en", col: FootnoteCounter): SectionChild {
  return ch.kind === "column"
    ? processColumn(ch, lang, col)
    : { ...ch, columns: ch.columns.map((c) => processColumn(c, lang, col)) };
}

function processSection(s: SectionNode, lang: "pl" | "en", col: FootnoteCounter): SectionNode {
  return { ...s, children: s.children.map((ch) => processChild(ch, lang, col)) };
}

/**
 * Przechodzi dokument buildera i rozwija `[fn]` we wszystkich zmapowanych
 * widgetach. Numeracja startuje od `col.counter` - można podać wspólny
 * kolektor, żeby zszyć builder + blocks + html w jedną ciągłą sekwencję.
 */
export function processDocFootnotes(
  doc: BuilderDocument,
  lang: "pl" | "en",
  col: FootnoteCounter = createCounter(1),
): { doc: BuilderDocument; notes: Footnote[]; counter: FootnoteCounter } {
  const nextDoc: BuilderDocument = {
    ...doc,
    sections: doc.sections.map((s) => processSection(s, lang, col)),
  };
  return { doc: nextDoc, notes: col.notes, counter: col };
}
