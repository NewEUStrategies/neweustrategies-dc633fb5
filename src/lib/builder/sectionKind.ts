import type { ColumnNode, InnerSectionNode, SectionChild, WidgetNode } from "./types";

const PEOPLE_WIDGET_TYPES = new Set(["team-member", "author-profile-card"]);

function isPeopleWidget(w: WidgetNode): boolean {
  return PEOPLE_WIDGET_TYPES.has(w.type);
}

export function isPeopleSectionKind(children: SectionChild[]): boolean {
  if (!children.length) return false;
  return children.every((child) => {
    if (child.kind === "column") {
      if (!child.children.length) return false;
      return child.children.every(isPeopleWidget);
    }
    if (child.kind === "inner-section") {
      return isPeopleSectionKind(child.columns);
    }
    return false;
  });
}

export function peopleColumnCount(children: SectionChild[]): number {
  if (!children.length) return 0;
  // Count columns in the first layer that contains columns.
  for (const child of children) {
    if (child.kind === "column") return children.length;
    if (child.kind === "inner-section") {
      const inner = peopleColumnCount(child.columns);
      if (inner > 0) return inner;
    }
  }
  return 0;
}
