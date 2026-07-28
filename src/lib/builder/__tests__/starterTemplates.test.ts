// Kontrakt szablonow startowych: kazdy build() musi przetrwac walidacje
// dokumentu bez gubienia widgetow (typy w unii), generowac swieze id przy
// kazdym wywolaniu i miec kompletne i18n (PL i EN). To gwarantuje, ze
// wstawienie szablonu z palety nigdy nie produkuje "pustych" sekcji.
import { describe, it, expect } from "vitest";
import type { SectionNode, WidgetNode } from "@/lib/builder/types";
import { safeParseBuilderDoc, isKnownWidgetType } from "@/lib/builder/schema";
import {
  STARTER_TEMPLATES,
  starterDescription,
  starterName,
} from "@/lib/builder/starterTemplates";

function collectWidgets(sections: SectionNode[]): WidgetNode[] {
  const out: WidgetNode[] = [];
  for (const s of sections) {
    for (const child of s.children) {
      if (child.kind === "column") out.push(...child.children);
      else for (const col of child.columns) out.push(...col.children);
    }
  }
  return out;
}

function collectIds(sections: SectionNode[]): string[] {
  const ids: string[] = [];
  for (const s of sections) {
    ids.push(s.id);
    for (const child of s.children) {
      ids.push(child.id);
      if (child.kind === "column") ids.push(...child.children.map((w) => w.id));
      else
        for (const col of child.columns) {
          ids.push(col.id, ...col.children.map((w) => w.id));
        }
    }
  }
  return ids;
}

describe("STARTER_TEMPLATES", () => {
  it("has unique ids and bilingual names/descriptions", () => {
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tpl of STARTER_TEMPLATES) {
      expect(tpl.id).toMatch(/^starter-/);
      expect(starterName(tpl, "pl").length).toBeGreaterThan(0);
      expect(starterName(tpl, "en").length).toBeGreaterThan(0);
      expect(starterDescription(tpl, "pl").length).toBeGreaterThan(0);
      expect(starterDescription(tpl, "en").length).toBeGreaterThan(0);
    }
  });

  it("every template survives document validation without losing widgets", () => {
    for (const tpl of STARTER_TEMPLATES) {
      const sections = tpl.build();
      expect(sections.length).toBeGreaterThan(0);
      const widgets = collectWidgets(sections);
      expect(widgets.length).toBeGreaterThan(0);
      for (const w of widgets) {
        expect(isKnownWidgetType(w.type), `${tpl.id}: unknown widget ${w.type}`).toBe(true);
      }
      // Walidator dokumentu nie moze wyrzucic zadnej sekcji ani widgetu -
      // coerceWidget dropuje nieznane typy PO CICHU, wiec liczymy przed/po.
      const parsed = safeParseBuilderDoc({ version: 1, sections });
      expect(parsed.sections).toHaveLength(sections.length);
      expect(collectWidgets(parsed.sections)).toHaveLength(widgets.length);
    }
  });

  it("generates fresh unique ids on every build", () => {
    for (const tpl of STARTER_TEMPLATES) {
      const first = collectIds(tpl.build());
      const second = collectIds(tpl.build());
      expect(new Set(first).size).toBe(first.length);
      const overlap = first.filter((id) => second.includes(id));
      expect(overlap).toEqual([]);
    }
  });

  it("never ships an em dash in authored copy (repo rule: hyphen)", () => {
    for (const tpl of STARTER_TEMPLATES) {
      const payload = JSON.stringify(tpl.build());
      expect(payload).not.toContain("—");
    }
  });
});
