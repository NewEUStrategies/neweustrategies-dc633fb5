// Markdown shortcut detector for the Paragraph block.
// Converts a paragraph whose plain text matches a shortcut into a new block.
// Pure, deterministic, no DOM dependency - safe for SSR / tests.

import type { Block } from "./types";
import { newBlockId } from "./types";

export type MarkdownTransform =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; first: string }
  | { kind: "separator" }
  | { kind: "code" };

const PATTERNS: Array<(t: string) => MarkdownTransform | null> = [
  (t) => /^#{1}\s+(.*)$/.test(t) ? { kind: "heading", level: 2, text: t.replace(/^#\s+/, "") } : null,
  (t) => /^#{2}\s+(.*)$/.test(t) ? { kind: "heading", level: 2, text: t.replace(/^##\s+/, "") } : null,
  (t) => /^#{3}\s+(.*)$/.test(t) ? { kind: "heading", level: 3, text: t.replace(/^###\s+/, "") } : null,
  (t) => /^#{4}\s+(.*)$/.test(t) ? { kind: "heading", level: 4, text: t.replace(/^####\s+/, "") } : null,
  (t) => /^>\s+(.*)$/.test(t) ? { kind: "quote", text: t.replace(/^>\s+/, "") } : null,
  (t) => /^[-*]\s+(.*)$/.test(t) ? { kind: "list", ordered: false, first: t.replace(/^[-*]\s+/, "") } : null,
  (t) => /^1\.\s+(.*)$/.test(t) ? { kind: "list", ordered: true, first: t.replace(/^1\.\s+/, "") } : null,
  (t) => /^-{3,}\s*$/.test(t) ? { kind: "separator" } : null,
  (t) => /^```\s*$/.test(t) ? { kind: "code" } : null,
];

export function detectMarkdownShortcut(plain: string): MarkdownTransform | null {
  const t = plain.replace(/\u00A0/g, " ").trimEnd();
  for (const fn of PATTERNS) {
    const r = fn(t);
    if (r) return r;
  }
  return null;
}

export function shortcutToBlock(t: MarkdownTransform): Block {
  switch (t.kind) {
    case "heading":
      return { id: newBlockId(), type: "heading", data: { level: t.level, text: t.text, anchor: "" } };
    case "quote":
      return { id: newBlockId(), type: "quote", data: { text: t.text, cite: "" } };
    case "list":
      return { id: newBlockId(), type: "list", data: { ordered: t.ordered, items: [t.first] } };
    case "separator":
      return { id: newBlockId(), type: "separator", data: { variant: "line" } };
    case "code":
      return { id: newBlockId(), type: "code", data: { lang: "ts", code: "" } };
  }
}

/** Strip a single trailing HTML paragraph wrapper if present. */
export function htmlToPlain(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, "");
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent ?? "";
}
