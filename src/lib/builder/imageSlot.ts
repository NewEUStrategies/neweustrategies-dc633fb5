import type { ColumnNode, InnerSectionNode, SectionChild, SectionNode } from "./types";

/** Upper bounds known during SSR, before a browser can measure the widget. */
export interface ImageSlot {
  desktop: { vw: number; cap: number };
  tablet: { vw: number; cap: number };
}

export function columnImageSlot(
  section: SectionNode | InnerSectionNode,
  column: ColumnNode,
  siblings: readonly SectionChild[],
  parent?: ImageSlot,
): ImageSlot {
  const maxWidth =
    section.layout?.contentWidth === "full" ? Infinity : Math.max(1, section.layout?.width || 1140);
  const fallback = section.kind === "inner-section" ? 6 : 12;
  const slot = (device: "desktop" | "tablet") => {
    const span = (c: SectionChild) =>
      c.kind === "column" ? Math.max(1, c.span?.[device] ?? c.span?.desktop ?? fallback) : 12;
    const share =
      span(column) /
      Math.max(
        1,
        siblings.reduce((sum, c) => sum + span(c), 0),
      );
    return {
      vw: (parent?.[device].vw ?? 100) * share,
      cap: Math.min(maxWidth, parent?.[device].cap ?? Infinity) * share,
    };
  };
  return { desktop: slot("desktop"), tablet: slot("tablet") };
}

export function imageSlotSizes(slot?: ImageSlot, desktopColumns = 1, mobileColumns = 1): string {
  if (!slot)
    return desktopColumns === 1
      ? "100vw"
      : `(max-width: 767px) ${100 / mobileColumns}vw, ${100 / desktopColumns}vw`;
  const size = (value: ImageSlot["desktop"]) => {
    const vw = Math.round((value.vw / desktopColumns) * 100) / 100;
    return Number.isFinite(value.cap)
      ? `min(${vw}vw, ${Math.ceil(value.cap / desktopColumns)}px)`
      : `${vw}vw`;
  };
  return `(max-width: 767px) ${100 / mobileColumns}vw, (max-width: 1023px) ${size(slot.tablet)}, ${size(slot.desktop)}`;
}
