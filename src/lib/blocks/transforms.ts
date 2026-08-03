// Transformacje bloków „Przekształć w …" (zachowanie WordPress Gutenberg):
// akapit ↔ nagłówek ↔ lista ↔ cytat ↔ kod itd. z zachowaniem treści.
// Czysty moduł (bez DOM) - transformacja to funkcja Block -> Block[].

import type { Block, BlockType, Json } from "./types";
import { newBlockId } from "./types";
import { escapeInlineText } from "./inlineHtml";

/** Rodzina tekstowa - tylko między tymi typami oferujemy przekształcenia. */
const TEXT_FAMILY: readonly BlockType[] = [
  "paragraph",
  "heading",
  "list",
  "quote",
  "pullquote",
  "code",
  "preformatted",
  "verse",
  "callout",
  "details",
  "html",
];

const strip = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Tekst źródłowy bloku - wspólny punkt wyjścia dla większości transformacji. */
function sourceText(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "html":
      return strip(String(block.data.html ?? ""));
    case "heading":
      return strip(String(block.data.text ?? ""));
    case "list": {
      const items = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
      return items.map((i) => strip(String(i))).join("\n");
    }
    case "quote":
    case "pullquote":
    case "callout":
    case "verse":
      return strip(String(block.data.text ?? ""));
    case "preformatted":
      return String(block.data.text ?? "");
    case "code":
      return String(block.data.code ?? "");
    case "details":
      return [strip(String(block.data.summary ?? "")), strip(String(block.data.body ?? ""))]
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

/** HTML inline bloku - zachowuje pogrubienia/linki tam, gdzie cel je przyjmie. */
function sourceInlineHtml(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "html":
      return String(block.data.html ?? "").replace(/^<p[^>]*>|<\/p>\s*$/gi, "");
    case "heading":
      return String(block.data.text ?? "");
    default:
      return escapeInlineText(sourceText(block)).replace(/\n/g, "<br>");
  }
}

const textLines = (block: Block): string[] =>
  sourceText(block)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Buduje blok docelowy z treści źródła. `null` = transformacja nieobsługiwana. */
export function transformBlock(block: Block, to: BlockType): Block[] | null {
  if (block.type === to) return null;
  const text = sourceText(block);
  const inline = sourceInlineHtml(block);

  switch (to) {
    case "paragraph": {
      // Lista -> osobny akapit z każdej pozycji (jak w Gutenbergu).
      if (block.type === "list") {
        const items = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
        const blocks = items
          .map((i) => String(i))
          .filter((s) => strip(s).length > 0)
          .map((s) => ({ id: newBlockId(), type: "paragraph" as const, data: { html: s } }));
        return blocks.length
          ? blocks
          : [{ id: newBlockId(), type: "paragraph", data: { html: "" } }];
      }
      return [
        {
          id: newBlockId(),
          type: "paragraph",
          data: { html: inline || escapeInlineText(text).replace(/\n/g, "<br>") },
        },
      ];
    }
    case "heading":
      return [
        {
          id: newBlockId(),
          type: "heading",
          data: {
            level: block.type === "heading" ? Number(block.data.level ?? 2) : 2,
            text: inline,
            anchor: "",
          },
        },
      ];
    case "list": {
      const lines = textLines(block);
      return [
        {
          id: newBlockId(),
          type: "list",
          data: { ordered: false, items: (lines.length ? lines : [""]) as Json },
        },
      ];
    }
    case "quote":
    case "pullquote":
      return [
        {
          id: newBlockId(),
          type: to,
          data: {
            text,
            cite: String(
              (block.data.cite as string | undefined) ??
                (to === "quote" || to === "pullquote" ? "" : ""),
            ),
          },
        },
      ];
    case "code":
      return [{ id: newBlockId(), type: "code", data: { lang: "", code: text } }];
    case "preformatted":
    case "verse":
      return [{ id: newBlockId(), type: to, data: { text } }];
    case "callout":
      return [{ id: newBlockId(), type: "callout", data: { variant: "info", text } }];
    case "details": {
      const [first, ...rest] = textLines(block);
      return [
        {
          id: newBlockId(),
          type: "details",
          data: { summary: first ?? "", body: rest.join("\n") },
        },
      ];
    }
    case "html":
      return [
        {
          id: newBlockId(),
          type: "html",
          data: { html: inline ? `<p>${inline}</p>` : `<p>${escapeInlineText(text)}</p>` },
        },
      ];
    default:
      return null;
  }
}

/** Lista typów, na które da się przekształcić dany blok (menu „Przekształć w"). */
export function getTransformTargets(block: Block): BlockType[] {
  if (!TEXT_FAMILY.includes(block.type)) return [];
  return TEXT_FAMILY.filter((t) => t !== block.type);
}
