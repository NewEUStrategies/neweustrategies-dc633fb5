// Cross-tab clipboard for sections / columns / widgets using sessionStorage.
// Stored as a tagged envelope so paste knows what kind of node to insert.
import type { SectionNode, ColumnNode, WidgetNode, InnerSectionNode } from "./types";

const KEY = "builder.clipboard.v1";

export type ClipKind = "section" | "inner-section" | "column" | "widget";
export type ClipNode = SectionNode | InnerSectionNode | ColumnNode | WidgetNode;
export interface ClipEnvelope {
  kind: ClipKind;
  node: ClipNode;
}

export function copyToClipboard(env: ClipEnvelope) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(env));
  } catch {
    /* ignore */
  }
}

export function readClipboard(): ClipEnvelope | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClipEnvelope;
    if (!parsed || !parsed.kind || !parsed.node) return null;
    return parsed;
  } catch {
    return null;
  }
}
