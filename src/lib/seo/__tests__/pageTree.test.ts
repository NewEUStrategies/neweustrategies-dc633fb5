import { describe, expect, it } from "vitest";
import { buildPageTree, countPageTreeNodes, type PageTreeRow } from "@/lib/seo/pageTree";

const row = (partial: Partial<PageTreeRow> & Pick<PageTreeRow, "id" | "slug">): PageTreeRow => ({
  title_pl: partial.slug,
  title_en: partial.slug,
  parent_id: null,
  menu_order: 0,
  ...partial,
});

describe("buildPageTree", () => {
  it("nests children and derives canonical paths from the parent chain", () => {
    const tree = buildPageTree([
      row({ id: "a", slug: "analizy" }),
      row({ id: "b", slug: "raporty", parent_id: "a" }),
      row({ id: "c", slug: "2026", parent_id: "b" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.path).toBe("/analizy");
    expect(tree[0]?.children[0]?.path).toBe("/analizy/raporty");
    expect(tree[0]?.children[0]?.children[0]?.path).toBe("/analizy/raporty/2026");
    expect(countPageTreeNodes(tree)).toBe(3);
  });

  it("orders siblings by menu_order, then by localized title", () => {
    const tree = buildPageTree([
      row({ id: "1", slug: "zeta", menu_order: 0, title_pl: "Zeta" }),
      row({ id: "2", slug: "alfa", menu_order: 0, title_pl: "Alfa" }),
      row({ id: "3", slug: "pierwsza", menu_order: -1, title_pl: "Pierwsza" }),
    ]);
    expect(tree.map((n) => n.slug)).toEqual(["pierwsza", "alfa", "zeta"]);
  });

  it("promotes orphans (excluded/unpublished parent) to roots", () => {
    const tree = buildPageTree([row({ id: "child", slug: "podstrona", parent_id: "missing" })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.path).toBe("/podstrona");
  });
});
