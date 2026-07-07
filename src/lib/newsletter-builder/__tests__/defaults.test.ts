import { describe, it, expect } from "vitest";
import { buildDefaultDoc, emptyDoc, makeWidget } from "../defaults";
import { NlDocSchema } from "../schema";

describe("newsletter-builder defaults", () => {
  it("empty doc validates against schema", () => {
    const doc = emptyDoc("inline");
    expect(NlDocSchema.safeParse(doc).success).toBe(true);
  });

  it("default inline doc contains email + submit and validates", () => {
    const doc = buildDefaultDoc("inline", {
      heading: { pl: "H", en: "H" },
      description: { pl: "D", en: "D" },
      submitLabel: { pl: "OK", en: "OK" },
    });
    const parsed = NlDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    const widgets = doc.sections[0]!.widgets.map((w) => w.type);
    expect(widgets).toContain("field.email");
    expect(widgets).toContain("submit");
  });

  it("popup doc keeps popup style hints", () => {
    const doc = buildDefaultDoc("popup", {});
    expect(doc.variant).toBe("popup");
    expect(doc.popup?.layout).toBe("stacked");
  });

  it("makeWidget produces valid widget of requested type", () => {
    const w = makeWidget("field.text");
    expect(w.type).toBe("field.text");
    expect(w.id).toBeTruthy();
  });
});
