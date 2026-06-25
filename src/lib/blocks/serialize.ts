// Serializacja BlocksDoc -> HTML (do podglądu / excerpt / fallback SEO).
// Nie zastępuje publicznego renderera React - tylko prosty zrzut tekstu.

import type { Block, BlocksDoc } from "./types";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function blockToHtml(b: Block): string {
  switch (b.type) {
    case "paragraph": return `<p>${String(b.data.html ?? "")}</p>`;
    case "heading": {
      const level = Number(b.data.level ?? 2);
      const tag = `h${Math.min(Math.max(level, 2), 4)}`;
      const id = b.data.anchor ? ` id="${esc(String(b.data.anchor))}"` : "";
      return `<${tag}${id}>${esc(String(b.data.text ?? ""))}</${tag}>`;
    }
    case "image": {
      const url = String(b.data.url ?? "");
      const alt = esc(String(b.data.alt ?? ""));
      const cap = String(b.data.caption ?? "");
      if (!url) return "";
      const img = `<img src="${esc(url)}" alt="${alt}" />`;
      return cap
        ? `<figure>${img}<figcaption>${esc(cap)}</figcaption></figure>`
        : img;
    }
    case "list": {
      const items = Array.isArray(b.data.items) ? (b.data.items as string[]) : [];
      const tag = b.data.ordered ? "ol" : "ul";
      return `<${tag}>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
    }
    case "quote": {
      const cite = b.data.cite ? `<cite>${esc(String(b.data.cite))}</cite>` : "";
      return `<blockquote><p>${esc(String(b.data.text ?? ""))}</p>${cite}</blockquote>`;
    }
    case "html": return String(b.data.html ?? "");
    default: return "";
  }
}

export function blocksToHtml(doc: BlocksDoc | null | undefined): string {
  if (!doc?.blocks) return "";
  return doc.blocks.map(blockToHtml).join("\n");
}

export function blocksToPlainText(doc: BlocksDoc | null | undefined, max = 300): string {
  if (!doc?.blocks) return "";
  const parts: string[] = [];
  for (const b of doc.blocks) {
    if (b.type === "paragraph") parts.push(String(b.data.html ?? "").replace(/<[^>]+>/g, ""));
    else if (b.type === "heading") parts.push(String(b.data.text ?? ""));
    else if (b.type === "list") {
      const items = Array.isArray(b.data.items) ? (b.data.items as string[]) : [];
      parts.push(items.join(" · "));
    } else if (b.type === "quote") parts.push(String(b.data.text ?? ""));
    if (parts.join(" ").length > max) break;
  }
  return parts.join(" ").slice(0, max).trim();
}
