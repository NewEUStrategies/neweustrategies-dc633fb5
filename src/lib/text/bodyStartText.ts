/**
 * Początek czytanego tekstu wpisu - wejście `excerptToLead` do wykrycia
 * leadu, który powtarza pierwsze zdania treści (automatyczna zajawka
 * WordPressa to pierwsze ~55 słów wpisu).
 *
 * Bierzemy tekst pierwszych bloków treści aktywnego silnika (bloki, builder,
 * legacy HTML) do `limit` znaków. Bloki bez prozy (obraz, embed, spis treści,
 * separator) są pomijane - WordPress też nie ma ich w zajawce. Czysta funkcja
 * bez DOM: SSR i hydratacja liczą ten sam wynik.
 */
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import type { BuilderDocument } from "@/lib/builder/types";
import { resolveContentEngine } from "@/lib/content/contentEngine";
import { htmlToPlainText } from "@/lib/sanitizePure";
import { decodeHtmlEntities } from "./cleanExcerpt";

export interface BodyStartInput {
  editor?: string | null;
  builderDoc?: BuilderDocument | null;
  blocksDoc?: BlocksDoc | null;
  html?: string | null;
  lang: "pl" | "en";
}

const DEFAULT_LIMIT = 1500;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Proza jednego bloku; `""` dla bloków bez tekstu do czytania. */
function blockText(block: Block): string {
  const d = block.data;
  switch (block.type) {
    case "paragraph":
    case "html":
      return htmlToPlainText(str(d.html));
    case "heading":
    case "quote":
      return htmlToPlainText(str(d.text));
    case "list":
      return Array.isArray(d.items)
        ? d.items.map((item) => htmlToPlainText(str(item))).join(" ")
        : "";
    default:
      return "";
  }
}

function collectBlocks(blocks: readonly Block[] | undefined, out: string[], limit: number): void {
  for (const block of blocks ?? []) {
    if (out.join(" ").length >= limit) return;
    if (block.style?.hidden) continue;
    const text = blockText(block).trim();
    if (text) out.push(text);
  }
}

function pickLocalized(rec: Record<string, unknown>, key: string, lang: "pl" | "en"): string {
  return (
    str(rec[`${key}_${lang}`]) || str(rec[`${key}_pl`]) || str(rec[`${key}_en`]) || str(rec[key])
  );
}

/**
 * Widgety tekstu buildera w kolejności dokumentu: `text` (HTML), `rich-text`
 * (dokument bloków) i `heading`. Pozostałe widgety (karty, reklamy, listy
 * wpisów) nie są treścią wpisu.
 */
function collectBuilder(node: unknown, lang: "pl" | "en", out: string[], limit: number): void {
  if (out.join(" ").length >= limit || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectBuilder(child, lang, out, limit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.kind === "widget") {
    const content = (rec.content ?? {}) as Record<string, unknown>;
    if (rec.type === "text") {
      const text = htmlToPlainText(pickLocalized(content, "html", lang)).trim();
      if (text) out.push(text);
    } else if (rec.type === "heading") {
      const text = htmlToPlainText(pickLocalized(content, "text", lang)).trim();
      if (text) out.push(text);
    } else if (rec.type === "rich-text") {
      const loc = (content.doc ?? null) as Record<string, BlocksDoc | undefined> | null;
      const doc = loc && typeof loc === "object" ? (loc[lang] ?? loc.pl ?? loc.en) : undefined;
      collectBlocks(doc?.blocks, out, limit);
    }
    return;
  }
  for (const [key, value] of Object.entries(rec)) {
    if (key === "style" || key === "advanced" || key === "content") continue;
    if (value && typeof value === "object") collectBuilder(value, lang, out, limit);
  }
}

/** Przypisy `[fn]…[/fn]` - WordPress nie ma ich w zajawce. */
const FOOTNOTE = /\[fn\][\s\S]*?\[\/fn\]/gi;
/** Znaczniki shortcode'ów (`[infogram …]`, `[/su_note]`) - zajawka WordPressa ich nie zawiera. */
const SHORTCODE_TAG = /\[\/?[A-Za-z][\w-]*(?:\s[^[\]]*)?\]/g;

export function bodyStartText(input: BodyStartInput, limit = DEFAULT_LIMIT): string {
  const engine = resolveContentEngine(input);
  const out: string[] = [];
  if (engine === "blocks") collectBlocks(input.blocksDoc?.blocks, out, limit);
  else if (engine === "builder") collectBuilder(input.builderDoc?.sections, input.lang, out, limit);
  else out.push(htmlToPlainText(input.html ?? ""));
  // `htmlToPlainText` zna tylko podstawowe encje; `&bdquo;`/`&hellip;` z importu
  // dekodujemy tak samo jak zajawkę.
  return decodeHtmlEntities(out.join(" "))
    .replace(FOOTNOTE, "")
    .replace(SHORTCODE_TAG, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
