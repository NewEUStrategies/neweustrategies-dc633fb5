import { describe, expect, it } from "vitest";
import type { ColumnNode, InnerSectionNode, WidgetNode } from "@/lib/builder/types";
import {
  SEARCH_WIDGET_TYPE,
  childHostsSearchWidget,
  searchOverflowAttr,
} from "@/lib/builder/searchOverflow";

const w = (type: string): WidgetNode =>
  ({ id: `w-${type}`, kind: "widget", type, content: {} }) as WidgetNode;
const col = (children: WidgetNode[]): ColumnNode =>
  ({ id: "c", kind: "column", span: { desktop: 12 }, children }) as ColumnNode;
const inner = (columns: ColumnNode[]): InnerSectionNode =>
  ({ id: "i", kind: "inner-section", columns }) as InnerSectionNode;

describe("childHostsSearchWidget", () => {
  it("rozpoznaje typ widgetu, który renderuje SearchButtonWidget", () => {
    expect(SEARCH_WIDGET_TYPE).toBe("search-button");
  });

  it("kolumna z wyszukiwarką obok innych widgetów", () => {
    expect(childHostsSearchWidget(col([w("logo"), w("search-button")]))).toBe(true);
  });

  it("kolumna bez wyszukiwarki i kolumna pusta", () => {
    expect(childHostsSearchWidget(col([w("logo"), w("menu")]))).toBe(false);
    expect(childHostsSearchWidget(col([]))).toBe(false);
  });

  it("sekcja zagnieżdżona - wystarczy jedna kolumna z wyszukiwarką", () => {
    expect(childHostsSearchWidget(inner([col([w("menu")]), col([w("search-button")])]))).toBe(true);
    expect(childHostsSearchWidget(inner([col([w("menu")])]))).toBe(false);
    expect(childHostsSearchWidget(inner([]))).toBe(false);
  });

  it("dane z jsonb bez tablic albo z dziurami nie wywracają renderu", () => {
    // Kształt prosto z kolumny jsonb - typ obiecuje tablice, baza ich nie gwarantuje.
    const broken: ColumnNode = JSON.parse('{"id":"c","kind":"column","span":{},"children":null}');
    expect(childHostsSearchWidget(broken)).toBe(false);
    const holes: ColumnNode = JSON.parse(
      '{"id":"c","kind":"column","span":{},"children":[null,{"id":"s","kind":"widget","type":"search-button","content":{}}]}',
    );
    expect(childHostsSearchWidget(holes)).toBe(true);
    const innerBroken: InnerSectionNode = JSON.parse('{"id":"i","kind":"inner-section"}');
    expect(childHostsSearchWidget(innerBroken)).toBe(false);
  });
});

describe("searchOverflowAttr", () => {
  it("pusty napis albo brak atrybutu - nigdy wartość, którą React wypisałby jako tekst", () => {
    expect(searchOverflowAttr(true)).toBe("");
    expect(searchOverflowAttr(false)).toBeUndefined();
  });
});
