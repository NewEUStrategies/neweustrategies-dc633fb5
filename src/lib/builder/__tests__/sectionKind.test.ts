import { describe, it, expect } from "vitest";
import { isPeopleSectionKind, peopleColumnCount } from "@/lib/builder/sectionKind";
import type { SectionChild, WidgetNode } from "@/lib/builder/types";

function w(type: string): WidgetNode {
  return { id: `${type}-1`, kind: "widget", type, content: {} };
}

const col = (widgets: WidgetNode[]): SectionChild => ({
  id: "col-1",
  kind: "column",
  span: { desktop: 3, mobile: 12 },
  children: widgets,
});

const inner = (columns: SectionChild[]): SectionChild => ({
  id: "inner-1",
  kind: "inner-section",
  columns: columns as NonNullable<typeof columns>,
});

describe("isPeopleSectionKind", () => {
  it("returns true for a section with only team-member widgets", () => {
    expect(isPeopleSectionKind([col([w("team-member")])])).toBe(true);
  });

  it("returns true for a section with only author-profile-card widgets", () => {
    expect(isPeopleSectionKind([col([w("author-profile-card")])])).toBe(true);
  });

  it("returns false when a column contains a non-people widget", () => {
    expect(isPeopleSectionKind([col([w("team-member"), w("heading")])])).toBe(false);
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
