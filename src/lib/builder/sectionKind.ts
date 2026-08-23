import type { SectionChild, WidgetNode } from "./types";

const PEOPLE_WIDGET_TYPES = new Set(["team-member", "author-profile-card"]);

function isPeopleWidget(w: WidgetNode): boolean {
  return PEOPLE_WIDGET_TYPES.has(w.type);
}

function containsPeopleWidget(child: SectionChild): boolean {
  if (child.kind === "column") {
    return child.children.some(isPeopleWidget);
  }
  if (child.kind === "inner-section") {
    return child.columns.length > 0 && child.columns.every(containsPeopleWidget);
  }
  return false;
}

export function isPeopleSectionKind(children: SectionChild[]): boolean {
  if (!children.length) return false;
  // A person card may be accompanied by text/decorative widgets in the same
  // column. This is how the Management Board document is authored, so the
  // section remains a people grid as long as every column contains a card.
  return children.every(containsPeopleWidget);
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
