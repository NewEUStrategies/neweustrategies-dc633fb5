import { describe, expect, it } from "vitest";
import { GUEST_ACCESS_CONTEXT } from "@/lib/builder/accessControl";
import type { ColumnNode, InnerSectionNode, WidgetNode } from "@/lib/builder/types";
import {
  SEARCH_WIDGET_TYPE,
  childHostsSearchWidget,
  searchOverflowAttr,
  type SearchOverflowScope,
} from "@/lib/builder/searchOverflow";

const DESKTOP: SearchOverflowScope = { device: "desktop", accessCtx: GUEST_ACCESS_CONTEXT };
const MOBILE: SearchOverflowScope = { device: "mobile", accessCtx: GUEST_ACCESS_CONTEXT };
const MEMBER: SearchOverflowScope = {
  device: "desktop",
  accessCtx: { isAuthenticated: true, roles: [] },
};

const w = (type: string, advanced: WidgetNode["advanced"] = {}): WidgetNode =>
  ({ id: `w-${type}`, kind: "widget", type, content: {}, advanced }) as WidgetNode;
const col = (children: WidgetNode[], advanced: ColumnNode["advanced"] = {}): ColumnNode =>
  ({ id: "c", kind: "column", span: { desktop: 12 }, children, advanced }) as ColumnNode;
const inner = (columns: ColumnNode[]): InnerSectionNode =>
  ({ id: "i", kind: "inner-section", columns }) as InnerSectionNode;

describe("childHostsSearchWidget", () => {
  it("rozpoznaje typ widgetu, który renderuje SearchButtonWidget", () => {
    expect(SEARCH_WIDGET_TYPE).toBe("search-button");
  });

  it("kolumna z wyszukiwarką obok innych widgetów", () => {
    expect(childHostsSearchWidget(col([w("heading"), w("search-button")]), DESKTOP)).toBe(true);
  });

  it("kolumna bez wyszukiwarki i kolumna pusta", () => {
    expect(childHostsSearchWidget(col([w("heading"), w("divider")]), DESKTOP)).toBe(false);
    expect(childHostsSearchWidget(col([]), DESKTOP)).toBe(false);
  });

  it("sekcja zagnieżdżona - wystarczy jedna kolumna z wyszukiwarką", () => {
    expect(
      childHostsSearchWidget(inner([col([w("heading")]), col([w("search-button")])]), DESKTOP),
    ).toBe(true);
    expect(childHostsSearchWidget(inner([col([w("heading")])]), DESKTOP)).toBe(false);
    expect(childHostsSearchWidget(inner([]), DESKTOP)).toBe(false);
  });

  // Dawna reguła `:has()` pytała DOM: widget, którego renderer nie wyrenderuje,
  // nie zdejmował clipa. Predykat musi odsiewać tak samo jak `RenderColumn`.
  it("wyszukiwarka ukryta na tym urządzeniu (hideOn) nie zdejmuje clipa", () => {
    const mobileOnly = col([w("search-button", { hideOn: { desktop: true } })]);
    expect(childHostsSearchWidget(mobileOnly, DESKTOP)).toBe(false);
    expect(childHostsSearchWidget(mobileOnly, MOBILE)).toBe(true);
  });

  it("wyszukiwarka za regułą dostępu liczy się tylko dla widza, który ją zobaczy", () => {
    const membersOnly = col([w("search-button", { access: { auth: "user" } })]);
    expect(childHostsSearchWidget(membersOnly, DESKTOP)).toBe(false);
    expect(childHostsSearchWidget(membersOnly, MEMBER)).toBe(true);
  });

  it("kolumna sekcji zagnieżdżonej za regułą dostępu - jak filtr w RenderInner", () => {
    const gated = inner([col([w("search-button")], { access: { auth: "user" } })]);
    expect(childHostsSearchWidget(gated, DESKTOP)).toBe(false);
    expect(childHostsSearchWidget(gated, MEMBER)).toBe(true);
  });

  it("dane z jsonb bez tablic albo z dziurami nie wywracają renderu", () => {
    // Kształt prosto z kolumny jsonb - typ obiecuje tablice, baza ich nie gwarantuje.
    const broken: ColumnNode = JSON.parse('{"id":"c","kind":"column","span":{},"children":null}');
    expect(childHostsSearchWidget(broken, DESKTOP)).toBe(false);
    const holes: ColumnNode = JSON.parse(
      '{"id":"c","kind":"column","span":{},"children":[null,{"id":"s","kind":"widget","type":"search-button","content":{}}]}',
    );
    expect(childHostsSearchWidget(holes, DESKTOP)).toBe(true);
    const innerBroken: InnerSectionNode = JSON.parse('{"id":"i","kind":"inner-section"}');
    expect(childHostsSearchWidget(innerBroken, DESKTOP)).toBe(false);
    const innerHoles: InnerSectionNode = JSON.parse(
      '{"id":"i","kind":"inner-section","columns":[null,{"id":"c","kind":"column","span":{},"children":[{"id":"s","kind":"widget","type":"search-button","content":{}}]}]}',
    );
    expect(childHostsSearchWidget(innerHoles, DESKTOP)).toBe(true);
  });
});

describe("searchOverflowAttr", () => {
  it("pusty napis albo brak atrybutu - nigdy wartość, którą React wypisałby jako tekst", () => {
    expect(searchOverflowAttr(true)).toBe("");
    expect(searchOverflowAttr(false)).toBeUndefined();
  });
});
