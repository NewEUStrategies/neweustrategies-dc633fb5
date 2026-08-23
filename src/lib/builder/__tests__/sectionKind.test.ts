import { describe, it, expect } from "vitest";
import { isPeopleSectionKind, peopleColumnCount } from "@/lib/builder/sectionKind";
import type { ColumnNode, SectionChild, WidgetNode, WidgetType } from "@/lib/builder/types";

function w(type: WidgetType): WidgetNode {
  return { id: `${type}-1`, kind: "widget", type, content: {} };
}

const col = (widgets: WidgetNode[]): ColumnNode => ({
  id: "col-1",
  kind: "column",
  span: { desktop: 3, mobile: 12 },
  children: widgets,
});

const inner = (columns: ColumnNode[]): SectionChild => ({
  id: "inner-1",
  kind: "inner-section",
  columns,
});

describe("isPeopleSectionKind", () => {
  it("returns true for a section with only team-member widgets", () => {
    expect(isPeopleSectionKind([col([w("team-member")])])).toBe(true);
  });

  it("returns true for a section with only author-profile-card widgets", () => {
    expect(isPeopleSectionKind([col([w("author-profile-card")])])).toBe(true);
  });

  it("keeps a people section when cards have supporting text widgets", () => {
    expect(isPeopleSectionKind([col([w("team-member"), w("text")])])).toBe(true);
  });

  it("returns false when a column has only non-people widgets", () => {
    expect(isPeopleSectionKind([col([w("heading"), w("text")])])).toBe(false);
  });

  it("returns true for nested inner-sections that contain only people widgets", () => {
    expect(isPeopleSectionKind([inner([col([w("team-member")]), col([w("team-member")])])])).toBe(true);
  });

  it("returns false for empty sections", () => {
    expect(isPeopleSectionKind([])).toBe(false);
  });

  it("returns false for empty columns", () => {
    expect(isPeopleSectionKind([col([])])).toBe(false);
  });
});

describe("peopleColumnCount", () => {
  it("counts columns directly", () => {
    expect(peopleColumnCount([col([w("team-member")]), col([w("team-member")])])).toBe(2);
  });

  it("counts columns inside nested inner-sections", () => {
    expect(peopleColumnCount([inner([col([w("team-member")]), col([w("team-member")]), col([w("team-member")])])])).toBe(3);
  });
});
