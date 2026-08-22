// Silnik przypisów `[fn]…[/fn]` - JEDYNE źródło prawdy dla całej aplikacji.
// Obsługuje trzy silniki treści (builder / blocks / html) i widok kanwy admina.
//
// Kontrakt wyjścia - dwa warianty tego samego markera:
//
//   KOTWICZONY (domyślny; treść dokumentu, która MA sekcję końcową):
//     <sup class="fn-ref"><a href="#fn-N" id="fnref-N" data-fn="N"
//          aria-describedby="footnotes-heading" role="doc-noteref">[N]</a></sup>
//
//   SAMODZIELNY (`anchored: false`; treść BEZ dokumentowej sekcji końcowej -
//   dziś globalne widgety, numerowane per-widget):
//     <sup class="fn-ref"><span title="…" role="note">[N]</span></sup>
//
// Rozdzielenie jest celowe: samodzielny marker nie może nieść `id`/`href`/`data-fn`,
// bo dublowałby id dokumentu i linkował do cudzego przypisu (patrz `ExpandOptions`).
//
// Reguły:
// - `[fn]  [/fn]` (pusto po trim) → drop bez zużycia numeru.
// - jeden kolektor = jedna ciągła numeracja; osobny kolektor = numeracja od nowa.
//   `prepareContentForRender` daje builderowi i HTML-owi OSOBNE kolektory, bo
//   renderowany jest zawsze dokładnie jeden silnik.
// - marker kotwiczony nie ma `title`: treść pokazuje wyłącznie wspólny tooltip
//   aplikacji, bez konkurującego natywnego dymka przeglądarki.
// - samodzielny marker zachowuje `title`, bo nie montuje warstwy tooltipów.
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

// --- Legacy WordPress (plugin "Footnotes Made Easy" / footnote_referrer) ---
//
// Zaimportowane wpisy niosą taki markup:
//   <span class="footnote_referrer"><a …><sup …>[12]</sup></a>
//     <span class="footnote_tooltip">A. Legucka, <em>…</em>, str. 33-34</span>
//   </span><script>…jQuery tooltip…</script>
//
// Bez normalizacji treść dymka renderuje się DOSŁOWNIE w akapicie (zaraz za
// numerem przypisu) - dokładnie ten defekt widać na produkcji. Zamieniamy więc
// całość na nasz shortcode `[fn]…[/fn]`, dzięki czemu dalsza część potoku
// (marker + tooltip + sekcja "Przypisy źródłowe") działa identycznie jak dla
// treści pisanej w edytorze - łącznie z kursywą tytułu w dymku.
const WP_FN_RE =
  /<span[^>]*class="[^"]*footnote_referrer[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*footnote_tooltip[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/gi;
const WP_FN_SCRIPT_RE = /<script[^>]*>[\s\S]*?footnote_plugin[\s\S]*?<\/script>/gi;

/** Zamienia stary markup przypisów WP na kanoniczne `[fn]…[/fn]`. */
export function normalizeWpFootnoteHtml(html: string): string {
  if (!html.includes("footnote_")) return html;
  return html.replace(WP_FN_SCRIPT_RE, "").replace(WP_FN_RE, (_m, inner: string) => {
    const text = String(inner ?? "").trim();
    return text ? `[fn]${text}[/fn]` : "";
  });
}

// --- Przypisy z edytorów biurowych (MS Word, LibreOffice, Google Docs, pandoc) ---
//
// Wszystkie te eksporty dzielą jeden wzorzec: w treści jest odsyłacz-kotwica do
// bloku definicji na końcu dokumentu. Różnią się tylko nazwami identyfikatorów:
//
//   MS Word        <a href="#_ftn1" name="_ftnref1">…</a>  +  <div id="ftn1">…</div>
//   LibreOffice    <a class="sdfootnoteanc" href="#sdfootnote1sym">…</a>
//                                                          +  <div id="sdfootnote1">…</div>
//   Google Docs    <sup><a href="#ftnt1" id="ftnt_ref1">…</a></sup>
//                                                          +  <p><a id="ftnt1">…</a> treść</p>
//   pandoc/docx    <a class="footnote-ref" href="#fn1">…</a> +  <li id="fn1">…</li>
//
// Normalizujemy KAŻDY z nich do `[fn]…[/fn]` w miejscu odsyłacza i usuwamy blok
// definicji - dzięki temu w jednym wklejonym dokumencie mogą współistnieć różne
// rodzaje przypisów (także obok WP i naszego shortcode'u), a wyjście jest jedno.

type FnKind = "ftnt" | "ftn" | "sd" | "fn";

function normalizeKind(raw: string): FnKind {
  const k = raw.toLowerCase();
  if (k === "ftnt") return "ftnt";
  if (k === "sdfootnote") return "sd";
  if (k === "fn") return "fn";
  return "ftn"; // "ftn" oraz "_ftn"
}

const OFFICE_HINT_RE = /(_ftnref|_ftn\d|id=["']?ftn|sdfootnote|footnote-ref|ftnt_ref|ftnt\d)/i;

// Bloki definicji na końcu dokumentu (jeden wzorzec na eksporter).
const DEF_BLOCK_RES: RegExp[] = [
  /<div[^>]*\bid=["']?(_?ftn|sdfootnote|ftnt)(\d+)["']?[^>]*>([\s\S]*?)<\/div>/gi,
  /<li[^>]*\bid=["']?(fn)(\d+)["']?[^>]*>([\s\S]*?)<\/li>/gi,
  /<p[^>]*>\s*<a[^>]*\bid=["']?(ftnt|_?ftn)(\d+)["']?[^>]*>[\s\S]*?<\/a>([\s\S]*?)<\/p>/gi,
];

// Backlinki w bloku definicji ("↩", "[1]", symbol) - nie są treścią przypisu.
const DEF_BACKLINK_RE =
  /<a\b[^>]*href=["']#(?:_?ftnref|fnref|ftnt_ref|sdfootnote\d+anc)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
const DEF_NAMED_ANCHOR_RE =
  /<a\b[^>]*\b(?:name|id)=["']?(?:_?ftn|ftnt|sdfootnote)\d+[^"'>\s]*["']?[^>]*>[\s\S]*?<\/a>/gi;
const DEF_STRIP_TAGS_RE = /<\/?(?:p|div|li|ol|ul|section|span|font|sup|hr|br)\b[^>]*>/gi;

function cleanDefinition(inner: string): string {
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(DEF_BACKLINK_RE, "")
    .replace(DEF_NAMED_ANCHOR_RE, "")
    .replace(DEF_STRIP_TAGS_RE, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:\[\d+\]|\d+[.)]?|[*†‡])\s*/, "")
    .trim();
}

// Odsyłacz w treści; opcjonalnie owinięty w <sup> (Google Docs, pandoc).
const REF_RE =
  /(?:<sup\b[^>]*>\s*)?<a\b[^>]*href=["']#(ftnt|_?ftn|sdfootnote|fn)(\d+)[^"']*["'][^>]*>[\s\S]*?<\/a>(?:\s*<\/sup>)?/gi;

/** Zamienia przypisy z Worda/LibreOffice/Google Docs/pandoc na `[fn]…[/fn]`. */
export function normalizeOfficeFootnoteHtml(html: string): string {
  if (!OFFICE_HINT_RE.test(html)) return html;

  const defs = new Map<string, string>();
  let out = html;
  for (const re of DEF_BLOCK_RES) {
    re.lastIndex = 0;
    out = out.replace(re, (match, kind: string, num: string, inner: string) => {
      const text = cleanDefinition(inner ?? "");
      if (!text) return match;
      defs.set(`${normalizeKind(kind)}:${num}`, text);
      return "";
    });
  }
  if (defs.size === 0) return html;

  REF_RE.lastIndex = 0;
  out = out.replace(REF_RE, (match, kind: string, num: string) => {
    const text = defs.get(`${normalizeKind(kind)}:${num}`);
    return text ? `[fn]${text}[/fn]` : match;
  });

  // Puste kontenery po usuniętych definicjach (Word: mso-element:footnote-list,
  // pandoc: <section class="footnotes">) - żeby nie zostawiać sierot w treści.
  return out
    .replace(/<section[^>]*class=["'][^"']*footnotes[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<div[^>]*mso-element:\s*footnote-list[^>]*>\s*(?:<hr[^>]*>)?\s*<\/div>/gi, "")
    .replace(/<(div|ol|ul)[^>]*>\s*<\/\1>/gi, "");
}

/**
 * Jedno wejście dla wszystkich odmian obcych przypisów. Kolejność ma znaczenie
 * tylko o tyle, że każdy krok jest no-op dla markupu, którego nie dotyczy -
 * dlatego jeden dokument może mieszać WP, Worda i nasz `[fn]`.
 */
export function normalizeLegacyFootnoteHtml(html: string): string {
  return normalizeOfficeFootnoteHtml(normalizeWpFootnoteHtml(html));
}

/** Czy string zawiera jakikolwiek rozpoznawany zapis przypisu. */
export function containsFootnoteMarkup(v: string): boolean {
  return v.includes("[fn]") || v.includes("footnote_") || OFFICE_HINT_RE.test(v);
}

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

export interface ExpandOptions {
  /**
   * `true` (domyślnie) - marker jest odsyłaczem do sekcji końcowej: `href`,
   * `id` i `data-fn` wiążą go z wpisem w `<FootnotesList>` i z bąbelkiem
   * `<FootnoteTooltips>`.
   *
   * `false` - marker SAMODZIELNY: bez `href`, `id` i `data-fn`. Dla treści,
   * której przypisy NIE trafiają do dokumentowej sekcji końcowej (dziś:
   * globalne widgety, patrz `processWidgetFootnotes`). Kotwiczenie takiego
   * markera byłoby aktywnie szkodliwe: numeracja jest tam per-widget, więc
   * `id="fnref-1"` dublowałby id dokumentu (niepoprawny HTML), `href="#fn-1"`
   * skakałby do CUDZEGO przypisu, a `data-fn="1"` kazałby tooltipowi pokazać
   * treść cudzej noty. Treść zostaje w `title` (natywny tooltip), co jest
   * poprawne i wystarczające.
   */
  anchored?: boolean;
}

/**
 * Rozwija `[fn]…[/fn]` w stringu do markera i dopisuje przypisy do kolektora.
 * Puste (po trim) przypisy są cicho pomijane i nie zużywają numeru - dzięki
 * temu numeracja jest stabilna między silnikami.
 */
export function expandFootnotes(
  html: string,
  col: FootnoteCounter,
  opts: ExpandOptions = {},
): string {
  const anchored = opts.anchored ?? true;
  return normalizeLegacyFootnoteHtml(html).replace(FN_RE, (_m, inner: string) => {
    const text = String(inner ?? "").trim();
    if (!text) return "";
    const id = col.counter++;
    col.notes.push({ id, html: text });
    const title = escapeAttr(text.replace(/<[^>]+>/g, ""));
    if (!anchored) {
      return `<sup class="fn-ref"><span title="${title}" role="note">[${id}]</span></sup>`;
    }
    return `<sup class="fn-ref"><a href="#fn-${id}" id="fnref-${id}" data-fn="${id}" aria-describedby="footnotes-heading" role="doc-noteref">[${id}]</a></sup>`;
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

function processStringField(
  v: Json | undefined,
  col: FootnoteCounter,
  opts?: ExpandOptions,
): Json | undefined {
  if (typeof v !== "string" || !containsFootnoteMarkup(v)) return v;
  return expandFootnotes(v, col, opts);
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
  // Domyślnie SAMODZIELNY marker: ta ścieżka obsługuje globalne widgety, których
  // przypisy nie wchodzą do dokumentowej sekcji końcowej (numeracja per-widget),
  // więc kotwiczenie dublowałoby id i linkowało do cudzych przypisów.
  opts: ExpandOptions = { anchored: false },
): { widget: WidgetNode; notes: Footnote[] } {
  const widget = processWidget(w, lang, col, opts);
  return { widget, notes: col.notes };
}

function processWidget(
  w: WidgetNode,
  lang: "pl" | "en",
  col: FootnoteCounter,
  opts?: ExpandOptions,
): WidgetNode {
  const spec = WIDGET_TEXT_FIELDS[w.type];
  if (!spec) return w;
  let changed = false;
  const next: WidgetNode["content"] = { ...w.content };

  // Skalarne pola (lokalizowane warianty).
  for (const base of spec.scalar ?? []) {
    for (const key of localizedKeys(base, lang)) {
      if (key in next) {
        const before = next[key];
        const after = processStringField(before, col, opts);
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
            const after = processStringField(before, col, opts);
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
