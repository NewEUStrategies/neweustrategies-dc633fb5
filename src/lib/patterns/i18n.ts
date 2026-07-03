// Walk a BuilderDocument and collect every i18n string pair (`*_pl` / `*_en`).
// Returns a flat list with a path so we can write edits back via setByPath.
import type { BuilderDocument, WidgetNode } from "@/lib/builder/types";

export interface I18nField {
  /** Unique path inside the document, e.g. ["sections",0,"children",0,"children",0,"content","text"]. */
  path: ReadonlyArray<string | number>;
  /** Base key WITHOUT the `_pl|_en` suffix (e.g. "text", "label", "title"). */
  baseKey: string;
  /** Widget type (for grouping in the UI). */
  widgetType: WidgetNode["type"];
  /** Stable widget id - for "scroll to" / grouping. */
  widgetId: string;
  pl: string;
  en: string;
}

const I18N_BASE_KEYS = new Set<string>([
  "text",
  "subtitle",
  "label",
  "title",
  "subtitle",
  "html",
  "alt",
  "excerpt",
  "cta",
  "badge",
  "name",
  "trigger",
  "placeholder",
  "action",
  "quote",
  "role",
  "period",
  "signin",
  "signup",
  "panel",
]);

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function isObj(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function collectI18nFields(doc: BuilderDocument): I18nField[] {
  const out: I18nField[] = [];
  for (let si = 0; si < doc.sections.length; si++) {
    const section = doc.sections[si];
    if (!section) continue;
    walkSectionChildren(section.children, ["sections", si, "children"], out);
  }
  return out;
}

function walkSectionChildren(
  nodes: unknown[],
  basePath: ReadonlyArray<string | number>,
  out: I18nField[],
): void {
  nodes.forEach((node, i) => {
    if (!isObj(node)) return;
    const kind = node.kind;
    const path = [...basePath, i];
    if (kind === "column" && Array.isArray(node.children)) {
      (node.children as unknown[]).forEach((widget, wi) => {
        if (!isObj(widget) || widget.kind !== "widget") return;
        collectFromWidget(widget as unknown as WidgetNode, [...path, "children", wi], out);
      });
    } else if (kind === "inner-section" && Array.isArray(node.columns)) {
      walkSectionChildren(node.columns as unknown[], [...path, "columns"], out);
    }
  });
}

function collectFromWidget(
  widget: WidgetNode,
  path: ReadonlyArray<string | number>,
  out: I18nField[],
): void {
  const content = widget.content;
  const seen = new Set<string>();
  for (const k of Object.keys(content)) {
    const m = /^(.+)_(pl|en)$/.exec(k);
    if (!m) continue;
    const baseKey = m[1];
    if (seen.has(baseKey)) continue;
    if (!I18N_BASE_KEYS.has(baseKey)) continue;
    seen.add(baseKey);
    const pl =
      typeof content[`${baseKey}_pl`] === "string" ? (content[`${baseKey}_pl`] as string) : "";
    const en =
      typeof content[`${baseKey}_en`] === "string" ? (content[`${baseKey}_en`] as string) : "";
    out.push({
      path: [...path, "content"],
      baseKey,
      widgetType: widget.type,
      widgetId: widget.id,
      pl,
      en,
    });
  }
}

/**
 * Returns a deep-cloned document with the given i18n pair overrides applied.
 * `overrides[idx]` corresponds to `collectI18nFields(doc)[idx]`.
 */
export function applyI18nOverrides(
  doc: BuilderDocument,
  fields: ReadonlyArray<I18nField>,
  overrides: ReadonlyArray<{ pl: string; en: string }>,
): BuilderDocument {
  const next = JSON.parse(JSON.stringify(doc)) as BuilderDocument;
  fields.forEach((f, i) => {
    const override = overrides[i];
    if (!override) return;
    const container = walkToPath(next, f.path);
    if (!container || typeof container !== "object") return;
    const contentObj = container as Record<string, Json>;
    contentObj[`${f.baseKey}_pl`] = override.pl;
    contentObj[`${f.baseKey}_en`] = override.en;
  });
  return next;
}

function walkToPath(root: unknown, path: ReadonlyArray<string | number>): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur == null) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (!isObj(cur)) return undefined;
      cur = cur[seg];
    }
  }
  return cur;
}
