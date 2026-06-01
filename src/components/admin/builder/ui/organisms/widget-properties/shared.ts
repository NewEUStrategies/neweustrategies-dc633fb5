// Shared types & helpers for widget content editors.
import type { WidgetNode } from "@/lib/builder/types";

export type Item = Record<string, unknown>;

export function itemsOf(c: WidgetNode["content"], k: string): Item[] {
  const v = c[k];
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter(
    (x): x is Item => typeof x === "object" && x !== null && !Array.isArray(x),
  );
}
