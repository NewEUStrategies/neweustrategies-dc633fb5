// Testy dla multi-section + column layoutow dodanych w Turze 3.
// Weryfikuje ze:
// - Section.layout jest walidowany przez Zod ("single" | "1-2" | "1-1" | "2-1")
// - Widget.col jest walidowany (0 | 1)
// - Doc z wieloma sekcjami przechodzi walidacje
// - makeSection buduje sekcje ze stylem domyslnym
import { describe, it, expect } from "vitest";
import { emptyDoc, makeSection, makeWidget } from "../defaults";
import { NlDocSchema, NlSectionSchema } from "../schema";
import type { NlDoc, NlSection } from "../types";

describe("multi-section builder (Tura 3)", () => {
  it("section with layout=1-2 validates", () => {
    const s: NlSection = {
      id: "s1",
      layout: "1-2",
      widgets: [
        { ...makeWidget("heading"), col: 0 },
        { ...makeWidget("field.email"), col: 1 },
      ],
    };
    expect(NlSectionSchema.safeParse(s).success).toBe(true);
  });

  it("widget.col accepts only 0 or 1", () => {
    const s = {
      id: "s1",
      layout: "1-1",
      widgets: [{ ...makeWidget("heading"), col: 2 }],
    };
    expect(NlSectionSchema.safeParse(s).success).toBe(false);
  });

  it("section.layout rejects invalid values", () => {
    const s = { id: "s1", layout: "1-3", widgets: [] };
    expect(NlSectionSchema.safeParse(s).success).toBe(false);
  });

  it("doc with multiple sections validates", () => {
    const base = emptyDoc("inline");
    const doc: NlDoc = {
      ...base,
      sections: [
        makeSection([makeWidget("heading")]),
        { id: "s2", layout: "1-1", widgets: [makeWidget("paragraph")] },
        makeSection([makeWidget("submit")]),
      ],
    };
    const parsed = NlDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sections).toHaveLength(3);
    }
  });

  it("makeSection provides sensible default style", () => {
    const s = makeSection();
    expect(s.style?.gap).toBeDefined();
    expect(s.style?.align).toBe("left");
    expect(NlSectionSchema.safeParse(s).success).toBe(true);
  });

  it("section layout=single keeps widgets without col", () => {
    const s = makeSection([makeWidget("heading"), makeWidget("submit")]);
    expect(s.widgets.every((w) => w.col === undefined)).toBe(true);
  });
});
