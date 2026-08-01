// Guards PL/EN parity for the post-editor i18n namespaces this refactor added.
// A missing translation on either side would silently fall back to the other
// language in the UI, so we assert both locales expose an identical key tree.
import { describe, it, expect } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-post-panes";

type Tree = Record<string, unknown>;

/** Flatten a nested resource object into sorted dotted leaf paths. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Tree)
    .flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

function namespace(lang: "pl" | "en", key: string): unknown {
  const bundle = i18n.getResourceBundle(lang, "translation") as
    | { adminPostPanes?: Record<string, unknown> }
    | undefined;
  return bundle?.adminPostPanes?.[key];
}

// The sub-namespaces introduced when the editor route was moved to atomic design.
const ADDED_NAMESPACES = ["editor", "nav", "taxonomy", "layout", "sections"] as const;

describe("post-editor i18n PL/EN parity", () => {
  it.each(ADDED_NAMESPACES)("has matching PL and EN keys under adminPostPanes.%s", (ns) => {
    const pl = namespace("pl", ns);
    const en = namespace("en", ns);
    expect(pl, `PL namespace adminPostPanes.${ns} should exist`).toBeTruthy();
    expect(en, `EN namespace adminPostPanes.${ns} should exist`).toBeTruthy();
    expect(leafPaths(en)).toEqual(leafPaths(pl));
  });

  it("resolves a sample key in both languages to distinct, non-empty strings", () => {
    expect(i18n.getFixedT("pl")("adminPostPanes.editor.goToContent")).toBe(
      "Przejdź do edycji treści",
    );
    expect(i18n.getFixedT("en")("adminPostPanes.editor.goToContent")).toBe("Go to content editing");
  });
});
