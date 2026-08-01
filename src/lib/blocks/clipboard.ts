// Schowek bloków (zachowanie WordPress Gutenberg): Ctrl+C na zaznaczonych
// blokach serializuje je do schowka, Ctrl+V odtwarza - także między wpisami
// i między kartami.
//
// Format `text/html` niesie dwie warstwy:
//   1. sentinel `<!-- nes:blocks b64:… -->` - bezstratny JSON naszych bloków
//      (base64, żeby treść nie mogła rozbić komentarza HTML ani zgubić się
//      w sanitizerach schowka),
//   2. markup Gutenberga (`<!-- wp:… -->`) - dzięki temu bloki skopiowane
//      u nas wklejają się do WordPressa, a bloki skopiowane w WordPressie
//      (edytor bloków LUB widok kodu) wklejają się u nas.
// `text/plain` to czytelny tekst dla zwykłych edytorów.
//
// Czysty moduł bez DOM - testowalny w vitest.

import type { Block, Json } from "./types";
import { newBlockId } from "./types";
import { blocksToGutenberg, isGutenbergHtml, parseGutenberg } from "./gutenberg";

const SENTINEL_RE = /<!--\s*nes:blocks\s+b64:([A-Za-z0-9+/=]+)\s*-->/i;

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Nowe `id` w całym poddrzewie - wklejka nie może kolidować z oryginałem. */
export function regenerateBlockIds(blocks: Block[]): Block[] {
  // Zagnieżdżone bloki (columns.left/right, group.children…) żyją wewnątrz
  // `data` jako zwykły JSON - walker rozpoznaje je po kształcie {id,type,data}.
  const walkJson = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(walkJson);
    if (value && typeof value === "object") {
      const obj = value as Record<string, Json>;
      const out: Record<string, Json> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = walkJson(v);
      const looksLikeBlock =
        typeof obj.id === "string" && typeof obj.type === "string" && obj.data !== undefined;
      if (looksLikeBlock) out.id = newBlockId();
      return out;
    }
    return value;
  };
  return blocks.map((b) => ({
    ...b,
    id: newBlockId(),
    data: walkJson(b.data) as Record<string, Json>,
  }));
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .trim();
}

/** Czytelna reprezentacja bloków dla `text/plain`. */
export function blocksToPlainText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
      case "html":
        parts.push(stripTags(String(b.data.html ?? "")));
        break;
      case "heading":
        parts.push(stripTags(String(b.data.text ?? "")));
        break;
      case "list": {
        const items = Array.isArray(b.data.items) ? (b.data.items as Json[]) : [];
        const ordered = Boolean(b.data.ordered);
        parts.push(
          items
            .map((it, i) => `${ordered ? `${i + 1}.` : "-"} ${stripTags(String(it))}`)
            .join("\n"),
        );
        break;
      }
      case "quote":
        parts.push(
          `"${stripTags(String(b.data.text ?? ""))}"${b.data.cite ? ` - ${stripTags(String(b.data.cite))}` : ""}`,
        );
        break;
      case "code":
        parts.push(String(b.data.code ?? ""));
        break;
      case "image":
        parts.push(String(b.data.caption ?? b.data.alt ?? b.data.url ?? ""));
        break;
      case "separator":
        parts.push("---");
        break;
      default: {
        const guess = b.data.text ?? b.data.title ?? b.data.html ?? "";
        parts.push(stripTags(String(guess)));
      }
    }
  }
  return parts.filter((p) => p.length > 0).join("\n\n");
}

export interface ClipboardPayload {
  html: string;
  text: string;
}

/** Serializuje bloki do payloadu schowka (sentinel + markup Gutenberga). */
export function serializeBlocksForClipboard(blocks: Block[]): ClipboardPayload {
  const json = JSON.stringify({ version: 1, blocks });
  const sentinel = `<!-- nes:blocks b64:${toBase64(json)} -->`;
  const gutenberg = blocksToGutenberg({ version: 1, blocks });
  return {
    html: `${sentinel}\n${gutenberg}`,
    text: blocksToPlainText(blocks),
  };
}

function parseSentinel(html: string): Block[] | null {
  const m = html.match(SENTINEL_RE);
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64(m[1]));
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { blocks?: unknown }).blocks)
    ) {
      const blocks = (parsed as { blocks: Block[] }).blocks.filter(
        (b) => b && typeof b.type === "string" && b.data && typeof b.data === "object",
      );
      return blocks.length ? regenerateBlockIds(blocks) : null;
    }
  } catch {
    // uszkodzony sentinel - spróbujemy warstwy Gutenberga
  }
  return null;
}

/** Tekst bez znaczników HTML → akapity rozdzielone pustą linią. */
export function plainTextToBlocks(text: string): Block[] {
  const chunks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
  return chunks.map((chunk) => ({
    id: newBlockId(),
    type: "paragraph" as const,
    data: {
      html: chunk
        .split("\n")
        .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
        .join("<br>"),
    },
  }));
}

/**
 * Odtwarza bloki z payloadu schowka. Kolejność prób:
 * sentinel (bezstratny) → markup Gutenberga w HTML → markup Gutenberga w
 * tekście (kopiowanie z widoku kodu WP). `null` gdy schowek nie niesie bloków
 * (wtedy wołający używa ścieżki Word/plain-text).
 */
export function parseBlocksFromClipboard(
  html: string | null | undefined,
  text?: string | null,
): Block[] | null {
  const rich = html ?? "";
  if (rich) {
    const own = parseSentinel(rich);
    if (own?.length) return own;
    if (isGutenbergHtml(rich)) {
      const doc = parseGutenberg(rich);
      if (doc.blocks.length) return doc.blocks;
    }
  }
  if (text && isGutenbergHtml(text)) {
    const doc = parseGutenberg(text);
    if (doc.blocks.length) return doc.blocks;
  }
  return null;
}
