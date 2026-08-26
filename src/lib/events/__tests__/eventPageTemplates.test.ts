// Bramka szablonow podstron wydarzenia.
//
// CZEGO PILNUJE. Szablon jest DANYMI dokumentu buildera, wiec bledy w nim nie
// wywracaja typow - wychodza dopiero na stronie: nieznany typ widgetu renderer
// pomija w ciszy, powtorzony `id` psuje przenoszenie blokow, a szablon oddajacy
// ten sam obiekt dwa razy sklada dwie strony z jednego drzewa.
import { describe, expect, it } from "vitest";
import { WIDGET_MAP } from "@/lib/builder/registry";
import type { ColumnNode, InnerSectionNode, SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  DEFAULT_EVENT_PAGE_TEMPLATE_ID,
  EVENT_PAGE_TEMPLATES,
  eventPageTemplateDocument,
  findEventPageTemplate,
  templateText,
} from "@/lib/events/eventPageTemplates";

type AnyNode = SectionNode | InnerSectionNode | ColumnNode | WidgetNode;

function walk(nodes: readonly AnyNode[], visit: (node: AnyNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind !== "widget") walk(node.children, visit);
  }
}

describe("eventPageTemplates", () => {
  it("oferuje dokladnie dziesiec szablonow o unikalnych identyfikatorach", () => {
    expect(EVENT_PAGE_TEMPLATES).toHaveLength(10);
    const ids = EVENT_PAGE_TEMPLATES.map((tpl) => tpl.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("domyslny szablon istnieje", () => {
    expect(findEventPageTemplate(DEFAULT_EVENT_PAGE_TEMPLATE_ID)).not.toBeNull();
  });

  it("kazdy szablon ma opis, ikone i sklad w obu jezykach", () => {
    for (const tpl of EVENT_PAGE_TEMPLATES) {
      expect(tpl.icon).not.toBe("");
      expect(templateText(tpl.name, "pl")).not.toBe("");
      expect(templateText(tpl.name, "en")).not.toBe("");
      expect(templateText(tpl.description, "pl")).not.toBe("");
      expect(templateText(tpl.description, "en")).not.toBe("");
      expect(tpl.elements.length).toBeGreaterThan(0);
      for (const element of tpl.elements) {
        expect(element.pl).not.toBe("");
        expect(element.en).not.toBe("");
      }
    }
  });

  it("uzywa wylacznie widgetow z rejestru i nie powtarza identyfikatorow", () => {
    for (const tpl of EVENT_PAGE_TEMPLATES) {
      const sections = tpl.build();
      expect(sections.length).toBeGreaterThan(0);
      const ids: string[] = [];
      walk(sections, (node) => {
        ids.push(node.id);
        if (node.kind === "widget") expect(WIDGET_MAP[node.type]).toBeDefined();
      });
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("kazde wywolanie daje SWIEZE identyfikatory", () => {
    const tpl = EVENT_PAGE_TEMPLATES[1];
    expect(tpl.build()[0]?.id).not.toBe(tpl.build()[0]?.id);
  });

  it("dokument ma wersje 1, a nieznany szablon oddaje null", () => {
    const doc = eventPageTemplateDocument(DEFAULT_EVENT_PAGE_TEMPLATE_ID);
    expect(doc?.version).toBe(1);
    expect(doc?.sections.length).toBeGreaterThan(0);
    expect(eventPageTemplateDocument("nie-ma-takiego")).toBeNull();
    expect(eventPageTemplateDocument(null)).toBeNull();
  });
});
